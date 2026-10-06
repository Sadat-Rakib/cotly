import type { Env } from '../contracts/env';
import type { Provider } from '../contracts/types';
import { CAPABILITIES } from '../contracts/capabilities';
import { randomId } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { requireSession } from '../lib/sessions';
import { isValidTimezone, nowS, PROVIDER_LABEL } from './_shared';
import { runSchedulerTick } from '../engine/cron';
import { allowAttempt } from '../lib/ratelimit';

interface FieldError {
  field: string;
  message: string;
}

interface AccountRow {
  id: string;
  provider: string;
  display_name: string;
  status: string;
}

interface TargetInput {
  accountId: string;
  captionOverride?: string;
}

const EDITABLE = ['draft', 'scheduled'];

const isStr = (v: unknown): v is string => typeof v === 'string';

// Shared by create and patch: validates per-target provider capabilities.
async function validateComposition(
  env: Env,
  userId: string,
  baseCaption: string,
  mediaIds: string[],
  targets: TargetInput[],
): Promise<{ errors: FieldError[]; accounts: Map<string, AccountRow>; media: Array<{ id: string; mime: string }> }> {
  const errors: FieldError[] = [];
  if (!Array.isArray(mediaIds) || mediaIds.some((m) => !isStr(m))) {
    errors.push({ field: 'mediaIds', message: 'The attached files list is invalid. Re-add the files and retry.' });
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    errors.push({ field: 'targets', message: 'Pick at least one account to publish to.' });
  }
  const cleanTargets = Array.isArray(targets)
    ? targets.filter((t): t is TargetInput => !!t && typeof t === 'object' && isStr((t as TargetInput).accountId))
    : [];
  if (Array.isArray(targets) && cleanTargets.length !== targets.length) {
    errors.push({ field: 'targets', message: 'One of the selected accounts is invalid. Refresh the page and retry.' });
  }

  const mediaIdsClean = Array.isArray(mediaIds) ? (mediaIds.filter((m) => isStr(m)) as string[]) : [];
  const media = new Map<string, { id: string; mime: string }>();
  if (mediaIdsClean.length > 0) {
    const rows = await env.DB
      .prepare(`SELECT id, mime FROM media WHERE owner_id = ? AND id IN (${mediaIdsClean.map(() => '?').join(',')})`)
      .bind(userId, ...mediaIdsClean)
      .all<{ id: string; mime: string }>();
    for (const r of rows.results ?? []) media.set(r.id, r);
    if (media.size !== mediaIdsClean.length) {
      errors.push({ field: 'mediaIds', message: 'One of the attached files is missing. Remove it or upload it again.' });
    }
  }
  const mediaList = mediaIdsClean.filter((m) => media.has(m)).map((m) => media.get(m)!);

  const accountIds = [...new Set(cleanTargets.map((t) => t.accountId))];
  const accounts = new Map<string, AccountRow>();
  if (accountIds.length > 0) {
    const rows = await env.DB
      .prepare(`SELECT id, provider, display_name, status FROM social_accounts WHERE owner_id = ? AND id IN (${accountIds.map(() => '?').join(',')})`)
      .bind(userId, ...accountIds)
      .all<AccountRow>();
    for (const r of rows.results ?? []) accounts.set(r.id, r);
  }

  if (!baseCaption.trim() && mediaList.length === 0) {
    errors.push({ field: 'baseCaption', message: 'Write a caption or attach at least one file.' });
  }

  cleanTargets.forEach((t, i) => {
    const acc = accounts.get(t.accountId);
    if (!acc) {
      errors.push({ field: `targets.${i}.accountId`, message: 'This account no longer exists. Refresh the page and retry.' });
      return;
    }
    const label = PROVIDER_LABEL[acc.provider as Provider] ?? acc.provider;
    if (acc.status !== 'connected') {
      errors.push({
        field: `targets.${i}.accountId`,
        message: `${label} account “${acc.display_name}” needs to be reconnected. Reconnect it on the Accounts page and retry.`,
      });
      return;
    }
    const cap = CAPABILITIES[acc.provider as Provider] ?? CAPABILITIES.mock;
    const caption = isStr(t.captionOverride) ? t.captionOverride : baseCaption;
    if (caption.length > cap.maxCaptionChars) {
      errors.push({
        field: `targets.${i}.caption`,
        message: `${label} captions are limited to ${cap.maxCaptionChars} characters. This one is ${caption.length}.`,
      });
    }
    if (mediaList.some((m) => m.mime.startsWith('video/')) && !cap.video) {
      errors.push({ field: `targets.${i}.media`, message: `${label} does not support video yet. Remove the video for this account.` });
    }
    const images = mediaList.filter((m) => m.mime.startsWith('image/')).length;
    if (images > cap.maxImages) {
      errors.push({ field: `targets.${i}.media`, message: `${label} allows at most ${cap.maxImages} images per post. Remove the extras.` });
    }
    if (cap.mediaRequired && mediaList.length === 0) {
      errors.push({ field: `targets.${i}.media`, message: `${label} requires at least one image or video.` });
    }
  });

  return { errors, accounts, media: mediaList };
}

function parseTargets(raw: unknown): TargetInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      accountId: String(t.accountId ?? ''),
      ...(isStr(t.captionOverride) ? { captionOverride: t.captionOverride } : {}),
    }));
}

export async function create(req: Request, env: Env, userId: string): Promise<Response> {
  // Abuse guard: bounded creation rate and a cap on pending scheduled posts
  // per user, so one account cannot flood the scheduler.
  if (!(await allowAttempt(env, `posts:${userId}`, 30, 15 * 60))) {
    throw new HttpError(429, 'You are creating posts too quickly. Please wait a few minutes.');
  }
  const body = await readJson(req);
  const baseCaption = isStr(body.baseCaption) ? body.baseCaption : '';
  const mediaIds = Array.isArray(body.mediaIds) ? (body.mediaIds.filter(isStr) as string[]) : [];
  const targets = parseTargets(body.targets);
  const errors: FieldError[] = [];
  const { errors: compErrors, accounts, media } = await validateComposition(env, userId, baseCaption, mediaIds, targets);
  errors.push(...compErrors);

  const mode = body.mode;
  let scheduledAt: number | null = null;
  let timezone = isStr(body.timezone) ? body.timezone.trim() : '';
  if (mode === 'now') {
    scheduledAt = nowS();
    timezone = timezone || 'UTC';
  } else if (mode === 'scheduled') {
    const at = body.scheduledAt;
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= nowS()) {
      errors.push({ field: 'scheduledAt', message: 'Pick a date and time in the future.' });
    } else {
      scheduledAt = Math.floor(at);
    }
    if (!timezone || !isValidTimezone(timezone)) {
      errors.push({ field: 'timezone', message: 'Pick a valid time zone.' });
    }
  } else {
    errors.push({ field: 'mode', message: 'Choose Publish Now or a scheduled time.' });
  }

  if (errors.length > 0 || scheduledAt === null) return json({ errors }, 422);

  const now = nowS();
  const postId = `post_${randomId(8)}`;
  await env.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(postId, userId, baseCaption, scheduledAt, timezone, mode === 'now' ? 'now' : 'scheduled', media.length, now, now)
    .run();
  const pending = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE owner_id = ? AND status = 'scheduled'`)
    .bind(userId)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) > 100) {
    throw new HttpError(429, 'You have too many scheduled posts waiting. Publish or cancel some before scheduling more.');
  }
  for (const [i, m] of media.entries()) {
    await env.DB.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?,?,?)').bind(postId, m.id, i).run();
  }
  for (const t of targets) {
    const acc = accounts.get(t.accountId);
    if (!acc) continue;
    await env.DB
      .prepare(
        `INSERT INTO post_targets (id, post_id, social_account_id, platform, caption_override, status, scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      )
      .bind(`tgt_${randomId(8)}`, postId, acc.id, acc.provider, isStr(t.captionOverride) ? t.captionOverride : null, scheduledAt, now, now)
      .run();
  }
  // Publish-now must actually publish: run a scheduler tick synchronously so
  // the response reflects the real outcome (published/failed) instead of
  // silently sitting in the queue for up to a minute. The tick is idempotent
  // and claims only due targets, so scheduled posts are untouched. A tick
  // failure never fails the POST — the cron retries on its own.
  if (mode === 'now') {
    try {
      await runSchedulerTick(env);
    } catch {
      // fall through: the next cron tick will pick this target up
    }
  }
  return json({ postId }, 201);
}

const VIEWS: Record<string, string[]> = {
  queue: ['scheduled', 'claimed', 'publishing', 'retrying'],
  published: ['published'],
  failed: ['failed', 'needs_reconnect', 'assisted'],
};

interface ViewTarget {
  id: string;
  accountId: string | null;
  provider: string;
  accountName: string | null;
  status: string;
  lastError: string | null;
}

interface ViewPost {
  id: string;
  baseCaption: string;
  status: string;
  scheduledAt: number | null;
  timezone: string;
  media: Array<{ id: string; mime: string; filename: string | null }>;
  targets: ViewTarget[];
}

async function shape(env: Env, posts: Array<Record<string, unknown>>): Promise<ViewPost[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => String(p.id));
  const ph = ids.map(() => '?').join(',');
  const mediaRows = await env.DB
    .prepare(
      `SELECT pm.post_id, m.id, m.mime, m.original_filename FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id IN (${ph}) ORDER BY pm.position`,
    )
    .bind(...ids)
    .all<{ post_id: string; id: string; mime: string; original_filename: string | null }>();
  const targetRows = await env.DB
    .prepare(
      `SELECT t.id, t.post_id, t.social_account_id, t.platform, t.status, t.last_error
       FROM post_targets t LEFT JOIN social_accounts a ON a.id = t.social_account_id
       WHERE t.post_id IN (${ph}) ORDER BY t.created_at, t.id`,
    )
    .bind(...ids)
    .all<{ id: string; post_id: string; social_account_id: string | null; platform: string; status: string; last_error: string | null }>();
  const mediaBy = new Map<string, Array<{ id: string; mime: string; filename: string | null }>>();
  for (const m of mediaRows.results ?? []) {
    const list = mediaBy.get(m.post_id) ?? [];
    list.push({ id: m.id, mime: m.mime, filename: m.original_filename });
    mediaBy.set(m.post_id, list);
  }
  const targetsBy = new Map<string, ViewTarget[]>();
  for (const t of targetRows.results ?? []) {
    const list = targetsBy.get(t.post_id) ?? [];
    list.push({ id: t.id, accountId: t.social_account_id, provider: t.platform, accountName: null, status: t.status, lastError: t.last_error });
    targetsBy.set(t.post_id, list);
  }
  // Fill account names in one extra query only when needed.
  const accountIds = [...new Set((targetRows.results ?? []).map((t) => t.social_account_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (accountIds.length > 0) {
    const rows = await env.DB
      .prepare(`SELECT id, display_name FROM social_accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`)
      .bind(...accountIds)
      .all<{ id: string; display_name: string }>();
    for (const r of rows.results ?? []) names.set(r.id, r.display_name);
  }
  for (const list of targetsBy.values()) {
    for (const t of list) t.accountName = t.accountId ? names.get(t.accountId) ?? null : null;
  }
  return posts.map((p) => ({
    id: String(p.id),
    baseCaption: String(p.base_caption ?? ''),
    status: String(p.status),
    scheduledAt: typeof p.scheduled_at === 'number' ? p.scheduled_at : null,
    timezone: String(p.timezone ?? 'UTC'),
    media: mediaBy.get(String(p.id)) ?? [],
    targets: targetsBy.get(String(p.id)) ?? [],
  }));
}

async function postRows(env: Env, userId: string, id: string): Promise<Array<Record<string, unknown>>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND owner_id = ?').bind(id, userId).first<Record<string, unknown>>();
  return row ? [row] : [];
}

export async function list(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const view = url.searchParams.get('view') ?? 'queue';
  const statuses = VIEWS[view];
  if (!statuses) throw new HttpError(400, 'Unknown view. Use queue, published or failed.');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const from = Number(url.searchParams.get('from')) || 0;
  const to = Number(url.searchParams.get('to')) || 0;
  const userId = await requireSession(env, req);
  let sql = `SELECT * FROM posts WHERE owner_id = ? AND EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = posts.id AND t.status IN (${statuses.map(() => '?').join(',')}))`;
  const binds: unknown[] = [userId, ...statuses];
  if (from) {
    sql += ' AND scheduled_at >= ?';
    binds.push(from);
  }
  if (to) {
    sql += ' AND scheduled_at <= ?';
    binds.push(to);
  }
  sql += ' ORDER BY scheduled_at DESC LIMIT ?';
  binds.push(limit);
  const rows = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return json(await shape(env, rows.results ?? []));
}

export async function getOne(env: Env, userId: string, id: string): Promise<Response> {
  const rows = await shape(env, await postRows(env, userId, id));
  if (rows.length === 0) throw new HttpError(404, 'That post no longer exists.');
  return json(rows[0]);
}

async function rawPost(env: Env, userId: string, id: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND owner_id = ?').bind(id, userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'That post no longer exists.');
  return row;
}

export async function patch(req: Request, env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  if (!EDITABLE.includes(String(post.status))) {
    throw new HttpError(409, 'This post is already publishing or finished and can no longer be edited.');
  }
  const body = await readJson(req);
  const baseCaption = body.baseCaption !== undefined ? (isStr(body.baseCaption) ? body.baseCaption : String(body.baseCaption ?? '')) : String(post.base_caption ?? '');

  let mediaIds: string[];
  if (body.mediaIds !== undefined) {
    if (!Array.isArray(body.mediaIds)) throw new HttpError(400, 'The attached files list is invalid.');
    mediaIds = body.mediaIds.filter(isStr) as string[];
  } else {
    const rows = await env.DB.prepare('SELECT media_id FROM post_media WHERE post_id = ? ORDER BY position').bind(id).all<{ media_id: string }>();
    mediaIds = (rows.results ?? []).map((r) => r.media_id);
  }

  let targets: TargetInput[];
  if (body.targets !== undefined) {
    targets = parseTargets(body.targets);
  } else {
    const rows = await env.DB
      .prepare('SELECT social_account_id, caption_override FROM post_targets WHERE post_id = ?')
      .bind(id)
      .all<{ social_account_id: string | null; caption_override: string | null }>();
    targets = (rows.results ?? []).map((r) => ({
      accountId: r.social_account_id ?? '',
      ...(r.caption_override !== null ? { captionOverride: r.caption_override } : {}),
    }));
  }

  const { errors, accounts, media } = await validateComposition(env, userId, baseCaption, mediaIds, targets);
  if (errors.length > 0) return json({ errors }, 422);

  const now = nowS();
  await env.DB.prepare('UPDATE posts SET base_caption = ?, media_count = ?, updated_at = ? WHERE id = ?').bind(baseCaption, media.length, now, id).run();
  if (body.mediaIds !== undefined) {
    await env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(id).run();
    for (const [i, m] of media.entries()) {
      await env.DB.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?,?,?)').bind(id, m.id, i).run();
    }
  }
  if (body.targets !== undefined) {
    await env.DB.prepare('DELETE FROM post_targets WHERE post_id = ?').bind(id).run();
    const scheduledAt = typeof post.scheduled_at === 'number' ? post.scheduled_at : now;
    for (const t of targets) {
      const acc = accounts.get(t.accountId);
      if (!acc) continue;
      await env.DB
        .prepare(
          `INSERT INTO post_targets (id, post_id, social_account_id, platform, caption_override, status, scheduled_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
        )
        .bind(`tgt_${randomId(8)}`, id, acc.id, acc.provider, isStr(t.captionOverride) ? t.captionOverride : null, scheduledAt, now, now)
        .run();
    }
  } else {
    // Caption/media edits must invalidate any in-flight idempotency key.
    await env.DB.prepare('UPDATE post_targets SET publish_generation = publish_generation + 1, updated_at = ? WHERE post_id = ?').bind(now, id).run();
  }
  return json({ ok: true });
}

export async function reschedule(req: Request, env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  if (!EDITABLE.includes(String(post.status))) {
    throw new HttpError(409, 'This post is already publishing or finished and can no longer be rescheduled.');
  }
  const body = await readJson(req);
  const at = body.scheduledAt;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= nowS()) {
    throw new HttpError(422, 'Pick a date and time in the future.');
  }
  const now = nowS();
  await env.DB.prepare(`UPDATE posts SET scheduled_at = ?, status = 'scheduled', publish_mode = 'scheduled', updated_at = ? WHERE id = ?`).bind(Math.floor(at), now, id).run();
  await env.DB
    .prepare(
      `UPDATE post_targets SET scheduled_at = ?, publish_generation = publish_generation + 1, next_retry_at = NULL,
       status = CASE WHEN status IN ('draft','scheduled','retrying') THEN 'scheduled' ELSE status END, updated_at = ?
       WHERE post_id = ? AND status IN ('draft','scheduled','claimed','publishing','retrying')`,
    )
    .bind(Math.floor(at), now, id)
    .run();
  return json({ ok: true });
}

export async function cancel(env: Env, userId: string, id: string): Promise<Response> {
  await rawPost(env, userId, id);
  const now = nowS();
  const r = await env.DB
    .prepare(`UPDATE post_targets SET status = 'cancelled', updated_at = ? WHERE post_id = ? AND status IN ('draft','scheduled','claimed','publishing','retrying')`)
    .bind(now, id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'This post has already finished publishing.');
  await env.DB.prepare(`UPDATE posts SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(now, id).run();
  return json({ ok: true });
}

export async function publishNow(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  if (String(post.status) === 'published') throw new HttpError(409, 'This post was already published.');
  const now = nowS();
  await env.DB.prepare(`UPDATE posts SET scheduled_at = ?, status = 'scheduled', publish_mode = 'now', updated_at = ? WHERE id = ?`).bind(now, now, id).run();
  await env.DB
    .prepare(
      `UPDATE post_targets SET status = 'scheduled', publish_generation = publish_generation + 1, next_retry_at = NULL, updated_at = ?
       WHERE post_id = ? AND status IN ('draft','scheduled','cancelled')`,
    )
    .bind(now, id)
    .run();
  return json({ ok: true });
}

export async function duplicate(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  const now = nowS();
  const newId = `post_${randomId(8)}`;
  await env.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, 'scheduled', ?, ?, ?)`,
    )
    .bind(newId, userId, String(post.base_caption ?? ''), String(post.timezone ?? 'UTC'), Number(post.media_count ?? 0), now, now)
    .run();
  await env.DB.prepare(`INSERT INTO post_media (post_id, media_id, position) SELECT ?, media_id, position FROM post_media WHERE post_id = ?`).bind(newId, id).run();
  return json({ postId: newId }, 201);
}

export async function remove(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  if (!['draft', 'cancelled'].includes(String(post.status))) {
    throw new HttpError(409, 'Only draft or cancelled posts can be deleted.');
  }
  // Media rows are kept on purpose: the cleanup job owns R2 deletion.
  await env.DB.prepare('DELETE FROM post_targets WHERE post_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export async function retryTarget(env: Env, userId: string, targetId: string): Promise<Response> {
  const t = await env.DB
    .prepare('SELECT t.id AS id, t.post_id AS post_id, t.status AS status FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.id = ? AND p.owner_id = ?')
    .bind(targetId, userId)
    .first<{ id: string; post_id: string; status: string }>();
  if (!t) throw new HttpError(404, 'That queue item no longer exists.');
  if (!['failed', 'needs_reconnect'].includes(t.status)) {
    throw new HttpError(409, 'Only failed or disconnected items can be retried.');
  }
  const now = nowS();
  await env.DB
    .prepare(`UPDATE post_targets SET status = 'scheduled', next_retry_at = NULL, last_error = NULL, publish_generation = publish_generation + 1, updated_at = ? WHERE id = ? AND status IN ('failed','needs_reconnect')`)
    .bind(now, targetId)
    .run();
  await env.DB.prepare(`UPDATE posts SET status = 'scheduled', updated_at = ? WHERE id = ? AND status IN ('failed','cancelled')`).bind(now, t.post_id).run();
  return json({ ok: true });
}
