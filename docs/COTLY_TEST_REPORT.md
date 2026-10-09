# COTLY_TEST_REPORT

Real results from this repo (fix/mvp-recovery-2026-10). Commands + outcomes only;
nothing fabricated. Legend: PASS / FAIL / BLOCKED / NOT TESTED.

## Automated (run locally, this session)
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (tsc --noEmit) | PASS — 0 errors |
| Unit/integration suite | `npm test` (vitest run) | PASS — 14 files, 152 tests |
| Production build | `npm run build` (vite build) | PASS — client 464.72kB / 144.28kB gzip |

### Suite breakdown (vitest projects: workers + node)
- src/api/api.test.ts — 24 PASS (CRUD, queue shape, multi-user isolation, media lifecycle)
- src/api/setup.test.ts — 10 PASS
- src/api/publish-verify.test.ts — 8 PASS (Publish Now truthful outcomes)
- src/api/threads-connect.test.ts — PASS
- src/engine/engine.test.ts — 11 PASS (due publish, retry ladder, give-up after 5,
  expire->reconnect->publish-once, dupe replay same id, pending->published,
  invalid media non-retryable, rollup, media cleanup)
- src/engine/reliability.test.ts — 4 PASS (stale reclaim, scoped claim,
  401->needs_reconnect + recover)
- src/adapters/*.test.ts (bluesky, facebook, instagram, linkedin, threads, x,
  registry, contract) — PASS (node project)

The EBUSY "Unable to remove temporary directory" lines from vitest-pool-workers
are Windows temp-cleanup warnings AFTER tests complete; they do not affect results.

## Live / provider verification
| Item | Result | Evidence |
|---|---|---|
| Bluesky publish-now + scheduled | PASS (LIVE, prior) | PROGRESS.md: post_QlyctCdAhIo, at:// records confirmed |
| Threads publish via cron | PASS (LIVE, prior) | PLATFORM_BLOCKERS.md: permalink confirmed |
| Facebook / Instagram / LinkedIn / X live publish | BLOCKED | needs owner dev-app credentials + (Meta/IG) App Review |

## Not run / blocked this session (honest)
- Local `wrangler dev` end-to-end browser QA — NOT TESTED this session (requires
  local D1 migrate + wrangler dev; see COTLY_PRODUCTION_READINESS for commands).
- Lint — no `lint` script in package.json; NOT CONFIGURED.
- DOM unit tests for Modal/Lightbox a11y — NOT CONFIGURED (vitest has no jsdom
  project); verified via typecheck + build + manual review instead.
- Production deploy — BLOCKED on owner (wrangler login / Cloudflare auth).
