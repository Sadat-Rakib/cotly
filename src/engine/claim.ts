import type { Env } from '../contracts/env';

export interface ClaimedTarget {
  id: string;
  post_id: string;
  social_account_id: string | null;
  platform: string;
  caption_override: string | null;
  scheduled_at: number;
  attempt_count: number;
  publish_generation: number;
}

const RETURNING =
  ' RETURNING id, post_id, social_account_id, platform, caption_override, scheduled_at, attempt_count, publish_generation';

// Atomic claim: the outer status re-check inside the same UPDATE is the
// concurrency guard — D1 serializes writes, so exactly one concurrent tick
// can flip a given row out of scheduled/retrying.
export async function claimDueTargets(env: Env, now: number): Promise<ClaimedTarget[]> {
  const scheduled = await env.DB
    .prepare(
      `UPDATE post_targets SET status = 'claimed', updated_at = ? WHERE id IN
        (SELECT id FROM post_targets WHERE status = 'scheduled' AND scheduled_at <= ? LIMIT 25)
        AND status = 'scheduled'${RETURNING}`,
    )
    .bind(now, now)
    .all<ClaimedTarget>();
  const retrying = await env.DB
    .prepare(
      `UPDATE post_targets SET status = 'claimed', updated_at = ? WHERE id IN
        (SELECT id FROM post_targets WHERE status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= ? LIMIT 25)
        AND status = 'retrying'${RETURNING}`,
    )
    .bind(now, now)
    .all<ClaimedTarget>();
  return [...(scheduled.results ?? []), ...(retrying.results ?? [])];
}
