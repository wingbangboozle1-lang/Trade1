# Verification report — session `6877ec31` (2026-11-21 UTC)

Branch: `arena/6877ec31-trade1` (base `main` @ `a15a941`). Independent line-by-line
re-verification of the deployed root site's factual claims against **official Kalshi sources**,
review of the stale-claim takeover (PR #58), and a repo pass. Every row below links the official
source read for it. Nothing is inferred: a claim that cannot be confirmed from an official source
is left blank and flagged (none needed blanking in this pass — see §5 for the flagged set that
remains published on `flagged.html`).

The build sandbox has no route to `*.kalshi.co` (egress allowlist; verified again this session,
`curl` → TLS reset), so official pages were read through the page fetcher, as in every prior
session. The site itself fetches the demo API **live in the user's browser** (CORS verified by a
GitHub-runner probe, `data/cors.json`).

## 1. Official sources re-read this session (2026-11-21) and the claims they settle

| # | Claim as published on the site | Official source (read 2026-11-21) | Result |
|---|---|---|---|
| V1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2`, also-supported `https://demo-api.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, also `wss://demo-api.kalshi.co/trade-api/ws/v2`; demo = mock funds, not production | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) — "Demo's recommended Trade API root is `https://external-api.demo.kalshi.co/trade-api/v2`", table row for REST/WebSocket surfaces; "demo environment with mock funds", "price and behavior of markets in the demo environment may not be reflective of those in real markets" | **Verified.** The brief's endpoint URLs match the official table exactly. |
| V2 | Taker fee `roundup(M × 0.07 × C × P × (1−P))`; maker `roundup(M × 0.0175 × C × P × (1−P))`; `M` default 1 (taker) / 0 (maker); **no settlement fee**; effective 2026-07-07 | [Kalshi fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) — formula block ("fees = roundup(M x 0.07 x C x P x (1-P))", "M = the multiplier for each contract (default is 1 unless otherwise indicated)"), Maker Fees block, "There is no settlement fee.", "Last updated and effective: July 7, 2026" | **Verified** verbatim (both chunks of the PDF read). |
| V3 | The paper fee reproduces the General Trading Fees Table exactly (e.g. 100 contracts @ $0.50 → **$1.75**) | Same PDF — "General Trading Fees Table", row `$0.50 | $0.02 | $50.00 | $1.75` (all 21 rows read) | **Verified.** `scripts/test_fees.mjs` and `tests/model.test.js` pin all 21 × {1, 100} cells; suites pass this session. |
| V4 | Per-series taker multipliers: `KXBTCY`, `KXETHY`, `KXCITRINI`, `KXDOED`, `KXELECTIRAN`, `KXGAMBLINGREPEAL`, `KXGREENLAND`, `KXIRANDEMOCRACY`, `KXLAYOFFSYINFO`, `KXPAHLAVIHEAD` = M 0 ("no fees"); `KXAAAGASM`, `KXPGATOUR`, `KXPGARYDER`, `KXPGASOLHEIM`, `KXEMMY*`, `KXFED*`, `KXCPI*` etc. = M 1 | Same PDF — "Non-Standard Fees" table (both chunks) | **Verified row by row** against `data/fee_schedule_series.json` (see §2). |
| V5 | Trade fee rounding: `trade_fee = ceil_6dp(model_fee)`, then `aligned_change = floor_precision(revenue − trade_fee)`, rounding fee + accumulator + rebate; non-direct members aligned to `$0.01` | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) — "Compute `trade_fee = ceil_6dp(model_fee)`", "Non-direct member balances are aligned to `$0.01`", worked example `-$0.055000`/`$0.00363825` → trade fee `$0.003639`, rounding fee `$0.001361` | **Verified.** `scripts/portfolio_engine.py` implements this mechanics (selftest pins the worked example). |
| V6 | Candlesticks at `/series/{series_ticker}/markets/{ticker}/candlesticks`, `period_interval` ∈ {1, 60, 1440} minutes; `start_ts`/`end_ts` in seconds; fields `price.*_dollars`, `yes_bid/yes_ask.*_dollars`, `volume_fp`, `open_interest_fp`, `end_period_ts` | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) — "Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day)"; response schema | **Verified.** (The old README "1 or 60 only" defect is fixed on `main`; re-checked line 37 this session.) |
| V7 | `GET /series/{ticker}` publishes `fee_type` and `fee_multiplier`; the demo returns `fee_multiplier: 1` even for schedule "no fees" series | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) — response schema shows `fee_type: "quadratic"` and `fee_multiplier`; demo probes recorded in `data/log.md` and prior reports | **Verified** (schema fields). Whether `fee_multiplier` equals the schedule's taker `M` is **not stated** — remains flagged (6b/691-1). |
| V8 | Market statuses `initialized → active → closed → determined/amended → finalized`; filter `open`→`active`, `settled`→`finalized`; `result` ∈ {yes, no, scalar}; `settlement_ts` populated at `finalized` | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) — status table, filter-mapping table, "the market is determined and `result` is set to `yes`, `no`, or `scalar`", "settled markets end up at `finalized` … `settlement_ts` is populated" | **Verified.** The resolved tracker's `determined`/`amended` handling and the earlier B6 corrections are correct. |
| V9 | Event/market record fields used by the site: `yes_bid_dollars`, `yes_bid_size_fp`, `volume_fp`, `volume_24h_fp`, `last_price_dollars`, `previous_price_dollars`, `settlement_value_dollars`, `settlement_ts`, `price_ranges`, `settlement_sources`, `result` | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) — 200 response schema (market object) | **Verified** — every field the engine reads exists in the official schema. |
| V10 | Fee-schedule transcription source pages | [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (both chunks), [public fee-schedule page](https://kalshi.com/fee-schedule) (per-row `seen_in` provenance recorded 2026-11-20 by session `6916270f`) | PDF rows **verified this session** (§2). Page-only rows (`KXAOMENSINGLES`, `KXBTCMAX125`, `KXBUNDESLIGA`, `KXBUNDESLIGAGAME`) carry `seen_in: fee-schedule-page` provenance and were read from the official page on 2026-11-20; not re-fetched today (the page paginates client-side). |

Corroborated from prior sessions' linked reports (not re-fetched today, quotes and live probes
recorded there): orderbook shape — bids only, `[price, count]` ascending with best bid **last**,
reciprocal asks, `depth` 1–100 ([Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook),
[Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses),
`reports/VERIFICATION_984a6765.md` C19); trade tape
([Get Trades](https://docs.kalshi.com/api-reference/market/get-trades)); settlement pays
`settlement_value_dollars` per winning contract
([Market Settlement](https://docs.kalshi.com/getting_started/market_settlement)); WebSocket
handshake requires `KALSHI-ACCESS-*` headers
([Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets));
rate limits / 429 backoff
([Rate Limits](https://docs.kalshi.com/getting_started/rate_limits));
`kalshi.com/markets/{series_ticker}` is the resolving market-page pattern
([Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data)).

## 2. `data/fee_schedule_series.json` vs the official PDF — line-by-line audit

All 34 PDF-legible rows checked against the transcription (maker/taker): every value matches
exactly (`KXAAAGASM` 1/1 … `KXWTAMATCH` 1/1; ten "no fees" rows 0/0). The ten M-0 rows in the
transcription equal exactly the ten M-0 rows in `assets/model.js → NONSTANDARD_TAKER_MULTIPLIER`
and the engine tests pin them. The OCR-garbled middle block (KXMLB* / KXNBA* / KXNFL* / KXMVE /
KXMEANRWMAODRLDCUP …) is listed under `not_transcribed` and treated as default M = 1 — consistent
with "never infer" (flagged for manual review).

**N2 (note for review, no behavioral impact):** the PDF row `KXMARMAD — "College Basketball
Champion" — 1/1` is legible in the OCR text but sits inside the garbled block and is listed under
`not_transcribed`. Treating it as default M = 1 yields the same multiplier as the legible row, so
no fee computation changes; the row can be moved to the transcribed table on manual review.

## 3. Stale-claim takeover — PR #58 (session `6916270f`) verified and completed

PR #58 ("portfolio: link each ledger row to its own official market record", last commit
2026-11-20 20:50 UTC, > 60 min stale with no commits) was taken over per the board's takeover
rule, merged into this branch, and re-verified line by line:

- `scripts/portfolio_engine.py → api_market_url()` builds `{BASE}/markets/{ticker}` from the
  documented [Get Market](https://docs.kalshi.com/api-reference/market/get-market) record path;
  `enter()`, exits, alerts and resolutions now store it. `BASE` is the officially documented demo
  root (V1).
- Docs reconciliation (fee-policy 3-rule order) matches the engines' actual code (V4, V7) and the
  merged `flagged.html` rows 6b/691-1.
- **Completion added by this session (N1):** the takeover's `or`-fallback kept *old* ledger rows
  on their stored batch `?tickers=…` fetch URLs (all rows shared one long URL). The artifact
  projection now always publishes **each row's own market record** as `source`
  (`trade_public` / `alert_public` / resolution projection), while the state file keeps the
  historical fetch provenance. `data/portfolio.json` was re-projected from the committed
  `data/portfolio_state.json` (no cycle, no invented values) and all 11 trades + 29 alerts now
  end in `/markets/{their-ticker}`. This matches the brief's "every table row must have a source
  link to an official site" in its strictest reading and is durable across CI regenerations.

## 4. Repo pass — validators (all run 2026-11-21 after the changes)

| Check | Result |
|---|---|
| `python3 scripts/portfolio_engine.py selftest` | 68/68 |
| `npm test` | engine 23/23 · live-fixes 3/3 · lib passed · model 20 · fees 50 · model.test 21 · portfolio 60/60 · demo-account 89/89 |
| `node tools/build.mjs` | BUILD OK — 18 HTML, 6 JS, 0 broken links |
| `node scripts/check_site.mjs` | 18 HTML, 426 links, 1,249 rows, 825 resolved, **0 failures** (every snapshot/resolved row has an on-base `source_url`) |
| `node scripts/check_links.mjs` | 16 pages, 394 local + 222 external links, 0 failures |
| `node tools/render_test.mjs` | all published pages render with 0 JS errors |

## 5. Irregularities found or restated by this session

| # | Item | Status |
|---|---|---|
| N1 | Pre-takeover ledger rows shared one giant batch URL as `source`; old rows would have kept it forever | **Fixed here** (§3) |
| N2 | `KXMARMAD` (legible 1/1) sits in `not_transcribed` | Flagged for review (§2); no behavioral impact |
| N3 | `EXECUTIVE_SUMMARY.md` portfolio row still described only the localStorage lab | **Fixed here** — three disclosed layers named |
| 6b / 691-1 | Demo `fee_multiplier` vs published schedule disagree for the ten M-0 series; `fee_multiplier == taker M` is an inference | **Open by design** — both sources published side by side ([flagged.html](../flagged.html)) |
| I7 | News-search links around jumps are "leads", not official sources; causality never asserted | Open (labelled on the site) |
| 9d-1 (D1) | Settled-market topic fallback mis-files rows (e.g. natural gas → gas-prices) | **Claimed by live session `c96a21b7`, PR #64** — not touched here |
| 9d-5 | Demo-account tracking/execution needs the owner's demo API key | Blocked on owner input; inert by design; never faked |

## 6. Manual-review links (official)

- Demo environment: https://docs.kalshi.com/getting_started/demo_env
- API environments: https://docs.kalshi.com/getting_started/api_environments
- Fee schedule (PDF): https://kalshi.com/docs/kalshi-fee-schedule.pdf · page: https://kalshi.com/fee-schedule
- Fee rounding: https://docs.kalshi.com/getting_started/fee_rounding
- Get Events: https://docs.kalshi.com/api-reference/events/get-events
- Get Markets / Get Market: https://docs.kalshi.com/api-reference/market/get-markets · https://docs.kalshi.com/api-reference/market/get-market
- Get Market Orderbook: https://docs.kalshi.com/api-reference/market/get-market-orderbook
- Get Market Candlesticks: https://docs.kalshi.com/api-reference/market/get-market-candlesticks
- Get Series: https://docs.kalshi.com/api-reference/market/get-series
- Market lifecycle: https://docs.kalshi.com/getting_started/market_lifecycle
- Market settlement: https://docs.kalshi.com/getting_started/market_settlement
- Docs index: https://docs.kalshi.com/llms.txt
