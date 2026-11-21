# Verification record — session `155329c7` (2026-11-21 UTC)

Scope: line-by-line re-verification of the published root site against the official Kalshi documentation, plus
requirements coverage for the brief. Every claim below quotes the official page it came from and names the file in
this repository that implements it.

Environment caveat, stated up front: **this build sandbox has no network route to Kalshi.** `curl` to
`external-api.demo.kalshi.co`, `api.elections.kalshi.com`, `docs.kalshi.com` and the GitHub Pages site returns `000`.
Documentation pages were read through the environment's page fetcher; live API behaviour is evidenced by the Actions
collector log and its committed response samples, not by a direct observation here (flagged as 155329c7-4).

---

## 1. Endpoints

| Claim in the site | Official source (read 2026-11-21) | Quote / observed value | Implemented in | Result |
|---|---|---|---|---|
| Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | "Demo · `https://external-api.demo.kalshi.co/trade-api/v2` · Also supported `https://demo-api.kalshi.co/trade-api/v2`" | `assets/lib.mjs` `API_BASES.demo`; `assets/app.js` `CFG.bases`; `scripts/collect.py` `BASE`/`ALT` | matches |
| Demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | same | "Demo · `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` · Also supported `wss://demo-api.kalshi.co/trade-api/ws/v2`" | recorded on `sources.html`; not used by the page | matches |
| A browser page cannot open the WebSocket | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | "When establishing the WebSocket connection, include these headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP`" | `flagged.html` #13, #19; `suggestions.html` (bridge proposal) | matches |
| Demo prices are not production prices | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | "The price and behavior of markets in the demo environment may not be reflective of those in real markets." | every page footer / header notice | matches |

## 2. Market data the dashboard reads

| Field / endpoint | Official source | Quote | Implemented in | Result |
|---|---|---|---|---|
| `GET /markets` price/volume fields | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | schema lists `yes_bid_dollars`, `yes_bid_size_fp`, `yes_ask_dollars`, `yes_ask_size_fp`, `no_bid_dollars`, `no_ask_dollars`, `last_price_dollars`, `previous_price_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `status`, `close_time` | `assets/app.js` `tableRow()`, `rowsFor()`, `checkAlert()` | matches |
| No traded-**dollar** field exists | same | none of the schema fields is a dollar notional (all volume fields are contracts) | ranking is computed and labelled an estimate (`flagged.html` #5, 155329c7-5) | matches |
| `status` filter values | same + [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | filter values `unopened`, `open`, `paused`, `closed`, `settled`; lifecycle statuses `initialized`, `active`, `inactive`, `closed`, `determined`, `disputed`, `amended`, `finalized` | `scripts/collect.py`; `assets/model.js` `isTradeable()` | matches |
| Closed means no new orders | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | "`active`/`inactive` → `closed`: when `close_time` passes." · "Once `close_time` passes, all order operations … are rejected with `MARKET_INACTIVE`." | `assets/model.js` `isTradeable()` guards every paper entry (AA-1) | matches |
| Settled = `finalized`, `result` is yes/no | same | "In REST, settled markets end up at `finalized` … and `settlement_ts` is populated." · "`result` is set to `yes`, `no`, or `scalar`." | `resolved.html`; `scripts/collect.py`; `check_site.mjs` enforces `result ∈ {yes,no}` | matches |
| `GET /events` limit | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) | "Defaults to 200. Maximum value is 200." | `assets/app.js` `CFG.eventsLimit = 200` | matches |
| `GET /markets?tickers=` batch read | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | "When `event_ticker` or `tickers` is the only filter … every matching market is returned in one response"; also "Responses are cached for a short time … can lag the exchange by several seconds" | `pollWatch()` batches 200 tickers; latency is disclosed in the page footer | matches |
| Settled sweep uses a documented filter combination | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) `.md` | "`min_settled_ts`, `max_settled_ts` · compatible status `settled`" | `scripts/collect.py` settled sweep; `resolved.html` `LIVE_URL` | matches |
| Order book shape | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | "`orderbook_fp` … `yes_dollars` … `no_dollars` … `[price_dollars, count_fp]`" · "sorted by price in ascending order" · "the highest bid (best bid) is the last element" · "Kalshi's orderbook only returns bids, not asks" · "A YES BID at price X is equivalent to a NO ASK at ($1.00 − X)" | `assets/app.js` `bookViews()` derives asks by the reciprocal rule and reverses the ladder | matches |
| Candlestick intervals | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | "Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day)." | `WINDOWS` uses 1 and 60 | matches |
| Trade tape fields | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) | `yes_price_dollars`, `created_time`, `min_ts`, `max_ts`, `limit` ≤ 1000 | `fetchTrades()` | matches |
| Series fee fields | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) | `fee_type`, `fee_multiplier`, `settlement_sources` all on the Series schema | `assets/model.js` `noteSeriesFee()`, `takerMultiplier()` | matches |

## 3. Fees

| Claim | Official source | Quote | Implemented in | Result |
|---|---|---|---|---|
| Taker fee formula | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective July 7, 2026) | `fees = roundup(M × 0.07 × C × P × (1−P))`, "M = the multiplier for each contract (default is 1 …)" | `assets/model.js` `feeWithM()`; `scripts/portfolio_engine.py` | matches |
| Maker fee formula (not modelled) | same | `fees = roundup(M × 0.0175 × C × P × (1−P))` | not charged; published as #6, E3, 691-10 | matches (limitation disclosed) |
| 100 contracts at $0.50 costs $1.75 | same, general table | "$0.50 | $0.02 | $50.00 | $1.75" | pinned by `scripts/test_fees.mjs` | matches |
| Per-series multipliers | same, Non-Standard Fees | `KXAAAGASM 1/1`, `KXBTCY 0/0`, `KXETHY 0/0`, `KXELECTIRAN 0/0`, … | `data/fee_schedule_series.json`; rows that could not be read are listed as `not_transcribed` and default to M = 1 | matches |
| Fee rounding / balance alignment | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | "`trade_fee = ceil_6dp(model_fee)`" · "Direct member balances are aligned to `$0.0001` … Non-direct member balances are aligned to `$0.01`" | `scripts/portfolio_engine.py` `rounding` model; selftest pins the worked example | matches |
| Settlement pays $1 per winning contract | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | "Yes outcome: Yes contract holders receive $1 per contract" | `assets/model.js` `settle()`; portfolio engine | matches |

## 4. The defect found by this session

Reproduced from repository files before the fix:

1. `data/log.md`, run starting `06:58:35Z`: request lines are stamped `06:58:35Z` (17), `06:58:36Z` (125) and
   `06:58:37Z` (153) — about 295 requests in three seconds from one client.
2. The same log contains **220** lines with `-> 429` and body
   `{"error":{"code":"too_many_requests","message":"too many requests"}}`.
3. `scripts/collect.py` `get()` had no retry and no pacing, and `paged()` breaks on the first non-200, so the settled
   sweep's very first 429 ended it: `- 06:58:37Z GET …/markets?status=settled&min_settled_ts=… -> 429` followed by
   `settled markets collected (last 3 days): 0`.
4. This was a **regression from a working state**, not a long-standing empty file. `git log --follow data/resolved.json`
   shows 200 in-scope rows with `settled_total: 6000` in every run from `39b6815` (2026-11-20T13:19Z) through
   `f3037f3` (2026-11-21T04:03Z); the drop to 0 rows is commit `b08da8b` (2026-11-21T06:58Z) — the rate-limited run.
   The same starvation left `data/topics/*.json` nearly empty in that commit (33 markets total).
5. Because the settled sweep is the last data stage, a client that is throttled early never reaches it — so the zero
   was doubly misleading. `scripts/collect.py` now records `series_stage_verified_points` (200s obtained before the
   sweep) and `requests_attempted` so a reader can tell "the exchange settled nothing" from "we never got to ask".
6. `data/resolved.json` therefore held `settled_total: 0`, `markets: []` — and `resolved.html` printed
   "No resolved markets in the snapshot." and returned **before** `loadScope()`/`pollLive()`, so the one page dedicated
   to resolution tracking never contacted the API.

Official basis for the fix: [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) — "A
rate-limited request returns `429 Too Many Requests`" and "Unauthenticated public requests are subject to separate
limits. Authenticate requests where supported and back off on `429`."

Fix, and how it is gated:

| Change | File | Gate |
|---|---|---|
| Pacing (`COLLECT_MIN_INTERVAL_S`, default 0.5 s) between requests | `scripts/collect.py` `_pace()` | `tests/test_collect.py` |
| 429 retry with exponential backoff, `Retry-After` honoured, every wait logged | `scripts/collect.py` `get()`, `_sleep_logged()` | `tests/test_collect.py` (retry, Retry-After, give-up recorded) |
| `request_complete` / `retry_gave_up` / `settled_total_note` written to `resolved.json`; throttle counters in `meta.json` | `scripts/collect.py` | `tests/test_collect.py` (complete vs failed sweep) |
| Empty/incomplete snapshot no longer short-circuits the live sweep; explicit live-sweep states; provenance badge | `resolved.html` | `tools/render_test.mjs --offline resolved.html` (no JS errors; notice renders) |
| Committed snapshot marked incomplete with the 429 evidence, no value invented | `data/resolved.json` | `scripts/check_site.mjs` |

## 5. Pre-launch path from this sandbox, verified as far as the environment allows

| Check | How | Result |
|---|---|---|
| Official docs reachable | page fetcher, 15 pages read | **yes** — quotes in §1–§3 |
| Demo API reachable from the sandbox | `curl` | **no** — `000` (flagged 155329c7-4) |
| Demo API reachable from a GitHub runner | `data/cors.json`, `data/log.md` (2026-11-21 06:58Z) | **yes** — HTTP 200, and `access-control-allow-origin` echoes `https://wingbangboozle1-lang.github.io` |
| Browser may call the demo API from this site's origin | same probe + [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) note that these endpoints need no auth | **yes** |
| Committed data renders offline | `tools/render_test.mjs --offline` over all 19 published pages | to be re-run at the end of this session (results in `COORDINATION.md`) |
| Every row has an official source URL | `scripts/check_site.mjs` | 0 failures |
| No broken local link, no non-official external host | `scripts/check_links.mjs` | 0 failures |

## 6. Requirements coverage

Every line of the brief, with its status and evidence, is published as
[`coverage.html`](../coverage.html) (linked from every page). Five requirement lines are delivered only with a stated
limit — the WebSocket, the dollar ranking, the ROI screen, the resolved snapshot's live confirmation, and real demo
order execution — and each limit names its cause and its official source there.

## 7. What this session did NOT verify (no inference made)

- Live prices, latency, or CORS behaviour observed from this sandbox (no route).
- Whether the demo exchange currently has settled in-scope markets: the committed snapshot is incomplete and this
  sandbox cannot query the API. The next scheduled `pages.yml` run must answer it (155329c7-2).
- Predictive value of the ROI score. It remains a heuristic screen (flagged #8, AA-6, F7).
