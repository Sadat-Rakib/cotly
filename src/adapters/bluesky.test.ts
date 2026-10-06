import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { MediaRecord, PublishInput, SocialAccountRecord } from '../contracts/types';
import { encryptSecret } from '../lib/crypto';
import { BlueskyAdapter } from './bluesky';

const SECRET = 'test-encryption-secret-0123456789abcdef';
const ACCESS = 'BSKY_ACCESS_JWT_VERY_SECRET_123';
const REFRESH = 'BSKY_REFRESH_JWT_VERY_SECRET_456';

// Settings-KV stand-in so the adapter can persist its confidential-client key
// and DPoP nonces without a D1 database.
const settings = new Map<string, string>();
const env = {
  ENCRYPTION_SECRET: SECRET,
  APP_URL: 'https://cotly.test',
  MEDIA: {
    get: async (key: string) => ({
      body: new Response(new Uint8Array([9, 9, 9, 9]).buffer).body,
      key,
    }),
  },
  DB: {
    prepare: (sql: string) => {
      const m = /key = '([^']+)'/.exec(sql);
      const key = m?.[1] ?? '';
      return {
        first: async () => (settings.has(key) ? { value: settings.get(key) } : null),
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (sql.includes('INSERT INTO settings') && args.length >= 2) settings.set(String(args[0]), String(args[1]));
            return { success: true };
          },
          first: async () => null,
        }),
        all: async () => ({ results: [] }),
      };
    },
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

async function account(): Promise<SocialAccountRecord> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    id: 'acc1',
    provider: 'bluesky',
    externalId: 'did:plc:abc123',
    displayName: 'tester.bsky.social',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    meta: { pdsUrl: 'https://pds.example', dpopKeyEnc: await encryptSecret(SECRET, JSON.stringify(jwk)) },
    status: 'connected',
  } as SocialAccountRecord;
}

const input = (over: Partial<PublishInput> = {}, acc?: SocialAccountRecord): Promise<PublishInput> =>
  account().then((a) => ({
    account: a,
    caption: 'Hello bluesky',
    media: [],
    idempotencyKey: 't1:1',
    scheduledAt: 1_000,
    ...over,
  }));

const media = (over: Partial<MediaRecord> = {}): MediaRecord => ({
  id: 'm1',
  mime: 'image/png',
  size: 4,
  r2Key: 'media/a/img.png',
  ...over,
});

beforeEach(() => settings.clear());
afterEach(() => vi.unstubAllGlobals());

describe('bluesky adapter (atproto OAuth)', () => {
  it('builds the authorize URL through PAR and keeps the DPoP key encrypted', async () => {
    const calls = stubFetch([() => jsonRes(200, { request_uri: 'urn:bsky:par:1' })]);
    const out = await new BlueskyAdapter().buildAuthUrl(env, 'https://cotly.test/oauth/bluesky/callback', 'state-1');
    expect(out.url).toContain('https://bsky.social/oauth/authorize');
    expect(out.url).toContain(`client_id=${encodeURIComponent('https://cotly.test/oauth/bluesky/client-metadata.json')}`);
    expect(out.url).toContain('request_uri=urn%3Absky%3Apar%3A1');
    const parUrl = calls[0]?.url ?? '';
    expect(parUrl).toBe('https://bsky.social/oauth/par');
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get('scope')).toBe('atproto transition:generic');
    expect(body.get('code_challenge_method')).toBe('S256');
    expect(body.get('redirect_uri')).toBe('https://cotly.test/oauth/bluesky/callback');
    // The DPoP proof travels as a proper JWT header.
    const dpop = new Headers(calls[0]?.init?.headers).get('dpop') ?? '';
    expect(dpop.split('.')).toHaveLength(3);
    // The state blob must be encrypted (not plaintext) and carry pkce + dpop key.
    expect(out.verifier).not.toContain('pkce');
    const { decryptSecret } = await import('../lib/crypto');
    const blob = JSON.parse(await decryptSecret(SECRET, out.verifier)) as { pkce: string; dpop: { d?: string } };
    expect(blob.pkce).toBeTruthy();
    expect(blob.dpop.d).toBeTruthy();
  });

  it('exchanges the code, resolves the PDS from the DID, and stores an encrypted DPoP key', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { request_uri: 'urn:bsky:par:2' }),
      () => jsonRes(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 1_000_000, scope: 'atproto transition:generic', sub: 'did:plc:abc123' }),
      () => jsonRes(200, { did: 'did:plc:abc123', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] }),
      () => jsonRes(200, { handle: 'tester.bsky.social', did: 'did:plc:abc123' }),
    ]);
    const start = await new BlueskyAdapter().buildAuthUrl(env, 'https://cotly.test/oauth/bluesky/callback', 'state-1');
    const out = await new BlueskyAdapter().handleCallback(env, new URLSearchParams('code=abc'), start.verifier);
    expect(out.account.externalId).toBe('did:plc:abc123');
    expect(out.account.displayName).toBe('tester.bsky.social');
    expect(out.account.meta.pdsUrl).toBe('https://pds.example');
    expect(out.tokens.refreshToken).toBe(REFRESH);
    expect(out.scopes).toBe('atproto transition:generic');
    // Token exchange used the confidential-client assertion + DPoP proof.
    const tokBody = new URLSearchParams(String(calls[1]?.init?.body));
    expect(tokBody.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    expect(tokBody.get('code_verifier')).toBeTruthy();
    expect(new Headers(calls[1]?.init?.headers).get('dpop')).toBeTruthy();
    // The stored DPoP key is encrypted at rest.
    // The stored DPoP key is encrypted at rest — the private JWK plaintext never appears.
    expect(String(out.account.meta.dpopKeyEnc)).not.toContain('kty');
    void calls;
  });

  it('publishes text posts with DPoP headers and a permalink derived from the uri', async () => {
    const calls = stubFetch([() => jsonRes(200, { uri: 'at://did:plc:abc123/app.bsky.feed.post/3k999', cid: 'cid1' })]);
    const out = await new BlueskyAdapter().publish(env, await input());
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
    expect((calls[0]?.url ?? '').startsWith('https://pds.example/xrpc/')).toBe(true);
    const dpop = new Headers(calls[0]?.init?.headers).get('dpop') ?? '';
    expect(dpop.split('.')).toHaveLength(3);
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`DPoP ${ACCESS}`);
  });

  it('uploads image blobs and embeds them', async () => {
    const calls = stubFetch([
      () => jsonRes(200, { blob: { $type: 'blob', ref: { $link: 'cid-img' }, mimeType: 'image/png', size: 4 } }),
      () => jsonRes(200, { uri: 'at://did:plc:abc123/app.bsky.feed.post/3k000', cid: 'cid2' }),
    ]);
    const out = await new BlueskyAdapter().publish(env, await input({ media: [media()] }));
    expect(out.kind).toBe('confirmed');
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.record.embed.$type).toBe('app.bsky.embed.images');
    expect(body.record.embed.images[0].image.ref.$link).toBe('cid-img');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('image/png');
  });

  it('returns needs_reconnect when the provider rejects the token (no secrets leaked)', async () => {
    stubFetch([() => jsonRes(401, { error: 'InvalidToken' })]);
    const out = await new BlueskyAdapter().publish(env, await input());
    expect(out).toMatchObject({ kind: 'needs_reconnect' });
    expect(JSON.stringify(out)).toContain('Reconnect Bluesky');
    expect(JSON.stringify(out)).not.toContain(ACCESS);
    expect(JSON.stringify(out)).not.toContain(REFRESH);
  });

  it('rejects oversized captions and video without calling the provider', async () => {
    const calls = stubFetch([]);
    const long = await new BlueskyAdapter().publish(env, await input({ caption: 'x'.repeat(301) }));
    expect(long).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'CAPTION_TOO_LONG' });
    const video = await new BlueskyAdapter().publish(env, await input({ media: [media({ mime: 'video/mp4', r2Key: 'media/a/v.mp4' })] }));
    expect(video).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'VIDEO_UNSUPPORTED' });
    expect(calls).toHaveLength(0);
  });

  it('maps 429 to a retryable failure and timeouts to ETIMEDOUT', async () => {
    stubFetch([() => new Response('slow', { status: 429 })]);
    const limited = await new BlueskyAdapter().publish(env, await input());
    expect(limited).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'RATE_LIMITED' });

    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const timedOut = await new BlueskyAdapter().publish(env, await input());
    expect(timedOut).toMatchObject({ kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT' });
  });

  it('refresh() rotates the token pair with the client assertion and DPoP proof', async () => {
    const acc = await account();
    const calls = stubFetch([() => jsonRes(200, { access_token: 'BSKY_NEW_ACCESS_777', refresh_token: 'BSKY_NEW_REFRESH_777', expires_in: 1_000_000 })]);
    const tokens = await new BlueskyAdapter().refresh(env, { accessToken: ACCESS, refreshToken: REFRESH }, acc);
    expect(tokens.accessToken).toBe('BSKY_NEW_ACCESS_777');
    expect(tokens.refreshToken).toBe('BSKY_NEW_REFRESH_777');
    expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    expect(body.get('refresh_token')).toBe(REFRESH);
    expect(new Headers(calls[0]?.init?.headers).get('dpop')).toBeTruthy();
  });

  it('testConnection validates via getProfile and reports the handle', async () => {
    stubFetch([() => jsonRes(200, { handle: 'tester.bsky.social', did: 'did:plc:abc123' })]);
    const res = await new BlueskyAdapter().testConnection(env, await account());
    expect(res).toEqual({ ok: true, detail: 'Token valid — identity tester.bsky.social.' });
    expect(res.detail).not.toContain(ACCESS);
    expect(res.detail).not.toContain(REFRESH);
  });

  it('testConnection attempts one refresh on auth failure', async () => {
    stubFetch([
      () => jsonRes(401, { error: 'InvalidToken' }),
      () => jsonRes(200, { access_token: 'BSKY_RENEWED_ACCESS_1', refresh_token: 'BSKY_RENEWED_REFRESH_1', expires_in: 1_000_000 }),
      () => jsonRes(200, { handle: 'tester.bsky.social', did: 'did:plc:abc123' }),
    ]);
    const res = await new BlueskyAdapter().testConnection(env, await account());
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('Session renewed');
    expect(res.detail).not.toContain(ACCESS);
  });

  it('testConnection asks for reconnect when the refresh also fails', async () => {
    stubFetch([
      () => jsonRes(401, { error: 'ExpiredToken' }),
      () => jsonRes(400, { error: 'invalid_grant' }),
    ]);
    const res = await new BlueskyAdapter().testConnection(env, await account());
    expect(res).toEqual({ ok: false, detail: 'Authorization expired and could not be renewed. Reconnect Bluesky.' });
    expect(res.detail).not.toContain(ACCESS);
    expect(res.detail).not.toContain(REFRESH);
  });

  it('testConnection maps timeouts to a try-again message', async () => {
    stubFetch([
      () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        throw e;
      },
    ]);
    const res = await new BlueskyAdapter().testConnection(env, await account());
    expect(res).toEqual({ ok: false, detail: 'Bluesky did not respond in time. Try again.' });
  });
});
