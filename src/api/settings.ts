import type { Env } from '../contracts/env';
import { HttpError, json, readJson } from '../lib/http';
import { isValidTimezone, nowS, deploymentStatus } from './_shared';

const KEYS = ['timezone', 'media_retention_hours', 'x_budget_mode', 'x_budget_monthly_usd'] as const;

type SettingsMap = Partial<Record<(typeof KEYS)[number], string>>;

async function readSettings(env: Env): Promise<SettingsMap> {
  const rows = await env.DB
    .prepare(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => '?').join(',')})`)
    .bind(...KEYS)
    .all<{ key: string; value: string }>();
  const map: SettingsMap = {};
  for (const r of rows.results ?? []) {
    if ((KEYS as readonly string[]).includes(r.key)) map[r.key as (typeof KEYS)[number]] = r.value;
  }
  return map;
}

async function upsert(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function getSettings(env: Env): Promise<Response> {
  const m = await readSettings(env);
  const retentionEnv = Number(env.MEDIA_RETENTION_HOURS) || 48;
  return json({
    timezone: m.timezone ?? 'UTC',
    mediaRetentionHours: m.media_retention_hours !== undefined && m.media_retention_hours !== '' ? Number(m.media_retention_hours) : retentionEnv,
    xBudgetMode: m.x_budget_mode ?? 'disabled',
    xBudgetMonthlyUsd: m.x_budget_monthly_usd !== undefined && m.x_budget_monthly_usd !== '' ? Number(m.x_budget_monthly_usd) : 0,
  });
}

export async function putSettings(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const updates: Array<[string, string]> = [];
  if (body.timezone !== undefined) {
    const tz = String(body.timezone ?? '').trim();
    if (!tz || !isValidTimezone(tz)) throw new HttpError(400, 'Pick a valid time zone.');
    updates.push(['timezone', tz]);
  }
  if (body.mediaRetentionHours !== undefined) {
    const h = body.mediaRetentionHours;
    if (h === null) {
      updates.push(['media_retention_hours', '']);
    } else if (typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 24 * 365) {
      updates.push(['media_retention_hours', String(h)]);
    } else {
      throw new HttpError(400, 'Media retention must be a whole number of hours (or empty to keep media forever).');
    }
  }
  if (body.xBudgetMode !== undefined) {
    const mode = String(body.xBudgetMode ?? '');
    if (!['disabled', 'warn', 'hard'].includes(mode)) throw new HttpError(400, 'X budget mode must be disabled, warn or hard.');
    updates.push(['x_budget_mode', mode]);
  }
  if (body.xBudgetMonthlyUsd !== undefined) {
    const usd = body.xBudgetMonthlyUsd;
    if (usd === null) {
      updates.push(['x_budget_monthly_usd', '']);
    } else if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 && usd <= 100000) {
      updates.push(['x_budget_monthly_usd', String(usd)]);
    } else {
      throw new HttpError(400, 'The X monthly budget must be zero or a positive amount.');
    }
  }
  for (const [k, v] of updates) await upsert(env, k, v);
  return getSettings(env);
}

export async function getDiagnostics(env: Env): Promise<Response> {
  const now = nowS();
  const lastTick = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'last_tick_at'`).first<{ value: string }>();
  const lastTickAt = Number(lastTick?.value) || null;
  const count = async (sql: string): Promise<number> => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const dueCount = await count(`SELECT COUNT(*) AS n FROM post_targets WHERE status = 'scheduled' AND scheduled_at <= ${now}`);
  const activeCount = await count(`SELECT COUNT(*) AS n FROM post_targets WHERE status IN ('claimed','publishing')`);
  const failedCount = await count(`SELECT COUNT(*) AS n FROM post_targets WHERE status = 'failed'`);
  const needsReconnectCount = await count(`SELECT COUNT(*) AS n FROM post_targets WHERE status = 'needs_reconnect'`);
  const attempts = await env.DB
    .prepare(
      `SELECT pa.post_target_id AS targetId, t.platform AS provider, pa.attempt_number AS attemptNumber, pa.started_at AS startedAt, pa.result, pa.error_message AS errorMessage
       FROM publishing_attempts pa JOIN post_targets t ON t.id = pa.post_target_id
       ORDER BY pa.started_at DESC, pa.rowid DESC LIMIT 20`,
    )
    .all<{ targetId: string; provider: string; attemptNumber: number; startedAt: number; result: string; errorMessage: string | null }>();
  const provRows = await env.DB
    .prepare(
      `SELECT t.platform AS provider, pa.result FROM publishing_attempts pa JOIN post_targets t ON t.id = pa.post_target_id
       ORDER BY pa.started_at DESC, pa.rowid DESC LIMIT 200`,
    )
    .all<{ provider: string; result: string }>();
  const providers: Record<string, string> = {};
  for (const r of provRows.results ?? []) {
    if (!(r.provider in providers)) providers[r.provider] = r.result;
  }
  let r2Ok = false;
  try {
    await env.MEDIA?.head('cotly-r2-probe');
    r2Ok = Boolean(env.MEDIA);
  } catch {
    r2Ok = false;
  }
  const deployment = await deploymentStatus(env);
  // cleanup.ts logs event='media_cleanup' only when it actually deleted objects.
  const lastCleanup = await env.DB
    .prepare(`SELECT created_at FROM activity_log WHERE event = 'media_cleanup' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .first<{ created_at: number }>()
    .catch(() => null);
  return json({
    lastTickAt,
    dueCount,
    activeCount,
    failedCount,
    needsReconnectCount,
    recentAttempts: attempts.results ?? [],
    providers,
    r2Ok,
    deployment,
    cleanup: { lastCleanupAt: lastCleanup?.created_at ?? null },
  });
}
