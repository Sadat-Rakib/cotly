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

## Session 2026-10-10 (UI + live E2E)
- PRD Phase 1 UI implemented, commit 79636a7: brand mark = open C + dot
  exiting the gap (Logo.tsx, all brand SVGs, favicon, regenerated PNGs via
  scripts/generate-brand-pngs.js; hero artwork's old C patched via
  scripts/patch-hero-mark.mjs reading hero-device-src.webp). Hero tagline now
  below the illustration at every width; navbar font bumped; 4 distinct demo
  thumbs (rocket/workspace/phone/team SVGs) + visible "demo" label; glass
  footer; auth contrast; sidebar logo-toggles-collapse (no separate button,
  persisted, tooltips via title+aria-label); fixed main column double-counting
  --sb-w (content had ~270px dead gap; collapsed state worse).
- Live browser E2E vs real Worker+D1+MockSocial: publish-now AND scheduled
  paths verified incl. no-early-publish via the real scheduled handler; see
  COTLY_TEST_REPORT.md. Clean `npm ci` → typecheck/test/build all green.
- A user WIP (encoding fixes + lightbox feature revert) was preserved in
  git stash "WIP checkpoint 2026-10-10"; the encoding fixes were re-applied
  properly, the lightbox revert was intentionally NOT kept (it undid add243e).

## Session 2026-10-11 (deploy + production verification)
- DEPLOYED with owner approval: Worker at 5090d4a (Version c191746d), Vercel
  frontend redeployed (identical bundle hash). /api/version proves the commit.
- Sidebar verified in a real browser at 1440/1280/768/390: brand click toggles
  collapse, "Toggle sidebar" tooltip (title+aria-label), icon tooltips,
  persistence, mobile drawer, no overflow. Root cause of user's stale UI was
  the outdated deployment (4049ed8), not the code.
- REAL production cron proven automatic: settings.last_tick_at advanced
  00:19:48 -> 00:22:48 UTC with no manual trigger.
- fix 5090d4a: stranded post headers (all targets terminal, post stuck
  'scheduled') are swept every tick; regression test added (153 tests). Real
  cron healed the two stale production posts automatically.
- Oct 7 failed scheduled Threads post diagnosed: bounded retry ladder worked
  (gave up after exactly 5); the still-processing root cause was fixed in
  4049ed8 (now deployed). No duplicate provider_post_ids in production D1.
- X budget state: $0.065 of $5.00 cap used (platform_usage 2026-10).
- Live-provider publish tests (Threads/X/Instagram) BLOCKED this session: the
  connected tokens live in production D1 and require a session for
  mirsadatbinrakib01@gmail.com; the password was not provided. Historical
  real-provider evidence in prod D1: Threads permalinks (e.g.
  threads.com/@mirsadat.ai/post/DeR5bRBFVvi, id 18024665282818141) + 3 X posts.
