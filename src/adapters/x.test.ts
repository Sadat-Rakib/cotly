import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { XAdapter } from './x';

const TOKEN = 'X_USER_TOKEN_VERY_SECRET_42';
const env = {
  APP_URL: 'http://localhost:8787',
  X_CLIENT_ID: 'x-client-id',
  X_CLIENT_SECRET: 'x-client-secret-very-secret',
  X_API_ENABLED: 'true',
  X_MAX_MONTHLY_SPEND_USD: '5',
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ est_cost_usd: 0 }),
        run: async () => ({}),
      }),
    }),
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

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const account = (): SocialAccountRecord =>
  ({
    id: 'acc1',
    provider: 'x',
    externalId: '9876543210',
    displayName: 'Mir',
    accessToken: TOKEN,
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello from Cotly',
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

// Minimal R2 stand-in: mediaBytes reads the object and returns its bytes.
const mediaEnv = (over: Partial<Env> = {}): Env =>
  ({
    ...env,
    MEDIA: {
      get: async (key: string) => ({
        // objectstore.objectGet wraps obj.body in a Response.
        body: new Response(new Uint8Array([1, 2, 3, 4]).buffer).body,
        key,
      }),
    },
    ...over,
  }) as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe('X adapter', () => {
  it('builds a PKCE authorize URL with the S256 challenge and scope', async () => {
    const auth = await new XAdapter().buildAuthUrl(env, 'http://localhost:8787/oauth/x/callback', 'st123');
    expect(auth.url).toContain('https://x.com/i/oauth2/authorize');
    expect(auth.url).toContain('client_id=x-client-id');
    expect(auth.url).toContain('code_challenge_method=S256');
    expect(auth.url).toContain('scope=tweet.read%20tweet.write%20users.read%20media.write%20offline.access');
    expect(auth.verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('connects the account: token exchange with Basic auth + PKCE verifier, then users/me', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { token_type: 'bearer', access_token: TOKEN, refresh_token: 'refresh-secret-1', expires_in: 7200 }),
      () => jsonRes(200, { data: { id: '9876543210', name: 'Mir', username: 'mirposting', profile_image_url: 'https://pbs.example/mir.jpg' } }),
    ]);
    const cb = await new XAdapter().handleCallback(env, new URLSearchParams('code=abc&state=st123'), 'verifier-43chars-minimum-aaaaaaaaaaaaaaaaaaaaa');
    expect(cb.account).toEqual({
      externalId: '9876543210',
      displayName: 'Mir',
      avatarUrl: 'https://pbs.example/mir.jpg',
    });
    expect(cb.tokens?.accessToken).toBe(TOKEN);
    expect(cb.tokens?.refreshToken).toBe('refresh-secret-1');
    expect(cb.tokens?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(cb.scopes).toContain('tweet.write');
    const tokenUrl = calls[0]?.url ?? '';
    expect(tokenUrl).toContain('https://api.x.com/2/oauth2/token');
    const authHeader = String((calls[0]?.init?.headers as Record<string, string>)?.['authorization'] ?? '');
    expect(authHeader.startsWith('Basic ')).toBe(true);
    const body = String(calls[0]?.init?.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code_verifier=verifier-43chars');
    expect(calls[1]?.url).toContain('https://api.x.com/2/users/me');
  });

  it('refuses to connect when X returns an OAuth error', async () => {
    stubFetch([]);
    await expect(
      new XAdapter().handleCallback(env, new URLSearchParams('error=access_denied&error_description=nope'), 'v'),
    ).rejects.toThrow(/nope/i);
  });

  it('publishes text only through the official endpoint when enabled', async () => {
    const calls = stubFetch([() => jsonRes(201, { data: { id: '1790123456789023', text: 'Hello from Cotly' } })]);
    const out = await new XAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'confirmed', externalId: '1790123456789023' });
    const req = calls[0];
    expect(req?.url).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(String(req?.init?.body)).text).toBe('Hello from Cotly');
  });

  it('does not publish while X_API_ENABLED is off', async () => {
    const calls = stubFetch([]);
    const out = await new XAdapter().publish(mediaEnv({ X_API_ENABLED: 'false' }), input());
    expect(out).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'X_API_DISABLED' });
    expect(calls.length).toBe(0);
  });

  it('blocks publishing once the monthly budget cap is reached', async () => {
    const cappedEnv = {
      ...env,
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ est_cost_usd: 5.0 }),
            run: async () => ({}),
          }),
        }),
      },
    } as unknown as Env;
    const calls = stubFetch([]);
    const out = await new XAdapter().publish(mediaEnv(cappedEnv as Partial<Env>), input());
    expect(out).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'X_BUDGET_EXCEEDED' });
    expect(calls.length).toBe(0);
  });

  it('uploads an image through the v2 simple upload and attaches the media id', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { data: { id: 'media-1', media_key: '3_media-1' } }),
      () => jsonRes(201, { data: { id: '1790999', text: 'with image' } }),
    ]);
    const out = await new XAdapter().publish(mediaEnv(), input({ media: [media({ size: 4, r2Key: 'k' })] }));
    expect(out).toMatchObject({ kind: 'confirmed', externalId: '1790999' });
    expect(calls[0]?.url).toBe('https://api.x.com/2/media/upload');
    const uploadBody = JSON.parse(String(calls[0]?.init?.body));
    expect(uploadBody.media_category).toBe('tweet_image');
    expect(typeof uploadBody.media).toBe('string');
    const tweetBody = JSON.parse(String(calls[1]?.init?.body));
    expect(tweetBody.media.media_ids).toEqual(['media-1']);
  });

  it('uploads a video through v2 chunked initialize/append/finalize, then posts', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { data: { id: 'vid-1' } }),
      () => jsonRes(200, { data: {} }),
      () => jsonRes(200, { data: { id: 'vid-1' } }),
      () => jsonRes(201, { data: { id: '1790888', text: 'with video' } }),
    ]);
    const out = await new XAdapter().publish(
      mediaEnv(),
      input({ media: [media({ mime: 'video/mp4', size: 8, r2Key: 'v' })] }),
    );
    expect(out).toMatchObject({ kind: 'confirmed', externalId: '1790888' });
    const urls = calls.map((c) => c.url);
    expect(urls[0]).toBe('https://api.x.com/2/media/upload/initialize');
    expect(urls[1]).toBe('https://api.x.com/2/media/upload/vid-1/append');
    expect(urls[2]).toBe('https://api.x.com/2/media/upload/vid-1/finalize');
    const initBody = JSON.parse(String(calls[0]?.init?.body));
    // The R2 stand-in always returns 4 bytes regardless of the recorded size.
    expect(initBody).toMatchObject({ media_category: 'tweet_video', media_type: 'video/mp4', total_bytes: 4 });
    const appendBody = JSON.parse(String(calls[1]?.init?.body));
    expect(appendBody.segment_index).toBe(0);
    expect(typeof appendBody.media).toBe('string');
    const tweetBody = JSON.parse(String(calls[3]?.init?.body));
    expect(tweetBody.media.media_ids).toEqual(['vid-1']);
  });

  it('polls v2 media status until processing succeeds before posting', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { data: { id: 'vid-2' } }),
      () => jsonRes(200, { data: {} }),
      () => jsonRes(200, { data: { id: 'vid-2', processing_info: { state: 'pending', check_after_secs: 0 } } }),
      () => jsonRes(200, { data: { id: 'vid-2', processing_info: { state: 'succeeded' } } }),
      () => jsonRes(201, { data: { id: '1790777', text: 'video ready' } }),
    ]);
    const out = await new XAdapter().publish(
      mediaEnv(),
      input({ media: [media({ mime: 'video/mp4', size: 8, r2Key: 'v' })] }),
    );
    expect(out).toMatchObject({ kind: 'confirmed', externalId: '1790777' });
    expect(calls[3]?.url).toContain('https://api.x.com/2/media/upload?media_id=vid-2&command=STATUS');
  });

  it('tests the connection with a free users/me read', async () => {
    stubFetch([() => jsonRes(200, { data: { id: '9876543210', username: 'mirposting' } })]);
    const res = await new XAdapter().testConnection(env, account());
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('@mirposting');
  });

  it('flags an expired token for reconnect', async () => {
    stubFetch([() => jsonRes(401, { title: 'Unauthorized' })]);
    const res = await new XAdapter().testConnection(env, account());
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/reconnect/i);
  });

  it('refreshes the token pair and returns the rotated refresh token', async () => {
    const calls = stubFetch([() => jsonRes(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 })]);
    const next = await new XAdapter().refresh(env, { refreshToken: 'old-refresh' });
    expect(next.accessToken).toBe('new-access');
    expect(next.refreshToken).toBe('new-refresh');
    const body = String(calls[0]?.init?.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-refresh');
  });
});
