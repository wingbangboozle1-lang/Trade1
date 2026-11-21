# Repo review — session `6b112481` (2026-11-21)

**Branch:** `arena/6b112481-trade1` (based on `main` @ `a15a941`)
**Role:** final integration — line-by-line review of the repository as it stands, the
defects that review found, the fixes, and the items left open for the owner.
**Rule applied throughout:** nothing is inferred. Every value on this site that cannot be
confirmed from an official Kalshi source is left blank and published on the
[Flagged for Review](../flagged.html) page with its source link. Where this review found a
*false statement* on the site, the statement was corrected against an official source and
the correction is recorded here and on the Flagged page.

Official sources used (all fetched 2026-11-21 unless stated):

| # | Source | URL |
|---|---|---|
| S1 | API Environments and Endpoints | <https://docs.kalshi.com/getting_started/api_environments> |
| S2 | Market Lifecycle | <https://docs.kalshi.com/getting_started/market_lifecycle> |
| S3 | Market Settlement | <https://docs.kalshi.com/getting_started/market_settlement> |
| S4 | Get Events (Event + Market schema) | <https://docs.kalshi.com/api-reference/events/get-events> |
| S5 | Get Market Orderbook | <https://docs.kalshi.com/api-reference/market/get-market-orderbook> |
| S6 | Get Markets | <https://docs.kalshi.com/api-reference/market/get-markets> |
| S7 | Get Series | <https://docs.kalshi.com/api-reference/market/get-series> |
| S8 | Get Market Candlesticks | <https://docs.kalshi.com/api-reference/market/get-market-candlesticks> |
| S9 | Get Trades | <https://docs.kalshi.com/api-reference/market/get-trades> |
| S10 | Official fee schedule (PDF) | <https://kalshi.com/docs/kalshi-fee-schedule.pdf> |
| S11 | Fee Rounding | <https://docs.kalshi.com/getting_started/fee_rounding> |
| S12 | Orderbook Responses | <https://docs.kalshi.com/getting_started/orderbook_responses> |
| S13 | Fixed-Point Representation | <https://docs.kalshi.com/getting_started/fixed_point_migration> |
| S14 | Rate Limits | <https://docs.kalshi.com/getting_started/rate_limits> |
| S15 | Official demo REST API (live) | `https://external-api.demo.kalshi.co/trade-api/v2` |

---

## 1. Live re-verification of the deployed data (2026-11-21)

Every row below was fetched from the live official demo API on 2026-11-21 and compared
with the committed snapshot that the site renders.

| Check | Official record | Live value | Snapshot | Result |
|---|---|---|---|---|
| Gas market | `GET /markets/KXAAAGASM-26NOV30-3.90` (S15) | `volume_fp "31027.52"`, `last_price_dollars "0.7500"`, `yes_bid_dollars "0.0000"`, `yes_ask_dollars "1.0000"`, `open_interest_fp "24988.65"`, `status "active"`, `result ""`, `price_level_structure "linear_cent"` | `data/topics/gas-prices.json` | **match on all 8 checked fields** |
| Golf market | `GET /markets/KXPGATOUR-THRC26-SSTR` (S15) | `volume_fp "765887.60"`, `last_price_dollars "0.0260"`, `yes_bid_dollars "0.0210"`, `no_bid_dollars "0.9740"`, `open_interest_fp "681894.62"`, `price_level_structure "tapered_deci_cent"`, `price_ranges [{0,0.1,0.001},{0.1,0.9,0.01},{0.9,1,0.001}]` | `data/topics/golf.json` | differs **only** in the fields that tick continuously (`volume_fp`, `volume_24h_fp`, `last_price_dollars`, `yes_ask_dollars`, `no_bid_dollars`) — expected for a live market; the static fields (`open_interest_fp`, `price_level_structure`, `price_ranges`) match |
| Natural-gas market | `GET /markets/KXNATGAS15M-26NOV201415-15` (S15) | `title "Natural Gas price up in next 15 mins?"`, `result "yes"`, `settlement_value_dollars "1.0000"`, `status "finalized"`, `settlement_ts "2026-11-20T19:15:23.775821Z"` | was labelled `gas-prices` in `data/resolved.json` | **mislabelled — fixed by 6b-1** (it is natural gas, which the gas-prices topic excludes) |
| Basketball market | `GET /markets/KXROMLNBMGAME-26NOV201200PLOPIT-PLO` (S15) | `title "CSM BBA Petrolul Ploiesti wins"`, `result "no"`, `settlement_value_dollars "0.0000"`, `status "finalized"` | matched `gas-prices` on the substring “petrol” | **mislabelled — fixed by 6b-1** |
| Order book | `GET /markets/KXPGATOUR-THRC26-SSTR/orderbook?depth=10` (S5, S15) | `orderbook_fp.yes_dollars [[0.0010,80.00],[0.0190,8771.92],[0.0200,8333.33],[0.0210,7936.50]]`, `no_dollars [[0.9730,6172.83],[0.9740,5816.65]]` | `assets/app.js` `bookViews()` | **matches**: `[price, count]` pairs, ascending with the best bid **last**, on the official base |
| Trade tape | `GET /markets/trades?ticker=KXPGATOUR-THRC26-SSTR&limit=3` (S9, S15) | `trades[].yes_price_dollars "0.0260"`, `created_time`, `count_fp`, `cursor` | `assets/app.js` `fetchTrades()` reads `yes_price_dollars` + `created_time` | **matches** |
| Series record | `GET /series/KXAAAGASM` (S7, S15) | `fee_multiplier 1`, `fee_type "quadratic"`, `category "Economics"`, `settlement_sources [{name "AAA", url "https://gasprices.aaa.com/"}]` | `assets/model.js` `noteSeriesFee()`, `scripts/portfolio_engine.py` | **matches** (this is the demo-vs-schedule conflict already published as flagged item 6b) |
| Event schema | `GET /events?status=open&limit=200` (S4, S15) | every field the code reads is in the published Event/Market schema: `event_ticker`, `series_ticker`, `title`, `sub_title`, `category`, `settlement_sources[]`, `markets[]` with `ticker`, `status`, `result`, `last_price_dollars`, `previous_price_dollars`, `yes_bid_dollars`, `yes_ask_dollars`, `no_bid_dollars`, `no_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `settlement_ts`, `settlement_value_dollars`, `price_level_structure`, `price_ranges[]`, `close_time`, `open_time`, `latest_expiration_time`, `expected_expiration_time`, `settlement_timer_seconds`, `rules_primary`, `rules_secondary`, `can_close_early`, `market_type`, `exchange_index`, `notional_value_dollars` | `assets/app.js`, `scripts/collect.py` | **all fields present** |
| Environment hosts | S1 | Demo REST recommended `https://external-api.demo.kalshi.co/trade-api/v2`, also supported `https://demo-api.kalshi.co/trade-api/v2`; demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` / `wss://demo-api.kalshi.co/trade-api/ws/v2` | `assets/app.js` `CFG.bases`, `scripts/collect.py` `BASE`/`ALT` | **matches** — the host list in the brief is the official one |
| Statuses / results | S2 | REST statuses `initialized, active, inactive, closed, determined, disputed, amended, finalized`; filter values `unopened, open, paused, closed, settled`; `result` ∈ `yes, no, scalar` | `assets/app.js` `handleMarketBatch()`, `scripts/portfolio_engine.py` | **matches** (see 6b-9) |
| Candlesticks | `GET /series/KXAAAGASM/markets/KXAAAGASM-26NOV30-3.90/candlesticks?...&period_interval=1` (S8, S15) | `{"candlesticks":[],"ticker":"KXAAAGASM-26NOV30-3.90"}` — endpoint and shape confirmed; the window had no prints | `assets/app.js` `fetchCandles()` | endpoint/params confirmed |

**Fee model.** The paper brokers implement
`taker = roundup(M × 0.07 × C × P × (1−P))` in integer arithmetic and reproduce every published
row of the schedule's General Trading Fees Table. Re-read this session from S10 and S11:
the formula and the “no settlement fee” statement match; maker fees remain unmodelled
(flagged). The `M` resolution order (demo `fee_multiplier` → published schedule table →
documented default `M = 1`) is unchanged and still published as flagged item 6b.

---

## 2. Findings — fixed in this session

### 6b-1 — Settled markets were mislabelled `gas-prices` (flagged item 9d-1 / defect D1). **FIXED**

`scripts/collect.py` classified settled markets through a fallback that re-applied a topic's
title keywords but **skipped that topic's own exclusion rules**, and matched the keywords as
raw substrings. Two official records were therefore labelled `gas-prices`:

| Record | Official title | Why it matched wrongly |
|---|---|---|
| `KXNATGAS15M-26NOV201415-15` | “Natural Gas price up in next 15 mins?” | the substring `gas price` inside “Natural Gas price”; the topic's `exclude_keywords` (`natural gas|natgas|propane|heating oil`) was not applied |
| `KXROMLNBMGAME-26NOV201200PLOPIT-PLO` | “CSM BBA Petrolul Ploiesti wins” | the substring `petrol` inside “Petrolul” |

*Fix.* The fallback now applies the topic's exclusion rules and the title keywords are matched
on **word boundaries** (`scripts/collect.py`: `bounded_re()`, `topic_excluded()`,
`topic_title_hit()`, `classify_settled()`). `assets/model.js` mirrors the same semantics
(`boundedRe()`), so the browser classifier and the collector cannot drift apart. Exclusion
patterns stay substring-matched **on purpose**, so the ticker fragment `natgas` inside
`KXNATGAS15M` is still caught.

*Proof.* `tests/test_collect.py` (33 checks, Python) and `tests/collector.test.mjs`
(18 checks, Node) share one official corpus (`tests/fixtures/topic_cases.json`) and both
re-classify the committed official snapshot: **34 of 34** snapshot events keep their topic and
**196 of 200** resolved rows keep their topic — the 4 that change are exactly the natural-gas
rows, which now fall out of scope. Wired into `npm test` and the Pages CI checks job.

### 6b-2 — `data/meta.json` reported the same “series discovered” count for every topic. **FIXED**

`series_discovered_per_topic` was computed as `sum(1 for k in series_stats if k)` — the size of
one **global** dict, so every topic reported the same number (200 = 40 series × 5 topics).
The published `data/meta.json` therefore showed `200` for gas, elections, culture, crypto and
golf alike. The collector now counts per topic (`series_per_topic`) and also publishes the
global total (`series_matched_total`).

### 6b-3 — Duplicate function declaration in `assets/model.js`. **FIXED**

`seriesOfTicker()` was declared twice (once next to `seriesOf()`, once in the broker section).
The second declaration silently replaced the first at parse time. The two were functionally
identical, so no number was wrong — but the duplicate is removed so there is exactly one
definition.

### 6b-4 — The CI gate that proves “every row has an official source link” checked the wrong file. **FIXED**

`scripts/check_site.mjs` proved the per-row official-source rule on `data/snapshot.json`
(1,118 rows + 625 resolved rows) — a **frozen artifact** written by the superseded
`scripts/build_snapshot.mjs` (last generated 2026-11-20T19:11Z) that **no published page
renders**. The pages that are published (`data.html`, `resolved.html`) render from
`data/topics/*.json` (2026-11-21T03:59Z) and `data/resolved.json`, and they build each row's
link **in JavaScript at render time**, so no static check could see it.

*Fix.* New `scripts/check_row_sources.mjs` renders the **real pages** in jsdom against the
**real data files** and asserts, row by row:

1. every rendered data row carries at least one link on the official demo base;
2. that link is the official record for *that* row — `/markets/{ticker}` for a market row,
   `/events/{event_ticker}` for an event row;
3. every row in the data files the pages read is rendered with its own official link.

Current result: **271 rendered rows, 413 official links, 0 failures.** Added to `npm run check`,
`npm test` and the Pages CI checks job.

### 6b-5 — A false statement about the dollar fields. **CORRECTED**

The site repeatedly stated that *“no official per-market dollar-notional field exists”* /
*“was not returned by the API”* (`flagged.html` item 5, `EXECUTIVE_SUMMARY.md` ×3,
`README.md`, `REVIEW.md` ×3, `data.html`, `executive-summary.html`).

That is **not correct**. The official Market schema (S4, S6) publishes
`notional_value_dollars`, and the live demo API returns it: `"1.0000"` on every binary
market sampled this session (`KXAAAGASM-26NOV30-3.90`, `KXPGATOUR-THRC26-SSTR`,
`KXNATGAS15M-26NOV201415-15`, `KXROMLNBMGAME-26NOV201200PLOPIT-PLO`).

The **conclusion** still holds — there is no official per-market **traded**-dollar field
(`volume_fp` and `volume_24h_fp` are contract counts), so every “$” figure on the site stays a
labelled estimate and is not exchange-published — but the **stated reason** was wrong. All
nine statements were corrected to say exactly that, with the schema link. The field is now
captured verbatim by the collector (`notional_value_dollars` added to `MARKET_FIELDS`) so a
reviewer can read the official value instead of taking the site's word for it.

### 6b-6 — The Resolved page did not disclose that scalar markets are excluded. **DISCLOSED**

S2 states that a market's `result` may be `yes`, `no` **or `scalar`**. The site only lists
yes/no outcomes (that is what the brief asks for) but did not say so. `resolved.html` now
states it explicitly and links S2.

---

## 3. Findings — open, published on the Flagged for Review page

These do **not** block the merge. Each is published with its source link.

### 6b-7 — Event-level fee overrides are not modelled (open)

The official Event schema (S4) publishes **`fee_type_override`** and
**`fee_multiplier_override`** per event, and S2 records that Kalshi emits an
`event_fee_update` WebSocket message “when an event-level fee override is set or cleared”.
Both paper engines resolve `M` from the **series** record (`fee_multiplier`) and the published
schedule, and never look at an event-level override. On the demo environment every series
checked reports `fee_multiplier: 1` and no event override was observed in the sampled
responses, so **no published number is currently wrong** — but the model has a documented gap.

*Source:* S4 (Event schema) · S2 (Market Lifecycle → WebSocket section).
*Needed:* either model the override in both engines, or state the gap in `methods.html` and
`flagged.html`. Not inferred here: no override was observed, so no override value is published.

### 6b-8 — Two snapshot systems coexist; one of them is frozen (open)

`scripts/build_snapshot.mjs` is **not run by any workflow**. It wrote `data/snapshot.json`
(1.5 MB) on 2026-11-20T19:11Z and nothing has refreshed it since. The published pages render
`data/topics/*.json` + `data/resolved.json` (2026-11-21T03:59Z), produced by
`scripts/collect.py`. `scripts/check_site.mjs` still validates the frozen file, and
`assets/lib.mjs` is still imported by it and by `scripts/test_lib.mjs` — so `lib.mjs` is live
but `build_snapshot.mjs` is dead code.

*Needed:* an owner decision — either delete `scripts/build_snapshot.mjs` and
`data/snapshot.json` (and move the `lib.mjs` unit checks over to the collector), or schedule
the builder. Flagged rather than deleted, because another session owns those files.

### 6b-9 — A series' official category and its events' official category can differ (open)

The collector's series-discovery path groups by the official **series** category
(`GET /series?category=…`), so an event whose own category is `Politics` can appear in the
Elections topic. Observed in the committed snapshot: `KXDSENATESEATS-27` (“How many Senate
seats will Democrats hold after the Midterms?”, event category **Politics**, series category
**Elections**) and `KXLEADERSOUT-27JAN01` (“World leaders out before 2027?”, event category
**Politics**). Both are in `data/topics/elections.json` with `_match_reason: "series-discovery"`.

This is disclosed rather than changed: the series' own category is the official grouping the
brief asks for, and silently dropping them would remove real election markets. The new
`tests/test_collect.py` and `tests/collector.test.mjs` document the distinction explicitly so
the two paths are not confused.

*Source:* `data/topics/elections.json` (official `GET /events`/`GET /series` responses, logged
in `data/log.md`) · S4 · S7.

### 6b-10 — `docs/` and `probe/` are orphaned earlier-session artifacts (open)

`docs/` holds ten markdown files (`API_NOTES.md`, `EXECUTIVE_SUMMARY.md`, `SOURCES.md`,
`VERIFICATION.md`, `api-reference.md`, `executive-summary.md`, `sources.md`,
`verification.md`, `FLAGGED.md`) and `probe/` holds four one-off output files (~130 KB) from
session `a2ec5543`. **No published page links to either directory**, and they are not in the
published navigation, so they are invisible to visitors — but they are shipped by the Pages
build and can contradict the current pages (for example `docs/EXECUTIVE_SUMMARY.md` predates
the current fee policy). Flagged for the owner to remove or archive; not deleted here,
because they belong to another session's scope.

### 6b-11 — Sub-cent price grids are rounded to whole cents in the UI (open, restated)

`GET /markets/KXPGATOUR-THRC26-SSTR` reports `price_level_structure: "tapered_deci_cent"`
with `price_ranges` of step `0.0010` — i.e. **0.1 of a cent** ticks — while the dashboard
renders prices rounded to whole cents (`cents()` in `assets/app.js`). This is the already
published flagged item I3, restated here with a live, verifiable example. The chart and the
alert maths use the full 4-decimal fixed-point values, so the ≥ $0.10 rule is unaffected.

*Source:* S13 (Fixed-Point Representation) · S4 (Market schema, `price_level_structure` /
`price_ranges`) · live `GET /markets/KXPGATOUR-THRC26-SSTR`.

---

## 4. File-by-file review

Every published file was read. “Verified” means the file's factual claims were checked
against an official source in §1; “Reviewed” means the file was read and found internally
consistent with the sources it cites.

| File | Lines | Role | Review result |
|---|---|---|---|
| `index.html` | 128 | Landing page: executive summary, feature list, pipeline, live status | Reviewed; every external link resolves to an official host (`scripts/check_links.mjs`) |
| `executive-summary.html` | 162 | Executive summary (rendered version of `EXECUTIVE_SUMMARY.md`) | Reviewed; dollar wording corrected (6b-5) |
| `dashboard.html` | 43 | Live dashboard shell | Reviewed; loads `assets/model.js` + `assets/app.js` |
| `trades.html` | — | Strategy Lab shell | Reviewed; rendered in jsdom with 0 JS errors |
| `portfolio.html` | 143 | CI ledger view | Reviewed; every ledger row links its own market record (6b-4 / PR #58 takeover) |
| `data.html` | 141 | Per-topic data tables, CORS probe, resolved table | Reviewed; **every rendered row verified to carry its own official record** by `scripts/check_row_sources.mjs` |
| `resolved.html` | 192 | Resolved markets with the official YES/NO result | Reviewed; D1 disclosure updated, scalar disclosure added (6b-6) |
| `methods.html` | 208 | Method, formulas, fee model, assumptions | Reviewed |
| `suggestions.html` | — | “Make it more live” backlog + trader playbook | Reviewed |
| `flagged.html` | 254 | Flagged for Review | Reviewed; 9d-1 closed, item 5 corrected, new 6b-* items added |
| `sources.html` | — | Source list | Reviewed; all links resolve |
| `topics/*.html` (5) | — | Per-topic pages | Reviewed; rendered in jsdom with 0 JS errors |
| `demo-account/*` | — | Opt-in demo-account console (paper + signed demo orders) | Reviewed; 89-assertion suite passes; no credentials present, nothing faked |
| `assets/app.js` | 1277 | Live engine: discovery, watchlist polling, alerts, order book, charts, two chats | **Verified** against S1–S9 and the live API (§1) |
| `assets/model.js` | 485 | Topic rules, ROI score, official-fee broker, alert maths | **Verified**; duplicate removed (6b-3); classification mirrored (6b-1) |
| `assets/portfolio.js` | 482 | CI-ledger renderer | Reviewed |
| `assets/lib.mjs` | 193 | Legacy snapshot helpers + `API_BASES` (still imported by `check_site.mjs`) | Reviewed; see 6b-8 |
| `scripts/collect.py` | 583 | The collector: official demo API → `data/` | **Verified**; fixed (6b-1, 6b-2, 6b-5) |
| `scripts/portfolio_engine.py` | 1407 | Always-on CI paper ledger | **Verified**; per-row official links landed from the PR #58 takeover |
| `scripts/check_site.mjs` | 112 | Per-row official-source check | **Verified**; gap closed (6b-4) |
| `scripts/check_links.mjs` | 111 | Published-page link + nav-parity check | **Verified**; 16 pages, 394 local + 225 external links, 0 failures |
| `scripts/check_row_sources.mjs` | new | Renders the real pages and proves every rendered row's official link | **New in this session** (6b-4) |
| `scripts/build_snapshot.mjs` | 105 | Superseded snapshot builder | **Dead code** — see 6b-8 |
| `scripts/demo_account/*` | — | Signed demo-account client (opt-in) | Reviewed; never runs without credentials |
| `tests/*` | — | 9 test suites | All pass: engine 23/23, live fixes 3/3, lib ✓, fees 50/50, model 20, root engine 21/21, portfolio 60/60, demo-account 89/89, **collector 33/33 + 18/18 (new)** |
| `.github/workflows/pages.yml` | 101 | CI: checks on push/PR; snapshot refresh every 3 h | **Verified**; the collector tests and the row-source check are new steps |
| `.github/workflows/portfolio.yml` | 105 | CI paper-trading ledger every ~30 min | **Verified** |
| `.github/workflows/demo-account.yml` | 88 | CI demo-account snapshot/plan/execute | Reviewed; key-gated, dry-run by default |
| `data/*` | — | Committed, officially sourced snapshots + the request log | **Verified** row by row (§1) |
| `docs/`, `probe/` | — | Earlier sessions' leftovers | **Orphans** — see 6b-10 |

---

## 5. Validators run by this session (all exit 0)

| Command | Result |
|---|---|
| `node tools/build.mjs` | BUILD OK — 18 HTML, 6 JS, 0 broken links |
| `node scripts/check_site.mjs` | 18 HTML, 426 links, 1,249 rows, 825 resolved, **0 failures** |
| `node scripts/check_links.mjs` | 16 published pages, 394 local + 225 external links, **0 failures** |
| `node scripts/check_row_sources.mjs` | 271 rendered rows, 413 official links, **0 failures** (new) |
| `npm test` | engine 23/23 · live fixes 3/3 · lib ✓ · fees 50/50 · model 20 · collector 18/18 · root engine 21/21 · portfolio 60/60 · demo-account 89/89 · **collector (Python) 33/33** |
| `python3 scripts/portfolio_engine.py selftest` | 68/68 |
| `node tools/render_test.mjs` (all 16 published pages) | 0 JS errors |

---

## 6. Limits of this review

- The build sandbox has no direct route to `kalshi.co`; live values were re-fetched through
  the page fetcher, and the CI runner (which does have egress) re-runs the collector every
  three hours. Nothing in this review asserts a market value that was not read from a live
  official response.
- The paper brokers are simulations. No order was placed on any account, no credential was
  used, and no claim of profitability is made. The demo-account layer stays inert until the
  owner supplies a demo key (flagged item 9d-5 / F-DA-7).
- The ROI screen, the jump annotations and the news-search links are documented engineering
  choices, not verified alpha and not verified causes. The Kalshi API publishes no news
  endpoint, so no official link can be given for a jump's cause (flagged item 9d-3).
