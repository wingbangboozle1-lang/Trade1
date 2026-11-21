# VERIFICATION_3193963b — final integration pass: official-source + live demo-API verification

- **Session:** `arena/3193963b-trade1` (branch base `main` @ `5eb88d0`, claim on the board above)
- **Date of verification:** 2026-11-21 (UTC), approx. 07:20–07:35 UTC
- **Method:** every claim below was checked **today** against (a) the official Kalshi docs at
  `docs.kalshi.com`, or (b) a live response from the official demo Trade API at
  `https://external-api.demo.kalshi.co/trade-api/v2` (the host the official docs recommend for
  demo: [API Environments](https://docs.kalshi.com/getting_started/api_environments)).
  Exact request URLs are given for **manual re-checks**. Nothing in this report is inferred:
  where a value could not be confirmed from an official source it is left blank and flagged as
  **unverified**. The build sandbox itself has no route to `*.kalshi.co` (TLS reset, curl `000`);
  live responses were read through the Arena page fetcher, which is a direct HTTP GET of the exact
  URL shown — no rewriting.

---

## 1. Sources consulted (official, all fetched 2026-11-21 UTC)

| # | Source (official) | What it verifies |
|---|---|---|
| S1 | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) | Demo REST `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2` (also supported); demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2`; credentials are per-environment; signed path excludes host and query string |
| S2 | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | Statuses `initialized / active / inactive / closed / determined / disputed / amended / finalized`; filter mapping `open`→`active`, `settled`→`finalized`; `result` set to `yes`, `no`, or `scalar`; settled markets end at `finalized` with `settlement_ts` populated; `GET /events?status=` matches **child-market** statuses (use `with_nested_markets=true` for per-market status) |
| S3 | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | `orderbook_fp` with `yes_dollars` / `no_dollars`, each bid `[price_dollars, count_fp]` as strings; arrays **ascending**, best bid = **last** element; bids only — asks are implied by YES↔NO reciprocity (YES ask = $1.00 − best NO bid); `depth` query parameter supported; empty book = empty arrays with HTTP 200 |
| S4 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | Path `/series/{series_ticker}/markets/{ticker}/candlesticks`; `start_ts`/`end_ts` required; `period_interval` ∈ {1, 60, 1440} minutes; response fields `price.*_dollars`, `yes_bid`, `yes_ask`, `volume_fp`, `open_interest_fp`; markets settled before the historical cutoff only via `GET /historical/markets/{ticker}/candlesticks` |
| S5 | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | Trade fee = model fee rounded **up** to `$0.000001` (`ceil_6dp`); rounding fee restores target balance precision (`$0.0001` direct / `$0.01` non-direct); rebate of accumulated rounding, capped so net fee ≥ $0; worked example matches the repo's fee tests |
| S6 | [Documentation index](https://docs.kalshi.com/llms.txt) | Canonical list of all official doc pages (used to locate S1–S5 and to confirm the fee-schedule PDF is the separate [Kalshi Fee Schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf) referenced by the repo) |
| S7 | Live demo API `GET /exchange/status` | `{"exchange_active":true,"trading_active":true,…}` with shards `exchange_index` 0–3 — exchange live at 07:2x UTC: https://external-api.demo.kalshi.co/trade-api/v2/exchange/status |

## 2. Claim-by-claim checks (published claim → official source → live evidence)

| # | Published claim (where) | Official source | Live evidence (manual re-check URL) | Result |
|---|---|---|---|---|
| C1 | Demo REST base = `https://external-api.demo.kalshi.co/trade-api/v2`, alt `https://demo-api.kalshi.co/trade-api/v2` (`data/meta.json`, `sources.html`) | S1 | S7 returned 200 from the recommended host | **verified** |
| C2 | Demo WS = `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, alt `wss://demo-api.kalshi.co/trade-api/ws/v2` | S1 | not exercised from a browser (see flagged F/AA items: signed handshake headers are not attachable from a static page) | **verified against docs** |
| C3 | Market statuses incl. `active` (open) and `finalized` (settled); `result` ∈ `yes`/`no` (`dashboard.html`, `methods.html`, `resolved.html`) | S2 | [KXAAAGASM-26NOV30-3.50](https://external-api.demo.kalshi.co/trade-api/v2/markets?event_ticker=KXAAAGASM-26NOV30&limit=3) live `status:"active"`, `result:""` (unresolved) · [KXBTC15M-26NOV202300-00](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC15M-26NOV202300-00) live `status:"finalized"`, `result:"no"`, `settlement_ts:"2026-11-21T04:00:02.915253Z"` | **verified** |
| C4 | `status=settled` filter returns `finalized` markets (`scripts/collect.py`, `methods.html`) | S2 | [GET /markets?status=settled&limit=3](https://external-api.demo.kalshi.co/trade-api/v2/markets?status=settled&limit=3&sort_desc=true) returned `status:"finalized"` rows | **verified** |
| C5 | Orderbook = bids-only ladders, `[price, qty]` strings, ascending, best bid last; asks derived by reciprocity (`dashboard.html` depth ladder, `methods.html`) | S3 | [KXAAAGASM-26NOV30-3.90 orderbook](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXAAAGASM-26NOV30-3.90/orderbook?depth=5) returned `{"orderbook_fp":{"no_dollars":[],"yes_dollars":[]}}` — the documented empty-book shape | **verified** |
| C6 | Candlestick endpoint `/series/{series}/markets/{ticker}/candlesticks`, `period_interval` ∈ 1/60/1440; seconds-level windows use the trade-tape fallback (`methods.html` §6) | S4 | path + enum re-read in S4 today (response shape `price.*_dollars` etc. matches `data/samples/candlesticks-sample.json`) | **verified against docs** |
| C7 | Fee model: trade fee ceil to `$0.000001`; fee-schedule PDF formula and rows (`methods.html`, `data/fee_schedule_series.json`) | S5 + [Kalshi Fee Schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | S5 re-read today; the PDF row-by-row transcription audit is recorded in [`reports/VERIFICATION_6877ec31.md`](VERIFICATION_6877ec31.md) (42 published rows transcribed; the OCR-garbled block stays `not_transcribed`, flagged N2) | **verified (docs + prior line-by-line audit)** |
| C8 | Exchange live/trading at verification time (`dashboard.html` header) | S7 | S7 `exchange_active:true, trading_active:true` | **verified** |
| C9 | Topic rows carry settlement sources with official links (`topics/*.html`) | S2 (series `settlement_sources`) | [KXPGATOUR-THRC26](https://external-api.demo.kalshi.co/trade-api/v2/events/KXPGATOUR-THRC26) live `settlement_sources` = Fox Sports / ESPN / the Governing League (pgatour.com) — matches `data/topics/golf.json` row exactly · [KXOSCARPIC-27](https://external-api.demo.kalshi.co/trade-api/v2/events/KXOSCARPIC-27) live = Academy of Motion Picture Arts and Sciences — matches `data/topics/culture.json` row exactly | **verified** |
| C10 | Resolved rows record YES/NO + settlement value (`resolved.html`) | S2 | [KXBTC15M-26NOV202300-00](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC15M-26NOV202300-00) live `result:"no"`, `settlement_value_dollars:"0.0000"` — matches stored row · [KXXRP15M-26NOV202300-00](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXXRP15M-26NOV202300-00) live `result:"yes"`, `settlement_value_dollars:"1.0000"` — matches stored row | **verified** |
| C11 | Gas event identity + AAA settlement source (`data/topics/gas-prices.json`, `topics/gas-prices.html`) | — | [KXAAAGASM-26NOV30 markets](https://external-api.demo.kalshi.co/trade-api/v2/markets?event_ticker=KXAAAGASM-26NOV30&limit=3) live: event present with `rules_primary` citing **AAA**, `strike_type:"greater"`, `settlement_timer_seconds:300`; strike markets present (first 6 inspected line-by-line; the stored snapshot counts 26 — the live total was not re-counted) | **verified** (identity/terms; live market count unverified) |
| C12 | MVE (multivariate) markets are excluded from topic/resolved collection (`mve_filter=exclude`) | S2 (MVE channels) | The 3 newest rows of the live `status=settled` feed are `KXMVECROSSCATEGORY-*` MVE rows (see [C4 URL](https://external-api.demo.kalshi.co/trade-api/v2/markets?status=settled&limit=3&sort_desc=true)); committed `data/resolved.json` and all five `data/topics/*.json` contain **0** `KXMVE` tickers (grep-checked) | **verified** |

### Row-level spot-check summary (committed data vs live, 2026-11-21 07:2x UTC)

| Committed row (`data/…`) | Field checked | Committed | Live | Match |
|---|---|---|---|---|
| `resolved.json` → `KXBTC15M-26NOV202300-00` | `result`, `settlement_value_dollars`, `status` | `no`, `0.0000`, `finalized` | `no`, `0.0000`, `finalized` | ✓ |
| `resolved.json` → `KXXRP15M-26NOV202300-00` | `result`, `settlement_value_dollars`, `status` | `yes`, `1.0000`, `finalized` | `yes`, `1.0000`, `finalized` | ✓ |
| `topics/gas-prices.json` → event `KXAAAGASM-26NOV30` | title, series, settlement source | AAA source, `KXAAAGASM` | AAA source, `KXAAAGASM` (live strike markets present; count not re-counted) | ✓ |
| `topics/golf.json` → event `KXPGATOUR-THRC26` | title, category, settlement sources | Sports / Fox Sports, ESPN | identical | ✓ |
| `topics/culture.json` → event `KXOSCARPIC-27` | title, category, settlement sources | Entertainment / Academy | identical | ✓ |

Live **prices** legitimately differ from the committed snapshot (the snapshot is a point in time,
see V-1); identity, status, and settlement fields are what were compared.

## 3. Local validator suite (run on the branch, 2026-11-21, all exit 0)

| Check | Result |
|---|---|
| `npm run check` → `tools/build.mjs` | BUILD OK — 18 HTML, 6 JS files validated, 0 broken links |
| `scripts/check_site.mjs` | 18 HTML, 432 links, 1,249 rows, 825 resolved rows, **0 failures** (every row renders with an official API source link) |
| `scripts/check_links.mjs` | 16 pages, 400 local + 236 external links, **0 failures** |
| `npm test` | engine 23/23 · live_fixes 3/3 · live_dash 6/6 · lib ok · fees 50/50 · model 30 · root_engine 48/48 · model.test 21/21 · portfolio 60/60 · demo-account 89/89 · `tests/test_collect.py` 4/4 |
| `tools/render_test.mjs --offline` | 16 pages rendered, **0 JS errors** |

## 4. Irregularities and unverified items (flagged; none block anything)

| ID | Item | Evidence / links | Status |
|---|---|---|---|
| V-1 | **Committed snapshot is stale.** All `data/*` artifacts carry `generated_at = 2026-11-21T03:59:57Z`, the restore point chosen after the 06:58Z upstream-429 incident (a bad run had overwritten good data with empty results). Refresh runs on schedule (`cron: 17 */3 * * *` in `.github/workflows/pages.yml`) | `data/meta.json`, `data/log.md`, board record of session `c96a21b7` (top of `COORDINATION.md`) | flagged (existing); will clear on the next good scheduled snapshot |
| V-2 | **9d-1 / 691-11: 4 misclassified rows in `data/resolved.json`.** The 3-day settled window (crypto 196 rows, gas-prices 4 rows) contains `KXNATGAS15M-26NOV202215-15`, `-230-30`, `-245-45`, `-300-00` ("Natural Gas price up in next 15 mins?") labelled `_topic: gas-prices`. Natural-gas 15-minute markets are explicitly excluded by `scripts/topics.json` (`exclude_keywords: natural gas|…`) — the settled-market fallback that ignored exclusions is **fixed in code** (whole-word matching + exclusions, merged via PRs #65/#89), but the committed snapshot predates the fix. Live confirmation that these markets are natural-gas (not gasoline) 15-minute markets: [KXNATGAS15M-26NOV202300-00](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV202300-00). The 4 rows must disappear from `resolved.json` at the next scheduled snapshot | see links in row | flagged (existing, non-blocking) |
| V-3 | **Resolved-page topic imbalance.** In the current 3-day window, 196 of 200 rows are crypto 15-minute markets (the demo feed's highest-frequency settled series). The Resolved page therefore under-represents elections/culture/golf/gas resolutions. `data/resolved.json` `in_scope_count` 1,904 vs 200 published rows (cap) | `data/resolved.json` (`window`, `settled_total: 6000`, `in_scope_count`) | flagged here (work in flight: open PR #90 gives each topic a share of the Resolved page) |
| V-4 | **Demo-account portfolio/execution (brief: "track the portfolio using the kalshi demo account") needs demo API credentials.** No key pair was provided in the repo or in the brief. Nothing is faked: the site publishes the three disclosed layers — browser strategy lab (simulated), CI paper-trading ledger (simulated, `data/portfolio.json`), and a key-gated demo-account console (`demo-account/`) that activates only with user-supplied demo keys | `EXECUTIVE_SUMMARY.md` (portfolio row), `demo-account/README.md`, `demo-account/VERIFICATION.md` | flagged (existing 9d-5; needs owner input) |
| V-5 | **AA-8 (live runtime re-confirmation).** This pass re-confirmed the live response shapes (C3–C5, C9–C12) against the demo API today. End-to-end browser runtime (CORS, polling loop) remains verifiable only in a browser; public market-data endpoints are documented as unauthenticated (S3, [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data)) | this report §2 | partially re-confirmed; flag can be narrowed by the `flagged.html` owner |
| V-6 | **Fee-model disclosures unchanged:** maker-fee multiplier default 0 is unmodeled (691-10); the fee-schedule PDF vs series-fee API conflict stays open by design (6b/691-1); the ROI screen is a heuristic (F7) | `flagged.html`, `reports/VERIFICATION_6877ec31.md` | open (by design) |
| V-7 | **Docs now list newer dedicated hosts** not used by the repo: `wss://user-ws.demo.kalshi.co/trade-api/ws/v2` (fill/user_orders), `wss://margin-user-ws.demo.kalshi.co/…`, `wss://external-feeds.demo.kalshi.co/…` (S1). The repo's chosen hosts remain supported; informational only | S1 | informational |
| V-8 | **Board conflict markers traceability.** `COORDINATION.md` at `main` @ `2acfa8e` contained committed `<<<<<<< HEAD` / `>>>>>>> origin/main` marker lines around the 6877ec31 / 6de17567 session blocks. Repaired on `main` by session `aa7d3d27` via PR #74 (`f1f34f3`) before this claim landed; this session re-checked `main` @ `5eb88d0`: 0 marker lines, both session blocks intact | `git show 2acfa8e:COORDINATION.md` vs `git show 5eb88d0:COORDINATION.md` | resolved (recorded for traceability) |

## 5. What this pass did **not** verify (no inference made)

- Any live value that a browser would render at a later time (prices move; the site fetches live).
- Signed/authenticated endpoints (portfolio, order placement) — they require demo credentials (V-4).
- The Kalshi Fee Schedule PDF's OCR-garbled rows — left blank/`not_transcribed` per N2.
- CI-side collector behaviour on the GitHub runners (verified by the scheduled runs themselves:
  see the `data/log.md` and Actions run links recorded on `COORDINATION.md` by the collector owners).

---

*Every URL in this report is a direct official link (docs.kalshi.com, kalshi.com, or the official
demo API base from the docs) and can be re-fetched by hand. No value in this report was derived by
inference: each "verified" mark has a fetched source or a live response behind it.*
