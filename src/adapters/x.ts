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
  oauthCallbackBase,
  oauthError,
  outcomeFromError,
  redact,
  testErrorDetail,
  testNetworkResult,
  truncate,
  type ProviderResponse,
  type Secrets,
  type TestConnectionResult,
} from './_shared';

// Official X API v2 only. Connecting is free; publishing is pay-per-post, so
// publish() is gated behind X_API_ENABLED and a hard monthly spend cap.
const AUTH = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';
const MEDIA = 'https://api.x.com/2/media/upload';
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

// 401 always means the token is dead. 403 from X usually means something
// else (free-tier write limits, duplicate content, forbidden) — only treat it
// as auth failure when the body proves the token invalid/expired. Anything
// else must NEVER flip the account to needs_reconnect (reconnect loop).
function isTokenError(resp: ProviderResponse): boolean {
  const data = (resp.data ?? {}) as { detail?: unknown; title?: unknown; error?: unknown; errors?: Array<{ code?: unknown; message?: unknown }> };
  const texts = [
    typeof data.detail === 'string' ? data.detail : '',
    typeof data.title === 'string' ? data.title : '',
    typeof data.error === 'string' ? data.error : '',
    ...((Array.isArray(data.errors) ? data.errors : []).flatMap((e) => [
      typeof e?.message === 'string' ? (e.message as string) : '',
      typeof e?.code === 'number' || typeof e?.code === 'string' ? String(e.code) : '',
    ])),
  ].join(' ').toLowerCase();
  if (/invalid or expired token|could not authenticate|invalid.*token|expired.*token|unauthorized|authenticate/i.test(texts)) return true;
  const codes = (Array.isArray(data.errors) ? data.errors : []).map((e) => Number(e?.code)).filter((n) => Number.isFinite(n));
  return codes.some((c) => c === 32 || c === 89 || c === 99);
}

// Publish stages in order: the tweet is created only after media processing
// reports succeeded, so a failure always names the exact failing stage.
export type XStage = 'precheck' | 'media_init' | 'media_append' | 'media_finalize' | 'media_status' | 'create_post';

interface XErrorFields {
  title: string;
  detail: string;
  type: string;
}

function xErrorFields(resp: ProviderResponse): XErrorFields {
  const data = (resp.data ?? {}) as { detail?: unknown; title?: unknown; type?: unknown; errors?: Array<{ message?: unknown }> };
  const fromErrors = (Array.isArray(data.errors) ? data.errors : [])
    .map((e) => (typeof e?.message === 'string' ? e.message : ''))
    .filter(Boolean)
    .join(' | ');
  return {
    title: typeof data.title === 'string' ? data.title : '',
    detail: (typeof data.detail === 'string' && data.detail ? data.detail : fromErrors) || '',
    type: typeof data.type === 'string' ? data.type : '',
  };
}

// Edge request/transaction id when the API returns one. Header names only —
// auth headers are never read or logged.
function xRequestId(resp: ProviderResponse): string {
  let id = '';
  try {
    resp.headers.forEach((v, k) => {
      if (!id && /request|transaction/i.test(k)) id = v;
    });
  } catch {
    // headers are always present in practice
  }
  return id.slice(0, 120);
}

// Single sanitized diagnostics point for every X provider failure. Logs stage,
// HTTP status, X title/type/detail and the edge request id (tokens redacted),
// and returns a short tag appended to the user-facing message so the exact
// failing stage is visible in the Queue + diagnostics without a log dive.
function xFailureTag(secrets: Secrets, stage: XStage, resp: ProviderResponse): string {
  const f = xErrorFields(resp);
  const reqId = xRequestId(resp);
  console.log(
    `[x-publish] stage=${stage} http=${resp.status}` +
      (f.title ? ` title=${redact(f.title, secrets)}` : '') +
      (f.type ? ` type=${redact(f.type, secrets)}` : '') +
      (f.detail ? ` detail=${truncate(redact(f.detail, secrets), 200)}` : '') +
      (reqId ? ` reqId=${reqId}` : ''),
  );
  return `[stage=${stage} http=${resp.status}${reqId ? ` ref=${reqId}` : ''}]`;
}

function mapApiError(resp: ProviderResponse, secrets: Secrets, stage: XStage): never {
  if (resp.status === 401 || (resp.status === 403 && isTokenError(resp))) {
    throw needsReconnect(secrets, 'Your X connection expired. Reconnect X and retry.');
  }
  const tag = xFailureTag(secrets, stage, resp);
  if (resp.status === 429) {
    throw failRetryable(secrets, 'RATE_LIMITED', `X is temporarily rate limiting this account. Cotly will retry automatically. ${tag}`, resp.raw);
  }
  const f = xErrorFields(resp);
  const message = f.detail || f.title || 'X rejected this request.';
  throw fail(secrets, `X_${resp.status}`, `${message} ${tag}`, resp.raw);
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
        redirect_uri: `${oauthCallbackBase(env)}/oauth/x/callback`,
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

  // Best-effort revocation of the access + refresh tokens at X.
  async revoke(env: Env, account: SocialAccountRecord): Promise<void> {
    try {
      await httpJson('https://api.x.com/2/oauth2/revoke', {
        method: 'POST',
        headers: { authorization: basicAuth(env), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: account.accessToken }),
      });
    } catch {
      // revocation is best-effort; Cotly deletes its credentials regardless
    }
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
    if (resp.status === 401 || (resp.status === 403 && isTokenError(resp))) {
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
      if (!resp.ok) mapApiError(resp, secrets, 'create_post');
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

  // Base64 without blowing the call stack on multi-MB buffers.
  private static bytesToBase64(bytes: Uint8Array): string {
    let s = '';
    const STEP = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += STEP) {
      s += String.fromCharCode(...bytes.subarray(i, Math.min(i + STEP, bytes.byteLength)));
    }
    return btoa(s);
  }

  // Official X API v2 media upload with the OAuth2 user token (media.write):
  // images go through the simple upload in one call; videos use chunked
  // initialize -> append segments -> finalize, then STATUS is polled briefly.
  // A still-processing job becomes a retryable failure so the ladder retries
  // without duplicating the post. The tweet is created only after media
  // processing reports succeeded.
  private async uploadMedia(env: Env, media: MediaRecord, secrets: Secrets, isVideo: boolean): Promise<string> {
    const bytes = await mediaBytes(env, media);
    const auth = { authorization: `Bearer ${secrets[0] ?? ''}` };
    if (!isVideo) {
      const category = media.mime === 'image/gif' ? 'tweet_gif' : 'tweet_image';
      const simple = await httpJson(`${MEDIA}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ media_category: category, media: XAdapter.bytesToBase64(bytes) }),
      });
      if (!simple.ok) mapApiError(simple, secrets, 'media_init');
      const id = ((simple.data as { data?: { id?: unknown } | null }) ?? {}).data?.id;
      if (typeof id !== 'string' || !id) {
        throw fail(secrets, 'UPLOAD_INIT_FAILED', 'X did not return a media id for the uploaded image.', simple.raw);
      }
      return id;
    }
    const init = await httpJson(`${MEDIA}/initialize`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ media_category: 'tweet_video', media_type: media.mime, total_bytes: bytes.byteLength }),
    });
    if (!init.ok) mapApiError(init, secrets, 'media_init');
    const mediaId = ((init.data as { data?: { id?: unknown } | null }) ?? {}).data?.id;
    if (typeof mediaId !== 'string' || !mediaId) {
      throw fail(secrets, 'UPLOAD_INIT_FAILED', 'X did not provide an upload location for the media.', init.raw);
    }
    // APPEND accepts up to 5 MB per segment (base64-encoded JSON chunks here).
    const CHUNK = 4 * 1024 * 1024;
    for (let i = 0, seg = 0; i < bytes.byteLength; i += CHUNK, seg++) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
      const append = await httpJson(`${MEDIA}/${encodeURIComponent(mediaId)}/append`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ media: XAdapter.bytesToBase64(chunk), segment_index: seg }),
      });
      if (!append.ok) {
        const tag = xFailureTag(secrets, 'media_append', append);
        throw failRetryable(
          secrets,
          'MEDIA_UPLOAD_FAILED',
          `Cotly could not upload the media to X. Cotly will retry automatically. ${tag}`,
          append.raw,
        );
      }
    }
    const finalize = await httpJson(`${MEDIA}/${encodeURIComponent(mediaId)}/finalize`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!finalize.ok) mapApiError(finalize, secrets, 'media_finalize');
    const processing = (finalize.data as { data?: { processing_info?: { state?: unknown; check_after_secs?: unknown } } | null })?.data?.processing_info;
    if (processing) {
      await this.awaitProcessing(mediaId, processing, secrets);
    }
    return mediaId;
  }

  // Poll STATUS until succeeded with a tight in-request budget (Publish Now
  // must not block the HTTP request for over a minute); a failure or a
  // timeout becomes a retryable outcome so nothing is published half-baked
  // and the retry ladder resumes without duplicating the post.
  private async awaitProcessing(
    mediaId: string,
    info: { state?: unknown; check_after_secs?: unknown },
    secrets: Secrets,
  ): Promise<void> {
    const stateOf = (i: { state?: unknown }) => (typeof i.state === 'string' ? i.state : 'pending');
    let state = stateOf(info);
    let wait = typeof info.check_after_secs === 'number' ? Math.min(info.check_after_secs, 5) : 2;
    const deadline = Date.now() + 20_000;
    while (state !== 'succeeded' && Date.now() < deadline) {
      if (state === 'failed') {
        throw failRetryable(secrets, 'MEDIA_PROCESSING', 'X could not process this media. Cotly will retry automatically. [stage=media_status]');
      }
      await new Promise((r) => setTimeout(r, wait * 1000));
      const status = await httpJson(`${MEDIA}?media_id=${encodeURIComponent(mediaId)}&command=STATUS`, {
        method: 'GET',
        headers: { authorization: `Bearer ${secrets[0] ?? ''}` },
      });
      if (!status.ok) {
        const tag = xFailureTag(secrets, 'media_status', status);
        throw failRetryable(secrets, 'MEDIA_PROCESSING', `Cotly could not check the media processing state on X. Cotly will retry automatically. ${tag}`, status.raw);
      }
      const next = (status.data as { data?: { processing_info?: { state?: unknown; check_after_secs?: unknown } } | null })?.data?.processing_info;
      if (!next) break;
      state = stateOf(next);
      wait = typeof next.check_after_secs === 'number' ? Math.min(next.check_after_secs, 5) : 2;
    }
    if (state !== 'succeeded') {
      throw failRetryable(secrets, 'MEDIA_PROCESSING', 'This media is still processing on X. Cotly will retry shortly. [stage=media_status]');
    }
  }
}
