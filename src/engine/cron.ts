import type { Env } from '../contracts/env';
import { claimDueTargets, type ClaimedTarget } from './claim';
import { logActivity, publishClaimedTarget, reclaimStaleTargets, resolveDuePending, type PublishResult } from './publish';
import { cleanupExpiredMedia, rollupAffectedPosts } from './cleanup';

// Idempotent and safe under concurrent invocation: each target is claimed via a
// conditional UPDATE, so two overlapping ticks never publish the same row.
export async function runSchedulerTick(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const counts: Record<PublishResult, number> & { claimed: number; resolved: number; rolledUp: number; mediaDeleted: number } = {
    claimed: 0,
    published: 0,
    pending: 0,
    assisted: 0,
    needs_reconnect: 0,
    failed: 0,
    skipped: 0,
    resolved: 0,
    rolledUp: 0,
    mediaDeleted: 0,
  };
  const touchedPosts = new Set<string>();

  // First: rescue rows stranded in-flight by a crash/restart between the
  // claimed->publishing guard and the outcome write. Without this they (and
  // their posts) show PUBLISHING forever — no tick phase can touch them.
  try {
    const stale = await reclaimStaleTargets(env, now);
    for (const postId of stale.postIds) touchedPosts.add(postId);
  } catch (e) {
    await logActivity(env, now, 'error', 'scheduler_tick', `Stale reclaim failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  try {
    const claimed = await claimDueTargets(env, now);
    counts.claimed = claimed.length;
    for (const t of claimed) {
      touchedPosts.add(t.post_id);
      try {
        counts[await publishClaimedTarget(env, t, now)]++;
      } catch (e) {
        counts.failed++;
        await logActivity(env, now, 'error', 'scheduler_tick', `Publish crashed for target ${t.id}: ${e instanceof Error ? e.message : String(e)}`, 'post_target', t.id).catch(() => {});
      }
    }
  } catch (e) {
    await logActivity(env, now, 'error', 'scheduler_tick', `Claim phase failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  try {
    const res = await resolveDuePending(env, now);
    counts.resolved = res.resolved;
    for (const postId of res.postIds) touchedPosts.add(postId);
  } catch (e) {
    await logActivity(env, now, 'error', 'scheduler_tick', `Pending resolution failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  try {
    counts.rolledUp = await rollupAffectedPosts(env, touchedPosts, now);
  } catch (e) {
    await logActivity(env, now, 'error', 'scheduler_tick', `Post rollup failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  try {
    counts.mediaDeleted = await cleanupExpiredMedia(env, now);
  } catch (e) {
    await logActivity(env, now, 'error', 'scheduler_tick', `Media cleanup failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  try {
    await env.DB
      .prepare(`INSERT INTO settings (key, value) VALUES ('last_tick_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(String(now))
      .run();
    await logActivity(
      env,
      now,
      'info',
      'scheduler_tick',
      `claimed=${counts.claimed} published=${counts.published} pending=${counts.pending} assisted=${counts.assisted} needs_reconnect=${counts.needs_reconnect} failed=${counts.failed} skipped=${counts.skipped} resolved=${counts.resolved} rolled_up=${counts.rolledUp} media_deleted=${counts.mediaDeleted}`,
    );
  } catch {
    // diagnostics must never fail the tick itself
  }
}

// Publish Now fast path: publish ONLY this post's due targets through the
// SAME claim -> publishClaimedTarget -> rollup pipeline the scheduler uses
// (one publishing authority), without the global tick's extra work (every due
// post, pending resolution, media cleanup). Pending confirmation still belongs
// to the cron; this returns after the immediate attempt so the API reports
// the real provider outcome instead of "Working" for the whole tick.
export async function publishPostNow(env: Env, postId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const claimed: ClaimedTarget[] = [];
  const returning =
    ' RETURNING id, post_id, social_account_id, platform, caption_override, scheduled_at, attempt_count, publish_generation';
  const scheduled = await env.DB
    .prepare(
      `UPDATE post_targets SET status = 'claimed', updated_at = ? WHERE id IN
        (SELECT id FROM post_targets WHERE post_id = ? AND status = 'scheduled' AND scheduled_at <= ? LIMIT 25)
        AND status = 'scheduled'${returning}`,
    )
    .bind(now, postId, now)
    .all<ClaimedTarget>();
  const retrying = await env.DB
    .prepare(
      `UPDATE post_targets SET status = 'claimed', updated_at = ? WHERE id IN
        (SELECT id FROM post_targets WHERE post_id = ? AND status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= ? LIMIT 25)
        AND status = 'retrying'${returning}`,
    )
    .bind(now, postId, now)
    .all<ClaimedTarget>();
  claimed.push(...(scheduled.results ?? []), ...(retrying.results ?? []));
  for (const t of claimed) {
    try {
      await publishClaimedTarget(env, t, now);
    } catch (e) {
      await logActivity(env, now, 'error', 'publish_now', `Publish crashed for target ${t.id}: ${e instanceof Error ? e.message : String(e)}`, 'post_target', t.id).catch(() => {});
    }
  }
  // Roll up even when nothing was claimed: the post may already be terminal
  // (or have zero resettable targets) and must never sit in 'publishing'.
  await rollupAffectedPosts(env, [postId], now).catch(() => {});
}
