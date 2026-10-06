import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import { encryptSecret } from '../lib/crypto';
import {
  fail,
  failRetryable,
  graphError,
  graphTestConnection,
  httpJson,
  needsReconnect,
  oauthCallbackBase,
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
        redirect_uri: `${oauthCallbackBase(env)}/oauth/threads/callback`,
        code,
      }),
    });
    if (!tok.ok || typeof (tok.data as { access_token?: unknown } | null)?.access_token !== 'string') {
      throw new Error('Threads rejected the connection attempt. Verify the app credentials and try again.');
    }
    let accessToken = String((tok.data as { access_token: string }).access_token);
    let expiresAt: number | undefined;
    // Exchange the short-lived token (1h) for a long-lived one (60 days,
    // expires_in ≈ 5184000). A silent failure here stores a token that dies
    // within the hour, so the outcome is always logged (safe fields only) and
    // short tokens are marked with their true expiry so the engine knows to
    // exchange/refresh before publishing.
    const ll = await this.exchangeLongLived(env, accessToken);
    if (ll) {
      accessToken = ll.accessToken;
      expiresAt = ll.expiresAt;
      console.log('[threads-oauth] long-lived exchange ok, expires in', ll.expiresIn ?? 'unknown');
    } else {
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
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

  // Long-lived Threads tokens renew via th_refresh_token (valid only after the
  // token is at least 24h old and not within 24h of expiry). A stored
  // short-lived token can never refresh — it is exchanged instead, so the
  // exchange is attempted first and the documented refresh is the fallback.
  async refresh(env: Env, tokens: { accessToken: string }): Promise<{ accessToken: string; expiresAt?: number }> {
    const secrets = secretsOf(env, tokens.accessToken);
    const exchanged = await this.exchangeLongLived(env, tokens.accessToken);
    if (exchanged) {
      return { accessToken: exchanged.accessToken, ...(exchanged.expiresAt ? { expiresAt: exchanged.expiresAt } : {}) };
    }
    const resp = await httpJson(
      `${GRAPH.replace('/v1.0', '')}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    const data = (resp.data ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (!resp.ok || typeof data.access_token !== 'string') {
      throw needsReconnect(secrets, 'Your Threads authorization expired. Reconnect Threads.');
    }
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return { accessToken: data.access_token, ...(expiresAt ? { expiresAt } : {}) };
  }

  // GET graph.threads.net/access_token?grant_type=th_exchange_token — the one
  // documented server-side exchange. No client_id, no /v1.0 prefix. Returns
  // null on any Meta rejection (callers log and fall back).
  private async exchangeLongLived(
    env: Env,
    shortToken: string,
  ): Promise<{ accessToken: string; expiresAt?: number; expiresIn?: number } | null> {
    const secrets = secretsOf(env, shortToken);
    const resp = await httpJson(
      `${GRAPH.replace('/v1.0', '')}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(env.THREADS_CLIENT_SECRET ?? '')}&access_token=${encodeURIComponent(shortToken)}`,
    );
    const data = (resp.data ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (!resp.ok || typeof data.access_token !== 'string') {
      const err = (resp.data as { error?: { code?: number; message?: string } } | null)?.error;
      console.log('[threads-oauth] long-lived exchange FAILED', {
        httpStatus: resp.status,
        metaErrorCode: err?.code ?? null,
        metaErrorMessage: redact(String(err?.message ?? ''), secrets),
        clientIdSuffix: `…${(env.THREADS_CLIENT_ID ?? '').slice(-4)}`,
      });
      return null;
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
    return {
      accessToken: data.access_token,
      expiresIn,
      ...(expiresIn !== undefined ? { expiresAt: Math.floor(Date.now() / 1000) + expiresIn } : {}),
    };
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
      // A stored short-lived token (dies within the hour) is exchanged for the
      // long-lived one before publishing; the upgraded token is persisted so
      // later attempts and other targets reuse it.
      await this.upgradeShortToken(env, input.account, secrets);
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
      // Container creation posts to /{uid}/threads (Meta's documented edge;
      // /threads_media does not exist and returns a misleading 100/33 "object
      // does not exist"). Params ride in the query string, mirroring Meta's
      // documented form.
      const container = await this.post(env, secrets, `/${uid}/threads?${params.toString()}`, new URLSearchParams());
      const containerId = requireId(container, secrets, 'Threads');
      console.log('[threads-publish] container created', containerId.slice(0, 8) + '…', 'media_type:', params.get('media_type'));
      // Meta processes the container asynchronously: publishing too early
      // fails with (24) "The requested resource does not exist". Retry briefly
      // in-request (bounded so Publish Now answers fast), then hand off to the
      // retry ladder / pending resolution — safe, because a creation_id can
      // only be published once, so a retry can never duplicate the post.
      // Container status polling is not an option: status_code does not exist
      // as a field on graph.threads.net container nodes.
      const publishPath = `/${uid}/threads_publish?creation_id=${encodeURIComponent(containerId)}`;
      let pub: ProviderResponse | null = null;
      for (let attempt = 0; attempt < 4 && !pub; attempt++) {
        let resp: ProviderResponse;
        try {
          resp = await httpJson(`${GRAPH}${publishPath}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
            body: new URLSearchParams(),
          });
        } catch (netErr) {
          if (attempt === 3) throw netErr;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (resp.ok) {
          pub = resp;
          break;
        }
        const pErr = (resp.data as { error?: { code?: number } } | null)?.error;
        if (pErr?.code !== 24) {
          // A real rejection, not the processing race: run the failure
          // diagnostics once (this.post throws with the humanized error).
          await this.post(env, secrets, publishPath, new URLSearchParams());
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!pub) {
        throw failRetryable(secrets, 'CONTAINER_PROCESSING', 'Threads is still processing this post. Cotly will retry automatically.');
      }
      const publishedId = requireId(pub, secrets, 'Threads publish');
      console.log('[threads-publish] publish accepted, remote id', publishedId.slice(0, 8) + '…');
      // threads_publish returns the id of the PUBLISHED media (distinct from
      // the container); resolvePending polls that node for its permalink.
      return { kind: 'pending', externalId: publishedId, ...(pub.raw ? { raw: pub.raw } : {}) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  // The published media node exposes its permalink once Threads finishes
  // registering it; polling that single field avoids container status fields
  // (status_code does not exist on graph.threads.net). Until the permalink
  // appears the outcome stays pending — the engine's 24h cap catches
  // permalinks that never materialize.
  async resolvePending(env: Env, account: SocialAccountRecord, externalId: string): Promise<PublishOutcome> {
    const secrets = secretsOf(env, account.accessToken);
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${GRAPH}/${externalId}?fields=permalink`, {
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
    } catch (e) {
      return outcomeFromError(e);
    }
    if (resp.ok) {
      const permalink = (resp.data as { permalink?: string } | null)?.permalink;
      if (permalink) {
        return { kind: 'confirmed', externalId, permalink, ...(resp.raw ? { raw: resp.raw } : {}) };
      }
      return { kind: 'pending', externalId };
    }
    // A dead token must surface needs_reconnect (and flip the account) even
    // from the pending path; transient errors stay pending for the next tick.
    try {
      throw graphError(resp, secrets, 'Threads');
    } catch (e) {
      const out = outcomeFromError(e);
      if (out.kind === 'needs_reconnect') return out;
      return { kind: 'pending', externalId };
    }
  }

  // Exchanges a still-valid short-lived token for the long-lived one and
  // persists the upgrade. No-op when the stored token is already long-lived
  // (expiry more than 2h out) or the exchange is rejected.
  private async upgradeShortToken(env: Env, account: SocialAccountRecord, secrets: Secrets): Promise<void> {
    const nowS = Math.floor(Date.now() / 1000);
    if (account.tokenExpiresAt === undefined || account.tokenExpiresAt - nowS >= 7200) return;
    try {
      const upgraded = await this.exchangeLongLived(env, account.accessToken);
      if (!upgraded) return;
      secrets[0] = upgraded.accessToken;
      const enc = await encryptSecret(env.ENCRYPTION_SECRET, upgraded.accessToken);
      await env.DB
        .prepare(`UPDATE social_accounts SET access_token_enc = ?, token_expires_at = ?, status = 'connected', updated_at = ? WHERE id = ?`)
        .bind(enc, upgraded.expiresAt ?? null, nowS, account.id)
        .run();
      console.log('[threads-publish] short token upgraded to long-lived, expires in', upgraded.expiresIn ?? 'unknown');
    } catch (e) {
      console.log('[threads-publish] token upgrade skipped:', redact(String(e), secrets).slice(0, 160));
    }
  }

  private async post(env: Env, secrets: Secrets, path: string, body: URLSearchParams): Promise<ProviderResponse> {
    const resp = await httpJson(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      body,
    });
    if (!resp.ok) {
      // Decisive diagnostic 1: does the token still pass a basic GET right
      // before the publish POST? If /me works but threads_media does not, the
      // token is valid and threads_basic is present — the failure is about the
      // publish permission, not the token itself.
      try {
        const me = await httpJson(`${GRAPH}/me?fields=id,username`, { headers: { authorization: `Bearer ${secrets[0] ?? ''}` } });
        const meData = (me.data ?? {}) as { id?: string; username?: string };
        console.log('[threads-publish] pre-publish /me', {
          ok: me.ok,
          idSuffix: typeof meData.id === 'string' ? `…${meData.id.slice(-6)}` : null,
          username: meData.username ?? null,
          metaErrorCode: (me.data as { error?: { code?: number } } | null)?.error?.code ?? null,
        });
      } catch (meErr) {
        console.log('[threads-publish] pre-publish /me unavailable:', redact(String(meErr), secrets).slice(0, 160));
      }
      // Removed: debug_token + edge probes cost 3 extra round trips on every
      // failure (Publish Now latency). The /me probe above plus the final
      // error log below carry the decisive signal.
      const err = (resp.data as { error?: { code?: number; message?: string; error_subcode?: number } } | null)?.error;
      console.log('[threads-publish] graph call failed', {
        httpStatus: resp.status,
        metaErrorCode: err?.code ?? null,
        metaErrorSubcode: err?.error_subcode ?? null,
        metaErrorMessage: redact(String(err?.message ?? ''), secrets),
        endpoint: path.split('?')[0],
      });
      throw graphError(resp, secrets, 'Threads');
    }
    return resp;
  }
}
