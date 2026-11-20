# Re-verification log — session `984a6765` (2026-11-20 UTC)

Scope: an independent, line-by-line re-check of the live site's load-bearing claims against
Kalshi's official documentation and the official demo API, plus a review of the published
snapshot rows. Every check below names its official source and the observed result.
Result labels: **Verified** (official source says so, and the repo matches), **Irregularity**
(the repo, or the site text, disagrees with the source or is incomplete), **Unverified**
(cannot be confirmed from an official source; left blank or flagged), **Not re-checked**
(covered by an earlier session's record, not repeated here).

Method: `fetch_page` on the official pages and on the official demo REST endpoints
(`external-api.demo.kalshi.co`), `gh api` for GitHub Pages state, and local `node`/`python3`
validators on the checked-out branch. The sandbox shell itself has no route to Kalshi, so all
live observations came through the page fetcher.

## 1. Official sources used (fetched 2026-11-20 UTC)

| ID | Source | Used for |
|---|---|---|
| OS1 | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | Demo REST and WebSocket hosts |
| OS2 | [Kalshi Fee Schedule (PDF, effective 2026-07-07)](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | Taker and maker fee formulas, fee table, settlement fee |
| OS3 | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | `ceil_6dp` trade fee, rounding fee, rebate |
| OS4 | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) | `limit` maximum, `status` enum |
| OS5 | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | `limit` maximum, `status` enum, `tickers` filter |
| OS6 | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | REST statuses, filter-to-status mapping, `determined` meaning |
| OS7 | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | $1 per winning contract, settlement fees |
| OS8 | [Fixed-Point Representation (Last updated Nov 5, 2026)](https://docs.kalshi.com/getting_started/fixed_point_migration) | `*_dollars` and `*_fp` fields, sub-cent price structures |
| OS9 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | Path, `period_interval` enum, timestamp units |
| OS10 | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) | Unauthenticated access, `kalshi.com/markets/{series}` link pattern, orderbook ordering |
| OS11 | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | Handshake authentication, `KALSHI-ACCESS-*` headers |
| OS12 | [WebSocket Connection](https://docs.kalshi.com/websockets/websocket-connection) | "API key should be provided during the WebSocket handshake" |
| OS13 | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) | Unauthenticated limits are "separate"; no numbers published on this page |
| OS14 | [Documentation index](https://docs.kalshi.com/llms.txt) | Page inventory |
| OS15 | Live demo REST `GET /exchange/status` ([request](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status)) | Exchange and trading active on all demo shards |
| OS16 | Live demo REST `GET /markets/KXGOLFMAJOR-30-RFOX` ([request](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXGOLFMAJOR-30-RFOX)) | Spot check of an archived resolved row |

## 2. Line-by-line checks

Totals: 28 claims. 21 verified (C19 verified except the reciprocal-ask detail), 4 irregularities (I1–I4), 2 unverified or blocked (C24, C25), 1 not re-checked (C28).

| # | Claim on the site | Official check | Result |
|---|---|---|---|
| C1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` | OS1 table ("Recommended demo endpoint"); live OS15 returned 200 with `trading_active: true` | **Verified** |
| C2 | Demo WebSocket root `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | OS1 and OS11 | **Verified** (documented; not connected from the sandbox) |
| C3 | WebSocket is not used because the handshake needs signed `KALSHI-ACCESS-*` headers a browser cannot attach | OS11: "WebSocket connections require authentication during the connection handshake" and the required headers `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP`; OS12: "API key should be provided during the WebSocket handshake" | **Verified** for the Kalshi requirement. The browser limitation itself is a general web-platform fact, not something Kalshi documents. |
| C4 | Taker fee `roundup(0.07 × C × P × (1−P))`, M = 1 default | OS2 formula, "M = the multiplier for each contract (default is 1 unless otherwise indicated)" | **Verified** |
| C5 | Table row: 100 contracts at $0.50 → $1.75 fee | OS2 general table: "$50.00 … $1.75" for 100 contracts at $0.50 (0.07 × 100 × 0.5 × 0.5 = 1.75) | **Verified** |
| C6 | Trade fee is `ceil_6dp(model fee)`, then balance alignment | OS3 "Compute `trade_fee = ceil_6dp(model_fee)`" | **Verified** |
| C7 | Settlement is free | OS2 "There is no settlement fee."; OS7 "Settlement fees are zero for simple yes/no determinations" | **Verified** |
| C8 | Maker fees not modeled (limitation) | OS2 documents the maker formula `0.0175 × C × P × (1−P)`; the site states the omission openly | **Verified** as a disclosed limitation (not a defect) |
| C9 | Events `limit` max 200; `limit=1000` rejected | OS4 "Maximum value is 200." | **Verified** |
| C10 | Markets `limit` 1000 (collector) | OS5 "Maximum value is 1000." | **Verified** |
| C11 | `status=open` for events and markets maps to open markets | OS4 event `status` values `unopened/open/closed/settled`; OS5 market `status` values `unopened/open/paused/closed/settled`; OS6 maps `open` → `active` | **Verified** |
| C12 | `status=settled` is the REST filter for resolved markets; settled rows are `finalized` | OS6: "`settled` → `finalized`" and "settled markets end up at `finalized`" | **Verified** |
| C13 | Dashboard treats a market as resolved when it has a YES/NO result | OS6: `result` is set when the market becomes `determined`, which happens before `finalized`; the settlement timer runs in between (`settlement_timer_seconds`, 300 s on the sampled market) | **Irregularity I2.** `assets/app.js` (≈ line 354) only treats `finalized`, `settled` or `closed` with a result as resolved, so a market with status `determined` and a known result is not shown as resolved until it finalizes. The CI ledger (`scripts/portfolio_engine.py`, ≈ line 585) does include `determined`, so the two surfaces disagree. |
| C14 | Prices come from `*_dollars` fields; quantities from `*_fp` | OS8 "Prices are fixed-point dollar strings (`_dollars` suffix)"; sampled `data/samples/market-open-sample.json` uses `yes_bid_dollars`, `volume_fp` | **Verified** (code reads `_dollars`/`_fp`; checked in `assets/app.js`, `scripts/collect.py`, `scripts/portfolio_engine.py`) |
| C15 | Price display in the UI is in dollars with cents | OS8: sub-cent markets exist (`deci_cent`, `center_centi_edge_centi_cent`, …) and "integer-cent fields cannot represent sub-cent prices" | **Irregularity I3.** `fmt` in `assets/app.js` (`'$' + Number(v).toFixed(2)`) rounds every displayed price to the cent, so a 0.0030 quote shows as $0.00. Stored values keep full precision and the ≥ $0.10 alert math is unaffected. |
| C16 | Candlestick path `GET /series/{s}/markets/{t}/candlesticks`, timestamps in seconds | OS9 path and "`start_ts`/`end_ts`" parameters | **Verified** |
| C17 | Candlestick `period_interval` values accepted by the API: 1, 60, 1440 | OS9 "Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day)" | **Verified** (the API accepts 1440) |
| C18 | README: "`period_interval` 1 or 60 only" | OS9 lists 1440 as valid. The app does use only 1 and 60 (`assets/app.js` ≈ line 452), so the README is describing the app, not the API. | **Irregularity I1** (wording only; `methods.html`, `executive-summary.html`, and the Ideas page already state 1/60/1440 correctly) |
| C19 | Orderbook shows bids only; arrays ascending, best bid last | OS10 Step 3 "arrays are sorted ascending, best bid last" | **Verified** (the reciprocal-ask rule is in the orderbook response doc, not re-fetched here → **Not re-checked**) |
| C20 | Settlement fields: `result` yes/no, `settlement_ts`, `settlement_value_dollars` | OS6, OS7; live OS16 for `KXGOLFMAJOR-30-RFOX`: `status: finalized`, `result: yes`, `settlement_ts: 2026-07-19T18:49:28.40545Z`, `settlement_value_dollars: 1.0000` | **Verified** (matches the archived row in `data/snapshot.json`: same ticker, title, status, result, settlement_ts, settlement value 1) |
| C21 | Kalshi UI link `https://kalshi.com/markets/{series_ticker}` (lower-case) | OS10 "You can view these markets in the Kalshi UI at: https://kalshi.com/markets/kxhighny" | **Verified** (pattern documented by example; the doc's example slug uses the series ticker only) |
| C22 | Each snapshot and resolved row carries an official `source_url` on the demo base | `scripts/check_site.mjs` → 0 failures across 1,250 rows and 825 resolved entries; spot check of the archived row above | **Verified** (the raw `data/resolved.json` file has no per-row URL; `assets/lib.mjs` builds it and `scripts/build_snapshot.mjs` writes it into `data/snapshot.json`, which is what the site renders from) |
| C23 | Resolved window shows all settled in-scope markets in the last 72 hours | `data/resolved.json`: `in_scope_count: 3213`, but `markets` holds only the newest **200** (`in_scope[:200]` in `scripts/collect.py`). Pages do not state this cap. | **Irregularity I4** (disclosure gap; the archive in `data/snapshot.json` holds 625 resolved rows, which is a separate accumulation) |
| C24 | Rate limits are not published for unauthenticated calls | OS13 "Unauthenticated public requests are subject to separate limits." with no numbers | **Unverified** (already logged as F-DA-10 on the demo-account page; the site does not state numbers) |
| C25 | Demo-account portfolio tracking and order execution | Needs demo API credentials, which are not in the repo or the sandbox. Creating a demo account needs a human sign-up. | **Unverified / blocked** (not faked; logged as F-DA-7) |
| C26 | Public pages and GitHub Pages deployment | `gh api …/pages` → `status: built`, source `main /`; latest build `9f519d6` built; `fetch_page` of the root renders the landing page | **Verified** |
| C27 | Local validators on this branch | `node tools/build.mjs` → 0 broken links; `node scripts/check_links.mjs` → 0 failures; `node scripts/test_lib.mjs` → passed; `python3 scripts/portfolio_engine.py selftest` → 50/50; `node scripts/check_site.mjs` → 0 failures; `node tests/root_engine.test.js` → 40/40 | **Verified** (run on `9f519d6`) |
| C28 | Historical candles, trades history, and the 1440 window | Not used by the dashboard for these windows | **Not re-checked** (covered by earlier session records and the Ideas page backlog) |

## 3. Irregularities for the Flagged for Review page

- **I1 — README candlestick wording** (C18). Says "`period_interval` 1 or 60 only", which reads as an API limit. Official limit is 1, 60, 1440 ([OS9](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)). Owner: the session holding `README.md` (PR #35). **Change requested; not edited here.**
- **I2 — Resolution waits for `finalized`** (C13). Official lifecycle says the result is set at `determined` ([OS6](https://docs.kalshi.com/getting_started/market_lifecycle)). The browser dashboard (`assets/app.js`) waits for `finalized`; the CI ledger does not. Owner: the session holding `assets/app.js` (PR #32). **Change requested; not edited here.**
- **I3 — Prices shown to the cent** (C15). Official sub-cent structures ([OS8](https://docs.kalshi.com/getting_started/fixed_point_migration)); the UI `fmt` rounds to 2 dp. Owner: `assets/app.js` (PR #32). **Change requested.**
- **I4 — Resolved window is capped at 200 rows and the cap is not disclosed** (C23). Owner: `scripts/collect.py` and `resolved.html` text. **Disclosure requested.**
- **I5 — Blocked items** (C25): demo account credentials, and rate-limit numbers for unauthenticated calls (C24). Unverifiable from official sources without a human action; left blank and flagged.

## 4. What this session did and did not change

- Added this report (`reports/VERIFICATION_984a6765.md`) and a published Flagged section on `flagged.html` that links it.
- Did **not** edit `assets/app.js`, `README.md`, `methods.html`, `sources.html`, `EXECUTIVE_SUMMARY.md`, `assets/model.js`, or `dashboard.html`. Those files belong to open PRs #32 and #35, so the changes above are logged as requests on `COORDINATION.md`.
- Did not change data, fees, or strategy logic. Nothing was marked verified without an official link.
