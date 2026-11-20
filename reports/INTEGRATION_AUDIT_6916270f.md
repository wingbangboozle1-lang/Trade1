# Integration audit — session `6916270f` (final integration, 2026-11-20)

Scope: re-verify the **combined** site (repository root, served by GitHub Pages) line by line
against official Kalshi sources and live demo-API responses, fix defects that hold, and publish.

Everything below was read or fetched on **2026-11-20 UTC**. The sandbox has no direct route to
Kalshi or to `github.io` (egress allow-list is GitHub / npm / PyPI), so live evidence was gathered
with the page fetcher; every request URL is recorded.

---

## 1. Official sources consulted (all read this session)

| # | Source | URL | Used for |
|---|---|---|---|
| S1 | Kalshi API docs — Market Lifecycle | https://docs.kalshi.com/getting_started/market_lifecycle | REST statuses `initialized/active/inactive/closed/determined/disputed/amended/finalized`; status **filter** values `unopened/open/paused/closed/settled`; `result` = `yes|no|scalar` |
| S2 | Kalshi API docs — Fee Rounding | https://docs.kalshi.com/getting_started/fee_rounding | `trade_fee = ceil_6dp(model_fee)`; balance alignment; rounding fee; accumulator/rebate |
| S3 | Kalshi Trading Fees PDF (effective July 7, 2026) | https://kalshi.com/docs/kalshi-fee-schedule.pdf | taker `roundup(M×0.07×C×P×(1−P))`, maker `roundup(M×0.0175×C×P×(1−P))`, General Trading Fees Table, Non-Standard Fees table, "There is no settlement fee." |
| S4 | Kalshi public fee-schedule page | https://kalshi.com/fee-schedule | Non-standard series list; confirms `KXBTCY` / `KXCITRINI` = **no fees**; series added after the PDF |
| S5 | Kalshi API docs — Orderbook Responses | https://docs.kalshi.com/getting_started/orderbook_responses | `orderbook_fp.{yes_dollars,no_dollars}` = `[price_dollars, count_fp]`, ascending, best bid **last**, bids only, `depth` returns the best N levels, reciprocal asks (`$1 − bid`) |
| S6 | Kalshi API docs — Get Trades | https://docs.kalshi.com/api-reference/market/get-trades | params `limit` (max 1000), `cursor`, `ticker`, `min_ts`, `max_ts`, `is_block_trade`; response `trades[].{trade_id,ticker,count_fp,yes_price_dollars,no_price_dollars,taker_*,created_time,is_block_trade}` |
| S7 | Kalshi API docs — Get Market Candlesticks | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | path `/series/{s}/markets/{t}/candlesticks`; `period_interval` ∈ {1, 60, 1440}; ≤5,000 periods |
| S8 | Kalshi API docs — Demo environment | https://docs.kalshi.com/getting_started/demo_env | demo hosts `external-api.demo.kalshi.co` / `demo-api.kalshi.co` |
| S9 | Kalshi API docs — Fixed-Point Representation | https://docs.kalshi.com/getting_started/fixed_point_migration | `_dollars` = 4 dp price strings, `_fp` = 2 dp quantity strings, `price_level_structure` |
| S10 | Kalshi API docs — Quick Start: market data | https://docs.kalshi.com/getting_started/quick_start_market_data | market page URL shape `https://kalshi.com/markets/{series_ticker}` |

## 2. Live demo-API responses fetched this session

| # | Request URL | Result |
|---|---|---|
| L1 | `GET /exchange/status` | 200 — `exchange_active: true`, `trading_active: true`, 4 demo shards |
| L2 | `GET /markets/trades?ticker=KXAAAGASM-26NOV30-3.90&limit=3` | 200 — `trades[]` with `count_fp`, `yes_price_dollars` ("0.7500"), `no_price_dollars`, `created_time` (ISO-8601 Z), `taker_side`, `cursor` present → matches S6 |
| L3 | `GET /series/KXBTCY` | 200 — `fee_multiplier: 1`, `fee_type: "quadratic"`, `settlement_sources[]`, `category: "Crypto"` |
| L4 | `GET /series/KXETHY` | 200 — same shape, `fee_multiplier: 1` |
| L5 | `GET /series/KXELECTIRAN` | 200 — `fee_multiplier: 1`, `category: "Elections"`, 16 settlement sources |
| L6 | `GET /series/KXAAAGASM` | 200 — `fee_multiplier: 1`, `category: "Economics"`, `settlement_sources: [{name: "AAA", url: "https://gasprices.aaa.com/"}]` |
| L7 | `GET /series/KXPGATOUR` | 200 — `fee_multiplier: 1`, `category: "Sports"`, tags `["Golf"]` |
| L8 | `GET /events/KXBTCY-27JAN0100` | 200 — `event.series_ticker`, `event.settlement_sources[]`, `event.markets[]` (per-market `previous_price_dollars`, `price_level_structure`, `notional_value_dollars`) |
| L9 | `GET /markets?status=closed&limit=6` | 200 — statuses `closed` with `result: ""` → **`closed` is not a resolution** (matches S1) |
| L10 | `GET /series/BEYONCEGENRE` | 200 — series exists; `fee_multiplier: 1` |
| L11 | `https://kalshi.com/markets/kxethd` | 200 → redirects to `/markets/kxethd/ethereum-price-abovebelow/kxethd-26nov2016` (series page resolves) |
| L12 | `https://kalshi.com/markets/kxethd-26nov2017-t1779.99` | **404** — a *market* ticker does not resolve to a page |
| L13 | `https://kalshi.com/markets/kxaaagasm` | 200 → `/markets/kxaaagasm/us-gas-price/kxaaagasm-26nov30` |
| L14 | `https://kalshi.com/markets/beyoncegenre` | 200 → `/markets/kxbeyoncegenre/next-beyonce-album-chart/beyoncegenre-30` |

## 3. Fee model — verified against the published table

* The **General Trading Fees Table** in S3 was reproduced row-by-row by `assets/model.js`
  (`fee()`), i.e. `ceil` to the cent of `0.07 × C × P × (1−P)` — 42/42 cells.
  Naive float `Math.ceil(0.07*100*0.5*0.5*100)` yields 176 ¢ where the table says 175 ¢, so the
  engine computes in integer arithmetic (`p4 = P×10⁴`, `c2 = C×10²`).
* Cross-check against **S2** (Fee Rounding): the table's values are exactly
  `trade_fee = ceil_6dp(model_fee)` **plus** the rounding fee that aligns a non-direct member's
  balance to $0.01 (e.g. 100 × $0.45 → model fee $1.7325 → aligned change −$46.74 → total fee
  $1.74, matching the table). The CI ledger (`scripts/portfolio_engine.py`) implements this full
  mechanics; the browser broker implements the table's end result. They agree to the cent.
* **Per-series multipliers** (S3 "Non-Standard Fees" + S4) are now applied: series whose published
  taker multiplier is 0 (`KXBTCY`, `KXETHY`, `KXELECTIRAN`, `KXPAHLAVIHEAD`, `KXCITRINI`,
  `KXDOED`, `KXGAMBLINGREPEAL`, `KXGREENLAND`, `KXIRANDEMOCRACY`, `KXLAYOFFSYINFO`) pay **no taker
  fee**; every other series uses the default M = 1. The transcribed table is published for review at
  `data/fee_schedule_series.json`.

## 4. Defects found in this pass and fixed

| ID | Where | Defect | Evidence | Fix |
|---|---|---|---|---|
| D1 | `assets/app.js` → `checkAlert()` | Alerts were built from the raw polled market, which has no `_topic`, so every live alert lost its topic (no topic pill in the chats, no topic on stored alerts). | code read | alert is built from the merged watch entry, which carries `_topic` |
| D2 | `assets/app.js` → `pollWatch()` | Only `S.list.slice(0, 200)` was ever polled while the watchlist holds up to 400 markets → everything past the 200th ticker kept its first-seen price forever (no alerts, no settlement detection, stale table rows). | code read | every chunk of the watchlist is polled each cycle |
| D3 | `assets/app.js` → settlement detection | Only `finalized`/`settled`/`closed` were treated as resolved; the official lifecycle also has `determined` (settlement timer running) and `amended` (re-determined after a dispute) **with a result set**, so those resolutions were never recorded. | S1 + L9 | `determined` and `amended` with `result ∈ {yes,no}` now count as resolved |
| D4 | `assets/portfolio.js` + `scripts/portfolio_engine.py` | Portfolio rows linked `https://kalshi.com/markets/{market_ticker}` — that shape is a **404** (L12). | L11/L12 | rows now carry the series ticker, confirmed from `GET /events/{event}` (`series_ticker`), and link the series page (L11); the official API record link stays on every row |
| D5 | `README.md` | "period_interval 1 or 60 only" — the API accepts 1, 60 **and 1440**; the chart uses 1 and 60. | S7 (change request R-984-1 from session 984a6765) | wording corrected |
| D6 | `resolved.html` | The page implied it lists every resolved in-scope market; the snapshot stores the newest **200 of 3,213** (`settled_total` 6,000) with no disclosure. | `data/resolved.json` (change request R-984-3) | the cap is stated on the page with the live counts |

## 5. Irregularities (published on the Flagged for Review page, non-blocking)

* **I6 — official sources disagree on the per-series fee multiplier.** The published fee schedule
  (S3/S4) marks `KXBTCY`/`KXETHY` as *no fees*, but the live demo API's
  `GET /series/{ticker}` returns `fee_multiplier: 1` for them (L3, L4). The published schedule is
  used because it is the document that defines the formula; the API field's meaning is not
  documented anywhere in the API reference.
* **I7 — part of the Non-Standard Fees table could not be read.** The PDF's middle pages are
  OCR-garbled (series names and multipliers interleaved) and the public fee-schedule page paginates
  client-side, so those rows are *not* transcribed (listed under `not_transcribed` in
  `data/fee_schedule_series.json`) and fall back to the default multiplier.
* **I8 — maker fees are not modeled** in either broker (paper fills are assumed to be
  immediately matched = taker). Unchanged simplification.
* **I9 — the `previous_price_dollars` swing fallback** remains an assumption about the meaning of
  that field (it is documented as a field, not as a semantic contract).

## 6. Validators run on the merged result

| Check | Command | Result |
|---|---|---|
| Site build + local links | `node tools/build.mjs` | see the completion record below |
| Published-page link/nav | `node scripts/check_links.mjs` | see the completion record below |
| Row/URL coverage | `node scripts/check_site.mjs` | see the completion record below |
| Browser engine (jsdom) | `node tests/engine.test.mjs` | see the completion record below |
| Root engine unit checks | `node tests/root_engine.test.js` | see the completion record below |
| Ledger tests | `node tests/portfolio.test.mjs` | see the completion record below |
| Demo-account suite | `node tests/demo-account.test.mjs` | see the completion record below |
| Offline lib tests | `node scripts/test_lib.mjs` | see the completion record below |
| Fee-table test | `node scripts/test_fees.mjs` | see the completion record below |
| Ledger self-test | `python3 scripts/portfolio_engine.py selftest` | see the completion record below |
