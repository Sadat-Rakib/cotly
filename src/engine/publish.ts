import type { Env } from '../contracts/env';
import type {
  MediaRecord,
  PlatformAdapter,
  Provider,
  PublishOutcome,
  SocialAccountRecord,
} from '../contracts/types';
import { decryptSecret, encryptSecret, randomId } from '../lib/crypto';
import { getAdapter } from '../adapters/registry';
import type { ClaimedTarget } from './claim';

// Index = attempt_count after increment: attempt 1 -> +120s ... attempt 4 -> +7200s.
export const RETRY_LADDER = [0, 120, 600, 1800, 7200] as const;
const MAX_ATTEMPTS = 5;
const PENDING_RETRY_SECONDS = 60;
const PENDING_MAX_AGE_SECONDS = 86_400;

export type PublishResult =
  | 'published'
  | 'pending'
  | 'assisted'
  | 'needs_reconnect'
  | 'failed'
  | 'skipped';

export interface TargetRef {
  id: string;
  post_id: string;
  platform: string;
  attempt_count: number;
}

export async function logActivity(
  env: Env,
  now: number,
  level: 'info' | 'warn' | 'error',
  event: string,
  message: string,
  refType?: string,
  refId?: string,
): Promise<void> {
  await env.DB
    .prepare('INSERT INTO activity_log (id, level, event, ref_type, ref_id, message, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(randomId(8), level, event, refType ?? null, refId ?? null, message, now)
    .run();
}

// Adapter error strings must already be token-free (contract rule); we only truncate.
function safeMsg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 300 ? `${s.slice(0, 300)}...` : s;
}

function safeSummary(o: PublishOutcome): string {
  let s: string;
  switch (o.kind) {
    case 'confirmed':
      s = `confirmed id=${o.externalId}${o.permalink ? ` permalink=${o.permalink}` : ''}`;
      break;
    case 'pending':
      s = `pending id=${o.externalId}`;
      break;
    case 'assisted':
      s = `assisted${o.reason ? ` reason=${o.reason}` : ''}`;
      break;
    case 'needs_reconnect':
      s = `needs_reconnect reason=${o.reason}`;
      break;
    case 'failed':
      s = `failed code=${o.errorCode} message=${o.errorMessage}`;
      break;
  }
  return s.length > 300 ? `${s.slice(0, 300)}...` : s;
}

async function recordAttempt(
  env: Env,
  targetId: string,
  attemptNumber: number,
  startedAt: number,
  finishedAt: number,
  outcome: PublishOutcome,
): Promise<void> {
  const errorCode = outcome.kind === 'failed' ? outcome.errorCode : outcome.kind === 'needs_reconnect' ? 'NEEDS_RECONNECT' : null;
  const errorMessage = outcome.kind === 'failed' ? outcome.errorMessage : outcome.kind === 'needs_reconnect' ? outcome.reason : null;
  const retryable = outcome.kind === 'failed' ? (outcome.retryable ? 1 : 0) : null;
  await env.DB
    .prepare(
      `INSERT INTO publishing_attempts
        (id, post_target_id, attempt_number, started_at, finished_at, result, error_code, error_message, provider_response_summary, retryable)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      randomId(8),
      targetId,
      attemptNumber,
      startedAt,
      finishedAt,
      outcome.kind,
      errorCode,
      errorMessage,
      safeSummary(outcome),
      retryable,
    )
    .run();
}

interface AccountRow {
  id: string;
  provider: string;
  external_id: string;
  display_name: string;
  avatar_url: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: number | null;
  scopes: string | null;
  meta: string | null;
  status: string;
  last_verified_at: number | null;
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

function toAccountRecord(row: AccountRow, tokens: TokenSet): SocialAccountRecord {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta ?? '{}') as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    provider: row.provider as Provider,
    externalId: row.external_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt,
    scopes: row.scopes ?? undefined,
    meta,
    status: row.status as SocialAccountRecord['status'],
    lastVerifiedAt: row.last_verified_at ?? undefined,
  };
}

async function decryptTokens(env: Env, row: AccountRow): Promise<TokenSet | null> {
  try {
    const accessToken = await decryptSecret(env.ENCRYPTION_SECRET, row.access_token_enc);
    const refreshToken = row.refresh_token_enc ? await decryptSecret(env.ENCRYPTION_SECRET, row.refresh_token_enc) : undefined;
    return { accessToken, refreshToken, expiresAt: row.token_expires_at ?? undefined };
  } catch {
    return null;
  }
}

// Single place applying any PublishOutcome to the target row.
export async function applyOutcome(
  env: Env,
  t: TargetRef,
  accountId: string | null,
  outcome: PublishOutcome,
  now: number,
): Promise<PublishResult> {
  switch (outcome.kind) {
    case 'confirmed': {
      await env.DB
        .prepare(
          `UPDATE post_targets SET status = 'published', provider_post_id = ?, provider_permalink = COALESCE(?, provider_permalink),
             published_at = ?, attempt_count = attempt_count + 1, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .bind(outcome.externalId, outcome.permalink ?? null, now, now, t.id)
        .run();
      if (accountId) {
        await env.DB
          .prepare('UPDATE social_accounts SET last_verified_at = ?, updated_at = ? WHERE id = ?')
          .bind(now, now, accountId)
          .run();
      }
      return 'published';
    }
    case 'pending': {
      // Stay in a truthful in-flight state: status='publishing' with the
      // container id stored. A container creation is NOT a publication.
      await env.DB
        .prepare(
          `UPDATE post_targets SET status = 'publishing', provider_post_id = ?, next_retry_at = ?, attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`,
        )
        .bind(outcome.externalId, now + PENDING_RETRY_SECONDS, now, t.id)
        .run();
      return 'pending';
    }
    case 'assisted': {
      await env.DB
        .prepare(`UPDATE post_targets SET status = 'assisted', last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(now, t.id)
        .run();
      await logActivity(env, now, 'info', 'assisted', `${t.platform} post is ready for manual publishing.${outcome.reason ? ` ${outcome.reason}` : ''}`, 'post_target', t.id);
      return 'assisted';
    }
    case 'needs_reconnect': {
      await env.DB
        .prepare(`UPDATE post_targets SET status = 'needs_reconnect', last_error = ?, next_retry_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(outcome.reason, now, t.id)
        .run();
      if (accountId) {
        await env.DB
          .prepare(`UPDATE social_accounts SET status = 'needs_reconnect', updated_at = ? WHERE id = ?`)
          .bind(now, accountId)
          .run();
      }
      await logActivity(env, now, 'error', 'needs_reconnect', `${t.platform} needs reconnect: ${outcome.reason}`, 'post_target', t.id);
      return 'needs_reconnect';
    }
    case 'failed': {
      const nextAttempt = t.attempt_count + 1;
      const retrying = outcome.retryable && nextAttempt < MAX_ATTEMPTS;
      const lastError = !retrying && outcome.retryable ? `${outcome.errorMessage} Gave up after ${MAX_ATTEMPTS} attempts.` : outcome.errorMessage;
      await env.DB
        .prepare('UPDATE post_targets SET status = ?, last_error = ?, attempt_count = ?, next_retry_at = ?, updated_at = ? WHERE id = ?')
        .bind(retrying ? 'retrying' : 'failed', lastError, nextAttempt, retrying ? now + (RETRY_LADDER[nextAttempt] ?? 7200) : null, now, t.id)
        .run();
      return 'failed';
    }
  }
}

const ACCOUNT_GONE = { kind: 'failed', retryable: false, errorCode: 'ACCOUNT_GONE', errorMessage: 'The connected account for this post is no longer available. Reconnect the account and retry.' } as const;

export async function publishClaimedTarget(env: Env, t: ClaimedTarget, now: number): Promise<PublishResult> {
  let adapter: PlatformAdapter;
  try {
    adapter = getAdapter(t.platform as Provider);
  } catch {
    return applyOutcome(env, t, t.social_account_id, { kind: 'failed', retryable: false, errorCode: 'NOT_WIRED', errorMessage: `${t.platform} publishing is not wired up yet.` }, now);
  }

  const post = await env.DB.prepare('SELECT base_caption FROM posts WHERE id = ?').bind(t.post_id).first<{ base_caption: string }>();
  if (!post) {
    return applyOutcome(env, t, t.social_account_id, { kind: 'failed', retryable: false, errorCode: 'POST_GONE', errorMessage: 'The original post no longer exists.' }, now);
  }

  const mediaRows = (
    await env.DB
      .prepare(
        `SELECT m.id, m.mime, m.size, m.original_filename, m.r2_key, m.width, m.height, m.duration_s
         FROM media m JOIN post_media pm ON pm.media_id = m.id WHERE pm.post_id = ? ORDER BY pm.position`,
      )
      .bind(t.post_id)
      .all<{
        id: string;
        mime: string;
        size: number;
        original_filename: string | null;
        r2_key: string;
        width: number | null;
        height: number | null;
        duration_s: number | null;
      }>()
  ).results ?? [];
  const media: MediaRecord[] = mediaRows.map((m) => ({
    id: m.id,
    mime: m.mime,
    size: m.size,
    originalFilename: m.original_filename ?? undefined,
    r2Key: m.r2_key,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    durationS: m.duration_s ?? undefined,
  }));

  if (!t.social_account_id) {
    return applyOutcome(env, t, null, ACCOUNT_GONE, now);
  }
  const acc = await env.DB.prepare('SELECT * FROM social_accounts WHERE id = ?').bind(t.social_account_id).first<AccountRow>();
  if (!acc) {
    return applyOutcome(env, t, null, ACCOUNT_GONE, now);
  }

  let tokens = await decryptTokens(env, acc);
  if (!tokens) {
    return applyOutcome(env, t, acc.id, { kind: 'needs_reconnect', reason: 'Stored credentials for this account could not be read. Reconnect the account and retry.' }, now);
  }

  if (acc.token_expires_at !== null && acc.token_expires_at <= now && adapter.refresh) {
    try {
      tokens = await adapter.refresh(env, tokens, toAccountRecord(acc, tokens));
      const enc = await encryptSecret(env.ENCRYPTION_SECRET, tokens.accessToken);
      const encRefresh = tokens.refreshToken ? await encryptSecret(env.ENCRYPTION_SECRET, tokens.refreshToken) : null;
      await env.DB
        .prepare(`UPDATE social_accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ?, status = 'connected', updated_at = ? WHERE id = ?`)
        .bind(enc, encRefresh, tokens.expiresAt ?? null, now, acc.id)
        .run();
    } catch {
      return applyOutcome(env, t, acc.id, { kind: 'needs_reconnect', reason: 'Your session expired and could not be renewed automatically. Reconnect the account and retry.' }, now);
    }
  }

  // Atomic transition claimed -> publishing. Losing this update means the target
  // was cancelled or regenerated (publish_generation bump) by a concurrent call.
  const guard = await env.DB
    .prepare(`UPDATE post_targets SET status = 'publishing', updated_at = ? WHERE id = ? AND status = 'claimed' AND publish_generation = ?`)
    .bind(now, t.id, t.publish_generation)
    .run();
  if (!guard.meta.changes) return 'skipped';

  // Immediate pre-call re-check; also picks up caption edits newer than the claim.
  const fresh = await env.DB
    .prepare('SELECT status, publish_generation, caption_override FROM post_targets WHERE id = ?')
    .bind(t.id)
    .first<{ status: string; publish_generation: number; caption_override: string | null }>();
  if (!fresh || fresh.status !== 'publishing' || fresh.publish_generation !== t.publish_generation) return 'skipped';
  const caption = fresh.caption_override ?? post.base_caption;

  let outcome: PublishOutcome;
  try {
    outcome = await adapter.publish(env, {
      account: toAccountRecord(acc, tokens),
      caption,
      media,
      idempotencyKey: `${t.id}:${t.publish_generation}`,
      scheduledAt: t.scheduled_at,
    });
  } catch (e) {
    outcome = { kind: 'failed', retryable: true, errorCode: 'ADAPTER_ERROR', errorMessage: safeMsg(e) };
  }
  const finishedAt = Math.floor(Date.now() / 1000);
  await recordAttempt(env, t.id, t.attempt_count + 1, now, finishedAt, outcome);
  return applyOutcome(env, t, acc.id, outcome, finishedAt);
}

interface PendingRow extends TargetRef {
  social_account_id: string | null;
  provider_post_id: string;
  created_at: number;
}

export async function resolveDuePending(env: Env, now: number): Promise<{ resolved: number; postIds: string[] }> {
  const postIds = new Set<string>();
  let resolved = 0;
  const rows =
    (
      await env.DB
        .prepare(
          `SELECT id, post_id, social_account_id, platform, provider_post_id, attempt_count, created_at FROM post_targets
           WHERE status = 'publishing' AND provider_post_id IS NOT NULL AND published_at IS NULL AND next_retry_at IS NOT NULL AND next_retry_at <= ?`,
        )
        .bind(now)
        .all<PendingRow>()
    ).results ?? [];

  for (const t of rows) {
    postIds.add(t.post_id);
    let adapter: PlatformAdapter;
    try {
      adapter = getAdapter(t.platform as Provider);
    } catch {
      await applyOutcome(env, t, t.social_account_id, { kind: 'failed', retryable: false, errorCode: 'NOT_WIRED', errorMessage: `${t.platform} publishing is not wired up yet.` }, now);
      continue;
    }
    if (!adapter.resolvePending) {
      await applyOutcome(env, t, t.social_account_id, { kind: 'failed', retryable: false, errorCode: 'NO_RESOLVE', errorMessage: 'This platform does not support automatic confirmation of pending posts.' }, now);
      continue;
    }
    if (!t.social_account_id) {
      await applyOutcome(env, t, null, ACCOUNT_GONE, now);
      continue;
    }
    const acc = await env.DB.prepare('SELECT * FROM social_accounts WHERE id = ?').bind(t.social_account_id).first<AccountRow>();
    if (!acc) {
      await applyOutcome(env, t, null, ACCOUNT_GONE, now);
      continue;
    }
    const tokens = await decryptTokens(env, acc);
    if (!tokens) {
      await applyOutcome(env, t, acc.id, { kind: 'needs_reconnect', reason: 'Stored credentials for this account could not be read. Reconnect the account and retry.' }, now);
      continue;
    }

    // 24h cap measured from the first attempt on this target.
    const first = await env.DB.prepare('SELECT MIN(started_at) AS s FROM publishing_attempts WHERE post_target_id = ?').bind(t.id).first<{ s: number | null }>();
    const startedAt = first?.s ?? t.created_at;
    if (now - startedAt > PENDING_MAX_AGE_SECONDS) {
      const outcome = { kind: 'failed', retryable: false, errorCode: 'PENDING_TIMEOUT', errorMessage: 'The platform never confirmed this post within 24 hours, so it was marked failed.' } as const;
      await recordAttempt(env, t.id, t.attempt_count + 1, now, now, outcome);
      await applyOutcome(env, t, acc.id, outcome, now);
      continue;
    }

    let outcome: PublishOutcome;
    try {
      outcome = await adapter.resolvePending(env, toAccountRecord(acc, tokens), t.provider_post_id);
    } catch (e) {
      outcome = { kind: 'failed', retryable: true, errorCode: 'ADAPTER_ERROR', errorMessage: safeMsg(e) };
    }
    await recordAttempt(env, t.id, t.attempt_count + 1, now, now, outcome);
    if ((await applyOutcome(env, t, acc.id, outcome, now)) === 'published') resolved++;
  }
  return { resolved, postIds: [...postIds] };
}
