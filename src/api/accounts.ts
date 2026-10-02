import type { Env } from '../contracts/env';
import type { AccountTokens, PlatformAdapter, Provider, SocialAccountRecord } from '../contracts/types';
import { decryptSecret, encryptSecret, randomId } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { nowS, PROVIDER_LABEL } from './_shared';
import { getAdapter } from '../adapters/registry';

interface AccountView {
  id: string;
  provider: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  externalId: string;
  lastVerifiedAt: number | null;
}

const viewOf = (r: { id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }): AccountView => ({
  id: r.id,
  provider: r.provider,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  status: r.status,
  externalId: r.external_id,
  lastVerifiedAt: r.last_verified_at,
});

// Never select token columns here.
export async function listAccounts(env: Env): Promise<Response> {
  const rows = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts ORDER BY created_at, id')
    .all<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  return json((rows.results ?? []).map(viewOf));
}

export async function removeAccount(env: Env, id: string): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM social_accounts WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, 'That account was already removed.');
  return json({ ok: true });
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
  meta: string;
  status: string;
  last_verified_at: number | null;
}

// Rebuilds the full adapter record (tokens decrypted in-memory only, never returned).
async function toRecord(env: Env, row: AccountRow): Promise<SocialAccountRecord> {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    provider: row.provider as Provider,
    externalId: row.external_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    accessToken: await decryptSecret(env.ENCRYPTION_SECRET, row.access_token_enc),
    refreshToken: row.refresh_token_enc ? await decryptSecret(env.ENCRYPTION_SECRET, row.refresh_token_enc) : undefined,
    tokenExpiresAt: row.token_expires_at ?? undefined,
    scopes: row.scopes ?? undefined,
    meta,
    status: row.status as SocialAccountRecord['status'],
    lastVerifiedAt: row.last_verified_at ?? undefined,
  };
}

// POST /api/accounts/:id/test — probes the provider with the stored credentials.
// 200 with {ok:false} means the probe ran and failed; 400 means the provider
// cannot be probed at all yet. Detail text comes from adapters (human-readable,
// token-free by contract); an adapter crash is caught and humanized here.
export async function testAccount(env: Env, id: string): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at
       FROM social_accounts WHERE id = ?`,
    )
    .bind(id)
    .first<AccountRow>();
  if (!row) throw new HttpError(404, 'That account does not exist.');
  const label = PROVIDER_LABEL[row.provider as Provider] ?? row.provider;
  let adapter: PlatformAdapter;
  try {
    adapter = getAdapter(row.provider as Provider);
  } catch {
    throw new HttpError(400, `Connection testing is not available for ${label} yet.`);
  }
  if (!adapter.testConnection) throw new HttpError(400, `Connection testing is not available for ${label} yet.`);
  let result: { ok: boolean; detail: string };
  try {
    result = await adapter.testConnection(env, await toRecord(env, row));
  } catch (err) {
    result = { ok: false, detail: err instanceof Error && err.message ? err.message : 'Connection test failed. Try again in a moment.' };
  }
  if (result.ok) {
    await env.DB.prepare('UPDATE social_accounts SET last_verified_at = ?, updated_at = ? WHERE id = ?').bind(nowS(), nowS(), id).run();
  }
  return json({ ok: result.ok, detail: result.detail });
}

async function upsertAccount(
  env: Env,
  provider: Provider,
  account: { externalId: string; displayName: string; avatarUrl?: string; meta?: Record<string, unknown> },
  tokens: AccountTokens,
  scopes: string,
): Promise<AccountView> {
  const now = nowS();
  const accessTokenEnc = await encryptSecret(env.ENCRYPTION_SECRET, tokens.accessToken);
  const refreshTokenEnc = tokens.refreshToken ? await encryptSecret(env.ENCRYPTION_SECRET, tokens.refreshToken) : null;
  await env.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
       ON CONFLICT(provider, external_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc,
         token_expires_at = excluded.token_expires_at,
         scopes = excluded.scopes,
         meta = excluded.meta,
         status = 'connected',
         last_verified_at = excluded.last_verified_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      `acc_${randomId(8)}`,
      provider,
      account.externalId,
      account.displayName,
      account.avatarUrl ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      tokens.expiresAt ?? null,
      scopes,
      JSON.stringify(account.meta ?? {}),
      now,
      now,
      now,
    )
    .run();
  const row = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts WHERE provider = ? AND external_id = ?')
    .bind(provider, account.externalId)
    .first<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  if (!row) throw new HttpError(500, 'The account was connected but could not be saved. Try again.');
  return viewOf(row);
}

export async function connectBluesky(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  let adapter: PlatformAdapter;
  try {
    adapter = getAdapter('bluesky');
  } catch {
    throw new HttpError(400, 'Bluesky adapter not available yet');
  }
  if (!adapter.connectDirect) throw new HttpError(400, 'Bluesky adapter not available yet');
  let result: Awaited<ReturnType<NonNullable<PlatformAdapter['connectDirect']>>>;
  try {
    result = await adapter.connectDirect(env, { handle: String(body.handle ?? ''), appPassword: String(body.appPassword ?? '') });
  } catch (err) {
    // Adapter messages are human-readable and secret-free by contract.
    throw new HttpError(400, err instanceof Error && err.message ? err.message : 'Connecting Bluesky failed. Try again.');
  }
  const saved = await upsertAccount(env, 'bluesky', result.account, result.tokens, result.scopes);
  return json(saved, 201);
}

export async function connectMock(req: Request, env: Env): Promise<Response> {
  if (env.MOCK_SOCIAL_ENABLED !== 'true') throw new HttpError(404, 'Mock accounts are not enabled on this server.');
  const body = await readJson(req);
  const displayName = String(body.displayName ?? '').trim() || 'MockSocial';
  const now = nowS();
  const id = `acc_${randomId(8)}`;
  const externalId = `mock_${randomId(8)}`;
  const accessTokenEnc = await encryptSecret(env.ENCRYPTION_SECRET, `mock-token-${randomId(12)}`);
  await env.DB
    .prepare(
      `INSERT INTO social_accounts (id, provider, external_id, display_name, access_token_enc, status, meta, last_verified_at, created_at, updated_at)
       VALUES (?, 'mock', ?, ?, ?, 'connected', '{}', ?, ?, ?)`,
    )
    .bind(id, externalId, displayName, accessTokenEnc, now, now, now)
    .run();
  return json(
    { id, provider: 'mock', displayName, avatarUrl: null, status: 'connected', externalId, lastVerifiedAt: now },
    201,
  );
}

export async function oauthStart(req: Request, env: Env, provider: string): Promise<Response> {
  const label = PROVIDER_LABEL[provider as Provider] ?? provider;
  let adapter: PlatformAdapter;
  try {
    adapter = getAdapter(provider as Provider);
  } catch {
    throw new HttpError(400, `${label} sign-in is not available yet.`);
  }
  if (!adapter.buildAuthUrl) throw new HttpError(400, `${label} connects with a direct sign-in instead of OAuth. Use the inline form on the Accounts page.`);
  const redirectUri = `${env.APP_URL}/oauth/${provider}/callback`;
  const state = randomId(18);
  let auth: { url: string; verifier?: string };
  try {
    auth = await adapter.buildAuthUrl(env, redirectUri, state);
  } catch (err) {
    // e.g. missing client id/secret — adapter messages are human-readable.
    throw new HttpError(400, err instanceof Error && err.message ? err.message : `${label} sign-in is not configured yet.`);
  }
  const now = nowS();
  await env.DB
    .prepare('INSERT INTO oauth_states (state, provider, verifier, redirect_uri, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(state, provider, auth.verifier ?? null, redirectUri, now, now + 600)
    .run();
  return json({ url: auth.url });
}

export async function oauthCallback(req: Request, env: Env, provider: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const redirect = (query: string): Response => Response.redirect(`${env.APP_URL}/accounts?${query}`, 302);
  const fail = (message: string): Response => redirect(`error=${encodeURIComponent(message)}`);
  try {
    const state = params.get('state') ?? '';
    const row = state
      ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<{ provider: string; verifier: string | null; expires_at: number }>()
      : null;
    if (row) await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    if (!row || row.provider !== provider || row.expires_at <= nowS()) {
      return fail('This connection attempt expired or was already used. Start again from the Accounts page.');
    }
    const adapter = getAdapter(provider as Provider);
    if (!adapter.handleCallback) return fail(`${PROVIDER_LABEL[provider as Provider] ?? provider} does not support OAuth sign-in.`);
    const result = await adapter.handleCallback(env, params, row.verifier ?? undefined);
    await upsertAccount(env, provider as Provider, result.account, result.tokens, result.scopes);
    return redirect('connected=1');
  } catch (err) {
    return fail(err instanceof Error && err.message ? err.message : 'Connecting this account failed. Try again.');
  }
}
