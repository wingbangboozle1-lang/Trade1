# Verification log — session `9ff00ee3` (2026-11-20)

Line-by-line re-verification of the deployed root site against official Kalshi sources,
one defect found + fixed, reconciliation with sessions that landed PRs #46–#57 while this
session worked, and final validators.

Method: official docs read via page-fetch (`docs.kalshi.com` …), live demo probes against
`https://external-api.demo.kalshi.co/trade-api/v2` (page-fetch; bash egress is blocked in
this sandbox), the official fee-schedule PDF, and the repo's own validators. Nothing below
is inferred: every row links the source actually read.

## 1. Site claims re-verified this session (all held)

| # | Site claim (where) | Official source (read this session) | Result |
|---|---|---|---|
| 1 | Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2`, alt `demo-api.kalshi.co`; demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (header of `assets/app.js`, Methods) | [API Environments](https://docs.kalshi.com/getting_started/api_environments) | ✅ matches, incl. sign-path-without-query-string note |
| 2 | Live demo is open: `exchange_active: true`, `trading_active: true`, 4 shards (dashboard status strip) | live `GET /trade-api/v2/exchange/status` | ✅ `exchange_active:true`, `trading_active:true`, shards 0–3 |
| 3 | Events discovery pages at `limit=200` (`CFG.eventsLimit`) | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) | ✅ `limit` maximum 200, default 200; `status` enum `unopened\|open\|closed\|settled`; `cursor`; `with_nested_markets` |
| 4 | Status handling `active`/`finalized` + filter mapping `open→active`, `settled→finalized` (flag #1) | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | ✅ REST statuses `initialized\|active\|inactive\|closed\|determined\|disputed\|amended\|finalized` documented; filter mapping documented |
| 5 | Candlesticks path `/series/{series_ticker}/markets/{ticker}/candlesticks`, `period_interval ∈ {1,60,1440}`, ≤ 5,000 periods/request, timestamps in seconds (chart windows) | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | ✅ path + intervals + cap + seconds all match |
| 6 | Order book: `orderbook_fp.{yes,no}_dollars` = `[price_dollars, count_fp]` ascending, best bid **last**, bids only + reciprocal asks, `?depth=` (1–100), unknown ticker → 200 with empty arrays (depth panel) | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | ✅ all five behaviors match |
| 7 | Fee model `roundup(M × 0.07 × C × P × (1−P))`, M default 1; maker `0.0175` formula; no settlement fee (Strategy Lab, Methods §4, `assets/model.js`) | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective 2026-07-07), both pages read | ✅ formulas verbatim; General Trading Fees Table rows reproduced by tests (21 prices × 1 & 100 contracts) |
| 8 | Trade fee rounding `ceil_6dp(model fee)` + $0.01 balance alignment + rounding-fee accumulator (CI ledger) | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | ✅ matches the ledger's implementation (worked example asserted in selftest) |
| 9 | Trades tape `GET /markets/trades`, `limit` 1–1000 default 100, cursor pagination, `yes_price_dollars`/`count_fp`, `min_ts`/`max_ts` in seconds (chart seconds-window) | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) | ✅ matches |
| 10 | Settlement pays $1 per winning contract, $0 losing, **no settlement fee** (broker `settle()`) | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | ✅ matches |
| 11 | Prices `_dollars` ≤ 4 dp, counts `_fp` ≤ 2 dp; `price_ranges` is the tick-grid source of truth (fixed-point comments) | [Fixed Point Migration](https://docs.kalshi.com/getting_started/fixed_point_migration) | ✅ matches |
| 12 | Per-series fee structure: demo `GET /series/{ticker}` publishes `fee_type` + `fee_multiplier` (Methods §4 table) | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) + live probes (below) | ✅ field is **required** in the official schema: “FeeMultiplier is a floating point multiplier applied to the fee calculations”; `fee_type: quadratic` “described by the General Trading Fees Table” |

### Live demo probes backing §1.12 (2026-11-20, via page-fetch)

| Endpoint | `fee_type` | `fee_multiplier` |
|---|---|---|
| [`/series/KXBTCY`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTCY) | quadratic | **1** |
| [`/series/KXETHY`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHY) | quadratic | **1** |
| [`/series/KXAAAGASM`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM) | quadratic | 1 |
| [`/series/KXPGATOUR`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGATOUR) | quadratic | 1 |
| [`/series?category=Crypto`](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Crypto&include_volume=true&limit=3) (list items) | quadratic | 1 (all items) |
| [`/series?category=Sports&tags=Golf`](https://external-api.demo.kalshi.co/trade-api/v2/series?category=Sports&tags=Golf&include_volume=true&limit=5) (list items) | quadratic | 1 (all items) |

The production fee schedule's **Non-Standard Fees** table (PDF, read both pages this session)
lists taker **M = 0** for `KXBTCY`/`KXETHY` (and `KXELECTIRAN`, `KXPAHLAVIHEAD`, `KXCITRINI`,
`KXDOED`, `KXGAMBLINGREPEAL`, `KXGREENLAND`, `KXIRANDEMOCRACY`, `KXLAYOFFSYINFO`), and taker
M = 1 for `KXAAAGASM`, `KXPGATOUR`, `KXPGARYDER*`, `KXEMMY*`, `KXFED*` — i.e. **two official
sources disagree for some series** (demo API vs production schedule). Published on
`flagged.html` items **6b** and **691-1**; not resolved by inference.

## 2. Defect found and fixed (logged on the board before editing)

Both paper engines applied a flat `M = 1` while two official sources publish per-series values:

- `assets/model.js` + `assets/app.js`: now resolve M in documented order —
  **(1)** the demo API's `fee_multiplier` when a Series record has been seen (runtime cache
  `state.seriesFees`, ingested free of charge from the Series objects `discoverSeries()`
  already fetches, plus one deduped, capped `GET /series/{s}` per event-path series);
  **(2)** the published schedule's Non-Standard table (session 6916270f's transcription,
  `data/fee_schedule_series.json`); **(3)** documented default 1. Trades record the M used
  at entry (`feeMul`/`fee_m`); exits replay it, so a later cache change cannot rewrite an
  existing trade. A record without a numeric `fee_multiplier` is never inferred.
- `scripts/portfolio_engine.py`: `fetch_series_fees()` caches `fee_multiplier` for the
  watchlist's series each live run (cap 40, persisted in `data/portfolio_state.json`);
  `series_multiplier()` = same three-rule order; `taker_fee(..., series=, multiplier=)`
  keeps both sessions' signatures.
- Docs: `flagged.html` 6b/691-1 (conflict + precedence + correction of the claim that “the
  API reference does not define `fee_multiplier`” — the Get Series schema does define it;
  what is *not* stated is the explicit equivalence `fee_multiplier == schedule taker M`,
  which stays flagged **open**), `methods.html` §2/§4/§9, Strategy Lab copy.

Nothing from any other session was discarded: their static table remains rule (2), their
transcription file remains the review artifact, and both sessions' test suites pass.

## 3. Reconciliation with PRs #46–#57 (landed while this session worked)

`origin/main` advanced three times during the session; each time was merged into
`arena/9ff00ee3-trade1` with union resolution:

| Merge | Main content | Conflicts resolved |
|---|---|---|
| `fc2f7ec` | PRs #46–#55 (984a6765, d6489a30, a53ab816, 9d4380a2, 6916270f incl. take-over of stale PR #35's content) | `assets/model.js` (both fee models → three-rule order), `scripts/portfolio_engine.py` (both signatures → union), `flagged.html` (my 6b + their 6c), `methods.html` (bullet union), `COORDINATION.md` (my section + their records, both kept in full), `tools/build-report.json` |
| `…` (PR #56) | fee-wording consistency pass | `flagged.html` 6b (their rewrite kept, corrected per §1.12 + precedence), `methods.html` §4 (their side-by-side table kept, decision sentence corrected), `build-report` |
| `…` (PR #57) | resolved-page live-refresh fix | `build-report` only |

**PR dispositions:** #32 (`777927dd`) and #35 (`b93ba12e`) were **closed by session
`6916270f`** at 20:13Z after its take-over (their content landed on main via PR #55) —
observed by this session, nothing left to take over; branches untouched.
All merge conflicts above were resolved without discarding either side's work.

## 4. Validators (on the final merge commit, re-run before PR)

| Check | Result |
|---|---|
| `npm test` (engine 23, live_fixes 3, lib, test_fees 42 rows + 10 multipliers, test_model 20, root_engine 50, model.test 21, portfolio 60, demo-account 89) | **exit 0** |
| `npm run check` — build + `check_site` + `check_links` | **exit 0**: BUILD OK (18 HTML, 6 JS, 0 broken links); 426 links / 1,250 rows / 825 resolved, **0 failures**; 16 published pages, 394 local + 222 external links, **0 failures** |
| `python3 scripts/portfolio_engine.py selftest` | **68/68** |
| `node tools/render_test.mjs` | 16 pages, 0 JS errors |

## 5. Open items carried forward (non-blocking, published on `flagged.html`)

- **6b / 691-1**: demo `fee_multiplier=1` vs production schedule `M=0` for KXBTCY/KXETHY et al.;
  precedence stated; explicit `fee_multiplier == taker M` equivalence not stated in docs → open.
- **6c**: two fee-rounding models (lab cent-ceil vs ledger ceil_6dp+alignment) by design.
- E-series (prior sessions): maker fees unmodeled (non-zero for KXAAAGASM), dollar-volume
  ranking is an estimate, WS unused (signed handshake), unauthenticated rate limits undocumented.
