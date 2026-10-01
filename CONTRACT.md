# Cotly Build Contract

Read this fully before writing code. Single source of truth for the parallel build.
Stack: Cloudflare Workers + D1 + R2 + React/Vite SPA. TypeScript strict. PRD: see workspace `docs/` or the master build PRD.

## Ownership map — do NOT edit files outside your ownership

Already written by CORE (read, import, do not modify): `package.json`, `wrangler.toml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `migrations/0001_init.sql`, `src/index.ts`, `src/contracts/*` (env.ts, types.ts, capabilities.ts), `src/lib/crypto.ts`, `src/lib/http.ts`.

| Agent | Owns |
|---|---|
| ENGINE | `src/engine/**` (cron.ts, claim.ts, publish.ts, cleanup.ts, providers/mock.ts + `*.test.ts`) |
| API | `src/api/**` + `src/lib/sessions.ts`, `src/lib/ratelimit.ts` + `src/api/*.test.ts` |
| ADAPTERS | `src/adapters/**` (facebook.ts, threads.ts, linkedin.ts, bluesky.ts, assisted.ts, registry.ts + `*.test.ts`) + `docs/platforms/*.md` + `README.md` |
| UI | `src/ui/**` |

Hard rule: engine imports adapters via `src/adapters/registry.ts`; API imports engine only for types if needed; nobody edits `src/index.ts` — it already wires `handleApi(req, env, ctx)` and `runSchedulerTick(env)`.

## Commands
- `npm run dev` — wrangler dev on :8787 (runs local D1 migrations first)
- `npm run test` — vitest (workers pool for engine/api/lib, node pool for adapters)
- `npm run typecheck` — must pass clean

## Non-negotiable rules
- All timestamps UTC epoch SECONDS (INTEGER columns). Timezone conversion happens client-side or via the post's stored IANA tz.
- Never log or include in errors: tokens, authorization headers, passwords, app secrets. Error messages must be human-readable ("Your LinkedIn connection expired. Reconnect LinkedIn and retry.", not "401").
- Never mark a target `published` without provider evidence (`provider_post_id` at minimum, permalink when obtainable).
- Duplicate publish is unacceptable: idempotencyKey = `${postTargetId}:${publishGeneration}`; re-check target row status immediately before the provider call.
- No new npm dependencies. No TODO comments without an owner note. Comments only for non-obvious constraints.
- All mutating `/api/*` routes require a valid session + CSRF double-submit header.
- `ALLOW_REGISTRATION=false`: no public signup. `/api/setup` creates the single owner once, then permanently refuses (403).

## Status enums
`post_targets.status`: draft | scheduled | claimed | publishing | retrying | published | failed | needs_reconnect | assisted | cancelled
`posts.status` (rollup): draft | scheduled | publishing | published | failed | cancelled

## ENGINE spec
`runSchedulerTick(env): Promise<void>` in `src/engine/cron.ts` — must be idempotent and safe under concurrent invocation.

Tick phases:
1. **Claim due targets** atomically. D1 is serializable; use conditional UPDATE ... RETURNING:
   - `UPDATE post_targets SET status='claimed', updated_at=? WHERE id IN (SELECT id FROM post_targets WHERE status='scheduled' AND scheduled_at<=? LIMIT 25) AND status='scheduled' RETURNING id`
   - same for `status='retrying' AND next_retry_at<=?`.
2. **Publish each claimed target** (see publish.ts):
   - Set `publishing`. Load post (caption = `caption_override ?? base_caption`), media (post_media join), account (decrypt tokens via `decryptSecret(env.ENCRYPTION_SECRET, ...)`).
   - Re-check row is still `publishing` and `publish_generation` unchanged immediately before the adapter call.
   - Call `getAdapter(platform).publish(...)`. Write a `publishing_attempts` row (attempt_number = attempt_count+1, result, error info, provider_response_summary — SAFE summary only).
   - Apply outcome:
     - `confirmed` → target `published` (provider_post_id, provider_permalink, published_at, attempt_count++), update social_accounts.last_verified_at.
     - `pending` → target stays `publishing`, store provider_post_id, next_retry_at = now+60 (resolve window below).
     - `assisted` → target `assisted` (never auto-publish), activity_log entry.
     - `needs_reconnect` → target `needs_reconnect`, mark account `needs_reconnect`, activity_log "needs reconnect" alert.
     - `failed` retryable → attempt_count++, status `retrying`, next_retry_at = now + ladder[attempt_count] where ladder = [0, 120, 600, 1800, 7200] (index: attempt 1 → 120s, …); attempt_count >= 5 → `failed`.
     - `failed` non-retryable → target `failed` with human-readable last_error.
   - `expired-token` handling: if account token_expires_at passed and adapter.refresh exists, refresh first and persist new encrypted tokens; if refresh fails → needs_reconnect path.
3. **Resolve pending** (Threads-style two-step): targets `status='publishing' AND provider_post_id IS NOT NULL AND published_at IS NULL AND next_retry_at<=now` → `adapter.resolvePending(...)`; confirmed → published; still pending → next_retry_at=+60; if started > 24h ago → failed.
4. **Post rollup**: when every target of a post is terminal (published|failed|cancelled|assisted) → post status = published if any published else failed, completed_at=now.
5. **Media cleanup**: for media rows joined to posts where ALL targets are terminal AND post.completed_at + retentionHours < now → delete R2 object + media row. retentionHours = settings `media_retention_hours` ?? env.MEDIA_RETENTION_HOURS ?? 48. Never delete media still referenced by a non-terminal post.
6. **Diagnostics breadcrumbs**: activity_log entries: `scheduler_tick` (level info, message = counts), failures at error level. Also upsert settings key `last_tick_at`.

**MockSocial** (`src/engine/providers/mock.ts`, provider `mock`): enabled when `env.MOCK_SOCIAL_ENABLED === 'true'`. Fault injection via caption token `[mock:429]`, `[mock:500]`, `[mock:timeout]`, `[mock:expire]`, `[mock:invalidmedia]`, `[mock:delay]`, `[mock:dupe]` — strip the token from the published caption.
- default/`dupe` → `confirmed` with externalId `mock_<randomId>` + permalink. `dupe`: keep an in-memory Map<idempotencyKey, externalId>; on repeat call return the SAME externalId with kind confirmed and NO new side effect (proves idempotent replay).
- `delay` → `pending` (container id), resolvePending returns confirmed after 60s of container creation.
- `expire` → `needs_reconnect`. `429`/`500`/`timeout` → `failed` retryable (timeout errorCode `ETIMEDOUT`). `invalidmedia` → `failed` non-retryable.
- Engine tests (vitest workers pool; seed D1 rows directly, call `runSchedulerTick`): due target publishes; concurrent/double tick → exactly one publish; `[mock:429]` then `[mock:none]` retries per ladder; `[mock:expire]` → needs_reconnect + no duplicate on reconnect+retry (generation bump); `[mock:dupe]` replay → same externalId once; pending → resolved → published; `[mock:invalidmedia]` → failed non-retryable; cancel before due → never publishes; post rollup; media cleanup after retention (use tiny retention setting).

## API spec
`handleApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>` in `src/api/router.ts`. All JSON. Auth via `src/lib/sessions.ts` (HMAC-signed stateless cookie `cotly_session` = signSession(SESSION_SECRET, userId, 30d); cookie HttpOnly, Secure, SameSite=Lax, Path=/). CSRF: non-HttpOnly cookie `cotly_csrf` (randomId) + require header `x-csrf` equal to it on POST/PATCH/DELETE. Rate limit login via `src/lib/ratelimit.ts` (D1-backed window counter, e.g. activity_log or its own query on settings — keep simple, 10 attempts/15min per IP+email).

Public routes: `POST /api/setup {email,password,timezone}` (403 once owner exists), `POST /api/auth/login {email,password}`, `POST /api/auth/logout`. Everything else requires session.
- `GET /api/me` → `{email, timezone, isSetup}`
- `GET /api/accounts` → `[{id, provider, displayName, avatarUrl, status, externalId, lastVerifiedAt}]` (never tokens)
- `DELETE /api/accounts/:id`
- `POST /api/accounts/bluesky {handle, appPassword}` → connectDirect; `POST /api/accounts/mock {displayName}` (404 unless mock enabled)
- `GET /api/oauth/:provider/start` → `{url}` (create oauth_states row, buildAuthUrl; 400 if provider has no OAuth configured — client secret missing)
- `GET /oauth/:provider/callback?...` (note: no `/api` prefix; routed in src/index.ts) → validate state, handleCallback, upsert social_account (encrypt tokens), 302 redirect to `/accounts?connected=1` or `/accounts?error=<human readable>`
- `POST /api/media/upload-url {filename, mime, size}` → `{mediaId, uploadUrl}` presigned R2 PUT via aws4fetch (SigV4, 15 min expiry, key `media/${randomId()}/${sanitized-filename}`); requires R2_ACCOUNT_ID/ACCESS_KEY/SECRET; 503 with human error if not configured. `POST /api/media/confirm {mediaId, size, mime, filename}` → verify object exists (bucket.head), insert media row.
- `POST /api/posts {baseCaption, mediaIds[], targets[{accountId, captionOverride?}], mode: 'now'|'scheduled', scheduledAt?, timezone?}` → validate per capabilities (caption length per platform, media required, video unsupported for bluesky, account connected, time in future for scheduled) → 422 `{errors:[{field, message}]}` | 201 `{postId}`. mode now → scheduled_at = now.
- `GET /api/posts?view=queue|published|failed&limit=` and `GET /api/posts?from=&to=` → rows with per-target status + account info; `GET /api/posts/:id` → full post + targets + media + accounts
- `PATCH /api/posts/:id {baseCaption?, mediaIds?, targets?}` (only while post status draft|scheduled; updates targets, bumps publish_generation) — publishes edited content, per Test F
- `POST /api/posts/:id/reschedule {scheduledAt}`; `POST /api/posts/:id/cancel` (non-terminal targets → cancelled, post → cancelled); `POST /api/posts/:id/publish-now` (scheduled_at=now, targets draft/scheduled/cancelled→scheduled, generation++); `POST /api/posts/:id/duplicate` → new draft post (no targets); `DELETE /api/posts/:id` (draft/cancelled only)
- `POST /api/targets/:id/retry` (allowed for failed|needs_reconnect → scheduled, next_retry_at=null, publish_generation++)
- `GET/PUT /api/settings` → `{timezone, mediaRetentionHours, xBudgetMode: 'disabled'|'warn'|'hard', xBudgetMonthlyUsd}`
- `GET /api/diagnostics` → `{lastTickAt, dueCount, activeCount, failedCount, needsReconnectCount, recentAttempts: [≤20 rows safe fields], providers: {provider: lastResult}, r2Ok}` (r2Ok = simple bucket head or binding presence check)

## ADAPTERS spec
Implement `PlatformAdapter` (src/contracts/types.ts) for facebook, threads, linkedin, bluesky + a trivial `assisted.ts` (publish → `{kind:'assisted'}`) + `registry.ts` exporting `getAdapter(provider): PlatformAdapter` covering all providers incl. `mock` (imported from engine) and `assisted`. Capabilities come from `src/contracts/capabilities.ts`.

- **facebook**: OAuth `https://www.facebook.com/v21.0/dialog/oauth`, scopes `pages_show_list,pages_manage_posts,pages_read_engagement`; callback exchanges code at graph.facebook.com/oauth/access_token, then GET /me/accounts → pick first page, store page id/name in account meta, page access token as accessToken. Publish: text-only → `POST /{pageId}/feed {message}` → id; images → `/{pageId}/photos {url, caption}` per image (use signed read URL or public R2 URL — document this; minimum: build a short-lived public URL via presigned GET) → attach via `/{pageId}/feed {message, attached_media[0][media_fbid]...}`; video → `/{pageId}/videos`. Extract permalink: `GET /{id}?fields=permalink_url` (best effort, never fail publish on permalink failure).
- **threads**: OAuth `https://threads.net/oauth/authorize`, scopes `threads_basic,threads_content_publish`; publish: POST `https://graph.threads.net/v1.0/{uid}/threads_media` (container: media_type TEXT/IMAGE/VIDEO, text/image_url/video_url) then POST `.../threads_publish?creation_id=` → returns container id → kind `pending`; resolvePending: GET `/{containerId}?fields=status,error_message` until FINISHED (then GET permalink via `?fields=permalink`) → confirmed. Respect 500-char limit (capabilities). image_url must be publicly reachable — presigned GET URL.
- **linkedin**: OAuth `https://www.linkedin.com/oauth/v2/authorization` scopes `openid profile w_member_social`; callback → token; member URN from `GET https://api.linkedin.com/v2/userinfo` (sub). Publish: `POST https://api.linkedin.com/rest/posts` headers `LinkedIn-Version: 202504` + `X-Restli-Protocol-Version: 2.0.0`, body `{author: urn, commentary, visibility: PUBLIC, distribution: {linkedInDistributionSource: 'NONE'}}` → confirmed (no permalink; document). Images optional: registerUpload → PUT → share with urn (implement only if clean; otherwise images → failed non-retryable with human message "LinkedIn image publishing not wired yet" — prefer implementing).
- **bluesky**: `connectDirect {handle, appPassword}` → POST `https://bsky.social/xrpc/com.atproto.server.createSession` → store accessJwt/refreshJwt (+expiresAt from exp), did = externalId, handle = displayName. publish: refresh session if expired (adapter.refresh via com.atproto.server.refreshSession); createRecord `app.bsky.feed.post` {repo: did, collection, record: {text, createdAt, embed for images via com.atproto.repo.uploadBlob}} → confirmed with uri, permalink `https://bsky.app/profile/{did}/post/{rkey}`. Auth failure after refresh attempt → needs_reconnect.
- Presigned GET URLs for media passed to providers: generate in adapters via aws4fetch (env.R2_* creds) with ~1h expiry; document that providers fetch the media from R2.
- Unit tests (node pool, stub `globalThis.fetch`): success, pending/resolution, auth-failure→needs_reconnect mapping, caption/token never present in error messages, bluesky refresh path.
- `docs/platforms/{facebook,threads,linkedin,bluesky,instagram,x,reddit}.md`: developer portal URL, app type, required scopes, OAuth redirect URI (`{APP_URL}/oauth/{provider}/callback`), dev-mode setup, review requirements, connect steps, how to verify a real publish, and honest status line (`CODE COMPLETE — LIVE TEST PENDING APP REVIEW` etc.). `README.md`: local dev quickstart (npm i, cp .dev.vars.example .dev.vars, npm run dev), env/secrets table, deploy step-by-step (create D1 + R2, wrangler.toml database_id, db:remote, secrets via `wrangler secret put`, cron, owner setup at /setup), test commands, known limitations.

## UI spec
React 19 SPA in `src/ui/` (index.html, main.tsx, App.tsx, pages/, components/, api.ts client, styles.css). Deps: react + react-dom only (already installed). History-API routing, single CSS file with CSS variables, dark default with light toggle, mobile-first, large tap targets. `npm run build` must succeed (vite builds src/ui → dist/client).

Pages: `/login`, `/setup` (shown when GET /api/me isSetup=false), `/compose`, `/queue`, `/calendar` (agenda list grouped by day), `/accounts`, `/settings`, `/diagnostics`. Nav: Compose, Queue, Calendar, Accounts, Settings (+Diagnostics under settings).

- **Compose**: media dropzone (drag/drop + picker; upload via upload-url → PUT fetch → confirm; thumbnails with remove buttons), caption textarea with per-selected-platform char counters (capabilities), destination checkboxes grouped by provider (disabled + warning badge when needs_reconnect/disconnected), collapsible per-platform caption overrides prefilled from base caption, schedule section: Publish Now | Exact time (datetime-local + timezone select defaulting to account tz) | Smart distribution (posts count + start + end → evenly spaced editable datetimes; or start + spacing minutes) → POST /api/posts per scheduled slot (batch mode: multiple posts composed in one session, distributed across slots).
- **Queue**: tabs Today | Tomorrow | Later | Failed | Published. Item: thumbnail, caption preview, platform chips with per-target status color, local time, actions (edit modal → PATCH, duplicate, publish now, cancel, delete; failed/needs_reconnect rows get prominent Retry + "Reconnect X" banner). Poll queue every 30s (setInterval, cleaned up on unmount).
- **Accounts**: card per provider; Connect button → /api/oauth/:provider/start → window.location = url; Bluesky inline form (handle + app password, helper text "Create an app password at bsky.app/settings/app-passwords"); Mock section when enabled; disconnect button; reconnect banner listing needs_reconnect accounts.
- **Settings**: timezone select, media retention select (24h/48h/72h/7d/never), X API budget (Disabled/Warn/Hard cap + monthly USD input; stored but inert — X adapter not built), save button.
- **Diagnostics**: render GET /api/diagnostics (last tick, due/active/failed counts, recent attempts table, provider health, R2 ok).
- `api.ts`: fetch wrapper adding `x-csrf` from cookie, `credentials: 'include'`, 401 → redirect `/login`, throws `{message}` on error JSON.

## Integration notes
- The API and UI agents must agree with this contract exactly; if a shape must change, keep it backwards-compatible and note it in the final report.
- Engine depends on `src/adapters/registry.ts` (ADAPTERS agent) and vice versa for the mock provider import — use a lazy `await import()` or accept the import either direction; do not create circular imports at module top level (mock provider lives in engine, registry imports it lazily).
- Owner user id for single-owner system: constant `OWNER_ID = 'owner'` is acceptable (users table still created for the bootstrap flow).
