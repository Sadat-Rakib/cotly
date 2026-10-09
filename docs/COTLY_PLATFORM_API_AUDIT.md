# COTLY_PLATFORM_API_AUDIT

Audit of Cotly's ACTUAL platform integrations, grounded in adapter source code
(`src/adapters/*.ts`, `src/contracts/capabilities.ts`) and current official docs.
Readiness is labeled honestly; nothing incomplete is called production-ready.

Readiness legend: LIVE-VERIFIED (real post confirmed on prod) · CODE-COMPLETE
(implemented, official APIs, unit-tested, not live) · AWAITING-CREDENTIALS ·
AWAITING-APPROVAL (platform app review) · NOT-IMPLEMENTED.

## Capability matrix (from src/contracts/capabilities.ts — single source)
| Provider | text | images (max) | video (maxMB) | caption max | media required | direct publish |
|---|---|---|---|---|---|---|
| facebook | yes | 10 | yes (1024) | 63206 | no | yes |
| threads | yes | 20 | yes (1024) | 500 | no | yes |
| linkedin | yes | 20 | yes (200) | 3000 | no | yes |
| bluesky | yes | 4 | no (0) | 300 | no | yes |
| instagram | yes | 10 | yes (512) | 2200 | yes | yes |
| x | yes | 4 | yes (512) | 280 | no | yes |
| reddit | yes | no | no | 40000 | no | no (assisted) |

## Per-platform

### Bluesky — LIVE-VERIFIED
- Code: `src/adapters/bluesky.ts`. AT Protocol OAuth (confidential client,
  private_key_jwt ES256, DPoP). Auth server `bsky.social`; DID resolution via
  `plc.directory`; permalink `bsky.app/profile/{did}/post/{rkey}`.
- Scope: `atproto transition:generic`. Token refresh implemented + persisted.
- Capabilities: text + up to 4 images; no video (by capability decl).
- App review: none (app-password / OAuth, no platform approval).
- Status: publish-now AND scheduled confirmed on production (see PROGRESS.md).
- Tests: `bluesky.test.ts`, contract + reliability suites.

### Threads — LIVE-VERIFIED
- Code: `src/adapters/threads.ts`. Two-call container -> publish:
  `POST graph.threads.net/v1.0/{user}/threads` then `.../threads_publish`,
  with retry on async error 24; long-lived token exchange (60d).
- Scope: `threads_basic,threads_content_publish` — matches official docs.
- Official: container+publish flow, 250 API posts / 24h, no native scheduling
  (Cotly's scheduler is authoritative). Refs:
  https://developers.facebook.com/docs/threads/posts/
  https://developers.facebook.com/docs/threads/reference/publishing
- App review: required before public users can connect (owner app currently used).
- Status: real post confirmed via permalink (see PLATFORM_BLOCKERS.md). Tests:
  `threads.test.ts`, `threads-connect.test.ts`.

### Facebook Pages — CODE-COMPLETE / AWAITING-CREDENTIALS + AWAITING-APPROVAL
- Code: `src/adapters/facebook.ts`. Graph `v21.0`; OAuth dialog + Page chooser
  (`/user/accounts`), page-token exchange, feed/photo/video publish, permalink read.
- Scope: `pages_show_list,pages_manage_posts,pages_read_engagement` — matches
  official Pages API requirement (`pages_manage_posts` to publish). Ref:
  https://developers.facebook.com/docs/pages-api/posts
- Blockers: META_CLIENT_ID/SECRET + callback registration; Meta App Review for
  pages_manage_posts in production. Tests: `facebook.test.ts` (16).
- MAINTENANCE NOTE: pinned to Graph v21.0; current is ~v26. v21 still works;
  bump is a low-risk maintenance task, not a bug.

### Instagram — CODE-COMPLETE / AWAITING-CREDENTIALS + AWAITING-APPROVAL
- Code: `src/adapters/instagram.ts` + token-connect path in `accounts.ts`.
  Graph `graph.instagram.com/v21.0`; container publish; long-lived token exchange.
  Requires BUSINESS/CREATOR account (enforced). media REQUIRED (per capabilities).
- Scope: `instagram_business_basic,instagram_business_content_publish`.
- Blockers: Instagram app credentials + App Review; business/creator test account.
- Tests: `instagram.test.ts`.

### LinkedIn — CODE-COMPLETE / AWAITING-CREDENTIALS
- Code: `src/adapters/linkedin.ts`. REST `api.linkedin.com`, API version `202504`,
  `/rest/posts` + image registerUpload. Scope `openid profile w_member_social`.
- Blockers: LINKEDIN_CLIENT_ID/SECRET ("Share on LinkedIn" product), callback.
- Tests: `linkedin.test.ts` (10).

### X / Twitter — CODE-COMPLETE (guarded) / AWAITING-CREDENTIALS
- Code: `src/adapters/x.ts`. Official API v2 (`api.x.com/2`): OAuth2 PKCE,
  tweet create, media upload, revoke. Scope `tweet.read tweet.write users.read
  media.write offline.access`. Publishing gated behind X_API_ENABLED + hard
  monthly spend cap (pay-per-post).
- Blockers: paid X developer account + budget config. Tests: `x.test.ts`.

### Reddit / Mastodon / Telegram / Pinterest / TikTok — NOT-IMPLEMENTED
- No native adapter. Reddit is declared `directPublish:false` (assisted only).
  Others are honestly "coming soon" in-product; no code pretends they work.
  The PRD lists these but implementing them is out of the current MVP scope and
  each needs its own OAuth/app-review track.

## Summary
Prioritize the implemented set (per PRD): 2 LIVE (Bluesky, Threads), 4
CODE-COMPLETE awaiting external credentials/approval (Facebook, Instagram,
LinkedIn, X). No integration is mislabeled production-ready. Live verification
of the credential-blocked platforms requires owner action (dev apps + secrets).
