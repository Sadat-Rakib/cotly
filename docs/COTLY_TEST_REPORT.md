# COTLY_TEST_REPORT

Real results from this repo (fix/mvp-recovery-2026-10). Commands + outcomes only;
nothing fabricated. Legend: PASS / FAIL / BLOCKED / NOT TESTED.

## Automated (run locally, this session)
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (tsc --noEmit) | PASS — 0 errors |
| Unit/integration suite | `npm test` (vitest run) | PASS — 14 files, 152 tests |
| Production build | `npm run build` (vite build) | PASS — client 464.28kB / 144.15kB gzip |
| Clean install | `npm ci` | PASS — 424 packages, no lockfile errors; suite re-run green after |
| Live UI / E2E (browser) | wrangler dev + real D1, driven via browser at 1440/1280/768/390 | PASS — see below |

### Live browser E2E against the real local Worker + D1 (2026-10-10)
- Signup (fresh account) → Compose → Connect MockSocial → Publish now
  (Review → Confirm) → redirected to Queue "Published" with provider
  confirmation toast; D1 target row `published`, attempt_count=1,
  provider_post_id set. Post rolls up to `published`.
- Schedule path: post scheduled for 17:10 America/Edmonton (D1 stores
  `scheduled_at` in Unix seconds; due_utc 23:10Z verified). Real scheduled
  event (`/cdn-cgi/local/scheduled`, the actual `scheduled` handler) fired
  BEFORE due: target stayed `scheduled`, 0 attempts (no early publish).
  Fired AFTER due: target `published`, attempt_count=1, provider_post_id set.
- `/api/diagnostics` live: d1/cron/r2 true, secrets set, providers.mock=confirmed.
- No horizontal overflow at any width (`scrollWidth == clientWidth` on landing,
  compose, queue, calendar). Sidebar logo-toggle collapse persisted via
  localStorage; mobile drawer verified at 768/390.
- File-upload media flow NOT browser-verified (in-app browser cannot drive OS
  file choosers); covered by 10/10 media unit/integration checks instead.

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
- Lint — no `lint` script in package.json; NOT CONFIGURED.
- DOM unit tests for Modal/Lightbox a11y — NOT CONFIGURED (vitest has no jsdom
  project); verified via typecheck + build + manual review instead.
- Production deploy — BLOCKED on owner (wrangler login / Cloudflare auth).
- Real-provider publish (Facebook/Instagram/LinkedIn/X) — BLOCKED on owner
  dev-app credentials + platform review; Bluesky & Threads verified LIVE in
  earlier sessions (see Live/provider verification above).
