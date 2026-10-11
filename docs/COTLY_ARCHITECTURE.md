# COTLY_ARCHITECTURE

Verified from source. Single Cloudflare Worker serving a React SPA + JSON API,
backed by D1 (SQLite) and R2, driven by a 1-minute cron.

## Runtime topology
Browser (React 19 SPA) --https--> Cloudflare Worker (`src/index.ts`)
  - static assets via [assets] binding, SPA fallback
  - /api/* and /oauth/* run the Worker first (wrangler.toml run_worker_first)
Worker --> D1 `cotly-db` (DB binding) — all app state
Worker --> R2 `cotly-media` (MEDIA binding) — media blobs (null-safe if absent)
Cron `* * * * *` --> runSchedulerTick (publishing, retries, cleanup)

## Request flow
`src/index.ts` -> `src/api/router.ts` -> handlers in `src/api/*.ts`
(auth, accounts, posts, media, settings, setup). Sessions + CSRF in
`src/lib/sessions.ts`; rate limiting in `src/lib/ratelimit.ts`; token
encryption (AES-256-GCM) in `src/lib/crypto.ts`; R2 access in
`src/lib/objectstore.ts`; HTTP helpers in `src/lib/http.ts`.

## Publishing engine (`src/engine`)
- `claim.ts` — atomic due-target claim (conditional UPDATE ... RETURNING).
- `publish.ts` — applyOutcome state machine, retry ladder [0,120,600,1800,7200]
  (max 5), idempotency key `targetId:generation`, needs_reconnect flow, pending
  (two-step) resolution with 24h cap, stale in-flight reclaim.
- `cron.ts` — runSchedulerTick (reclaim->claim->publish->resolve pending->rollup
  ->media cleanup) and publishPostNow (same pipeline, scoped to one post).
- `cleanup.ts` — post status rollup + expired-media deletion.
- `providers/mock.ts` — MockSocial with fault-injection tokens for tests.

## Adapters (`src/adapters`) + registry
Facebook, Instagram, Threads, LinkedIn, Bluesky, X, plus Assisted and Mock.
`registry.ts` maps Provider -> adapter. Capabilities centralized in
`src/contracts/capabilities.ts`. Shared helpers + error classification in
`_shared.ts` (timeouts/network/429 -> retryable; genuine auth -> needs_reconnect).

## Data model (migrations 0001-0005)
posts, post_targets (per-platform job rows w/ status, attempt_count,
publish_generation, next_retry_at), publishing_attempts (audit),
social_accounts (owner-scoped, encrypted tokens, status), media + post_media,
oauth_states (single-use), activity_log, settings, user ownership + settings.

## Status lifecycles
Post target: scheduled -> claimed -> publishing -> published | retrying |
failed | needs_reconnect | assisted | cancelled. Account: connected |
needs_reconnect | disabled. Status is the single source of truth in D1.

## Frontend (`src/ui`)
React SPA: pages (Landing, Login/Signup, Compose, Queue, Calendar, Profile,
Setup, Services, legal). Components incl. hardened Modal + Lightbox, MediaPicker,
ReviewScreen (mandatory confirm gate), ScheduleSection, StatusBadge.
