import { getCapabilities } from '../contracts/capabilities';
import type { Env } from '../contracts/env';
import type { AccountTokens, MediaRecord, PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../contracts/types';
import {
  fail,
  failRetryable,
  httpJson,
  mediaBytes,
  needsReconnect,
  outcomeFromError,
  type ProviderResponse,
  type Secrets,
} from './_shared';

const BASE = 'https://bsky.social';
const MAX_CHARS = 300;
const MAX_IMAGES = 4;

const secretsOf = (token: string, refreshToken?: string): Secrets => [token, refreshToken];

function mapXrpcError(resp: ProviderResponse, secrets: Secrets): never {
  if (resp.status === 401 || resp.status === 403) {
    throw needsReconnect(secrets, 'Your Bluesky session expired. Reconnect Bluesky and retry.');
  }
  if (resp.status === 429) {
    throw failRetryable(secrets, 'RATE_LIMITED', 'Bluesky is temporarily rate limiting this account. Cotly will retry automatically.', resp.raw);
  }
  const message =
    (typeof (resp.data as { message?: unknown } | null)?.message === 'string'
      ? String((resp.data as { message: string }).message)
      : '') || 'Bluesky rejected this request.';
  throw fail(secrets, `BSKY_${resp.status}`, message, resp.raw);
}

// App-password JWTs carry an exp claim; surface it so the engine can refresh ahead of publish.
function jwtExp(jwt: string): number | undefined {
  try {
    const b64 = jwt.split('.')[1] ?? '';
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

function isAuthFailure(resp: ProviderResponse): boolean {
  const err = (resp.data as { error?: unknown } | null)?.error;
  return resp.status === 401 || err === 'InvalidToken' || err === 'ExpiredToken' || err === 'AuthenticationRequired';
}

export class BlueskyAdapter implements PlatformAdapter {
  readonly provider = 'bluesky' as const;
  readonly capabilities = getCapabilities('bluesky');

  async connectDirect(env: Env, input: Record<string, string>) {
    const handle = (input.handle ?? '').trim().replace(/^@/, '');
    const appPassword = input.appPassword ?? '';
    if (!handle || !appPassword) throw new Error('Enter both your Bluesky handle and an app password.');
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${BASE}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
      });
    } catch {
      throw new Error('Cotly could not reach Bluesky. Try again in a moment.');
    }
    if (!resp.ok || typeof (resp.data as { accessJwt?: unknown } | null)?.accessJwt !== 'string') {
      throw new Error('Bluesky rejected this handle or app password. Create an app password at bsky.app/settings/app-passwords and try again.');
    }
    const data = resp.data as { did?: string; handle?: string; accessJwt: string; refreshJwt?: string };
    if (!data.did) throw new Error('Bluesky did not return an account id. Try connecting again.');
    return {
      account: { externalId: data.did, displayName: data.handle || handle },
      tokens: {
        accessToken: data.accessJwt,
        ...(data.refreshJwt ? { refreshToken: data.refreshJwt } : {}),
        ...(jwtExp(data.accessJwt) ? { expiresAt: jwtExp(data.accessJwt) } : {}),
      },
      scopes: 'app-password',
    };
  }

  async refresh(env: Env, tokens: AccountTokens): Promise<AccountTokens> {
    let resp: ProviderResponse;
    try {
      resp = await httpJson(`${BASE}/xrpc/com.atproto.server.refreshSession`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens.refreshToken ?? ''}` },
      });
    } catch {
      throw new Error('Cotly could not reach Bluesky to refresh the session. Cotly will retry.');
    }
    if (!resp.ok || typeof (resp.data as { accessJwt?: unknown } | null)?.accessJwt !== 'string') {
      throw new Error('Bluesky session expired. Reconnect Bluesky and retry.');
    }
    const data = resp.data as { accessJwt: string; refreshJwt?: string };
    return {
      accessToken: data.accessJwt,
      ...(data.refreshJwt ? { refreshToken: data.refreshJwt } : { ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}) }),
      ...(jwtExp(data.accessJwt) ? { expiresAt: jwtExp(data.accessJwt) } : {}),
    };
  }

  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const secrets = secretsOf(input.account.accessToken, input.account.refreshToken);
    try {
      if (input.caption.length > MAX_CHARS) {
        throw fail(secrets, 'CAPTION_TOO_LONG', `Bluesky posts are limited to ${MAX_CHARS} characters. Shorten the post and retry.`);
      }
      const images = input.media.filter((m) => m.mime.startsWith('image/'));
      if (input.media.some((m) => m.mime.startsWith('video/'))) {
        throw fail(secrets, 'VIDEO_UNSUPPORTED', 'Bluesky does not support video posts from Cotly yet. Publish without the video.');
      }
      if (images.length > MAX_IMAGES) {
        throw fail(secrets, 'TOO_MANY_IMAGES', `Bluesky posts support at most ${MAX_IMAGES} images. Remove the extras and retry.`);
      }
      const did = input.account.externalId;
      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: input.caption,
        createdAt: new Date().toISOString(),
      };
      if (images.length > 0) record.embed = await this.uploadImages(env, input.account, images);

      let token = input.account.accessToken;
      let resp = await this.createRecord(did, token, record);
      if (isAuthFailure(resp) && input.account.refreshToken) {
        // Engine normally refreshes ahead of publish; this is the in-flight fallback.
        token = (await this.refresh(env, { accessToken: input.account.accessToken, refreshToken: input.account.refreshToken })).accessToken;
        resp = await this.createRecord(did, token, record);
        if (isAuthFailure(resp)) {
          throw needsReconnect(secretsOf(token, input.account.refreshToken), 'Your Bluesky session expired. Reconnect Bluesky and retry.');
        }
      }
      if (!resp.ok) mapXrpcError(resp, secrets);
      const uri = (resp.data as { uri?: unknown } | null)?.uri;
      if (typeof uri !== 'string' || !uri) throw fail(secrets, 'NO_POST_ID', 'Bluesky did not return a post uri.', resp.raw);
      const rkey = uri.split('/').pop() ?? '';
      return {
        kind: 'confirmed',
        externalId: uri,
        permalink: `https://bsky.app/profile/${did}/post/${rkey}`,
        ...(resp.raw ? { raw: resp.raw } : {}),
      };
    } catch (e) {
      return outcomeFromError(e);
    }
  }

  private createRecord(did: string, token: string, record: unknown): Promise<ProviderResponse> {
    return httpJson(`${BASE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
    });
  }

  private async uploadImages(env: Env, account: SocialAccountRecord, images: MediaRecord[]) {
    const out: Array<{ alt: string; image: Record<string, unknown> }> = [];
    for (const m of images) {
      const bytes = await mediaBytes(env, m);
      const secrets = secretsOf(account.accessToken, account.refreshToken);
      const resp = await httpJson(`${BASE}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: { authorization: `Bearer ${account.accessToken}`, 'content-type': m.mime },
        body: bytes,
      });
      if (!resp.ok) mapXrpcError(resp, secrets);
      const blob = (resp.data as { blob?: Record<string, unknown> | null } | null)?.blob;
      if (!blob) throw fail(secrets, 'BLOB_UPLOAD_FAILED', 'Bluesky did not accept the image upload.', resp.raw);
      // Older XRPC responses return {cid,...}; normalize both shapes to a blob object.
      const image =
        blob.$type === 'blob'
          ? blob
          : { $type: 'blob', ref: { $link: blob.cid }, mimeType: blob.mimeType, size: blob.size };
      out.push({ alt: '', image });
    }
    return { $type: 'app.bsky.embed.images', images: out };
  }
}
