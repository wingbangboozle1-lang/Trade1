# Verification report — session `da11364a` (2026-11-21 UTC)

**Scope.** Independent, line-by-line re-verification of the deployed root site
(`https://wingbangboozle1-lang.github.io/Trade1/`) against official Kalshi documentation, plus the
local validator suite and a GitHub Pages deploy check. This session edited only
`COORDINATION.md` and this report; no site page, data file, or script was changed.

**Base.** branch `arena/da11364a-trade1`, base `main` @ `16376d6` (PR #88).

## 1. Local validator suite (run on this branch, exit 0)

| Check | Command | Result |
|---|---|---|
| Build + site rows + link parity | `npm run check` | `BUILD OK — 18 HTML, 6 JS files validated, 0 broken links`; `check_site.mjs` 435 links / 1,248 rows / 825 resolved / **0 failures**; `check_links.mjs` 16 pages / 403 local + 238 external / **0 failures** |
| Engine / page tests | `npm test` | engine 23/23 · live_fixes 3/3 · live_dash 6/6 · lib ok · model 30 · root_engine 48/48 · model.test 21/21 · portfolio 60/60 · demo-account 89/89 · `test_collect.py` 4/4 — all pass |
| Conflict-marker scan | `grep` over all tracked source/data/doc files | **0** line-anchored `<<<<<<<` / `=======` / `>>>>>>>` markers (the `COORDINATION.md` marker block found at claim time was repaired by session `ab412ad1` via PR #88; this pass confirms the whole tree is clean) |

## 2. Official sources re-read today (2026-11-21 UTC)

| # | Source | URL |
|---|---|---|
| S1 | API Environments and Endpoints | https://docs.kalshi.com/getting_started/api_environments |
| S2 | Get Markets | https://docs.kalshi.com/api-reference/market/get-markets |
| S3 | Orderbook Responses | https://docs.kalshi.com/getting_started/orderbook_responses |
| S4 | Get Market Candlesticks | https://docs.kalshi.com/api-reference/market/get-market-candlesticks |
| S5 | Market Lifecycle | https://docs.kalshi.com/getting_started/market_lifecycle |
| S6 | Quick Start: WebSockets | https://docs.kalshi.com/getting_started/quick_start_websockets |
| S7 | Fee Rounding | https://docs.kalshi.com/getting_started/fee_rounding |
| S8 | Kalshi Fee Schedule (PDF, effective 2026-07-07) | https://kalshi.com/docs/kalshi-fee-schedule.pdf |
| S9 | Live deployed index (GitHub Pages) | https://wingbangboozle1-lang.github.io/Trade1/ |

## 3. Line-by-line verification

| # | Site claim (page / section) | Official source | Result |
|---|---|---|---|
| V1 | Demo REST bases `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2` (also supported) — `data/meta.json`, README, index | S1 | **Verified.** S1 table lists exactly these two demo REST base URLs. |
| V2 | Demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (and `wss://demo-api.kalshi.co/trade-api/ws/v2`) | S1, S6 | **Verified.** Matches both sources; matches the project brief's URLs. |
| V3 | `GET /events?status=open&limit=200` is the discovery call; `limit=1000` rejected | S2 schema + S1 | **Verified (endpoint).** The documented status filter values are `unopened/open/closed/settled` (S2/S5). The `limit=1000 → 400` observation is an empirical run recorded in `data/log.md`; the 200 page size is used. |
| V4 | `GET /markets?tickers=…` returns every matching market in one response with an empty cursor | S2 | **Verified (behaviour).** Official response schema is a single `markets` array + `cursor`; the single-response/empty-cursor behaviour is the documented single-call shape (observed live, `data/log.md`). |
| V5 | `GET /markets/{ticker}/orderbook` → `orderbook_fp.yes_dollars / no_dollars`, each `[price_dollars, count_fp]`, **ascending**, **best bid last** | S3 | **Verified.** S3 states arrays are ascending and the highest (best) bid is the **last** element. |
| V6 | Order book is **bids only**; YES ask ≡ 1 − best NO bid (reciprocal) | S3 | **Verified.** S3 "Why Only Bids?" and the reciprocal table state exactly this. |
| V7 | `depth` query returns the best N levels, still ascending | S3 | **Verified.** |
| V8 | Unknown/empty ticker → `200` with empty arrays (not 404) | S3 | **Verified.** |
| V9 | `GET /series/{s}/markets/{t}/candlesticks?period_interval=1|60` for ≥1h windows | S4 | **Verified.** S4: `period_interval` enum is `1`, `60`, `1440` (minutes); path matches. Site uses 1 and 60. |
| V10 | Market statuses `active`/`finalized`; filter mapping `open→active`, `settled→finalized`; `active→closed` at `close_time` with no event | S5 | **Verified.** S5 status table and filter-mapping table match; implicit `active→closed` at `close_time` with no WebSocket event is stated. |
| V11 | Closed markets are not price-sampled (no phantom alerts after close) | S5 | **Verified.** Consistent with the lifecycle rule; the site gates sampling on `active` + future `close_time`. |
| V12 | WebSocket requires signed `KALSHI-ACCESS-*` headers **at the handshake** → browser dashboard polls REST | S6 | **Verified.** S6 "Required Headers" lists the three signed headers required to open the connection; a browser cannot attach custom handshake headers, so REST polling is the correct choice. |
| V13 | Taker fee `roundup(M × 0.07 × C × P × (1−P))`; no settlement fee; effective 2026-07-07 | S8 | **Verified.** S8 states the formula, "There is no settlement fee", and "Last updated and effective: July 7, 2026". |
| V14 | Fee table rows: $0.10 → 1 contract $0.01 / 100 contracts $0.63; $0.50 → $0.02 / $1.75; $0.90 → $0.01 / $0.63; $0.99 → $0.01 / $0.07 | S8 | **Verified.** All four rows match the General Trading Fees Table exactly. |
| V15 | Non-Standard multipliers: `KXAAAGASM` maker 1 / taker 1; `KXBTCY` and `KXETHY` 0 / 0 | S8 | **Verified.** Matches the Non-Standard Fees table. |
| V16 | Maker fee `roundup(M × 0.0175 × C × P × (1−P))`; maker fees **not modeled** | S8 | **Verified (formula).** S8 gives the maker formula; the site correctly states maker fees are not modeled. |
| V17 | Ledger rounding: `ceil_6dp` trade fee + `$0.01`-aligned balance change + rounding fee (non-direct) | S7 | **Verified.** S7 "Rounding Mechanics" steps 1–3 and the non-direct `$0.01` precision match the ledger description in `methods.html` §8–§9. |
| V18 | `fee_multiplier` is a Series field ("a floating point multiplier applied to the fee calculations"); `fee_type:"quadratic"` | S2 (schema family) / fee-schedule linkage | **Verified (field exists).** The Series schema defines the field; the *linkage* between the API `fee_multiplier` and the schedule's taker `M` is explicitly documented by the site as an inference, and the demo-vs-schedule disagreement for `KXBTCY`/`KXETHY` is published on `flagged.html` (items 6b, 691-1). Not re-inferred here. |
| V19 | Deployed index serves the live dashboard, links, and snapshot status | S9 | **Verified.** The live page fetched and renders the executive summary, dashboard/portfolio/strategy links, and the snapshot status pill. |
| V20 | Sources page lists only official docs/endpoints | sources.html | **Verified.** Every link is `docs.kalshi.com`, `kalshi.com`, a live `external-api.demo.kalshi.co` endpoint, or a repo artifact. |

## 4. Irregularities / findings (logged, not edited — `flagged.html` is owned by open sessions)

- **I-D1 (wording vs schema) — `notional_value_dollars`.** The official Get Markets **schema** documents a
  `notional_value_dollars` field (S2). The site's `methods.html` §2 states "the API publishes contract
  volume but **no per-market dollar-notional field** in demo responses", and the committed sample field
  list (`data/meta.json → market_sample_field_names`) omits it, with 0 occurrences in `data/snapshot.json`.
  **Assessment:** the observation is correct for the *demo market responses captured* (the field is absent),
  but the absolute wording is stronger than the official schema supports. The site's `_est_dollar_volume`
  remains correctly labeled as **computed** (`data/meta.json → notes`), so there is no behavioural defect.
  **Request to the `flagged.html` owner:** qualify the wording (the field exists in the documented schema but
  was absent from the observed demo responses) or add a one-line note. Logged here per the board protocol
  rather than editing `flagged.html` directly.
- **I-D2 (pre-existing, confirmed fixed).** Committed merge-conflict markers in `COORDINATION.md` (found at
  claim time). Repaired by session `ab412ad1` (PR #88); this pass re-scans the whole tree and confirms **0**
  markers remain. No action needed.

## 5. Not verified in this pass (no inference made)

- **Live runtime responses** from `external-api.demo.kalshi.co`. This sandbox has no route to `*.kalshi.co`
  (curl returns `000`). Runtime behaviour was checked against the committed official-response samples
  (`data/samples/`), the validator suite, and the official docs. The live *GitHub Pages* site was fetched
  successfully (S9), but it is a static host and does not prove a live API round-trip. Published as an open
  item on `flagged.html` (AA-8); does not block.
- **Demo-account balance/positions and real order execution** require the owner's demo API key, which was not
  provided. The `demo-account/` layer stays inert without credentials. No credentials were requested or stored.

## 6. Conclusion

All verified claims (V1–V20) match their official Kalshi sources. The local build, site-row source links,
link parity, and the full test suite are green. The deployed GitHub Pages site is live and serves the
dashboard. The only new finding is a wording/schema nuance (I-D1) logged for the `flagged.html` owner; it is
non-blocking and no value was inferred.
