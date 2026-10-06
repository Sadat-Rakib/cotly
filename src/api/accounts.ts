import type { Env } from '../contracts/env';
import type { AccountTokens, PlatformAdapter, Provider, SocialAccountRecord } from '../contracts/types';
import { decryptSecret, encryptSecret, randomId } from '../lib/crypto';
import { HttpError, json, readJson } from '../lib/http';
import { parseCookies, requireSession } from '../lib/sessions';
import { nowS, PROVIDER_LABEL } from './_shared';
import { getAdapter } from '../adapters/registry';
import { getPublicJwks } from '../adapters/bluesky';
import { parseSignedRequest } from '../adapters/_shared';

interface AccountView {
  id: string;
  provider: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: string;
  externalId: string;
  lastVerifiedAt: number | null;
}

// Normalize on read: the handle lives in the meta JSON and is never returned
// as raw JSON text.
function handleOf(metaRaw: string): string | null {
  try {
    const handle = (JSON.parse(metaRaw) as { handle?: unknown }).handle;
    return typeof handle === 'string' && handle.trim() ? handle.trim() : null;
  } catch {
    return null;
  }
}

const viewOf = (r: { id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null; meta?: string }): AccountView => ({
  id: r.id,
  provider: r.provider,
  displayName: r.display_name,
  handle: r.meta !== undefined ? handleOf(r.meta) : null,
  avatarUrl: r.avatar_url,
  status: r.status,
  externalId: r.external_id,
  lastVerifiedAt: r.last_verified_at,
});

// Never select token columns here. Scoped to the authenticated owner.
export async function listAccounts(env: Env, userId: string): Promise<Response> {
  const rows = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at, meta FROM social_accounts WHERE owner_id = ? ORDER BY created_at, id')
    .bind(userId)
    .all<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  return json((rows.results ?? []).map(viewOf));
}

export async function removeAccount(env: Env, userId: string, id: string): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM social_accounts WHERE id = ? AND owner_id = ?').bind(id, userId).run();
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
export async function testAccount(env: Env, userId: string, id: string): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at
       FROM social_accounts WHERE id = ? AND owner_id = ?`,
    )
    .bind(id, userId)
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
  userId: string,
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
      `INSERT INTO social_accounts (id, owner_id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
       ON CONFLICT(owner_id, provider, external_id) DO UPDATE SET
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
      userId,
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
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at, meta FROM social_accounts WHERE owner_id = ? AND provider = ? AND external_id = ?')
    .bind(userId, provider, account.externalId)
    .first<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  if (!row) throw new HttpError(500, 'The account was connected but could not be saved. Try again.');
  return viewOf(row);
}

// GET /oauth/bluesky/client-metadata.json and /oauth/bluesky/jwks.json — the
// AT Protocol confidential-client identity of this deployment. The metadata
// URL is the client_id, so both documents must be served without redirects.
export async function blueskyOAuthDocument(req: Request, env: Env, doc: string): Promise<Response> {
  const base = env.APP_URL;
  if (doc === 'jwks.json') {
    const jwks = await getPublicJwks(env);
    return json(jwks);
  }
  return json({
    client_id: `${base}/oauth/bluesky/client-metadata.json`,
    client_name: 'Cotly',
    client_uri: base,
    logo_uri: `${base}/brand/cotly-avatar-512.png`,
    redirect_uris: [`${base}/oauth/bluesky/callback`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    application_type: 'web',
    dpop_bound_access_tokens: true,
    jwks_uri: `${base}/oauth/bluesky/jwks.json`,
  });
}

// POST /api/accounts/instagram/token — connect Instagram with a user-supplied
// access token (for example from Meta's Access Token Tool or the developer
// console). The token is validated against the Instagram Graph API, exchanged
// for a long-lived token when possible, and stored encrypted for this user.
export async function connectInstagramToken(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const accessToken = String(body.accessToken ?? '').trim();
  if (!accessToken || accessToken.length < 20) {
    throw new HttpError(400, 'Paste a valid Instagram access token. You can generate one in the Meta developer console.');
  }
  const userId = await requireSession(env, req);
  const me = await fetch('https://graph.instagram.com/v21.0/me?fields=user_id,username,account_type,profile_picture_url', {
    headers: { authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json().catch(() => ({})));
  const profile = (me ?? {}) as { user_id?: string; id?: string; username?: string; account_type?: string; profile_picture_url?: string; error?: { message?: string } };
  if (!profile || (!profile.user_id && !profile.id)) {
    const detail = profile.error?.message ?? 'Instagram rejected this token.';
    throw new HttpError(400, `Cotly could not read the Instagram profile for that token: ${detail}`);
  }
  if (!['BUSINESS', 'CREATOR', 'MEDIA_CREATOR'].includes(String(profile.account_type))) {
    throw new HttpError(400, 'Instagram publishing requires a Business or Creator account. Switch the account type in the Instagram app and try again.');
  }
  // Short-lived tokens are exchanged for long-lived ones; already long-lived
  // tokens fail the exchange and are stored as-is.
  let stored = accessToken;
  let expiresAt: number | undefined;
  const ll = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env.INSTAGRAM_CLIENT_SECRET ?? '')}&access_token=${encodeURIComponent(accessToken)}`,
  ).then((r) => r.json().catch(() => ({})));
  const exchanged = (ll ?? {}) as { access_token?: string; expires_in?: number };
  if (typeof exchanged.access_token === 'string' && exchanged.access_token.length > 20) {
    stored = exchanged.access_token;
    if (typeof exchanged.expires_in === 'number') expiresAt = Math.floor(Date.now() / 1000) + exchanged.expires_in;
  }
  const igUserId = profile.user_id ?? (profile.id as string);
  const saved = await upsertAccount(
    env,
    userId,
    'instagram',
    {
      externalId: igUserId,
      displayName: profile.username || 'Instagram account',
      ...(profile.profile_picture_url ? { avatarUrl: profile.profile_picture_url } : {}),
      meta: { accountType: profile.account_type },
    },
    { accessToken: stored, ...(expiresAt ? { expiresAt } : {}) },
    'instagram_business_basic,instagram_business_content_publish',
  );
  return json(saved, 201);
}

export async function connectMock(req: Request, env: Env): Promise<Response> {
  if (env.MOCK_SOCIAL_ENABLED !== 'true') throw new HttpError(404, 'Mock accounts are not enabled on this server.');
  const userId = await requireSession(env, req);
  const body = await readJson(req);
  const displayName = String(body.displayName ?? '').trim() || 'MockSocial';
  const now = nowS();
  const id = `acc_${randomId(8)}`;
  const externalId = `mock_${randomId(8)}`;
  const accessTokenEnc = await encryptSecret(env.ENCRYPTION_SECRET, `mock-token-${randomId(12)}`);
  await env.DB
    .prepare(
      `INSERT INTO social_accounts (id, owner_id, provider, external_id, display_name, access_token_enc, status, meta, last_verified_at, created_at, updated_at)
       VALUES (?, ?, 'mock', ?, ?, ?, 'connected', '{}', ?, ?, ?)`,
    )
    .bind(id, userId, externalId, displayName, accessTokenEnc, now, now, now)
    .run();
  return json(
    { id, provider: 'mock', displayName, avatarUrl: null, status: 'connected', externalId, lastVerifiedAt: now },
    201,
  );
}

export async function oauthStart(req: Request, env: Env, provider: string): Promise<Response> {
  const userId = await requireSession(env, req);
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
    .prepare('INSERT INTO oauth_states (state, provider, verifier, redirect_uri, created_at, expires_at, owner_id) VALUES (?,?,?,?,?,?,?)')
    .bind(state, provider, auth.verifier ?? null, redirectUri, now, now + 600, userId)
    .run();
  return json({ url: auth.url });
}

export async function oauthCallback(req: Request, env: Env, provider: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const secure = new URL(req.url).protocol === 'https:';
  // Response.redirect() only accepts a numeric status in the DOM lib types, so
  // build the 302 by hand to attach the page-choice cookie.
  const redirect = (query: string, headers: Record<string, string> = {}): Response =>
    new Response(null, { status: 302, headers: { Location: `${env.APP_URL}/app/profile?${query}`, ...headers } });
  const fail = (message: string): Response => redirect(`error=${encodeURIComponent(message)}`);
  try {
    const state = params.get('state') ?? '';
    const row = state
      ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<{ provider: string; verifier: string | null; expires_at: number; owner_id: string | null }>()
      : null;
    if (row) await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    if (!row || row.provider !== provider || row.expires_at <= nowS()) {
      return fail('This connection attempt expired or was already used. Start again from the Profile page.');
    }
    const ownerId = row.owner_id;
    if (!ownerId) {
      return fail('This connection attempt predates multi-user sign-in. Start again from the Profile page.');
    }
    const adapter = getAdapter(provider as Provider);
    if (!adapter.handleCallback) return fail(`${PROVIDER_LABEL[provider as Provider] ?? provider} does not support OAuth sign-in.`);
    const result = await adapter.handleCallback(env, params, row.verifier ?? undefined);
    // More than one Page to choose from — park the user token and ask which Page.
    if (result.pageChoice) {
      const blob = await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify({ u: result.pageChoice.userToken, p: result.pageChoice.pages, o: ownerId }));
      return redirect(`choose_page=${encodeURIComponent(provider)}`, {
        'set-cookie': `${PAGE_PICK_COOKIE}=${blob}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
      });
    }
    if (!result.account || !result.tokens) return fail('The provider did not return an account to connect.');
    await upsertAccount(env, ownerId, provider as Provider, result.account, result.tokens, result.scopes);
    return redirect(`connected=1&provider=${encodeURIComponent(provider)}`);
  } catch (err) {
    return fail(err instanceof Error && err.message ? err.message : 'Connecting this account failed. Try again.');
  }
}

// ---- Facebook Page picker ----
// The OAuth user token lives only in this encrypted, httpOnly, 15-minute cookie
// until the user picks a Page. Nothing is written to D1 before that choice.
const PAGE_PICK_COOKIE = 'cotly_fb_pages';
async function pagePickUserToken(req: Request, env: Env): Promise<{ userToken: string; ownerId: string }> {
  const blob = parseCookies(req)[PAGE_PICK_COOKIE];
  if (!blob) throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  let userToken: string;
  let ownerId: string;
  try {
    const parsed = JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, blob)) as { u?: unknown; o?: unknown };
    userToken = String(parsed.u ?? '');
    ownerId = String(parsed.o ?? '');
  } catch {
    throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  }
  if (!userToken || !ownerId) throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  return { userToken, ownerId };
}

// POST /oauth/threads/deauthorize — Meta calls this when a user removes the
// Cotly app from their Threads settings. The signed_request is verified with
// the Threads app secret; the matching Threads connection (its encrypted
// tokens) is deleted immediately.
export async function threadsDeauthorize(req: Request, env: Env): Promise<Response> {
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    raw = '';
  }
  if (!raw) throw new HttpError(400, 'Missing signed_request payload.');
  const signed = String(new URLSearchParams(raw).get('signed_request') ?? '');
  if (!signed) throw new HttpError(400, 'Missing signed_request payload.');
  const threadsUserId = await parseSignedRequest(signed, env.THREADS_CLIENT_SECRET ?? '');
  if (!threadsUserId) throw new HttpError(403, 'The deauthorization request could not be verified.');
  const r = await env.DB
    .prepare("DELETE FROM social_accounts WHERE provider = 'threads' AND external_id = ?")
    .bind(threadsUserId)
    .run();
  console.log('[threads-deauthorize] verified user', threadsUserId.slice(0, 6) + '…', '— removed', r.meta.changes, 'connection(s)');
  return json({ url: `${env.APP_URL}/data-deletion`, success: true });
}

// GET /api/accounts/facebook/pages — Page names/ids only, never a token.
export async function listFacebookPages(req: Request, env: Env): Promise<Response> {
  const adapter = getAdapter('facebook');
  if (!adapter.listPages) throw new HttpError(400, 'Choosing a Page is not available for Facebook yet.');
  try {
    return json({ pages: await adapter.listPages(env, (await pagePickUserToken(req, env)).userToken) });
  } catch (err) {
    throw new HttpError(400, err instanceof Error && err.message ? err.message : 'Could not read your Facebook Pages.');
  }
}

// POST /api/accounts/facebook/pages — connect the Page the user chose.
export async function selectFacebookPage(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const pageId = String(body.pageId ?? '');
  if (!pageId) throw new HttpError(400, 'Choose a Page to connect.');
  const adapter = getAdapter('facebook');
  if (!adapter.pickPage) throw new HttpError(400, 'Choosing a Page is not available for Facebook yet.');
  let picked: Awaited<ReturnType<NonNullable<PlatformAdapter['pickPage']>>>;
  const pick = await pagePickUserToken(req, env);
  try {
    picked = await adapter.pickPage(env, pick.userToken, pageId);
  } catch (err) {
    throw new HttpError(400, err instanceof Error && err.message ? err.message : 'Could not connect that Page.');
  }
  const saved = await upsertAccount(env, pick.ownerId, 'facebook', picked.account, picked.tokens, picked.scopes);
  const secure = new URL(req.url).protocol === 'https:';
  return json(saved, 201, {
    'set-cookie': `${PAGE_PICK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  });
}
