import type { Env } from '../contracts/env';

// Sliding-window limiter backed by one settings row per key: the value is a JSON
// array of attempt timestamps (UTC epoch seconds) pruned on each check.
export async function allowAttempt(env: Env, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const settingsKey = `ratelimit:${key}`;
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(settingsKey).first<{ value: string }>();
  let stamps: number[] = [];
  if (row) {
    try {
      stamps = JSON.parse(row.value) as number[];
    } catch {
      stamps = [];
    }
  }
  stamps = stamps.filter((t) => typeof t === 'number' && t > now - windowSeconds);
  if (stamps.length >= limit) return false;
  stamps.push(now);
  await env.DB
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(settingsKey, JSON.stringify(stamps))
    .run();
  return true;
}
