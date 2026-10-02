import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { LinkedInAdapter } from './linkedin';

const TOKEN = 'LINKEDIN_TOKEN_VERY_SECRET_123';
const env = {
  APP_URL: 'http://localhost:8787',
  LINKEDIN_CLIENT_ID: 'li-client-id',
  LINKEDIN_CLIENT_SECRET: 'li-client-secret-very-secret',
  MEDIA: {
    get: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }),
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
    provider: 'linkedin',
    externalId: 'sub-123',
    displayName: 'Test Member',
    accessToken: TOKEN,
    meta: {},
    status: 'connected',
  }) as SocialAccountRecord;

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  account: account(),
  caption: 'Hello LinkedIn',
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

describe('linkedin adapter', () => {
  it('builds the OAuth URL and completes the callback via userinfo', async () => {
    const adapter = new LinkedInAdapter();
    const { url } = await adapter.buildAuthUrl(env, 'http://localhost:8787/oauth/linkedin/callback', 'st7');
    expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization?');
    expect(decodeURIComponent(url)).toContain('scope=openid profile w_member_social');
    expect(url).toContain('state=st7');

    const calls = stubFetch([
      () => jsonRes(200, { access_token: TOKEN }),
      () => jsonRes(200, { sub: 'sub-123', name: 'Test Member' }),
    ]);
    const cb = await adapter.handleCallback(env, new URLSearchParams('code=abc'));
    expect(cb.account).toEqual({ externalId: 'sub-123', displayName: 'Test Member' });
    expect(cb.tokens.accessToken).toBe(TOKEN);
    expect(calls[1]?.url).toContain('/v2/userinfo');
  });

  it('publishes text-only posts with the required REST headers', async () => {
    const calls = stubFetch([
      () => jsonRes(201, {}, { 'x-restli-id': 'urn:li:share:7123', 'x-restli-protocol-version': '2.0.0' }),
    ]);
    const out = await new LinkedInAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'confirmed', externalId: 'urn:li:share:7123' });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('LinkedIn-Version')).toBe('202504');
    expect(headers.get('X-Restli-Protocol-Version')).toBe('2.0.0');
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.author).toBe('urn:li:person:sub-123');
    expect(body.commentary).toBe('Hello LinkedIn');
    expect(body.visibility).toBe('PUBLIC');
    expect(body.distribution).toEqual({ linkedInDistributionSource: 'NONE' });
  });

  it('publishes one image via registerUpload -> PUT -> post', async () => {
    const calls = stubFetch([
      () =>
        jsonRes(200, {
          value: {
            asset: 'urn:li:digitalmediaAsset:A1',
            uploadMechanism: {
              'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: 'https://upload.linkedin.com/put-here' },
            },
          },
        }),
      () => new Response('', { status: 201 }),
      () => jsonRes(201, {}, { 'x-restli-id': 'urn:li:share:7124' }),
    ]);
    const out = await new LinkedInAdapter().publish(env, input({ media: [media()] }));
    expect(out).toMatchObject({ kind: 'confirmed', externalId: 'urn:li:share:7124' });
    const body = JSON.parse(String(calls[2]?.init?.body));
    expect(body.content.media.id).toBe('urn:li:digitalmediaAsset:A1');
    const putHeaders = new Headers(calls[1]?.init?.headers);
    expect(putHeaders.get('content-type')).toBe('image/png');
    expect(putHeaders.get('Authorization')).toBeNull(); // presigned upload URL takes no auth
  });

  it('fails honestly on video and multiple images without calling the provider', async () => {
    const calls = stubFetch([]);
    const video = await new LinkedInAdapter().publish(env, input({ media: [media({ mime: 'video/mp4', r2Key: 'media/a/v.mp4' })] }));
    expect(video).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'VIDEO_UNSUPPORTED' });
    const many = await new LinkedInAdapter().publish(env, input({ media: [media(), media({ id: 'm2', r2Key: 'media/b.png' })] }));
    expect(many).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'TOO_MANY_IMAGES' });
    expect(calls).toHaveLength(0);
  });

  it('maps 401 to needs_reconnect without leaking the token', async () => {
    stubFetch([() => jsonRes(401, { message: 'bad token' })]);
    const out = await new LinkedInAdapter().publish(env, input());
    expect(out.kind).toBe('needs_reconnect');
    expect(JSON.stringify(out)).toContain('Reconnect LinkedIn');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('maps 429 to a retryable failure', async () => {
    stubFetch([() => new Response('throttled', { status: 429 })]);
    const out = await new LinkedInAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'RATE_LIMITED' });
  });

  it('maps timeouts to retryable ETIMEDOUT', async () => {
    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const out = await new LinkedInAdapter().publish(env, input());
    expect(out).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT' });
  });

  it('testConnection validates the token and reports the member name', async () => {
    const calls = stubFetch([() => jsonRes(200, { sub: 'sub-123', name: 'Test Member' })]);
    const res = await new LinkedInAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: true, detail: 'Token valid — identity Test Member.' });
    expect(calls[0]?.url).toContain('api.linkedin.com/v2/userinfo');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(res.detail).not.toContain(TOKEN);
  });

  it('testConnection maps 401 to a reconnect prompt without leaking the token', async () => {
    stubFetch([() => new Response('', { status: 401 })]);
    const res = await new LinkedInAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'Your LinkedIn connection expired. Reconnect LinkedIn.' });
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
    const res = await new LinkedInAdapter().testConnection(env, account());
    expect(res).toEqual({ ok: false, detail: 'LinkedIn did not respond in time. Try again.' });
  });
});
