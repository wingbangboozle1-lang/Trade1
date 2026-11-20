# Current deployment and documentation audit — session a53ab816

**Date:** 2026-11-20 UTC
**Branch:** `arena/a53ab816-trade1`
**Base:** `9f519d6f710bfccfd1a241803a0742a89822dc2a` (the deployed `main` head at audit start)

## Scope and result

This was an audit and targeted factual-correction pass on the already-integrated site, not a new dashboard implementation. The deployed root site already contains the live/polled dashboard, topic pages, price and depth charts, ≥$0.10 alert chats, automatic paper strategies and an always-on paper ledger, resolution views, and a separate opt-in demo-account console.

The pass corrected inaccurate statements on `flagged.html` that said no account API/order support existed, corrected a typo in Kalshi's supported demo WebSocket host, and clarified that the browser Strategy Lab and CI ledger use different fee rounding approximations. The ordinary paper workflow remains automatic and needs no keys. Real demo-account balance/positions and actual demo orders remain opt-in and require a user-owned key; no key was present and no account request or order was sent in this audit.

## Official-source verification

Pages fetched directly from Kalshi's official documentation during this pass:

- [Demo environment](https://docs.kalshi.com/getting_started/demo_env): demo uses mock funds, has separate credentials, and recommends REST root `https://external-api.demo.kalshi.co/trade-api/v2`; also-supported REST host is `https://demo-api.kalshi.co/trade-api/v2`. Demo market prices/behavior may differ from real markets.
- [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments): confirms both REST roots and exact demo WS URLs `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2`.
- [Get Events](https://docs.kalshi.com/api-reference/events/get-events), parameter section: `limit` defaults to 200 and has required range 1–200; the implementation's page size 200 is valid.
- [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks), parameter section: required `period_interval` values are 1, 60, or 1440 minutes. The UI uses trade prints for seconds windows, not an unsupported zero-minute candle request.
- [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook): official orderbook route and `depth` range 0–100. The page's depth claim is consistent with this specification.
- [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement): winning YES/NO contracts receive $1 each; simple binary settlement fees are zero.
- [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets): demo WS endpoint and signed `KALSHI-ACCESS-*` handshake headers.
- [Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests): account-owner API key ID/private key setup and signed request headers.
- [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2): documents `POST /portfolio/events/orders` and its request/response shape.
- [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding): six-decimal trade fee, target-balance alignment, rounding-fee accumulator and rebates. The implementation notes disclose that the two simulations do not reproduce all actual account fee state identically.

The account console UI and implementation were inspected locally: `demo-account/index.html` explains local browser key storage and guarded confirmation text; `demo-account/assets/app.js` blocks order submission without an imported key and the exact phrase `PLACE DEMO ORDER`. The README/workflow also documents separate CI order guardrails. These are repository facts, not independent assertions by Kalshi.

## Corrections made

1. `flagged.html` #12 previously said the site never asks for credentials and does not implement account endpoints. This contradicted the existing `demo-account/` console. It now distinguishes no-key automatic paper trading from user-configured account reads and guarded demo orders, and states that no account key was supplied here.
2. `flagged.html` #14 previously said no order placement is implemented anywhere. It now limits that claim to the root paper engines and discloses the separate guarded demo-order console.
3. `flagged.html` #19 had the wrong also-supported WebSocket hostname (`demo-api-ws.demo.kalshi.co`). It now matches the official docs' `demo-api.kalshi.co` host and explicitly records the earlier typo.
4. `flagged.html` #6c made an overbroad “paper fees are never lower than the exchange” statement and conflated two implementations. It now documents the different lab-vs-ledger rounding paths and does not claim a cent-for-cent account fee replica.
5. The review page's introductory notice and section heading now distinguish resolved historical corrections from active unverified items and observed data-quality issues.

## Verification performed on this checkout

- `npm ci --no-audit --no-fund` — installed locked test dependencies.
- `npm test` — **23/23** page/engine assertions passed; library tests passed.
- `npm run check` — build passed (**18 HTML**, 6 JS, 0 broken links); source checker passed (**1,250 market rows**, 825 resolved rows, 0 failures).
- `node tests/root_engine.test.js` — **40/40** assertions passed (including exact ±$0.10 thresholds).
- `node tests/demo-account.test.mjs` — **89/89** passed.
- `node tests/portfolio.test.mjs` — **60/60** passed.
- `node scripts/check_links.mjs` — 16 published pages, 354 local links, 169 external links, 0 failures; two warnings explicitly identify legacy pages outside published navigation.
- GitHub API: Pages reports `status: built`, public, HTTPS enforced, legacy source `main /`. Latest build ID `1388030462` reports `built` for commit `9f519d6f710bfccfd1a241803a0742a89822dc2a`. The site's CI checks and Pages deploy Actions runs for that commit both completed successfully (runs `44806283895` and `44806282975`).

## Limits and remaining review items

- An exact current market snapshot was not independently fetched from the demo API in this sandbox. The repository's checked-in snapshot is provenance-linked and the CI collector is the networked refresh path; no snapshot values are asserted here as live-now.
- The paper strategy's ROI score is a heuristic, not evidence of profitability. The alert source links provide market/settlement context and news search leads; they do not prove causation.
- Real account balances, positions, orders, and fills cannot be shown without account-owner credentials. No secret was requested or added. Default paper mode has no manual input and does not submit real orders.
- `flagged.html` remains the active list for unverified details and deliberate limitations; those do not block the static site or deployment.

## Manual review links

- [Live landing page](https://wingbangboozle1-lang.github.io/Trade1/)
- [Live dashboard](https://wingbangboozle1-lang.github.io/Trade1/dashboard.html)
- [Flagged for Review](https://wingbangboozle1-lang.github.io/Trade1/flagged.html)
- [Demo Account console](https://wingbangboozle1-lang.github.io/Trade1/demo-account/)
- [Sources index](https://wingbangboozle1-lang.github.io/Trade1/sources.html)
- [GitHub Pages settings/API](https://api.github.com/repos/wingbangboozle1-lang/Trade1/pages)
