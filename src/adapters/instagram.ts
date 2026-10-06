import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  graphError,
  httpJson,
  needsReconnect,
  oauthError,
  outcomeFromError,
  presignMediaGet,
  requireId,
  testNetworkResult,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

// Instagram API with Instagram Login. Publishing needs a Business or Creator
// account, and images must be reachable by Instagram's fetchers, so media is
// shared through a short-lived signed URL — the bucket itself stays private.
const DIALOG = 'https://www.instagram.com/oauth/authorize';
const TOKEN = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com/v21.0';
const GRAPH_ROOT = 'https://graph.instagram.com';
export const SCOPE = 'instagram_business_basic,instagram_business_content_publish';

const secretsOf = (env: Env, token?: string): Secrets => [token, env.INSTAGRAM_CLIENT_SECRET];

export class InstagramAdapter implements PlatformAdapter {
  readonly provider = 'instagram' as const;
  readonly capabilities = getCapabilities('instagram');

  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string }> {
    if (!env.INSTAGRAM_CLIENT_ID) {
      throw new Error('Instagram OAuth is not configured. Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET first.');
    }
    const u = new URL(DIALOG);
    u.searchParams.set('client_id', env.INSTAGRAM_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPE);
    return { url: u.toString() };
  }

  async handleCallback(env: Env, params: URLSearchParams) {
    const secrets = secretsOf(env);
    oauthError(params, 'Instagram');
    const code = params.get('code');
    if (!code) throw new Error('Instagram did not return an authorization code. Try connecting again.');
    const tok = await httpJson(TOKEN, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.INSTAGRAM_CLIENT_ID ?? '',
        client_secret: env.INSTAGRAM_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        redirect_uri: `${env.APP_URL}/oauth/instagram/callback`,
        code,
      }),
    });
    const short = (tok.data ?? {}) as { access_token?: unknown; user_id?: unknown };
    if (!tok.ok || typeof short.access_token !== 'string') {
      throw new Error('Instagram rejected the connection attempt. Verify the app credentials and try again.');
    }
    let accessToken = short.access_token;
    let expiresAt: number | undefined;
    // Exchange the short-lived token (1h) for a long-lived one (60 days).
    const ll = await httpJson(
      `${GRAPH_ROOT}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env.INSTAGRAM_CLIENT_SECRET ?? '')}&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (ll.ok && typeof (ll.data as { access_token?: unknown } | null)?.access_token === 'string') {
      accessToken = String((ll.data as { access_token: string }).access_token);
      const expiresIn = (ll.data as { expires_in?: unknown }).expires_in;
      if (typeof expiresIn === 'number') expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    }
    const me = await httpJson(`${GRAPH}/me?fields=user_id,username,account_type,profile_picture_url`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) {
      throw new Error('Cotly could not read your Instagram profile. Confirm the app has instagram_business_basic and try again.');
    }
    const data = (me.data ?? {}) as { id?: string; user_id?: string; username?: string; account_type?: string; profile_picture_url?: string };
    const igUserId = data.user_id ?? data.id;
    if (!igUserId) throw new Error('Instagram did not return a profile id. Try connecting again.');
    // The Instagram Login API reports professional accounts as BUSINESS,
    // CREATOR or MEDIA_CREATOR; personal accounts cannot publish.
    if (!['BUSINESS', 'CREATOR', 'MEDIA_CREATOR'].includes(String(data.account_type))) {
      throw new Error('Instagram publishing requires a Business or Creator account. Switch your account type in Instagram settings and connect again.');
    }
    return {
      account: {
        externalId: igUserId,
        displayName: data.username || 'Instagram account',
        ...(data.profile_picture_url ? { avatarUrl: data.profile_picture_url } : {}),
        meta: { accountType: data.account_type },
      },
      tokens: { accessToken, ...(expiresAt ? { expiresAt } : {}) },
      scopes: SCOPE,
    };
  }

  // Long-lived Instagram tokens renew via ig_refresh_token; the engine calls
  // this automatically when the stored expiry passes.
  async refresh(env: Env, tokens: { accessToken: string }): Promise<{ accessToken: string; expiresAt?: number }> {
    const resp = await httpJson(
      `${GRAPH_ROOT}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokens.accessToken)}`,
    );
    const data = (resp.data ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (!resp.ok || typeof data.access_token !== 'string') {
      throw needsReconnect(secretsOf(env, tokens.accessToken), 'Your Instagram authorization expired. Reconnect Instagram.');
    }
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return { accessToken: data.access_token, ...(expiresAt ? { expiresAt } : {}) };
  }

  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    const secrets = secretsOf(env, account.accessToken);
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${GRAPH}/me?fields=user_id,username,account_type`, {
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
    } catch (e) {
      return testNetworkResult(e, 'Instagram') ?? { ok: false, detail: 'Instagram connection test failed unexpectedly. Try again.' };
    }
    if (resp.ok) {
      const data = (resp.data ?? {}) as { username?: string; account_type?: string };
      const identity = data.username ? `@${data.username}` : account.displayName;
      const kind = data.account_type ? ` (${String(data.account_type).toLowerCase()} account)` : '';
      return { ok: true, detail: `Token valid — identity ${identity}${kind}.` };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, detail: 'Your Instagram connection expired. Reconnect Instagram.' };
    }
    return { ok: false, detail: 'Instagram returned an unexpected response. Try again.' };
  }

  // Container first, then media_publish once the container is ready. The
  // container id is the pending externalId; resolvePending finishes the job.
  // Single image (IMAGE container) or single video (REELS container).
  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(env, input.account.accessToken);
    try {
      const uid = input.account.externalId;
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      const videos = input.media.filter((m) => m.mime.startsWith('video/'));
      if (images.length === 0 && videos.length === 0) {
        throw fail(secrets, 'MEDIA_REQUIRED', 'Instagram posts require media. Attach one image or one video and retry.');
      }
      if (images.length + videos.length > 1) {
        throw fail(secrets, 'TOO_MANY_MEDIA', 'Cotly currently publishes one image or one video (Reel) per Instagram post. Remove the extra media and retry.');
      }
      const params = new URLSearchParams({ caption: input.caption });
      if (videos.length === 1) {
        params.set('media_type', 'REELS');
        params.set('video_url', await presignMediaGet(env, videos[0]!.r2Key));
        // Make the Reel visible in the main feed, not only in the Reels tab.
        params.set('share_to_feed', '1');
      } else {
        params.set('media_type', 'IMAGE');
        params.set('image_url', await presignMediaGet(env, images[0]!.r2Key));
      }
      const container = await this.post(secrets, `/${uid}/media`, params);
      const containerId = requireId(container, secrets, 'Instagram');
      return { kind: 'pending', externalId: containerId, ...(container.raw ? { raw: container.raw } : {}) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  async resolvePending(env: Env, account: SocialAccountRecord, externalId: string): Promise<PublishOutcome> {
    const secrets = secretsOf(env, account.accessToken);
    try {
      const status = await httpJson(`${GRAPH}/${externalId}?fields=status_code,status,error_message`, {
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
      if (!status.ok) throw graphError(status, secrets, 'Instagram');
      const data = (status.data ?? {}) as { status_code?: string; status?: string; error_message?: string };
      const code = data.status_code ?? data.status ?? '';
      if (code === 'FINISHED' || code === 'PUBLISHED') {
        const pub = await this.post(secrets, `/${account.externalId}/media_publish`, new URLSearchParams({ creation_id: externalId }));
        const mediaId = requireId(pub, secrets, 'Instagram');
        const detail = await httpJson(`${GRAPH}/${mediaId}?fields=permalink`, {
          headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
        });
        const permalink = (detail.data as { permalink?: string } | null)?.permalink;
        return { kind: 'confirmed', externalId: mediaId, ...(permalink ? { permalink } : {}), ...(pub.raw ? { raw: pub.raw } : {}) };
      }
      if (code === 'ERROR' || code === 'EXPIRED' || data.error_message) {
        throw fail(secrets, 'MEDIA_PROCESSING', data.error_message || 'Media processing failed on Instagram.', status.raw);
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
    if (!resp.ok) throw graphError(resp, secrets, 'Instagram');
    return resp;
  }
}
