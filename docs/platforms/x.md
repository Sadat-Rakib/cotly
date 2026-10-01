# X (Twitter)

`ADAPTER NOT IMPLEMENTED — planned; X is a paid API (budget guard in Settings)`

## Current status
Cotly has no X adapter. The Settings page already has an **X budget mode** (Disabled / Warn / Hard cap + monthly USD) — it stores values but is inert until the adapter exists.

## What a real implementation requires
- A paid **X API access tier** (Free tier is read/write-posting limited to 500 posts/month at the time of writing; tiers and prices change — check the portal).
- An OAuth 2.0 **user context** app (confidential client) with PKCE, scopes `tweet.read tweet.write users.read offline.access`.
- Posting: `POST /2/tweets` with `text`; media via `POST /2/media/upload` (v1.1 or the chunked v2 media endpoint).
- OAuth 2.0 token refresh (refresh tokens provided with `offline.access`).

## Planned redirect URI
```
{APP_URL}/oauth/x/callback
```

## Cost guard
When implemented, the adapter should consult the platform_usage table and the budget settings: Warn logs an activity entry per post, Hard cap refuses to publish once the monthly estimate is exceeded.

## Interim workaround
Compose in Cotly, then post manually; keep the caption short enough for 280 chars.

## References
- https://developer.x.com (portal)
- https://docs.x.com/x-api (official docs)
