# Coordination

Shared task board. Each task is listed once, with its status, owning session, and the
files it touches. A task with status `needs review` is published on the Flagged for
Review page and does not block anything.

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard: executive summary, live alerting dashboard, category subpages, chart/liquidity view, paper-trade automation, resolved-event tracking, verification, GitHub Pages site + deployment | in progress | ed8bbdf4 | COORDINATION.md, README.md, .github/workflows/pages.yml, css/app.css, js/reference.js, js/engine.js, js/ui.js, index.html, pages/*.html, alerts.html, trading.html, flagged.html, sources.html, scripts/paper_engine.py |

## Task log

### Handoff
- Prior session `ee533bdf` built an initial single-file static prototype (index.html) and
  marked the task `needs review`. Its branch work was merged to `main` in PR #1
  (`73ba253`). This session (`ed8bbdf4`) takes over and expands it into the full deliverable.
- Branch policy for this session is fixed: all work stays on the Arena-assigned branch
  `arena/ed8bbdf4-trade1`. Task branches (`session-<id>/<task>`) are not created because the
  session branch policy prohibits switching or creating other branches. Scope below is the
  whole deliverable; no other session is active, so there is no overlap risk.
- Claimed 2026-11-20 by session `ed8bbdf4`.

### Planned scope (this session)
1. **Verified reference data** — `js/reference.js`: endpoint, field, unit, auth, WebSocket,
   and settlement facts, each row carrying a link to an official Kalshi source.
2. **Shared engine** — `js/engine.js`: demo REST polling (public market data), topic
   classification, $0.10 swing detection, dual alert feeds, heuristic ROI screen, orderbook
   depth, per-market price samples, paper-trade strategy engine, settlement/outcome tracking.
3. **Shared UI** — `js/ui.js` + `css/app.css`: nav, tables with source links, canvas charts,
   liquidity view, alert chats, portfolio/analysis.
4. **Pages** — landing + executive summary (`index.html`), five category subpages
   (`pages/{gas,elections,culture,crypto,golf}.html`), live alerts (`alerts.html`),
   trading/portfolio/strategies (`trading.html`), flagged for review (`flagged.html`),
   sources & verification (`sources.html`).
5. **Automation script** — `scripts/paper_engine.py`: standalone paper-trade engine mirroring
   the browser strategies (verified with `py_compile`).
6. **Deployment** — confirm `.github/workflows/pages.yml`, push, open PR to `main`, merge,
   confirm GitHub Pages deploys.

### Verified facts (official Kalshi sources)
- Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` (also
  `https://demo-api.kalshi.co/trade-api/v2`); demo WS
  `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (also
  `wss://demo-api.kalshi.co/trade-api/ws/v2`). Sources: demo env page, API environments.
- Public market data endpoints need no key; the official market-data quick start shows
  in-browser `fetch()` examples (browser-readable). Sources: quick start market data,
  Get Markets reference.
- `GET /markets` response fields confirmed from the Get Markets reference: `ticker`,
  `event_ticker`, `market_type`, `title`, `subtitle`, `yes_bid_dollars`, `yes_ask_dollars`,
  `no_bid_dollars`, `no_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`,
  `last_price_dollars`, `previous_yes_bid_dollars`, `volume_fp`, `volume_24h_fp`,
  `open_interest_fp`, `notional_value_dollars`, `result`, `status`, `close_time`,
  `rules_primary`, `settlement_value_dollars`, `settlement_ts`.
- `status` values: `unopened`, `open`, `paused`, `closed`, `settled`. Source: Get Markets.
- Orderbook response `orderbook_fp.{yes_dollars,no_dollars}` as `[price, count]` pairs.
  Official market-data quick start states arrays are **sorted ascending, best bid last**
  (uses `[-5:]`). Some third-party guides state best-to-worst. **Conflict flagged**;
  engine finds the best bid order-independently with `max()` and flags the discrepancy.
- WebSocket handshake **requires authentication** even for public market-data channels
  (`ticker`, `trade`, `market_lifecycle_v2`); only the session is authenticated, no extra
  per-channel check for public channels. A static GitHub Pages site has no key, so live
  streaming falls back to public REST polling. Source: quick start WebSockets.
- Settlement: `settlement_value_dollars` (YES-side value; `1.00` = YES, `0.00` = NO) and
  `result` (`yes`/`no`) on settled markets. Source: Get Markets reference.

### Flagged / not implemented (published on Flagged for Review)
- Authenticated demo-account live trading (POST /portfolio/events/orders) and live
  portfolio/balance/positions/fills require a demo API key + private key, which this
  session does not possess and will not request. The site runs paper (simulated) trades
  against public market data only and stores them in the browser.
- WebSocket live streaming is not used (auth-gated); live updates use public REST polling.
- Topic classification is a title/subtitle/ticker keyword heuristic, not an official
  category API call; may miss or mis-bucket markets.
- Dollar-volume ranking uses an estimated derived value (`volume_fp × notional_value_dollars`),
  which is not an official API field; flagged as derived.
- External news/event attribution for sharp moves is not verified; cause is shown as
  unverified. Orderbook only exposes bids (YES ask is derived as `1 − best NO bid`).
- Live values could not be fetched from this sandbox (Kalshi hosts are not reachable here);
  the site fetches live data at runtime and reports connection status. Reference facts are
  verified against official docs.

## Sessions

| Session | Branch | Claimed tasks | Last update |
|---|---|---|---|
| ed8bbdf4 | arena/ed8bbdf4-trade1 | Kalshi demo dashboard (full deliverable) | 2026-11-20 |
| ee533bdf | (merged to main via PR #1) | initial prototype (superseded) | 2026-11-20 |
