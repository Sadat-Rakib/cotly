# COTLY_PRODUCTION_READINESS

Honest go/no-go. Verdict: CONDITIONAL GO. The application core is sound and
test-green; remaining items are external (credentials, app review) or owner
deploy actions, not code defects.

## Verdict by area
| Area | Status | Notes |
|---|---|---|
| TypeScript / build | GO | 0 errors; clean vite build |
| Test suite | GO | 152/152 pass |
| Media/modals (Phase 1) | GO | hardened; a11y verified by typecheck/build/manual |
| Account/reconnect (Phase 2) | GO | correct status source; transient != disconnect |
| Publish Now (Phase 3) | GO | single authority, idempotent, truthful outcomes |
| Scheduling/cron/retries (Phase 4) | GO | atomic claim, bounded retry, stale reclaim, browser-independent |
| Bluesky / Threads | GO (LIVE verified) | — |
| Facebook / Instagram / LinkedIn / X | CONDITIONAL | code-complete; need creds + (Meta) review |
| Reddit/Mastodon/Telegram/Pinterest/TikTok | N/A | not implemented; honestly "coming soon" |
| Local browser QA | PENDING | commands below; not run this session |

## Local run (manual QA)
1. `npm run db:local` (applies D1 migrations locally).
2. `npm run dev` (= wrangler dev --config ./wrangler.toml). URL: http://localhost:8787
3. Trigger cron locally: POST the scheduled endpoint, e.g.
   `curl http://127.0.0.1:8787/cdn-cgi/handler/scheduled` (wrangler local scheduled trigger).
4. Mock publishing is enabled locally (MOCK_SOCIAL_ENABLED=true) — use a mock
   account for end-to-end publish/schedule checks without real posting.

## Config / secrets (never commit values)
- Secrets live in `.dev.vars` / `.env.local` / `.owner-credentials.txt` (gitignored).
  Required: ENCRYPTION_SECRET, SESSION_SECRET; provider CLIENT_ID/SECRET per platform;
  optional R2 S3 creds for media. NEVER log or echo these.
- wrangler.toml (dev) vs wrangler.prod.toml (deploy). cron `* * * * *` set.

## Deploy plan (owner action — requires authorization)
1. `npx wrangler login` (or CLOUDFLARE_API_TOKEN).
2. Ensure D1 `cotly-db` id in wrangler.prod.toml; `npm run db:remote`.
3. (Media) enable R2, `wrangler r2 bucket create cotly-media`, add [[r2_buckets]]
   to wrangler.prod.toml.
4. `wrangler secret put ENCRYPTION_SECRET` / `SESSION_SECRET` / provider secrets.
5. `npm run deploy` (stamps version, builds, wrangler deploy).
6. Complete owner bootstrap at the worker /setup; register OAuth callbacks.

## Rollback
- Code: `git checkout main` (base d2d4ddc) and redeploy, or revert the fix-branch
  merge. The fix branch makes NO schema changes (migrations 0001-0005 unchanged),
  so no DB rollback is required.
- Data: D1 unaffected by this branch; no destructive migration introduced.

## Do-not-do without explicit owner authorization
- Production deploy. Real external posting. Meta App Review submission.
- Any destructive DB operation.
