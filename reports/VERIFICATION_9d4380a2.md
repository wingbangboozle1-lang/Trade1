# Verification record — session `9d4380a2` (2026-11-20 UTC)

Scope: line-by-line re-check of the factual claims this session relies on, against official Kalshi
documents and live demo responses, fetched by the agent's page fetcher on 2026-11-20 (about 20:05–20:20 UTC).
The build sandbox has no route to `*.kalshi.co`, so every live value below was read through the page fetcher,
not through the sandbox. Nothing here was invented; a claim that could not be read is marked **unverified**.

Status key: **V** = verified this session against the cited official page or live response ·
**C** = carried forward from an earlier session's record (cited, not re-read this session) ·
**X** = contradicted or misstated on the site (see Irregularities) · **U** = unverified.

## 1. Environment and endpoints

| # | Claim on the site | Official source (read 2026-11-20) | Result |
|---|---|---|---|
| E1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2` is the recommended demo endpoint; `https://demo-api.kalshi.co/trade-api/v2` is also supported | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) — table of REST and WebSocket endpoints | **V** (both bases listed; WS bases `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2` also listed) |
| E2 | Exchange and trading active on demo | Live `GET https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` ([response](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status)) | **V** — `exchange_active: true`, `trading_active: true`; four exchange indices (0 default, 1 and 2 "Demo shard", 3 unnamed), all active |
| E3 | `GET /events` `limit` default 200, maximum 200; `status` one of `unopened`, `open`, `closed`, `settled`; cursor paging | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) — "Maximum value is 200", "Required range: 1 <= x <= 200" | **V** (the site's `limit=200` is correct; `limit=1000` is out of range per the doc) |
| E4 | `GET /markets/trades` (seconds windows): `ticker`, `min_ts`, `max_ts`, `limit` ≤ 1000, cursor | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) — "Maximum value is 1000"; `min_ts`/`max_ts` Unix seconds | **V** (matches `assets/app.js` usage) |
| E5 | `GET /markets/{ticker}/orderbook?depth=10` — depth = price levels per side from best bid; `depth` 0 = all, 1–100 allowed; other values → 400 | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) — "Required range: `0 <= x <= 100`"; response `orderbook_fp.yes_dollars` / `no_dollars` as `[price, count]` pairs | **V** (the site's `depth=10` is inside the range). The "bids only, asks derived by reciprocal rule" claim is **C** (orderbook_responses page, earlier session) |
| E6 | Candlesticks: `GET /series/{series}/markets/{ticker}/candlesticks` with `start_ts`, `end_ts` (seconds) and `period_interval` | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) — path verified; `start_ts` and `end_ts` required; **`period_interval` valid values are 1, 60, 1440** ("1 (1 minute), 60 (1 hour), or 1440 (1 day)") | **V** for path and the 1/60/1440 set. The site uses only 1 and 60 (correct for its windows), but **X** on the README sentence "`period_interval` 1 or 60 only" — see I1. The "≤ 5,000 periods" cap is **C** (not on the chunk read this session) |
| E7 | Rate limits: unauthenticated public requests have separate limits; back off on 429 | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) — "Unauthenticated public requests are subject to separate limits. … back off on `429`." | **V** — the page gives no numeric unauthenticated limit, so the site's "(undocumented) limits" wording is accurate |

## 2. Fees (drives all paper P&L)

| # | Claim on the site | Official source | Result |
|---|---|---|---|
| F1 | General taker fee `roundup(M × 0.07 × C × P × (1−P))`, M default 1 | [Kalshi Fee Schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) — "Last updated and effective: July 7, 2026"; general trading fee formula; "M = the multiplier for each contract (default is 1 unless otherwise indicated)" | **V** — the formula matches the PDF. The PDF's own General Trading Fees Table (e.g. 100 contracts at $0.50 = $1.75) is consistent with it |
| F2 | Maker fee formula `roundup(M × 0.0175 × C × P × (1−P))` — not modelled on the site | Same PDF, "Maker Fees": default M = 0 unless otherwise indicated | **V** — the site states maker fees are not modelled (flagged) |
| F3 | No settlement fee | Same PDF, "Settlement Fees: There is no settlement fee." | **V** |
| F4 | Net fee rounding: `ceil_6dp(model fee)`, balance precision $0.0001 direct / $0.01 non-direct | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | **V** |
| F5 | Simulator uses M = 1 for every series | Same PDF, "Non-Standard Fees" table lists per-series **taker multipliers**, several of them **0** (e.g. KXBTCY, KXCITRINI, KXDOED, KXELECTIRAN, KXETHY, KXGAMBLINGREPEAL, KXGREENLAND, KXIRANDEMOCRACY, KXLAYOFFSYINFO) and KXAAAGASM = 1 | **X** for the zero-multiplier series (the simulator over-charges them). Already published as flagged item 6b on `flagged.html`; the fix is in open PR #35 (`b93ba12e`), not in this session — see I2 |
| F6 | PDF "round up" wording ("fee + positionCost rounded to a centicent") vs the fee-rounding doc's 6-dp ceiling | PDF text vs Fee Rounding doc | **X** (documents disagree on precision). Already flagged as F-DA-5 on `demo-account/flagged.html` |

Note on F5: text extraction of the PDF's non-standard table is partly garbled (some rows interleave
series codes with product names, e.g. "Men's World Cup winner 11 11"). Multipliers read from the extracted text
were checked only where the row is unambiguous. Any row not checkable in the PDF is **U** for manual review.

## 3. Live resolved rows (settled markets do not change, so these are exact checks)

The snapshot `data/resolved.json` holds **200** resolved markets (`settled_total` 6,000, `in_scope_count` 3,213 in the snapshot window).
Four rows, spread across topics, were re-fetched from the official endpoint `GET /markets/{ticker}` and compared field by field.

| Ticker (snapshot) | Snapshot: result · status · settlement_ts · settlement value | Official response (live) | Match |
|---|---|---|---|
| `KXNATGAS15M-26NOV201415-15` (snapshot topic: **gas-prices — wrong**, see I5) | yes · finalized · 2026-11-20T19:15:23.775821Z · 1.0000 | [response](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV201415-15): `result: yes`, `status: finalized`, `settlement_ts` 2026-11-20T19:15:23.775821Z, `settlement_value_dollars` 1.0000 | **V** |
| `KXPGA3BALL-THRC26R2RNEEKROYDLIN-RNEE` (golf) | yes · finalized · 2026-11-20T19:11:33.772137Z · 1.0000 | [response](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXPGA3BALL-THRC26R2RNEEKROYDLIN-RNEE): `result: yes`, `status: finalized`, `settlement_ts` 2026-11-20T19:11:33.772137Z, value 1.0000 | **V** |
| `KXBTC-26NOV2013-T54200` (crypto) | no · finalized · 2026-11-20T19:07:34.207893Z · 0.0000 | [response](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC-26NOV2013-T54200): `result: no`, `status: finalized`, `settlement_ts` 2026-11-20T19:07:34.207893Z, value 0.0000 | **V** |
| `KXROMLNBMGAME-26NOV201200PLOPIT-PLO` (snapshot topic: **gas-prices — wrong**, Romanian basketball, see I5) | no · finalized · 2026-11-20T19:07:58.775714Z · 0.0000 | [response](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXROMLNBMGAME-26NOV201200PLOPIT-PLO): `result: no`, `status: finalized`, `settlement_ts` 2026-11-20T19:07:58.775714Z, value 0.0000 | **V** — but see I5: a non-topic market is in the resolved snapshot |

Four of four sampled rows match on result and settlement fields. Their topic labels are wrong for two of them (see I5). The other 196 are **C** (carried from the CI snapshot) and were not re-fetched this session.

## 4. Demo account (Kalshi account portfolio)

| # | Claim | Evidence | Result |
|---|---|---|---|
| D1 | Demo-account balance / positions are **not** tracked | `data/demo_account/status.json`: `configured: false`, "KALSHI_DEMO_KEY_ID and/or KALSHI_DEMO_PRIVATE_KEY are not set. No request was sent." (checked 2026-11-20T19:37:38Z) | **V** (as of that run). The workflow secret list could not be read by this session (HTTP 403 for the session token), so the status file is the evidence |
| D2 | Authenticated endpoints and signing | [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance), [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions), [Quick start: authenticated requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) — **C** (cited by the demo-account track; not re-read this session) | **C** |

Owner action needed (cannot be completed by an agent): create a demo API key on the Kalshi demo site and add it as repository secrets
`KALSHI_DEMO_KEY_ID` and `KALSHI_DEMO_PRIVATE_KEY`, or paste it into the browser panel. Until then no demo-account numbers can be real.

## 5. Irregularities found in this session

| ID | Irregularity | Where | Source | Disposition |
|---|---|---|---|---|
| I1 | README says the candlestick endpoint takes "`period_interval` 1 or 60 only". The official doc lists 1, 60, **and 1440**. The site uses only 1 and 60, so the README sentence describes the site, not the API | `README.md` line ~37 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | **Logged to COORDINATION** for the owner of PR #35 (edits `README.md`); not edited here |
| I2 | Simulator fee multiplier is 1 for all series, but the official table lists zero-multiplier series | `assets/model.js`, `assets/portfolio.js`, `scripts/portfolio_engine.py` | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (Non-Standard Fees) | Already flagged (`flagged.html` 6b). Fix is in open PR #35 — not started here |
| I3 | Fee precision wording differs between the PDF ("centicent") and the fee-rounding doc (6 dp) | `demo-account/flagged.html` F-DA-5 | PDF vs [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) | Already flagged; no change here |
| I4 | Demo-account portfolio and order execution are not running | `data/demo_account/status.json` | See section 4 | Blocked on owner credentials; disclosed on the site |
| I5 | **Two of the 200 resolved rows are misclassified as `gas-prices`** (counts from `data/resolved.json`: crypto 182, golf 16, gas-prices 2). (a) `KXNATGAS15M-26NOV201415-15` is a *natural gas* market; the gas topic's own `exclude_keywords` (`natural gas`) is not applied on the resolved fallback path. (b) `KXROMLNBMGAME-26NOV201200PLOPIT-PLO` is a basketball match; its title "CSM BBA Petrolul Ploiesti wins" matches the unanchored gas keyword `petrol` inside "Petrolul". Root cause: `scripts/collect.py` L407–416 — the fallback for settled markets whose event is absent from the open list runs `title_keywords` / `series_prefix` with `re.search` and skips `exclude_keywords` and word boundaries. The main `classify()` (L161–178) does apply exclude keywords. | `data/resolved.json`; `scripts/collect.py`; `scripts/topics.json` (`gas-prices`) | [live response, natgas](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV201415-15), [live response, Petrolul](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXROMLNBMGAME-26NOV201200PLOPIT-PLO) | **Logged to COORDINATION as defect D1** for the owner of `scripts/collect.py` (PR #32 touches that file). Not edited here. Live browser classification was not tested this session |
| I6 | Two open PRs (#32, #35) both report `CONFLICTING` with `main` and touch the same fee, README, methods and flagged files | GitHub PR list at 2026-11-20 20:0x UTC | — | **Logged** to COORDINATION; not merged or edited here |
| I7 | Jump-log "news" links are search-engine links, not official sources, which breaks the brief's "every row links an official source" rule for those rows | `assets/app.js` jump log; flagged on `demo-account/flagged.html` F-DA-6 | — | Already labelled on the site as leads; the strict rule is **not met** for those rows. Logged |

## 6. Carried forward (not re-read this session)

Orderbook "bids only / reciprocal asks" (orderbook_responses doc), market settlement ($1 per winning contract, [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement)),
market lifecycle statuses ([Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle)), CORS probe (`data/cors.json`),
and the candlestick cap of 5,000 periods. These are marked **C** wherever they appear.
