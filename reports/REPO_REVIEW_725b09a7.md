# Repo review and official-source verification — session `725b09a7`

**Repository:** `wingbangboozle1-lang/Trade1` (Kalshi demo dashboard)
**Branch:** `arena/725b09a7-trade1` · **Base:** `main` @ `a15a941` · **Date:** 2026-11-21 (UTC)
**Scope:** line-by-line review of the published site, the browser engine, the CI ledger and the
collector; every API claim re-checked against the official Kalshi documentation.

Everything below was read from the repository at the commit named above and checked against the
official Kalshi docs linked in each row. Nothing in this report is inferred: where a value could
not be confirmed from an official source it is recorded as **unverified**, not filled in.

---

## 1. What was verified, and how

The build sandbox has no route to `*.kalshi.co` (`curl` to the demo hosts returns exit 35), so
**no live API request was made from this session**. Verification used three independent routes:

1. **The official documentation**, read through the page fetcher on 2026-11-21 (every URL in the
   table below is an official `docs.kalshi.com`, `kalshi.com` or `help.kalshi.com` page).
2. **The raw API samples the collector committed** under `data/samples/` — verbatim responses
   captured by `scripts/collect.py` in GitHub Actions on 2026-11-21T03:59:57Z, each carrying the
   exact request URL that produced it.
3. **The request log** `data/log.md` — one line per request (time, method, URL, HTTP status,
   bytes) for every call the collector made.

Offline validators re-run in this session (all exit 0):

| Command | Result |
|---|---|
| `npm run build` (`node tools/build.mjs`) | BUILD OK — 18 HTML, 6 JS, 0 broken links |
| `node scripts/check_site.mjs` | 18 HTML, 426 links, 1,249 rows, 825 resolved, **0 failures** |
| `node scripts/check_links.mjs` | 16 pages, 394 local + 222 external links, **0 failures** |
| `node tests/engine.test.mjs` | 23/23 |
| `node tests/root_engine.test.js` | 50/50 |
| `node tests/live_fixes.test.mjs` | 3/3 |
| `node tests/portfolio.test.mjs` | 60/60 |
| `node tests/demo-account.test.mjs` | 89/89 |
| `node scripts/test_fees.mjs` | 42 published fee rows + 10 multipliers |
| `node scripts/test_model.mjs` | 20 checks |
| `node scripts/test_lib.mjs` | passed |
| `python3 scripts/portfolio_engine.py selftest` | **76/76** (was 68/68 — 8 added this session) |
| `python3 tests/test_collect.py` | **39 checks** (33 taken over from session `6b112481`, 6 added here) — see §3 |
| `node tests/collector.test.mjs` | 18/18 — the browser classifier against the shared official corpus |
| `node scripts/check_row_sources.mjs` | 271 rendered rows, 413 official links, **0 failures** |
| `node tools/render_test.mjs --wait=9000 <15 published pages>` | 15 pages rendered, **0 JS errors** |

---

## 2. Official-source verification, line by line

| # | Claim in the repo | Where | Official source checked (2026-11-21) | Verdict |
|---|---|---|---|---|
| V1 | Demo REST base is `https://external-api.demo.kalshi.co/trade-api/v2`; `https://demo-api.kalshi.co/trade-api/v2` also supported | `assets/app.js:31`, `scripts/portfolio_engine.py:65`, `scripts/collect.py:31` | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) — "Demo's recommended Trade API root is `https://external-api.demo.kalshi.co/trade-api/v2`"; the table lists exactly these two REST hosts | **Confirmed** |
| V2 | Demo WebSocket hosts `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` / `wss://demo-api.kalshi.co/trade-api/ws/v2` | `README.md`, `docs/`, `flagged.html` | Same page — the WebSocket row lists exactly these two hosts | **Confirmed** |
| V3 | `GET /events` `limit` maximum is **200** (1000 is rejected with 400) | `assets/app.js:35`, `scripts/collect.py:274`, `flagged.html` item 2 | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) — "Required range: `1 <= x <= 200`"; [API Changelog](https://docs.kalshi.com/changelog) — "The default limit is now 200 (previously 100)" | **Confirmed** |
| V4 | `GET /markets` `limit` up to 1000; `tickers`, `event_ticker`, `series_ticker`, `status` filters | `assets/app.js`, `scripts/collect.py`, `assets/portfolio.js:108` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) — `limit` "Required range: `0 <= x <= 1000`"; `tickers` "Comma-separated list of market tickers"; `event_ticker` "Only a single event ticker is supported" | **Confirmed** |
| V5 | `GET /markets/trades` — `ticker`, `min_ts`, `max_ts` in **seconds**, `limit` ≤ 1000 | `assets/app.js:520` | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) — "min_ts and max_ts must be in seconds; millisecond values are rejected with 400 bad_request"; `limit` "Maximum value is 1000" | **Confirmed** |
| V6 | Order book shape: `orderbook_fp.{yes_dollars,no_dollars}` = `[price_dollars, count_fp]`, ascending, **best bid last**, bids only | `assets/app.js` header + `bookViews()`, `scripts/collect.py` | [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data) — "arrays are sorted ascending, best bid last"; "The API only returns bids (not asks) because of the reciprocal relationship"; [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses). Confirmed against the committed raw sample `data/samples/orderbook-sample.json` | **Confirmed** |
| V7 | Candlesticks path `GET /series/{series}/markets/{ticker}/candlesticks`; `period_interval` ∈ {1, 60, 1440}; `start_ts`/`end_ts` in seconds | `assets/app.js:552`, `flagged.html` item 3 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) — path and enum confirmed verbatim | **Confirmed** |
| V8 | Market statuses `initialized / active / inactive / closed / determined / disputed / amended / finalized`; filter mapping `open`→`active`, `settled`→`finalized` | `assets/app.js:393`, `flagged.html` item 1 | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) — the status table and the filter-mapping table are reproduced verbatim | **Confirmed** |
| V9 | A settled market carries `result` ∈ {yes, no}, `settlement_ts`, `settlement_value_dollars`, `status: "finalized"` | `assets/app.js` settlement detection, `scripts/collect.py` | Official market schema; confirmed against `data/samples/market-settled-sample.json` (raw response: `"result": "no"`, `"status": "finalized"`, `"settlement_ts": "2026-11-21T04:01:27.906398Z"`) | **Confirmed** |
| V10 | Taker fee = `roundup(M × 0.07 × C × P × (1−P))`; maker = `roundup(M × 0.0175 × C × P × (1−P))`; **no settlement fee**; M default 1 (maker default 0) | `assets/model.js`, `scripts/portfolio_engine.py`, `data/fee_schedule_series.json` | [Kalshi fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) — "Last updated and effective: July 7, 2026"; the formula and both tables were read and every one of the **42 transcribed rows + 10 no-fee multipliers** was checked against the PDF line by line | **Confirmed** |
| V11 | `GET /series/{ticker}` returns `fee_type: "quadratic"` and `fee_multiplier` | `assets/model.js` `noteSeriesFee()`, `scripts/portfolio_engine.py` `fetch_series_fees()` | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) — response schema lists `"fee_type": "quadratic"` and `"fee_multiplier": 123` as required fields | **Confirmed** (the *linkage* to the schedule's `M` remains an inference — flagged item 6b) |
| V12 | `GET /markets/{ticker}` is the official per-market record | **new this session** — `scripts/portfolio_engine.py` `api_market_url()`, `assets/portfolio.js` `apiUrl()` | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) — "Endpoint for getting data about a specific market by its ticker" | **Confirmed** |
| V13 | `GET /series` supports `category`, `tags`, `include_volume` and **has no `limit` parameter** (a `limit` sent by the engine is ignored) | `assets/app.js:257`, `scripts/collect.py:295`, `EXECUTIVE_SUMMARY.md` | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) — the documented query parameters are `category`, `tags`, `include_product_metadata`, `include_volume` only | **Confirmed** (the engine's extra `limit` is a harmless no-op; recorded as I-725-1) |
| V14 | WebSocket requires a signed handshake, so a static page cannot use it; the site polls REST | `assets/app.js` header, `README.md`, `methods.html` | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) + [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) — the `KALSHI-ACCESS-*` headers must be attached during the handshake, which a browser `WebSocket` cannot do | **Confirmed** |
| V15 | Every published table row links an official source URL on the demo API base | `scripts/check_site.mjs`, `data/*.json` | The check enforces `source_url.startsWith(base + '/markets/')` on every snapshot row, every resolved row and every topic event row | **Confirmed** (1,249 rows + 825 resolved rows, 0 failures) |
| V16 | CORS: the demo hosts echo any `Origin` and the preflight returns 204 | `data/cors.json`, `index.html` | `data/cors.json` holds the verbatim response headers from a GitHub-hosted runner on 2026-11-20 | **Confirmed** (probed from CI; not re-probed this session — no egress from the sandbox) |

### Fee schedule — row-by-row check against the PDF

The 42 transcribed rows in `data/fee_schedule_series.json` and the 10 no-fee multipliers in
`assets/model.js` (`NONSTANDARD_TAKER_MULTIPLIER`) were compared with the official PDF's
"Non-Standard Fees" table. **Every row matched** — including the ten `M = 0` series
(`KXBTCY`, `KXCITRINI`, `KXDOED`, `KXELECTIRAN`, `KXETHY`, `KXGAMBLINGREPEAL`, `KXGREENLAND`,
`KXIRANDEMOCRACY`, `KXLAYOFFSYINFO`, `KXPAHLAVIHEAD`) and the tracked-topic series
`KXAAAGASM` (US gas price, 1/1) and `KXPGATOUR` (PGA Tour, 1/1). The PDF's OCR-garbled sports
pages are the ones listed under `not_transcribed`; those series fall back to the documented
default `M = 1` and are disclosed. No discrepancy was found.

---

## 3. Defects found in this pass

### D1 — settled markets were classified without the topic's exclusion rules *(fixed)*

> **Reconciliation note.** Three sessions found this defect independently while it was open
> (flagged items 9d-1 and 691-11). Session `d256bfac` had already merged a fix (PR #65,
> `6b0bdac`) before this session's branch was rebased onto it; sessions `c96a21b7` (PR #64) and
> `6b112481` (PR #68) had the same fix open in parallel. This session therefore **did not add a
> second implementation**: it adopted the merged `keyword_match()` / `topic_excluded()` /
> `classify_settled_without_event()` code, kept its one genuine improvement (the fallback now
> receives the series guessed from the event ticker, so the series-prefix rule can still match a
> settled row whose event is gone), and added the single `classify_settled()` entry point that
> both the collector and the regression gate call. The parallel PRs' unique work was taken over
> rather than duplicated — see §7.

**Where:** `scripts/collect.py`, the settled-market fallback (the branch used when a settled
event is no longer returned by `GET /events?status=open`, so no category is available).

**What was wrong.** The fallback applied the topic's `series_prefix` and `title_keywords` but
**not** its `exclude_keywords`, and it matched `title_keywords` as an unanchored substring.

**Effect in the published data.** Four rows in `data/resolved.json` (snapshot generated
2026-11-21T03:59:57Z) were filed under `gas-prices` while being natural-gas markets:
`KXNATGAS15M-26NOV202300-00`, `KXNATGAS15M-26NOV202245-45`, `KXNATGAS15M-26NOV202230-30`,
`KXNATGAS15M-26NOV202215-15` ("Natural Gas price up in next 15 mins?"). The gas topic's own
rule in `scripts/topics.json` excludes natural gas
(`exclude_keywords: "natural gas|natgas|propane|heating oil"`). The same unanchored match is
why "Petrolul" (a Romanian basketball club) matched the gas keyword "petrol" — the row
`KXROMLNBMGAME-26NOV201200PLOPIT-PLO` was reported by the earlier session (item 9d-1).

**Fix.** The fallback now honours `exclude_keywords` and matches `title_keywords` on word
boundaries (`scripts/collect.py` → `classify_settled_fallback()`, `keyword_regex()`).

**Gate.** `tests/test_collect.py` (taken over from session `6b112481`'s PR #68 and extended
here) runs 39 checks on every push and pull request. It pins both rules against the four
published tickers and against the "Petrolul" case, proves that **only** the natural-gas rows
change topic ("no other resolved row changed topic"), and fails if the published snapshot still
contains a gas row the gas rule excludes. `tests/collector.test.mjs` runs the same official
corpus (`tests/fixtures/topic_cases.json`) through the **browser** classifier
(`assets/model.js`), so the two implementations that must stay in sync are checked against
identical inputs — and `assets/model.js` was given the same word-boundary treatment.

**Status in this repo:** the code is fixed; the *published snapshot* still carries the four
stale rows until the collector regenerates `data/`. That regeneration is part of this session's
integration (see `COORDINATION.md` → 725-T5).

### D2 — every ledger row linked the whole batch, not its own market record *(fixed)*

**Where:** `scripts/portfolio_engine.py` (the always-on CI paper-trading ledger).

**What was wrong.** `enter()`, `run_cycle()` and the exit/settle paths set each row's `source`
to `sources[0]` — the *first* URL of the cycle's batched quote request, i.e.
`GET /markets?tickers=<~400 tickers>`. All 11 trades, 29 alerts and 21 resolutions in the
committed `data/portfolio.json` carried that identical 4 KB URL, so a row's "source" did not
identify that row's market.

**Fix.** `api_market_url(ticker)` builds the official per-market record
`GET /markets/{ticker}` (official [Get Market](https://docs.kalshi.com/api-reference/market/get-market))
and every trade / exit / resolution / alert row now carries it. The batch endpoint that
produced the quote is still published in `sources.quote_endpoints` and in `data/log.md`, so
nothing is lost. `assets/portfolio.js` renders the canonical per-market URL and labels the
links "market record" / "exit record".

**Gate.** 8 new checks in `scripts/portfolio_engine.py selftest` (68 → 76) pin the URL form
and the fallback for rows whose source is missing.

> This is the substantive part of the stale PR #58 (session `6916270f`, last commit
> 2026-11-20 20:50Z, `CONFLICTING` with `main`). It is taken over here and re-applied against
> the current `main` rather than merged verbatim; see `COORDINATION.md`.

### D3 — the settled-market sweep was truncated, so the published denominator over-stated completeness *(fixed)*

**Where:** `scripts/collect.py` → `paged()` and the `data/resolved.json` writer.

**What was wrong.** The 72-hour settled sweep used the collector's default page cap
(`MAX_PAGES = 6`, i.e. 6 × 1,000 markets). The request log shows the sweep **stopped at page 6
with a cursor still present**:

```
04:02:59Z   page 6: +1000 items (total 6000); cursor=present
04:02:59Z settled markets collected (last 3 days): 6000
```

So `settled_total: 6000` was the collector's cap, not the exchange's count for the window, and
the derived `in_scope_count: 1904` was a **lower bound**. The Resolved page rendered it as
"200 of 1,904 in-scope settled markets", which reads as a complete population.

**Fix.**
* `paged()` now returns pagination facts (`pages`, `max_pages`, `truncated`, `returned`) and
  logs a `PAGINATION TRUNCATED` line when the cursor is still present.
* The settled sweep's cap is raised to `SETTLED_MAX_PAGES = 20` (20,000 markets).
* `data/resolved.json` publishes `settled_pagination`, `settled_total_is_lower_bound`,
  `in_scope_count_is_lower_bound` and `rows_published`.
* `resolved.html` states the denominator as a lower bound and names the truncation.
* `data/meta.json` publishes the same facts for the events and markets sweeps.

**Status in this repo:** code fixed; the published snapshot gains the new fields on the next
collector run.

---

## 4. Irregularities and limitations (non-blocking, published on the Flagged page)

| # | Item | Why it is not "fixed" | Official source |
|---|---|---|---|
| I-725-1 | The engine sends `limit: '200'` to `GET /series`; the endpoint has no `limit` parameter, so it is ignored. Harmless, already documented in `EXECUTIVE_SUMMARY.md`. | The request works either way; changing it would not alter any published number. | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list) |
| I-725-2 | The demo-account layer (`demo-account/`) is inert: `KALSHI_DEMO_KEY_ID` / `KALSHI_DEMO_PRIVATE_KEY` are not set, so `data/demo_account/status.json` reports `configured: false` and **no request is sent**. Real demo balances, positions and orders therefore cannot be shown. | Needs a human to create a demo account and key. Not faked. | [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) · [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance) |
| I-725-3 | "Est. traded $" is computed (contracts × last price). The API publishes no per-market dollar-notional field, so the highest-dollar ranking is a labelled estimate. | Not inferable from an official field. | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| I-725-4 | The two official per-series fee sources disagree (`M = 0` in the published schedule vs `fee_multiplier: 1` from the demo API for the same series). The demo value wins at runtime; both are published. | An inference, not a documented equivalence. | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) · [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| I-725-5 | Maker fees are not modelled (paper fills assume an immediately matched taker fill). | Documented simplification. | [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| I-725-6 | News links on alerts are Google News searches labelled "lead". No claim is made that any news item caused a move. | Causality cannot be verified automatically. | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) (`settlement_sources`) |
| I-725-7 | The ROI score (0.30 / 0.25 / 0.20 / 0.25) is a documented heuristic, not backtested alpha. The ledger's track record is short (11 trades at the time of review) and its −60% ROI is a small sample, not evidence. | No performance claim is made. | [Methods §3](methods.html) |
| I-725-8 | The browser engine and the CI ledger implement two different (both documented) fee-rounding treatments, so their simulated P&L can differ slightly. | Deliberate; documented in [Methods §§8–9](methods.html). | [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) |
| I-725-9 | The Resolved page lists the newest 200 in-scope settled markets; the pool behind it is a lower bound (D3). | Disclosed, not hidden. | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) (`status=settled`, `min_settled_ts`) |
| I-725-10 | `data/log.md` records the *request* for each fetch but not the full response body (except for the four committed samples under `data/samples/`). Field-level re-verification therefore relies on those samples plus the committed snapshots. | Storing every body would multiply the repository size. | — |

---

## 5. Files reviewed line by line

| File | Lines | Reviewed for | Result |
|---|---|---|---|
| `assets/app.js` | 1,277 | endpoint/parameter correctness, escaping, null-safety, settlement detection, chart windows | No defect found. All `innerHTML` insertions of market titles pass through `esc()`; the canvas context is null-guarded; the settlement check covers `finalized / determined / amended / settled / closed` with a `yes`/`no` result, matching the documented lifecycle. |
| `assets/model.js` | 490 | fee arithmetic, topic classification, alert threshold | The classifier honoured `exclRe` before the category branch, so the live path was not affected by D1 — but its **title** keywords were matched as raw substrings while the collector now matches them on word boundaries. **Fixed here** (word-bounded `boundedRe()`), with `tests/collector.test.mjs` locking the two implementations together. The fee function computes in integer arithmetic and reproduces all 21 published table rows. |
| `assets/portfolio.js` | 485 | row sources, live polling, escaping | **D2 fixed** (per-market record + labels). |
| `scripts/collect.py` | 613 | classification rules, pagination, source recording | **D1 and D3 fixed.** The D1 implementation is the one merged by session `d256bfac`; this session added the `classify_settled()` entry point and the pagination facts. |
| `scripts/portfolio_engine.py` | 1,443 | fee maths, alert threshold, ledger invariants, row sources | **D2 fixed**; self-test extended 68 → 76 checks. |
| `tests/test_collect.py` | 239 | **taken over** from session `6b112481` and extended — regression gate for D1/D3 | 39 checks (33 taken over + 6 added here). |
| `tests/collector.test.mjs` | 80 | **taken over** — the browser classifier against the same official corpus | 18 checks. |
| `tests/fixtures/topic_cases.json` | 105 | **taken over** — the shared official corpus (every case carries its official source URL) | 10 cases. |
| `scripts/check_row_sources.mjs` | 180 | **taken over** — renders the published pages in jsdom and proves each rendered row links its own official record | 271 rows, 413 official links, 0 failures. |
| `scripts/check_site.mjs` | 112 | per-row official source enforcement | No defect found. 1,249 rows + 825 resolved rows verified. |
| `scripts/check_links.mjs` | — | local links, nav parity, external-link domain enforcement | No defect found. |
| `data/fee_schedule_series.json` | 102 | transcription vs the official PDF | All 42 rows + 10 multipliers confirmed (§2). |
| `data/resolved.json` | 200 rows | topic labels vs the topic rules | **4 rows violate the gas rule** (D1) — fixed in the collector; the snapshot is regenerated by CI. |
| `data/topics/*.json` | 2,377 events | topic labels vs the topic rules | **0 violations.** The open-events path was never affected by D1. |
| `data/samples/*.json` | 4 files | verbatim field shapes | All match the documented schemas. |
| `*.html` (18 published pages) | — | link integrity, nav parity, JS boot | 0 broken links; 15 pages rendered in jsdom with 0 JS errors. |
| `demo-account/**` | — | credential handling | Sends nothing without the owner's key; `status.json` records `configured: false`. |

---

## 6. Repository hygiene

* `node_modules/` is untracked and `.gitignore`d; the committed tree is 5.8 MB, of which
  `data/snapshot.json` (1.5 MB) is the largest file.
* `package-lock.json` is committed; CI installs `jsdom@26.1.0` pinned, matching the local run.
* No credentials, keys or tokens appear anywhere in the tree. `KALSHI_DEMO_KEY_ID` /
  `KALSHI_DEMO_PRIVATE_KEY` appear only in documentation and in the code that reads them from
  the environment; a grep for private-key headers and for key-shaped literals over every
  source file returns no material.
* `data/portfolio.json` and `data/portfolio_state.json` are written by the ledger workflow, not
  by hand; `data/` snapshots are written by the collector workflow, not by hand.
* The `main` branch's last commit before this session (`a15a941`) is the scheduled ledger run;
  the working tree was clean and identical to `origin/main` when this session started.

---

## 7. Reconciliation with the concurrent sessions

Four other sessions were active on this repository at the same time. Their work was **taken
over, not discarded**; nothing of theirs was reverted.

| Session | PR | What it did | How it was reconciled |
|---|---|---|---|
| `d256bfac` | #65 (merged), #67 (open) | Repaired the settled-market topic fallback: `keyword_match()`, `topic_excluded()`, `classify_settled_without_event()`; added `tests/test_collect.py`; disclosed the stale snapshot on the Resolved page | **Adopted.** Its implementation is the one in `scripts/collect.py` now. This session added the `classify_settled()` entry point, the series-guess improvement, and the pagination facts on top. |
| `c96a21b7` | #64 (open) | The same D1 fix, with a board record | **Superseded** by the merged PR #65 and by this branch. Its board record is additive and is merged with the rest of `COORDINATION.md`. |
| `6b112481` | #68 (open, `CONFLICTING`) | Repo review, the D1 fix, a per-row official-link gate, a collector↔browser classifier parity test, and the takeover of stale PR #58 | **Taken over** — `scripts/check_row_sources.mjs`, `tests/collector.test.mjs`, `tests/fixtures/topic_cases.json` and the extended `tests/test_collect.py` are now in this branch, plus the browser-side word-boundary fix in `assets/model.js`. Its `scripts/portfolio_engine.py` change (the per-row market record) is identical to this session's and was re-applied here against the current `main`. Its duplicate D1 implementation was not taken over (the merged one is in place). |
| `6916270f` | #58 (open, stale since 2026-11-20 20:50Z) | Per-row official market-record links in the CI ledger + a final coordination record | **Taken over** — the substantive change is `api_market_url()` in `scripts/portfolio_engine.py`, which this session implemented identically and extended with 8 self-test checks. PR #58 is closed by this session's PR. |

**Merge conflicts encountered and how they were resolved** (nothing was dropped):

1. `COORDINATION.md` — every session appended its own block at the end of the file, so the
   rebases conflicted. Resolved **additively**: main's blocks (sessions `504976fa`, `31a8a56b`,
   `d256bfac`) and this session's block are all kept, in order.
2. `scripts/collect.py` — this session's duplicate D1 implementation conflicted with the merged
   one. Resolved in favour of the merged implementation; the duplicate was removed.
3. `flagged.html` and `resolved.html` — the D1 rows were updated by more than one session.
   Resolved in favour of main's wording (which already records the fix and the pending snapshot
   refresh); this session's D3 "Denominator" disclosure was kept alongside it.

---

## 8. Sources

All official, all read on 2026-11-21 (or, where a date is given, on the date shown):

* Demo environment and endpoints — https://docs.kalshi.com/getting_started/demo_env
* API environments — https://docs.kalshi.com/getting_started/api_environments
* Get Events — https://docs.kalshi.com/api-reference/events/get-events
* Get Markets — https://docs.kalshi.com/api-reference/market/get-markets
* Get Market — https://docs.kalshi.com/api-reference/market/get-market
* Get Series — https://docs.kalshi.com/api-reference/market/get-series
* Get Series List — https://docs.kalshi.com/api-reference/market/get-series-list
* Get Market Candlesticks — https://docs.kalshi.com/api-reference/market/get-market-candlesticks
* Get Trades — https://docs.kalshi.com/api-reference/market/get-trades
* Get Market Orderbook — https://docs.kalshi.com/api-reference/market/get-market-orderbook
* Orderbook responses — https://docs.kalshi.com/getting_started/orderbook_responses
* Quick Start: Market Data — https://docs.kalshi.com/getting_started/quick_start_market_data
* Quick Start: WebSockets — https://docs.kalshi.com/getting_started/quick_start_websockets
* Quick Start: Authenticated Requests — https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
* Market Lifecycle — https://docs.kalshi.com/getting_started/market_lifecycle
* Market Settlement — https://docs.kalshi.com/getting_started/market_settlement
* Fixed-point units — https://docs.kalshi.com/getting_started/fixed_point_migration
* Pagination — https://docs.kalshi.com/getting_started/pagination
* Rate limits — https://docs.kalshi.com/getting_started/rate_limits
* Fee rounding — https://docs.kalshi.com/getting_started/fee_rounding
* Fee schedule (PDF, effective July 7, 2026) — https://kalshi.com/docs/kalshi-fee-schedule.pdf
* Fee schedule (public page) — https://kalshi.com/fee-schedule
* API changelog — https://docs.kalshi.com/changelog
* Documentation index — https://docs.kalshi.com/llms.txt
* Live site — https://wingbangboozle1-lang.github.io/Trade1/
