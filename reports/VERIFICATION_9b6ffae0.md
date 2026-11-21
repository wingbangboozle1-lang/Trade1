# Verification report — session `9b6ffae0` (2026-11-21 UTC)

**Scope.** Close the official-source items the board still carried as *Not read / Not opened /
Unverified*, and re-verify the API facts the published site and the repo docs rely on, line by line,
against official Kalshi pages only. Nothing here is inferred: every row below has either a verbatim
quote from an official page or is recorded as **not verified**.

Rule used throughout: official = a page on `docs.kalshi.com`, a document on `kalshi.com`, or a file on
`assets.kalshi.com` (Kalshi's own asset host). Third-party blogs and PyPI packages were **not** used as
verification sources; where a repo claim traced only to those, the row is marked *not official → flagged*.

**How the reading was done.** The sandbox has no route to `external-api.demo.kalshi.co` (`curl` → 000),
so no live demo response was produced from this sandbox; live-response evidence is the CI snapshot job
(see §6). Document and PDF evidence was read from the official hosts through the page fetcher, and the
quotes below are what those pages say.

---

## 1. F2 — gas contract-terms PDFs that were "Not opened" → now read

Board item: *a2ec5543 · T2 — "Other gas terms: `AAAGASNEW.pdf`, `AAAGASMINMAX.pdf` … **Not opened.
Unverified.**"* Both files were read from Kalshi's own asset host on 2026-11-21.

| # | Field | `AAAGASNEW` (official PDF) | `AAAGASMINMAX` (official PDF) |
|---|---|---|---|
| 1 | Source Agency | "the American Automobile Association (AAA), through the daily average fuel price figures published on its AAA Fuel Prices website (gasprices.aaa.com)" | "The Source Agency is AAA." |
| 2 | Underlying | "the change, in U.S. dollars per gallon or as a percentage as specified by \<value>, in the average price of regular gasoline in \<area> as published by AAA from \<start date> to \<end date>" | "the set of average gas prices for regular gas in \<area> between Issuance and \<date>" |
| 3 | Reference data site | `https://gasprices.aaa.com/` — "provided for convenience only and are not part of the binding Terms and Conditions" | "The Underlying is available here." (no URL in text; instructions are convenience-only) |
| 4 | Comparison operators | "Above X" strict `>X`; "Below X" strict `<X`; "At least X" `≥X`; "At most X" `≤X`; **"Between X and Y" is inclusive of both endpoints** | `<above/below>` only |
| 5 | Strike granularity | dollar `<value>`: −$25.0000 … $25.0000 at increments of $0.0001; percentage `<value>`: −100.000% … 1,000.000% at increments of 0.001% | `<price>`: "inclusive range between 0 and 100 at consecutive increments of \<price>" |
| 6 | Which price counts | "the figures exactly as published by AAA (currently to four decimal places, i.e., to the nearest $0.0001 per gallon), without further rounding"; mid-grade, premium, diesel, E85, individual station prices and other providers are **not** used | not stated in the PDF |
| 7 | Missing publication | "If AAA does not publish a 'Current Avg.' price … the 'Yesterday Avg.' price … published … as of the immediately following calendar day is used in its place" | not stated |
| 8 | Corrections | "Only the first 'Current Avg.' and 'Yesterday Avg.' figures AAA publishes as of a given day shall be used … unless the Exchange determines … that the correction remedies a material error"; corrections after Expiration are not accounted for | "Revisions to the Underlying made after Expiration will not be accounted for" |
| 9 | No-data fallback | "all markets will resolve to the last fair price … unless a 'No data' strike is listed, in which case the 'No data' strike will resolve Yes and all others will resolve No" | not stated |
| 10 | Minimum Tick | **$0.01** | **0.001** |
| 11 | Expiration time | **10:00 AM ET** | **10:15 AM, 11:00 AM or 3:00 PM ET** (and 9:55 AM ET when capped by \<date>) |
| 12 | Settlement Value | $1.00 | $1.00 |
| 13 | Position Accountability | $25,000 per strike, per Member | $25,000 per Member |
| 14 | Area granularity | metro areas allowed, "**does not include counties** or any other area for which AAA does not publish a 'Yesterday Avg.'" | "including the whole United States as well as its states **and counties**" |
| 15 | Review rule cited | Rule **7.1** of the Rulebook | Rule **6.3(c)** of the Rulebook |

Sources: [AAAGASNEW.pdf](https://assets.kalshi.com/contract_terms/AAAGASNEW.pdf) ·
[AAAGASMINMAX.pdf](https://assets.kalshi.com/contract_terms/AAAGASMINMAX.pdf) ·
[AAAGAS.pdf](https://assets.kalshi.com/contract_terms/AAAGAS.pdf) (read by session a2ec5543, row F1).

**What this changes for the site.**

- `dashboard.html` / `topics/gas-prices.html` treat gas markets as "AAA regular-gasoline average" events.
  That is confirmed for both families (rows 1–2), so the topic framing stands. **Verified.**
- Row 5 and row 10 matter for the price grid: an AAA gas contract can be quoted in $0.0001-per-gallon
  *strike* steps while the **contract price tick is $0.01** (AAAGASNEW) — i.e. the strike ladder is finer
  than the price grid. The dashboard's ≥ $0.10 alert threshold is therefore a move of at least 10 minimum
  ticks on AAAGASNEW-style markets; no code change is needed, but the Methods text should not imply the
  two granularities are the same. (Text item for the `methods.html` owner; not edited here.)
- Rows 11 and 14 are **two genuine differences between the two gas rulebooks** (expiration time, and
  counties allowed in MINMAX but excluded in NEW). Any "gas prices" logic that assumes one expiration
  time for all AAA series would be wrong; the collector does not assume one — it reads
  `close_time`/`latest_expiration_time` per market — so this is recorded as a documentation fact, not a defect.
- Row 15 (Rule 7.1 vs Rule 6.3(c) for the same review process) is an inconsistency **inside Kalshi's own
  two PDFs**. Recorded as an irregularity for review; nothing to infer from it.

## 2. F3 — Kalshi Developer Agreement → now read; one compliance item raised

Board item: *a2ec5543 · T2 — "Kalshi Developer Agreement v1.1 terms … **Not read.** The fetch returned
only a PDF viewer placeholder."* The placeholder was the `kalshi.com/developer-agreement` viewer; the
agreement text itself is published as a PDF on Kalshi's own asset host and was read there on 2026-11-21:
[assets.kalshi.com/Kalshi-Developer-Agreement.pdf](https://assets.kalshi.com/Kalshi-Developer-Agreement.pdf)
(title line: "v1.1 — Kalshi Developer Agreement"; "KalshiEx LLC ('Kalshi' or 'Exchange')").

Verbatim clauses that bear on this project:

| Clause | Text (official PDF) | Bearing on this repo |
|---|---|---|
| §1 | "Accessing or using Kalshi's API shall be considered a binding acceptance of this Agreement." | The project accepted these terms by calling the API, including from CI. |
| §3 | "Use of Kalshi APIs is expressly limited to facilitating a members own trading on the Exchange; all other usages are disallowed and may result in account suspension." | The repo's purpose is analysis/alerting on stored data, not order routing. **Flagged for owner decision — see below.** |
| §3.1 | "Collecting, caching, aggregating, or storing data or content accessed via the API except for purposes of facilitating your own trading on Kalshi. You may not share such data or content with third parties in any manner without prior written authorization from Kalshi." | `scripts/collect.py` + `data/**` + the public Pages site is exactly "collecting, caching, storing" and publishing. **Flag F-9b-1.** |
| §3.5 | "Accessing the API for purposes of monitoring the availability, performance, or functionality of any of Kalshi's services or for any other benchmarking or competitive purposes." | `data/exchange-status.json` / `data/cors.json` / the per-request timing log are availability/performance probes of the service. **Flag F-9b-2 (adjacent to this clause).** |
| §4.3 | "you must follow standard best practices for retries on errors, including rate limit exceeded errors: Retry with exponential backoff, not immediately. Retry a bounded number of times … Monitor your application … with any dashboards and alerting required." | The collector's 429 handling merged in PR #80 (bounded retries, exponential backoff, dashboards) is **consistent with this clause — verified positive.** |
| §5 | "Kalshi may set limits on the number of API calls … at its sole discretion without notice … You agree to such limitations and will not attempt to circumvent such limitations." | Confirms the board's standing flag that unauthenticated limit numbers are not published, and rules out "retry harder" workarounds. |
| §6.4 | "You must obtain prior written approval from Kalshi prior to releasing any statements … public announcements and public disclosures … relating to Kalshi, the Kalshi Marks, Kalshi Services, Kalshi API, or this Agreement." | A public README/site that describes Kalshi's API is arguably a "public disclosure relating to … Kalshi API". **Flag F-9b-3.** |

**F-9b-1/2/3 are published on `flagged.html` for the owner's decision.** This report states what the
official text says and what the repo does; it does **not** offer a legal conclusion. Options an owner can
take, all cheap: keep the pipeline but stop committing raw snapshots to a public repo (serve computed
values only), mark the site internal/private, or request written authorization under §3.1.
The demo environment is not carved out anywhere in the agreement text as read — recorded as a fact of the
document, not an interpretation of it.

## 3. C5 — empty candlesticks for a settled gas market → official cause found

Board item: *a2ec5543 · T2 — `KXAAAGASM-26OCT31-4.18` … returned **no** candlesticks for 1-hour period
over 3 days … **Unverified cause.** Left as a flag. Not explained.*

Official cause, from [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md):
"Candlesticks for markets that settled before the historical cutoff are only available via
`GET /historical/markets/{ticker}/candlesticks`." The [Historical Data](https://docs.kalshi.com/getting_started/historical_data.md)
page documents the mechanism and the cutoff table: "`market_settled_ts` — Markets and their candlesticks
that settled before this timestamp are only available via `GET /historical/markets`", with
`GET /historical/cutoff` publishing the timestamps and each data type carrying its own cutoff.
**C5 closed: expected behaviour, with a documented alternative endpoint.** Not implemented here (the
collector is owned by another session) — a change request is logged in `COORDINATION.md`.

Two further consequences of the same page, both relevant to this site and verified from it:

| Site area | Consequence | Official wording |
|---|---|---|
| `resolved.html` (resolution archive via `GET /markets?status=settled`) | old settled rows age out of the live endpoint, so the archive shrinks by design | "`GET /markets`, `GET /markets/{ticker}` — `market_settled_ts` — Settled markets and their candlesticks older than the cutoff will not appear" |
| `dashboard.html` seconds/minutes chart windows (trade-tape fallback) | tape older than its own cutoff is not in the live endpoint either | "`GET /markets/trades` — `trades_created_ts` — Trades older than the cutoff will not appear" |
| `GET /events` used for discovery | events survive even when their markets are archived | "All events are accessible through this endpoint, even if their associated markets are older than the historical cutoff." |

## 4. Line-by-line re-verification of published API claims

Each row is a claim as it appears in the repo/site, the official page, and the verdict.

| ID | Claim as published in this repo | Official source (read 2026-11-21) | Verdict |
|---|---|---|---|
| 9b-A | Demo REST roots `external-api.demo.kalshi.co/trade-api/v2` (recommended) and `demo-api.kalshi.co/trade-api/v2` (also supported) — `data/meta.json` `base`/`alt_base`, `README.md` | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md), [API Environments](https://docs.kalshi.com/getting_started/api_environments.md) | **Verified.** The brief's two REST hosts are exactly the documented pair. |
| 9b-B | Demo WebSocket host naming "differs across sources"; `docs/api-reference.md` listed `wss://external-api-demo.kalshi.co/trade-api/ws/v2` | [API Environments](https://docs.kalshi.com/getting_started/api_environments.md), [demo_env](https://docs.kalshi.com/getting_started/demo_env.md) | **Corrected.** Official: recommended `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, also supported `wss://demo-api.kalshi.co/trade-api/ws/v2`. `external-api-demo.kalshi.co` appears in no official page → removed from `docs/api-reference.md`. The brief's WS URL is the official recommended one. |
| 9b-C | "WS requires signed auth headers at handshake (why the browser dashboard polls REST instead)" — `sources.html`, `methods.html` | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets.md) | **Verified, and stronger than claimed:** "even channels that carry public market data still use the authenticated WebSocket session". A browser cannot sign, so polling is the only option for a static page. |
| 9b-D | WS channel lists: public `ticker`, `trade`, `market_lifecycle_v2`; private `orderbook_delta`, `fill`, `market_positions`, `user_orders` — `docs/api-reference.md` | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets.md) | **Verified + completed.** Official also lists public `multivariate_market_lifecycle` and private `communications`, `order_group_updates`; dedicated `user-ws` hosts carry `fill`/`user_orders` with lower latency, and subscribing to another channel there returns error code 8. Doc updated. |
| 9b-E | Auth = RSA-PSS only, `timestamp + METHOD + path` | [API Keys](https://docs.kalshi.com/getting_started/api_keys.md) | **Verified with additions.** Official: **Ed25519 is the recommended key type** (RSA-PSS supported "including SDK versions before 3.31.0"); sign the path **without query parameters**; `KALSHI-ACCESS-TIMESTAMP` must be within **30 s** of Kalshi's clock or the request returns `401 header_timestamp_expired`. `demo-account/assets/signer.js` already implements both algorithms with `saltLength: 32` → **conformant**. |
| 9b-F | "Legacy (Basic token) — `POST /log_in` with {email, password} … `Authorization: Basic`", sourced to the PyPI `kalshi` SDK — `docs/api-reference.md`, `docs/executive-summary.md`, `docs/sources.md`, `docs/verification.md` | [API Keys](https://docs.kalshi.com/getting_started/api_keys.md) | **Not official → flagged.** The official auth page documents API-key signing only; no `POST /log_in` endpoint exists on it. The claim's only source is a third-party PyPI package, so per the project rule it is recorded as *unverified legacy behaviour* and marked as such in `docs/api-reference.md` (text kept, not deleted). |
| 9b-G | `GET /events` page size: "limit max 200 (1000 → 400)"; the repo carried a flag "undocumented events page-size ceiling" | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) | **Flag resolved — it is documented:** "Parameter to specify the number of results per page. Defaults to 200. Maximum value is 200." Collector paging at 200 is correct. |
| 9b-H | "demo `status:"active"`/`finalized` differs from the documented status set" (long-standing flag on `flagged.html`) | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) market schema | **Flag resolved — no anomaly.** The documented *response* enum is `initialized \| inactive \| active \| closed \| determined \| disputed \| amended \| finalized`; the *query filter* is a different enum (`unopened \| open \| closed \| settled`). Both observed demo values are in the documented response enum; the site's handling of `determined`/`amended` matches the same enum. |
| 9b-I | Market `result` values used by `resolved.html` (YES/NO) | same page: `result` enum `'yes' \| 'no' \| scalar \| ''` | **Verified**, incl. the two values the site leaves blank (`scalar`, empty string before settlement). |
| 9b-J | **`previous_price_dollars` = "last trade price before the current one"** — comment in `assets/app.js` `checkAlert()`, and the swing-fallback description in `executive-summary.html` ("caught with the exchange's own `previous_price_dollars`") | same page, Market schema: `previous_price_dollars` — "Price for the last traded YES contract on this market **a day ago** in dollars" (`previous_yes_bid_dollars` and `previous_yes_ask_dollars` are worded the same way) | **DEFECT FOUND — the repo's reading is wrong.** The field is a 24-hour-old reference price, not the previous trade. Consequence: the "swing (previous trade)" alert branch can fire on a ≥ $0.10 difference versus **yesterday**, labelled as a swing that "reversed inside one poll window". **Fixed in this branch** (`assets/app.js`, which no open PR claimed): label is now `vs 24h reference price` and the comment quotes the official definition — see §5 R1a. The matching copy in `executive-summary.html` is owned by PRs #85/#95, so it is logged as R1b rather than edited. |
| 9b-K | "no official per-market dollar-volume field; `$_volume` figures are estimates" | same page: fields are `volume_fp`, `volume_24h_fp` ("market volume in **contracts**") and `notional_value_dollars` ("The total value of a single contract at settlement in dollars") | **Verified.** No dollar-volume field exists; `notional_value_dollars` is per-contract settlement value, not traded notional, so the estimate stays an estimate. |
| 9b-L | Orderbook claims: bids only, `[price_dollars, count_fp]` ascending, best bid last, reciprocal ask, `depth` param, derived asks flagged | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses.md) | **Verified**, plus two facts worth publishing: "**Order counts per level are not returned**" (so a level's *contract* count is all the site can show — it does) and "A market with no resting orders returns empty … **So does a ticker that does not match any market**: the endpoint returns `200` with empty arrays rather than `404`" (an archived/typo ticker is indistinguishable from an empty book — the site's "empty book" label should say that). Also: "The REST orderbook is a point-in-time read." |
| 9b-M | Candlestick claims: `period_interval` ∈ {1, 60, 1440}, ≤ 5,000 periods/request, `start_ts`/`end_ts` in seconds | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) | **Verified + completed.** Millisecond values are rejected (`400 bad_request`), and "The most recent candlesticks can be a few seconds behind the latest trades and quotes" — the exact reason the site's seconds/minutes windows fall back to the trade tape. |
| 9b-N | `GET /markets/candlesticks` "Batch candlesticks" (one row in `docs/api-reference.md`, no limits stated) | [Batch Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/batch-get-market-candlesticks.md) | **Verified endpoint; limits added.** "Accepts up to 100 market tickers per request"; total periods ≤ **10,000** (`(end−start)/interval × tickers`), larger → `400`; "the response is never truncated"; grouped by `market_ticker`. This is the cheapest fix for the CI 429 problem (§5, R2). |
| 9b-O | Trade tape: `GET /markets/trades`, `limit` ≤ 1000, seconds timestamps; the app reads only price/count fields | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades.md) | **Verified.** `limit` 1–1000 default 100; `min_ts`/`max_ts` in seconds (ms → `400`); unknown `ticker` → `200` with an empty list; undecodable `cursor` is **silently ignored** and page 1 is returned (worth knowing before paging). The site does **not** read the deprecated `taker_side` field — it is absent from the code (`grep` over `assets/**`, `scripts/**`), so no migration is needed. |
| 9b-P | "429 backoff guidance" cited by `sources.html` for the collector | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits.md) | **Verified, with one correction to the code's assumption.** Official: "429 responses carry the rate limit headers below, **but not `Retry-After`**", body is exactly `{"error": {"code": "too_many_requests", "message": "too requests"}}`-shaped, "There is no penalty or cooldown", "Apply exponential backoff on 429". So the collector's `Retry-After` branch (PR #80) can never trigger — harmless, but the *useful* signal is `X-RateLimit-Reset` ("Seconds, to the millisecond, until the bucket is full again"). Also: "Unauthenticated public requests are subject to separate limits", "Most requests cost the default of 10 tokens", `GET /account/endpoint_costs` is authoritative for non-default costs. |
| 9b-Q | Settlement semantics used by the paper broker ($1 payout, YES/NO) | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) market schema: `settlement_value_dollars` — "The settlement value of the YES/LONG side of the contract in dollars. **Only filled after determination**"; `settlement_timer_seconds`; `settlement_sources` — "The official sources used for the determination of markets within this event" | **Verified.** Also implies the Resolved page must not treat a missing `settlement_value_dollars` as $0 for a `determined` market — which is how the site's blank-not-inferred rule already behaves. |
| 9b-R | Fee model: taker `roundup(M × 0.07 × C × P × (1−P))`, maker `roundup(M × 0.0175 × C × P × (1−P))`, per-series multiplier table, "no settlement fee" | [kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective July 7, 2026) | **Verified against the PDF, including its internal inconsistency:** the prose says "rounds up such that the fee + positionCost is rounded to a **centicent**" while the worked table shows whole-cent fees (e.g. $0.50 → $0.02, $0.55 → $0.02); the engine follows the table, which is the documented behaviour, and the discrepancy stays flagged (carried from `demo-account/flagged.html` F-DA-5). `KXAAAGASM` appears in the Non-Standard Fees table with maker 1 / taker 1. |
| 9b-S | Order endpoints listed in `docs/api-reference.md`: `POST /portfolio/events/orders`, `DELETE /portfolio/events/orders/{order_id}`, `POST …/amend`, `POST …/decrease`, `POST /portfolio/events/orders` body `{ticker, action, side, type, count, yes_price\|no_price}` | [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2.md), [Cancel](https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md), [Amend](https://docs.kalshi.com/api-reference/orders/amend-order-v2.md), [Decrease](https://docs.kalshi.com/api-reference/orders/decrease-order-v2.md) | **Paths verified; request shape corrected.** V2 requires `ticker, side ∈ {bid, ask}, count (fp string), price (dollar string), time_in_force ∈ {fill_or_kill, good_till_canceled, immediate_or_cancel}, self_trade_prevention_type ∈ {taker_at_cross, maker}`. `action`/`yes_price`/`type` are V1 fields; the legacy `/portfolio/orders` writes "have been removed and now return `410 Gone` with code `deprecated_v1_order_endpoint`". Decrease: exactly one of `reduce_by`/`reduce_to`. Amend: requires `ticker, side, price, count`. Doc updated. |
| 9b-T | "legacy `/portfolio/orders` 410" carried by the demo-account track as an **unverified** claim (F-DA-9) | same [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2.md) page | **Flag closed.** The 410 + `deprecated_v1_order_endpoint` behaviour is now documented on the official page. Text supplied to the demo-account owner in `COORDINATION.md`; that page is not edited here. |
| 9b-U | `GET /markets/orderbooks?tickers=` used for batched liquidity (cited in `EXECUTIVE_SUMMARY.md`) | [Get Multiple Market Orderbooks](https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks.md) — listed in the official docs index | **Partially verified.** The endpoint exists in the official index; its exact query-parameter spelling and per-ticker limits were **not re-read this session** → recorded as unverified here rather than asserted, and added to the flag list. |
| 9b-W | "**CORS behaviour of the demo API is not confirmed** — the site may not be able to poll the API from a browser" (`docs/FLAGGED.md` F1, carried since the first sessions) | Live header capture from the CI runner, in the snapshot this session triggered: `data/cors.json`, probed `2026-11-21T07:19:44Z` on the official demo host | **Closed with observed evidence (still not an official *statement*).** For `Origin: https://wingbangboozle1-lang.github.io` the demo API returns `access-control-allow-origin` **echoing that origin**, `access-control-allow-credentials: true`, `vary: Origin`, and `OPTIONS /markets` returns **204** with the same ACAO — i.e. a browser on the Pages origin can call the public endpoints, which is exactly how `dashboard.html` works. Same capture also returns `access-control-expose-headers: X-Csrf-Token,X-Ratelimit-Limit,X-Ratelimit-Remaining,X-Ratelimit-Reset,X-Ratelimit-Cost`, so the **rate-limit headers are readable from page JS** — the dashboard can pace itself against its own budget instead of guessing (new suggestion S-9b-2). No `Access-Control-Allow-Origin` documentation exists on docs.kalshi.com; the evidence is a live response from the official endpoint, and it is labelled as such. |
| 9b-V | Market `title` / `subtitle` / `no_sub_title` used for topic classification (`scripts/collect.py`) | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) market schema | **Verified as working, flagged as deprecated.** For **events**, `title` and `sub_title` are required and not deprecated. For **markets**, `title` and `subtitle` are marked `deprecated: true`, and `no_sub_title` is "Deprecated. Use `yes_sub_title` instead. Equal to `yes_sub_title` on every market created since September 2024." The collector's settled-market fallback classifies on market `title` → change request R3 in `COORDINATION.md` (prefer `yes_sub_title` + event title). |

## 5. Change requests generated by this audit (files owned elsewhere — not edited here)

These are the only actionable code changes the audit found. Each is one-line-ish and ready to apply;
they were **not** applied because the files are claimed by open PRs (#74, #75, #79). Logged in
`COORDINATION.md` per the coordination protocol.

- **R1a — `assets/app.js` `checkAlert()` 24-hour-reference detector — APPLIED IN THIS BRANCH.**
  The file was claimed by no open PR (checked against the file lists of #75/#79/#85/#90/#95/#97), so the fix
  was applied here instead of being left as a request. Detection behaviour is untouched; the two statements
  that were wrong are now right — the chat label changed from `'swing (previous trade)'` to
  `'vs 24h reference price'`, and the comment block quotes the official definition plus the
  [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) link instead of asserting
  "last trade price before the current one". `npm test` passes on the change (the
  `tests/engine.test.mjs` assertion that the fallback exists still holds; no test depended on the old label).
  Deliberately **not** done: deleting the branch. A >= $0.10 gap to the same time yesterday is a useful
  alert — it must simply not be presented as a sudden intraday swing. A stricter variant (require both a
  sampled move and the reference gap before firing) is left to the Strategy Lab owner, because it would
  change which alerts the ROI screen scores.
- **R1b — `executive-summary.html` (owners: open PRs #85, #95).** Same misdescription in the published
  summary: "a swing that reversed inside one poll, caught with the exchange's own `previous_price_dollars`".
  Suggested text: "a >= $0.10 gap to the exchange's 24-hour reference price (`previous_price_dollars` is
  documented as the last traded YES price **a day ago**), which catches moves that happened outside the
  sampling window; the sudden-move detector is the sampled one."

- **R2a — ✅ already delivered while this audit was in flight.** The first half of R2 landed from a
  different session: `scripts/collect.py` now prefers the published reset hint —
  "no Retry-After is sent on 429 (official rate-limit page); use the published `X-RateLimit-Reset`
  (seconds) when present, else exponential backoff" — reached from the same official sentence this report
  cites. Recorded as **convergent verification**: two sessions reading one official page and changing the
  same thing in the same direction. Not re-edited here.
- **R7 — `scripts/collect.py`, one-line accuracy fix (owner: open PRs #75 / #85 claim that file).**
  The self-description written into `data/collect_status.json` still reads
  `"backoff": "Retry-After header if numeric, else 2^attempt seconds (max 60 s)"`, which describes the
  policy **before** R2a. The code order is now `Retry-After → X-RateLimit-Reset → 2^attempt`, and the
  artifact is quoted by the site as the collector's own statement of its behaviour, so it should not lag
  the code. Suggested string:
  `"Retry-After if numeric, else X-RateLimit-Reset seconds, else 2^attempt (max 60 s)"`.
  Logged, not edited — `scripts/collect.py` is inside two open PRs.
- **R2b — `scripts/collect.py` request budget (still open; owner: #75 / #85).**
  The 429 storms every session hit are avoidable in part: `GET /markets/candlesticks` accepts **up to 100
  tickers** per call (≤ 10,000 total periods), and `GET /markets?tickers=a,b,c` batches market reads,
  so the per-event `markets?event_ticker=` loop can be collapsed. Also replace the inert `Retry-After`
  branch with `X-RateLimit-Reset` when present (official: 429s "carry the rate limit headers … but not
  `Retry-After`"), and keep the bounded exponential backoff, which §4.3 of the Developer Agreement requires.
- **R3 — `scripts/collect.py` classification haystack.** Add `yes_sub_title` (and the event title) in
  front of the deprecated market `title` (row 9b-V).
- **R4 — `resolved.html` / collector window.** `GET /markets?status=settled` stops serving markets older
  than `market_settled_ts`; `GET /historical/cutoff` + `GET /historical/markets` are the documented
  way to keep the archive growing instead of shrinking. Minimum useful step: fetch `GET /historical/cutoff`
  each run and publish the cutoff next to the Resolved window so a reader knows how far back the live
  endpoint still answers.
- **R5 — `demo-account/flagged.html` F-DA-9 (owner: demo-account track).** Replace "unverified" with the
  official wording: "The legacy `/portfolio/orders` write endpoints (create, cancel, amend, decrease and
  their batch forms) have been removed and now return `410 Gone` with code `deprecated_v1_order_endpoint`"
  ([source](https://docs.kalshi.com/api-reference/orders/create-order-v2.md)). Also record that **Ed25519
  is the recommended key type** ([source](https://docs.kalshi.com/getting_started/api_keys.md)) — the
  signer already supports it.

## 6. Live-run verification (CI) — **completed, `status: ok`, zero read failures**

A `workflow_dispatch` of `Site checks + data refresh` was run **on this session's branch**
([Actions run 44879720313](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44879720313)) to
check, from a real runner against the official demo API, that the fail-closed collector merged in PR #80
produces a trusted snapshot. Runner-side commit: **`0cf4924` — "data: verified snapshot
2026-11-21T07:24:51Z [skip ci]"**.

| Check | Value from the run's own artifacts | Reading |
|---|---|---|
| `data/collect_status.json` → `status` | `ok` | the trust gate accepted the run, so nothing was kept-by-fallback |
| `transient_read_failures` | **0** (and `failures_first_20: []`) | no 429 at all in this run, versus the 06:58:35Z incident that wiped `resolved.json` to 0 rows |
| `kept_previous_artifacts` | `[]` | every artifact was rewritten from a clean read — the "kept because the read failed" path did not trigger |
| `retry_policy` recorded in the artifact | statuses `[429, 500, 502, 503, 504]`, `max_attempts: 5`, "Retry-After header if numeric, else 2^attempt seconds (max 60 s)" | matches the merged implementation; see the note below on `Retry-After` |
| `data/meta.json` `generated_at` / `finished_at` | `2026-11-21T07:19:44Z` / `07:24:51Z` | newer than the `03:59:57Z` restore that `main` carried after the incident |
| Findings | `events_open_count 2400`, `markets_open_count 14646`, `settled_count_recent 6000`, `event_metadata_and_market_fetches 261`, `orderbook_ok true`, `candlesticks_ok true`, series discovered per topic 200 × 5 | all five topics (gas prices, elections, culture, crypto, golf) populated |
| Topic files | gas-prices 81 kB, elections 252 kB, culture 242 kB, crypto 253 kB, golf 169 kB | healthy sizes (the incident had left gas at 1.1 kB) |
| `data/resolved.json` | 200 rows, `settled_total 6000`, `in_scope_count 2675`, window "last 3 days (min_settled_ts = now-72h)" | non-empty; the 0-row refusal guard was not needed |
| Validators on the merged tree (sandbox) | `npm test` exit 0; `scripts/check_site.mjs` `{"html":18,"links":432,"rows":1248,"resolved":825},"failures":0`; `scripts/check_links.mjs` 0 failures; `tools/build.mjs` BUILD OK | the refreshed data renders and every row still carries an official source URL |

Two conclusions that only a live run can give:

1. **The fail-closed collector works end-to-end under real traffic.** The 0-429 outcome is not proof the
   guards are unnecessary — the run happened at a quiet minute — but `status: ok` + `kept_previous_artifacts:
   []` proves the new trust gate does not *falsely* keep stale artifacts when reads succeed, which is the
   failure mode the offline tests could not cover.
2. **The `Retry-After` branch of the retry policy is inert**, officially: "429 responses carry the rate
   limit headers below, **but not `Retry-After`**"
   ([Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits.md)). The fallback
   (bounded exponential backoff) is what actually runs, and it is the documented expectation ("Apply
   exponential backoff on 429"; Developer Agreement §4.3). `X-RateLimit-Reset` — "Seconds, to the
   millisecond, until the bucket is full again" — is the signal worth using instead; that is change
   request **R2**.

**Disposition of the data itself.** This session does not hand-edit `data/**`. The runner's commit is on
this branch only; whichever tree has the newer `generated_at` should win at integration, and nothing here
invents a value to fill a gap. `data/log.md` from the run is the per-request evidence (URL + status + size).


## 7. Strategy-lab ledger as merged — one factual line, no conclusion

The simulated-trading layer is owned by other sessions; this session only checked that the numbers the
site shows are the numbers the artifact holds. At the snapshot on `main` when this PR merged,
`data/portfolio.json` (`generated_at 2026-11-21T07:28:04Z`, CI paper ledger) reports:
`trades_total 12`, `open 8`, `realised 4`, `settled 2`, `wins 0 / losses 4`, `realised_pnl_usd -59.5891`
on `realised_cost_usd 99.2991` (`roi_pct -60.01`), `cash_usd 744.17`, `equity_usd 933.48`,
`return_on_bankroll_pct -6.652`, `peak_equity_usd 995.44`, `max_drawdown_usd -61.96`, `alerts_total 34`.
By strategy the 12 listed trades split momentum 7 / breakout 3 / fade 1 / harvest 1.

**Reading of that, stated carefully:** with four realised trades it is a **sample too small to rank any
strategy** — the same caveat a2ec5543 filed as F7 ("6 trades; sample too small to judge") and which the
ledger is still inside. The `-60 %` realised ROI on a $1,000 paper bankroll is a fact about four
exits, not evidence about a method, and the site labels it as simulation over demo prices ("The price and
behavior of markets in the demo environment may not be reflective of those in real markets" —
[demo_env](https://docs.kalshi.com/getting_started/demo_env.md)). Nothing here is a recommendation to
change a strategy; the engine keeps running every 30 minutes and the sample grows.

## 7. Not verified (blank, deliberately — no inference)

| Item | Why blank |
|---|---|
| Any **live** demo-API response value from this sandbox | no network route from the sandbox (`curl` → 000); only CI runners reach it |
| Browser-origin **CORS** acceptance for the demo hosts | **no longer blank** — moved to row 9b-W: the live header capture from this session's CI run (`data/cors.json`, 2026-11-21T07:19:44Z) shows the ACAO echoing the Pages origin and a `204` preflight. What remains unverified is only whether an official *statement* of that policy exists, and behaviour from a real user browser on another origin |
| `GET /markets/orderbooks` parameter spelling / per-request limits | not re-read this session (row 9b-U) |
| Whether Kalshi treats a **demo-environment** crawler differently under §3.1 | the agreement as read has no demo carve-out and no FAQ was found on the official pages; owner/legal decision, not a repo fact |
| Which of the two gas rulebooks (Rule 7.1 vs 6.3(c)) is current | both PDFs are live on `assets.kalshi.com`; recorded as-is |
| Whether `previous_price_dollars` on the demo host matches production semantics | only the official schema description is verified; a live field-by-field check needs a runner probe |
