import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { ThreadsAdapter } from './threads';

const TOKEN = 'THREADS_TOKEN_VERY_SECRET_123';
const env = {
  APP_URL: 'http://localhost:8787',
  THREADS_CLIENT_ID: 'threads-client-id',
  THREADS_CLIENT_SECRET: 'threads-client-secret-very-secret',
  R2_ACCOUNT_ID: 'r2account',
  R2_ACCESS_KEY_ID: 'r2accesskey',
  R2_SECRET_ACCESS_KEY: 'r2secretaccesskeysecret',
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

const account = (): SocialAccountRecord =>
  ({
    id: 'acc1',
    provider: 'threads',
    externalId: 'th-user-1',
    displayName: 'tester',
    accessToken: TOKEN,
    meta: {},
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello threads',
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

describe('threads adapter', () => {
  it('verifies a Meta signed_request and rejects a tampered one', async () => {
    const { parseSignedRequest } = await import('./_shared');
    const SECRET = 'threads-app-secret-very-secret';
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'th-987' })).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(await parseSignedRequest(`${sig}.${payload}`, SECRET)).toBe('th-987');
    const bad = createHmac('sha256', 'wrong-secret').update(payload).digest('base64url');
    expect(await parseSignedRequest(`${bad}.${payload}`, SECRET)).toBeNull();
    expect(await parseSignedRequest(`${sig.slice(0, -2)}x.${payload}`, SECRET)).toBeNull();
  });

  it('builds the OAuth URL and completes the callback', async () => {
    const adapter = new ThreadsAdapter();
    const { url } = await adapter.buildAuthUrl(env, 'http://localhost:8787/oauth/threads/callback', 'st9');
    expect(url).toContain('https://threads.net/oauth/authorize?');
    expect(decodeURIComponent(url)).toContain('scope=threads_basic,threads_content_publish');
    expect(url).toContain('state=st9');

    const calls = stubFetch([
      () => jsonRes(200, { access_token: 'short_token' }),
      () => jsonRes(200, { access_token: TOKEN, expires_in: 5184000 }),
      () => jsonRes(200, { id: 'th-user-1', username: 'tester', name: 'Test Er', threads_profile_picture_url: 'https://img/t.png', threads_biography: 'hi' }),
    ]);
    const cb = await adapter.handleCallback(env, new URLSearchParams('code=abc'));
    expect(cb.account).toEqual({
      externalId: 'th-user-1',
      displayName: 'Test Er',
      avatarUrl: 'https://img/t.png',
      meta: { handle: 'tester', biography: 'hi' },
    });
    expect(cb.tokens.accessToken).toBe(TOKEN);
    expect(cb.tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(calls[0]?.url).toContain('graph.threads.net/oauth/access_token');
    // Documented exchange: unversioned /access_token with th_exchange_token and
    // the app secret — no client_id, no /v1.0 prefix.
    expect(calls[1]?.url).toContain('graph.threads.net/access_token?grant_type=th_exchange_token');
    expect(decodeURIComponent(calls[1]?.url ?? '')).toContain('client_secret=');
    expect(calls[1]?.url).not.toContain('client_id=');
    expect(calls[2]?.url).toContain('graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url,threads_biography');
  });

  it('renews via th_refresh_token when the stored token is already long-lived', async () => {
    const calls = stubFetch([
      () => jsonRes(400, { error: { message: 'token is not short-lived' } }),
      () => jsonRes(200, { access_token: 'renewed-token', expires_in: 5184000 }),
    ]);
    const next = await new ThreadsAdapter().refresh(env, { accessToken: TOKEN });
    expect(next.accessToken).toBe('renewed-token');
    expect(next.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(calls[0]?.url).toContain('graph.threads.net/access_token?grant_type=th_exchange_token');
    expect(calls[1]?.url).toContain('refresh_access_token?grant_type=th_refresh_token');
  });

  it('exchanges a stored short-lived token during refresh instead of refreshing', async () => {
    const calls = stubFetch([() => jsonRes(200, { access_token: 'long-token', expires_in: 5184000 })]);
    const next = await new ThreadsAdapter().refresh(env, { accessToken: 'short_token' });
    expect(next.accessToken).toBe('long-token');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('grant_type=th_exchange_token');
  });

  it('falls back to the short-lived token when the long-lived exchange fails', async () => {
    stubFetch([
      () => jsonRes(200, { access_token: TOKEN }),
      () => jsonRes(400, { error: { message: 'exchange unavailable' } }),
      () => jsonRes(200, { id: 'th-user-1', username: 'tester' }),
    ]);
    const cb = await new ThreadsAdapter().handleCallback(env, new URLSearchParams('code=abc'));
    expect(cb.tokens.accessToken).toBe(TOKEN);
    // A failed exchange must still mark the short-lived 1h expiry so the
    // engine knows refresh/reconnect is required instead of silently sitting
    // on a token that dies within the hour.
    expect(cb.tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3500);
  });

  it('publishes text: container then publish, returns pending with the published id', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'ct_1' }), () => jsonRes(200, { id: 'th_media_1' })]);
    const out = await new ThreadsAdapter().publish(env, input());
    expect(out.kind).toBe('pending');
    // The published media id (not the container id) is the pending externalId.
    expect((out as { externalId: string }).externalId).toBe('th_media_1');
    expect(calls[0]?.url).toContain('/th-user-1/threads?media_type=TEXT');
    // Container params ride in the query string, mirroring Meta's documented form.
    expect(decodeURIComponent(String(calls[0]?.url))).toContain('media_type=TEXT');
    expect(decodeURIComponent(String(calls[1]?.url))).toContain('threads_publish?creation_id=ct_1');
  });

  it('publishes a single image via a presigned image_url container', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'ct_2' }), () => jsonRes(200, { id: 'th_media_2' })]);
    const out = await new ThreadsAdapter().publish(env, input({ media: [media()] }));
    expect(out.kind).toBe('pending');
    expect(decodeURIComponent(String(calls[0]?.url))).toContain('threads?media_type=IMAGE');
    expect(decodeURIComponent(String(calls[0]?.url))).toContain('image_url=https://r2account.r2.cloudflarestorage.com');
    expect(decodeURIComponent(String(calls[0]?.url))).toContain('X-Amz-Signature');
  });

  it('retries the processing race (error 24) and gives up retryable without publishing', async () => {
    vi.useFakeTimers();
    try {
      const calls = stubFetch([
        () => jsonRes(200, { id: 'ct_3' }),
        ...Array.from({ length: 10 }, () => () => jsonRes(400, { error: { code: 24, message: 'The requested resource does not exist' } })),
      ]);
      const pending = new ThreadsAdapter().publish(env, input());
      for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(3000);
      const out = await pending;
      expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'CONTAINER_PROCESSING' });
      // Exactly the 10 bounded publish attempts with the same creation_id —
      // retries can never duplicate the post (one creation_id publishes once).
      expect(calls.filter((c) => c.url.includes('threads_publish'))).toHaveLength(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects multiple media and oversized captions without calling the provider', async () => {
    const calls = stubFetch([]);
    const many = await new ThreadsAdapter().publish(env, input({ media: [media(), media({ id: 'm2', r2Key: 'media/b.png' })] }));
    expect(many).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'TOO_MANY_MEDIA' });
    const long = await new ThreadsAdapter().publish(env, input({ caption: 'x'.repeat(501) }));
    expect(long).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'CAPTION_TOO_LONG' });
    expect(calls).toHaveLength(0);
  });

  it('resolves pending posts: permalink confirms, missing permalink waits', async () => {
    const adapter = new ThreadsAdapter();
    stubFetch([() => jsonRes(200, { permalink: 'https://threads.net/@tester/post/1' })]);
    const done = await adapter.resolvePending(env, account(), 'th_media_1');
    expect(done).toMatchObject({ kind: 'confirmed', externalId: 'th_media_1', permalink: 'https://threads.net/@tester/post/1' });

    stubFetch([() => jsonRes(200, {})]);
    const waiting = await adapter.resolvePending(env, account(), 'th_media_1');
    expect(waiting).toEqual({ kind: 'pending', externalId: 'th_media_1' });
  });

  it('maps token errors to needs_reconnect and rate limits to retryable', async () => {
    // Every failed graph POST also runs the failure diagnostics (/me,
    // debug_token, two edge probes) — stub those so the real error mapping is
    // what gets exercised.
    const probeStubs = () => [
      () => jsonRes(200, { id: 'th-user-1', username: 'tester' }),
      () => jsonRes(400, { error: { message: 'debug unavailable' } }),
      () => jsonRes(400, { error: { code: 100, error_subcode: 33, message: 'Unsupported post request.' } }),
      () => jsonRes(400, { error: { code: 100, error_subcode: 33, message: 'Unsupported post request.' } }),
    ];
    stubFetch([() => jsonRes(400, { error: { code: 190, message: 'access token invalid' } }), ...probeStubs()]);
    const reconnect = await new ThreadsAdapter().publish(env, input());
    expect(reconnect.kind).toBe('needs_reconnect');
    expect(JSON.stringify(reconnect)).toContain('Reconnect Threads');
    expect(JSON.stringify(reconnect)).not.toContain(TOKEN);

    stubFetch([() => new Response('slow down', { status: 429 }), ...probeStubs()]);
    const limited = await new ThreadsAdapter().publish(env, input());
    expect(limited).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'RATE_LIMITED' });
  });

  it('maps timeouts to retryable ETIMEDOUT', async () => {
    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const out = await new ThreadsAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT' });
  });

  it('testConnection validates the token and reports the username', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'th-user-1', username: 'tester' })]);
    const res = await new ThreadsAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: true, detail: 'Token valid — identity tester.' });
    expect(calls[0]?.url).toContain('graph.threads.net/v1.0/me?fields=id,username');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(res.detail).not.toContain(TOKEN);
  });

  it('testConnection maps auth failures to a reconnect prompt without leaking the token', async () => {
    stubFetch([() => new Response('', { status: 401 })]);
    const res = await new ThreadsAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'Your Threads connection expired. Reconnect Threads.' });
    expect(res.detail).not.toContain(TOKEN);
  });

  it('testConnection maps timeouts to a try-again message', async () => {
    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const res = await new ThreadsAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'Threads did not respond in time. Try again.' });
  });
});
