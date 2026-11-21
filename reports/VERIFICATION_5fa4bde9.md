# Verification record — session `5fa4bde9` (rate-limit governor + live endpoint re-verification)

Date: 2026-11-21 (UTC). Branch `arena/5fa4bde9-trade1`, branched from `7d1c21f`.
Scope agreed on `COORDINATION.md`: the live browser client's request pacing, the
"429 is not an outage" behaviour, and re-verification of the demo-API endpoints the
pages actually call. Deliberately **not** touched: `scripts/collect*.py`,
`scripts/portfolio_engine.py`, `assets/portfolio.js`, `data/portfolio.json`,
`data/meta.json`, `resolved.html`, `tools/*`, `README.md`, `EXECUTIVE_SUMMARY.md`,
`.github/workflows/pages.yml` — all claimed by other sessions.

Every claim below is either (a) an official page quoted verbatim, (b) a live response
captured this session and committed as a fixture, or (c) a command output reproduced
here. Nothing is inferred to fill a gap; where a thing could not be verified from this
sandbox it says so.

---

## 1. What was verified, and against which official source

| # | Claim in the code/UI | Official source (re-read 2026-11-21) | What was checked |
|---|---|---|---|
| 1 | A 429 carries `X-RateLimit-*` headers **but not `Retry-After`**; "There is no penalty or cooldown"; "Apply exponential backoff on 429" | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) § *When you hit the limit* | The governor never reads `Retry-After` (a test greps the shipped sources for the string, comments stripped, and fails if it appears); backoff is `1.2 s · 2^(streak−1)` capped at 30 s |
| 2 | Publicly cacheable responses — "which include most market data" — "carry none of these headers" | same page, § *Rate limit headers*, bullet 4 | Absent headers are treated as the normal case, never as a throttle (test G3); the readout shows "—" |
| 3 | `X-RateLimit-Reset` = "Seconds, to the millisecond, until the bucket is full again" | same page, header table | The governor waits on `reset` **only** when `remaining === 0`; a partial budget is display-only, because waiting for a *full* bucket would be far longer than the client needs (test G4) |
| 4 | Unauthenticated public requests "are subject to separate limits" | same page, § *Unauthenticated requests* | No equivalence is claimed between the local 3 req/s budget and the exchange's anonymous ceiling; the tier table (Basic 200 Read tokens/s, default cost 10 tokens) is quoted as the *authenticated* floor and disclosed as a deliberate choice — see Flagged **KX-4** |
| 5 | Order books return bids only; arrays "sorted by price in ascending order, so the best (highest) bid is the last element"; `depth` 1–100, "Values below 0 or above 100 are rejected with 400"; an unknown ticker answers 200 with empty arrays | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook), [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | Confirmed against the live capture: `yes_dollars` = `0.24, 0.25, 0.39, 0.40, 0.41` — ascending, best last; the panel's best bid is the **last** element, asks are derived (test C1/C2, probe case `orderbook`, `depth=101 → 400` recorded as informative) |
| 6 | YES ask ≡ $1.00 − NO bid (asks not published) | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | $1.00 − 0.57 = **$0.43** best YES ask, spread $0.02 against the 0.41 bid, asserted from the live fixture (test C2) |
| 7 | `limit` for trades is 1–1000; `min_ts`/`max_ts` are **seconds** and millisecond values are rejected 400 `bad_request`; an unknown ticker returns 200 with an empty list | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) | The client sends seconds only; the probe records `trades-ms-min-ts` → 400 as informative; tape parsing is asserted on the live fixture (test C3, which also pins the re-sort because the response arrived newest-first) |
| 8 | Candlesticks live at `/series/{series_ticker}/markets/{ticker}/candlesticks`, `period_interval` ∈ {1, 60, 1440} | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | The client path matches; the probe asks 1/60/1440 and records `interval=0 → 400`; C4 pins `price.close_dollars` at `end_period_ts × 1000` |
| 9 | `/markets` `status` filter enum is `unopened \| open \| closed \| settled` (`active`/`finalized` are response values); "when `event_ticker` or `tickers` is the only filter, every match is returned in ONE response, `limit` is not applied and the cursor is empty"; responses "are cached for a short time" | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | The batched watchlist request relies on the single-response shape; the probe asserts it (`markets-by-tickers` + `batch_check`, which fails the contract if a cursor ever appears), and the caching sentence is what justifies "prices can lag several seconds" in the UI notes |
| 10 | `/events` `limit` maximum **200**, default 200 | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) | The client and collector use 200, i.e. the cap, not over it; the probe records `events?limit=1000 → 400` as informative (this is Flagged item 2 on the site, already corrected by an earlier session) |
| 11 | A settled market carries `result` and `settlement_ts`; result ∈ yes/no | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | Test C5 feeds the verbatim settled response through the real client and asserts both rows are recorded as **NO** with their settlement time — a `result:"no"` must never be skipped as "no result" |
| 12 | 429 must not be presented as an outage or as empty data (project rule, from the brief: no inferred/filled values) | rule 12 of the task brief, implemented per sources 1–3 | `bail()` classifies `throttled` / `dropped` separately from a real failure; only a real failure may use the on-disk snapshot; discovery pauses with an explicit note; the pill reads `LIVE · throttled, backing off N.Ns`. Tests W1–W3 boot the real `dashboard.html` in jsdom and fail if an all-429 run relabels the site `SNAPSHOT` |

## 2. Live traffic actually observed this session

The build sandbox has **no route to `*.kalshi.co`**: every `curl` to
`external-api.demo.kalshi.co` ends in `SSL_ERROR_SYSCALL`, so the collector cannot be
re-run here and `api_contract.py` cannot be executed from it (see §4). Live responses
were obtained from a browser session and are committed **verbatim** — nothing in them
is synthetic, and the exact URL plus capture time is inside each file:

| Fixture (under `data/samples/`) | Captured | Response |
|---|---|---|
| `orderbook-live-sample.json` | 2026-11-21T07:09Z | 200, `orderbook_fp` with 5 YES / 3 NO levels for `KXBTC50VS100-BTC-26DEC31` |
| `trades-live-sample.json` | 2026-11-21T07:09Z | 200, 3 trades, newest-first, `yes_price_dollars:"0.4300"` |
| `candlesticks-live-sample.json` | 2026-11-21T07:09Z | 200, 1 candle at `period_interval=60` |
| `settled-markets-live-sample.json` | 2026-11-21T07:09Z | 200, 2 settled `KXDOTA2GAME` markets, both `result:"no"`, both with `settlement_ts` (field excerpt; see `excerpt_note` in the file) |

Two findings came directly out of this live traffic and are recorded on
[Flagged](../flagged.html) rather than quietly fixed:

1. **`GET /markets?series_ticker=KXBTC&status=open&limit=3` answers 200** with
   `status:"active"` rows. So `data/meta.json`'s `markets_status_open_accepted:false`,
   `markets_open_count:33`, `settled_total:0` and the zero `gas-prices` event count are
   artifacts of a throttled collector run — [data/log.md](../data/log.md) for that run
   records **220 lines with `429` against 31 with `200`** — not API behaviour.
   Flagged as **KX-2**; the collector itself is another session's claim, so no count is
   asserted here that this session did not observe.
2. The pre-existing `data/samples/orderbook-sample.json` (produced by CI) contains an
   **empty** book under `orderbook_fp_capped_to_40_levels_per_side`, so any ordering
   assertion written against it is vacuous. Flagged as **KX-6**; the sample is left in
   place and the live captures are used instead.

## 3. What changed

| File | Change |
|---|---|
| `assets/governor.js` | **new** — `KalshiGovernor`: continuous-refill token bucket, 4 strict-priority FIFO queues under `maxInFlight`, per-URL coalescing, per-URL requeue budget on 429, exponential backoff decayed by any clean response, overflow shedding that never touches the alert path, opportunistic rate-header use. Float-guard `EPS` in the refill arithmetic (without it every wait rounded up and the whole schedule drifted). |
| `assets/app.js` | `api()` routed through the governor; `priFor()`/`retryFor()` derive priority from the path in one place; `bail()` classifies `throttled`/`dropped` vs a real failure; snapshot fallback restricted to real failures; host failover on ≥5xx only, never on 429; discovery clamps/pauses while cooling; `renderStatus()` cooldown branch above the mode check; `#kx-ratelimit` readout refreshed every 2 s while visible; the response body is parsed by the caller, never by the governor. |
| 7 HTML pages | `<script src="assets/governor.js">` before `assets/model.js` (`methods/suggestions/flagged` carry no engine script and were skipped) |
| `assets/site.css` | `.small.warn` (amber) for the throttled pill |
| `tests/rate_governor.test.mjs` | **new** — 14 checks (G1–G11, G1b, W1–W3) on a deterministic clock + three jsdom boots of the real `dashboard.html` |
| `tests/live_contract.test.mjs` | **new** — C1–C5, the real client parsing the verbatim live responses |
| `scripts/api_contract.py` | **new** — ~20-case live endpoint-contract probe + `--selftest` (9 offline checks of its assertion helpers, run in CI) |
| `.github/workflows/live-client.yml` | **new** — job `client` (offline gates, no network ⇒ cannot flake) + job `contract` (the probe, from a runner, publishing `data/endpoint_contract.json` on `main`; a documented contract break fails the job *after* its evidence is committed) |
| `data.html` | "Live endpoint contract" panel: per-case status vs documented status, verdict, what was checked, doc link; explicit "Not probed yet" state |
| `data/endpoint_contract.json` | labelled **placeholder**, `cases: []`, zero results — see §4 |
| `methods.html` §7 | rewritten to document the governor and the probe (the numbers, the header semantics, and the "429 is never an outage" rule) |
| `flagged.html` | new section, items **KX-1 … KX-6** |
| `package.json` | my suites **appended** to the shared `test` chain (the pre-existing chain was left intact); new `test:rate` script; `jsdom` declared as a devDependency |

## 4. Honest limits — what is *not* verified

* **The live probe has never been executed from a networked environment.** It compiles,
  its helpers pass their self-tests, and its output file is committed as a placeholder
  that states it contains no probe results. The first run of the `Live client` workflow
  on `main` produces the real file; nothing on the site was back-filled meanwhile.
  Flagged as **KX-3**.
* The local budget (3 req/s, burst 6, ≤2 in flight, queue cap 150) is an **engineering
  choice**, not a documented limit for anonymous traffic (**KX-4**).
* The governor's 150-entry queue cap and shedding are approximations of what a real
  per-IP budget does under a burst; they protect the alert path, they do not model the
  exchange's bucket.
* `tools/render_test.mjs --offline` does **not** enforce the promise in its own
  docstring (`__offlineHits` is written once and read nowhere) — flagged as **KX-5**
  with a one-line fix suggested, but not edited here because `tools/` is another
  session's claim.
* `data/samples/settled-markets-live-sample.json` is a **field excerpt** of a real
  response (long `rules_primary`/`rules_secondary` text trimmed); the file says so in
  `excerpt_note`. The events wrapper in `tests/live_contract.test.mjs` C5 is a **test
  fixture, not an API response**, and is labelled as such in the code; the market rows
  it carries are verbatim.

## 5. Commands run, with the output that matters

```
$ npm test            # full chain (11 pre-existing suites + 3 added), real exit code 0
3 passed, 0 failed            # tests/engine.test.mjs
6 passed, 0 failed            # tests/live_fixes.test.mjs
RESULT: 48 passed, 0 failed   # tests/live_dash.test.mjs
RESULT: 21 passed, 0 failed   # scripts/test_fees.mjs / test_model.mjs
60/60 portfolio checks passed
demo-account tests: 89 passed, 0 failed
Ran 4 tests in 0.001s / OK    # python3 tests/test_collect.py
14 passed, 0 failed           # tests/rate_governor.test.mjs
5 passed, 0 failed            # tests/live_contract.test.mjs
selftest: ok                  # scripts/api_contract.py --selftest  (9 checks)
real 0m21.6s

$ npm run check
BUILD OK — 18 HTML, 7 JS files validated, 0 broken links.
{"checked":{"html":18,"links":440,"rows":1183,"resolved":625},"failures":0}
{"pages":16,"links":400,"external":238,"datarefs":4}
16 published pages, 400 local links, 238 external links, 0 failures

$ node tools/render_test.mjs --offline --wait=6000   # index, dashboard, topics/crypto, resolved, portfolio
errors: [] on all five pages (rows/links: 0/42, 18/55, 2/7, 1/20, 194/603)
# /markets?tickers=… is requested twice and served once — the coalescing path, live in the render gate

$ python3 scripts/api_contract.py --selftest          # offline, uses the committed live samples
pass the verbatim live ladder satisfies the documented order
pass level counts read from the live book
pass a descending book is reported, not silently plotted
pass the verbatim settled rows satisfy the result/settlement_ts contract
pass results stay inside the documented enum
pass an undocumented result value fails the contract
pass an empty settled window is not by itself a mismatch (it may be a quiet hour)
pass the documented single-response paging shape is accepted
pass a cursor on a tickers-only request breaks the polling assumption
selftest: ok
```

One process-level defect was found and fixed **in the new test file itself**: a passing
suite that never exits. A jsdom boot keeps the dashboard's `setInterval` timers alive, so
`tests/live_contract.test.mjs` printed "5 passed, 0 failed" and then idled — under
`npm test && …` that stalls every later suite and, in CI, burns the job timeout while
looking green in the log. The finalizer now closes every window and exits with the
failure count; `npm test` runs the whole chain in 21.6 s with exit code 0. (This is also
why an earlier "all green" reading of a `tail`-piped long test run was wrong: a pipeline
reports the last command's status, so a killed `npm test` looked like exit 0.)

## 6. Review links for manual spot-checking

* [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) — items 1–4
* [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) · [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) — items 5–6
* [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) — item 7
* [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) — item 8
* [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) — item 9
* [Get Events](https://docs.kalshi.com/api-reference/events/get-events) — item 10
* [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) — item 11
* Live endpoints as called by the client: [orderbook `depth=5`](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC50VS100-BTC-26DEC31/orderbook?depth=5) · [trades `limit=3`](https://external-api.demo.kalshi.co/trade-api/v2/markets/trades?ticker=KXBTC50VS100-BTC-26DEC31&limit=3) · [candlesticks `period_interval=60`](https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTC50VS100/markets/KXBTC50VS100-BTC-26DEC31/candlesticks?start_ts=1763568000&end_ts=1763654400&period_interval=60) · [settled markets](https://external-api.demo.kalshi.co/trade-api/v2/markets?status=settled&min_settled_ts=1763568000&limit=2&mve_filter=exclude) · [batched tickers](https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXBTC50VS100-BTC-26DEC31) · [depth=101 (documented 400)](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC50VS100-BTC-26DEC31/orderbook?depth=101)
* Code: [assets/governor.js](https://github.com/wingbangboozle1-lang/Trade1/blob/main/assets/governor.js) · [scripts/api_contract.py](https://github.com/wingbangboozle1-lang/Trade1/blob/main/scripts/api_contract.py) · [tests/rate_governor.test.mjs](https://github.com/wingbangboozle1-lang/Trade1/blob/main/tests/rate_governor.test.mjs) · [tests/live_contract.test.mjs](https://github.com/wingbangboozle1-lang/Trade1/blob/main/tests/live_contract.test.mjs) · [live-client.yml](https://github.com/wingbangboozle1-lang/Trade1/blob/main/.github/workflows/live-client.yml)
* Site pages carrying the same content: [Methods §7](../methods.html) · [Flagged KX-1…KX-6](../flagged.html) · [Data → Live endpoint contract](../data.html)
