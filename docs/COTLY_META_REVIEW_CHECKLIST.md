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

## OAuth callbacks (production, no localhost in prod config)
- [x] /oauth/facebook/callback
- [x] /oauth/instagram/callback
- [x] /oauth/threads/callback
All derived from production APP_URL via oauthCallbackBase().

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

## Owner/dashboard actions still required (cannot be done in-repo)
- [ ] Submit App Review for each permission set (needs the demo screencast).
- [ ] Business verification / Business Portfolio for the Facebook app.
- [ ] Accept latest Platform Terms.
- [ ] Register callbacks + deauthorize URL in each app's settings.
- [ ] Provide reviewer test accounts (incl. an IG Business/Creator account).

## Rejection-risk flags
- Instagram requires a Business/Creator account; Cotly enforces + explains this.
  A reviewer using a personal IG account will be correctly blocked — supply a
  professional tester account to avoid a false rejection.
- Facebook pages_manage_posts always requires App Review + a clear screencast
  of the full connect->publish flow.
