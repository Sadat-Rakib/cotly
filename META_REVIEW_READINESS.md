# Cotly — Meta App Review Readiness

This document is the submission packet for making Cotly usable by ordinary
(not tester) Meta accounts. Everything code-side is already implemented;
only the dashboard/review steps below require human action.

## Apps involved

| App | ID | Type | Use |
|---|---|---|---|
| Facebook app | `1874584373985057` | Business (Login for Business) | Facebook Pages publishing |
| Instagram app | `1804102197449958` | Instagram API with Instagram Login | Instagram image/Reel publishing |
| Threads | uses the Facebook app's Threads integration | — | Threads publishing |

## Shared URLs (identical for every app — configure in Settings → Basic)

| Purpose | URL |
|---|---|
| Privacy Policy | `https://cotly.cotly-app.workers.dev/privacy` |
| Terms of Service | `https://cotly.cotly-app.workers.dev/terms` |
| Data Deletion callback | `https://cotly.cotly-app.workers.dev/data-deletion` |
| Data Deletion (deauthorize) | `https://cotly.cotly-app.workers.dev/oauth/threads/deauthorize` (POST, Threads only) |
| OAuth callback — Facebook | `https://cotly.cotly-app.workers.dev/oauth/facebook/callback` |
| OAuth callback — Instagram | `https://cotly.cotly-app.workers.dev/oauth/instagram/callback` |
| OAuth callback — Threads | `https://cotly.cotly-app.workers.dev/oauth/threads/callback` |

All callbacks are live in the deployed Worker and derived from the production
`APP_URL` — no localhost/dev URLs exist in production configuration.

## Facebook Pages (app 1874584373985057)

**Login for Business configuration `1124186340089722`** is wired into the
authorization dialog (`config_id` parameter) and carries the Page permissions.

### Permissions requested (only what Cotly uses)

| Permission | Why Cotly needs it | Where it appears in Cotly |
|---|---|---|
| `pages_show_list` | List the Facebook Pages the user manages so they can pick one | Profile → Facebook Pages → Connect → Page chooser |
| `pages_read_engagement` | Read basic Page metadata to display the chosen Page's name | Profile (connected account name) + Compose destination |
| `pages_manage_posts` | Create the post on the Page when the user publishes | Compose → Publish now / scheduled publishing |

### Reviewer test steps
1. Sign up at `https://cotly.cotly-app.workers.dev/signup`.
2. Profile → Facebook Pages → **Connect** → authorize with a test Page.
3. Select the Page in the chooser that appears after consent.
4. Compose → write "Cotly App Review test." → Publish now → the post appears
   on the selected Page; Queue shows **Published**.

### Suggested App Review explanation
"Cotly is a social publishing scheduler. A user connects the Facebook Page
they manage, chooses it as a destination, and Cotly publishes their prepared
posts to that Page either immediately or at a scheduled time. We request
`pages_show_list` to let the user choose their Page, `pages_read_engagement`
to display the Page identity, and `pages_manage_posts` to publish on the
user's explicit instruction. We never post to personal profiles."

### Suggested review-video sequence
1. Landing page → Sign up → Compose briefly shown.
2. Profile → Facebook Pages → Connect → consent dialog (permissions visible).
3. Page chooser listing the tester's Pages → select one.
4. Compose → caption → Publish now.
5. Queue showing **Published** → open the Facebook Page showing the post.

### Still requiring dashboard/human action
- App Review submission for the three permissions (requires the screencast).
- Business verification / Business Portfolio association for the app
  (dashboard action, cannot be done via code).
- Accepting the latest Platform Terms for the app.
- Add `https://cotly.cotly-app.workers.dev/oauth/facebook/callback` to the
  Login for Business configuration `1124186340089722` if not already present.

## Instagram (app 1804102197449958 — Instagram API with Instagram Login)

### Permissions requested

| Permission | Why Cotly needs it | Where it appears in Cotly |
|---|---|---|
| `instagram_business_basic` | Resolve the user's Business/Creator account (id, username, type) | Profile (connected account identity) |
| `instagram_business_content_publish` | Create the media container and publish after Instagram finishes processing | Compose → Publish now / scheduled publishing |

### Reviewer test steps
1. Sign up → Profile → Instagram → **Connect** (or paste a long-lived token).
2. Consent dialog shows the two permissions → authorize.
3. Compose → attach one image → caption "Cotly App Review test." → Publish now.
4. Instagram finishes processing → Queue shows **Published** → the post is on
   the tester's professional account (Reels for video attachments).

### Suggested App Review explanation
"Cotly publishes the user's own prepared content to their professional
Instagram account on their explicit instruction, immediately or at a
scheduled time. `instagram_business_basic` identifies the connected account;
`instagram_business_content_publish` creates and publishes the container.
Personal accounts are explicitly rejected."

### Still requiring dashboard/human action
- App Review submission for both permissions.
- Business/creator verification on the reviewer's Instagram tester account is
  not required, but ordinary users must have a professional account
  (Cotly enforces and explains this).

## Threads (Facebook app's Threads use case)

### Permissions requested

| Permission | Why Cotly needs it | Where it appears in Cotly |
|---|---|---|
| `threads_basic` | Read the user's Threads profile identity | Profile (connected account) |
| `threads_content_publish` | Publish the user's prepared posts | Compose → Publish now / scheduled |

### Reviewer test steps
1. Sign up → Profile → Threads → **Connect** → authorize.
2. Compose → caption → Publish now.
3. Threads containers process asynchronously → Queue transitions
   pending → **Published** with a permalink.

### Data deletion / deauthorize
`POST https://cotly.cotly-app.workers.dev/oauth/threads/deauthorize` verifies
Meta's signed request and deletes the matching connection immediately; the
user is pointed to `https://cotly.cotly-app.workers.dev/data-deletion`.

### Still requiring dashboard/human action
- Threads App Review submission (`threads_basic`, `threads_content_publish`).
- Configure the deauthorize callback URL in the Threads use case settings.

## Security posture already implemented (for reviewer questions)

- OAuth `state`: cryptographically random, bound to the initiating Cotly
  user, provider-checked, single-use, 10-minute expiry; replay/wrong-provider/
  expired/tampered states are all rejected with regression tests.
- Provider tokens: encrypted at rest (AES-256-GCM, per-deployment key),
  never returned to the frontend, redacted in logs.
- Disconnect: deletes Cotly's stored credentials and best-effort revokes at
  the provider where the platform supports it (Bluesky, X).
- Publishing: idempotent by design (per-target publish generation), retries
  with a bounded ladder, failed posts surface the provider reason.
- Media: owner-scoped storage keys, signed short-lived access URLs, server
  side mime/size validation, automatic expiry cleanup.

## Status summary

| Provider | Configured | Connectable | Publish | Media | Production approval needed |
|---|---|---|---|---|---|
| Threads | yes | yes | yes | images+video | App Review for threads_basic/content_publish |
| Facebook Pages | yes | yes | yes | images+video | App Review for the three Page permissions + Business verification |
| Instagram | yes | yes | yes | image+Reel | App Review for the two Instagram permissions |
| X | yes | yes | yes (budget-capped) | images+video | none (paid API, credentials live) |
| Bluesky | yes | yes (atproto OAuth) | yes | images | none |
