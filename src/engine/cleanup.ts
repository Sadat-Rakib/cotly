import type { Env } from '../contracts/env';
import { logActivity } from './publish';

const TERMINAL_TARGETS = "('published','failed','cancelled','assisted')";

// Only rolls up posts that are not already terminal (API cancel/rollup wins).
export async function rollupAffectedPosts(env: Env, postIds: Iterable<string>, now: number): Promise<number> {
  let rolledUp = 0;
  for (const postId of postIds) {
    const r = await env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ${TERMINAL_TARGETS} THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
         FROM post_targets WHERE post_id = ?`,
      )
      .bind(postId)
      .first<{ total: number; done: number | null; published: number | null }>();
    if (!r || r.done === null || r.done !== r.total) continue;
    const status = (r.published ?? 0) > 0 ? 'published' : 'failed';
    const res = await env.DB
      .prepare(`UPDATE posts SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('published','failed','cancelled')`)
      .bind(status, now, now, postId)
      .run();
    if (res.meta.changes) rolledUp++;
  }
  return rolledUp;
}

// 'never', invalid or <= 0 disables cleanup entirely.
async function getRetentionHours(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'media_retention_hours'`).first<{ value: string }>();
  if (row) {
    const n = Number.parseInt(row.value, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const n = Number.parseInt(env.MEDIA_RETENTION_HOURS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 48;
}

// A media row is deletable only when every post referencing it is terminal AND
// past completed_at + retention; the NOT EXISTS encodes the "never delete media
// still referenced by a non-terminal or unexpired post" rule.
export async function cleanupExpiredMedia(env: Env, now: number): Promise<number> {
  const retentionHours = await getRetentionHours(env);
  if (retentionHours <= 0) return 0;
  const rows =
    (
      await env.DB
        .prepare(
          `SELECT m.id AS id, m.r2_key AS r2_key FROM media m WHERE NOT EXISTS (
             SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id
             WHERE pm.media_id = m.id AND (
               p.completed_at IS NULL OR p.completed_at + ? >= ?
               OR EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.status NOT IN ${TERMINAL_TARGETS})
             )
           )`,
        )
        .bind(retentionHours * 3600, now)
        .all<{ id: string; r2_key: string }>()
    ).results ?? [];

  let deleted = 0;
  for (const m of env.MEDIA ? rows : []) {
    try {
      await env.MEDIA.delete(m.r2_key);
    } catch {
      // object may already be gone; the row is what matters
    }
    await env.DB.prepare('DELETE FROM post_media WHERE media_id = ?').bind(m.id).run();
    await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m.id).run();
    deleted++;
  }
  if (deleted > 0) {
    await logActivity(env, now, 'info', 'media_cleanup', `Deleted ${deleted} expired media object(s) past ${retentionHours}h retention.`);
  }
  return deleted;
}
