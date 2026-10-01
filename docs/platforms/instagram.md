# Instagram

`ADAPTER NOT IMPLEMENTED — planned; instagram requires IG Professional + Meta review`

## Current status
Cotly has no Instagram adapter. Compose does not offer Instagram as a destination. Do not attempt browser automation — the PRD allows official APIs only.

## What a real implementation requires
- An **Instagram Professional** (Business or Creator) account, linked to a Facebook Page.
- A Meta app with the **Instagram API with Instagram Login** (or the older Graph-based flow with a Page access token).
- Meta App Review for `instagram_business_content_publish` (Graph flow) / `instagram_content_publish` — real review, with screencast of the posting flow.
- Publishing model: container (`media_type` IMAGE/VIDEO/STORIES/REELS, `image_url` must be publicly reachable) → publish container — same two-step shape as Threads.

## Planned redirect URI
```
{APP_URL}/oauth/instagram/callback
```

## Interim workaround
Create the post in Cotly, let the target run in **Assisted mode** (or copy the caption from the compose page) and post manually with the image saved from the media library.

## References
- https://developers.facebook.com/docs/instagram-platform (official docs)
- https://developers.facebook.com/apps (app portal)
