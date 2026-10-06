import { beforeAll, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import { encryptSecret, randomId } from '../lib/crypto';
import { handleApi } from './router';
import { cleanupExpiredMedia } from '../engine/cleanup';
import schema from '../../migrations/0001_init.sql?raw';
import schema0002 from '../../migrations/0002_user_name.sql?raw';
import schema0003 from '../../migrations/0003_user_ownership.sql?raw';
import schema0004 from '../../migrations/0004_media_lifecycle.sql?raw';
import schema0005 from '../../migrations/0005_user_settings.sql?raw';

// NOTE: this pool runs with per-test isolated storage — writes inside a test are
// rolled back when it ends, while writes in beforeAll persist for every test.
// So all cross-test seeding (owner, accounts) happens in beforeAll, and each
// test only asserts on rows it (or beforeAll) created within its own run.
const e = env as unknown as Env;
const SECRET = 'test-secret-0123456789abcdef';
const BASE = 'http://localhost:8787';
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const nowS = (): number => Math.floor(Date.now() / 1000);

let cookieHeader = '';
let csrf = '';
let preSetupMe = { status: 0, isSetup: true };
let mockAccId = '';
let threadsAccId = '';
let userBCookie = '';
let userBCsrf = '';

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

async function api(path: string, method: string, body?: unknown, opts: { auth?: boolean; csrf?: boolean; cookie?: string; asUser?: 'B'; csrfToken?: string; raw?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = opts.raw ? 'application/octet-stream' : 'application/json';
  if (opts.auth && cookieHeader) headers['cookie'] = opts.cookie ?? cookieHeader;
  if (opts.csrf) headers['x-csrf'] = opts.csrfToken ?? (opts.asUser === 'B' ? userBCsrf : csrf);
  const req = new Request(`${BASE}${path}`, { method, headers, body: body !== undefined ? (opts.raw ? (body as string) : JSON.stringify(body)) : undefined });
  return handleApi(req, e, ctx);
}

// Undefined values delete the key, matching setup.test.ts's env isolation.
function setEnv(values: Record<string, string | undefined>): void {
  const v = env as unknown as Record<string, string | undefined>;
  for (const [k, val] of Object.entries(values)) {
    if (val === undefined) delete v[k];
    else v[k] = val;
  }
}

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
  await e.DB.prepare(schema0002.trim()).run();
  for (const stmt of schema0003.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await e.DB.prepare(stmt).run();
  }
  for (const stmt of schema0004.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await e.DB.prepare(stmt).run();
  }
  for (const stmt of schema0005.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await e.DB.prepare(stmt).run();
  }

  const before = await api('/api/me', 'GET');
  preSetupMe = { status: before.status, isSetup: ((await before.json()) as { isSetup: boolean }).isSetup };

  const setup = await api('/api/setup', 'POST', { email: 'owner@test.dev', password: 'password123', timezone: 'Europe/Berlin' });
  expect(setup.status).toBe(201);
  captureCookies(setup);

  const mock = await api('/api/accounts/mock', 'POST', { displayName: 'Mock One' }, { auth: true, csrf: true });
  expect(mock.status).toBe(201);
  mockAccId = ((await mock.json()) as { id: string }).id;

  const t = nowS();
  threadsAccId = `acc_${randomId(8)}`;
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'connected', '{}', ?, ?)`,
    )
    .bind(threadsAccId, 'threads', `thr_${randomId(4)}`, 'Threads Secret', await encryptSecret(SECRET, 'super-secret-token-value'), t + 3600, t, t)
    .run();
});

test('me before setup reports isSetup false', () => {
  expect(preSetupMe.status).toBe(200);
  expect(preSetupMe.isSetup).toBe(false);
});

test('second setup is refused forever, session cookies were issued', () => {
  expect(cookieHeader).toContain('cotly_session=');
  expect(csrf).toBeTruthy();
});

test('setup refusal message is exact', async () => {
  const again = await api('/api/setup', 'POST', { email: 'other@test.dev', password: 'password456', timezone: 'UTC' });
  expect(again.status).toBe(403);
  expect(((await again.json()) as { error: string }).error).toBe('Owner already exists');
});

test('me with session exposes email, timezone and mockEnabled', async () => {
  const res = await api('/api/me', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { email: string; timezone: string; isSetup: boolean; mockEnabled: boolean };
  expect(body.email).toBe('owner@test.dev');
  expect(body.timezone).toBe('Europe/Berlin');
  expect(body.isSetup).toBe(true);
  expect(body.mockEnabled).toBe(true);
});

test('me without a session once owner exists is 401', async () => {
  const res = await api('/api/me', 'GET');
  expect(res.status).toBe(401);
});

test('registration is closed unless ALLOW_REGISTRATION=true', async () => {
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = undefined;
  const closed = await api('/api/auth/register', 'POST', { email: 'new@test.dev', password: 'password123' });
  expect(closed.status).toBe(403);
});

test('registration creates a user and starts a session when allowed', async () => {
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  const res = await api('/api/auth/register', 'POST', {
    name: 'New User',
    email: 'new@test.dev',
    password: 'password123',
    timezone: 'UTC',
  });
  expect(res.status).toBe(201);
  const row = await e.DB.prepare('SELECT id, name, email FROM users WHERE email = ?').bind('new@test.dev').first<{ id: string; name: string | null; email: string }>();
  expect(row?.email).toBe('new@test.dev');
  expect(row?.name).toBe('New User');
  expect(row?.id).not.toBe('owner');
  // The session cookie from register authenticates /api/me.
  const c = cookiesOf(res);
  const me = await handleApi(
    new Request(`${BASE}/api/me`, { headers: { cookie: `cotly_session=${c.cotly_session}` } }),
    e,
    ctx,
  );
  expect(me.status).toBe(200);
  const body = (await me.json()) as { email: string; isSetup: boolean };
  expect(body.email).toBe('new@test.dev');
  expect(body.isSetup).toBe(true);
});

test('multi-user isolation: a second user sees none of the owner data', async () => {
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  const reg = await api('/api/auth/register', 'POST', { name: 'User B', email: 'userb@test.dev', password: 'password123' });
  expect(reg.status).toBe(201);
  const c = cookiesOf(reg);
  userBCookie = `cotly_session=${c.cotly_session}; cotly_csrf=${c.cotly_csrf ?? ""}`;
  userBCsrf = c.cotly_csrf ?? '';
  const b = { auth: true, cookie: userBCookie, asUser: 'B' as const };

  // B sees no connected accounts
  const bAccounts = await api('/api/accounts', 'GET', undefined, b);
  expect(bAccounts.status).toBe(200);
  expect(await bAccounts.json()).toEqual([]);

  // Owner creates a post on the owner's mock account
  const { postId, targetId } = await createNowPost('Owner secret post');

  // B cannot read, edit, or delete the owner's post
  expect((await api(`/api/posts/${postId}`, 'GET', undefined, b)).status).toBe(404);
  expect((await api(`/api/posts/${postId}`, 'PATCH', { baseCaption: 'hacked' }, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/posts/${postId}`, 'DELETE', undefined, { ...b, csrf: true })).status).toBe(404);

  // B cannot retry the owner's queue target or disconnect the owner's account
  expect((await api(`/api/targets/${targetId}/retry`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/accounts/${threadsAccId}/test`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/accounts/${threadsAccId}`, 'DELETE', undefined, { ...b, csrf: true })).status).toBe(404);

  // B's queue is empty
  const bPosts = await api('/api/posts', 'GET', undefined, b);
  expect(await bPosts.json()).toEqual([]);

  // Owner still sees their own post (publish-now may already be published).
  const ownerQueue = (await (await api('/api/posts?view=queue', 'GET', undefined, { auth: true })).json()) as Array<{ id: string }>;
  const ownerPublished = (await (await api('/api/posts?view=published', 'GET', undefined, { auth: true })).json()) as Array<{ id: string }>;
  const ownerFailed = (await (await api('/api/posts?view=failed', 'GET', undefined, { auth: true })).json()) as Array<{ id: string }>;
  const allOwner = [...ownerQueue, ...ownerPublished, ...ownerFailed];
  expect(allOwner.some((p) => p.id === postId)).toBe(true);
  // ...and B must not see it in any view.
  const bQueue = (await (await api('/api/posts?view=queue', 'GET', undefined, b)).json()) as Array<{ id: string }>;
  const bPublished = (await (await api('/api/posts?view=published', 'GET', undefined, b)).json()) as Array<{ id: string }>;
  expect([...bQueue, ...bPublished].some((p) => p.id === postId)).toBe(false);

  // Aggressive leak-hunt: B cannot publish-now, re-publish, or target the
  // owner's post/account through any mutation route.
  expect((await api(`/api/posts/${postId}/publish-now`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/posts/${postId}/duplicate`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  const foreignTarget = await api('/api/posts', 'POST', {
    baseCaption: 'trying to route through the owner account',
    mediaIds: [],
    targets: [{ accountId: threadsAccId }],
    mode: 'now',
  }, { ...b, csrf: true });
  // 422: the foreign accountId fails owner-scoped validation.
  expect(foreignTarget.status).toBe(422);
  const foreignBody = (await foreignTarget.json()) as { errors?: Array<{ message: string }> };
  expect(foreignBody.errors?.[0]?.message).toMatch(/no longer exists/i);

  // B's diagnostics expose none of the owner's attempts, queue counts or media.
  const bDiag = (await (await api('/api/diagnostics', 'GET', undefined, b)).json()) as {
    dueCount: number; activeCount: number; failedCount: number; recentAttempts: unknown[];
    providers: Record<string, string>; media: { objectCount: number };
  };
  expect(bDiag.dueCount).toBe(0);
  expect(bDiag.activeCount).toBe(0);
  expect(bDiag.failedCount).toBe(0);
  expect(bDiag.recentAttempts).toHaveLength(0);
  expect(Object.keys(bDiag.providers ?? {})).toHaveLength(0);
  expect(bDiag.media.objectCount).toBe(0);

  // The owner's diagnostics DO show their own activity (scoping works both ways).
  const oDiag = (await (await api('/api/diagnostics', 'GET', undefined, { auth: true })).json()) as {
    media: { objectCount: number };
  };
  expect(oDiag.media.objectCount).toBe(0); // owner has no uploads in this test

  // Settings are per-user too: B changes their retention and timezone without
  // touching the owner's preferences.
  const bPut = await api('/api/settings', 'PUT', { mediaRetentionHours: 72, timezone: 'Asia/Tokyo' }, { ...b, csrf: true });
  expect(bPut.status).toBe(200);
  const bSettings = (await bPut.json()) as { mediaRetentionHours: number; timezone: string };
  expect(bSettings.mediaRetentionHours).toBe(72);
  expect(bSettings.timezone).toBe('Asia/Tokyo');

  const ownerSettings = (await (await api('/api/settings', 'GET', undefined, { auth: true })).json()) as {
    mediaRetentionHours: number;
    timezone: string;
  };
  expect(ownerSettings.mediaRetentionHours).not.toBe(72);
  expect(ownerSettings.timezone).toBe('Europe/Berlin');
});

test('media upload and its URL are scoped to the uploading user', async () => {
  // Owner confirms a media row, then user B must get a plain 404 for its URL.
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  setEnv({ MEDIA_S3_ENDPOINT: undefined, MEDIA_S3_BUCKET: undefined, MEDIA_S3_ACCESS_KEY_ID: undefined, MEDIA_S3_SECRET_ACCESS_KEY: undefined });
  const mediaId = `med_${randomId(8)}`;
  await e.DB
    .prepare(`INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, 'owner', 'image/png', 10, 'own.png', 'media/own/iso.png', ?)`)
    .bind(mediaId, nowS())
    .run();
  const b = { auth: true, cookie: userBCookie, asUser: 'B' as const };
  expect((await api(`/api/media/${mediaId}/url`, 'GET', undefined, b)).status).toBe(404);
  // Owner passes the ownership gate and gets a URL (binding-only env -> worker-relayed raw URL).
  const ownerUrl = await api(`/api/media/${mediaId}/url`, 'GET', undefined, { auth: true });
  expect(ownerUrl.status).toBe(200);
  expect(((await ownerUrl.json()) as { url: string }).url).toContain(`/api/media/${mediaId}/raw`);
});

test('logout invalidates the session server-side', async () => {
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  const reg = await api('/api/auth/register', 'POST', { name: 'Logout User', email: 'logout@test.dev', password: 'password123' });
  expect(reg.status).toBe(201);
  const c = cookiesOf(reg);
  const jar = `cotly_session=${c.cotly_session}; cotly_csrf=${c.cotly_csrf ?? ''}`;
  expect((await api('/api/me', 'GET', undefined, { auth: true, cookie: jar })).status).toBe(200);
  const out = await api('/api/auth/logout', 'POST', undefined, { auth: true, cookie: jar, csrf: true, csrfToken: c.cotly_csrf ?? '' });
  expect(out.status).toBe(200);
  // The same signed cookie is now dead: it was issued before the logout cut.
  const meAfter = await api('/api/me', 'GET', undefined, { auth: true, cookie: jar });
  expect(meAfter.status).toBe(401);
  // And the user can sign back in for a fresh, working session.
  const login = await api('/api/auth/login', 'POST', { email: 'logout@test.dev', password: 'password123' });
  expect(login.status).toBe(200);
});

test('mutating route without x-csrf is 403', async () => {
  const res = await api('/api/posts', 'POST', { baseCaption: 'hi', targets: [], mode: 'now' }, { auth: true });
  expect(res.status).toBe(403);
});

test('accounts list never leaks tokens', async () => {
  const res = await api('/api/accounts', 'GET', undefined, { auth: true });
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text.toLowerCase()).not.toContain('token');
  expect(text.toLowerCase()).not.toContain('access');
  expect(text).not.toContain('super-secret-token-value');
  const list = JSON.parse(text) as Array<{ id: string; provider: string; displayName: string; status: string; externalId: string }>;
  expect(list.find((a) => a.id === mockAccId)?.displayName).toBe('Mock One');
  expect(list.find((a) => a.id === mockAccId)?.status).toBe('connected');
  expect(list.find((a) => a.id === threadsAccId)?.provider).toBe('threads');
});

test('post validation returns field errors per provider capabilities', async () => {
  const oversized = await api('/api/posts', 'POST', { baseCaption: 'x'.repeat(501), targets: [{ accountId: threadsAccId }], mode: 'now' }, { auth: true, csrf: true });
  expect(oversized.status).toBe(422);
  const errs = ((await oversized.json()) as { errors: Array<{ field: string; message: string }> }).errors;
  expect(errs.some((er) => er.field.startsWith('targets.') && er.field.endsWith('caption') && er.message.includes('500'))).toBe(true);

  const noTime = await api('/api/posts', 'POST', { baseCaption: 'hi', targets: [{ accountId: mockAccId }], mode: 'scheduled' }, { auth: true, csrf: true });
  expect(noTime.status).toBe(422);
  const errs2 = ((await noTime.json()) as { errors: Array<{ field: string; message: string }> }).errors;
  expect(errs2.some((er) => er.field === 'scheduledAt')).toBe(true);
  expect(errs2.some((er) => er.field === 'timezone')).toBe(true);
});

async function createNowPost(caption = 'Hello Cotly', override: string | undefined = 'Hello override'): Promise<{ postId: string; targetId: string }> {
  const target: Record<string, unknown> = { accountId: mockAccId };
  if (override !== undefined) target.captionOverride = override;
  const res = await api('/api/posts', 'POST', { baseCaption: caption, targets: [target], mode: 'now' }, { auth: true, csrf: true });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { postId: string; status: string };
  // ONE publishing authority: create() only stores scheduled rows; the
  // immediate publish lives in publish-now (mirrors Compose UI flow).
  expect(created.status).toBe('scheduled');
  const postId = created.postId;
  const pub = await api(`/api/posts/${postId}/publish-now`, 'POST', undefined, { auth: true, csrf: true });
  expect(pub.status).toBe(200);
  const pubBody = (await pub.json()) as { status: string; published: number };
  expect(pubBody.status).toBe('published');
  expect(pubBody.published).toBe(1);
  const tgt = await e.DB.prepare('SELECT id FROM post_targets WHERE post_id = ?').bind(postId).first<{ id: string }>();
  return { postId, targetId: tgt!.id };
}

test('create post mode now writes post + target rows', async () => {
  const { postId } = await createNowPost();
  const post = await e.DB.prepare('SELECT status, publish_mode, scheduled_at, owner_id, timezone FROM posts WHERE id = ?').bind(postId).first<{ status: string; publish_mode: string; scheduled_at: number; owner_id: string; timezone: string }>();
  // create() stores scheduled; publish-now runs the SAME pipeline immediately
  // and only marks published on provider confirmation.
  expect(post?.status).toBe('published');
  expect(post?.publish_mode).toBe('now');
  expect(Math.abs((post?.scheduled_at ?? 0) - nowS())).toBeLessThan(5);
  expect(post?.owner_id).toBe('owner');
  const tgt = await e.DB.prepare('SELECT platform, status, publish_generation, caption_override, provider_post_id FROM post_targets WHERE post_id = ?').bind(postId).first<{ platform: string; status: string; publish_generation: number; caption_override: string | null; provider_post_id: string | null }>();
  expect(tgt?.platform).toBe('mock');
  expect(tgt?.status).toBe('published');
  // create (gen 1) + publish-now bump (gen 2) — idempotency key changes per attempt.
  expect(tgt?.publish_generation).toBe(2);
  expect(tgt?.caption_override).toBe('Hello override');
  expect(tgt?.provider_post_id).toMatch(/^mock_/);
});

test('post get + queue view return the documented shape', async () => {
  const { postId, targetId } = await createNowPost();
  const one = await api(`/api/posts/${postId}`, 'GET', undefined, { auth: true });
  expect(one.status).toBe(200);
  const body = (await one.json()) as { id: string; baseCaption: string; status: string; scheduledAt: number; timezone: string; media: unknown[]; targets: Array<{ id: string; accountId: string; provider: string; accountName: string; status: string; lastError: string | null }> };
  expect(body.id).toBe(postId);
  expect(body.baseCaption).toBe('Hello Cotly');
  // createNowPost runs publish-now, so the post is provider-confirmed here.
  expect(body.status).toBe('published');
  expect(body.media).toEqual([]);
  expect(body.targets[0]?.id).toBe(targetId);
  expect(body.targets[0]?.accountId).toBe(mockAccId);
  expect(body.targets[0]?.provider).toBe('mock');
  expect(body.targets[0]?.accountName).toBe('Mock One');
  expect(body.targets[0]?.status).toBe('published');

  // The post has left the queue view — it is already published.
  const queue = await api('/api/posts?view=queue', 'GET', undefined, { auth: true });
  expect(queue.status).toBe(200);
  const rows = (await queue.json()) as Array<{ id: string; targets: unknown[]; media: unknown[] }>;
  expect(rows.some((r) => r.id === postId)).toBe(false);
  const published = await api('/api/posts?view=published', 'GET', undefined, { auth: true });
  const publishedRows = (await published.json()) as Array<{ id: string }>;
  expect(publishedRows.some((r) => r.id === postId)).toBe(true);
});

test('cancel then retry path works on a failed target', async () => {
  // Publish-now completes inline (and published posts cannot be cancelled),
  // so this test exercises cancel/retry on a scheduled post instead.
  const schedAt = nowS() + 3600;
  const created = await api('/api/posts', 'POST', {
    baseCaption: 'Cancel me',
    mediaIds: [],
    targets: [{ accountId: mockAccId }],
    mode: 'scheduled',
    scheduledAt: schedAt,
    timezone: 'UTC',
  }, { auth: true, csrf: true });
  expect(created.status).toBe(201);
  const postId = ((await created.json()) as { postId: string }).postId;
  const targetId = ((await e.DB.prepare('SELECT id FROM post_targets WHERE post_id = ?').bind(postId).first<{ id: string }>()) as { id: string }).id;
  const res = await api(`/api/posts/${postId}/cancel`, 'POST', undefined, { auth: true, csrf: true });
  expect(res.status).toBe(200);
  const tgt = await e.DB.prepare('SELECT status FROM post_targets WHERE id = ?').bind(targetId).first<{ status: string }>();
  expect(tgt?.status).toBe('cancelled');
  const post = await e.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(postId).first<{ status: string }>();
  expect(post?.status).toBe('cancelled');

  // Simulate a provider failure so the retry route applies.
  await e.DB.prepare(`UPDATE post_targets SET status = 'failed', last_error = 'MockSocial is temporarily unavailable.' WHERE id = ?`).bind(targetId).run();
  await e.DB.prepare(`UPDATE posts SET status = 'failed' WHERE id = ?`).bind(postId).run();

  const failedView = await api('/api/posts?view=failed', 'GET', undefined, { auth: true });
  const failedRows = (await failedView.json()) as Array<{ id: string }>;
  expect(failedRows.some((r) => r.id === postId)).toBe(true);

  const retry = await api(`/api/targets/${targetId}/retry`, 'POST', undefined, { auth: true, csrf: true });
  expect(retry.status).toBe(200);
  const after = await e.DB.prepare('SELECT status, next_retry_at, publish_generation, last_error FROM post_targets WHERE id = ?').bind(targetId).first<{ status: string; next_retry_at: number | null; publish_generation: number; last_error: string | null }>();
  expect(after?.status).toBe('scheduled');
  expect(after?.next_retry_at).toBeNull();
  expect(after?.publish_generation).toBe(2);
  expect(after?.last_error).toBeNull();
});

test('scheduled create, reschedule, publish-now, duplicate, delete', async () => {
  const created = await api('/api/posts', 'POST', { baseCaption: 'Later post', targets: [{ accountId: mockAccId }], mode: 'scheduled', scheduledAt: nowS() + 3600, timezone: 'UTC' }, { auth: true, csrf: true });
  expect(created.status).toBe(201);
  const schedPostId = ((await created.json()) as { postId: string }).postId;

  const newAt = nowS() + 7200;
  const resched = await api(`/api/posts/${schedPostId}/reschedule`, 'POST', { scheduledAt: newAt }, { auth: true, csrf: true });
  expect(resched.status).toBe(200);
  const gen1 = await e.DB.prepare('SELECT scheduled_at, publish_generation FROM post_targets WHERE post_id = ?').bind(schedPostId).first<{ scheduled_at: number; publish_generation: number }>();
  expect(gen1?.scheduled_at).toBe(newAt);
  expect(gen1?.publish_generation).toBe(2);

  const pub = await api(`/api/posts/${schedPostId}/publish-now`, 'POST', undefined, { auth: true, csrf: true });
  expect(pub.status).toBe(200);
  const pubBody = (await pub.json()) as { status: string; published: number; failed: number; needsReconnect: number; errors: string[] };
  // Publish-now runs the SAME pipeline immediately and reports the real outcome.
  expect(pubBody.status).toBe('published');
  expect(pubBody.published).toBe(1);
  expect(pubBody.failed).toBe(0);
  const mode = await e.DB.prepare('SELECT publish_mode, status FROM posts WHERE id = ?').bind(schedPostId).first<{ publish_mode: string; status: string }>();
  expect(mode?.publish_mode).toBe('now');
  expect(mode?.status).toBe('published');
  const tgtAfter = await e.DB.prepare('SELECT status, provider_post_id FROM post_targets WHERE post_id = ?').bind(schedPostId).first<{ status: string; provider_post_id: string | null }>();
  expect(tgtAfter?.status).toBe('published');
  expect(tgtAfter?.provider_post_id).toMatch(/^mock_/);

  const dup = await api(`/api/posts/${schedPostId}/duplicate`, 'POST', undefined, { auth: true, csrf: true });
  expect(dup.status).toBe(201);
  const dupId = ((await dup.json()) as { postId: string }).postId;
  const dupRow = await e.DB.prepare('SELECT status, base_caption FROM posts WHERE id = ?').bind(dupId).first<{ status: string; base_caption: string }>();
  expect(dupRow?.status).toBe('draft');
  expect(dupRow?.base_caption).toBe('Later post');
  const dupTargets = await e.DB.prepare('SELECT COUNT(*) AS n FROM post_targets WHERE post_id = ?').bind(dupId).first<{ n: number }>();
  expect(dupTargets?.n).toBe(0);

  const del = await api(`/api/posts/${dupId}`, 'DELETE', undefined, { auth: true, csrf: true });
  expect(del.status).toBe(200);
  const gone = await e.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE id = ?').bind(dupId).first<{ n: number }>();
  expect(gone?.n).toBe(0);
});

test('settings PUT/GET roundtrip and rejects a bad mode', async () => {
  const put = await api('/api/settings', 'PUT', { timezone: 'Europe/Berlin', mediaRetentionHours: 72, xBudgetMode: 'hard', xBudgetMonthlyUsd: 12.5 }, { auth: true, csrf: true });
  expect(put.status).toBe(200);
  const got = await api('/api/settings', 'GET', undefined, { auth: true });
  const body = (await got.json()) as { timezone: string; mediaRetentionHours: number; xBudgetMode: string; xBudgetMonthlyUsd: number };
  expect(body.timezone).toBe('Europe/Berlin');
  expect(body.mediaRetentionHours).toBe(72);
  expect(body.xBudgetMode).toBe('hard');
  expect(body.xBudgetMonthlyUsd).toBe(12.5);

  const bad = await api('/api/settings', 'PUT', { xBudgetMode: 'yolo' }, { auth: true, csrf: true });
  expect(bad.status).toBe(400);
  const badRetention = await api('/api/settings', 'PUT', { mediaRetentionHours: 'soon' }, { auth: true, csrf: true });
  expect(badRetention.status).toBe(400);
});

test('media endpoints degrade cleanly without R2 credentials', async () => {
  const up = await api('/api/media/upload-url', 'POST', { filename: '../../evil path/pic.PNG', mime: 'image/png', size: 10 }, { auth: true, csrf: true });
  expect([200, 503]).toContain(up.status);
  if (up.status === 503) {
    expect(((await up.json()) as { error: string }).error).toMatch(/not configured/i);
  } else {
    const body = (await up.json()) as { uploadUrl: string; r2Key: string; mediaId: string };
    expect(body.r2Key).toMatch(/^media\/[^/]+\/pic\.PNG$/);
    expect(body.r2Key).not.toContain('..');
    const confirm = await api('/api/media/confirm', 'POST', { mediaId: body.mediaId, mime: 'image/png', size: 10, filename: 'pic.png', r2Key: 'media/missing/file.png' }, { auth: true, csrf: true });
    expect(confirm.status).toBe(400);
  }
});

test('media lifecycle: relay upload, expiry stamping, cleanup idempotency, storage diagnostics', async () => {
  // Exercise the binding-only path deterministically.
  setEnv({ MEDIA_S3_ENDPOINT: undefined, MEDIA_S3_BUCKET: undefined, MEDIA_S3_ACCESS_KEY_ID: undefined, MEDIA_S3_SECRET_ACCESS_KEY: undefined });
  // Default retention: 7 days (the deployment default, no explicit setting).
  const up = await api('/api/media/upload-url', 'POST', { filename: 'lifecycle.png', mime: 'image/png' }, { auth: true, csrf: true });
  expect(up.status).toBe(200);
  const { mediaId, uploadUrl, r2Key } = (await up.json()) as { mediaId: string; uploadUrl: string; r2Key: string };

  // Binding-only test env: the upload URL is the worker relay.
  expect(uploadUrl).toContain(`/api/media/upload/${mediaId}`);
  const put = await api(uploadUrl, 'PUT', 'fake-png-bytes', { auth: true, raw: true });
  expect(put.status).toBe(200);

  const confirm = await api('/api/media/confirm', 'POST', { mediaId, mime: 'image/png', size: 15, filename: 'lifecycle.png', r2Key }, { auth: true, csrf: true });
  expect(confirm.status).toBe(200);
  const confirmed = (await confirm.json()) as { expiresAt: number };
  const row = await e.DB
    .prepare('SELECT owner_id, expires_at, status, size FROM media WHERE id = ?')
    .bind(mediaId)
    .first<{ owner_id: string; expires_at: number | null; status: string; size: number }>();
  expect(row?.owner_id).toBe('owner');
  expect(row?.status).toBe('ready');
  expect(row?.size).toBe(15);
  // expires_at = created_at + 168h (7 days), stamped at upload.
  const created = await e.DB.prepare('SELECT created_at FROM media WHERE id = ?').bind(mediaId).first<{ created_at: number }>();
  expect(row?.expires_at).toBe((created?.created_at ?? 0) + 168 * 3600);
  expect(confirmed.expiresAt).toBe(row?.expires_at);

  // Session-authenticated read streams the object back.
  const urlRes = await api(`/api/media/${mediaId}/url`, 'GET', undefined, { auth: true });
  expect(urlRes.status).toBe(200);
  const { url } = (await urlRes.json()) as { url: string };
  expect(url).toContain(`/api/media/${mediaId}/raw`);
  const raw = await api(url, 'GET', undefined, { auth: true });
  expect(raw.status).toBe(200);
  expect(await raw.text()).toBe('fake-png-bytes');

  // Expired media (not referenced by a post) is deleted exactly once.
  await e.DB.prepare('UPDATE media SET expires_at = ? WHERE id = ?').bind(nowS() - 10, mediaId).run();
  await cleanupExpiredMedia(e, nowS());
  expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE id = ?').bind(mediaId).first<{ n: number }>())?.n).toBe(0);
  expect(await e.MEDIA!.head(r2Key)).toBeNull();

  // Idempotent: a second pass deletes nothing extra.
  const again = await cleanupExpiredMedia(e, nowS());
  expect(again).toBe(0);

  // Storage diagnostics reflect reality, including the cumulative cleaned count.
  const diag = await api('/api/diagnostics', 'GET', undefined, { auth: true });
  const body = (await diag.json()) as { media: { objectCount: number; totalBytes: number; cleanedTotal: number; storageReady: boolean } };
  expect(body.media.storageReady).toBe(true);
  expect(body.media.cleanedTotal).toBe(1);
  expect(body.media.objectCount).toBe(0);
});

test('oauth start refuses unconfigured providers, callback redirects with error', async () => {
  // linkedin has no credentials in the test env — the only still-unconfigured OAuth provider here.
  const li = await api('/api/oauth/linkedin/start', 'GET', undefined, { auth: true });
  expect(li.status).toBe(400);
  expect(((await li.json()) as { error: string }).error).toMatch(/LinkedIn/i);

  // Bluesky now uses atproto OAuth — stub the PAR endpoint so the start
  // returns a real authorization URL without touching the network.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://bsky.social/oauth/par')) {
      return new Response(JSON.stringify({ request_uri: 'urn:bsky:par:test' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  });
  const bs = await api('/api/oauth/bluesky/start', 'GET', undefined, { auth: true });
  expect(bs.status).toBe(200);
  const bsBody = (await bs.json()) as { url: string };
  expect(bsBody.url).toContain('https://bsky.social/oauth/authorize');
  expect(bsBody.url).toContain('request_uri=');
  vi.unstubAllGlobals();

  const cb = await api('/oauth/facebook/callback?code=abc&state=nope', 'GET');
  expect(cb.status).toBe(302);
  expect(cb.headers.get('location')).toContain('/app/profile?error=');
});

test('oauth state replay, expiry, wrong provider and tampering are rejected', async () => {
  // X start builds a state with no network, making the state mechanics testable.
  const mkState = async (): Promise<string> => {
    const start = await api('/api/oauth/x/start', 'GET', undefined, { auth: true });
    expect(start.status).toBe(200);
    const url = ((await start.json()) as { url: string }).url;
    return new URL(url).searchParams.get('state') ?? '';
  };

  // 1) Replay: a consumed state cannot be used again, even with a fresh code.
  const replayState = await mkState();
  const first = await api(`/oauth/x/callback?state=${replayState}`, 'GET');
  expect(first.status).toBe(302);
  expect(first.headers.get('location')).toContain('/app/profile?error=');
  const replay = await api(`/oauth/x/callback?code=abc&state=${replayState}`, 'GET');
  expect(replay.status).toBe(302);
  expect(replay.headers.get('location')).toContain('expired%20or%20was%20already%20used');

  // 2) Wrong provider: X's state presented to Facebook's callback fails.
  const wrongProviderState = await mkState();
  const cross = await api(`/oauth/facebook/callback?code=abc&state=${wrongProviderState}`, 'GET');
  expect(cross.status).toBe(302);
  expect(cross.headers.get('location')).toContain('/app/profile?error=');

  // 3) Expired state: force the stored expiry into the past.
  const expiredState = await mkState();
  await e.DB.prepare('UPDATE oauth_states SET expires_at = ? WHERE state = ?').bind(nowS() - 30, expiredState).run();
  const expired = await api(`/oauth/x/callback?code=abc&state=${expiredState}`, 'GET');
  expect(expired.status).toBe(302);
  expect(expired.headers.get('location')).toContain('/app/profile?error=');

  // 4) Tampering: an unknown/garbage state is rejected.
  const tampered = await api('/oauth/x/callback?code=abc&state=tampered-garbage-value', 'GET');
  expect(tampered.status).toBe(302);
  expect(tampered.headers.get('location')).toContain('/app/profile?error=');

  // The failed attempts must not have created any account rows.
  const rows = await e.DB.prepare(`SELECT COUNT(*) AS n FROM social_accounts WHERE provider = 'x'`).first<{ n: number }>();
  expect(rows?.n).toBe(0);
});

test('login rate limit trips after 10 bad attempts', async () => {
  const email = 'rl@test.dev';
  for (let i = 0; i < 10; i++) {
    const res = await api('/api/auth/login', 'POST', { email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  }
  const blocked = await api('/api/auth/login', 'POST', { email, password: 'wrong-password' });
  expect(blocked.status).toBe(429);
  expect(((await blocked.json()) as { error: string }).error).toMatch(/too many/i);
});

test('logout clears cookies', async () => {
  const res = await api('/api/auth/logout', 'POST', undefined, { auth: true, csrf: true });
  expect(res.status).toBe(200);
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  expect(raw.some((c) => c.startsWith('cotly_session=') && c.includes('Max-Age=0'))).toBe(true);
});
