import type { Env } from '../contracts/env';
import { json } from '../lib/http';
import { deploymentStatus } from './_shared';

export interface ProviderStatusView {
  provider: string;
  implemented: boolean;
  configured: boolean;
  reason: string;
  connected: boolean;
  badge: 'not_configured' | 'ready_to_connect' | 'connected' | 'needs_reconnect';
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

// OAuth providers need both values in env before their sign-in flow can run.
const OAUTH_ENV_KEYS: Record<string, { id: string; secret: string; notSetReason: string }> = {
  facebook: { id: 'META_CLIENT_ID', secret: 'META_CLIENT_SECRET', notSetReason: 'META_CLIENT_ID/SECRET not set' },
  threads: { id: 'THREADS_CLIENT_ID', secret: 'THREADS_CLIENT_SECRET', notSetReason: 'THREADS_CLIENT_ID/SECRET not set' },
  linkedin: { id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET', notSetReason: 'LINKEDIN_CLIENT_ID/SECRET not set' },
};

const UNIMPLEMENTED_PROVIDERS: Array<{ provider: string; reason: string }> = [
  { provider: 'instagram', reason: 'Not implemented yet. Instagram publishing is planned for a future release.' },
  { provider: 'x', reason: 'Not implemented yet. X publishing needs the paid API tier and is optional.' },
  { provider: 'reddit', reason: 'Not implemented yet. Reddit publishing is planned.' },
  { provider: 'tiktok', reason: 'Not implemented yet. TikTok publishing is planned.' },
];

interface ProviderAccountStats {
  provider: string;
  total: number;
  connected: number;
}

export async function getSetupStatus(env: Env): Promise<Response> {
  const deployment = await deploymentStatus(env);

  const owner = await env.DB.prepare('SELECT email FROM users LIMIT 1').first<{ email: string }>();
  const ownerExists = Boolean(owner);

  const accountRows = await env.DB
    .prepare('SELECT id, provider, display_name, status, last_verified_at FROM social_accounts ORDER BY created_at, id')
    .all<{ id: string; provider: string; display_name: string; status: string; last_verified_at: number | null }>();
  const accounts = (accountRows.results ?? []).map((r) => ({
    id: r.id,
    provider: r.provider,
    displayName: r.display_name,
    status: r.status,
    lastVerifiedAt: r.last_verified_at,
  }));

  const statRows = await env.DB
    .prepare(`SELECT provider, COUNT(*) AS total, SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected FROM social_accounts GROUP BY provider`)
    .all<ProviderAccountStats>();
  const stats = new Map<string, ProviderAccountStats>();
  for (const r of statRows.results ?? []) stats.set(r.provider, r);

  const configured = (provider: string): boolean => {
    if (provider === 'bluesky') return true; // direct connect, no OAuth app needed
    const keys = OAUTH_ENV_KEYS[provider];
    if (!keys) return false;
    return Boolean(env[keys.id as keyof Env] && env[keys.secret as keyof Env]);
  };

  const providers: ProviderStatusView[] = [];
  for (const provider of ['facebook', 'threads', 'linkedin', 'bluesky']) {
    const isConfigured = configured(provider);
    const s = stats.get(provider);
    const connectedCount = s?.connected ?? 0;
    let badge: ProviderStatusView['badge'];
    if (connectedCount > 0) badge = 'connected';
    else if ((s?.total ?? 0) > 0) badge = 'needs_reconnect';
    else if (!isConfigured) badge = 'not_configured';
    else badge = 'ready_to_connect';
    providers.push({
      provider,
      implemented: true,
      configured: isConfigured,
      reason: isConfigured ? '' : OAUTH_ENV_KEYS[provider]?.notSetReason ?? '',
      connected: connectedCount > 0,
      badge,
    });
  }
  for (const u of UNIMPLEMENTED_PROVIDERS) {
    const s = stats.get(u.provider);
    providers.push({
      provider: u.provider,
      implemented: false,
      configured: false,
      reason: u.reason,
      connected: (s?.connected ?? 0) > 0,
      badge: (s?.total ?? 0) > 0 ? 'needs_reconnect' : 'not_configured',
    });
  }

  const accountConnected = accounts.some((a) => a.status === 'connected');
  // "Ready to publish" = OAuth app credentials wired for at least one OAuth
  // platform, or any account actually connected (Bluesky/Mock need no OAuth app).
  const providerReady = ['facebook', 'threads', 'linkedin'].some((p) => configured(p)) || accountConnected;

  const checklist = await launchChecklist(env, {
    ownerExists,
    providerReady,
    accountConnected,
    deployment,
  });

  return json({ deployment, owner: { exists: ownerExists, email: owner?.email ?? null }, accounts, providers, checklist });
}

async function launchChecklist(
  env: Env,
  flags: {
    ownerExists: boolean;
    providerReady: boolean;
    accountConnected: boolean;
    deployment: { r2: boolean; mediaPresignReady: boolean };
  },
): Promise<ChecklistItem[]> {
  const exists = async (sql: string): Promise<boolean> => Boolean(await env.DB.prepare(sql).first().catch(() => null));
  // Publish-now: a published target whose post was created in "now" mode.
  const publishNowTested = await exists(
    `SELECT 1 FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.status = 'published' AND p.publish_mode = 'now' LIMIT 1`,
  );
  // Scheduled: a published target that was scheduled at least 60s after the post was created.
  const scheduledTested = await exists(
    `SELECT 1 FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.status = 'published' AND t.scheduled_at >= p.created_at + 60 LIMIT 1`,
  );
  // Evidence: a confirmed provider attempt on a target that carries a provider post id.
  const evidenceStored = await exists(
    `SELECT 1 FROM publishing_attempts pa JOIN post_targets t ON t.id = pa.post_target_id
     WHERE pa.result = 'confirmed' AND t.provider_post_id IS NOT NULL LIMIT 1`,
  );
  return [
    { key: 'owner_configured', label: 'Owner account created', done: flags.ownerExists },
    { key: 'provider_configured', label: 'At least one platform is ready to publish', done: flags.providerReady },
    { key: 'account_connected', label: 'At least one account connected', done: flags.accountConnected },
    { key: 'media_upload_ready', label: 'Media uploads ready', done: flags.deployment.mediaPresignReady && flags.deployment.r2 },
    { key: 'publish_now_tested', label: 'A "publish now" post reached published state', done: publishNowTested },
    { key: 'scheduled_tested', label: 'A scheduled post reached published state', done: scheduledTested },
    { key: 'evidence_stored', label: 'Provider evidence stored for a real publish', done: evidenceStored },
  ];
}
