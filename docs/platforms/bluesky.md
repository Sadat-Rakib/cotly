# Bluesky

`CODE COMPLETE — LIVE TEST PENDING (needs your app password)`

No developer app, no OAuth review — Bluesky uses the AT Protocol with **app passwords**. Fastest platform to get live.

## Portal / prerequisites
- No app registration exists or is needed. Endpoint used: `https://bsky.social` XRPC (`com.atproto.server.createSession`, `uploadBlob`, `createRecord`).
- Create an app password at https://bsky.app/settings/app-passwords.

## Scopes
None — app passwords grant the session. No OAuth redirect URI is used; Cotly connects directly.

## Setup
1. Bluesky app settings → App Passwords → create one (label it "Cotly").
2. Accounts page → Bluesky card → enter your **handle** (e.g. `you.bsky.social`) and the **app password** → Connect.
3. Cotly stores the DID as the account id and the session JWTs (encrypted); it refreshes sessions automatically and asks for a reconnect if the refresh token expires.

## Review / verification
- None. App passwords are a first-party Bluesky feature; no review, no quota approval.

## Verify first publish
1. Compose → Bluesky account → Publish now (300-char captions, up to 4 images, no video).
2. Target turns `published` with a permalink of the form `https://bsky.app/profile/{did}/post/{rkey}`.
3. Open the permalink and confirm the skeet rendered (images included).

## Notes
- Images are fetched from R2 by Cotly and re-uploaded as AT Protocol blobs (`uploadBlob`) — R2 S3 credentials are required for image posts, text posts work without them.
- Auth failures after a refresh attempt map to `needs_reconnect`; disconnect and re-enter a fresh app password.
- **Test connection** (Accounts page) probes the session via `getSession` and renews it once via `refreshSession` if expired (renewal is report-only — Cotly picks up the new token on next use); a failed renewal prompts a reconnect.
