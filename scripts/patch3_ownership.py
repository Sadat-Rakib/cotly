import io

def patch(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new in pairs:
        assert old in s, f"NOT FOUND in {path}: {old[:90]}"
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf8', newline='\n').write(s)
    print("patched", path)

# import from lib/sessions, not router (no cycle)
patch('src/api/posts.ts', [
    ("import { isValidTimezone, nowS, PROVIDER_LABEL } from './_shared';\nimport { requireSession } from './router';",
     "import { requireSession } from '../lib/sessions';\nimport { isValidTimezone, nowS, PROVIDER_LABEL } from './_shared';"),
])
patch('src/api/accounts.ts', [
    ("import { parseCookies } from '../lib/sessions';\nimport { requireSession } from './router';",
     "import { parseCookies, requireSession } from '../lib/sessions';"),
])

# setup.ts: scope accounts + stats + launch checklist to the requesting user
patch('src/api/setup.ts', [
    ("export async function getSetupStatus(env: Env): Promise<Response> {\n  const deployment = await deploymentStatus(env);",
     "export async function getSetupStatus(req: Request, env: Env): Promise<Response> {\n  const deployment = await deploymentStatus(env);\n  const userId = await requireSession(env, req);"),
    ("""  const accountRows = await env.DB
    .prepare('SELECT id, provider, display_name, status, last_verified_at FROM social_accounts ORDER BY created_at, id')
    .all<{ id: string; provider: string; display_name: string; status: string; last_verified_at: number | null }>();""",
     """  const accountRows = await env.DB
    .prepare('SELECT id, provider, display_name, status, last_verified_at FROM social_accounts WHERE owner_id = ? ORDER BY created_at, id')
    .bind(userId)
    .all<{ id: string; provider: string; display_name: string; status: string; last_verified_at: number | null }>();"""),
    ("""  const statRows = await env.DB
    .prepare(`SELECT provider, COUNT(*) AS total, SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected FROM social_accounts GROUP BY provider`)
    .all<ProviderAccountStats>();""",
     """  const statRows = await env.DB
    .prepare(`SELECT provider, COUNT(*) AS total, SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected FROM social_accounts WHERE owner_id = ? GROUP BY provider`)
    .bind(userId)
    .all<ProviderAccountStats>();"""),
    ("import { json } from '../lib/http';",
     "import { json } from '../lib/http';\nimport { requireSession } from '../lib/sessions';"),
])

# router.ts: already passes (req, env) for setup/status from stage 2 — verify
s = io.open('src/api/router.ts', encoding='utf8').read()
assert "setup.getSetupStatus(req, env)" in s
print("stage 3 done")
