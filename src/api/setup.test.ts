import { beforeAll, expect, test } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import { encryptSecret } from '../lib/crypto';
import { BlueskyAdapter } from '../adapters/bluesky';
import { handleApi } from './router';
import schema from '../../migrations/0001_init.sql?raw';

// Same conventions as api.test.ts: per-test isolated storage rolls back writes
// made inside a test, while beforeAll writes persist for the whole file. Every
// test therefore seeds the rows it asserts on, and env keys are set/deleted
// explicitly per test so order never matters.
const e = env as unknown as Env;
const SECRET = 'test-secret-0123456789abcdef';
const BASE = 'http://localhost:8787';
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const nowS = (): number => Math.floor(Date.now() / 1000);

let cookieHeader = '';
let csrf = '';

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

function captureCookies(res: Response): void {
  const c = cookiesOf(res);
  if (c.cotly_session) cookieHeader = `cotly_session=${c.cotly_session}${c.cotly_csrf ? `; cotly_csrf=${c.cotly_csrf}` : ''}`;
  if (c.cotly_csrf) csrf = c.cotly_csrf;
}

async function api(path: string, method: string, body?: unknown, opts: { auth?: boolean; csrf?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth && cookieHeader) headers['cookie'] = cookieHeader;
  if (opts.csrf) headers['x-csrf'] = csrf;
  const req = new Request(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return handleApi(req, e, ctx);
}

function setEnv(values: Record<string, string | undefined>): void {
  const v = env as unknown as Record<string, string | undefined>;
  for (const [k, val] of Object.entries(values)) {
    if (val === undefined) delete v[k];
    else v[k] = val;
  }
}

interface SetupStatusBody {
  deployment: { d1: boolean; r2: boolean; cron: boolean | 'unknown'; appUrl: string; encryptionSecretSet: boolean; sessionSecretSet: boolean; mediaPresignReady: boolean };
  owner: { exists: boolean; email: string | null };
  accounts: Array<{ id: string; provider: string; displayName: string; status: string; lastVerifiedAt: number | null }>;
  providers: Array<{ provider: string; implemented: boolean; configured: boolean; reason: string; connected: boolean; badge: string }>;
  checklist: Array<{ key: string; label: string; done: boolean }>;
}

async function setupStatus(): Promise<SetupStatusBody> {
  const res = await api('/api/setup/status', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  return (await res.json()) as SetupStatusBody;
}

// Probe the Bluesky adapter directly: it ships testConnection, so expect the
// 200 ok-path; keep the 400 branch for robustness if that ever changes.
const bskySupportsTest = typeof (BlueskyAdapter.prototype as unknown as Record<string, unknown>).testConnection === 'function';

beforeAll(async () => {
  const v = env as unknown as Record<string, string | undefined>;
  v.SESSION_SECRET ||= SECRET;
  v.ENCRYPTION_SECRET = SECRET;
  v.MOCK_SOCIAL_ENABLED ||= 'true';
  // D1 rejects a leading comment-only line in exec(), so strip comments first.
  const statements = schema
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await e.DB.prepare(stmt).run();

  const setup = await api('/api/setup', 'POST', { email: 'owner@test.dev', password: 'password123', timezone: 'Europe/Berlin' });
  expect(setup.status).toBe(201);
  captureCookies(setup);
});

test('setup/status requires a session', async () => {
  const res = await api('/api/setup/status', 'GET');
  expect(res.status).toBe(401);
});

test('setup/status reports honest booleans on a bare deployment', async () => {
  setEnv({
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    META_CLIENT_ID: undefined,
    META_CLIENT_SECRET: undefined,
    THREADS_CLIENT_ID: undefined,
    THREADS_CLIENT_SECRET: undefined,
    LINKEDIN_CLIENT_ID: undefined,
    LINKEDIN_CLIENT_SECRET: undefined,
    X_CLIENT_ID: undefined,
    X_CLIENT_SECRET: undefined,
    INSTAGRAM_CLIENT_ID: undefined,
    INSTAGRAM_CLIENT_SECRET: undefined,
  });
  const res = await api('/api/setup/status', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  const text = await res.text();
  // Secrets appear as set/unset booleans only — never values.
  expect(text).not.toContain(SECRET);

  const body = JSON.parse(text) as SetupStatusBody;
  expect(body.deployment.d1).toBe(true);
  expect(body.deployment.r2).toBe(true);
  expect(body.deployment.cron).toBe('unknown'); // never ticked in a fresh dev DB
  expect(typeof body.deployment.appUrl).toBe('string');
  expect((body.deployment.appUrl as string).length).toBeGreaterThan(0);
  expect(body.deployment.encryptionSecretSet).toBe(true);
  expect(body.deployment.sessionSecretSet).toBe(true);
  expect(body.deployment.mediaPresignReady).toBe(false);

  expect(body.owner).toEqual({ exists: true, email: 'owner@test.dev' });
  expect(body.accounts).toEqual([]);

  const byProvider = Object.fromEntries(body.providers.map((p) => [p.provider, p]));
  expect(byProvider.facebook?.configured).toBe(false);
  expect(byProvider.facebook?.reason).toContain('META_CLIENT_ID');
  expect(byProvider.facebook?.badge).toBe('not_configured');
  expect(byProvider.threads?.configured).toBe(false);
  expect(byProvider.threads?.reason).toContain('THREADS_CLIENT_ID');
  expect(byProvider.linkedin?.configured).toBe(false);
  expect(byProvider.linkedin?.reason).toContain('LINKEDIN_CLIENT_ID');
  expect(byProvider.bluesky?.configured).toBe(true);
  expect(byProvider.bluesky?.badge).toBe('ready_to_connect');
  expect(byProvider.x?.configured).toBe(false);
  expect(byProvider.x?.reason).toContain('X_CLIENT_ID');
  expect(byProvider.x?.implemented).toBe(true);
  expect(byProvider.instagram?.configured).toBe(false);
  expect(byProvider.instagram?.reason).toContain('INSTAGRAM_CLIENT_ID');
  expect(byProvider.instagram?.implemented).toBe(true);
  for (const p of ['reddit', 'tiktok']) {
    expect(byProvider[p]?.configured).toBe(false);
    expect(byProvider[p]?.implemented).toBe(false);
    expect(byProvider[p]?.badge).toBe('not_configured');
  }

  const keys = body.checklist.map((c) => c.key);
  expect(keys).toEqual([
    'owner_configured',
    'provider_configured',
    'account_connected',
    'media_upload_ready',
    'publish_now_tested',
    'scheduled_tested',
    'evidence_stored',
  ]);
  const done = Object.fromEntries(body.checklist.map((c) => [c.key, c.done]));
  expect(done.owner_configured).toBe(true);
  expect(done.provider_configured).toBe(false);
  expect(done.account_connected).toBe(false);
  expect(done.media_upload_ready).toBe(false);
  expect(done.publish_now_tested).toBe(false);
  expect(done.scheduled_tested).toBe(false);
  expect(done.evidence_stored).toBe(false);
  for (const c of body.checklist) expect(c.label.length).toBeGreaterThan(0);
});

test('cron flag reads real last_tick_at freshness', async () => {
  const t = nowS();
  await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_tick_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(String(t))
    .run();
  expect((await setupStatus()).deployment.cron).toBe(true);

  await e.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'last_tick_at'`).bind(String(t - 3600)).run();
  expect((await setupStatus()).deployment.cron).toBe(false);
});

test('checklist flips only from real publish evidence', async () => {
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, timezone, publish_mode, created_at, updated_at, completed_at)
       VALUES (?, 'owner', 'now caption', 'published', ?, 'UTC', 'now', ?, ?, ?)`,
    )
    .bind('post_ck_now', t, t, t, t)
    .run();
  await e.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, timezone, publish_mode, created_at, updated_at, completed_at)
       VALUES (?, 'owner', 'sched caption', 'published', ?, 'UTC', 'scheduled', ?, ?, ?)`,
    )
    .bind('post_ck_sched', t + 3600, t, t, t)
    .run();
  await e.DB
    .prepare(
      `INSERT INTO post_targets (id, post_id, platform, status, scheduled_at, provider_post_id, provider_permalink, published_at, created_at, updated_at)
       VALUES (?, ?, 'mock', 'published', ?, ?, ?, ?, ?, ?)`,
    )
    .bind('tgt_ck_now', 'post_ck_now', t, 'mock_ev_now', 'https://mock.social/p/mock_ev_now', t, t, t)
    .run();
  await e.DB
    .prepare(
      `INSERT INTO post_targets (id, post_id, platform, status, scheduled_at, provider_post_id, provider_permalink, published_at, created_at, updated_at)
       VALUES (?, ?, 'bluesky', 'published', ?, ?, ?, ?, ?, ?)`,
    )
    .bind('tgt_ck_sched', 'post_ck_sched', t + 3600, 'mock_ev_sched', 'https://bsky.app/p/mock_ev_sched', t + 3600, t + 3600, t + 3600)
    .run();
  await e.DB
    .prepare(`INSERT INTO publishing_attempts (id, post_target_id, attempt_number, started_at, finished_at, result) VALUES (?, ?, 1, ?, ?, 'confirmed')`)
    .bind('pa_ck_1', 'tgt_ck_now', t, t)
    .run();

  const done = Object.fromEntries((await setupStatus()).checklist.map((c) => [c.key, c.done]));
  expect(done.publish_now_tested).toBe(true);
  expect(done.scheduled_tested).toBe(true);
  expect(done.evidence_stored).toBe(true);
});

test('connected accounts flip account_connected, badges and never leak tokens', async () => {
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, last_verified_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'connected', '{}', ?, ?, ?)`,
    )
    .bind('acc_ck_bsky', 'bluesky', 'did:plc:test123', 'Test.bsky.social', await encryptSecret(SECRET, 'super-secret-bsky-token'), t + 3600, t, t, t)
    .run();

  const body = await setupStatus();
  expect(body.accounts.some((a) => a.id === 'acc_ck_bsky' && a.provider === 'bluesky' && a.displayName === 'Test.bsky.social')).toBe(true);
  const byProvider = Object.fromEntries(body.providers.map((p) => [p.provider, p]));
  expect(byProvider.bluesky?.badge).toBe('connected');
  expect(byProvider.bluesky?.connected).toBe(true);
  const done = Object.fromEntries(body.checklist.map((c) => [c.key, c.done]));
  expect(done.account_connected).toBe(true);
  expect(done.provider_configured).toBe(true);

  const raw = await api('/api/setup/status', 'GET', undefined, { auth: true });
  expect((await raw.text())).not.toContain('super-secret-bsky-token');
});

test('media/:id/url 404s for unknown and foreign media', async () => {
  const t = nowS();
  await e.DB
    .prepare(`INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, 'someone_else', 'image/png', 10, 'foreign.png', 'media/x/foreign.png', ?)`)
    .bind('med_ck_foreign', t)
    .run();

  expect((await api('/api/media/med_does_not_exist/url', 'GET', undefined, { auth: true })).status).toBe(404);
  expect((await api('/api/media/med_ck_foreign/url', 'GET', undefined, { auth: true })).status).toBe(404);
});

test('media/:id/url 503s with a human message without R2 credentials', async () => {
  setEnv({ R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined });
  const t = nowS();
  await e.DB
    .prepare(`INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, 'owner', 'image/png', 10, 'own.png', 'media/own/own.png', ?)`)
    .bind('med_ck_own', t)
    .run();
  const res = await api('/api/media/med_ck_own/url', 'GET', undefined, { auth: true });
  expect(res.status).toBe(503);
  expect(((await res.json()) as { error: string }).error).toMatch(/not configured/i);
});

test('media/:id/url returns a locally-signed presigned GET when R2 credentials exist', async () => {
  setEnv({ R2_ACCOUNT_ID: 'acctck123', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret-access' });
  const t = nowS();
  await e.DB
    .prepare(`INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, 'owner', 'image/png', 10, 'own.png', 'media/own/own.png', ?)`)
    .bind('med_ck_presign', t)
    .run();
  const res = await api('/api/media/med_ck_presign/url', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  const url = ((await res.json()) as { url: string }).url;
  // aws4fetch signs locally; no network call happens here.
  expect(url.startsWith('https://acctck123.r2.cloudflarestorage.com/cotly-media/media/own/own.png')).toBe(true);
  expect(url).toContain('X-Amz-Signature=');
  expect(url).toContain('X-Amz-Expires=3600');
});

test('accounts/:id/test maps adapter support honestly', async () => {
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'connected', '{}', ?, ?)`,
    )
    .bind('acc_ck_x', 'reddit', 'reddit_user_1', 'Reddit Account', await encryptSecret(SECRET, 'super-secret-x-token'), t + 3600, t, t)
    .run();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'connected', '{}', ?, ?)`,
    )
    .bind('acc_ck_test', 'bluesky', 'did:plc:test456', 'Test.bsky.social', await encryptSecret(SECRET, 'super-secret-bsky-token'), t + 3600, t, t)
    .run();

  expect((await api('/api/accounts/acc_does_not_exist/test', 'POST', undefined, { auth: true, csrf: true })).status).toBe(404);

  // 'reddit' has no adapter at all — must be a 400, never a 500.
  const xRes = await api('/api/accounts/acc_ck_x/test', 'POST', undefined, { auth: true, csrf: true });
  expect(xRes.status).toBe(400);
  expect(((await xRes.json()) as { error: string }).error).toMatch(/not available/i);

  // Bluesky HAS an adapter: 400 only while the adapter lacks testConnection,
  // 200 {ok, detail} once the ADAPTERS agent ships it. Either way: no tokens.
  const testRes = await api('/api/accounts/acc_ck_test/test', 'POST', undefined, { auth: true, csrf: true });
  if (bskySupportsTest) {
    expect(testRes.status).toBe(200);
    const body = (await testRes.json()) as { ok: boolean; detail: string };
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.toLowerCase()).not.toContain('super-secret-bsky-token');
  } else {
    expect(testRes.status).toBe(400);
    expect(((await testRes.json()) as { error: string }).error).toMatch(/not available/i);
  }
});

test('diagnostics includes deployment and cleanup from real state', async () => {
  setEnv({ R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined });
  const res = await api('/api/diagnostics', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    deployment: { d1: boolean; mediaPresignReady: boolean };
    cleanup: { lastCleanupAt: number | null };
  };
  expect(body.deployment.d1).toBe(true);
  expect(body.deployment.mediaPresignReady).toBe(false);
  expect(body.cleanup.lastCleanupAt).toBeNull();

  const t = nowS();
  await e.DB
    .prepare(`INSERT INTO activity_log (id, level, event, ref_type, ref_id, message, created_at) VALUES (?, 'info', 'media_cleanup', 'media', 'med_ck_own', 'Deleted 1 expired media object(s).', ?)`)
    .bind('act_ck_1', t)
    .run();
  const res2 = await api('/api/diagnostics', 'GET', undefined, { auth: true });
  const body2 = (await res2.json()) as { cleanup: { lastCleanupAt: number | null } };
  expect(body2.cleanup.lastCleanupAt).toBe(t);
});
