# Coordination

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |
| Full build-out: live alert dashboard (two chats), topic subpages, charts/orderbook, automated paper trading + portfolio, resolution tracking, verification docs, Pages deployment | in progress | f6094c46 | site/** (all new), assets inside site/, data snapshots inside site/data/, README.md, EXECUTIVE_SUMMARY.md, docs/VERIFICATION.md, .github/workflows/pages.yml, COORDINATION.md |

## Session registry

- `ee533bdf` — prior session (Arena branch `arena/ee533bdf-trade1`). Built the initial static prototype `index.html`. Status of its task: needs review (its flagged items are being addressed by f6094c46).
- `f6094c46` — current session (Arena branch `arena/f6094c46-trade1`). 

## Task log

### Kalshi demo dashboard (ee533bdf)
- Claimed 2026-11-20 by session `ee533bdf`. Work stayed on Arena-assigned branch `arena/ee533bdf-trade1`; branch policy prohibits switching/creating task branches.
- Implemented static dashboard with topic filters (keyword heuristic), open-market REST polling, market rows linked to Kalshi, selected-market YES-bid sampling and chart, orderbook bid quantity summary, $0.10 sampled jump notice, local-only paper-trade log categorized by strategy, official-reference links, executive summary, and explicit scope/safety flags.
- Sources consulted (official Kalshi docs): [market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data), [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), [authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book). Endpoint URLs presented in the user brief match the demo endpoint pair documented by Kalshi in its documentation search result.
- Verification performed: extracted embedded JavaScript and ran `node --check`; ran `git diff --check`. No live endpoint/browser CORS test was possible here; endpoint data are not represented as verified live values.
- Flagged / not implemented (carried forward): authenticated demo account, actual order execution/automation, account performance/settlement history, resolved-market outcome archive, official dollar-notional ranking, persistent WebSocket feed, verified news-cause attribution, and confirmation of Pages deployment. App deliberately stores no credentials and paper trades are not exchange trades. The topic filter is heuristic and needs review; dynamic rows are only present when API requests work.
- Note: `index.html` at repo root predates the `site/` layout introduced by f6094c46. It is superseded by `site/index.html` (same scope, expanded). Kept until the integration review, then to be removed to avoid two landing pages; the Pages workflow now publishes `site/` only.

### Full build-out (f6094c46) — ACTIVE
- Claimed 2026-11-20 by session `f6094c46` on branch `arena/f6094c46-trade1` (Arena session policy fixes this branch; the `session-<id>/<task>` naming in the task brief cannot be used here — logged as a deviation, scope non-overlap maintained by this registry).
- Scope: everything under `site/` (new), `README.md`, `EXECUTIVE_SUMMARY.md`, `docs/VERIFICATION.md`, `.github/workflows/pages.yml` (publish `site/` instead of repo root), `COORDINATION.md`. The only shared file edited outside `site/` is this coordination board.
- API verification performed 2026-11-20 against official sources (all logged with links in `docs/VERIFICATION.md`): live demo REST responses for `/events`, `/markets` (+`series_ticker`/`event_ticker` filters), `/series/{ticker}`, `/series?category=`, `/series?tags=Golf`, `/markets/{ticker}/orderbook?depth=`, `/markets/trades?ticker=`, `/series/{s}/markets/{t}/candlesticks`; official docs for demo environment, Get Markets statuses (unopened/open/closed/settled), orderbook shape, candlesticks periods (1/60/1440 min, ≤5000 periods), Get Trades shape, WebSocket auth-at-handshake requirement, unauthenticated rate limits; official fee schedule PDF (taker `fees = round_up(0.07 × C × P × (1−P))`, maker multiplier 0.0175, no settlement fee, effective 2026-07-07).
- Irregularities flagged so far (full list on the site's Flagged for Review page): demo market objects return `status:"active"` while docs' canonical status vocabulary is unopened/open/closed/settled; demo `settlement_sources` entries contain template placeholder URLs (e.g. `google.com/search?q=…`) on some Culture series; `KXGAS` ("Gas weekly") exists in demo but has zero events; sandbox build environment cannot reach Kalshi hosts (browser-side fetching is the architecture), so browser CORS behavior is not verifiable from the build environment — site degrades to verified snapshots with a clear banner; WebSocket requires authenticated handshake (impossible from a static page without user credentials), so REST polling is used.
- Verification policy: every value in committed tables is taken from a response fetched from the official demo API or official docs on 2026-11-20, with the request URL recorded as the row's source link. Values that could not be confirmed are left blank and flagged, never inferred.
- Completion notes will be appended under this heading when the build is finished.
