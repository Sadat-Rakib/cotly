import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  graphError,
  graphTestConnection,
  httpJson,
  needsReconnect,
  oauthError,
  outcomeFromError,
  presignMediaGet,
  redact,
  requireId,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

const DIALOG = 'https://threads.net/oauth/authorize';
const TOKEN = 'https://graph.threads.net/oauth/access_token';
const GRAPH = 'https://graph.threads.net/v1.0';
export const SCOPE = 'threads_basic,threads_content_publish';
const MAX_CHARS = 500;

const secretsOf = (env: Env, token?: string): Secrets => [token, env.THREADS_CLIENT_SECRET];

export class ThreadsAdapter implements PlatformAdapter {
  readonly provider = 'threads' as const;
  readonly capabilities = getCapabilities('threads');

  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string }> {
    if (!env.THREADS_CLIENT_ID) {
      throw new Error('Threads OAuth is not configured. Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET first.');
    }
    // Secret-free diagnostics: client id suffix, exact redirect, requested scopes.
    console.log('[threads-oauth] start', {
      clientIdSuffix: `…${(env.THREADS_CLIENT_ID ?? '').slice(-4)}`,
      redirectUri,
      scopes: SCOPE,
    });
    const u = new URL(DIALOG);
    u.searchParams.set('client_id', env.THREADS_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPE);
    return { url: u.toString() };
  }

  async handleCallback(env: Env, params: URLSearchParams) {
    const secrets = secretsOf(env);
    oauthError(params, 'Threads');
    const code = params.get('code');
    if (!code) throw new Error('Threads did not return an authorization code. Try connecting again.');
    const tok = await httpJson(TOKEN, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.THREADS_CLIENT_ID ?? '',
        client_secret: env.THREADS_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        redirect_uri: `${env.APP_URL}/oauth/threads/callback`,
        code,
      }),
    });
    if (!tok.ok || typeof (tok.data as { access_token?: unknown } | null)?.access_token !== 'string') {
      throw new Error('Threads rejected the connection attempt. Verify the app credentials and try again.');
    }
    let accessToken = String((tok.data as { access_token: string }).access_token);
    let expiresAt: number | undefined;
    // Exchange the short-lived token (1h) for a long-lived one (60 days).
    const ll = await httpJson(
      `${GRAPH.replace('/v1.0', '')}/long_lived_access_token?grant_type=threads_exchange&client_secret=${encodeURIComponent(env.THREADS_CLIENT_SECRET ?? '')}&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (ll.ok && typeof (ll.data as { access_token?: unknown } | null)?.access_token === 'string') {
      accessToken = String((ll.data as { access_token: string }).access_token);
      const expiresIn = (ll.data as { expires_in?: unknown }).expires_in;
      if (typeof expiresIn === 'number') expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    }
    // Official Threads profile fields only — /me on graph.threads.net, never
    // graph.facebook.com. An unknown field name here fails the whole call.
    const fields = 'id,username,name,threads_profile_picture_url,threads_biography';
    const me = await httpJson(`${GRAPH}/me?fields=${fields}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) {
      // Safe diagnostics only: status, Meta error code/message, scopes, URL,
      // client id suffix. Never the token or secret.
      const err = (me.data as { error?: { code?: number; message?: string; type?: string } } | null)?.error;
      console.log('[threads-oauth] /me failed', {
        httpStatus: me.status,
        metaErrorCode: err?.code ?? null,
        metaErrorType: err?.type ?? null,
        metaErrorMessage: redact(String(err?.message ?? ''), secrets),
        requestedScopes: SCOPE,
        apiUrl: `${GRAPH}/me?fields=${fields}`,
        clientIdSuffix: `…${(env.THREADS_CLIENT_ID ?? '').slice(-4)}`,
      });
      const codePart = typeof err?.code === 'number' ? ` (Meta code ${err.code})` : '';
      const msgPart = redact(String(err?.message ?? 'Threads did not answer the profile request.'), secrets);
      throw new Error(`Cotly could not read your Threads profile${codePart}: ${msgPart}`);
    }
    const data = me.data as {
      id?: string;
      username?: string;
      name?: string;
      threads_profile_picture_url?: string;
      threads_biography?: string;
    } | null;
    if (!data?.id) throw new Error('Threads did not return a profile id. Try connecting again.');
    console.log('[threads-oauth] connected user', data.id.slice(0, 6) + '…', 'with long-lived token:', Boolean(expiresAt));
    return {
      account: {
        externalId: data.id,
        displayName: (data.name || data.username || 'Threads user').trim(),
        ...(data.threads_profile_picture_url ? { avatarUrl: data.threads_profile_picture_url } : {}),
        meta: {
          handle: data.username ?? '',
          ...(data.threads_biography ? { biography: data.threads_biography } : {}),
        },
      },
      tokens: { accessToken, ...(expiresAt ? { expiresAt } : {}) },
      scopes: SCOPE,
    };
  }

  // Long-lived Threads tokens renew via threads_refresh (valid only after the
  // token is at least 24h old and not within 24h of expiry); the engine calls
  // this automatically when the stored expiry passes.
  async refresh(env: Env, tokens: { accessToken: string }): Promise<{ accessToken: string; expiresAt?: number }> {
    const resp = await httpJson(
      `${GRAPH.replace('/v1.0', '')}/refresh_access_token?grant_type=threads_refresh&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    const data = (resp.data ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (!resp.ok || typeof data.access_token !== 'string') {
      throw needsReconnect(secretsOf(env, tokens.accessToken), 'Your Threads authorization expired. Reconnect Threads.');
    }
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return { accessToken: data.access_token, ...(expiresAt ? { expiresAt } : {}) };
  }

  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    return graphTestConnection({
      url: `${GRAPH}/me?fields=id,username`,
      token: account.accessToken,
      secrets: secretsOf(env, account.accessToken),
      platformName: 'Threads',
      identityField: 'username',
      fallbackIdentity: account.displayName,
    });
  }

  // Two-step: container, then publish. The container is returned as the pending
  // externalId; resolvePending polls it until the media is FINISHED.
  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(env, input.account.accessToken);
    try {
      if (input.caption.length > MAX_CHARS) {
        throw fail(secrets, 'CAPTION_TOO_LONG', `Threads captions are limited to ${MAX_CHARS} characters. Shorten the caption and retry.`);
      }
      const uid = input.account.externalId;
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      const videos = input.media.filter((m) => m.mime.startsWith('video/'));
      const video = videos[0];
      const firstImage = images[0];
      if (videos.length > 1 || images.length > 1) {
        throw fail(secrets, 'TOO_MANY_MEDIA', 'Cotly currently publishes one image or one video per Threads post. Remove the extra media and retry.');
      }
      const params = new URLSearchParams({ media_type: 'TEXT', text: input.caption });
      if (video) {
        params.set('media_type', 'VIDEO');
        params.set('video_url', await presignMediaGet(env, video.r2Key));
      } else if (firstImage) {
        params.set('media_type', 'IMAGE');
        params.set('image_url', await presignMediaGet(env, firstImage.r2Key));
      }
      const container = await this.post(secrets, `/${uid}/threads_media`, params);
      const containerId = requireId(container, secrets, 'Threads');
      const pub = await this.post(secrets, `/${uid}/threads_publish`, new URLSearchParams({ creation_id: containerId }));
      return { kind: 'pending', externalId: containerId, ...(pub.raw ? { raw: pub.raw } : {}) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  async resolvePending(env: Env, account: SocialAccountRecord, externalId: string): Promise<PublishOutcome> {
    const secrets = secretsOf(env, account.accessToken);
    try {
      const resp = await httpJson(`${GRAPH}/${externalId}?fields=status_code,status,error_message,permalink`, {
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
      if (!resp.ok) throw graphError(resp, secrets, 'Threads');
      const data = (resp.data ?? {}) as { status_code?: string; status?: string; error_message?: string; permalink?: string };
      const status = data.status_code ?? data.status ?? '';
      if (status === 'FINISHED') {
        return {
          kind: 'confirmed',
          externalId,
          ...(data.permalink ? { permalink: data.permalink } : {}),
          ...(resp.raw ? { raw: resp.raw } : {}),
        };
      }
      if (status === 'ERROR' || status === 'EXPIRED' || data.error_message) {
        throw fail(secrets, 'CONTAINER_ERROR', data.error_message || 'Threads failed to process this post.', resp.raw);
      }
      return { kind: 'pending', externalId };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  private async post(secrets: Secrets, path: string, body: URLSearchParams): Promise<ProviderResponse> {
    const resp = await httpJson(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      body,
    });
    if (!resp.ok) throw graphError(resp, secrets, 'Threads');
    return resp;
  }
}
