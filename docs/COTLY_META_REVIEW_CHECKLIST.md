# COTLY_META_REVIEW_CHECKLIST

Readiness checklist for Meta App Review (Facebook Pages, Instagram, Threads).
Source of truth: `META_REVIEW_READINESS.md` (verified) + current Meta docs.
Do NOT submit to Meta without explicit owner authorization.

## Apps
- Facebook (Business, Login for Business) — Pages publishing.
- Instagram (Instagram API with Instagram Login) — image/Reel publishing.
- Threads (Facebook app Threads use case) — Threads publishing.

## Required publicly accessible materials (all live in the deployed Worker)
- [x] Privacy Policy page — `src/ui/pages/Privacy.tsx` -> /privacy
- [x] Terms of Service page — `src/ui/pages/Terms.tsx` -> /terms
- [x] Data Deletion instructions — `src/ui/pages/DataDeletion.tsx` -> /data-deletion
- [x] Threads deauthorize callback (POST) — /oauth/threads/deauthorize (verified
      signed_request, deletes the connection) — `src/api/accounts.ts`.

## Exact URLs to register in each Meta app dashboard (production values)
- App site / website URL: `https://cotly-social.vercel.app`
- Privacy Policy: `https://cotly-social.vercel.app/privacy`
- Terms: `https://cotly-social.vercel.app/terms`
- Data deletion instructions: `https://cotly-social.vercel.app/data-deletion`
- User-facing data deletion return: implemented at /data-deletion (canonical).
- Valid OAuth Redirect URIs (provider-facing Worker origin, NOT the SPA):
  - `https://cotly.cotly-app.workers.dev/oauth/facebook/callback`
  - `https://cotly.cotly-app.workers.dev/oauth/instagram/callback`
  - `https://cotly.cotly-app.workers.dev/oauth/threads/callback`
- Threads deauthorize callback: `https://cotly.cotly-app.workers.dev/oauth/threads/deauthorize`
Users are always returned to the canonical Vercel domain: every OAuth handler
302s to `${APP_URL}/app/profile?...` (verified live).

## Permissions requested vs implemented (scope minimalism)
| App | Permission | Implemented use | Verified in |
|---|---|---|---|
| Facebook | pages_show_list | Page chooser | facebook.ts listPages |
| Facebook | pages_read_engagement | show Page identity | facebook.ts |
| Facebook | pages_manage_posts | publish to Page | facebook.ts publish |
| Instagram | instagram_business_basic | resolve business acct | instagram.ts / accounts.ts |
| Instagram | instagram_business_content_publish | container + publish | instagram.ts |
| Threads | threads_basic | profile identity | threads.ts |
| Threads | threads_content_publish | publish | threads.ts |
No scope is requested that the code does not use.

## Per-app verdict (2026-10-11) — READY / MISSING / BLOCKED
| App | Permission | Implementation | Live proof | Verdict |
|---|---|---|---|---|
| Threads | threads_basic | COMPLETE (threads.ts; identity shown in Profile) | Connected account live in prod | **READY** — code done |
| Threads | threads_content_publish | COMPLETE (container -> threads_publish, pending resolution) | **LIVE-VERIFIED 2026-10-11**: publish-now + cron-scheduled posts with permalinks threads.com/@mirsadat.ai/post/DeVdO6fimjx and /DeVelhLiB6g | **READY** — code done |
| Instagram | instagram_business_basic | COMPLETE (instagram.ts, accounts.ts) | Connected account live in prod | **READY** — code done |
| Instagram | instagram_business_content_publish | COMPLETE (container + publish; graduated pending ladder) | **LIVE-VERIFIED 2026-10-11**: image post published, permalink instagram.com/p/DeVcE8vCmon | **READY** — code done |
| Facebook | pages_show_list | COMPLETE (Page chooser) | Connect flow implemented; live publish not yet demonstrated | **READY** — code done |
| Facebook | pages_read_engagement | COMPLETE (Page identity) | same | **READY** — code done |
| Facebook | pages_manage_posts | COMPLETE (Graph /{page}/feed) | unit-tested; live publish not yet demonstrated | **READY** — code done |

### MISSING (owner dashboard actions before submission — one checklist)
1. [ ] Record the screencast per docs/COTLY_META_REVIEW_DEMO_SCRIPT.md
       (Threads + Instagram flows are the same ones verified live above).
2. [ ] In each Meta app: Settings -> Basic -> fill App domains
       (cotly-social.vercel.app), Privacy Policy, Terms, Data Deletion URLs
       (exact values above); add platform = Website.
3. [ ] Register the three Valid OAuth Redirect URIs + the Threads deauthorize
       callback (exact values above) in Facebook Login / Instagram / Threads
       products' settings.
4. [ ] Facebook app: complete Business verification / Business Portfolio and
       accept the latest Platform Terms.
5. [ ] Switch each app to Production mode (requires 1+ admin with the roles
       granted; Advanced Access is granted THROUGH App Review itself).
6. [ ] Create tester accounts / grant roles: a Meta tester with a Facebook
       Page (for pages_*), an Instagram **Business or Creator** test account
       linked to that Page (personal IG accounts are correctly refused).
7. [ ] Submit App Review per permission set with the screencast + the
       justification wording from docs/COTLY_META_PERMISSION_JUSTIFICATIONS.md.

### BLOCKED (cannot be resolved in-repo or by the owner alone)
- Facebook pages_manage_posts approval itself — Meta-only decision after
  submission; the demo video must show the full connect -> publish flow.
- Nothing else is blocked: OAuth, callbacks, token handling, deauthorization,
  publishing and scheduling are implemented and (Threads/Instagram) proven
  against the real providers.

## Rejection-risk flags
- Instagram requires a Business/Creator account; Cotly enforces + explains this.
  A reviewer using a personal IG account will be correctly blocked — supply a
  professional tester account to avoid a false rejection.
- Facebook pages_manage_posts always requires App Review + a clear screencast
  of the full connect->publish flow.
