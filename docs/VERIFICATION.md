# Verification Log — line-by-line, with official sources

**Session:** `f6094c46` (branch `arena/f6094c46-trade1`) · **Date of verification:** 2026-11-20 (UTC)

## Method and policy

- Every value published in committed tables was read from an official source on 2026-11-20: either a **live response from the Kalshi demo REST API** (the request URL itself is the source link) or **official Kalshi documentation** / the **official fee schedule PDF**.
- Values that could not be confirmed are left **blank** and flagged — never inferred, interpolated, or filled from memory. The blank-value policy is implemented in the site renderer (`renderSnapshotTable` renders a literal "blank — unverified, never inferred" badge).
- The build sandbox permits egress only to github.com/npm/pypi; Kalshi hosts are unreachable from shell (`curl` fails with SSL_ERROR_SYSCALL — logged below). Verification therefore used platform-side page fetches of the official API URLs and docs. The **browser** (user's machine) is the runtime data path, which is why the app is client-side.

## Verification sequence (chronological)

| # | Check | Result | Official source |
|---|---|---|---|
| 1 | Repo review (prior session `ee533bdf` files: COORDINATION.md, README.md, index.html, pages.yml) | Reviewed; prior flags carried forward | repo files at commit `73ba253` |
| 2 | Sandbox egress test to `external-api.demo.kalshi.co` via curl | Blocked (`SSL_ERROR_SYSCALL`) — documented constraint; client-side architecture chosen | (environment) |
| 3 | Live `GET /markets?status=open&limit=2` | Verified: response shape; `_dollars` string prices; `volume_fp`/`open_interest_fp`/`volume_24h_fp`; `previous_price_dollars`; demo returns `status:"active"` (flagged vs docs); MVE crosscategory markets present | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=2) |
| 4 | Official docs — Get Markets: status filter values | `unopened, open, closed, settled` (only one status filter); schema fields incl. `previous_price_dollars`, `*_size_fp`, `result` | [docs.kalshi.com/api-reference/market/get-markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| 5 | Official docs — WebSocket | WS requires `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP` **at handshake**; public channels exist but session is authenticated; demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` → static site uses REST polling (flagged) | [docs.kalshi.com/getting_started/quick_start_websockets](https://docs.kalshi.com/getting_started/quick_start_websockets) |
| 6 | Official docs — Rate limits | Token buckets; unauthenticated requests have **separate limits** (numbers unpublished) → back off on 429 → app uses 350 ms min-gap + exponential backoff, counters shown | [docs.kalshi.com/getting_started/rate_limits](https://docs.kalshi.com/getting_started/rate_limits) |
| 7 | Official docs — Get Market Orderbook | `GET /markets/{ticker}/orderbook` returns `orderbook_fp.{yes_dollars,no_dollars}` = `[price_dollars, fp_quantity]` pairs **ascending** (best bid last); bids only; YES bid at $x = NO ask at $1−x; `depth` 0–100 | [docs.kalshi.com/api-reference/market/get-market-orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) |
| 8 | Official docs — Get Market Candlesticks | `GET /series/{series_ticker}/markets/{ticker}/candlesticks`; `period_interval` ∈ {1,60,1440} min; ≤5,000 periods/request; ts in seconds; may lag trades a few seconds | [docs.kalshi.com/api-reference/market/get-market-candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) |
| 9 | Official docs — Get Trades | `GET /markets/trades` with `ticker`, `limit` (≤1000), cursor, min/max_ts, `is_block_trade`; Trade schema: `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side`, `taker_book_side`, `created_time`, `is_block_trade` | [docs.kalshi.com/api-reference/market/get-trades](https://docs.kalshi.com/api-reference/market/get-trades) |
| 10 | Official docs — Get Series List | `GET /series?category=&tags=&include_volume=true` (exact, case-sensitive); `fee_type` semantics reference the official fee schedule | [docs.kalshi.com/api-reference/market/get-series-list](https://docs.kalshi.com/api-reference/market/get-series-list) |
| 11 | Official docs — Demo environment | Demo at demo.kalshi.co, mock funds, credentials separate from production; recommended roots match the brief | [docs.kalshi.com/getting_started/demo_env](https://docs.kalshi.com/getting_started/demo_env) |
| 12 | Official fee schedule PDF (effective 2026-07-07) | Taker `fees = round_up(M×0.07×C×P×(1−P))`; maker `0.0175×C×P×(1−P)` with default M=0 on quadratic series; **no settlement fee**; worked table values ($0.10→$0.01 per contract; 100 @$0.50→$1.75) used as unit-test fixtures; non-standard table lists `KXAAAGASM` ("US gas price") and Emmy (culture) series | [kalshi.com/docs/kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| 13 | Live `GET /events?status=open&limit=100` | Categories on demo: World, Elections, Climate and Weather, Science and Technology, Financials, Sports…; events carry `series_ticker`, `settlement_sources` (official URLs) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/events?status=open&limit=100) |
| 14 | Live `GET /series/KXBTCD`, `/series/KXETHD` | Crypto series verified: category "Crypto", hourly, fee quadratic M=1, CF Benchmarks settlement sources, contract terms URLs | [KXBTCD](https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTCD) · [KXETHD](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHD) |
| 15 | Live `GET /markets?series_ticker=KXBTCD&status=open&limit=3` | BTC hourly markets verified incl. rules text (CF Benchmarks RTI); first page shows volume 0.00 → demo crypto sparsity **flagged** | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXBTCD&status=open&limit=3) |
| 16 | Live `GET /series/KXGAS` + `/events?series_ticker=KXGAS&status=open` and without status | "Gas weekly" (Economics, weekly, EIA settlement, GAS.pdf terms); **zero events at any status** → flagged | [series](https://external-api.demo.kalshi.co/trade-api/v2/series/KXGAS) · [events](https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXGAS) |
| 17 | Live `GET /series?tags=Golf` | Golf whitelist verified: KXPGAR2TOP10, KXPGA3BALL, KXPGA5BALL, KXLIVTOP10 (+more; ~27 fetch-chunks), settled vs PGA Tour/ESPN/Fox Sports/Golf Channel/LIV | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/series?tags=Golf) |
| 18 | Live `GET /series?category=Culture&include_volume=true` | Exactly 2 Culture series (KXXBANNEDGROK, KXXBANNEDMURRAYHILLGUY1), both volume 0.00; **placeholder settlement URLs flagged** | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Culture&include_volume=true) |
| 19 | Live `GET /markets?series_ticker=KXXBANNEDGROK&status=open` | Empty markets array (Culture sparsity documented, not guessed) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXXBANNEDGROK&status=open) |
| 20 | Live `GET /series?category=Elections&include_volume=true` | KXVPRESNOMR "Republican VP nom" volume 1,273,383.00 contracts; KXCONTROLH (Library of Congress settlement); 529 fetch-chunks (large catalog — not fully ingested; live discovery is done client-side at view time) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Elections&include_volume=true) |
| 21 | Live `GET /series/KXAAAGASM` | "US gas price" (monthly, AAA settlement, AAAGAS.pdf terms) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) |
| 22 | Live `GET /events?series_ticker=KXVPRESNOMR&status=open&limit=5` | Event KXVPRESNOMR-28 verified (Elections category, gop.com settlement) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXVPRESNOMR&status=open&limit=5) |
| 23 | Live `GET /markets?event_ticker=KXVPRESNOMR-28&status=open&limit=200` | Liquid market KXVPRESNOMR-28-EKIR verified: bid $0.06/ask $0.98/last $0.08/prev $0.08/volume 49,905.15/OI 49,800.01; early_close_condition text; rules_primary | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets?event_ticker=KXVPRESNOMR-28&status=open&limit=200) |
| 24 | Live `GET /markets/KXVPRESNOMR-28-EKIR/orderbook?depth=5` | Ladder verified live: yes_dollars [[0.0100,1.00],[0.0600,1.00]], no_dollars [[0.0100,1.00],[0.0200,1.00]] — matches docs exactly | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXVPRESNOMR-28-EKIR/orderbook?depth=5) |
| 25 | Live `GET /markets/trades?ticker=KXVPRESNOMR-28-EKIR&limit=3` | Trade prints verified live (trade_id, count_fp, yes/no price, taker side/book side, created_time, is_block_trade) | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/markets/trades?ticker=KXVPRESNOMR-28-EKIR&limit=3) |
| 26 | Live candlesticks `period_interval=60` on EKIR | Endpoint verified; empty array for the window (idle market) — matches docs' lag/availability note | [request URL](https://external-api.demo.kalshi.co/trade-api/v2/series/KXVPRESNOMR/markets/KXVPRESNOMR-28-EKIR/candlesticks?start_ts=1763598000&end_ts=1763684400&period_interval=60) |
| 27 | Negative test: `GET /markets/{ticker}/trades` path | Fails — correct documented path is `/markets/trades?ticker=` (checked #9); app uses the documented path | [docs](https://docs.kalshi.com/api-reference/market/get-trades) |
| 28 | `/search` endpoint probes (demo + production) | Not reachable at the attempted path; not used in the final design (topic discovery uses official `/series` filters instead) | (attempt logged for transparency) |

## Build-time checks (this branch)

| Check | Result |
|---|---|
| `node --check site/assets/app.js` | PASS |
| `node tests/engine.test.js` — 36 assertions incl. **official fee-table cross-checks** ($0.10→$0.01, 100@$0.50→$1.75, 100@$0.05→$0.34, 100@$0.99→$0.07, 100@$0.20→$1.12), parsing, alert engine (threshold/cooldown/dedupe/float-cent fix), classifier, bot P&L & settlement | 36/36 PASS (found & fixed: float-fee ceil bug, undefined `markAlert`, 10-cent float-comparison miss, alert double-post dedupe) |
| `node tests/smoke.test.js` — boots all 11 pages with stubbed network | 11/11 graceful degradation PASS |
| Static server route check (python http.server) | 14/14 routes HTTP 200 |
| `python3 -c json.load(snapshot)` | valid JSON: 13 endpoint rows, 22 topic rows, 13 irregularities, 12 series rows |

## Deliberately left blank / unverified (never inferred)

| Item | Where recorded |
|---|---|
| Browser↔Kalshi CORS behavior (untestable from sandbox) | Flagged page + README (manual curl command provided) |
| Unauthenticated rate-limit numbers (not published by Kalshi) | Flagged page (conservative throttling implemented) |
| `previous_price_dollars` exact semantics (field name from official schema; description not visible in fetched chunk) | Flagged page |
| `KXAAAGASM` open-event count (not queried at snapshot) | snapshot JSON topic row left blank |
| Golf open-event count at snapshot (broad events list not fully paged) | snapshot JSON topic row left blank |
| Real demo-account portfolio/order data (requires user-owned demo API keys) | Flagged page + Strategies page |
| News causation for price jumps (attribution never asserted) | Alerts carry unverified-context search links only |

## Line-by-line data policy in the running app

- Live tables render values straight from official API responses fetched at view time; each row links the exact request URL.
- Unknown numeric fields render as blank (`—`), never as 0 or a guess (`hydrateMarket` → `null`).
- Resolution results are copied verbatim from the official `result` field; markets without a result are skipped, not guessed (`resolveTick`).
- Simulated fills/fees use documented constants from the official fee schedule; the fee unit test pins the implementation to the official table.
