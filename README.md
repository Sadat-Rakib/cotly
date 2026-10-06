# Cotly

Cotly is a multi-user, multi-platform social media scheduler: compose a post once (text + images/video), schedule it for an exact time or distribute a batch over the day, and a cron-driven engine publishes it to Facebook Pages, Threads, Instagram, X, LinkedIn and Bluesky on schedule — with retries, pending-resolution (Threads/Instagram-style two-step publishing), idempotency guards against duplicate posts, encrypted token storage, per-user data isolation, media lifecycle management on object storage, and a diagnostics view. A built-in mock provider (`MockSocial`) lets you exercise the full publish pipeline without any platform credentials. Stack: Cloudflare Workers + D1 + S3-compatible object storage (Neon Object Storage / R2) + React/Vite SPA.

## Quickstart (local)

```bash
npm install
cp .dev.vars.example .dev.vars      # then fill ENCRYPTION_SECRET + SESSION_SECRET (32+ random chars each)
npm run dev                         # applies local D1 migrations, starts wrangler on :8787
```

1. Open http://localhost:8787 → the first visit creates the owner via `/setup` (set `ALLOW_REGISTRATION=true` to let other people sign up too).
2. Go to **Profile** → connect **MockSocial** (enabled while `MOCK_SOCIAL_ENABLED=true`) or a real platform.
3. **Compose** → write a caption, attach media (optional) → Publish now or schedule 1 minute ahead.
4. Watch the **Queue**: the scheduler tick runs every minute (cron), publishes the post and shows per-target status with permalink.
5. Try the fault tokens in a caption against MockSocial: `[mock:429]` (retryable), `[mock:expire]` (needs reconnect), `[mock:delay]` (pending → resolved), `[mock:dupe]` (idempotent replay), `[mock:invalidmedia]` (hard failure).

## Environment & secrets

Vars in `wrangler.toml` (`[vars]`) and `.dev.vars` (local secrets, never commit):

| Variable | Kind | Purpose |
|---|---|---|
| `ENCRYPTION_SECRET` | secret | AES-GCM key derivation for stored OAuth tokens / app passwords |
| `SESSION_SECRET` | secret | HMAC signing of the stateless session cookie |
| `APP_URL` | var | Public base URL; must match OAuth redirect URIs exactly |
| `ALLOW_REGISTRATION` | var | `true` = public signup at `/signup`; `false` = only the first `/setup` owner |
| `MOCK_SOCIAL_ENABLED` | var | Enables the MockSocial provider (`true` in dev, off in prod) |
| `MEDIA_RETENTION_HOURS` | var | Default media retention for uploads when the user has no preference (168h = 7 days) |
| `META_CLIENT_ID` / `META_CLIENT_SECRET` | var/secret | Facebook (and Meta app portal) OAuth |
| `THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET` | var/secret | Threads OAuth |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | var/secret | LinkedIn OAuth |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | var/secret | X OAuth 2.0 (PKCE); publishing is gated by `X_API_ENABLED` + monthly cap |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | secret | S3-compatible object storage (Neon Object Storage or R2) for media blobs — browser uploads use presigned PUTs, publishing shares ~1h signed GETs |
| `INSTAGRAM_CLIENT_ID` / `INSTAGRAM_CLIENT_SECRET` | var/secret | Instagram API with Instagram Login |
| `FACEBOOK_CONFIG_ID` | secret | Facebook Login for Business configuration id (Business-type apps) |

Bindings: `DB` (D1), `MEDIA` (R2 bucket `cotly-media`), `ASSETS` (SPA), cron `* * * * *`.

## Deploy to Cloudflare

```bash
wrangler d1 create cotly-db            # paste the returned database_id into wrangler.toml
wrangler r2 bucket create cotly-media
npm run db:remote                      # apply migrations to the remote D1
npm run build                          # vite builds the SPA into dist/client
wrangler deploy
```

Then set secrets on the deployed worker:

```bash
wrangler secret put ENCRYPTION_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put META_CLIENT_SECRET       # plus THREADS_/LINKEDIN_ client secrets as configured
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Finish configuration:
- Update `APP_URL` in `wrangler.toml` to the deployed URL and redeploy.
- In each platform's developer portal, add `{APP_URL}/oauth/{provider}/callback` as a redirect URI (see `docs/platforms/*.md` for per-platform scopes and review notes).
- Verify the cron trigger exists (Cloudflare dashboard → Worker → Triggers; it is declared in `wrangler.toml`).
- Open `https://<your-worker>/setup` to create the owner, connect accounts, and schedule the first post.

## Tests

```bash
npm run test           # vitest: workers pool (engine/api/lib) + node pool (adapters)
npx vitest run src/adapters   # adapters suite only
npm run typecheck      # tsc --noEmit
```

## Architecture

- `src/index.ts` — worker entry: SPA assets, `/api/*` → `handleApi`, `/oauth/:provider/callback`, cron → `runSchedulerTick`.
- `src/api/**` — REST endpoints, session/CSRF auth, per-platform validation via capabilities.
- `src/engine/**` — `runSchedulerTick`: claim due targets atomically → publish via adapters → retry ladder / pending resolution / rollup / media cleanup / diagnostics breadcrumbs.
- `src/adapters/**` — one `PlatformAdapter` per provider (`facebook`, `threads`, `instagram`, `x`, `linkedin`, `bluesky`), `mock`, `assisted`; registry in `registry.ts`. All use official APIs; no scraping or browser automation. Bluesky uses official AT Protocol OAuth (confidential client, PAR + DPoP, served from `/oauth/bluesky/client-metadata.json`). Media is shared with providers via ~1h signed GET URLs from object storage.
- `src/contracts/**` — `Env`, domain types, capability table (limits per platform: caption length, media counts, video support).
- `migrations/0001_init.sql` — D1 schema (all timestamps UTC epoch seconds).
- `src/ui/**` — React 19 SPA: Compose / Queue / Calendar / Accounts / Settings / Diagnostics.

## Known limitations

- **Live publishing is unverified until your developer apps are approved/credentials are set.** Adapters are code-complete and unit-tested against scripted provider responses; real API behavior (exact field names, review gates) needs a live smoke test — see the status line in each `docs/platforms/*.md`.
- **Instagram, X and Reddit adapters are not implemented** (Instagram needs IG Professional + Meta review; X is a paid API with the budget guard stored but inert; Reddit runs in Assisted mode).
- **Presigned media requires R2 S3 credentials** — without `R2_*` secrets, uploads and image/video publishing to Facebook/Threads/LinkedIn fail with a clear human message (Bluesky text posts still work).
- Facebook publishes to Pages only; LinkedIn posts as the connected member only (no permalinks returned by the API); Threads supports one image or video per post (no carousel); Bluesky caps at 300 chars / 4 images / no video.
