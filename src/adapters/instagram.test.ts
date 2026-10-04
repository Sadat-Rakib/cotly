import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { InstagramAdapter } from './instagram';

const TOKEN = 'IG_TOKEN_VERY_SECRET_42';
const env = {
  APP_URL: 'http://localhost:8787',
  INSTAGRAM_CLIENT_ID: 'ig-client-id',
  INSTAGRAM_CLIENT_SECRET: 'ig-client-secret-very-secret',
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

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const account = (): SocialAccountRecord =>
  ({
    id: 'acc1',
    provider: 'instagram',
    externalId: '17840000000000',
    displayName: 'mirposts',
    accessToken: TOKEN,
    meta: { accountType: 'BUSINESS' },
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello Instagram',
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

describe('instagram adapter', () => {
  it('builds the authorize URL with the business scopes and completes the callback', async () => {
    const adapter = new InstagramAdapter();
    const { url } = await adapter.buildAuthUrl(env, 'http://localhost:8787/oauth/instagram/callback', 'st7');
    expect(url).toContain('https://www.instagram.com/oauth/authorize');
    expect(url).toContain('client_id=ig-client-id');
    expect(decodeURIComponent(url)).toContain('scope=instagram_business_basic,instagram_business_content_publish');
    expect(url).toContain('state=st7');

    const calls = stubFetch([
      () => jsonRes(200, { access_token: 'short', user_id: '1784' }),
      () => jsonRes(200, { access_token: TOKEN, token_type: 'bearer', expires_in: 5184000 }),
      () => jsonRes(200, { id: '17840000000000', user_id: '17840000000000', username: 'mirposts', account_type: 'BUSINESS' }),
    ]);
    const cb = await adapter.handleCallback(env, new URLSearchParams('code=abc'));
    expect(cb.account.externalId).toBe('17840000000000');
    expect(cb.account.displayName).toBe('mirposts');
    expect(cb.tokens.accessToken).toBe(TOKEN);
    expect(cb.tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(calls[1]?.url).toContain('grant_type=ig_exchange_token');
    expect(calls[2]?.url).toContain('account_type');
  });

  it('refuses to connect a personal account with a clear message', async () => {
    stubFetch([
      () => jsonRes(200, { access_token: TOKEN, user_id: '1784' }),
      () => jsonRes(400, {}),
      () => jsonRes(200, { user_id: '17840000000000', username: 'personal', account_type: 'PERSONAL' }),
    ]);
    await expect(new InstagramAdapter().handleCallback(env, new URLSearchParams('code=abc'))).rejects.toThrow(
      /Business or Creator account/i,
    );
  });

  it('creates an image container via a signed URL and returns pending', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'ct_ig_1' })]);
    const out = await new InstagramAdapter().publish(env, input({ media: [media()] }));
    expect(out.kind).toBe('pending');
    expect((out as { externalId: string }).externalId).toBe('ct_ig_1');
    const body = decodeURIComponent(String(calls[0]?.init?.body));
    expect(body).toContain('media_type=IMAGE');
    expect(body).toContain('image_url=https://r2account.r2.cloudflarestorage.com');
    expect(body).toContain('X-Amz-Signature');
    expect(body).toContain('caption=Hello+Instagram');
  });

  it('rejects image-less and video posts without calling the provider', async () => {
    const calls = stubFetch([]);
    const none = await new InstagramAdapter().publish(env, input());
    expect(none.kind).toBe('failed');
    const video = await new InstagramAdapter().publish(env, input({ media: [media({ mime: 'video/mp4' })] }));
    expect(video.kind).toBe('failed');
    expect(calls.length).toBe(0);
  });

  it('resolves a finished container: media_publish then confirmed with permalink', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { status_code: 'FINISHED' }),
      () => jsonRes(200, { id: 'ig_media_9' }),
      () => jsonRes(200, { permalink: 'https://www.instagram.com/p/abc/' }),
    ]);
    const out = await new InstagramAdapter().resolvePending(env, account(), 'ct_ig_1');
    expect(out).toMatchObject({ kind: 'confirmed', externalId: 'ig_media_9', permalink: 'https://www.instagram.com/p/abc/' });
    expect(String(calls[1]?.init?.body)).toContain('creation_id=ct_ig_1');
    expect(calls[1]?.url).toContain('/media_publish');
  });

  it('stays pending while the container is still processing', async () => {
    const calls = stubFetch([() => jsonRes(200, { status_code: 'IN_PROGRESS' })]);
    const out = await new InstagramAdapter().resolvePending(env, account(), 'ct_ig_1');
    expect(out.kind).toBe('pending');
    expect(calls.length).toBe(1);
  });

  it('reports media processing failures in plain language', async () => {
    stubFetch([() => jsonRes(200, { status_code: 'ERROR', error_message: 'The image URL returned 403.' })]);
    const out = await new InstagramAdapter().resolvePending(env, account(), 'ct_bad');
    expect(out).toMatchObject({ kind: 'failed', errorCode: 'MEDIA_PROCESSING' });
  });

  it('refreshes long-lived tokens via ig_refresh_token', async () => {
    const calls = stubFetch([() => jsonRes(200, { access_token: 'renewed', expires_in: 5184000 })]);
    const next = await new InstagramAdapter().refresh(env, { accessToken: TOKEN });
    expect(next.accessToken).toBe('renewed');
    expect(calls[0]?.url).toContain('refresh_access_token?grant_type=ig_refresh_token');
  });

  it('tests the connection and reports the account type', async () => {
    stubFetch([() => jsonRes(200, { user_id: '17840000000000', username: 'mirposts', account_type: 'BUSINESS' })]);
    const res = await new InstagramAdapter().testConnection(env, account());
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('@mirposts');
    expect(res.detail).toContain('business');
  });

  it('flags expired tokens for reconnect', async () => {
    stubFetch([() => jsonRes(401, { error: { message: 'token expired' } })]);
    const res = await new InstagramAdapter().testConnection(env, account());
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/reconnect/i);
  });
});
