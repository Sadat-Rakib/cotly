import io

def patch(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new in pairs:
        assert old in s, f"NOT FOUND in {path}: {old[:90]}"
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf8', newline='\n').write(s)
    print("patched", path)

# ---------------- posts.ts: thread userId through every handler ----------------
patch('src/api/posts.ts', [
    # validateComposition: restrict accounts and media to the owner
    ("""async function validateComposition(
  env: Env,
  baseCaption: string,
  mediaIds: string[],
  targets: TargetInput[],
): Promise<{ errors: FieldError[]; accounts: Map<string, AccountRow>; media: Array<{ id: string; mime: string }> }> {""",
     """async function validateComposition(
  env: Env,
  userId: string,
  baseCaption: string,
  mediaIds: string[],
  targets: TargetInput[],
): Promise<{ errors: FieldError[]; accounts: Map<string, AccountRow>; media: Array<{ id: string; mime: string }> }> {"""),
    ("""    const rows = await env.DB
      .prepare(`SELECT id, mime FROM media WHERE id IN (${mediaIdsClean.map(() => '?').join(',')})`)
      .bind(...mediaIdsClean)
      .all<{ id: string; mime: string }>();""",
     """    const rows = await env.DB
      .prepare(`SELECT id, mime FROM media WHERE owner_id = ? AND id IN (${mediaIdsClean.map(() => '?').join(',')})`)
      .bind(userId, ...mediaIdsClean)
      .all<{ id: string; mime: string }>();"""),
    ("""    const rows = await env.DB
      .prepare(`SELECT id, provider, display_name, status FROM social_accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`)
      .bind(...accountIds)
      .all<AccountRow>();""",
     """    const rows = await env.DB
      .prepare(`SELECT id, provider, display_name, status FROM social_accounts WHERE owner_id = ? AND id IN (${accountIds.map(() => '?').join(',')})`)
      .bind(userId, ...accountIds)
      .all<AccountRow>();"""),
    # create
    ("""export async function create(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const baseCaption = isStr(body.baseCaption) ? body.baseCaption : '';
  const mediaIds = Array.isArray(body.mediaIds) ? (body.mediaIds.filter(isStr) as string[]) : [];
  const targets = parseTargets(body.targets);
  const errors: FieldError[] = [];
  const { errors: compErrors, accounts, media } = await validateComposition(env, baseCaption, mediaIds, targets);
  errors.push(...compErrors);""",
     """export async function create(req: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson(req);
  const baseCaption = isStr(body.baseCaption) ? body.baseCaption : '';
  const mediaIds = Array.isArray(body.mediaIds) ? (body.mediaIds.filter(isStr) as string[]) : [];
  const targets = parseTargets(body.targets);
  const errors: FieldError[] = [];
  const { errors: compErrors, accounts, media } = await validateComposition(env, userId, baseCaption, mediaIds, targets);
  errors.push(...compErrors);"""),
    ("""      `INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, 'owner', ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(postId, baseCaption, scheduledAt, timezone, mode === 'now' ? 'now' : 'scheduled', media.length, now, now)""",
     """      `INSERT INTO posts (id, owner_id, base_caption, status, scheduled_at, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(postId, userId, baseCaption, scheduledAt, timezone, mode === 'now' ? 'now' : 'scheduled', media.length, now, now)"""),
    # list scoped
    ("""  let sql = `SELECT * FROM posts WHERE EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = posts.id AND t.status IN (${statuses.map(() => '?').join(',')}))`;
  const binds: unknown[] = [...statuses];""",
     """  const userId = await requireSession(env, req);
  let sql = `SELECT * FROM posts WHERE owner_id = ? AND EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = posts.id AND t.status IN (${statuses.map(() => '?').join(',')}))`;
  const binds: unknown[] = [userId, ...statuses];"""),
    # rawPost scoped — single chokepoint for getOne/patch/reschedule/cancel/publishNow/duplicate/remove
    ("""async function postRows(env: Env, id: string): Promise<Array<Record<string, unknown>>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? [row] : [];
}""",
     """async function postRows(env: Env, userId: string, id: string): Promise<Array<Record<string, unknown>>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND owner_id = ?').bind(id, userId).first<Record<string, unknown>>();
  return row ? [row] : [];
}"""),
    ("""export async function getOne(env: Env, id: string): Promise<Response> {
  const rows = await shape(env, await postRows(env, id));""",
     """export async function getOne(env: Env, userId: string, id: string): Promise<Response> {
  const rows = await shape(env, await postRows(env, userId, id));"""),
    ("""async function rawPost(env: Env, id: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'That post no longer exists.');
  return row;
}""",
     """async function rawPost(env: Env, userId: string, id: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ? AND owner_id = ?').bind(id, userId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'That post no longer exists.');
  return row;
}"""),
    ("""export async function patch(req: Request, env: Env, id: string): Promise<Response> {
  const post = await rawPost(env, id);""",
     """export async function patch(req: Request, env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);"""),
    ("""  const { errors, accounts, media } = await validateComposition(env, baseCaption, mediaIds, targets);""",
     """  const { errors, accounts, media } = await validateComposition(env, userId, baseCaption, mediaIds, targets);"""),
    ("""export async function reschedule(req: Request, env: Env, id: string): Promise<Response> {
  const post = await rawPost(env, id);""",
     """export async function reschedule(req: Request, env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);"""),
    ("""export async function cancel(env: Env, id: string): Promise<Response> {
  await rawPost(env, id);""",
     """export async function cancel(env: Env, userId: string, id: string): Promise<Response> {
  await rawPost(env, userId, id);"""),
    ("""export async function publishNow(env: Env, id: string): Promise<Response> {
  const post = await rawPost(env, id);""",
     """export async function publishNow(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);"""),
    ("""export async function duplicate(env: Env, id: string): Promise<Response> {
  const post = await rawPost(env, id);
  const now = nowS();
  const newId = `post_${randomId(8)}`;
  await env.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, 'owner', ?, 'draft', ?, 'scheduled', ?, ?, ?)`,
    )
    .bind(newId, String(post.base_caption ?? ''), String(post.timezone ?? 'UTC'), Number(post.media_count ?? 0), now, now)
    .run();""",
     """export async function duplicate(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);
  const now = nowS();
  const newId = `post_${randomId(8)}`;
  await env.DB
    .prepare(
      `INSERT INTO posts (id, owner_id, base_caption, status, timezone, publish_mode, media_count, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, 'scheduled', ?, ?, ?)`,
    )
    .bind(newId, userId, String(post.base_caption ?? ''), String(post.timezone ?? 'UTC'), Number(post.media_count ?? 0), now, now)
    .run();"""),
    ("""export async function remove(env: Env, id: string): Promise<Response> {
  const post = await rawPost(env, id);""",
     """export async function remove(env: Env, userId: string, id: string): Promise<Response> {
  const post = await rawPost(env, userId, id);"""),
    # retryTarget scoped via join on posts
    ("""export async function retryTarget(env: Env, targetId: string): Promise<Response> {
  const t = await env.DB.prepare('SELECT id, post_id, status FROM post_targets WHERE id = ?').bind(targetId).first<{ id: string; post_id: string; status: string }>();
  if (!t) throw new HttpError(404, 'That queue item no longer exists.');""",
     """export async function retryTarget(env: Env, userId: string, targetId: string): Promise<Response> {
  const t = await env.DB
    .prepare('SELECT t.id AS id, t.post_id AS post_id, t.status AS status FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.id = ? AND p.owner_id = ?')
    .bind(targetId, userId)
    .first<{ id: string; post_id: string; status: string }>();
  if (!t) throw new HttpError(404, 'That queue item no longer exists.');"""),
    # import requireSession
    ("import { isValidTimezone, nowS, PROVIDER_LABEL } from './_shared';",
     "import { isValidTimezone, nowS, PROVIDER_LABEL } from './_shared';\nimport { requireSession } from './router';"),
])

# ---------------- router.ts: thread userId through ----------------
patch('src/api/router.ts', [
    ("if (method === 'GET' && path === '/api/setup/status') return setup.getSetupStatus(env);",
     "if (method === 'GET' && path === '/api/setup/status') return setup.getSetupStatus(req, env);"),
    ("if (method === 'GET' && path === '/api/accounts') return accounts.listAccounts(env);",
     "if (method === 'GET' && path === '/api/accounts') return accounts.listAccounts(env, userId);"),
    ("if (method === 'DELETE' && seg.length === 3 && seg[1] === 'accounts') return accounts.removeAccount(env, seg[2] as string);",
     "if (method === 'DELETE' && seg.length === 3 && seg[1] === 'accounts') return accounts.removeAccount(env, userId, seg[2] as string);"),
    ("""    return accounts.testAccount(env, seg[2] as string);""",
     """    return accounts.testAccount(env, userId, seg[2] as string);"""),
    ("if (method === 'POST' && path === '/api/media/confirm') return media.confirm(req, env);",
     "if (method === 'POST' && path === '/api/media/confirm') return media.confirm(req, env, userId);"),
    ("if (method === 'POST' && path === '/api/posts') return posts.create(req, env);",
     "if (method === 'POST' && path === '/api/posts') return posts.create(req, env, userId);"),
    ("if (method === 'GET' && seg.length === 3 && seg[1] === 'posts') return posts.getOne(env, seg[2] as string);",
     "if (method === 'GET' && seg.length === 3 && seg[1] === 'posts') return posts.getOne(env, userId, seg[2] as string);"),
    ("if (method === 'PATCH' && seg.length === 3 && seg[1] === 'posts') return posts.patch(req, env, seg[2] as string);",
     "if (method === 'PATCH' && seg.length === 3 && seg[1] === 'posts') return posts.patch(req, env, userId, seg[2] as string);"),
    ("if (method === 'DELETE' && seg.length === 3 && seg[1] === 'posts') return posts.remove(env, seg[2] as string);",
     "if (method === 'DELETE' && seg.length === 3 && seg[1] === 'posts') return posts.remove(env, userId, seg[2] as string);"),
    ("""        return posts.reschedule(req, env, id);""",
     """        return posts.reschedule(req, env, userId, id);"""),
    ("""        return posts.cancel(env, id);""",
     """        return posts.cancel(env, userId, id);"""),
    ("""        return posts.publishNow(env, id);""",
     """        return posts.publishNow(env, userId, id);"""),
    ("""        return posts.duplicate(env, id);""",
     """        return posts.duplicate(env, userId, id);"""),
    ("""    return posts.retryTarget(env, seg[2] as string);""",
     """    return posts.retryTarget(env, userId, seg[2] as string);"""),
])
print("stage 2 done")
