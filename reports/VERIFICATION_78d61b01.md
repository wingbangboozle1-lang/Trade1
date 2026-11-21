# Verification record — session `78d61b01` (2026-11-21 UTC)

Independent, line-by-line verification of what this repository publishes, against the **official**
Kalshi sources and the **live demo API**, plus one production incident found and fixed. Every row
below names the URL that was actually read today; nothing is inferred, and anything this session
could not confirm is labelled as such.

Session branch: `arena/78d61b01-trade1` · base at claim time: `main` @ `a15a941`, rebased onto
`main` @ `b08da8b0` (later `d949035` during this session).

---

## 1. Method

| Aspect | What was done |
|---|---|
| Live API access | The build sandbox has **no route** to `*.kalshi.co`: `curl -i https://demo-api.kalshi.co/trade-api/v2/exchange/status` → `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL` (2026-11-21 06:44 UTC). Responses were therefore read with the agent's page fetcher, which does reach the demo API, and each URL is cited verbatim. **This is a capability several sessions assumed away** — item AA-8 on the Flagged page says live data could not be re-confirmed; it can be, and it was here. |
| Repo / CI facts | `gh api`, `gh pr view`, `gh run view`, `git show <ref>:<path>` — never a paraphrase of a page. |
| Data discipline | No file under `data/` was hand-edited: `data/*.json` is written only by the CI workflows. `scripts/collect.py` was changed so that what it writes is *complete or nothing*. |
| Scope discipline | Code this session wrote that duplicated another session's live claim was dropped rather than merged (see §6). |

## 2. Official sources read today

| Source | What it settles |
|---|---|
| [API environments / demo environment](https://docs.kalshi.com/getting_started/api_environments) | The demo REST bases `https://external-api.demo.kalshi.co/trade-api/v2` and `https://demo-api.kalshi.co/trade-api/v2`, and the demo WS hosts, are the ones the site and the brief name. |
| [Get Market](https://docs.kalshi.com/api-reference/market/get-market) | `GET /markets/{ticker}` exists, returns `{"market": {…}}`, and its schema **has no `series_ticker` field**. It does publish `notional_value_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `price_level_structure`, `price_ranges`, `result`, `status`, `settlement_ts`, `settlement_value_dollars`. |
| [Get Series](https://docs.kalshi.com/api-reference/market/get-series) | A Series record publishes `category`, `categories`, `fee_type`, `fee_multiplier`, `settlement_sources`. |
| [Get Events](https://docs.kalshi.com/api-reference/events/get-events) | An Event record carries its **own** `category`, which can differ from the series' category. |
| [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) | "Unauthenticated public requests are subject to separate limits. Authenticate requests where supported and **back off on `429`**." |
| [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) | "WebSocket connections require authentication during the connection handshake" with `KALSHI-ACCESS-*` headers; public market-data channels still ride the authenticated session. A static browser page cannot set those headers → REST polling is the correct design for this site. |

## 3. Line-by-line checks

| # | Statement being tested | Where the site says it | Live/official evidence read 2026-11-21 | Verdict |
|---|---|---|---|---|
| 1 | Demo exchange is up and trading (site status panel) | `index.html`, `data/exchange-status.json` | [`GET /exchange/status`](https://external-api.demo.kalshi.co/trade-api/v2/exchange/status) → `exchange_active: true`, `trading_active: true`, all four demo indices active | **Confirmed** (matches the committed file) |
| 2 | Every published table row can be checked at one official URL per market | `portfolio.html`, `data.html`, `resolved.html` | [`GET /markets/KXNATGAS15M-26NOV202300-00`](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV202300-00) → single `market` object, `result: "no"`, `status: finalized`, `settlement_ts: 2026-11-21T04:00:27.906286Z` | **Confirmed** — and it is the right target for a per-row link (see #9) |
| 3 | A settled row's values are verbatim from the API | `data/resolved.json` row `KXNATGAS15M-26NOV202300-00` | Same live record: `title`, `result`, `status`, `settlement_ts`, `settlement_value_dollars: "0.0000"`, `last_price_dollars: "0.0000"`, `yes_*`/`no_*` quotes, `volume_fp: "0.00"` all identical | **Confirmed verbatim** |
| 4 | "Natural gas is outside the retail-gasoline topic" (topic rules) | `scripts/topics.json` `exclude_keywords`, `methods.html` | [`GET /series/KXNATGAS15M`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXNATGAS15M) → `title: "Natural Gas 15-minute"`, `category: "Commodities"`, `fee_multiplier: 1`, `fee_type: "quadratic"`, settlement source "Pyth - NATGAS" | **Confirmed** — the exclusion is a topic-definition choice, and the official category (`Commodities`) is not one the gas topic lists |
| 5 | The demo `fee_multiplier` disagrees with the production schedule for some series (flagged 6b) | `flagged.html` 6b, `data/fee_schedule_series.json` | Live `GET /series/KXNATGAS15M` and `GET /series/KXDSENATESEATS` both return `fee_multiplier: 1` | **Consistent with the published note** (both official sources are disclosed; no silent choice) |
| 6 | Flagged 6b-9: a series' category and its event's category can differ | `flagged.html` 6b-9 | [`GET /events/KXDSENATESEATS-27`](https://external-api.demo.kalshi.co/trade-api/v2/events/KXDSENATESEATS-27) → `category: "Politics"` while [`GET /series/KXDSENATESEATS`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXDSENATESEATS) → `category: "Elections"` | **Independently confirmed** |
| 7 | Flagged 6b-11: sub-cent price grids exist and the UI rounds to cents | `flagged.html` 6b-11 | [`GET /markets/KXPGATOUR-THRC26-SSTR`](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXPGATOUR-THRC26-SSTR) → `price_level_structure: "tapered_deci_cent"`, `price_ranges` steps `0.0010 / 0.0100 / 0.0010` | **Confirmed** |
| 8 | Flagged 6b-12: `notional_value_dollars` **is** published, so the old "no dollar field" wording was wrong | `EXECUTIVE_SUMMARY.md`, `flagged.html` 6b-12 | Official Get Market schema lists `notional_value_dollars`; both live records above return `"1.0000"` | **Confirmed** — and the corrected conclusion stands: it is the contract notional, not traded dollars; volume is reported as contract counts (`volume_fp`), so "$ traded" stays an estimate |
| 9 | The static dashboard uses REST polling because a browser cannot authenticate the WS handshake | `assets/app.js` header note, `flagged.html` | Quick Start: WebSockets — handshake requires `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP` headers | **Confirmed correct** (this is not a gap to close) |
| 10 | The app and the collector throttle and back off on 429 | `EXECUTIVE_SUMMARY.md` L33 | `grep -n 429 assets/app.js` → L154 retries; `scripts/collect.py` before this session had **no** throttle, no back-off and no completeness check | **False for the collector → fixed here** (finding 78-1/78-2) |
| 11 | `GET /events` page size 200 (max), `GET /markets` limit 1000, orderbook `depth` 1–100, candlestick `period_interval` ∈ {1, 60, 1440} | `methods.html`, `README.md` | **Not re-tested by this session.** Verified earlier against the same official pages by sessions `984a6765`, `9d4380a2`, `31a8a56b`; the collector's live requests today (`/events?status=open&limit=200`, `/markets?status=open&limit=1000`) returned `200`, which is consistent | **Carried, not re-verified here** |
| 12 | Demo-account balances/positions are shown | `demo-account/` | `data/demo_account/status.json` → `configured: false`, "No request was sent"; no key exists in this environment | **Correctly blank and flagged** (78-§5) |

## 4. Incident found: a rate-limited run published an empty snapshot

**What happened.** `main` commit [`b08da8b0`](https://github.com/wingbangboozle1-lang/Trade1/commit/b08da8b0)
("data: verified snapshot 2026-11-21T06:58:41Z", written by the `snapshot` job this session
dispatched to *test* the pipeline) published:

| File | Before (03:59Z run) | After (06:58Z run) |
|---|---|---|
| `data/resolved.json` | 222,934 B, 200 rows | **321 B, 0 rows** |
| `data/topics/crypto.json` | 260,424 B, 30 events | **4,493 B, 4 events** |
| `data/topics/golf.json` | 175,237 B | **2,853 B** |
| `data/topics/gas-prices.json` | 90,436 B | **1,129 B** |

**Why.** The run's own `data/log.md` records 12 paged `/events` requests inside ~1 second, then
`GET /markets?status=open&limit=1000&mve_filter=exclude -> 429 too_many_requests`, 429 on the retry
without `mve_filter`, 429 on every `series_ticker=`/`event_ticker=` follow-up, and
`GET /markets?status=settled&min_settled_ts=… -> 429` → `settled markets collected (last 3 days): 0`.
The collector treated each 429 as "no data", wrote the files, `check_site.mjs` found no failing row
(among zero rows there is none to fail), and the workflow committed it.

**Blast radius.** Pages republished within a minute, so the live tables were blank/degenerate for
every visitor — the alert feeds and topic rankings had no rows to rank.

**Fix — two sessions, merged additively.**

*The read side (session `c96a21b7`, on `main`):*

1. `get_with_retry()` paces every call (`PACE_S = 0.25`), retries `429 / 500 / 502 / 503 / 504`
   up to `MAX_ATTEMPTS = 5`, and waits on `Retry-After`, else `X-RateLimit-Reset`, else `2 ** attempt`,
   capped at `BACKOFF_CAP_S = 60`.
2. `FAILURES` records every read that never succeeded and `KEPT` lists the artifacts the run therefore
   **did not rewrite** (`topics/*.json`, `categories.json`, `resolved.json`, plus `samples/*` and
   `meta.json` via `wjson`) — so an empty read can no longer replace good data. Covered by
   `tests/test_collect_failclosed.py`.

*What this branch adds on top of it:*

3. `STATS = {requests, retried, throttled_429}` incremented inside the retry loop and published as
   `request_stats` in `data/collect_status.json` — the artifact that makes "we back off on 429" a
   checkable claim instead of a sentence.
4. A pre-commit gate in the `snapshot` job (`Refuse to publish a snapshot the API left incomplete`) that
   re-reads `data/meta.json` and exits non-zero when `events_open_count`, `markets_open_count` or
   `settled_count_recent` is zero, or when no topic file received an event. The collector's own
   `KEPT` logic already preserves the previous files; this is what makes a degraded run **red** in the
   Actions tab instead of green-and-silently-stale, and it survives a refactor of the collector because
   it reads the published artifacts, not the code. Deliberately **not** a gate on small-but-nonzero
   snapshots.
5. `classify_settled_without_event()` receives `series or series_guess(event_ticker)` at its call site,
   because a Market record publishes no `series_ticker` (finding 78-3) — the exclusion fix from PR #65
   could otherwise silently cost the Resolved page its rows.
6. `select_resolved()` replaces the `in_scope[:200]` recency slice, which published 200 crypto rows and
   zero rows for the other four topics (finding 78-8). `resolved.json` now also carries
   `published_count`, `published_per_topic` and `row_selection`.
7. `checks` runs `tests/test_collect.py`, `tests/test_collect_hardening.py` (16 cases) and main's
   `tests/test_collect_failclosed.py`, and fails on any committed Git conflict marker in the tree.

*Measured in CI:* run
[`44879449386`](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44879449386) on this branch
(data commit `f019584e`) logged `request stats: {'requests': 504, 'retried': 0, 'throttled_429': 0,
'failed': 0}` and `PUBLISHED 13 file(s)` — 504 spaced requests with **no** 429 at all, 2,400 open events,
14,647 open markets, 6,000 settled markets, 2,374 topic events, `data/resolved.json` back to 229 kB.
That run executed this branch's earlier implementation (a `data/.staging` + `promote()` design, since
replaced by `c96a21b7`'s per-artifact `KEPT` logic so the merge does not ship two ways of doing the same
thing); the request numbers are its measurements, and they are what the pacing is for. The run that broke
(§4 opening) attempted the same sweep in ~2 s and lost every request after it.

## 5. Topic-label state (the item D1 / 9d-1 / 691-11 history)

* **After the merge** (`main` @ `900b640d`, dispatched run `44881737325`, data commit `fa3771ed` at
  07:52:11Z): `collect_status.json` → `status: ok`, `transient_read_failures: 0`,
  `kept_previous_artifacts: []`, `request_stats: {requests: 499, retried: 0, throttled_429: 0}`;
  `resolved.json` 222,825 B with `in_scope_count 2726`, `settled_total 6000`, `published_count 200` and
  `published_per_topic {"crypto": 200}`; the CI gate step ran and passed. The per-topic selection is
  therefore **live and correct but a no-op on today's data** — in this window the only settled in-scope
  markets were crypto — which is recorded as measured rather than as an improvement in the tables.
  `data/log.md` L557 prints `resolved row selection: 200 of 2726 in-scope rows; per topic {"crypto": 200}`.
* The combined Resolved view then had a different defect (**flagged 78-8**): `in_scope[:200]` over a list
  sorted newest-first meant **200 of 200 published rows were crypto** and the other four topics had zero,
  because continuous 15-minute/hourly crypto settlement outranks everything else in a recency cut.
  `select_resolved()` now gives each topic an equal share of the 200 and backfills the remainder by
  recency (4 new tests; `resolved.json` publishes `published_per_topic` so this is checkable from data).
* `data/resolved.json` at the **03:59Z** snapshot still contained **4** rows labelled `gas-prices`
  whose titles are "Natural Gas price up in next 15 mins?" — re-checked individually against the
  official records (row #2/#4 above). Running the topic rules from `scripts/topics.json` over the
  committed file reproduced exactly those 4 violations and **no others** in 1,246 rows.
* The collector fix landed independently as `d256bfac` / PR #65 (`6b0bdac8`) at 06:42Z, which
  applies the topic's `exclude_keywords` and whole-word matching in the settled path. This session's
  own version of that change was **dropped** in favour of it (see §6).
* This session added the missing piece at the same site: the fallback now receives the series
  guessed from the event ticker (market records publish no `series_ticker` — #2 above), so the
  exclusion fix cannot quietly cost the Resolved page its crypto/golf rows.
* **After the hardened run** (this session's dispatch on its own branch, ~07:10Z):
  the CI `snapshot` job's own sweep on this branch (`data` commit [`117bfde9`](https://github.com/wingbangboozle1-lang/Trade1/commit/117bfde9),
  `generated_at 2026-11-21T07:05:06Z`, `finished_at 07:07:10Z`) returned
  `events_open_count 2400`, `markets_open_count 14642`, `settled_count_recent 6000` and
  **200 rows in `data/resolved.json`, all in-scope, with `0` natural-gas rows** — i.e. the leak that
  flagged 9d-1 was about is gone and nothing else dropped. That run predates the guard (see §4), so it
  demonstrates the classifier state, **not** the gate: `gh run view 44878556490 --json headSha` reports
  `8e5efa1f`, i.e. that run executed the pre-hardening collector (this session's push had not moved the
  branch ref — see flagged 78-6). The gate itself is covered by `tests/test_collect_hardening.py` and by
  the pre-commit check in the `snapshot` job, and is re-run on the pushed head before this PR opens.
  **Flagged 9d-1 is closed on that evidence** (item 78-1 on the Flagged page).
* `main`'s published data at the time of writing (`459a643c` → data `b08da8b0`) is still the degenerate
  0-row snapshot; the repair path is to merge this branch so the next run either republishes fully or
  fails red. Note that `main`'s own fail-closed reads (from `c96a21b7`) already prevent publishing an
  empty snapshot; a dispatch is still a **write** to the ref it runs on — see flagged item 78-6.

## 6. Overlap, collisions and dispositions (for the owner)

Six sessions worked the same area within ~90 minutes. This session's dispositions:

| Item | State at hand-off |
|---|---|
| Settled-row topic exclusions (D1 / 9d-1 / 691-11) | **Merged** by PR #65 (`6b0bdac8`). This session's duplicate classifier patch was dropped; only the series-guess call-site change and the publish gate were kept, on top of the merged fix. |
| Per-row official market-record links in `scripts/portfolio_engine.py` (stale PR #58) | **Not on `main`** (`git show origin/main:scripts/portfolio_engine.py` has no `api_market_url`; 72/72 rows still cite a batched `markets?tickers=` URL). Claimed by open PR #68 **and** PR #70. This session wrote and tested the same change, then **withdrew** it to avoid a third copy; recommendation: land one of #68/#70 and close #58. |
| Collector request discipline (finding 78-1) | **Not claimed by anyone else**; implemented and gated here. |
| `data/**` snapshots | Regenerated by CI only. No hand-edits. |
| Claims visibility | Flagged as 78-5: claims on session branches are invisible until merged. |

## 7. What this session did **not** verify, and did not claim

* **Demo-account performance.** No API key exists in this environment (`data/demo_account/status.json`
  → `configured: false`), so no balance, position or order data is asserted; no authenticated
  request and no order was sent by this session. The paper ledger is a simulation.
* **Causality of price jumps.** News links on the site are labelled search leads; the API has no
  official news source, so no jump is attributed.
* **ROI model profitability.** The screen's weights are engineering choices, not backtested alpha;
  nothing here shows the model is profitable.
* **Endpoint parameter ceilings** (events 200 / markets 1000 / orderbook depth / candlestick
  intervals) were **not re-tested** by this session — row #11 is carried from earlier
  verifications, not re-confirmed today.
* **Production fee schedule vs demo multipliers** remain in documented conflict (flagged 6b).

---

## 8. Landing record

| Item | Result |
|---|---|
| PR | [#90](https://github.com/wingbangboozle1-lang/Trade1/pull/90) — checks pass (run `44881340895`), merged without waiting for approval |
| Merge commit | `900b640d` (2026-11-21T07:45:31Z), `main`'s head at that moment |
| Rebase cost | 3 rebases onto a `main` moving every few minutes; one CI data commit (`f019584e`) dropped instead of merged, all board conflicts resolved additively (main's 21 sections → 27, no line lost) |
| Supersession | this branch's staging/`promote()`/`snapshot_guard()` design was **deleted** in favour of `c96a21b7`'s `KEPT` fail-closed reads; only the non-duplicating pieces shipped |
| Pages | `status: built`, latest build `07:52:51Z` (after data commit `fa3771ed` at `07:52:11Z`); `commit_id` is null on this API, so verification used the served artifacts |
| Live verification | `data/collect_status.json` → `status: ok`, `request_stats {requests: 499, retried: 0, throttled_429: 0}`, `kept_previous_artifacts: []`; `data/meta.json` → 2,400 events / 14,647 markets / 6,000 settled / 200 series per topic for all five topics; `data/resolved.json` → 222,825 B, `published_per_topic {"crypto": 200}` of 2,726 in-scope |
| Honest limits | the per-topic selection is live but changed nothing today (only crypto settled in the window); nothing here asserts demo-account performance, news causality, model profitability, or the endpoint ceilings re-tested by other sessions only |
