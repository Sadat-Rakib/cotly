# Threads

`CODE COMPLETE — LIVE TEST PENDING (needs your developer app credentials)`

Uses the official Threads API (graph.threads.net). Requires a Threads account linked to the Meta app.

## Developer portal
- https://developers.facebook.com/apps — Create App → type **Threads** (same portal as Facebook; Threads apps are a distinct app type).
- Use case: "Access the Threads API".

## Required scopes
`threads_basic, threads_content_publish`

## OAuth redirect URI
```
{APP_URL}/oauth/threads/callback
```
Add the exact URI under the Threads app's redirect settings in the Meta app dashboard.

## Dev/test-mode setup
1. App dashboard → copy **Threads App ID** + **Threads App Secret** (Settings → Basics).
2. `THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET` in `.dev.vars` (local) or `wrangler secret put` (prod).
3. The Meta account authorizing must be the owner of the Threads profile.
4. Threads requires the app to be taken through the "live" switch for API access beyond your own test users; for a personal deployment your own account is enough.

## Review / verification
- `threads_content_publish` requires app review for use by anyone other than the app owner/admin. Personal use (your own account) works without review.

## Connect in Cotly
1. Accounts page → **Connect Threads** → approve.
2. Cotly stores the user id and username; publishing runs the container → publish flow.

## Verify first publish
1. Compose → Threads account → Publish now.
2. The target goes to `publishing` (pending container) and resolves to `published` with a permalink within a minute (scheduler retries each minute).
3. Check your Threads profile for the post.

## Notes
- Cotly currently publishes one image or one video per Threads post (no carousel), 500-char captions enforced.
- Media is fetched by Threads from a ~1h signed R2 GET URL (R2 S3 credentials required).
- Container status polling uses `status_code` (FINISHED / IN_PROGRESS / EXPIRED) — confirm field availability during live test.
