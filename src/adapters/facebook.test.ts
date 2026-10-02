import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { FacebookAdapter } from './facebook';

const TOKEN = 'PAGE_TOKEN_VERY_SECRET_123';
const env = {
  APP_URL: 'http://localhost:8787',
  META_CLIENT_ID: 'meta-client-id',
  META_CLIENT_SECRET: 'meta-client-secret-very-secret',
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
    provider: 'facebook',
    externalId: 'page-123',
    displayName: 'Test Page',
    accessToken: TOKEN,
    meta: { pageId: 'page-123' },
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello world',
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

describe('facebook adapter', () => {
  it('builds the OAuth dialog URL with the page scopes', async () => {
    const { url } = await new FacebookAdapter().buildAuthUrl(env, 'http://localhost:8787/oauth/facebook/callback', 'st123');
    expect(url).toContain('https://www.facebook.com/v21.0/dialog/oauth?');
    expect(decodeURIComponent(url)).toContain('scope=pages_show_list,pages_manage_posts,pages_read_engagement');
    expect(url).toContain('client_id=meta-client-id');
    expect(url).toContain('state=st123');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Foauth%2Ffacebook%2Fcallback');
  });

  it('connects the only Page on the account without asking', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { access_token: 'USER_TOKEN_VERY_SECRET_42' }),
      () => jsonRes(200, { data: [{ id: 'page-123', name: 'Test Page', access_token: TOKEN }] }),
    ]);
    const cb = await new FacebookAdapter().handleCallback(env, new URLSearchParams('code=abc&state=st123'));
    expect(cb.pageChoice).toBeUndefined();
    expect(cb.account).toEqual({ externalId: 'page-123', displayName: 'Test Page', meta: { pageId: 'page-123' } });
    expect(cb.tokens?.accessToken).toBe(TOKEN);
    expect(calls[0]?.url).toContain('/oauth/access_token');
    expect(calls[1]?.url).toContain('/me/accounts');
  });

  it('asks the user to choose when the account manages several Pages', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { access_token: 'USER_TOKEN_VERY_SECRET_42' }),
      () =>
        jsonRes(200, {
          data: [
            { id: 'page-1', name: 'First Page', access_token: 'tok-1' },
            { id: 'page-2', name: 'Second Page', access_token: 'tok-2' },
          ],
        }),
    ]);
    const cb = await new FacebookAdapter().handleCallback(env, new URLSearchParams('code=abc&state=st123'));
    expect(cb.account).toBeUndefined();
    expect(cb.pageChoice?.pages).toEqual([
      { id: 'page-1', name: 'First Page' },
      { id: 'page-2', name: 'Second Page' },
    ]);
    expect(calls[1]?.url).toContain('/me/accounts');
  });

  it('refuses to connect when the account manages no Page', async () => {
    stubFetch([
      () => jsonRes(200, { access_token: 'USER_TOKEN_VERY_SECRET_42' }),
      () => jsonRes(200, { data: [] }),
    ]);
    await expect(
      new FacebookAdapter().handleCallback(env, new URLSearchParams('code=abc&state=st123')),
    ).rejects.toThrow(/No Facebook Page/i);
  });

  it('publishes text-only via /feed and reads the permalink', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { id: 'fb_post_1' }),
      () => jsonRes(200, { permalink_url: '/permalink.php?story_fbid=1&id=page-123' }),
    ]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out).toEqual({
      kind: 'confirmed',
      externalId: 'fb_post_1',
      permalink: 'https://www.facebook.com/permalink.php?story_fbid=1&id=page-123',
    });
    expect(calls[0]?.url).toContain('/page-123/feed');
    expect(String(calls[0]?.init?.body)).toContain('Hello+world');
  });

  it('still confirms when the permalink lookup fails (best effort)', async () => {
    stubFetch([() => jsonRes(200, { id: 'fb_post_1' }), () => jsonRes(500, { error: { message: 'boom' } })]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out.kind).toBe('confirmed');
    expect((out as { permalink?: string }).permalink).toBeUndefined();
  });

  it('publishes images via presigned photos + attached_media', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { id: 'fb_media_1' }),
      () => jsonRes(200, { id: 'fb_media_2' }),
      () => jsonRes(200, { id: 'fb_post_9' }),
    ]);
    const out = await new FacebookAdapter().publish(
      env,
      input({ media: [media(), media({ id: 'm2', r2Key: 'media/b/2.png' })] }),
    );
    expect(out).toMatchObject({ kind: 'confirmed', externalId: 'fb_post_9' });
    expect(calls[0]?.url).toContain('/page-123/photos');
    expect(decodeURIComponent(String(calls[0]?.init?.body))).toContain('X-Amz-Signature');
    expect(decodeURIComponent(String(calls[0]?.init?.body))).toContain('published=false');
    expect(calls[2]?.url).toContain('/page-123/feed');
    expect(decodeURIComponent(String(calls[2]?.init?.body))).toContain('attached_media[0][media_fbid]=fb_media_1');
    expect(decodeURIComponent(String(calls[2]?.init?.body))).toContain('attached_media[1][media_fbid]=fb_media_2');
  });

  it('publishes video via /videos with a signed file_url', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'fb_vid_1' })]);
    const out = await new FacebookAdapter().publish(env, input({ media: [media({ mime: 'video/mp4', r2Key: 'media/a/v.mp4' })] }));
    expect(out).toMatchObject({ kind: 'confirmed', externalId: 'fb_vid_1' });
    expect(calls[0]?.url).toContain('/page-123/videos');
    expect(decodeURIComponent(String(calls[0]?.init?.body))).toContain('file_url=https://r2account.r2.cloudflarestorage.com');
  });

  it('fails humanely when R2 media signing is not configured', async () => {
    const calls = stubFetch([]);
    const badEnv = { APP_URL: 'http://localhost:8787' } as unknown as Env;
    const out = await new FacebookAdapter().publish(badEnv, input({ media: [media()] }));
    expect(out).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'MEDIA_SIGNING_NOT_CONFIGURED' });
    expect(JSON.stringify(out)).toContain('R2 public media signing is not configured');
    expect(calls).toHaveLength(0);
  });

  it('maps graph token errors to needs_reconnect without leaking tokens', async () => {
    stubFetch([() => jsonRes(400, { error: { code: 190, message: 'Error validating access token: session expired' } })]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'needs_reconnect' });
    expect(JSON.stringify(out)).toContain('Reconnect Facebook');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('maps rate limit codes to retryable failures', async () => {
    stubFetch([() => jsonRes(400, { error: { code: 4, message: 'Application request limit reached' } })]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'RATE_LIMITED' });
  });

  it('maps other graph errors to non-retryable human failures', async () => {
    stubFetch([
      () => jsonRes(403, { error: { code: 200, error_user_msg: 'You need permission to publish to this Page', message: 'requires pages_manage_posts' } }),
    ]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: false });
    expect((out as { errorMessage: string }).errorMessage).toContain('You need permission to publish');
  });

  it('maps timeouts to retryable ETIMEDOUT', async () => {
    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const out = await new FacebookAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT' });
  });

  it('testConnection validates the page token and reports the page identity', async () => {
    const calls = stubFetch([() => jsonRes(200, { id: 'page-123', name: 'Test Page' })]);
    const res = await new FacebookAdapter().testConnection(env, account());
    expect(res).toEqual({
      ok: true,
      detail:
        'Token valid — identity Test Page. Page publishing permission (pages_manage_posts) can only be fully verified by an actual publish.',
    });
    expect(calls[0]?.url).toContain('graph.facebook.com/v21.0/me?fields=id,name');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(res.detail).not.toContain(TOKEN);
  });

  it('testConnection maps auth failures to a reconnect prompt without leaking the token', async () => {
    stubFetch([() => jsonRes(401, { error: { code: 190, message: 'Error validating access token: session expired' } })]);
    const res = await new FacebookAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'Your Facebook connection expired. Reconnect Facebook.' });
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
    const res = await new FacebookAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'Facebook did not respond in time. Try again.' });
  });
});
