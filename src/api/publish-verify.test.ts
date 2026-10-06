import { beforeAll, expect, test } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import { encryptSecret, randomId } from '../lib/crypto';
import { handleApi } from './router';
import { runSchedulerTick } from '../engine/cron';
import schema from '../../migrations/0001_init.sql?raw';
import schema0002 from '../../migrations/0002_user_name.sql?raw';
import schema0003 from '../../migrations/0003_user_ownership.sql?raw';
import schema0004 from '../../migrations/0004_media_lifecycle.sql?raw';
import schema0005 from '../../migrations/0005_user_settings.sql?raw';

const e = env as unknown as Env;
const SECRET = 'verify-secret-0123456789abcdef';
const BASE = 'http://localhost:8787';
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const nowS = () => Math.floor(Date.now() / 1000);

let cookie = '';
let csrf = '';
let mockAcc = '';

async function api(path: string, method: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  if (method !== 'GET' && csrf) headers['x-csrf'] = csrf;
  return handleApi(new Request(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), e, ctx);
}

beforeAll(async () => {
  const v = env as unknown as Record<string, string | undefined>;
  v.SESSION_SECRET = SECRET;
  v.ENCRYPTION_SECRET = SECRET;
  v.MOCK_SOCIAL_ENABLED = 'true';
  v.APP_URL = 'http://localhost:8787';
  const runMigration = async (sql: string) => {
    for (const s of sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').split(';').map((x) => x.trim()).filter(Boolean)) {
      await e.DB.prepare(s).run();
    }
  };
  await runMigration(schema);
  await e.DB.prepare(schema0002.trim()).run();
  await runMigration(schema0003);
  await runMigration(schema0004);
  await runMigration(schema0005);
  const setup = await api('/api/setup', 'POST', { email: 'verify@test.dev', password: 'password123', timezone: 'America/Vancouver' });
  expect(setup.status).toBe(201);
  const getSet = (setup.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [setup.headers.get('set-cookie') ?? ''];
  for (const raw of getSet) {
    const pair = raw.split(';')[0] ?? '';
    const i = pair.indexOf('=');
    if (i > 0) {
      const k = pair.slice(0, i).trim();
      const val = pair.slice(i + 1).trim();
      if (k === 'cotly_session') cookie += (cookie ? '; ' : '') + `cotly_session=${val}`;
      if (k === 'cotly_csrf') { csrf = val; cookie += `; cotly_csrf=${val}`; }
    }
  }
  const mock = await api('/api/accounts/mock', 'POST', { displayName: 'Verify Mock' });
  expect(mock.status).toBe(201);
  mockAcc = ((await mock.json()) as { id: string }).id;
});

test('connection survives a fresh login/session', async () => {
  // New session, same owner: the connected account must still be Connected.
  const login = await handleApi(
    new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'verify@test.dev', password: 'password123' }) }),
    e,
    ctx,
  );
  expect(login.status).toBe(200);
  const h = login.headers as unknown as { getSetCookie?: () => string[] };
  const raws = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [login.headers.get('set-cookie') ?? ''];
  let jar = '';
  for (const raw of raws) {
    const pair = raw.split(';')[0] ?? '';
    const i = pair.indexOf('=');
    if (i > 0) jar += (jar ? '; ' : '') + `${pair.slice(0, i).trim()}=${pair.slice(i + 1).trim()}`;
  }
  const list = await handleApi(new Request(`${BASE}/api/accounts`, { headers: { cookie: jar } }), e, ctx);
  expect(list.status).toBe(200);
  const rows = (await list.json()) as Array<{ id: string; status: string }>;
  expect(rows.find((a) => a.id === mockAcc)?.status).toBe('connected');
});

test('version endpoint identifies the running build', async () => {
  const res = await handleApi(new Request(`${BASE}/api/version`), e, ctx);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { app: string; commit: string; builtAt: string };
  expect(body.app).toBe('cotly');
  expect(typeof body.commit).toBe('string');
  expect(body.commit.length).toBeGreaterThan(0);
  expect(typeof body.builtAt).toBe('string');
});

test('Publish Now publishes immediately without waiting for scheduler', async () => {
  const created = await api('/api/posts', 'POST', { baseCaption: 'Verify now', targets: [{ accountId: mockAcc }], mode: 'now' });
  expect(created.status).toBe(201);
  const { postId, status } = (await created.json()) as { postId: string; status: string };
  // create() alone must NOT claim published
  expect(status).toBe('scheduled');
  const pub = await api(`/api/posts/${postId}/publish-now`, 'POST');
  expect(pub.status).toBe(200);
  const body = (await pub.json()) as { status: string; published: number; failed: number; errors: string[] };
  expect(body.status).toBe('published');
  expect(body.published).toBe(1);
  expect(body.failed).toBe(0);
  const t = await e.DB.prepare('SELECT status, provider_post_id FROM post_targets WHERE post_id = ?').bind(postId).first<{ status: string; provider_post_id: string | null }>();
  expect(t?.status).toBe('published');
  expect(t?.provider_post_id).toMatch(/^mock_/);
});

test('Scheduled post auto-publishes when due via the SAME pipeline', async () => {
  const at = nowS() + 3600;
  const created = await api('/api/posts', 'POST', { baseCaption: 'Verify scheduled', targets: [{ accountId: mockAcc }], mode: 'scheduled', scheduledAt: at, timezone: 'America/Vancouver' });
  expect(created.status).toBe(201);
  const { postId } = (await created.json()) as { postId: string };
  // before due: tick must not publish early
  await runSchedulerTick(e);
  let t = await e.DB.prepare('SELECT status, provider_post_id FROM post_targets WHERE post_id = ?').bind(postId).first<{ status: string; provider_post_id: string | null }>();
  expect(t?.status).toBe('scheduled');
  // simulate time passing (server restart safe: state is in D1)
  await e.DB.prepare('UPDATE post_targets SET scheduled_at = ? WHERE post_id = ?').bind(nowS() - 1, postId).run();
  await e.DB.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').bind(nowS() - 1, postId).run();
  await runSchedulerTick(e);
  t = await e.DB.prepare('SELECT status, provider_post_id FROM post_targets WHERE post_id = ?').bind(postId).first<{ status: string; provider_post_id: string | null }>();
  expect(t?.status).toBe('published');
  expect(t?.provider_post_id).toMatch(/^mock_/);
  const p = await e.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(postId).first<{ status: string }>();
  expect(p?.status).toBe('published');
});

test('Failure is shown truthfully, never as Published', async () => {
  const created = await api('/api/posts', 'POST', { baseCaption: 'Bad [mock:invalidmedia]', targets: [{ accountId: mockAcc }], mode: 'now' });
  const { postId } = (await created.json()) as { postId: string };
  const pub = await api(`/api/posts/${postId}/publish-now`, 'POST');
  expect(pub.status).toBe(200);
  const body = (await pub.json()) as { status: string; published: number; failed: number; errors: string[] };
  expect(body.published).toBe(0);
  expect(body.failed).toBe(1);
  expect(body.status).not.toBe('published');
  expect((body.errors ?? []).join(' ')).toMatch(/unsupported/i);
});

test('Expired auth surfaces needs_reconnect, not Published', async () => {
  const created = await api('/api/posts', 'POST', { baseCaption: 'Exp [mock:expire]', targets: [{ accountId: mockAcc }], mode: 'now' });
  const { postId } = (await created.json()) as { postId: string };
  const pub = await api(`/api/posts/${postId}/publish-now`, 'POST');
  const body = (await pub.json()) as { status: string; published: number; needsReconnect: number };
  expect(body.published).toBe(0);
  expect(body.needsReconnect).toBe(1);
  expect(body.status).not.toBe('published');
});

test('Double Publish Now does not duplicate (second after published is 409)', async () => {
  const created = await api('/api/posts', 'POST', { baseCaption: `Double ${randomId(4)}`, targets: [{ accountId: mockAcc }], mode: 'now' });
  const { postId } = (await created.json()) as { postId: string };
  const first = await api(`/api/posts/${postId}/publish-now`, 'POST');
  expect(first.status).toBe(200);
  const attempts1 = await e.DB.prepare('SELECT COUNT(*) AS n FROM publishing_attempts WHERE post_target_id IN (SELECT id FROM post_targets WHERE post_id = ?)').bind(postId).first<{ n: number }>();
  const second = await api(`/api/posts/${postId}/publish-now`, 'POST');
  expect(second.status).toBe(409);
  const attempts2 = await e.DB.prepare('SELECT COUNT(*) AS n FROM publishing_attempts WHERE post_target_id IN (SELECT id FROM post_targets WHERE post_id = ?)').bind(postId).first<{ n: number }>();
  expect(attempts2?.n).toBe(attempts1?.n);
});

test('Mock disabled fails closed instead of faking success', async () => {
  (env as unknown as Record<string, string | undefined>).MOCK_SOCIAL_ENABLED = 'false';
  try {
    const created = await api('/api/posts', 'POST', { baseCaption: `Closed ${randomId(4)}`, targets: [{ accountId: mockAcc }], mode: 'now' });
    const { postId } = (await created.json()) as { postId: string };
    const pub = await api(`/api/posts/${postId}/publish-now`, 'POST');
    const body = (await pub.json()) as { status: string; published: number; failed: number; errors: string[] };
    expect(body.published).toBe(0);
    expect(body.status).not.toBe('published');
    expect((body.errors ?? []).join(' ')).toMatch(/MockSocial is disabled/i);
  } finally {
    (env as unknown as Record<string, string | undefined>).MOCK_SOCIAL_ENABLED = 'true';
  }
});
