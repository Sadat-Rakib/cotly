import type { Env } from '../contracts/env';
import type { Provider } from '../contracts/types';

export const nowS = (): number => Math.floor(Date.now() / 1000);

// A cron tick is "recent" if the last one is inside this window; otherwise the
// deployment reports cron:false so a stuck scheduler is visible in setup/diagnostics.
export const CRON_STALE_AFTER_S = 10 * 60;

export interface DeploymentStatus {
  d1: boolean;
  r2: boolean;
  cron: boolean | 'unknown';
  appUrl: string;
  encryptionSecretSet: boolean;
  sessionSecretSet: boolean;
  mediaPresignReady: boolean;
}

// Real probes only — never report a green check the deployment did not earn.
// Secrets surface as set/unset booleans; values never leave the worker.
export async function deploymentStatus(env: Env): Promise<DeploymentStatus> {
  let d1 = false;
  try {
    await env.DB.prepare('SELECT 1').first();
    d1 = true;
  } catch {
    d1 = false;
  }
  let r2 = false;
  try {
    await env.MEDIA?.head('cotly-r2-probe');
    r2 = Boolean(env.MEDIA);
  } catch {
    r2 = false;
  }
  let cron: boolean | 'unknown' = 'unknown';
  if (d1) {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'last_tick_at'`).first<{ value: string }>().catch(() => null);
    const lastTickAt = Number(row?.value);
    if (Number.isFinite(lastTickAt) && lastTickAt > 0) cron = nowS() - lastTickAt <= CRON_STALE_AFTER_S;
  }
  return {
    d1,
    r2,
    cron,
    appUrl: env.APP_URL,
    encryptionSecretSet: Boolean(env.ENCRYPTION_SECRET),
    sessionSecretSet: Boolean(env.SESSION_SECRET),
    mediaPresignReady: Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
  };
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  facebook: 'Facebook',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  bluesky: 'Bluesky',
  instagram: 'Instagram',
  x: 'X',
  reddit: 'Reddit',
  mock: 'MockSocial',
  assisted: 'Assisted',
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
