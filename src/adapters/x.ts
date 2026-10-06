import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { MediaRecord, PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  failRetryable,
  httpJson,
  mediaBytes,
  needsReconnect,
  OutcomeError,
  oauthError,
  outcomeFromError,
  redact,
  testErrorDetail,
  testNetworkResult,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

// Official X API v2 only. Connecting is free; publishing is pay-per-post, so
// publish() is gated behind X_API_ENABLED and a hard monthly spend cap.
const AUTH = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';
const UPLOAD = 'https://upload.twitter.com/1.1/media/upload.json';
export const SCOPE = 'tweet.read tweet.write users.read media.write offline.access';

// Conservative per-post estimate in USD (text create ~0.015; media upload ~0.010).
const EST_POST_USD = 0.015;
const EST_MEDIA_USD = 0.01;
const DEFAULT_MONTHLY_CAP_USD = 5;

const secretsOf = (env: Env, token?: string): Secrets => [token, env.X_CLIENT_SECRET];

function basicAuth(env: Env): string {
  return `Basic ${btoa(`${env.X_CLIENT_ID ?? ''}:${env.X_CLIENT_SECRET ?? ''}`)}`;
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64url(bytes.buffer);
}

function periodYm(): string {
  return new Date().toISOString().slice(0, 7);
}

function mapApiError(resp: ProviderResponse, secrets: Secrets): never {
  if (resp.status === 401 || resp.status === 403) {
    throw needsReconnect(secrets, 'Your X connection expired. Reconnect X and retry.');
  }
  if (resp.status === 429) {
    throw failRetryable(secrets, 'RATE_LIMITED', 'X is temporarily rate limiting this account. Cotly will retry automatically.', resp.raw);
  }
  const detail = (resp.data as { detail?: unknown; title?: unknown } | null) ?? {};
  const message =
    (typeof detail.detail === 'string' && detail.detail) ||
    (typeof detail.title === 'string' && detail.title) ||
    'X rejected this request.';
  throw fail(secrets, `X_${resp.status}`, message, resp.raw);
}

export class XAdapter implements PlatformAdapter {
  readonly provider = 'x' as const;
  readonly capabilities = getCapabilities('x');

  // OAuth 2.0 Authorization Code with PKCE. The verifier is stored server-side
  // in oauth_states; only the S256 challenge travels in the URL.
  async buildAuthUrl(env: Env, redirectUri: string, state: string): Promise<{ url: string; verifier: string }> {
    if (!env.X_CLIENT_ID) {
      throw new Error('X sign-in is not configured. Set X_CLIENT_ID and X_CLIENT_SECRET first.');
    }
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);
    const url =
      `${AUTH}?response_type=code` +
      `&client_id=${encodeURIComponent(env.X_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPE)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${challenge}` +
      '&code_challenge_method=S256';
    return { url, verifier };
  }

  async handleCallback(env: Env, params: URLSearchParams, verifier?: string) {
    const secrets = secretsOf(env);
    oauthError(params, 'X');
    const code = params.get('code');
    if (!code) throw new Error('X did not return an authorization code. Try connecting again.');
    if (!verifier) throw new Error('That X sign-in attempt has expired. Connect X again.');
    const tok = await httpJson(TOKEN, {
      method: 'POST',
      headers: { authorization: basicAuth(env), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.APP_URL}/oauth/x/callback`,
        code_verifier: verifier,
      }),
    });
    const data = (tok.data ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (!tok.ok || typeof data.access_token !== 'string') {
      throw new Error('X rejected the connection attempt. Verify the app credentials and that the callback URL matches exactly.');
    }
    const accessToken = data.access_token;
    const me = await httpJson(`${API}/users/me?user.fields=profile_image_url`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) throw new Error('Cotly could not read your X profile. Confirm the app has users.read enabled.');
    const profile = ((me.data as { data?: { id?: unknown; name?: unknown; username?: unknown; profile_image_url?: unknown } | null }) ?? {}).data;
    if (!profile || typeof profile.id !== 'string') throw new Error('X did not return your account id. Try connecting again.');
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return {
      account: {
        externalId: profile.id,
        displayName: typeof profile.name === 'string' && profile.name ? profile.name : String(profile.username ?? 'X user'),
        avatarUrl: typeof profile.profile_image_url === 'string' ? profile.profile_image_url : undefined,
      },
      tokens: {
        accessToken,
        ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      },
      scopes: SCOPE,
    };
  }

  // X rotates the refresh token on every refresh — the caller must persist
  // the returned pair or the connection dies after two hours.
  async refresh(env: Env, tokens: { refreshToken?: string }): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
    if (!tokens.refreshToken) throw needsReconnect(secretsOf(env), 'Your X connection expired. Reconnect X and retry.');
    const tok = await httpJson(TOKEN, {
      method: 'POST',
      headers: { authorization: basicAuth(env), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
    });
    const data = (tok.data ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (!tok.ok || typeof data.access_token !== 'string') {
      throw needsReconnect(secretsOf(env), 'Your X connection expired. Reconnect X and retry.');
    }
    const expiresAt = typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : undefined;
    return {
      accessToken: data.access_token,
      ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  // Free read — identifies the account without spending from the post budget.
  async testConnection(env: Env, account: SocialAccountRecord): Promise<TestConnectionResult> {
    const secrets = secretsOf(env, account.accessToken);
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${API}/users/me`, { headers: { authorization: `Bearer ${account.accessToken}` } });
    } catch (e) {
      return testNetworkResult(e, 'X') ?? { ok: false, detail: 'X connection test failed unexpectedly. Try again.' };
    }
    if (resp.ok) {
      const profile = ((resp.data as { data?: { username?: unknown; name?: unknown } | null }) ?? {}).data;
      const handle = typeof profile?.username === 'string' && profile.username ? `@${profile.username}` : account.displayName;
      return { ok: true, detail: `Token valid — identity ${redact(handle, secrets)}.` };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, detail: 'Your X connection expired. Reconnect X.' };
    }
    const detail = (resp.data as { detail?: unknown } | null)?.detail;
    return { ok: false, detail: testErrorDetail(typeof detail === 'string' ? detail : '', secrets, 'X') };
  }

  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(env, input.account.accessToken);
    try {
      if (env.X_API_ENABLED !== 'true') {
        throw fail(secrets, 'X_API_DISABLED', 'X publishing is switched off. X charges per post, so Cotly only publishes when X_API_ENABLED is on.');
      }
      await this.assertWithinBudget(env);

      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      const videos = input.media.filter((m) => m.mime.startsWith('video/'));
      if (videos.length > 1 || (videos.length > 0 && images.length > 0)) {
        throw fail(secrets, 'TOO_MANY_MEDIA', 'X accepts one video or up to four images per post — not a mix. Adjust the attachments and retry.');
      }
      const mediaIds: string[] = [];
      if (videos.length === 1) {
        mediaIds.push(await this.uploadMedia(env, videos[0]!, secrets, true));
      }
      for (const image of images) {
        mediaIds.push(await this.uploadMedia(env, image, secrets, false));
      }

      const body: Record<string, unknown> = { text: input.caption };
      if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
      const resp = await httpJson(`${API}/tweets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secrets[0] ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) mapApiError(resp, secrets);
      const created = (resp.data as { data?: { id?: unknown } | null })?.data;
      if (!created || typeof created.id !== 'string') {
        throw fail(secrets, 'NO_POST_ID', 'X did not return a post id for the published content.', resp.raw);
      }
      await this.recordUsage(env, images.length + videos.length);
      return { kind: 'confirmed', externalId: created.id, ...(resp.raw ? { raw: resp.raw } : {}) };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  // Hard monthly cap: once estimated spend reaches X_MAX_MONTHLY_SPEND_USD,
  // further X publishes fail permanently until the month rolls over. The
  // queue itself is untouched — other platforms keep publishing.
  private async assertWithinBudget(env: Env): Promise<void> {
    try {
      const row = await env.DB.prepare('SELECT est_cost_usd FROM platform_usage WHERE provider = ? AND period_ym = ?')
        .bind('x', periodYm())
        .first<{ est_cost_usd: number }>();
      const cap = Number(env.X_MAX_MONTHLY_SPEND_USD ?? String(DEFAULT_MONTHLY_CAP_USD));
      if (row && Number(row.est_cost_usd) >= cap) {
        throw fail(
          secretsOf(env),
          'X_BUDGET_EXCEEDED',
          `The X budget cap ($${cap.toFixed(2)} this month) is reached, so Cotly stopped X publishing. Raise X_MAX_MONTHLY_SPEND_USD to continue.`,
        );
      }
    } catch (e) {
      // The budget block must escape; only bookkeeping failures are swallowed.
      if (e instanceof OutcomeError && e.outcome.kind === 'failed' && e.outcome.errorCode === 'X_BUDGET_EXCEEDED') throw e;
    }
  }

  private async recordUsage(env: Env, mediaCount: number): Promise<void> {
    const cost = EST_POST_USD + mediaCount * EST_MEDIA_USD;
    try {
      await env.DB.prepare(
        `INSERT INTO platform_usage (provider, period_ym, writes, est_cost_usd) VALUES ('x', ?, 1, ?)
         ON CONFLICT(provider, period_ym) DO UPDATE SET writes = writes + 1, est_cost_usd = platform_usage.est_cost_usd + excluded.est_cost_usd`,
      )
        .bind(periodYm(), cost)
        .run();
    } catch {
      // Bookkeeping must never fail an already-successful publish.
    }
  }

  // v1.1 INIT -> APPEND (chunked) -> FINALIZE with the user token. Videos are
  // uploaded with the tweet_video category and processed asynchronously — the
  // STATUS endpoint is polled briefly, and a still-processing job becomes a
  // retryable failure so the ladder retries without duplicating the post.
  private async uploadMedia(env: Env, media: MediaRecord, secrets: Secrets, isVideo: boolean): Promise<string> {
    const bytes = await mediaBytes(env, media);
    const category = isVideo ? 'tweet_video' : 'tweet_image';
    const init = await httpJson(
      `${UPLOAD}?command=INIT&total_bytes=${bytes.byteLength}&media_type=${encodeURIComponent(media.mime)}&media_category=${category}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      },
    );
    if (!init.ok) mapApiError(init, secrets);
    const mediaId = (init.data as { media_id_string?: unknown } | null)?.media_id_string;
    if (typeof mediaId !== 'string' || !mediaId) {
      throw fail(secrets, 'UPLOAD_INIT_FAILED', 'X did not provide an upload location for the media.', init.raw);
    }
    // APPEND accepts up to 5 MB per segment.
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0, seg = 0; i < bytes.byteLength; i += CHUNK, seg++) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
      const append = await httpJson(`${UPLOAD}?command=APPEND&media_id=${encodeURIComponent(mediaId)}&segment_index=${seg}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secrets[0] ?? ''}`, 'content-type': 'application/octet-stream' },
        body: chunk,
      });
      if (!append.ok) {
        throw failRetryable(
          secrets,
          'MEDIA_UPLOAD_FAILED',
          'Cotly could not upload the media to X. Cotly will retry automatically.',
          append.raw,
        );
      }
    }
    const finalize = await httpJson(`${UPLOAD}?command=FINALIZE&media_id=${encodeURIComponent(mediaId)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
    });
    if (!finalize.ok) mapApiError(finalize, secrets);
    const processing = (finalize.data as { processing_info?: { state?: unknown; check_after_secs?: unknown } } | null)?.processing_info;
    if (processing) {
      await this.awaitProcessing(mediaId, processing, secrets);
    }
    return mediaId;
  }

  // Poll STATUS until succeeded (bounded within this request); a failure or a
  // timeout becomes a retryable outcome so nothing is published half-baked.
  private async awaitProcessing(
    mediaId: string,
    info: { state?: unknown; check_after_secs?: unknown },
    secrets: Secrets,
  ): Promise<void> {
    const stateOf = (i: { state?: unknown }) => (typeof i.state === 'string' ? i.state : 'pending');
    let state = stateOf(info);
    let wait = typeof info.check_after_secs === 'number' ? Math.min(info.check_after_secs, 10) : 5;
    const deadline = Date.now() + 90_000;
    while (state !== 'succeeded' && Date.now() < deadline) {
      if (state === 'failed') {
        throw failRetryable(secrets, 'MEDIA_PROCESSING', 'X could not process this media. Cotly will retry automatically.');
      }
      await new Promise((r) => setTimeout(r, wait * 1000));
      const status = await httpJson(`${UPLOAD}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
      if (!status.ok) {
        throw failRetryable(secrets, 'MEDIA_PROCESSING', 'Cotly could not check the media processing state on X. Cotly will retry automatically.', status.raw);
      }
      const next = (status.data as { processing_info?: { state?: unknown; check_after_secs?: unknown } } | null)?.processing_info;
      if (!next) break;
      state = stateOf(next);
      wait = typeof next.check_after_secs === 'number' ? Math.min(next.check_after_secs, 10) : 5;
    }
    if (state !== 'succeeded') {
      throw failRetryable(secrets, 'MEDIA_PROCESSING', 'This media is still processing on X. Cotly will retry shortly.');
    }
  }
}
