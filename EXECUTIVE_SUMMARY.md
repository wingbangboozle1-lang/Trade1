# Executive Summary — Kalshi Demo Dashboard (root site)

**Date:** 2026-11-20 · **Repo:** `wingbangboozle1-lang/Trade1` · **Site:** GitHub Pages root (`main /`, legacy source) — <https://wingbangboozle1-lang.github.io/Trade1/>
**Data source:** official Kalshi **demo** REST API — `https://external-api.demo.kalshi.co/trade-api/v2` (recommended host) and `https://demo-api.kalshi.co/trade-api/v2` (also supported), per [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments). Public, unauthenticated, read-only; the demo environment is mock funds per [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env).

---

## 1. What was built

A live, interactive monitoring and paper-trading dashboard for the Kalshi **demo** exchange, restricted to five topics: **gas prices, elections, culture, crypto, golf** only.

| Requirement | Delivered (root site) |
|---|---|
| Track highest-dollar live events in the five topics | `dashboard.html` + per-topic pages (`topics/*.html`) rank events by highest **estimated traded dollars** (total contracts × last price, computed from official `/markets` fields; labeled an estimate — no official per-market dollar-notional field exists), ties broken by estimated 24h dollars. Categories are kept separate per topic; the table also shows est. 24h $, and every row links the exact official `GET /markets?tickers=…` response it came from. |
| Live alerting on swings ≥ $0.10 either direction | Sampled price moves are compared in whole 1/10000-dollar units, so an exact $0.10 move can never be lost to binary-float error (0.66 − 0.56 = 0.09999999999999998). A 45-second per-market cooldown stops oscillation flooding the feed. Two scrolling chats: **“All events”** and **“Model picks”** (heuristic ROI score ≥ 0.45), both auto-scrolling with timestamps, direction, topic pills, price path, volume, and links. |
| Track events until resolution, yes/no | Watched markets are re-checked on every poll; when the exchange settles one, the official `result` (`yes`/`no`) and settlement timestamp are recorded and shown. Paper positions settle at $1 per winning contract. Never inferred. |
| Automate simulated trades / strategies | Four paper strategies (momentum, fade, harvest, breakout) run automatically against live demo quotes with the official taker fee applied; per-strategy and per-topic P&L. `trades.html` (Strategy Lab). |
| Portfolio performance | Three disclosed layers (never mixed; see Methods §8): (1) browser Strategy Lab — paper equity, cash, mark value, realized P&L, fees, win rate, open positions, closed-trade log, equity curve (**local only, localStorage**); (2) persistent **CI paper ledger** — [`portfolio.html`](portfolio.html) + [`data/portfolio.json`](data/portfolio.json), same rules run twice hourly and committed, every trade/alert/resolution row linked to its own official `GET /markets/{ticker}` record; (3) [`demo-account/`](demo-account/index.html) — real demo balance/positions/orders, **inert without owner-supplied keys** (not configured). |
| Interactive price graphs | Canvas chart, X = time with **60 s / 5 m / 15 m / 1 h / 6 h / 24 h** windows, Y = contract price ($0.00–$1.00). Seconds/minutes use live samples; hour+ merges official 1-minute / 60-minute candlesticks. ≥ $0.10 alert markers are plotted on the line and the latest jump in the window is linked below the chart. |
| Liquidity / contracts at price | Official order-book ladders (`GET /markets/{ticker}/orderbook?depth=10`): YES bid/ask and NO bid/ask with **contracts available at each price**, depth bars and computed bid-side liquidity. Bids are exchange-published; asks are derived by the official reciprocal rule and marked with an asterisk. |
| Events + links that may have caused jumps | Every alert links the official Kalshi market page, the event's official `settlement_sources`, and a news search labeled “lead”. **Causality is never asserted.** |
| Suggestions for more liveness | `suggestions.html` — what is already live, a prioritized backlog where every row names the official endpoint it would use (trade tape, batch order books, `with_nested_markets`, server-side capture, WebSocket…), continuous-organization rules, and a one-page trader's playbook. |
| GitHub Pages site, category subpages, tables with sources | Landing page + 5 topic subpages + dashboard / Strategy Lab / Data / Methods / Ideas / Flagged / Sources; every committed table row carries the official request URL that produced it, and values that could not be confirmed are left **blank and flagged**. |
| Verification policy | Values confirmed from official sources only; unconfirmed values left **blank and flagged**; never inferred. Full log in [`REVIEW.md`](REVIEW.md) and on the site's Flagged page. |
| Parallel-session coordination | `COORDINATION.md` task board (claim, scope, verification, sources, irregularities); each session on its own branch; small frequent commits; `git pull --rebase` before push. |
| PR → merge → Pages deploy | Executed without waiting for review; the PR link, merge commit and deploy confirmation are recorded in `COORDINATION.md`. |

---

## 2. Verification highlights (all from official sources, 2026-11-20)

- **Endpoints & schemas verified live:** `/exchange/status` (exchange/trading active), `/events?status=open` (`limit` max **200** — `limit=1000` → 400), `/markets` (+ `tickers` / `event_ticker` / `series_ticker` filters; with `tickers` as the only filter every match returns in one response with an empty cursor), `/series/{ticker}`, `/series?category=`/`?tags=`/`?include_volume=`, `/markets/{ticker}/orderbook?depth=`, `/markets/trades?ticker=`, `/markets/orderbooks?tickers=`, `/series/{s}/markets/{t}/candlesticks` (periods 1/60/1440, `start_ts`/`end_ts` in seconds, ≤ 5,000 periods). Request URLs are recorded per value in `data/log.md` and per row in `data/topics/*.json`.
- **Docs verified:** demo environment hosts; market status filter (`unopened/open/closed/settled`); order-book shape (bids only, `[price, qty]` ascending with the best bid **last**, YES ↔ NO reciprocity, `depth` = best 1–100 levels); fixed-point strings (`_dollars` ≤ 4 dp, `_fp` ≤ 2 dp, `price_ranges` as the price grid); series filters (`category`, `tags`, `include_volume` — and **no** `limit` parameter, so the `limit` we send is ignored); **WebSocket requires an authenticated handshake** → REST polling from static pages; unauthenticated rate limits unpublished → conservative throttling and back-off on 429.
- **Fees verified** from the official schedule PDF (`kalshi.com/docs/kalshi-fee-schedule.pdf`, effective 2026-07-07): taker `fees = round up(M × 0.07 × C × P × (1−P))`, maker `round up(M × 0.0175 × C × P × (1−P))`, **no settlement fee**. The paper broker reproduces **every published row** of the schedule's General Trading Fees Table (21 price points × 1 and × 100 contracts) — and the check found a real bug: the naive float expression returned **$1.76** for 100 contracts @ $0.50 where the official table says **$1.75**. The fee function now computes in integer arithmetic and is locked by an automated test.
- **Per-series fee structure — two official sources, published side by side:** every in-scope series checked reports `fee_type: "quadratic"`, `fee_multiplier: 1` from `GET /series/{ticker}` (`KXAAAGASM`, `KXBTCY`, `KXETHY`, `KXPGATOUR`, `KXOSCARPIC`, `KXPRESNOMD`), while the published fee schedule ([PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) *and* the live [fee-schedule page](https://kalshi.com/fee-schedule)) marks `KXBTCY`/`KXETHY` as **no fees** (`M = 0`). Both paper engines resolve `M` in a documented order: (1) the demo API's published `fee_multiplier` when a Series record for that series has been seen (environment-matched — the site papers demo fills), (2) else the published schedule's per-series multiplier, (3) else the schedule's documented default `M = 1`. A record without a numeric `fee_multiplier` is never inferred. The full transcribed table is published at [`data/fee_schedule_series.json`](data/fee_schedule_series.json) and the conflict is on the [Flagged](flagged.html) page.
- **Topic coverage on demo:** crypto (`KXBTCD`, `KXETHD` — CF Benchmarks), golf (`/series?tags=Golf` → PGA/LPGA series; Trump golf-club markets excluded via `exclude_categories: Politics/Elections`), gas (`KXGAS` EIA; `KXAAAGASM` AAA), elections (category + ticker prefixes), culture (category exists; only a handful of demo series, many zero-volume).
- **CORS** (`data/cors.json`, probed from a GitHub-hosted runner): both demo hosts echo any request `Origin` and the preflight returns 204 — this is what makes the browser-side live mode possible.

---

## 3. Key findings & flagged irregularities (full list with links on the [Flagged for Review](flagged.html) page)

1. Demo returns market `status: "active"` (open) / `"finalized"` (settled) although the documented set is `unopened/open/closed/settled` — both spellings are handled, and the difference is flagged.
2. `GET /events?limit=1000` is rejected with 400; the engine pages at 200.
3. The legacy candlestick path `/markets/{t}/candlesticks` is not served; the documented path is the series-scoped one. Verified live both ways.
4. Some demo `settlement_sources` contain template placeholder URLs — shown as-is, never treated as authoritative.
5. `KXGAS` ("Gas weekly") exists but has **zero events** on demo; many hourly/daily demo series are thin — empty tables are genuine exchange states, not missing data.
6. No official per-event dollar-volume field → dollar ranking is an **estimate**, labeled everywhere; contract counts at price come from the official order-book sizes.
7. Maker fees are not modeled (paper fills assume immediately-matched orders).
8. The ROI screen's weights are documented engineering choices, **not** verified alpha — the model chat is a shortlist, not a signal.
9. News attribution: each alert links the official market page, the event's settlement sources and a labeled news-search lead. Causality is never claimed.
10. WebSocket is unusable from a static page → REST polling with the documented multi-second cache lag; sub-second swings are invisible.
11. A real demo-account portfolio requires user API keys, which the site deliberately never requests — the paper layers (browser lab + CI ledger) are automatic and credential-free.
12. Topic matching is heuristic; `scripts/topics.json` (authoritative for the snapshots) and `assets/model.js → TOPICS` (live matching) are mirrored by hand — a sync hazard, now covered by an automated mirror test.

---

## 4. Data quality observations for traders

- Demo liquidity concentrates in long-dated political markets; most hourly/daily markets are thin — check the order-book ladder before trusting any alert.
- $0.10 swings occur most plausibly around settlement windows and thin-book prints.
- The two-feed design separates **facts** (observed/exchange-reported moves, each with an API link) from **opinion** (model picks, labeled heuristic screen).

---

## 5. Risks & limitations

- **Live** observation happens only while a page is open (the browser lab's localStorage persistence is per-browser), but the **CI ledger** samples the demo API on a schedule with no browser open, so the trade record survives a reload — see [Methods §8](methods.html).
- Simulated fills assume execution at observed quotes with no slippage; real resting orders may not fill the same way.
- Demo behavior need not match production (per Kalshi's official documentation).
- Everything here is educational; **nothing is financial advice**. Demo environment only (play money).

---

## Addendum — session `e82d36a3` (2026-11-20): what changed after this summary was written

The sections above are session `f6094c46`'s text, left intact. This addendum records what the repo looks like now for the
requirements it called "not built", plus the verification this session performed line by line against the official sources.

| Requirement in the brief | Status after this session | Where it is published |
|---|---|---|
| Executive summary | already present, refreshed by later sessions | [`executive-summary.html`](executive-summary.html), this file |
| Dashboard ranked by dollar volume, five topics only | present; ranking stays an explicitly labelled estimate (`volume_24h_fp × last_price_dollars`) — no official per-market dollar-notional field exists | [`dashboard.html`](dashboard.html), [`topics/*.html`](topics/golf.html) |
| Two alert chats ≥ $0.10, one "model likes" | present; the ≥ $0.10 test is done in integer 1e-4-dollar units so a $0.66→$0.56 print cannot be lost to float error, plus a `previous_price_dollars` swing case for round-trips inside one poll | [`dashboard.html`](dashboard.html) · [Methods §3](methods.html) |
| Resolution tracking with YES/NO | present, live-detected from the same poll response | [`dashboard.html`](dashboard.html), [`resolved.html`](resolved.html) |
| **Automated simulated trades + portfolio performance + trade categorisation + strategy derivation** | **now also persistent**: a CI ledger runs the same rules twice an hour and commits its trade ledger, so the record survives a reload and every visitor sees identical numbers — with P&L and counts broken out by strategy and by topic, which is how the "what strategy does this data imply" question gets answered from data rather than assertion | [`portfolio.html`](portfolio.html), [`data/portfolio.json`](data/portfolio.json), [`scripts/portfolio_engine.py`](scripts/portfolio_engine.py) |
| Interactive price chart (x = selectable s/min/h, y = contract price) + liquidity per price | present; Y is scaled to the printed range and a hover crosshair reports the exact official value; depth shows contracts at each price | [`dashboard.html`](dashboard.html) · [Methods §6](methods.html) |
| Suggestions for more live/interactive | present and extended — the backlog's server-side-capture item (#8) and the jump-annotation item (#14) are now shipped, and six new sourced items were added | [`suggestions.html`](suggestions.html) §2b |
| Jumps ≥ $0.10 annotated with the websites that may have caused them | present: markers on the chart plus a link strip (official market page, published settlement sources, labelled news *search* lead); causality is never asserted, and the 45 s per-market cooldown that can suppress a second in-window move is disclosed | [`dashboard.html`](dashboard.html) · [Flagged #7, #17](flagged.html) |
| No manual user input, autonomous to completion | held throughout: no credentials, no forms, nothing requested from a visitor | [Flagged #12, #14, E9](flagged.html) |
| Line-by-line verification against official sources, with links | this session re-checked 18 claims (V1–V18) and 9 code/repo items (R1–R9); where the merged build had already corrected something, its version was kept and the correction was re-verified rather than re-flagged | [`reports/VERIFICATION_e82d36a3.md`](reports/VERIFICATION_e82d36a3.md), [Sources](sources.html) |
| Irregularities flagged, values never inferred | 10 items published as E1–E10 on [Flagged](flagged.html); duplicates of existing items were dropped rather than restated | [`flagged.html`](flagged.html) |

**Corrections to the text above**

- §5 says "no server-side capture yet — backlog item #8 on the Ideas page". That is now out of date: `portfolio.yml` samples the
  market list from a GitHub Actions runner twice an hour and commits the result, so alert history, trade history and portfolio
  performance accumulate with no browser open. What remains true: sampling is ~30-minute spaced, so it is a slower clock than the
  browser lab and cannot see intrabar moves ([Methods §8](methods.html), [Flagged E4](flagged.html)).
- §5's "real resting orders may not fill the same way" is now quantified rather than hand-waved: maker fees are not modelled in
  either engine, and for the in-scope gas series `KXAAAGASM` the published maker multiplier is **1**, i.e. non-zero
  ([Flagged E3](flagged.html)).
- "No demo-account numbers appear anywhere" is still true, but the reason changed while this addendum was being written: session
  `935f2113` merged PR #39, so an authenticated, guarded demo-account track now exists on `main`
  ([`demo-account/`](demo-account/index.html), [`scripts/demo_account/`](scripts/demo_account/README.md), `demo-account.yml`). It reports
  `configured: false` and sends no authenticated request because the owner's `KALSHI_DEMO_KEY_ID` / `KALSHI_DEMO_PRIVATE_KEY` secrets do
  not exist — no agent can create them. This session's ledger is deliberately the *simulation* layer, not a second account path; the
  three layers and their comparability are defined in [Methods §8](methods.html) and [Flagged E9](flagged.html). Draft PR #2 (the same
  work, superseded by #39) should now be closed rather than merged.

**Quality gates added by this session** (all runnable offline, all green on 2026-11-20):
`python3 scripts/portfolio_engine.py selftest` → 50/50 · `node tests/portfolio.test.mjs` → 60/60 (34/34 without jsdom) ·
`node scripts/check_links.mjs` → 16 published pages, 329 local links, 168 external links, 0 failures · and the pre-existing
suites re-run after the merge: `check_site.mjs` 16 pages / 0 failures, `tests/engine.test.mjs` 23/23,
`tests/root_engine.test.js` 40 passed / 0 failed, `scripts/test_lib.mjs` passed, `tools/build.mjs` BUILD OK.
One live cycle of the ledger ran on a GitHub runner ([workflow run `44801621609`](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44801621609),
both jobs success) — this sandbox has no route to `*.demo.kalshi.co`, which is itself verified and recorded rather than assumed.

---

## Addendum — session `3c017782`, 2026-11-21 (final integration: re-verification, reconciliation of the parallel branches, and the corrections it found)

This pass is the integration step: five parallel branches were open, their content was read line by line, the parts that
were verified were kept and the parts that would have *reverted* a later fix were dropped, and the combined tree was
re-verified against the official Kalshi documentation — which was re-read directly for this pass (the
[Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) page and the
[fee-schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) were fetched and quoted verbatim in
[Flagged](flagged.html) items BE-1 and 725-10).

| What the pass found | What changed | Where it is published |
|---|---|---|
| **The shared board shipped unresolved conflict markers.** `COORDINATION.md` — which the site publishes — held `<<<<<<< HEAD` … `>>>>>>> origin/main` at lines 1359–1450, committed by an earlier merge. | The markers are removed and **both** sides are preserved. A new gate fails the build if any tracked file carries a merge marker (mutation-tested: injecting a marker makes the gate fail). | [Flagged 3c-1 / 3c-6](flagged.html) · `scripts/check_site.mjs` |
| **The browser classifier and the Python collector disagreed.** The collector matched topic keywords as whole words; the live browser mirror matched them as bare substrings, so “petrol” matched inside “**Petrolul**” (a Romanian basketball match) and the live dashboard labelled it **gas-prices**. | `assets/model.js` now mirrors the collector's word-boundary semantics. Both implementations are tested against one shared corpus of official records. | [Flagged 3c-2](flagged.html) · `tests/collector.test.mjs` (18 checks) · `tests/fixtures/topic_cases.json` |
| **The settled sweep was truncated but presented as a total.** The collector's own log records `page 6: +1000 items (total 6000); cursor=present` — the cursor was still present when the 6-page cap was reached — so `settled_total: 6000` and `in_scope_count: 1904` were **lower bounds**, not the exchange's totals for the 72-hour window. | The cap is raised to 20 pages, `paged()` reports truncation, the snapshot publishes `settled_pagination` and the two `*_is_lower_bound` flags, and the Resolved page says **“at least”**. | [Flagged 725-3 / 3c-3](flagged.html) · `data/resolved.json` · [Resolved](resolved.html) |
| **The published “Gas prices” resolved section was entirely natural gas.** All four gas rows in the committed snapshot were `KXNATGAS15M-*` markets — “Natural Gas price up in next 15 mins?” — which the gas topic explicitly excludes. | The 4 rows were removed offline by re-applying the collector's own rule to the verbatim rows; no value was altered and the correction is recorded inside the data file. The collector now publishes a **topic-balanced** slice so all five topics appear instead of a slice the demo's continuous crypto settlement filled with crypto. | [Flagged 3c-3 / 3c-8](flagged.html) · `data/resolved.json → removed_out_of_scope` |
| **Nothing checked that a published row links its own official record.** The pages that are actually published build each row's link in JavaScript at render time, so a static HTML check could not see it. | A new gate renders `data.html` and `resolved.html` in jsdom against the real data files and asserts row by row that each row carries its own `/events/{event_ticker}` or `/markets/{ticker}` link on the official demo base, and that nothing is silently dropped. It currently passes with **267 rendered rows / 409 official links**. | [Flagged 3c-5](flagged.html) · `scripts/check_row_sources.mjs` |
| **Two positions were stacked on one market, and both lost everything.** The committed ledger held `KXETHD-26NOV2017-T1659.99` twice (momentum **and** harvest), both entered at `$0.95`, both settled **NO**, `−$24.87` each. | One open position per ticker **across all strategies**, and the directional strategies refuse an ask above **$0.90** (buying at $0.95 risks $0.95 to make $0.05). Harvest is exempt by design. Past ledger rows were **not** rewritten — the two losses stand in the record. | [Flagged BE-2](flagged.html) · `scripts/portfolio_engine.py` · `assets/model.js` |
| **Ledger exit rows pointed at the cycle's batch quote URL** instead of the market's own record. | Every published ledger row (trade, exit, alert, resolution, position) now links its own `GET /markets/{ticker}` record; the batch URL stays published as the provenance of the prices. The committed artifact was re-sourced offline — no price, size, P&L or timestamp changed. | [Flagged 3c-4](flagged.html) · `portfolio_engine.py resource` |
| **The fee schedule's Non-Standard table is partly OCR-garbled.** | The official PDF was re-read directly: 13 further rows whose ticker, title and multipliers align unambiguously were transcribed (`KXMARMAD` + 12 `KXNFL*`/`KXNHL*` rows), taking the untranscribed count from 42 to **29**. Every transcribed row has taker M = 1 — the default the brokers already used — so **no published fee changed**. The remaining 29 rows are still interleaved in the PDF's text layer and are left untranscribed rather than guessed. | [Flagged 725-10](flagged.html) · `data/fee_schedule_series.json` |

**Gates after these changes (all local, exit 0):** `npm test` → engine 23/23 · live_fixes 3/3 · live_dash 6/6 · lib ok ·
fees 50 · model 36 · root_engine 48/48 · model.test 21/21 · portfolio 60/60 · demo-account 89/89 · `tests/test_collect.py` **38/38** ·
`tests/test_collect_failclosed.py` **6/6** · `tests/collector.test.mjs` **18/18** · `portfolio_engine.py selftest` **84/84** ·
`tools/build.mjs` BUILD OK (18 HTML, 6 JS, 0 broken links) · `check_site.mjs` 434 links / 1,249 rows / 821 resolved / **0 failures** ·
`check_links.mjs` 402 local + 262 external links, **0 failures** · `check_row_sources.mjs` 267 rows / 409 official links / **0 failures**.

**Still not verified (no inference made):** live demo-API *market values* from the build sandbox, which has no route to
`*.demo.kalshi.co`. The official **documentation** was re-read directly and is quoted verbatim; only live market data
remains unconfirmed. That limitation is published, not hidden — [Flagged 3c-7](flagged.html).
