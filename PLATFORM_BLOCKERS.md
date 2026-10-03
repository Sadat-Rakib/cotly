# PLATFORM BLOCKERS

Genuine external blockers only. Everything completable without an approval has
been finished; each entry states what is done, what is missing, the exact page
to visit, and what works immediately after.

## Summary of the rollout plan (native-first, bridges optional)

- Wave 0 (fastest verified core): Bluesky (done, live), X, Mastodon, Telegram.
- Wave 1 (direct next): Threads, LinkedIn, Pinterest, optional Buffer bridge.
- Wave 2 (approval/review platforms): Facebook Pages, Instagram, YouTube,
  TikTok, Google Business Profile, Reddit.
- Bridges (optional fallbacks, never the primary backend): Buffer, Ayrshare,
  Publer, Metricool, Upload-Post.

Architecture: React/Vite SPA -> Cloudflare Worker API -> provider router ->
native adapters first, user-selected bridge only when the same account is
legitimately connected that way. Every publish attempt records the route used.

## Bluesky

- State: LIVE VERIFIED. Publish-now and scheduled cloud publishing confirmed on
  the production deployment. Nothing missing.

## Facebook Pages

- Completed: OAuth callback flow, Page listing and multi-Page chooser
  (`GET/POST /api/accounts/facebook/pages`), page-token exchange, publisher,
  16 adapter tests. Setup Center shows the 7-step guide with copy buttons.
- Missing: `META_CLIENT_ID` + `META_CLIENT_SECRET` secrets, and the two
  callback URLs configured in the Meta app:
  `https://cotly.cotly-app.workers.dev/oauth/facebook/callback`.
- Visit: https://developers.facebook.com/apps (create Business app, add the
  Facebook product, request `pages_show_list`, `pages_manage_posts`,
  `pages_read_engagement`).
- Works immediately after: Connect Facebook Page from Accounts or Setup.

## Threads

- Completed: official Threads API adapter (container -> publish -> poll),
  OAuth flow, 10 adapter tests.
- Missing: `THREADS_CLIENT_ID` + `THREADS_CLIENT_SECRET`, callback URL
  `https://cotly.cotly-app.workers.dev/oauth/threads/callback`, products
  `threads_basic` + `threads_content_publish` on the same Meta app.
- Works immediately after: Connect Threads from Accounts or Setup.

## LinkedIn

- Completed: official REST adapter (`/rest/posts`), 10 adapter tests.
- Missing: `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` from a LinkedIn
  developer app (product: "Share on LinkedIn"), callback
  `https://cotly.cotly-app.workers.dev/oauth/linkedin/callback`.

## X

- Completed: nothing yet (adapter not started; deliberately not faked).
- Missing: an X developer account with a payment card for the pay-per-use API.
  X currently offers new paying developers $20 of free API credits plus up to
  $50 matching the first auto-recharge; a basic text post create costs about
  $0.015. Cotly will ship with `X_API_ENABLED`, `X_API_MONTHLY_BUDGET_USD` and
  `X_MAX_MONTHLY_SPEND_USD` guardrails and usage counters before the adapter
  goes live.
- Visit: https://developer.x.com

## Mastodon

- Missing: your instance base URL; then register a Cotly application on that
  instance (Scopes: `read write`, optionally `write:statuses`) to get
  `MASTODON_CLIENT_ID/SECRET`. Connection is per-instance OAuth. Cotly's
  scheduler stays authoritative unless the server supports `scheduled_at`.
- Visit: your instance's Preferences -> Development -> New application.

## Telegram

- Missing: a bot token from @BotFather (`TELEGRAM_BOT_TOKEN`) and the bot added
  to your channel with post permission. Connection is bot-token + channel
  selection, not OAuth.
- Visit: https://t.me/BotFather -> /newbot.

## Pinterest / Instagram / YouTube / TikTok / Google Business Profile / Reddit

- Adapters not started. Each requires the platform's own app review or API
  audit before public posting works; they are Wave 1/2 items and are honestly
  labeled "Coming soon" in the product. No code pretends otherwise.

## Neon backend (Postgres + Object Storage + Better Auth)

- Missing: a Neon account and project (user action; signup, project creation).
  Free plan: 1 GB Postgres per project, 5 GB object storage, 100 projects.
  Needed values: `DATABASE_URL` (pooled connection string), Neon object
  storage credentials, `BETTER_AUTH_SECRET`.
- Deferred with it, by design: multi-user ownership scoping. The current D1
  schema has no `owner_id` on `social_accounts` and reads are unscoped; the
  product is single-owner today. Registration exists behind
  `ALLOW_REGISTRATION` (endpoint shipped, migration 0002 adds `users.name`)
  but the flag stays OFF until ownership scoping lands with the Neon
  migration. Enabling it before then would leak data between users.
- D1 data will be exported, transformed, imported into Neon, verified, and
  kept as a rollback copy. No data will be dropped.

## Media storage

- Cloudflare R2 is not enabled on the account, so uploads are disabled
  (Setup Center shows the exact steps). Alternative: Neon Object Storage once
  the Neon project exists; the media pipeline (metadata in Postgres, blobs in
  object storage) is designed for either.
