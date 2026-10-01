# Facebook (Pages)

`CODE COMPLETE — LIVE TEST PENDING (needs your developer app credentials)`

Publishes to Facebook **Pages** via the Graph API v21.0 (profile/timeline posting is not offered by the API).

## Developer portal
- https://developers.facebook.com/apps — Create App → type **Business**.
- Add the **Facebook Login** product.

## Required scopes
`pages_show_list, pages_manage_posts, pages_read_engagement`

## OAuth redirect URI
```
{APP_URL}/oauth/facebook/callback
```
`APP_URL` is your Cotly base URL (e.g. `http://localhost:8787` in dev). Add the exact URI under Facebook Login → Settings → **Valid OAuth Redirect URIs**.

## Dev/test-mode setup
1. Settings → Basic: copy the **App ID** and **App Secret**.
2. `META_CLIENT_ID=<App ID>` and `META_CLIENT_SECRET=<App Secret>` in `.dev.vars` (local) or via `wrangler secret put` (prod).
3. In App Mode **Development**, the OAuth dialog works only for people listed as admins/developers/testers of the app — which covers a personal deployment.
4. Your Facebook account must be able to admin the target Page.

## Review / verification
- `pages_manage_posts` and `pages_read_engagement` require **Meta App Review** before the general public can connect. For personal use (app roles only) no review is needed.
- Submit for review only if you want other people to connect their Pages.

## Connect in Cotly
1. Accounts page → **Connect Facebook** → approve the dialog.
2. Cotly exchanges the code, calls `/me/accounts` and stores the **first Page** (page id in account meta, page access token as the stored token).

## Verify first publish
1. Compose → select the Facebook account → Publish now.
2. Queue shows the target `published` with a permalink; check the Page for the post.
3. Diagnostics → recent attempts shows the Graph response summary.

## Notes
- Text, up to 10 images, one video per post. Images are attached as unpublished photos, then posted via `/feed` with `attached_media`.
- Media is fetched by Meta from a short-lived (~1h) signed R2 GET URL — R2 S3 credentials must be configured (see README deploy steps).
