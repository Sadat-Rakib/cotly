import { beforeAll, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import { encryptSecret, randomId } from '../lib/crypto';
import { runSchedulerTick } from './cron';
import schema from '../../migrations/0001_init.sql?raw';

const e = env as unknown as Env;
const SECRET = 'test-encryption-secret-0123456789abcdef';

const nowS = (): number => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  // Secrets are not part of wrangler.toml vars; provide one if the pool did not load .dev.vars.
  (env as unknown as { ENCRYPTION_SECRET?: string }).ENCRYPTION_SECRET ||= SECRET;
  // D1 exec() treats a leading comment-only line as an empty statement, so strip
  // comments and run each statement separately.
  const statements = schema
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await e.DB.prepare(stmt).run();
});

interface TargetRow {
  id: string;
  post_id: string;
  status: string;
  caption_override: string | null;
  provider_post_id: string | null;
  provider_permalink: string | null;
  last_error: string | null;
  attempt_count: number;
  publish_generation: number;
  published_at: number | null;
  next_retry_at: number | null;
  scheduled_at: number;
  updated_at: number;
  created_at: number;
}

async function target(id: string): Promise<TargetRow> {
  const r = await e.DB.prepare('SELECT * FROM post_targets WHERE id = ?').bind(id).first<TargetRow>();
  if (!r) throw new Error(`target ${id} missing`);
  return r;
}

async function countAttempts(targetId: string): Promise<number> {
  const r = await e.DB.prepare('SELECT COUNT(*) AS n FROM publishing_attempts WHERE post_target_id = ?').bind(targetId).first<{ n: number }>();
  return r?.n ?? 0;
}

async function postRow(postId: string): Promise<{ status: string; completed_at: number | null }> {
  const r = await e.DB.prepare('SELECT status, completed_at FROM posts WHERE id = ?').bind(postId).first<{ status: string; completed_at: number | null }>();
  if (!r) throw new Error(`post ${postId} missing`);
  return r;
}

async function seedAccount(provider: string): Promise<string> {
  const id = `acc_${randomId(6)}`;
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, provider, `ext_${randomId(4)}`, `${provider} account`, await encryptSecret(SECRET, `token-${randomId(8)}`), t + 3600, 'connected', '{}', t, t)
    .run();
  return id;
}

async function seedPost(
  caption: string,
  accountId: string | null,
  platform: string,
  opts: { scheduledAt?: number; status?: string } = {},
): Promise<{ postId: string; targetId: string }> {
  const postId = `post_${randomId(6)}`;
  const targetId = `tgt_${randomId(6)}`;
  const t = nowS();
  const scheduledAt = opts.scheduledAt ?? t - 1;
  await e.DB
    .prepare(`INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, publish_mode, created_at, updated_at) VALUES (?, 'owner', ?, 'scheduled', ?, 'scheduled', ?, ?)`)
    .bind(postId, caption, scheduledAt, t, t)
    .run();
  await e.DB
    .prepare(`INSERT INTO post_targets (id, post_id, social_account_id, platform, status, scheduled_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(targetId, postId, accountId, platform, opts.status ?? 'scheduled', scheduledAt, t, t)
    .run();
  return { postId, targetId };
}

async function seedMedia(postId: string): Promise<{ mediaId: string; r2Key: string }> {
  const mediaId = `med_${randomId(6)}`;
  const r2Key = `media/${randomId(6)}/test.png`;
  await e.MEDIA.put(r2Key, 'fake-image-bytes');
  await e.DB.prepare(`INSERT INTO media (id, owner_id, mime, size, r2_key, created_at) VALUES (?, 'owner', 'image/png', 16, ?, ?)`).bind(mediaId, r2Key, nowS()).run();
  await e.DB.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?,?,0)').bind(postId, mediaId).run();
  return { mediaId, r2Key };
}

// Simulates the wait for a backoff window to elapse (and optionally a caption fix).
async function reschedule(targetId: string, captionOverride?: string): Promise<void> {
  await e.DB
    .prepare(`UPDATE post_targets SET status = 'scheduled', scheduled_at = ?, next_retry_at = NULL, caption_override = COALESCE(?, caption_override) WHERE id = ?`)
    .bind(nowS() - 1, captionOverride ?? null, targetId)
    .run();
}

test('due target publishes with provider evidence', async () => {
  const acc = await seedAccount('mock');
  const { postId, targetId } = await seedPost('Hello world', acc, 'mock');

  await runSchedulerTick(e);

  const t = await target(targetId);
  expect(t.status).toBe('published');
  expect(t.provider_post_id).toMatch(/^mock_/);
  expect(t.provider_permalink).toContain(t.provider_post_id!);
  expect(t.published_at).toBeGreaterThan(0);
  expect(t.attempt_count).toBe(1);
  expect(t.next_retry_at).toBeNull();
  expect(await countAttempts(targetId)).toBe(1);
  const attempt = await e.DB.prepare('SELECT result, attempt_number, retryable FROM publishing_attempts WHERE post_target_id = ?').bind(targetId).first<{ result: string; attempt_number: number; retryable: number | null }>();
  expect(attempt?.result).toBe('confirmed');
  expect(attempt?.attempt_number).toBe(1);
  const accRow = await e.DB.prepare('SELECT last_verified_at FROM social_accounts WHERE id = ?').bind(acc).first<{ last_verified_at: number | null }>();
  expect(accRow?.last_verified_at).toBeGreaterThan(0);
  const post = await postRow(postId);
  expect(post.status).toBe('published');
  expect(post.completed_at).toBeGreaterThan(0);
  const lastTick = await e.DB.prepare(`SELECT value FROM settings WHERE key = 'last_tick_at'`).first<{ value: string }>();
  expect(Number(lastTick?.value)).toBeGreaterThan(0);
});

test('concurrent ticks claim a due target exactly once', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Only once', acc, 'mock');

  await Promise.all([runSchedulerTick(e), runSchedulerTick(e)]);

  const t = await target(targetId);
  expect(t.status).toBe('published');
  expect(await countAttempts(targetId)).toBe(1);
});

test('[mock:429] failure retries per ladder then recovers', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Rate limited [mock:429]', acc, 'mock');

  await runSchedulerTick(e);
  let t = await target(targetId);
  expect(t.status).toBe('retrying');
  expect(t.attempt_count).toBe(1);
  expect(t.next_retry_at! - t.updated_at).toBe(120);
  expect(t.last_error).toMatch(/rate-limited/i);

  await reschedule(targetId, 'Rate limited'); // wait out backoff + fault removed
  await runSchedulerTick(e);
  t = await target(targetId);
  expect(t.status).toBe('published');
  expect(t.attempt_count).toBe(2);
  const attempts = await e.DB.prepare('SELECT result FROM publishing_attempts WHERE post_target_id = ? ORDER BY attempt_number').bind(targetId).all<{ result: string }>();
  expect(attempts.results?.map((r) => r.result)).toEqual(['failed', 'confirmed']);
});

test('retryable failures give up after 5 attempts', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Always limited [mock:429]', acc, 'mock');

  for (let i = 0; i < 5; i++) {
    await reschedule(targetId); // skip the backoff window each round
    await runSchedulerTick(e);
    const t = await target(targetId);
    if (i < 4) expect(t.status).toBe('retrying');
  }
  const t = await target(targetId);
  expect(t.status).toBe('failed');
  expect(t.attempt_count).toBe(5);
  expect(t.next_retry_at).toBeNull();
  expect(t.last_error).toMatch(/gave up after 5 attempts/i);
});

test('[mock:expire] flags account and publishes exactly once after reconnect', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Expiring [mock:expire]', acc, 'mock');

  await runSchedulerTick(e);
  let t = await target(targetId);
  expect(t.status).toBe('needs_reconnect');
  expect(t.last_error).toMatch(/reconnect/i);
  const accRow = await e.DB.prepare('SELECT status FROM social_accounts WHERE id = ?').bind(acc).first<{ status: string }>();
  expect(accRow?.status).toBe('needs_reconnect');
  const alerts = await e.DB.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE event = 'needs_reconnect' AND ref_id = ? AND level = 'error'`).bind(targetId).first<{ n: number }>();
  expect(alerts?.n).toBe(1);

  // Owner reconnects and hits retry: new generation, no fault token.
  await e.DB.prepare(`UPDATE social_accounts SET status = 'connected' WHERE id = ?`).bind(acc).run();
  await e.DB
    .prepare(`UPDATE post_targets SET status = 'scheduled', scheduled_at = ?, next_retry_at = NULL, caption_override = 'Expiring', publish_generation = publish_generation + 1 WHERE id = ?`)
    .bind(nowS() - 1, targetId)
    .run();
  await runSchedulerTick(e);

  t = await target(targetId);
  expect(t.status).toBe('published');
  expect(t.provider_post_id).toMatch(/^mock_/);
  expect(await countAttempts(targetId)).toBe(2);
  const confirmed = await e.DB.prepare(`SELECT COUNT(*) AS n FROM publishing_attempts WHERE post_target_id = ? AND result = 'confirmed'`).bind(targetId).first<{ n: number }>();
  expect(confirmed?.n).toBe(1); // no duplicate post
});

test('[mock:dupe] replay returns the same external id', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Dupe [mock:dupe]', acc, 'mock');

  await runSchedulerTick(e);
  const first = await target(targetId);
  expect(first.status).toBe('published');

  // Replay the same publish (same idempotency key = same target + generation).
  await reschedule(targetId);
  await runSchedulerTick(e);

  const second = await target(targetId);
  expect(second.status).toBe('published');
  expect(second.provider_post_id).toBe(first.provider_post_id);
});

test('[mock:delay] pending resolves to published on a later tick', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const t0 = nowS();
    vi.setSystemTime(t0 * 1000);
    const acc = await seedAccount('mock');
    const { targetId } = await seedPost('Slow [mock:delay]', acc, 'mock');

    await runSchedulerTick(e);
    let t = await target(targetId);
    expect(t.status).toBe('publishing');
    expect(t.provider_post_id).toMatch(/^mockc_/);
    expect(t.published_at).toBeNull();
    expect(t.next_retry_at).toBe(t0 + 60);

    vi.setSystemTime((t0 + 61) * 1000);
    await runSchedulerTick(e);
    t = await target(targetId);
    expect(t.status).toBe('published');
    expect(t.published_at).toBe(t0 + 61);
    expect(t.provider_permalink).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test('[mock:invalidmedia] fails non-retryably with no retry scheduled', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Bad media [mock:invalidmedia]', acc, 'mock');

  await runSchedulerTick(e);

  const t = await target(targetId);
  expect(t.status).toBe('failed');
  expect(t.next_retry_at).toBeNull();
  expect(t.attempt_count).toBe(1);
  expect(t.last_error).toMatch(/unsupported/i);
  const attempt = await e.DB.prepare('SELECT retryable, error_code FROM publishing_attempts WHERE post_target_id = ?').bind(targetId).first<{ retryable: number | null; error_code: string | null }>();
  expect(attempt?.retryable).toBe(0);
  expect(attempt?.error_code).toBe('UNSUPPORTED_MEDIA');
});

test('cancelled target is never published', async () => {
  const acc = await seedAccount('mock');
  const { targetId } = await seedPost('Never sent', acc, 'mock', { scheduledAt: nowS() + 3600 });
  await e.DB.prepare(`UPDATE post_targets SET status = 'cancelled' WHERE id = ?`).bind(targetId).run();

  await runSchedulerTick(e);

  const t = await target(targetId);
  expect(t.status).toBe('cancelled');
  expect(t.published_at).toBeNull();
  expect(await countAttempts(targetId)).toBe(0);
});

test('post rolls up when all targets reach a terminal state', async () => {
  const acc = await seedAccount('mock');
  const assistedAcc = await seedAccount('assisted');
  const { postId, targetId } = await seedPost('Mixed targets', acc, 'mock');
  const t2 = `tgt_${randomId(6)}`;
  await e.DB
    .prepare(`INSERT INTO post_targets (id, post_id, social_account_id, platform, status, scheduled_at, created_at, updated_at) VALUES (?,?,?,?, 'scheduled', ?, ?, ?)`)
    .bind(t2, postId, assistedAcc, 'assisted', nowS() - 1, nowS(), nowS())
    .run();

  await runSchedulerTick(e);

  expect((await target(targetId)).status).toBe('published');
  expect((await target(t2)).status).toBe('assisted');
  let post = await postRow(postId);
  expect(post.status).toBe('published');
  expect(post.completed_at).toBeGreaterThan(0);

  const failing = await seedPost('Failing post [mock:invalidmedia]', acc, 'mock');
  await runSchedulerTick(e);
  post = await postRow(failing.postId);
  expect(post.status).toBe('failed');
  expect(post.completed_at).toBeGreaterThan(0);
});

test('media is cleaned up after retention and never for non-terminal posts', async () => {
  await e.DB.prepare(`INSERT INTO settings (key, value) VALUES ('media_retention_hours', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).run();
  const acc = await seedAccount('mock');
  const { postId, targetId } = await seedPost('With media', acc, 'mock');
  const m1 = await seedMedia(postId);
  const { postId: postId2 } = await seedPost('Still scheduled', acc, 'mock', { scheduledAt: nowS() + 3600 });
  const m2 = await seedMedia(postId2);

  await runSchedulerTick(e);
  expect((await target(targetId)).status).toBe('published');
  expect(await e.MEDIA.head(m1.r2Key)).not.toBeNull(); // within retention

  await e.DB.prepare('UPDATE posts SET completed_at = ? WHERE id = ?').bind(nowS() - 7200, postId).run();
  await runSchedulerTick(e);

  expect(await e.MEDIA.head(m1.r2Key)).toBeNull();
  expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE id = ?').bind(m1.mediaId).first<{ n: number }>())?.n).toBe(0);
  expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM post_media WHERE media_id = ?').bind(m1.mediaId).first<{ n: number }>())?.n).toBe(0);
  // Non-terminal post keeps its media.
  expect(await e.MEDIA.head(m2.r2Key)).not.toBeNull();
  expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE id = ?').bind(m2.mediaId).first<{ n: number }>())?.n).toBe(1);
});
