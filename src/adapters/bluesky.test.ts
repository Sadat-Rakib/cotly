import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { BlueskyAdapter } from './bluesky';

const ACCESS = 'BSKY_ACCESS_JWT_VERY_SECRET_123';
const REFRESH = 'BSKY_REFRESH_JWT_VERY_SECRET_456';
const env = {
  MEDIA: {
    get: async () => ({ arrayBuffer: async () => new Uint8Array([9, 9, 9, 9]).buffer }),
  },
} as unknown as Env;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(handlers: Handler[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    const h = handlers.shift();
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    return h(url, init);
  });
  return calls;
}

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = (exp: number) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ exp })}.sig`;

const account = (): SocialAccountRecord =>
  ({
    id: 'acc1',
    provider: 'bluesky',
    externalId: 'did:plc:abc123',
    displayName: 'tester.bsky.social',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    meta: {},
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello bluesky',
  media: [],
  idempotencyKey: 't1:1',
  scheduledAt: 1_000,
  ...over,
});

const media = (over: Partial<MediaRecord> = {}): MediaRecord => ({
  id: 'm1',
  mime: 'image/png',
  size: 4,
  r2Key: 'media/a/img.png',
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('bluesky adapter', () => {
  it('connects with an app password and derives token expiry from the JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    stubFetch([
      () => jsonRes(200, { did: 'did:plc:abc123', handle: 'tester.bsky.social', accessJwt: makeJwt(exp), refreshJwt: REFRESH, active: true }),
    ]);
    const cb = await new BlueskyAdapter().connectDirect(env, { handle: '@tester.bsky.social', appPassword: 'hunter2-secret' });
    expect(cb.account).toEqual({ externalId: 'did:plc:abc123', displayName: 'tester.bsky.social' });
    expect(cb.tokens).toEqual({ accessToken: makeJwt(exp), refreshToken: REFRESH, expiresAt: exp });
    expect(cb.scopes).toBe('app-password');
  });

  it('rejects bad app-password credentials without echoing the password', async () => {
    stubFetch([() => jsonRes(401, { error: 'AuthenticationRequired' })]);
    await expect(new BlueskyAdapter().connectDirect(env, { handle: 'tester.bsky.social', appPassword: 'hunter2-secret' })).rejects.toThrow(
      /app password/i,
    );
    try {
      await new BlueskyAdapter().connectDirect(env, { handle: 'tester.bsky.social', appPassword: 'hunter2-secret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('hunter2-secret');
    }
  });

  it('publishes text posts with a permalink derived from the uri', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { uri: 'at://did:plc:abc123/app.bsky.feed.post/3k999', cid: 'cid1' }),
    ]);
    const out = await new BlueskyAdapter().publish(env, input());
    expect(out).toEqual({
      kind: 'confirmed',
      externalId: 'at://did:plc:abc123/app.bsky.feed.post/3k999',
      permalink: 'https://bsky.app/profile/did:plc:abc123/post/3k999',
      raw: '{"uri":"at://did:plc:abc123/app.bsky.feed.post/3k999","cid":"cid1"}',
    });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.repo).toBe('did:plc:abc123');
    expect(body.collection).toBe('app.bsky.feed.post');
    expect(body.record.text).toBe('Hello bluesky');
    expect(body.record.createdAt).toBeTruthy();
  });

  it('uploads image blobs and embeds them', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { blob: { $type: 'blob', ref: { $link: 'cid-img' }, mimeType: 'image/png', size: 4 } }),
      () => jsonRes(200, { uri: 'at://did:plc:abc123/app.bsky.feed.post/3k000', cid: 'cid2' }),
    ]);
    const out = await new BlueskyAdapter().publish(env, input({ media: [media()] }));
    expect(out.kind).toBe('confirmed');
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.record.embed.$type).toBe('app.bsky.embed.images');
    expect(body.record.embed.images[0].image.ref.$link).toBe('cid-img');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('image/png');
  });

  it('refreshes the session once on auth failure and retries', async () => {
    const calls = stubFetch([
      () => jsonRes(401, { error: 'InvalidToken' }),
      () => jsonRes(200, { accessJwt: makeJwt(9999999999), refreshJwt: REFRESH }),
      () => jsonRes(200, { uri: 'at://did:plc:abc123/app.bsky.feed.post/3k001', cid: 'cid3' }),
    ]);
    const out = await new BlueskyAdapter().publish(env, input());
    expect(out.kind).toBe('confirmed');
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe(`Bearer ${REFRESH}`);
    expect(new Headers(calls[2]?.init?.headers).get('Authorization')).toBe(`Bearer ${makeJwt(9999999999)}`);
  });

  it('returns needs_reconnect when the retry also fails auth', async () => {
    stubFetch([
      () => jsonRes(401, { error: 'InvalidToken' }),
      () => jsonRes(200, { accessJwt: 'BSKY_NEW_JWT_STILL_BAD_999', refreshJwt: REFRESH }),
      () => jsonRes(401, { error: 'InvalidToken' }),
    ]);
    const out = await new BlueskyAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'needs_reconnect' });
    expect(JSON.stringify(out)).toContain('Reconnect Bluesky');
    expect(JSON.stringify(out)).not.toContain(ACCESS);
    expect(JSON.stringify(out)).not.toContain('BSKY_NEW_JWT_STILL_BAD_999');
  });

  it('rejects oversized captions and video without calling the provider', async () => {
    const calls = stubFetch([]);
    const long = await new BlueskyAdapter().publish(env, input({ caption: 'x'.repeat(301) }));
    expect(long).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'CAPTION_TOO_LONG' });
    const video = await new BlueskyAdapter().publish(env, input({ media: [media({ mime: 'video/mp4', r2Key: 'media/a/v.mp4' })] }));
    expect(video).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'VIDEO_UNSUPPORTED' });
    expect(calls).toHaveLength(0);
  });

  it('maps 429 to a retryable failure and timeouts to ETIMEDOUT', async () => {
    stubFetch([() => new Response('slow', { status: 429 })]);
    const limited = await new BlueskyAdapter().publish(env, input());
    expect(limited).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'RATE_LIMITED' });

    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const timedOut = await new BlueskyAdapter().publish(env, input());
    expect(timedOut).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT' });
  });

  it('refresh() exchanges the refresh token for a new pair', async () => {
    const calls = stubFetch([() => jsonRes(200, { accessJwt: makeJwt(8888888888), refreshJwt: REFRESH })]);
    const tokens = await new BlueskyAdapter().refresh(env, { accessToken: ACCESS, refreshToken: REFRESH });
    expect(tokens).toEqual({ accessToken: makeJwt(8888888888), refreshToken: REFRESH, expiresAt: 8888888888 });
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe(`Bearer ${REFRESH}`);
  });
});
