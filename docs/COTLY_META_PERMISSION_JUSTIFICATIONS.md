# COTLY_META_PERMISSION_JUSTIFICATIONS

Accurate, submission-ready justifications. Each maps a requested permission to
the exact in-product use and the code path that exercises it. Wording is honest:
Cotly publishes the user''s own content to the user''s own destinations on their
explicit instruction.

## Facebook Pages
- pages_show_list — "Cotly lists the Facebook Pages the person manages so they
  can choose which Page to publish to. Shown in Profile -> Facebook Pages ->
  Connect -> Page chooser." Code: `FacebookAdapter.listPages`, `accounts.ts`.
- pages_read_engagement — "Used only to read the chosen Page''s basic identity
  (name) to display which destination is connected." Code: `facebook.ts`.
- pages_manage_posts — "Creates the post on the user''s selected Page when they
  press Publish now or when their scheduled time arrives. Never posts to a
  personal profile." Code: `FacebookAdapter.publish` -> Graph `/{page}/feed`.

## Instagram
- instagram_business_basic — "Resolves the connected professional (Business/
  Creator) account identity (id, username, type) to show which account is
  linked and to target publishing." Code: `instagram.ts`, `connectInstagramToken`.
- instagram_business_content_publish — "Creates a media container for the user''s
  prepared image/video and publishes it after Instagram finishes processing,
  on the user''s explicit instruction." Code: `instagram.ts` container+publish.

## Threads
- threads_basic — "Reads the user''s Threads profile identity to display the
  connected account." Code: `threads.ts`.
- threads_content_publish — "Publishes the user''s prepared post via the
  official two-step container -> threads_publish flow." Code: `threads.ts`.

## Cross-cutting assurances (for reviewer questions)
- OAuth state is random, user-bound, provider-checked, single-use, 10-min TTL.
- Tokens encrypted at rest (AES-256-GCM), never sent to the browser, redacted
  in logs. Disconnect deletes stored tokens and best-effort revokes provider-side.
- Publishing is idempotent (per-target generation key) and only reports success
  on provider-confirmed results.
