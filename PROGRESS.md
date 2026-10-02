# Cotly Progress Checkpoint

Last updated: 2026-10-02 (v0.2). Resume from here — do not restart from scratch.

## v0.2 (this session — per MASTER EXECUTION PRD)
- Baseline re-verified; fixed latent test-secret time-bomb (suites now force ENCRYPTION_SECRET; pool .dev.vars loading had flipped).
- Setup Center backend: GET /api/setup/status (deployment probes, per-provider config badges, real-state launch checklist), GET /api/media/:id/url (presigned GET, owner-only), POST /api/accounts/:id/test (adapter testConnection).
- Adapters: testConnection for facebook/threads/linkedin/bluesky (bluesky attempts session refresh, report-only).
- UI: public landing at `/` (honest platform badges), app under /app/*, Setup Center page, onboarding welcome panel, composer media ordering + caption-overflow warnings + MANDATORY review/confirm gate (no POST /api/posts without explicit Confirm), accounts test-connection, media preview URLs.
- npm scripts now always pass `--config ./wrangler.toml` (dev, deploy) — parent-tanstack config hijack can't recur.
- 92/92 tests green, tsc clean, vite build clean.

## LIVE VERIFIED (2026-10-02) — Bluesky, production Cloudflare
- Deployment: https://cotly.cotly-app.workers.dev (worker `cotly`, D1 e68507d1, cron 1 min, secrets set; R2 NOT yet enabled account-wide -> wrangler.prod.toml deploys without the R2 binding; code is null-safe. To unlock media: enable R2, `wrangler r2 bucket create cotly-media`, copy the [[r2_buckets]] block into wrangler.prod.toml, redeploy.)
- Test 1 (Publish Now, approved): post_QlyctCdAhIo / tgt_3FO1oKV8Hf8 -> PUBLISHED, delta 60s, 1 attempt, confirmed. at://did:plc:oyl54talfmhejs3qge374q5j/app.bsky.feed.post/3mwvu3ohsu422
- Test 2 (Scheduled cloud-only, approved): post_bV6TpvhL6wE / tgt_bIRFkwl_spU -> PUBLISHED, scheduled_at 1790960987, published_at 1790961035 (delta 48s), 1 attempt, confirmed. at://.../3mwvui6rnx22n
- Both externally verified via public.api.bsky.app getRecord (cid + exact text). No duplicate publications.
- Owner: mir@cotly.local (password in .owner-credentials.txt, gitignored — change later; no change-password endpoint yet).

## Deployment status
- `npx wrangler whoami` → NOT authenticated. Human step required: `npx wrangler login` in Cotly dir (or CLOUDFLARE_API_TOKEN env). Then: d1 create → paste id in wrangler.toml → r2 bucket create → db:remote → build+deploy → secrets (ENCRYPTION_SECRET, SESSION_SECRET; R2 S3 creds optional for media) → /setup on the worker URL.

## Next steps after deploy
1. Owner bootstrap on production URL.
2. First real provider per PRD §9: Bluesky is fastest legitimate route (app password, no app review). Meta/LinkedIn routes need developer apps + callback URLs (Setup Center shows exact callback per provider).
3. Live tests per PRD §22: Publish Now + Cloud Scheduled (local env closed), evidence recorded per §37. NEVER publish real content without explicit user approval (§20).

## What finished (this session)
- Full initial build per MASTER BUILD PRD, in goal-mandated order: scheduler engine + MockSocial first, Tier-1 adapters second, expansion deferred.
- Engine: atomic claiming (`UPDATE ... RETURNING`), idempotency (`targetId:generation`), retry ladder [0,120,600,1800,7200]s, needs_reconnect flow, pending (Threads-style two-step) resolution, post rollup, media cleanup after retention, diagnostics breadcrumbs. `src/engine/`.
- MockSocial provider with fault injection tokens `[mock:429|500|timeout|expire|invalidmedia|delay|dupe]`. `src/engine/providers/mock.ts`.
- Adapters (code-complete, official APIs only): facebook (Graph v21), threads (container→publish→poll), linkedin (REST posts + image registerUpload), bluesky (ATProto + refresh). `src/adapters/`. 7 docs/platforms/*.md + README.
- API: setup/login/logout/ratelimit, CSRF double-submit, accounts (+oauth start/callback), presigned R2 media upload, posts CRUD + queue views + retry, settings (tz, retention, X budget), diagnostics. `src/api/`, `src/lib/sessions.ts`, `src/lib/ratelimit.ts`.
- UI: React SPA — compose (media, overrides, 3 schedule modes), queue (5 tabs, retry/reconnect), calendar, accounts, settings, diagnostics; dark/light, mobile nav. `src/ui/`.
- Local E2E smoke PASSED: setup → login → mock account → publish-now post → cron tick → target published with evidence; diagnostics shows confirmed attempt; SPA serves at /.

## Verification status
- `npx vitest run` → 68/68 green (engine 11, api 17, adapters 40).
- `npx tsc --noEmit` → 0 errors. `npx vite build` → clean (82 kB gzip).
- Real-platform live publishing: NOT tested — blocked on user creating Meta/Threads/LinkedIn developer apps + secrets.

## Failures hit & resolved (don't rediscover)
- vitest.config.ts: `defineWorkersOptions` doesn't exist in pool-workers 0.8.x → use `defineWorkersProject` per project.
- tests: `DB.exec` rejects leading `--` comment line → strip comments, run statements individually.
- `wrangler dev` from this nested dir resolved the PARENT tanstack project's entry (hang, port squatting by stale node PID) → ALWAYS run `npx wrangler dev --config ./wrangler.toml`. Local cron trigger: `curl http://127.0.0.1:8790/cdn-cgi/local/scheduled`.
- Local boot order: `npx wrangler d1 migrations apply cotly-db --local --config ./wrangler.toml` before dev, else /api 500s on missing tables.
- npm: workers-types must be ^5 for wrangler 4.146.

## Next steps
1. User: create developer apps (see docs/platforms/*.md), set secrets (`META_*`, `THREADS_*`, `LINKEDIN_*`, `R2_*`), then live-test facebook → threads → bluesky/linkedin per PRD #44.
2. Deploy: create D1 (paste id in wrangler.toml) + R2 bucket, `npm run db:remote`, `wrangler secret put ...`, `npm run deploy`, complete /setup on the worker URL.
3. Then PRD acceptance tests A–J against real accounts; Instagram/X/Reddit adapters after that (X needs budget guard wiring — settings already stored).
