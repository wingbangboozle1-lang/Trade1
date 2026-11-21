# Verification Report — session `31a8a56b` (final independent verification & delivery)

**Date:** 2026-11-21 · **Branch:** `arena/31a8a56b-trade1` (base `main` @ `a15a941`)
**Site under verification:** GitHub Pages root, legacy source `main /` → https://wingbangboozle1-lang.github.io/Trade1/
**Data source:** official Kalshi **demo** Trade API — `https://external-api.demo.kalshi.co/trade-api/v2` (recommended host) and `https://demo-api.kalshi.co/trade-api/v2` (also supported).

## Method

Every claim below was re-checked against the official Kalshi documentation (docs.kalshi.com) read via the page fetcher, and against the live demo endpoints already logged in `data/log.md` and `data/meta.json`. The build sandbox has no route to `*.demo.kalshi.co` (verified by earlier sessions), so live values come from the committed, Actions-verified snapshots — never inferred. Any value that could not be confirmed from an official source is left blank and flagged.

## Official sources verified (all read 2026-11-21)

| # | Official source | What it states (verbatim summary) | Confirmed on the site |
|---|---|---|---|
| V1 | [Demo environment](https://docs.kalshi.com/getting_started/demo_env) | Demo = mock funds; recommended Trade API root `https://external-api.demo.kalshi.co/trade-api/v2`; also-supported host `https://demo-api.kalshi.co/trade-api/v2`; demo prices/behaviour may not reflect production | ✓ Landing + dashboard use the recommended demo root; `data/meta.json` records both bases; demo-is-play-money disclaimer on every page |
| V2 | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) | Demo REST base `external-api.demo.kalshi.co/trade-api/v2` (recommended) / `demo-api.kalshi.co/trade-api/v2`; demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | ✓ Matches `data/meta.json` base; WS host documented on methods/sources |
| V3 | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | REST statuses `initialized, active, inactive, closed, determined, disputed, amended, finalized`; filter `open` matches `active`; filter `settled` matches `finalized`; `result` ∈ {`yes`, `no`, `scalar`}; `finalized` = settlement complete, terminal | ✓ Engine handles `active`/`finalized` (demo vocabulary) plus documented set; resolution tracker records YES/NO + `settlement_ts` |
| V4 | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | Schema: `ticker`, `event_ticker`, `status`, `yes_bid_dollars`, `yes_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`, `no_bid_dollars`, `no_ask_size_fp`, `last_price_dollars`, `volume_fp`, `volume_24h_fp`, `previous_price_dollars`, `result`, `settlement_ts`, `settlement_value_dollars`, `notional_value_dollars`, `price_level_structure`, `price_ranges`, `series_ticker`-derived fields; single-response `tickers` filter | ✓ `data/meta.json` `market_sample_field_names` matches exactly; dashboard polls `GET /markets?tickers=…` |
| V5 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | Path `GET /series/{series_ticker}/markets/{ticker}/candlesticks`; `period_interval` ∈ {1, 60, 1440} minutes; `start_ts`/`end_ts` in seconds; ≤ 5,000 periods; `price.{open,low,high,close,mean,previous,min,max}_dollars`, `volume_fp`, `open_interest_fp` | ✓ Chart uses 1-min and 60-min windows via the series-scoped path; legacy `/markets/{t}/candlesticks` confirmed 404, flagged |
| V6 | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | `GET /markets/{ticker}/orderbook` returns `orderbook_fp.{yes_dollars,no_dollars}` arrays of `[price_dollars, count_fp]` strings, ascending, best bid **last**, bids only; asks derived by the reciprocal rule ($1.00 − X); `depth` query param (1–100); empty arrays for empty books (200, not 404) | ✓ Dashboard order-book ladder shows YES/NO bids + derived asks with contracts-at-each-price; depth bars; asks marked with asterisk |
| V7 | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective 2026-07-07) | Taker `roundup(M × 0.07 × C × P × (1−P))`; maker `roundup(M × 0.0175 × C × P × (1−P))`; no settlement fee; M default 1 unless otherwise indicated; Non-Standard Fees table (KXBTCY/KXETHY M=0; KXAAAGASM M=1; …) | ✓ Paper broker reproduces all 21 table rows × {1,100} contracts exactly (integer-cent arithmetic); non-standard multiplier map in `assets/model.js` + `data/fee_schedule_series.json`; maker fees not modeled (flagged) |
| V8 | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | Trade fee = `ceil_6dp(model fee)`; rounding fee restores balance precision; rebate caps net fee ≥ $0 | ✓ Integer-arithmetic fee with epsilon guard avoids the float bug (`ceil(175.00000000000003)` → $1.76 vs official $1.75); locked by tests |
| V9 | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | WS handshake requires `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP`; public channels (`ticker`, `trade`, `market_lifecycle_v2`) still need an authenticated session; browsers cannot attach signed handshake headers | ✓ Site uses REST polling; WebSocket unusability from a static page is flagged and documented |
| V10 | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | $1 per contract to the winning side; no settlement fee for simple yes/no | ✓ Paper positions settle at $1 per winning contract; no settlement fee in engine |

## Requirement → delivery (line by line)

| Brief requirement | Delivered | Verification |
|---|---|---|
| Executive summary outlining important details | `EXECUTIVE_SUMMARY.md` + `executive-summary.html` | Requirement→delivery table with per-row verification/source |
| Dashboard tracking highest-dollar live events, 5 topics only (gas, elections, culture, crypto, golf) | `dashboard.html` + `topics/*.html` | Ranked by estimated traded dollars (labeled estimate — no official per-market dollar-notional field); topic classifier mirrors `scripts/topics.json` |
| Live alerting on swings ≥ $0.10 either direction | Two scrolling chats on `dashboard.html` | `alertMove()` compares in whole 1/10000-dollar units (float-safe); 45 s per-market cooldown |
| Two chats: all events + model high-ROI filter | "All events" + "Model picks" (ROI screen ≥ 0.45) | ROI score formula documented in `methods.html`; labeled heuristic, not verified alpha |
| Track events until resolved (yes/no) | `resolved.html` + dashboard resolution strip | Official `result` (yes/no) + `settlement_ts`; paper positions settle at $1/winning contract |
| Automate simulated trades / strategies | `trades.html` Strategy Lab | 4 paper strategies (momentum, fade, harvest, breakout) vs live quotes, official taker fee |
| Portfolio performance (paper + demo account) | `portfolio.html` (CI ledger) + `demo-account/` (opt-in) | CI ledger commits `data/portfolio.json` twice hourly; demo account inert without owner keys |
| Categorize trades + strategies by type | `byStrategy()`, `byTopic()` in `assets/model.js` | P&L/win-rate by strategy and topic |
| Interactive price graph (x = time, s/min/h; y = contract price) | Canvas chart, 60 s → 24 h windows | Seconds/minutes via live samples/trade tape; hours via 1-min/60-min candlesticks |
| Liquidity: contracts available at each price | Order-book ladder | `count_fp` contracts at each `price_dollars`; bid-side liquidity computed |
| Jumps annotated with events + links that may have caused them | Chart markers + link strip under chart | Official Kalshi market page + event `settlement_sources` + labeled news-search lead; causality never asserted |
| Suggestions for more live/interactive | `suggestions.html` | Prioritized backlog, each row naming the official endpoint it would use |
| GitHub Pages live site, category subpages, tables with sources | Landing + 5 topic subpages + data/methods/flagged/sources pages | Every committed table row carries the official request URL (`check_site.mjs`: 1,249 rows, 0 failures) |
| Verification line by line, no inference | This report + `flagged.html` | Unconfirmed values left blank and flagged |

## Irregularities

No new irregularities were introduced by this session. All previously published items remain on `flagged.html` and do not block the merge:

- Demo `status: "active"`/`"finalized"` differs from the documented REST set (both spellings handled; flagged).
- `GET /events?limit=1000` is rejected (400); engine pages at 200 (documented max).
- Legacy candlestick path `/markets/{t}/candlesticks` 404s; series-scoped path is the documented one.
- Some demo `settlement_sources` contain template placeholder URLs (shown as-is, never authoritative).
- `KXGAS` exists with zero events on demo; many hourly/daily demo series are thin (genuine exchange state).
- No official per-market dollar-notional field → dollar ranking is a labeled estimate.
- Maker fees not modeled (paper fills assumed immediately matched); for `KXAAAGASM` the published maker multiplier is 1 (non-zero).
- ROI screen weights are documented engineering choices, not verified alpha.
- News attribution links are labeled search leads; causality never claimed.
- WebSocket unusable from a static page → REST polling with documented cache lag.
- Real demo-account portfolio/order tracking requires owner API keys (site never requests them); paper portfolio is local-only.
- Topic matching heuristic; `scripts/topics.json` ↔ `assets/model.js` mirror is a sync hazard (covered by automated mirror test).
- Per-series fee conflict: demo API publishes `fee_multiplier: 1` for KXBTCY/KXETHY while the published schedule lists M=0; the environment-matched demo value wins when the demo has published one; conflict published side by side on `flagged.html` item 6b and `methods.html` §4.

## Validators (run on this branch, 2026-11-21, all exit 0)

- `node tools/build.mjs` → BUILD OK — 18 HTML, 6 JS files validated, 0 broken links
- `node scripts/check_site.mjs` → 18 HTML, 426 links, 1,249 rows, 825 resolved, 0 failures
- `node scripts/check_links.mjs` → 16 published pages, 394 local links, 222 external links, 0 failures
- `npm test` → engine 23/23, live_fixes, lib, test_fees, test_model, root_engine 40/40, model.test.js, portfolio 60/60, demo-account 89/89

## Conclusion

The deployed root site fully implements the brief: five topics only, ≥ $0.10 swing alerting in two scrolling chats, resolution tracking (yes/no), automated paper strategies, portfolio performance, interactive price/liquidity charts with jump annotations, suggestions page, and per-row official source links. Every claim above was checked against an official Kalshi source; nothing was inferred. The site is ready for PR → merge → Pages deployment.
