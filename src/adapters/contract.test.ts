import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../contracts/env';
import type { PublishInput, SocialAccountRecord } from '../contracts/types';
import { encryptSecret } from '../lib/crypto';
import { getAdapter } from './registry';
import { FacebookAdapter } from './facebook';
import { ThreadsAdapter } from './threads';
import { LinkedInAdapter } from './linkedin';
import { InstagramAdapter } from './instagram';
import { XAdapter } from './x';
import { BlueskyAdapter } from './bluesky';

// Common publishing contract, proven against EVERY adapter so the state
// machine is not X-only:
// - genuine auth failure (401 / token-proven 403) -> needs_reconnect
// - ordinary provider error -> failed (retryable or not), NEVER needs_reconnect
// - testConnection mirrors the same split, and never leaks tokens.

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(handlers: Handler[]) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const h = handlers.shift();
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    return h(url, init);
  });
}

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SECRET = 'contract-test-secret-0123456789abcdef';

const baseEnv = {
  APP_URL: 'http://localhost:8787',
  ENCRYPTION_SECRET: SECRET,
  X_CLIENT_ID: 'x-id',
  X_CLIENT_SECRET: 'x-secret-very-secret',
  X_API_ENABLED: 'true',
  X_MAX_MONTHLY_SPEND_USD: '5',
  THREADS_CLIENT_ID: 'th-id',
  THREADS_CLIENT_SECRET: 'th-secret-very-secret',
  DB: {
    prepare: () => ({ bind: () => ({ first: async () => ({ est_cost_usd: 0 }), run: async () => ({}) }) }),
  },
} as unknown as Env;

const acc = (over: Partial<SocialAccountRecord> = {}): SocialAccountRecord =>
  ({
    id: 'acc_contract',
    provider: 'mock',
    externalId: 'ext1',
    displayName: 'Contract User',
    accessToken: 'CONTRACT_TOKEN_VERY_SECRET_1',
    meta: {},
    status: 'connected',
    ...over,
  }) as SocialAccountRecord;

const input = (account: SocialAccountRecord, caption = 'Hello contract'): PublishInput => ({
  account,
  caption,
  media: [],
  idempotencyKey: 'contract:1',
  scheduledAt: 1_000,
});

afterEach(() => vi.unstubAllGlobals());

describe('provider contract: genuine auth failure -> needs_reconnect', () => {
  it('facebook 401+code190 reconnects; 500 is failed, never reconnect', async () => {
    const a = acc({ provider: 'facebook', externalId: 'pg1', meta: { pageId: 'pg1' } });
    stubFetch([() => jsonRes(401, { error: { code: 190, message: 'Invalid OAuth access token' } })]);
    const bad = await new FacebookAdapter().publish(baseEnv, input(a));
    expect(bad.kind).toBe('needs_reconnect');

    stubFetch([() => jsonRes(500, { error: { code: 1, message: 'An unknown error occurred' } })]);
    const ordinary = await new FacebookAdapter().publish(baseEnv, input(a));
    expect(ordinary.kind).toBe('failed');
    expect(JSON.stringify(ordinary)).not.toContain('CONTRACT_TOKEN');
  });

  it('threads token error reconnects; valid-token publish failure does not', async () => {
    const a = acc({ provider: 'threads', externalId: 'th-user-1' });
    stubFetch([
      () => jsonRes(401, { error: { code: 190, message: 'Invalid OAuth access token' } }),
      () => jsonRes(200, { id: 'th-user-1', username: 'tester' }),
    ]);
    const bad = await new ThreadsAdapter().publish(baseEnv, input(a));
    expect(bad.kind).toBe('needs_reconnect');

    stubFetch([
      () => jsonRes(400, { error: { code: 100, message: 'Invalid parameter' } }),
      () => jsonRes(200, { id: 'th-user-1', username: 'tester' }),
    ]);
    const ordinary = await new ThreadsAdapter().publish(baseEnv, input(a));
    expect(ordinary.kind).toBe('failed');
  });

  it('linkedin 401 reconnects; 403 without token proof is failed', async () => {
    const a = acc({ provider: 'linkedin', externalId: 'li-sub-1' });
    stubFetch([() => jsonRes(401, { message: 'Invalid access token' })]);
    const bad = await new LinkedInAdapter().publish(baseEnv, input(a));
    expect(bad.kind).toBe('needs_reconnect');

    stubFetch([() => jsonRes(403, { message: 'Not enough permissions to access this resource' })]);
    const ordinary = await new LinkedInAdapter().publish(baseEnv, input(a));
    expect(ordinary.kind).toBe('failed');
    expect(ordinary).toMatchObject({ retryable: false });
  });

  it('instagram text-only refusal is failed, never reconnect', async () => {
    const a = acc({ provider: 'instagram', externalId: 'ig-1' });
    stubFetch([]);
    const out = await new InstagramAdapter().publish(baseEnv, input(a));
    expect(out).toMatchObject({ kind: 'failed', retryable: false, errorCode: 'MEDIA_REQUIRED' });
  });

  it('x 401 reconnects; 403 duplicate-content is failed, never reconnect', async () => {
    const a = acc({ provider: 'x', externalId: '9876543210' });
    stubFetch([() => jsonRes(401, { title: 'Unauthorized', detail: 'Unauthorized' })]);
    const bad = await new XAdapter().publish(baseEnv, input(a));
    expect(bad.kind).toBe('needs_reconnect');

    stubFetch([() => jsonRes(403, { title: 'Forbidden', detail: 'You are not permitted to create a Tweet with duplicate content.' })]);
    const ordinary = await new XAdapter().publish(baseEnv, input(a));
    expect(ordinary.kind).toBe('failed');
    expect(JSON.stringify(ordinary)).not.toContain('CONTRACT_TOKEN');
  });

  it('x 403 with expired-token proof still reconnects', async () => {
    const a = acc({ provider: 'x', externalId: '9876543210' });
    stubFetch([() => jsonRes(403, { errors: [{ code: 89, message: 'Invalid or expired token' }] })]);
    const out = await new XAdapter().publish(baseEnv, input(a));
    expect(out.kind).toBe('needs_reconnect');
  });

  it('bluesky expired token reconnects; ordinary error is failed', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const settings = new Map<string, string>();
    const env = {
      ...baseEnv,
      DB: {
        prepare: (sql: string) => ({
          first: async () => null,
          bind: () => ({ run: async () => ({}), first: async () => null }),
          all: async () => ({ results: [] }),
        }),
      },
    } as unknown as Env;
    const a = acc({
      provider: 'bluesky',
      externalId: 'did:plc:abc123',
      meta: { pdsUrl: 'https://pds.example', dpopKeyEnc: await encryptSecret(SECRET, JSON.stringify(jwk)) },
    });
    stubFetch([() => jsonRes(401, { error: 'ExpiredToken', message: 'Token expired' })]);
    const bad = await new BlueskyAdapter().publish(env, input(a));
    expect(bad.kind).toBe('needs_reconnect');

    stubFetch([() => jsonRes(400, { error: 'InvalidRequest', message: 'Record is too large' })]);
    const ordinary = await new BlueskyAdapter().publish(env, input(a));
    expect(ordinary.kind).toBe('failed');
    void settings;
  });
});

describe('provider contract: testConnection split', () => {
  it('facebook/linkedin/instagram/x ask reconnect only for genuine auth failures', async () => {
    const fb = acc({ provider: 'facebook' });
    stubFetch([() => jsonRes(401, { error: { code: 190, message: 'Invalid OAuth access token' } })]);
    expect((await new FacebookAdapter().testConnection(baseEnv, fb)).detail).toMatch(/reconnect/i);
    stubFetch([() => jsonRes(500, { error: { code: 1, message: 'Temporary backend failure' } })]);
    const fbOther = await new FacebookAdapter().testConnection(baseEnv, fb);
    expect(fbOther.ok).toBe(false);
    expect(fbOther.detail).not.toMatch(/reconnect/i);

    const li = acc({ provider: 'linkedin' });
    stubFetch([() => jsonRes(401, { message: 'Invalid access token' })]);
    expect((await new LinkedInAdapter().testConnection(baseEnv, li)).detail).toMatch(/reconnect/i);
    stubFetch([() => jsonRes(403, { message: 'Insufficient permissions for this call' })]);
    const liOther = await new LinkedInAdapter().testConnection(baseEnv, li);
    expect(liOther.ok).toBe(false);
    expect(liOther.detail).not.toMatch(/reconnect/i);

    const ig = acc({ provider: 'instagram' });
    stubFetch([() => jsonRes(401, { error: { message: 'Invalid access token' } })]);
    expect((await new InstagramAdapter().testConnection(baseEnv, ig)).detail).toMatch(/reconnect/i);
    stubFetch([() => jsonRes(403, { error: { code: 200, message: 'Requires a permission that was not granted' } })]);
    const igOther = await new InstagramAdapter().testConnection(baseEnv, ig);
    expect(igOther.ok).toBe(false);
    expect(igOther.detail).not.toMatch(/reconnect/i);

    const x = acc({ provider: 'x' });
    stubFetch([() => jsonRes(401, { title: 'Unauthorized' })]);
    expect((await new XAdapter().testConnection(baseEnv, x)).detail).toMatch(/reconnect/i);
    stubFetch([() => jsonRes(403, { detail: 'Usage cap exceeded for this endpoint' })]);
    const xOther = await new XAdapter().testConnection(baseEnv, x);
    expect(xOther.ok).toBe(false);
    expect(xOther.detail).not.toMatch(/reconnect/i);
  });

  it('threads testConnection keeps its auth mapping', async () => {
    const th = acc({ provider: 'threads' });
    stubFetch([() => jsonRes(401, { error: { code: 190, message: 'Invalid OAuth access token' } })]);
    expect((await new ThreadsAdapter().testConnection(baseEnv, th)).detail).toMatch(/reconnect/i);
  });
});

describe('provider contract: registry resolves every provider', () => {
  it('returns an adapter with capabilities for all wired providers', () => {
    for (const p of ['facebook', 'threads', 'linkedin', 'bluesky', 'instagram', 'x', 'mock', 'assisted'] as const) {
      const adapter = getAdapter(p);
      expect(adapter.provider).toBe(p);
      expect(adapter.capabilities).toBeDefined();
    }
  });
});
