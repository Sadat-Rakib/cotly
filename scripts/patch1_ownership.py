import io

def patch(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new in pairs:
        assert old in s, f"NOT FOUND in {path}: {old[:80]}"
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf8', newline='\n').write(s)
    print("patched", path)

# ---------------- accounts.ts ----------------
patch('src/api/accounts.ts', [
    ("""// Never select token columns here.
export async function listAccounts(env: Env): Promise<Response> {
  const rows = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts ORDER BY created_at, id')
    .all<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  return json((rows.results ?? []).map(viewOf));
}""",
     """// Never select token columns here. Scoped to the authenticated owner.
export async function listAccounts(env: Env, userId: string): Promise<Response> {
  const rows = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts WHERE owner_id = ? ORDER BY created_at, id')
    .bind(userId)
    .all<{ id: string; provider: string; external_id: string; display_name: string; avatar_url: string | null; status: string; last_verified_at: number | null }>();
  return json((rows.results ?? []).map(viewOf));
}"""),
    ("""export async function removeAccount(env: Env, id: string): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM social_accounts WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, 'That account was already removed.');
  return json({ ok: true });
}""",
     """export async function removeAccount(env: Env, userId: string, id: string): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM social_accounts WHERE id = ? AND owner_id = ?').bind(id, userId).run();
  if (!r.meta.changes) throw new HttpError(404, 'That account was already removed.');
  return json({ ok: true });
}"""),
    ("""export async function testAccount(env: Env, id: string): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at
       FROM social_accounts WHERE id = ?`,
    )
    .bind(id)
    .first<AccountRow>();
  if (!row) throw new HttpError(404, 'That account does not exist.');""",
     """export async function testAccount(env: Env, userId: string, id: string): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at
       FROM social_accounts WHERE id = ? AND owner_id = ?`,
    )
    .bind(id, userId)
    .first<AccountRow>();
  if (!row) throw new HttpError(404, 'That account does not exist.');"""),
    ("""async function upsertAccount(
  env: Env,
  provider: Provider,""",
     """async function upsertAccount(
  env: Env,
  userId: string,
  provider: Provider,"""),
    ("""      `INSERT INTO social_accounts (id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
       ON CONFLICT(provider, external_id) DO UPDATE SET""",
     """      `INSERT INTO social_accounts (id, owner_id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)
       ON CONFLICT(owner_id, provider, external_id) DO UPDATE SET"""),
    ("""    .bind(
      `acc_${randomId(8)}`,
      provider,""",
     """    .bind(
      `acc_${randomId(8)}`,
      userId,
      provider,"""),
    ("""  const row = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts WHERE provider = ? AND external_id = ?')
    .bind(provider, account.externalId)""",
     """  const row = await env.DB
    .prepare('SELECT id, provider, external_id, display_name, avatar_url, status, last_verified_at FROM social_accounts WHERE owner_id = ? AND provider = ? AND external_id = ?')
    .bind(userId, provider, account.externalId)"""),
    ("""  const saved = await upsertAccount(env, 'bluesky', result.account, result.tokens, result.scopes);
  return json(saved, 201);""",
     """  const userId = await requireSession(env, req);
  const saved = await upsertAccount(env, userId, 'bluesky', result.account, result.tokens, result.scopes);
  return json(saved, 201);"""),
    ("""export async function connectMock(req: Request, env: Env): Promise<Response> {
  if (env.MOCK_SOCIAL_ENABLED !== 'true') throw new HttpError(404, 'Mock accounts are not enabled on this server.');
  const body = await readJson(req);""",
     """export async function connectMock(req: Request, env: Env): Promise<Response> {
  if (env.MOCK_SOCIAL_ENABLED !== 'true') throw new HttpError(404, 'Mock accounts are not enabled on this server.');
  const userId = await requireSession(env, req);
  const body = await readJson(req);"""),
    ("""       VALUES (?, 'mock', ?, ?, ?, 'connected', '{}', ?, ?, ?)`,
    )
    .bind(id, externalId, displayName, accessTokenEnc, now, now, now)""",
     """       VALUES (?, ?, 'mock', ?, ?, ?, 'connected', '{}', ?, ?, ?)`,
    )
    .bind(id, userId, externalId, displayName, accessTokenEnc, now, now, now)"""),
    ("""export async function oauthStart(req: Request, env: Env, provider: string): Promise<Response> {
  const label = PROVIDER_LABEL[provider as Provider] ?? provider;""",
     """export async function oauthStart(req: Request, env: Env, provider: string): Promise<Response> {
  const userId = await requireSession(env, req);
  const label = PROVIDER_LABEL[provider as Provider] ?? provider;"""),
    ("""  await env.DB
    .prepare('INSERT INTO oauth_states (state, provider, verifier, redirect_uri, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(state, provider, auth.verifier ?? null, redirectUri, now, now + 600)
    .run();""",
     """  await env.DB
    .prepare('INSERT INTO oauth_states (state, provider, verifier, redirect_uri, created_at, expires_at, owner_id) VALUES (?,?,?,?,?,?,?)')
    .bind(state, provider, auth.verifier ?? null, redirectUri, now, now + 600, userId)
    .run();"""),
    ("""      ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<{ provider: string; verifier: string | null; expires_at: number }>()""",
     """      ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<{ provider: string; verifier: string | null; expires_at: number; owner_id: string | null }>()"""),
    ("""    if (!row || row.provider !== provider || row.expires_at <= nowS()) {
      return fail('This connection attempt expired or was already used. Start again from the Accounts page.');
    }""",
     """    if (!row || row.provider !== provider || row.expires_at <= nowS()) {
      return fail('This connection attempt expired or was already used. Start again from the Accounts page.');
    }
    const ownerId = row.owner_id;
    if (!ownerId) {
      return fail('This connection attempt predates multi-user sign-in. Start again from the Accounts page.');
    }"""),
    ("""    if (!result.account || !result.tokens) return fail('The provider did not return an account to connect.');
    await upsertAccount(env, provider as Provider, result.account, result.tokens, result.scopes);""",
     """    if (!result.account || !result.tokens) return fail('The provider did not return an account to connect.');
    await upsertAccount(env, ownerId, provider as Provider, result.account, result.tokens, result.scopes);"""),
    ("""    if (result.pageChoice) {
      const blob = await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify({ u: result.pageChoice.userToken, p: result.pageChoice.pages }));""",
     """    if (result.pageChoice) {
      const blob = await encryptSecret(env.ENCRYPTION_SECRET, JSON.stringify({ u: result.pageChoice.userToken, p: result.pageChoice.pages, o: ownerId }));"""),
    ("""async function pagePickUserToken(req: Request, env: Env): Promise<string> {
  const blob = parseCookies(req)[PAGE_PICK_COOKIE];
  if (!blob) throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  let userToken: string;
  try {
    userToken = String((JSON.parse(await decryptSecret(env.ENCRYPTION_SECRET, blob)) as { u?: unknown }).u ?? '');
  } catch {
    throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  }
  if (!userToken) throw new HttpError(400, 'That Facebook connection attempt has expired. Connect Facebook again to choose a Page.');
  return userToken;
}""",
     """async function pagePickUserToken(req: Request, env: Env): Promise<{ userToken: string; ownerId: string }> {
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
}"""),
    ("""  try {
    return json({ pages: await adapter.listPages(env, await pagePickUserToken(req, env)) });""",
     """  try {
    return json({ pages: await adapter.listPages(env, (await pagePickUserToken(req, env)).userToken) });"""),
    ("""  let picked: Awaited<ReturnType<NonNullable<PlatformAdapter['pickPage']>>>;
  try {
    picked = await adapter.pickPage(env, await pagePickUserToken(req, env), pageId);
  } catch (err) {
    throw new HttpError(400, err instanceof Error && err.message ? err.message : 'Could not connect that Page.');
  }
  const saved = await upsertAccount(env, 'facebook', picked.account, picked.tokens, picked.scopes);""",
     """  let picked: Awaited<ReturnType<NonNullable<PlatformAdapter['pickPage']>>>;
  const pick = await pagePickUserToken(req, env);
  try {
    picked = await adapter.pickPage(env, pick.userToken, pageId);
  } catch (err) {
    throw new HttpError(400, err instanceof Error && err.message ? err.message : 'Could not connect that Page.');
  }
  const saved = await upsertAccount(env, pick.ownerId, 'facebook', picked.account, picked.tokens, picked.scopes);"""),
    ("import { parseCookies } from '../lib/sessions';",
     "import { parseCookies } from '../lib/sessions';\nimport { requireSession } from './router';"),
])

# ---------------- media.ts ----------------
patch('src/api/media.ts', [
    ("export async function confirm(req: Request, env: Env): Promise<Response> {\n  const body = await readJson(req);",
     "export async function confirm(req: Request, env: Env, userId: string): Promise<Response> {\n  const body = await readJson(req);"),
    ("    .bind(id, 'owner', mime, size, filename, r2Key, nowS())",
     "    .bind(id, userId, mime, size, filename, r2Key, nowS())"),
])
print("stage 1 done")
