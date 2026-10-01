# Reddit

`ADAPTER NOT IMPLEMENTED — planned; Reddit → Assisted mode`

## Current status
Cotly has no Reddit adapter, and Reddit is registered with `directPublish: false` in the capability table: posts targeted at Reddit are parked in **Assisted mode** — Cotly prepares the caption and never auto-publishes.

## What a real implementation would require
- A Reddit **script app** (OAuth, installed-app type) at https://www.reddit.com/prefs/apps.
- OAuth 2.0 `authorization_code` flow (or user-agent-less script flow), scope `submit`.
- Posting: `POST https://oauth.reddit.com/api/submit` (`self` text posts; link/media posts have extra rules).
- Subreddit-specific rules (flairs, rate limits, karma gates) make auto-posting fragile — the reason it ships as Assisted mode.

## Planned redirect URI
```
{APP_URL}/oauth/reddit/callback
```

## Interim workflow (Assisted mode)
1. Compose with a Reddit destination → target status becomes `assisted` at publish time.
2. The queue shows the caption as ready for manual publishing; copy it into Reddit yourself.
3. Nothing is marked published without provider evidence — assisted targets are a terminal state by design.

## References
- https://www.reddit.com/prefs/apps (app portal)
- https://www.reddit.com/dev/api (official API docs)
