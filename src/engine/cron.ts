import type { Env } from '../contracts/env';
import { claimDueTargets } from './claim';
import { logActivity, publishClaimedTarget, resolveDuePending, type PublishResult } from './publish';
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
