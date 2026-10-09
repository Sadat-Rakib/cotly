# COTLY_FILE_MAP

Verified file inventory and recovery plan. This document is written FIRST (per the
Master PRD Phase 0 mandate) so that even if work is interrupted, the important file
references survive for manual continuation.

> Evidence basis: every claim below was verified by reading the file or running the
> command noted. Nothing here is carried over from the previous (wrong-folder) audit.

## A. Verified repository identity

| Field | Value |
|---|---|
| Verified project root | `c:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)\Cotly` |
| package.json name | `cotly` (v0.1.0) |
| Git remote (origin) | `https://github.com/Sadat-Rakib/cotly.git` |
| Base branch | `main` @ `d2d4ddc` |
| Working fix branch | `fix/mvp-recovery-2026-10` (created clean, nothing stashed/discarded) |
| Runtime | Cloudflare Workers (`wrangler.toml`), D1 (`cotly-db`), R2 (`cotly-media`), cron `* * * * *` |
| Frontend | React 19 + Vite SPA under `src/ui` (served via Worker ASSETS, SPA fallback) |
| Backend | Single Worker entry `src/index.ts` -> `src/api/router.ts` |
| DB access | D1 in dev/prod; Neon Postgres migration is a planned future sprint (see PLATFORM_BLOCKERS.md) |

NOTE: This Cotly project is a NESTED folder inside a different, unrelated project
("Scrapivo", a TanStack investor-directory app at the workspace root). All Cotly work
happens strictly inside the `Cotly/` subfolder. The 10 COTLY_* audit docs did NOT
previously exist in this repo; they are being created from verified evidence.

## B. Baseline verification (run on fix branch, 2026-10-09)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | PASS — 0 errors |
| Test suite | `npm test` (`vitest run`) | PASS — 14 files, 152 tests green |
| Source size | — | 81 .ts/.tsx source files, 14 test files |

The Master PRD's premise ("1,322 TS errors", "Publish Now does nothing",
"scheduling broken") describes the WRONG folder's state. This repo's baseline is
green. Work is therefore targeted hardening + honest auditing, not a rebuild.

## C. Relevant files by concern

### Phase 1 — Media, modals, UI (`src/ui/components`, `src/ui/pages`)
| File | Controls |
|---|---|
| `src/ui/components/Modal.tsx` | Base modal shell (overlay, dialog role, close). GAPS: no scroll-lock, no focus trap, no focus restore, no explicit z-index. |
| `src/ui/components/Lightbox.tsx` | Full-size image/video preview; Escape-to-close; replace/remove. GAP: single item only (no multi-attachment navigation). |
| `src/ui/components/MediaPicker.tsx` | Media selection, object-URL management, `MediaItem` type source. |
| `src/ui/components/MediaThumb.tsx` | Thumbnail rendering. |
| `src/ui/pages/Compose.tsx` | Post composer; integrates picker + lightbox + review gate. |
| `src/ui/components/ReviewScreen.tsx` | Mandatory publish review/confirm gate. |
| `src/ui/pages/Queue.tsx` | Scheduled queue, retry/reconnect actions. |
| `src/ui/components/ScheduleSection.tsx`, `TimezoneSelect.tsx` | Schedule mode + tz->UTC selection. |

### Phase 2 — Account connections / reconnect state
| File | Controls |
|---|---|
| `src/api/accounts.ts` | OAuth start/callback, Page chooser, testConnection, status source of truth. |
| `src/api/auth.ts` | Session/login/CSRF. |
| `src/ui/pages/Services.tsx`, `Setup.tsx` | Account status UI + Setup Center guides. |
| `src/adapters/*.ts` | Per-provider `testConnection`/`refresh`. |

### Phase 3 — Publishing pipeline
| File | Controls |
|---|---|
| `src/engine/publish.ts` | Core publish, applyOutcome state machine, retry ladder `[0,120,600,1800,7200]`, MAX_ATTEMPTS=5, pending resolution, stale reclaim, idempotency `targetId:generation`. |
| `src/engine/claim.ts` | Atomic due-target claiming (conditional UPDATE ... RETURNING). |
| `src/api/posts.ts` | Posts CRUD, queue views, Publish Now entry, retry. |
| `src/adapters/registry.ts` | Central provider registry. |

### Phase 4 — Scheduling / cron / retries
| File | Controls |
|---|---|
| `src/engine/cron.ts` | `runSchedulerTick` (reclaim -> claim -> publish -> resolve pending -> rollup -> media cleanup) and `publishPostNow` fast path. Same single publishing authority. |
| `src/engine/cleanup.ts` | Post status rollup + expired-media cleanup. |
| `wrangler.toml` / `wrangler.prod.toml` | cron trigger `* * * * *`, D1/R2 bindings. |
| `migrations/0001..0005*.sql` | Schema: posts, post_targets, publishing_attempts, social_accounts, media, activity_log, settings, user ownership, media lifecycle, user settings. |

### Phase 5 — Platform adapters (`src/adapters`)
Present (code-complete, official APIs): `bluesky.ts` (LIVE), `threads.ts` (LIVE),
`facebook.ts`, `instagram.ts`, `linkedin.ts`, `x.ts`, plus `assisted.ts`, `registry.ts`, `_shared.ts`.
Each has a matching `*.test.ts`. NOT present as native adapters (PRD lists them but
code does not pretend otherwise): Reddit, Mastodon, Telegram, Pinterest, TikTok.

### Phase 6 — Meta review
`META_REVIEW_READINESS.md` (exists), `docs/platforms/*.md`. To be consolidated into
the three COTLY_META_* docs.

### Lib / infra
`src/lib/crypto.ts` (token encryption), `sessions.ts`, `ratelimit.ts`, `http.ts`,
`objectstore.ts` (R2). Secrets live in `.dev.vars`/`.env.local`/`.owner-credentials.txt`
(gitignored) — NEVER read or echoed.

## D. Problems identified (verified) vs PRD premise
- Phase 1: real, implementable a11y gaps in Modal/Lightbox (scroll lock, focus trap,
  focus restore, multi-attachment nav). Everything else is sound.
- Phases 2-4: already implemented AND covered by passing tests (atomic claim,
  idempotent replay, retry ladder, stuck-job reclaim, needs_reconnect, pending resolve).
  Action = verify + harden, NOT rewrite.
- Phase 5: 6 native adapters exist; remainder honestly "coming soon". Live blockers are
  external credentials/app-review, not code.
- Phases 7-9: establish honest baseline (done: green), document, record external blockers.

## E. Planned implementation order
1. (DONE) Phase 0: verify repo, fix branch, baseline, this FILE_MAP.
2. Phase 1: harden Modal (scroll lock + focus trap + restore + z-index) and Lightbox
   (multi-attachment nav); add targeted tests; re-run typecheck + tests.
3. Phase 2-4: targeted verification pass; fix only genuine defects found.
4. Phase 5-6: write COTLY_PLATFORM_API_AUDIT + Meta docs from verified adapter code + official docs.
5. Phase 7: full suite + build; record PASS/FAIL/BLOCKED honestly in COTLY_TEST_REPORT.
6. Phase 8-9: local run instructions, production readiness, remaining COTLY_* docs + handoff.

## F. Owner-action / external blockers (cannot be resolved in-repo)
Provider credentials + app review (Meta/LinkedIn/X/etc.), Cloudflare login for deploy,
R2 enablement, Neon project. Full detail in PLATFORM_BLOCKERS.md and (to come)
COTLY_PRODUCTION_READINESS.md. No production deploy or real external posting without
explicit owner authorization.
