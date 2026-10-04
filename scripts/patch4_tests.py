import io

def patch(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new in pairs:
        assert old in s, f"NOT FOUND in {path}: {old[:90]}"
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf8', newline='\n').write(s)
    print("patched", path)

# ---- api.test.ts: 0003 schema, per-request cookie opt, isolation tests ----
patch('src/api/api.test.ts', [
    ("import schema0002 from '../../migrations/0002_user_name.sql?raw';",
     "import schema0002 from '../../migrations/0002_user_name.sql?raw';\nimport schema0003 from '../../migrations/0003_user_ownership.sql?raw';"),
    ("""  for (const stmt of statements) await e.DB.prepare(stmt).run();
  await e.DB.prepare(schema0002.trim()).run();""",
     """  for (const stmt of statements) await e.DB.prepare(stmt).run();
  await e.DB.prepare(schema0002.trim()).run();
  for (const stmt of schema0003.split('\\n').filter((l) => !l.trimStart().startsWith('--')).join('\\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await e.DB.prepare(stmt).run();
  }"""),
    ("""async function api(path: string, method: string, body?: unknown, opts: { auth?: boolean; csrf?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth && cookieHeader) headers['cookie'] = cookieHeader;
  if (opts.csrf) headers['x-csrf'] = csrf;""",
     """async function api(path: string, method: string, body?: unknown, opts: { auth?: boolean; csrf?: boolean; cookie?: string; asUser?: 'B' } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth && cookieHeader) headers['cookie'] = opts.cookie ?? cookieHeader;
  if (opts.csrf) headers['x-csrf'] = opts.asUser === 'B' ? userBCsrf : csrf;"""),
    ("let threadsAccId = '';",
     "let threadsAccId = '';\nlet userBCookie = '';\nlet userBCsrf = '';"),
    # isolation tests appended before the final closing of the file is hard — insert after registration test
    ("""  expect(body.email).toBe('new@test.dev');
  expect(body.isSetup).toBe(true);
});""",
     """  expect(body.email).toBe('new@test.dev');
  expect(body.isSetup).toBe(true);
});

test('multi-user isolation: a second user sees none of the owner data', async () => {
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  const reg = await api('/api/auth/register', 'POST', { name: 'User B', email: 'userb@test.dev', password: 'password123' });
  expect(reg.status).toBe(201);
  const c = cookiesOf(reg);
  userBCookie = `cotly_session=${c.cotly_session}`;
  userBCsrf = c.cotly_csrf ?? '';
  const b = { auth: true, cookie: userBCookie, asUser: 'B' as const };

  // B sees no connected accounts
  const bAccounts = await api('/api/accounts', 'GET', undefined, b);
  expect(bAccounts.status).toBe(200);
  expect(await bAccounts.json()).toEqual([]);

  // Owner creates a post on the owner's mock account
  const { postId, targetId } = await createNowPost('Owner secret post');

  // B cannot read, edit, or delete the owner's post
  expect((await api(`/api/posts/${postId}`, 'GET', undefined, b)).status).toBe(404);
  expect((await api(`/api/posts/${postId}`, 'PATCH', { baseCaption: 'hacked' }, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/posts/${postId}`, 'DELETE', undefined, { ...b, csrf: true })).status).toBe(404);

  // B cannot retry the owner's queue target or disconnect the owner's account
  expect((await api(`/api/targets/${targetId}/retry`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/accounts/${threadsAccId}/test`, 'POST', undefined, { ...b, csrf: true })).status).toBe(404);
  expect((await api(`/api/accounts/${threadsAccId}`, 'DELETE', undefined, { ...b, csrf: true })).status).toBe(404);

  // B's queue is empty
  const bPosts = await api('/api/posts', 'GET', undefined, b);
  expect(await bPosts.json()).toEqual([]);

  // Owner still sees their own post
  const ownerList = await api('/api/posts', 'GET', undefined, { auth: true });
  const ownerPosts = (await ownerList.json()) as Array<{ id: string }>;
  expect(ownerPosts.some((p) => p.id === postId)).toBe(true);
});

test('media upload and its URL are scoped to the uploading user', async () => {
  // Owner confirms a media row, then user B must get a plain 404 for its URL.
  (env as unknown as Record<string, string | undefined>).ALLOW_REGISTRATION = 'true';
  const mediaId = `med_${randomId(8)}`;
  await e.DB
    .prepare(`INSERT INTO media (id, owner_id, mime, size, original_filename, r2_key, created_at) VALUES (?, 'owner', 'image/png', 10, 'own.png', 'media/own/iso.png', ?)`)
    .bind(mediaId, nowS())
    .run();
  const b = { auth: true, cookie: userBCookie, asUser: 'B' as const };
  expect((await api(`/api/media/${mediaId}/url`, 'GET', undefined, b)).status).toBe(404);
  expect((await api(`/api/media/${mediaId}/url`, 'GET', undefined, { auth: true })).status).toBe(200);
});"""),
])

# ---- setup.test.ts: run 0003 too ----
patch('src/api/setup.test.ts', [
    ("import schema0001 from '../../migrations/0001_init.sql?raw';",
     "import schema0001 from '../../migrations/0001_init.sql?raw';\nimport schema0003 from '../../migrations/0003_user_ownership.sql?raw';"),
])
print("stage 4 done")
