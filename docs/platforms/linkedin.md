# LinkedIn

`CODE COMPLETE — LIVE TEST PENDING (needs your developer app credentials)`

Posts as a member via the LinkedIn REST API (`/rest/posts`). Company-page posting is not wired.

## Developer portal
- https://www.linkedin.com/developers — Create app. Fill in a company page + privacy policy URL (required by LinkedIn).

## Products (required)
- **Sign In with LinkedIn using OpenID Connect** → `openid`, `profile` scopes.
- **Share on LinkedIn** → `w_member_social` scope.
Both are usually granted instantly for your own use; nothing else to buy.

## Required scopes
`openid profile w_member_social`

## OAuth redirect URI
```
{APP_URL}/oauth/linkedin/callback
```
Add the exact URI under Auth → **Redirect URLs**.

## Dev/test-mode setup
1. Auth tab: copy **Client ID** + **Client Secret**.
2. `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` in `.dev.vars` (local) or `wrangler secret put` (prod).
3. The authorizing account is the member whose profile Cotly posts to.

## Review / verification
- No formal App Review for personal posting: `w_member_social` posts as the **authenticated member** once the "Share on LinkedIn" product is added. Posts land on your own feed.
- Verification/unverified app limits apply to other people authorizing; for a single-owner instance this is fine.

## Connect in Cotly
1. Accounts page → **Connect LinkedIn** → approve.
2. Cotly stores your member URN (`sub` from `/v2/userinfo`).

## Verify first publish
1. Compose → LinkedIn account → Publish now.
2. Target turns `published` with the RestLi id as provider post id (LinkedIn's API returns **no permalink** — check your feed manually).
3. Diagnostics shows the attempt result.

## Notes
- Text + one image (registerUpload → PUT → post with `content.media.id`). Multi-image and video are not supported yet and fail with a clear human message.
- Auth failures (401/403) map to `needs_reconnect` — reconnect from the Accounts page.
- **Test connection** (Accounts page) probes the token via `/v2/userinfo`; expired tokens prompt a reconnect. Posting rights are only proven by an actual publish.
