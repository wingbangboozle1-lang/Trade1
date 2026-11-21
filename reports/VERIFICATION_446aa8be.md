# Verification record — 446aa8be · AA-8 live re-confirmation of demo-API shapes

- **Session:** `arena/446aa8be-trade1` (base `main` @ `2acfa8e`)
- **Date:** 2026-11-21, live reads at approximately 07:20–07:30 UTC
- **Task:** close open item **AA-8** on `flagged.html` ("live demo-API market data not re-confirmed; the build sandbox has no route to `external-api.demo.kalshi.co`").
- **Method:** the build sandbox still cannot reach `*.kalshi.co` (`curl` → `000`, re-checked this session). The Arena page fetcher can read the official demo host, so each endpoint below was read through it. Each response is quoted by its exact URL. Each field the code reads was checked against the live payload, and each endpoint shape was checked against the official Kalshi docs page linked next to it.
- **Scope of this record:** response **shapes and field names** (plus status values and enumerations). Live prices and volumes change every second and are not compared with committed snapshots. Nothing in the site or the ledger was edited.

## 1. Live responses read (official demo host)

| # | Endpoint (exact URL read) | Fields the code reads — present in live payload? | Official doc (see the status note under the table) |
|---|---|---|---|
| L1 | `https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` | `exchange_active`, `trading_active`, `exchange_index_statuses[]` — yes | [API Environments](https://docs.kalshi.com/getting_started/api_environments) (host list, re-read 2026-11-21 by session `efc28509`) |
| L2 | `…/markets?status=open&limit=2&mve_filter=exclude` | `ticker`, `event_ticker`, `status` = `"active"`, `yes_bid_dollars`, `yes_ask_dollars`, `no_bid_dollars`, `no_ask_dollars`, `last_price_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `yes_bid_size_fp`, `yes_ask_size_fp`, `close_time`, `open_time`, `result` = `""`, `settlement_timer_seconds`, `price_ranges`, `title`, `yes_sub_title`, `rules_primary` — **yes, all present** | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| L3 | `…/markets?status=settled&limit=2` | `status` = `"finalized"`, `result` = `"yes"` / `"no"`, `settlement_ts`, `settlement_value_dollars` — **yes**. This call omits `mve_filter`; it returned a multivariate market (`KXMVECROSSCATEGORY-…`), which the collector excludes by passing `mve_filter=exclude` (`scripts/collect.py` line ~469). | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| L4 | `…/events?status=open&limit=2` | `event_ticker`, `series_ticker`, `category`, `title`, `sub_title`, `settlement_sources[]` (`name`, `url`) — **yes** | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) |
| L5 | `…/series?category=Crypto` (page 1 of 36) | `ticker`, `category`, `categories[]`, `tags`, `frequency`, `fee_type` = `"quadratic"`, `fee_multiplier` = `1` (integer), `settlement_sources[]`, `contract_url`, `contract_terms_url` — **yes** | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) (`fee_type`, `fee_multiplier` in the schema) |
| L6 | `…/series/KXDEMOFUTHOURLY` | `category` = `"Test"`, `tags` = `["Demo"]`, `fee_multiplier` = `1`, `fee_type` = `"quadratic"` — see irregularity **I4** | [Get Series](https://docs.kalshi.com/api-reference/market/get-series) |
| L7 | `…/events/KXDEMOFUTHOURLY-26NOV21H08` | `event` object + `markets[]` with the same market fields as L2 — **yes** | [Get Event](https://docs.kalshi.com/api-reference/events/get-event) |
| L8 | `…/markets/KXDEMOFUTHOURLY-26NOV21H08-UP` | single `market` wrapper, same fields as L2 — **yes** | [Get Market](https://docs.kalshi.com/api-reference/market/get-market) |
| L9 | `…/markets/KXDEMOFUTHOURLY-26NOV21H08-UP/orderbook` | `orderbook_fp.yes_dollars` and `orderbook_fp.no_dollars`, each `[price_dollars, count_fp]` string pairs — **yes**, matches the code's `ob.orderbook_fp` read (`scripts/collect.py` line ~524) and the browser's `b.yes_dollars` / `b.no_dollars` read | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) — "bids only; best bid is the last element" |
| L10 | `…/markets/trades?ticker=KXDEMOFUTHOURLY-26NOV21H08-UP&limit=2` | `trade_id`, `ticker`, `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_side`, `taker_outcome_side`, `taker_book_side`, `created_time`, `is_block_trade` — **yes**, matches `assets/app.js` (`t.yes_price_dollars`, `t.created_time`) | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) — `limit` max 1000 (code uses 1000) |
| L11 | `…/series/KXDEMOFUTHOURLY/markets/KXDEMOFUTHOURLY-26NOV21H04-UP/candlesticks?start_ts=1795230000&end_ts=1795233900&period_interval=1` | `candlesticks[]` with `end_period_ts`, `price.{open,high,low,close,mean}_dollars`, `yes_bid.*`, `yes_ask.*`, `volume_fp`, `open_interest_fp` — **yes**, matches `assets/app.js` (`c.end_period_ts`, `c.price.close_dollars`) | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) — `period_interval` ∈ {1, 60, 1440} (code uses 1 and 60) |

**Doc status for this table:** the pages marked *schema read* in section 2 were opened this session and their response schemas were compared. Get Events, Get Event and Get Market were confirmed to exist at the URLs shown, from the official index [llms.txt](https://docs.kalshi.com/llms.txt) (read this session). Their response schemas were **not** re-read here, so their fields were checked against the live payloads only. [API Environments](https://docs.kalshi.com/getting_started/api_environments) was re-read by session `efc28509` on 2026-11-21, not in this session.

Notes on the live reads:
- The orderbook for a market that opened at 07:00 UTC returned one bid level per side; the candlestick call for the still-open market `…H08-UP` returned `candlesticks: []` for a window before it opened. Both are normal for the endpoint.
- The `status` values seen live are `active` (open filter) and `finalized` (settled filter). The official lifecycle table lists the same mapping: filter `open` matches `active`, filter `settled` matches `finalized` ([Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle), "Filter value / Matches" table). **AA-8's status question is closed**.

## 2. Official docs read this session (schema read unless marked)

- [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle): REST statuses `initialized`, `active`, `inactive`, `closed`, `determined`, `disputed`, `amended`, `finalized`. Filter map `unopened`/`open`/`paused`/`closed`/`settled`. States: "`result` is set to `yes`, `no`, or `scalar`" (see irregularity **I2**).
- [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses): `orderbook_fp.{yes_dollars,no_dollars}`, ascending order, best bid last, bids only; an unknown ticker returns `200` with empty arrays.
- [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets): the schema lists `volume_fp` and `volume_24h_fp`. It has **no** `volume` or `volume_24h` field (see irregularity **I1**). Filter `status` values: `unopened`, `open`, `closed`, `settled`.
- [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades): field list as in L10; `limit` 0–1000.
- [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks): `period_interval` 1 / 60 / 1440; response `candlesticks[]` with `end_period_ts`, `price`, `yes_bid`, `yes_ask`, `volume_fp`, `open_interest_fp`.
- [Get Series](https://docs.kalshi.com/api-reference/market/get-series): `fee_type` (example `quadratic`) and `fee_multiplier` (integer).

## 3. Field-by-field check: what the code reads vs. the live payload

| Consumer (file) | Field read | In live payload? | Result |
|---|---|---|---|
| `scripts/collect.py` (`volume_fp`, `volume_24h_fp`, `last_price_dollars`, `status`, `result`, `settlement_ts`, `event_ticker`, `series_ticker`, `category`, `settlement_sources`) | as listed | yes (L2–L7) | match |
| `scripts/collect.py` (`volume`, `volume_24h`) — lines 151, 184, 411–413, 518 | legacy fallback when `_fp` is absent | **no** (not in live payloads, not in the official schema) | irregularity **I1** |
| `assets/app.js` (`last_price_dollars`, `yes_bid_dollars`, `yes_ask_dollars`, `yes_bid_size_fp`, `volume_fp`, `volume_24h_fp`, `result`, `settlement_ts`, `status`, `close_time`) | as listed | yes | match |
| `assets/app.js` (orderbook `b.yes_dollars` / `b.no_dollars`, trades `t.yes_price_dollars` / `t.created_time`, candles `c.price.close_dollars` / `c.end_period_ts`) | as listed | yes (L9–L11) | match |
| `assets/model.js` line 135 (`m.volume_24h_fp || m.volume_24h`) | legacy fallback | not present | irregularity **I1** |
| `scripts/portfolio_engine.py` (`yes_bid_dollars`, `yes_ask_dollars`, `last_price_dollars`, `status`, `result`, `settlement_ts`, `volume_fp`, `no_bid_dollars`, `no_ask_dollars`) | as listed | yes | match. Its `yes_bid` / `yes_ask` keys are internal and are derived from `yes_bid_dollars` (line ~530), so they are not a second API field. |
| `scripts/portfolio_engine.py` `fee_multiplier` from `GET /series/{s}` (line ~300) | integer | yes (L5, L6) | match. Fee formula and `M` source are verified in `reports/VERIFICATION_6877ec31.md` and `flagged.html` (items 6b / 691-1), not re-audited here. |

## 4. Irregularities found in this pass (new; not previously on `flagged.html`)

- **I1 — legacy volume fallbacks read fields the official schema does not define.** `scripts/collect.py` (lines 151, 184, 411–413, 518) and `assets/model.js` (line 135) fall back to `volume` / `volume_24h` when `volume_fp` / `volume_24h_fp` is missing. The Get Markets schema and all live payloads (L2, L3, L7, L8) have only the `_fp` fields. **No effect today** (the `_fp` field is always present), but the fallback could silently use a field of unknown meaning. Suggested owner action: delete the fallbacks, or log them if they are kept for old fixtures. Owner: the collector and model owners.
- **I2 — `result: "scalar"` is documented but unhandled.** The Market Lifecycle page says a determined market's `result` "is set to `yes`, `no`, or `scalar`". The code records only `yes` / `no` (`assets/app.js` line ~423 and the collector), so a scalar market is never recorded as resolved. `data.html` line ~107 displays `m.result === 'yes' ? 'yes' : 'no'`, so a scalar result would show as **NO**. Not seen in the 200-row snapshot (196 `no`, 4 `yes`), so this is a documented-but-unobserved risk, not an observed error. Suggested owner action: show `scalar` (or the raw value) and never default to NO. Owner: `data.html` owner.
- **I3 — `data/resolved.json` rows carry no per-row `source_url`.** `check_site.mjs` checks per-row `source_url` on `data/snapshot.json` only (lines 65–69). The 200 rows of `data/resolved.json` have none (0 of 200). The page builds each row's link from the ticker at render time (`resolved.html` line ~109 `API + encodeURIComponent(ticker)`; `data.html` `marketApiUrl`), so the rendered table is linked, but the data file is not self-describing and the check does not cover it. Suggested owner action: add `source_url` per row and extend the check to `resolved.json`. Owner: collector and `scripts/check_site.mjs` owners.
- **I4 — `KXDEMOFUTHOURLY` is an official demo test series (category `Test`, tag `Demo`) that the site counts as crypto.** Confirmed live (L6, L7): `category` `"Test"`, `tags` `["Demo"]`, and the market rules begin "Demo only." The site maps it to `crypto` on purpose through the series prefix `DEMOFUT` in `scripts/topics.json`. **This is already disclosed** on `flagged.html` and in `methods.html`, so it is listed here only to link the live evidence that the official category is `Test`.
- **Not an irregularity (checked):** `inactive` (filter `paused`) and `disputed` statuses are not named in the browser code. They fall into the not-tradeable branch (`assets/app.js` ~line 415), which stops price sampling and alerting, and they are correctly not recorded as resolved (no `yes`/`no` result yet). The UI shows them under the generic label. No change required, noted for completeness.

## 5. What this session did **not** verify (no inference made)

- Live numeric values (prices, volumes, depth) were not compared with the committed snapshots; they move continuously. Only shapes, names, and enumerations were compared.
- The fee formula, the fee schedule PDF, and the per-series `fee_multiplier` conflict were not re-audited (see `reports/VERIFICATION_6877ec31.md` and `flagged.html` 6b / 691-1).
- The WebSocket channels were not exercised (the browser cannot attach the signed handshake headers; see [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) and the existing flagged item).
- `data/snapshot.json` and `data/resolved.json` are at `generated_at` `2026-11-21T03:59:57Z` (the restored 03:59 run). A newer scheduled refresh was in progress on `main` at the time of this record. Its output is not covered here.
- The demo account (`demo-account/`) needs demo API keys, which this session does not have. Nothing was requested or stored.

## 6. Disposition

- **AA-8 (live re-confirmation):** the shape and status checks above are done against the official demo host. **Requested closure** on `flagged.html`, which belongs to the integration owner, and is logged on the board (not edited here).
- **New items I1–I3:** logged on the board for their owners. Requested for publication on `flagged.html` by the integration owner.
- **No code, data, or site file was changed by this session.**
