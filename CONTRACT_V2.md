# Cotly v0.2 Addendum — read alongside CONTRACT.md

Baseline: commit de69c73 + test-secret fix, 68/68 green, tsc clean. PRESERVE the 68-test baseline; add coverage for everything new. Do not rebuild working systems. No new npm deps.

## Ownership (same rules as CONTRACT.md — do not edit outside your area)
- API agent: `src/api/**`, `src/lib/**`
- ADAPTERS agent: `src/adapters/**`
- UI agent: `src/ui/**`
- CORE (already done): `src/contracts/types.ts` now has optional `testConnection` on PlatformAdapter; package.json scripts now pass `--config ./wrangler.toml` everywhere.

## API agent
1. `GET /api/setup/status` (auth) →
```json
{
  "deployment": { "d1": true, "r2": true, "cron": true, "appUrl": "...", "encryptionSecretSet": true, "sessionSecretSet": true, "mediaPresignReady": false },
  "owner": { "exists": true, "email": "..." },
  "accounts": [{ "id": "...", "provider": "bluesky", "displayName": "...", "status": "connected", "lastVerifiedAt": 0 }],
  "providers": [{ "provider": "facebook", "configured": false, "reason": "META_CLIENT_ID/SECRET not set", "connected": false, "badge": "not_configured" }],
  "checklist": [{ "key": "owner_configured", "label": "Owner account created", "done": true }]
}
```
- `deployment.d1/r2` = binding functional probe; `cron` = last_tick_at within 10 min OR local dev (no cron in `wrangler dev` — report `"cron": "unknown"` string false-y allowed: use `cron: true|false|"unknown"`); secrets = set/unset booleans only, NEVER values. `mediaPresignReady` = R2_ACCOUNT_ID/ACCESS_KEY/SECRET present.
- providers list: facebook (`META_CLIENT_ID`+`META_CLIENT_SECRET`), threads (`THREADS_*`), linkedin (`LINKEDIN_*`), bluesky (always configured), instagram/x/reddit/tiktok → `{configured:false, implemented:false}`. badge ∈ not_configured | ready_to_connect | connected | needs_reconnect.
- checklist keys: owner_configured, provider_configured, account_connected, media_upload_ready, publish_now_tested (≥1 target published where post.publish_mode='now'), scheduled_tested (≥1 published target scheduled ≥60s after post creation), evidence_stored (≥1 publishing_attempts row result='confirmed' with target provider_post_id not null). Labels human; done from real DB state — no fake checkmarks.
2. `GET /api/media/:id/url` → `{url}` presigned GET (1h). Owner-only (media.owner_id must match owner, else 404). 503 human message when R2 S3 creds absent.
3. `POST /api/accounts/:id/test` → `getAdapter(provider).testConnection?.(env, account)` → `{ok, detail}`; 400 human message when adapter lacks testConnection; persist last_verified_at on ok. detail must be human-readable, no tokens.
4. Diagnostics: add `deployment` (same shape as above) + `cleanup` (time of last cleanup activity_log event, or null).
5. Tests: setup/status shape + honest booleans; media url owner check (foreign → 404); accounts/test mapping (unknown adapter → 400); provider configured:false when secrets missing (unset env in test).

## ADAPTERS agent
CORE added to PlatformAdapter: `testConnection?(env: Env, account: SocialAccountRecord): Promise<{ ok: boolean; detail: string }>`.
- facebook: `GET graph.facebook.com/v21.0/me?fields=id,name` → ok `Token valid — identity <name>`. Add to detail: "Page publishing permission (pages_manage_posts) can only be fully verified by an actual publish."
- threads: `GET graph.threads.net/v1.0/me?fields=id,username`.
- linkedin: `GET api.linkedin.com/v2/userinfo`.
- bluesky: `GET bsky.social/xrpc/com.atproto.server.getSession` (Bearer access token; on invalid token try refreshSession once, report ok with renewed-token note; engine/API persists nothing here — report only).
- All: auth failure → `{ok:false, detail:"<human reason>. Reconnect <provider>."}`; network/timeout → ok:false ETIMEDOUT-style human message; NEVER include tokens; truncate raw summaries. Tests per adapter (stubbed fetch) + registry passthrough test.

## UI agent
1. **Landing page at `/` (public)** — no design reference was provided, use the fallback direction: near-white/near-black surfaces, large typography, generous whitespace, subtle borders, minimal shadows, fast transitions, no gradients/glassmorphism/glow. Sections: header (Cotly wordmark; links How it works, Platforms, Sign in; CTA "Open Cotly"), hero ("Schedule your content. Cotly handles the posting." + supporting line + primary CTA "Start scheduling" → /app/compose + secondary "View supported platforms" → #platforms), How it works (3 steps: Add your content / Choose where and when / Cotly publishes it), Supported platforms with HONEST badges — Facebook "Code ready", Threads "Code ready", LinkedIn "Code ready", Bluesky "Code ready", Instagram "Coming next", X "Optional — paid API", Reddit "Planned", TikTok "Planned" (never "Ready" or "Live verified" — nothing is live-verified yet), final CTA ("Stop babysitting your posting schedule."), minimal footer (Cotly · Privacy · GitHub). Tasteful static mock of the composer/queue using real product styling; no fake analytics numbers.
2. **Routing**: move the authenticated app under `/app/*`: `/app` (redirect → /app/compose), `/app/compose`, `/app/queue`, `/app/calendar`, `/app/accounts`, `/app/settings`, `/app/diagnostics`, `/app/setup` (Setup Center, replaces/augments current settings). `/login` and `/setup` (owner bootstrap) stay top-level. Public `/` renders the landing page without auth checks. Update nav links + post-login redirect targets.
3. **Setup Center** (`/app/setup`): render `/api/setup/status` — deployment checks section (green/red/unknown rows + human "why it matters" one-liner), platform section (per provider: badge + reason + exact "Action needed from you" expandable for unconfigured OAuth providers: which portal, which values Cotly needs, the exact OAuth callback URL `https://<worker-host>/oauth/<provider>/callback` with copy button, how to verify), Bluesky connect form inline (handle + app password + link to bsky.app/settings/app-passwords), Mock connect when enabled, launch checklist rendered from `checklist[]` (real state only).
4. **Onboarding**: after owner bootstrap/first login, if no account connected yet → welcome panel on Compose ("Welcome to Cotly" + 5 steps: check deployment → connect first account → upload content → preview → schedule) with links; dismissible (localStorage).
5. **Composer upgrade**: media list shows numbered order (1,2,3…) with up/down reorder buttons + remove; caption overflow: per selected platform, when base caption (or override) exceeds capabilities.maxCaptionChars show inline warning "Your <Platform> caption exceeds the current allowed length (N > M)." with Edit button focusing the override — never truncate silently; **final preview step** replaces direct submit: Review screen listing per selected destination — account name, media thumbnails in order, the exact caption that will be sent (override ?? base), scheduled time rendered as "October 4, 2:00 PM — America/Vancouver" (owner tz) or "Publish now", per-platform incompatibilities surfaced; buttons **Confirm & Publish Now** / **Confirm & Schedule** (mode-appropriate) + Back. No POST /api/posts happens until an explicit confirm click. After confirm: success panel with link to queue.
6. **Accounts page**: add per-account "Test connection" button → POST /api/accounts/:id/test → toast with detail; card shows status badge, last verified relative time, avatar if present.
7. Mobile: preview and confirm buttons full-width and thumb-reachable; media reorder works via buttons (not drag).

## API-shape agreement
UI codes against the JSON above exactly. `/api/setup/status` is the single source for Setup Center + onboarding + checklist state. If something is genuinely missing, add it on the API side compatibly and note it in the report.
