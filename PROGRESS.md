# Cotly Progress Checkpoint

Last updated: 2026-10-01. Resume from here — do not restart from scratch.

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
