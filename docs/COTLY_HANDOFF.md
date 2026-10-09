# COTLY_HANDOFF

Checkpoint for resuming the MVP recovery mission. Resume from the "Next steps".

## Repository
- Root: `Cotly/` (nested in the Scrapivo workspace). Work ONLY inside `Cotly/`.
- Remote: github.com/Sadat-Rakib/cotly.git. Base `main` @ d2d4ddc.
- Fix branch: `fix/mvp-recovery-2026-10`. Commits so far: d5e6f1b (Phase 0-1).

## Baseline (verified on fix branch)
- `npm run typecheck` -> 0 errors.
- `npm test` -> 14 files, 152 tests PASS.
- `npm run build` -> clean (client 464.72kB / 144.28kB gzip).

## Phase status
- Phase 0 DONE: repo verified, fix branch created, FILE_MAP saved.
- Phase 1 DONE: Modal hardened (ref-counted scroll lock, focus trap, focus
  save/restore, Esc via capture, dismiss-guard hooks), Lightbox multi-attachment
  navigation (prev/next + arrow keys + counter), MediaPicker wired, CSS added.
  typecheck/build/tests all green. Commit d5e6f1b.
- Phase 2 VERIFIED (no code change needed): account status single source =
  social_accounts.status (D1, owner-scoped). needs_reconnect set ONLY on genuine
  credential-invalidation outcomes (publish.ts). Transient errors (429/timeout/
  5xx/network) classified as retryable failures in adapters/_shared.ts and never
  touch account status. Recovery (refresh/reconnect) resets status='connected'.
  Covered by reliability.test.ts "x 401 flips ... fresh credentials recover".
- Phase 3 VERIFIED (no code change needed): single publishing authority; in-flight
  guard blocks duplicate submits; published/assisted never re-published
  (idempotency targetId:generation); truthful outcome read from DB post-attempt;
  no swallowed exceptions into false success. Covered by publish-verify.test.ts (8).
- Phase 4 VERIFIED (no code change needed): cron `* * * * *`; runSchedulerTick does
  reclaim->claim->publish->resolve-pending->rollup->media-cleanup; atomic claim via
  conditional UPDATE RETURNING; bounded retry ladder [0,120,600,1800,7200], max 5;
  stale-inflight reclaim keeps same generation; pending stays 'publishing' (never
  republished on uncertain outcome); 24h pending cap. Covered by engine.test.ts (11)
  + reliability.test.ts (4). Browser-independent (server cron).

## Next steps
1. Phase 5: write docs/COTLY_PLATFORM_API_AUDIT.md from adapter code + official docs.
   Adapters present: bluesky(LIVE), threads(LIVE), facebook, instagram, linkedin, x.
   Not implemented: reddit, mastodon, telegram, pinterest, tiktok (honestly "soon").
2. Phase 6: COTLY_META_REVIEW_CHECKLIST / PERMISSION_JUSTIFICATIONS / DEMO_SCRIPT
   from META_REVIEW_READINESS.md + docs/platforms/*.md + current Meta docs.
3. Phase 7: COTLY_TEST_REPORT.md with the real command outputs above.
4. Phase 8-9: local run guide + COTLY_PRODUCTION_READINESS.md + COTLY_ARCHITECTURE.md.

## Hard blockers (owner action, cannot resolve in-repo)
- Provider credentials + app review (Meta/LinkedIn/X), Cloudflare login for deploy,
  R2 enablement, Neon project. See PLATFORM_BLOCKERS.md.
- No production deploy / real external posting without explicit owner approval.

## Completion (this session)
- Phases 5-9 docs written from verified evidence. All 10 COTLY_* docs present.
- Final suite re-confirmed: 152/152 PASS, typecheck 0, build clean.
- Remaining = owner external actions only (credentials, Meta review, deploy).
