import { beforeAll, expect, test } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import type { AdapterCallbackResult, PlatformAdapter, PublishOutcome } from '../contracts/types';
import { registerAdapter } from '../adapters/registry';
import { handleApi } from './router';
import schema0003 from '../../migrations/0003_user_ownership.sql?raw';

// Regression: the OAuth connect path must persist a Threads account with
// status/meta in the right columns (a bind-order shift once wrote the meta
// JSON into status and 'connected' into meta, which disabled the composer
// destination). Drives the real upsert path through a forged OAuth round-trip.

const e = env as unknown as Env;
const SECRET = 'test-secret-0123456789abcdef';
const BASE = 'http://localhost:8787';
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const TOKEN = 'threads-token-test-not-real';

class FakeThreadsAdapter implements PlatformAdapter {
  readonly provider = 'threads' as const;
  readonly capabilities = { text: true, images: true, maxImages: 1, video: false, maxVideoMB: 0, maxCaptionChars: 500, mediaRequired: false, directPublish: true } as never;
  async buildAuthUrl() {
    return { url: 'https://threads.net/oauth/authorize?test=1' };
  }
  async handleCallback(): Promise<AdapterCallbackResult> {
    return {
      account: {
        externalId: 'th-fake-1',
        displayName: 'Mir Sadat | Build with AI',
        avatarUrl: 'https://img/t.png',
        meta: { handle: 'mirsadat.ai' },
      },
      tokens: { accessToken: TOKEN },
      scopes: 'threads_basic,threads_content_publish',
    };
  }
  async publish() {
    const out: PublishOutcome = { kind: 'failed', retryable: false, errorCode: 'TEST', errorMessage: 'not used here' };
    return out;
  }
}

function cookiesOf(res: Response): Record<string, string> {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const raws = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
  const out: Record<string, string> = {};
  for (const raw of raws) {
    const pair = raw.split(';')[0] ?? '';
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

async function call(path: string, method: string, cookie?: string, csrf?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  if (csrf) headers['x-csrf'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return handleApi(new Request(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), e, ctx);
}

beforeAll(async () => {
  const v = env as unknown as Record<string, string | undefined>;
  v.SESSION_SECRET ||= SECRET;
  v.ENCRYPTION_SECRET = SECRET;
  registerAdapter(new FakeThreadsAdapter());
  const apply = (raw: string) =>
    raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  const { default: schema0001 } = await import('../../migrations/0001_init.sql?raw');
  const { default: schema0002 } = await import('../../migrations/0002_user_name.sql?raw');
  for (const stmt of [...apply(schema0001 as string), ...apply(schema0002 as string), ...apply(schema0003 as string)]) {
    await e.DB.prepare(stmt).run();
  }
  const setup = await call('/api/setup', 'POST', undefined, undefined, { email: 'owner@test.dev', password: 'password123', timezone: 'UTC' });
  expect(setup.status).toBe(201);
  const login = await call('/api/auth/login', 'POST', undefined, undefined, { email: 'owner@test.dev', password: 'password123' });
  expect(login.status).toBe(200);
  const c = cookiesOf(login);
  ownerJar = `cotly_session=${c.cotly_session}; cotly_csrf=${c.cotly_csrf ?? ''}`;
  ownerCsrf = c.cotly_csrf ?? '';
});

let ownerJar = '';
let ownerCsrf = '';

test('threads oauth connect stores aligned columns and the account is composer-selectable', async () => {
  const start = await call('/api/oauth/threads/start', 'GET', ownerJar);
  expect(start.status).toBe(200);
  const state = 'st-regression-1';
  await e.DB
    .prepare("UPDATE oauth_states SET state = ? WHERE provider = 'threads'")
    .bind(state)
    .run();

  const cb = await call(`/oauth/threads/callback?code=fake&state=${state}`, 'GET');
  expect(cb.status).toBe(302);
  expect(cb.headers.get('location')).toContain('connected=1&provider=threads');

  const cookieRow = await e.DB
    .prepare("SELECT id, owner_id, external_id, display_name, status, meta FROM social_accounts WHERE provider = 'threads'")
    .first<{ id: string; owner_id: string; external_id: string; display_name: string; status: string; meta: string }>();
  expect(cookieRow?.status).toBe('connected');
  expect(JSON.parse(cookieRow?.meta ?? '{}')).toEqual({ handle: 'mirsadat.ai' });
  expect(cookieRow?.display_name).toBe('Mir Sadat | Build with AI');

  // The owner sees it with a clean handle — normalized on read, never raw JSON.
  const jar = ownerJar;
  const list = await call('/api/accounts', 'GET', jar);
  const accounts = (await list.json()) as Array<{ id: string; provider: string; status: string; handle: string | null; displayName: string }>;
  const threads = accounts.find((a) => a.provider === 'threads');
  expect(threads?.status).toBe('connected');
  expect(threads?.handle).toBe('mirsadat.ai');
  expect(threads?.displayName).toBe('Mir Sadat | Build with AI');
  expect((threads?.handle ?? '').startsWith('{')).toBe(false);

  // And the composer's create-post validation accepts it as a text-only target.
  const create = await call('/api/posts', 'POST', jar, ownerCsrf, {
    baseCaption: 'Composer readiness check',
    targets: [{ accountId: threads?.id }],
    mode: 'now',
  });
  expect(create.status).toBe(201);
});
