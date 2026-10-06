import { beforeAll, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../contracts/env';
import { encryptSecret, randomId } from '../lib/crypto';
import { runSchedulerTick, publishPostNow } from './cron';
import schema from '../../migrations/0001_init.sql?raw';
import schema0002 from '../../migrations/0002_user_name.sql?raw';
import schema0003 from '../../migrations/0003_user_ownership.sql?raw';
import schema0004 from '../../migrations/0004_media_lifecycle.sql?raw';
import schema0005 from '../../migrations/0005_user_settings.sql?raw';

// Proves the state machine never strands work: no permanent PUBLISHING,
// Publish Now is scoped to one post, X 403 never flips the account, and a
// reconnect with fresh credentials recovers without duplicates.
const e = env as unknown as Env;
const SECRET = 'test-encryption-secret-0123456789abcdef';
const nowS = (): number => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  (env as unknown as { ENCRYPTION_SECRET?: string }).ENCRYPTION_SECRET = SECRET;
  (env as unknown as Record<string, string | undefined>).MOCK_SOCIAL_ENABLED = 'true';
  (env as unknown as Record<string, string | undefined>).X_API_ENABLED = 'true';
  (env as unknown as Record<string, string | undefined>).X_MAX_MONTHLY_SPEND_USD = '5';
  for (const k of ['MEDIA_S3_ENDPOINT', 'MEDIA_S3_BUCKET', 'MEDIA_S3_REGION', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY']) {
    delete (env as unknown as Record<string, string | undefined>)[k];
  }
  const runMigration = async (sql: string) => {
    for (const stmt of sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await e.DB.prepare(stmt).run();
    }
  };
  await runMigration(schema);
  await e.DB.prepare(schema0002.trim()).run();
  await runMigration(schema0003);
  await runMigration(schema0004);
  await runMigration(schema0005);
});

async function seedAccount(provider: string, token = `token-${randomId(8)}`): Promise<string> {
  const id = `acc_${randomId(6)}`;
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, provider, `ext_${randomId(4)}`, `${provider} account`, await encryptSecret(SECRET, token), t + 3600, 'connected', '{}', t, t)
    .run();
  return id;
}

async function seedPost(caption: string, accountId: string | null, platform: string): Promise<{ postId: string; targetId: string }> {
  const postId = `post_${randomId(6)}`;
  const targetId = `tgt_${randomId(6)}`;
  const t = nowS();
  await e.DB
    .prepare(`INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, publish_mode, created_at, updated_at) VALUES (?, 'owner', ?, 'scheduled', ?, 'scheduled', ?, ?)`)
    .bind(postId, caption, t - 1, t, t)
    .run();
  await e.DB
    .prepare(`INSERT INTO post_targets (id, post_id, social_account_id, platform, status, scheduled_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(targetId, postId, accountId, platform, 'scheduled', t - 1, t, t)
    .run();
  return { postId, targetId };
}

const targetStatus = async (id: string): Promise<string> =>
  (await e.DB.prepare('SELECT status FROM post_targets WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? '';

const accountStatus = async (id: string): Promise<string> =>
  (await e.DB.prepare('SELECT status FROM social_accounts WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? '';

test('stale in-flight rows are reclaimed, never stuck in PUBLISHING', async () => {
  const acc = await seedAccount('mock');
  const old = nowS() - 601; // older than the 5-minute stale threshold
  // A 'claimed' row whose tick died mid-flight.
  const { targetId: claimedId } = await seedPost('Stale claimed', acc, 'mock');
  await e.DB.prepare(`UPDATE post_targets SET status = 'claimed', updated_at = ? WHERE id = ?`).bind(old, claimedId).run();
  // A 'publishing' orphan: guard ran, outcome never written (crash/restart).
  const { targetId: orphanId, postId: orphanPostId } = await seedPost('Stale orphan', acc, 'mock');
  await e.DB.prepare(`UPDATE post_targets SET status = 'publishing', updated_at = ? WHERE id = ?`).bind(old, orphanId).run();
  // A legitimate pending confirmation must NOT be touched.
  const { targetId: pendingId } = await seedPost('Legit pending [mock:delay]', acc, 'mock');
  await runSchedulerTick(e); // pendingId -> publishing + container id, next_retry_at = now+60
  expect(await targetStatus(pendingId)).toBe('publishing');
  const pendingRow = await e.DB.prepare('SELECT provider_post_id FROM post_targets WHERE id = ?').bind(pendingId).first<{ provider_post_id: string | null }>();

  await runSchedulerTick(e); // reclaims the two stale rows and publishes them (same tick)

  expect(await targetStatus(claimedId)).toBe('published');
  expect(await targetStatus(orphanId)).toBe('published');
  const orphanPostRow = await e.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(orphanPostId).first<{ status: string }>();
  expect(orphanPostRow?.status).toBe('published');
  // Legit pending keeps its container id and stays truthfully in-flight.
  expect(await targetStatus(pendingId)).toBe('publishing');
  expect((await e.DB.prepare('SELECT provider_post_id FROM post_targets WHERE id = ?').bind(pendingId).first<{ provider_post_id: string | null }>())?.provider_post_id).toBe(pendingRow?.provider_post_id);
});

test('publishPostNow is scoped: only the requested post is claimed', async () => {
  const acc = await seedAccount('mock');
  const a = await seedPost('Post A now', acc, 'mock');
  const b = await seedPost('Post B later', acc, 'mock');

  await publishPostNow(e, a.postId);

  expect(await targetStatus(a.targetId)).toBe('published');
  expect((await e.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(a.postId).first<{ status: string }>())?.status).toBe('published');
  // Untouched by the fast path — still due for the normal scheduler.
  expect(await targetStatus(b.targetId)).toBe('scheduled');

  await runSchedulerTick(e);
  expect(await targetStatus(b.targetId)).toBe('published');
});

test('x 403 duplicate-content fails the target but leaves the account connected', async () => {
  const acc = await seedAccount('x', 'x-live-token');
  const { targetId } = await seedPost('Hello X', acc, 'x');
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ title: 'Forbidden', detail: 'You are not permitted to create a Tweet with duplicate content.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  );
  try {
    await runSchedulerTick(e);
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
  expect(await targetStatus(targetId)).toBe('failed');
  expect(await accountStatus(acc)).toBe('connected');
  const err = await e.DB.prepare('SELECT last_error FROM post_targets WHERE id = ?').bind(targetId).first<{ last_error: string | null }>();
  expect(err?.last_error ?? '').not.toMatch(/reconnect/i);
});

test('x 401 flips the account to needs_reconnect; fresh credentials recover', async () => {
  const acc = await seedAccount('x', 'x-dead-token');
  const { targetId, postId } = await seedPost('Hello X again', acc, 'x');
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ title: 'Unauthorized', detail: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  );
  try {
    await runSchedulerTick(e);
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
  expect(await targetStatus(targetId)).toBe('needs_reconnect');
  expect(await accountStatus(acc)).toBe('needs_reconnect');

  // Reconnect: same provider+externalId upsert replaces tokens, status back to
  // connected (mirrors accounts.upsertAccount ON CONFLICT behavior).
  const row = await e.DB.prepare('SELECT external_id FROM social_accounts WHERE id = ?').bind(acc).first<{ external_id: string }>();
  const t = nowS();
  await e.DB
    .prepare(
      `INSERT INTO social_accounts (id, owner_id, provider, external_id, display_name, access_token_enc, token_expires_at, status, meta, created_at, updated_at)
       VALUES (?, 'owner', 'x', ?, 'x account', ?, ?, 'connected', '{}', ?, ?)
       ON CONFLICT(owner_id, provider, external_id) DO UPDATE SET
         access_token_enc = excluded.access_token_enc, token_expires_at = excluded.token_expires_at,
         status = 'connected', updated_at = excluded.updated_at`,
    )
    .bind(`acc_${randomId(6)}`, row!.external_id, await encryptSecret(SECRET, 'x-fresh-token'), t + 7200, t, t)
    .run();
  expect(await accountStatus(acc)).toBe('connected');
  const dec = await e.DB.prepare('SELECT access_token_enc FROM social_accounts WHERE id = ?').bind(acc).first<{ access_token_enc: string }>();
  const { decryptSecret: dec2 } = await import('../lib/crypto');
  expect(await dec2(SECRET, dec!.access_token_enc)).toBe('x-fresh-token');

  // Retry with the new generation publishes exactly once.
  await e.DB.prepare(`UPDATE post_targets SET status = 'scheduled', scheduled_at = ?, next_retry_at = NULL, last_error = NULL, publish_generation = publish_generation + 1 WHERE id = ?`).bind(nowS() - 1, targetId).run();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    String(input).includes('api.x.com/2/tweets')
      ? new Response(JSON.stringify({ data: { id: '1790x', text: 'Hello X again' } }), { status: 201, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  try {
    await runSchedulerTick(e);
  } finally {
    vi.stubGlobal('fetch', realFetch);
  }
  expect(await targetStatus(targetId)).toBe('published');
  const confirmed = await e.DB.prepare(`SELECT COUNT(*) AS n FROM publishing_attempts WHERE post_target_id = ? AND result = 'confirmed'`).bind(targetId).first<{ n: number }>();
  expect(confirmed?.n).toBe(1);
  expect((await e.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(postId).first<{ status: string }>())?.status).toBe('published');
});
