# Kalshi Demo API — Verified Reference

Derived from the official sources in [sources.md](./sources.md). Only endpoints verified against
Kalshi's own code/spec are listed. Items that could not be confirmed are marked **(unverified)**.

> **Re-verified 2026-11-21 (session `9b6ffae0`)** line by line against the official docs and PDFs; every
> row below carries an official link, and anything not confirmable there is marked. The full record —
> including verbatim quotes and the two rows corrected here — is
> [`reports/VERIFICATION_9b6ffae0.md`](../reports/VERIFICATION_9b6ffae0.md). The canonical, endpoint-graded
> reference in this repo is [`API_NOTES.md`](./API_NOTES.md); this file adds the order/WebSocket/rate-limit
> families and the historical partition. Nothing was deleted in the re-verification: superseded wording is
> kept and annotated so the change is auditable.

## Base URLs

| Environment | REST base | WebSocket |
|-------------|-----------|-----------|
| Demo — recommended | `https://external-api.demo.kalshi.co/trade-api/v2` | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` |
| Demo — also supported | `https://demo-api.kalshi.co/trade-api/v2` | `wss://demo-api.kalshi.co/trade-api/ws/v2` |
| Production — recommended | `https://external-api.kalshi.com/trade-api/v2` | `wss://external-api-ws.kalshi.com/trade-api/ws/v2` |
| Production — also supported | `https://api.elections.kalshi.com/trade-api/v2` | `wss://api.elections.kalshi.com/trade-api/ws/v2` |

Source: [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments.md) and
[Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md). The demo host set is
also reproduced in the OpenAPI `servers` block published on every API-reference page
(e.g. [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades.md)).

> **Correction (2026-11-21).** This table previously listed the demo WebSocket as
> `wss://external-api-demo.kalshi.co/trade-api/ws/v2` and flagged "WS host naming differs across sources".
> That host string appears on no official page and was wrong; the two official demo WS hosts are the pair
> above. The flag is **closed**: the brief's `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` **is**
> the officially recommended demo WS endpoint.
> There are also dedicated user hosts — `wss://user-ws.demo.kalshi.co/trade-api/ws/v2` (production
> `wss://user-ws.kalshi.com/trade-api/ws/v2`) — which "deliver `fill` and `user_orders` updates with lower
> latency"; "Subscribing to any other channel returns error code 8 (`Unknown channel name`), so keep your
> other subscriptions on the hosts above"
> ([source](https://docs.kalshi.com/getting_started/api_environments.md)).

## Authentication

**API keys (the only auth model in the official docs)** — key pairs you register; each request is signed:
- Two key types: **Ed25519 (recommended)** and **RSA (2048-bit) with RSA-PSS + SHA-256**
  ("MGF1 with SHA-256, salt length equal to the digest length"). Kalshi picks the algorithm from the
  registered public key.
- Pre-sign text: `timestamp_ms + METHOD + path`, **path without query parameters**
  (e.g. sign `/trade-api/v2/portfolio/orders`, not `…?limit=5`).
- Headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE` (base64), `KALSHI-ACCESS-TIMESTAMP`.
- `KALSHI-ACCESS-TIMESTAMP` must be within **30 seconds** of Kalshi's clock in either direction, or the
  request returns `401 header_timestamp_expired` "even when the signature is correct".
- Keys are created on the account settings page, or `POST /trade-api/v2/api_keys` (register your public key)
  / `POST /trade-api/v2/api_keys/generate` (`key_type`, `rsa` when omitted). Up to **100** self-managed keys
  in production (`409 MAXIMUM_NUMBER_OF_API_KEYS_REACHED` beyond that); "The limit can differ in the demo
  environment."

Source: [API Keys](https://docs.kalshi.com/getting_started/api_keys.md).

**Legacy Basic-token login (third-party SDK, not official) — unverified.** An earlier revision of this
file documented `POST /log_in` with `{email, password}` → `{token, user_id, access_level}` and
`Authorization: Basic <token>`, sourced from the PyPI `kalshi` package (v0.2.0). That flow appears on **no**
official Kalshi page read on 2026-11-21 ([API Keys](https://docs.kalshi.com/getting_started/api_keys.md)
documents API-key signing only). It is retained here as a historical note about a third-party SDK, not as a
supported option; nothing in this repo uses it.

**Market data needs no auth.** `GET /markets/{ticker}/orderbook`: "No authentication is required for this
endpoint" ([Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses.md)); public
market-data guides say the same ([Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data.md)).

## Public endpoints (no auth)

| Method | Path | Purpose | Official reference |
|--------|------|---------|--------------------|
| GET | `/exchange/status` | Exchange status / reachability | [Get Exchange Status](https://docs.kalshi.com/api-reference/exchange/get-exchange-status.md) |
| GET | `/series` | List series (`category`, `tags`, `include_volume`, `limit`, `cursor`) | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list.md) |
| GET | `/series/{series_ticker}` | Series detail (`fee_type`, `fee_multiplier`, `contract_terms_url`, `settlement_sources`) | [Get Series](https://docs.kalshi.com/api-reference/market/get-series.md) |
| GET | `/events` | List events (`status`, `limit` **default 200, maximum 200**, `cursor`, `with_nested_markets`, `with_milestones`, `min_close_ts`, `min_updated_ts`) | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) |
| GET | `/events/{event_ticker}` | Event detail | [Get Event](https://docs.kalshi.com/api-reference/events/get-event.md) |
| GET | `/markets` | List markets (`series_ticker`, `event_ticker`, `tickers`, `status` ∈ `unopened\|open\|closed\|settled`, `min_settled_ts`, `mve_filter`, `limit`, `cursor`) | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) |
| GET | `/markets/{ticker}` | Market detail | [Get Market](https://docs.kalshi.com/api-reference/market/get-market.md) |
| GET | `/markets/{ticker}/orderbook` | Orderbook (`depth`; bids only; `[price_dollars, count_fp]` ascending, best bid last; "Order counts per level are not returned"; unknown ticker → `200` with empty arrays, **not** `404`) | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) · [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses.md) |
| GET | `/markets/orderbooks` | Multiple orderbooks in one request (path params not re-read this session — **unverified**) | [Get Multiple Market Orderbooks](https://docs.kalshi.com/api-reference/market/get-multiple-market-orderbooks.md) |
| GET | `/markets/candlesticks` | **Batch** candlesticks: `market_tickers` (≤ **100** tickers), `start_ts`, `end_ts`, `period_interval`, `include_latest_before_start`; total periods across all tickers ≤ **10,000** or `400 bad_request`; "the response is never truncated"; grouped per `market_ticker` | [Batch Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/batch-get-market-candlesticks.md) |
| GET | `/series/{series_ticker}/markets/{ticker}/candlesticks` | Candlesticks for one market: `start_ts`/`end_ts` in **seconds** (ms → `400`), `period_interval` ∈ `1\|60\|1440`, ≤ **5,000** periods/request; "The most recent candlesticks can be a few seconds behind the latest trades and quotes"; markets settled before the cutoff need the historical endpoint | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) |
| GET | `/markets/trades` | Trade tape: `ticker`, `limit` (1–1000, default 100), `min_ts`/`max_ts` (**seconds**; ms → `400`), `cursor` (an undecodable cursor is **ignored** and page 1 is returned), `is_block_trade`; unknown `ticker` → `200` with an empty list; `Trade` = `trade_id`, `ticker`, `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side`, `taker_book_side`, `created_time`, `is_block_trade` (`taker_side` is deprecated, "will not be removed before May 14, 2026") | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades.md) |

**Field units.** Prices are fixed-point dollar **strings** (≤ 4 dp, e.g. `"0.4200"`) and quantities are
fixed-point **count strings** (2 dp, e.g. `"13.00"`; minimum granularity 0.01 contracts); the integer-cent
fields (`yes_bid`, `last_price`, …) are the legacy representation.
[Fixed-Point Representation](https://docs.kalshi.com/getting_started/fixed_point_migration.md).

**Market fields this site reads** ([Get Events](https://docs.kalshi.com/api-reference/events/get-events.md)
publishes the same `Market` schema as `GET /markets`/`GET /markets/{ticker}`):

| Field | Official meaning | Note for this repo |
|---|---|---|
| `status` | `initialized \| inactive \| active \| closed \| determined \| disputed \| amended \| finalized` | **Closes the long-standing flag** "demo `active`/`finalized` differ from the documented set": the *response* enum is this one; the *filter* enum is `unopened\|open\|closed\|settled`. No anomaly. |
| `result` | `'yes' \| 'no' \| 'scalar' \| ''` | `''` before settlement, so a blank result is documented behaviour, not missing data |
| `last_price_dollars` | "Price for the last traded YES contract on this market in dollars" | the dashboard's price series |
| `previous_price_dollars` | **"Price for the last traded YES contract on this market a day ago in dollars"** | **not** the previous trade; see the correction note under Alerts below. `previous_yes_bid_dollars` / `previous_yes_ask_dollars` are worded the same way. |
| `volume_fp`, `volume_24h_fp` | "market volume **in contracts**" | no official dollar-volume field → the site's `$_volume` estimate stays an estimate |
| `notional_value_dollars` | "The total value of a single contract at settlement in dollars" | per-contract value, **not** traded notional |
| `open_interest_fp` | "number of contracts bought on this market disconsidering netting" | — |
| `settlement_value_dollars` | "The settlement value of the YES/LONG side … **Only filled after determination**" | must not be read as `$0` while `determined` |
| `settlement_ts` | "Timestamp when the market settled" | — |
| `settlement_timer_seconds` | "amount of time after determination that the market settles" | — |
| `title`, `subtitle`, `no_sub_title` | **deprecated** on markets (`no_sub_title` "Use `yes_sub_title` instead. Equal to `yes_sub_title` on every market created since September 2024") | the collector's settled-market fallback classifies on market `title`; prefer `yes_sub_title` + event title (change request R3) |
| `close_time`, `latest_expiration_time`, `expected_expiration_time` | "Never later than `latest_expiration_time`" | used for the countdown column |
| `price_level_structure`, `price_ranges`, `settlement_bounds_type` | required fields of the schema | used by the ladder/price-grid code |

## Private endpoints (signed)

| Method | Path | Purpose | Official reference |
|--------|------|---------|--------------------|
| GET | `/portfolio/balance` | Balance + portfolio value; own rate-limit bucket (Basic/Advanced: 1/s, higher tiers: 5/s) | [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance.md) · [Rate Limits](https://docs.kalshi.com/getting_started/rate_limits.md) |
| GET | `/portfolio/positions` | Positions — "**Returns unsettled positions by default**"; use `settlement_status=settled\|all` for settled ones still live | [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions.md) |
| GET | `/portfolio/fills` | Fills — "Fills that occurred before the historical cutoff are only available via `GET /historical/fills`" | [Get Fills](https://docs.kalshi.com/api-reference/portfolio/get-fills.md) |
| GET | `/portfolio/settlements` | Settlement records **still in the live data set**; archived ones only via `GET /historical/positions`, which has different fields | [Get Settlements](https://docs.kalshi.com/api-reference/portfolio/get-settlements.md) |
| POST | `/portfolio/events/orders` | **Create Order (V2)**. Required: `ticker`, `side ∈ bid\|ask`, `count` (fp string), `price` (dollar string), `time_in_force ∈ fill_or_kill\|good_till_canceled\|immediate_or_cancel`, `self_trade_prevention_type ∈ taker_at_cross\|maker`. Optional `expiration_time` (seconds, only with `good_till_canceled`; `GTT` is not a valid API value), `post_only`, `reduce_only`, `subaccount`, `exchange_index`, `client_order_id`. "A `201` means the order was accepted, not that it is resting: check `remaining_count`." | [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2.md) |
| DELETE | `/portfolio/events/orders/{order_id}` | Cancel (V2) → `{order_id, client_order_id, reduced_by, ts_ms}`; auto-routing **requires** `market_ticker` (`exchange_index` omitted or `-1`); a cancel sent to the wrong shard returns `404` "even though the order is still resting"; 2 tokens/request | [Cancel Order (V2)](https://docs.kalshi.com/api-reference/orders/cancel-order-v2.md) |
| POST | `/portfolio/events/orders/{order_id}/amend` | Amend (V2): requires `ticker`, `side`, `price`, `count` where `count` = filled + desired resting; a no-op amend returns `400 AMEND_ORDER_NO_OP`; "Amending only expiry or decreasing size preserves queue position" | [Amend Order (V2)](https://docs.kalshi.com/api-reference/orders/amend-order-v2.md) |
| POST | `/portfolio/events/orders/{order_id}/decrease` | Decrease (V2): "Exactly one of `reduce_by` or `reduce_to` must be provided" | [Decrease Order (V2)](https://docs.kalshi.com/api-reference/orders/decrease-order-v2.md) |
| POST | `/portfolio/batch_orders` (V2 batch forms) | Batch create/cancel; "Batch REST creates and cancels always bill their total per-order cost to your unscoped Write bucket"; max batch size scales with the tier write budget | [Batch Create Orders (V2)](https://docs.kalshi.com/api-reference/orders/batch-create-orders-v2.md) · [Rate Limits](https://docs.kalshi.com/getting_started/rate_limits.md) |

> **Correction (2026-11-21).** This file previously gave the create-order body as
> `{ticker, action, side, type, count, yes_price|no_price}`. That is the **V1** shape. The V1
> `/portfolio/orders` writes "have been removed and now return `410 Gone` with code
> `deprecated_v1_order_endpoint`" — which also **closes** the demo-account flag that had recorded the 410
> behaviour as unverified ([Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2.md)).
> There is no documented `POST /portfolio/events/orders` alternative to the V2 shape above.

## Historical tier (this is why "old" data disappears)

[Historical Data](https://docs.kalshi.com/getting_started/historical_data.md) — "To keep the live API fast
and responsive, Kalshi partitions exchange data into **live** and **historical** tiers", and the
partitioning "happens for **markets**, **market_candlesticks**, **trades**, **orders**, and
**market_positions**. Old **Events** and **Series** will always still be available through their original
endpoints."

| Endpoint | Description |
|---|---|
| `GET /historical/cutoff` | "Returns the current cutoff timestamps" (`market_settled_ts`, `trades_created_ts`, `orders_updated_ts`, `market_positions_last_updated_ts`) |
| `GET /historical/markets` · `GET /historical/markets/{ticker}` | Settled markets older than the cutoff |
| `GET /historical/markets/{ticker}/candlesticks` | Candlesticks for historical markets |
| `GET /historical/trades` · `GET /historical/fills` | Trades / user fills older than the cutoff |
| `GET /historical/orders` · `GET /historical/positions` | Completed orders; archived settled positions |

Direct consequences for this site: the Resolved archive (`GET /markets?status=settled&min_settled_ts=…`)
shrinks as rows age out; empty candlesticks for a long-settled market are **expected** (closes flag C5);
and the seconds/minutes chart windows are bounded by `trades_created_ts`.

## WebSocket

- URL: see the Base URLs table (path `/trade-api/ws/v2`).
- **Even public market-data channels need an authenticated handshake**: "even channels that carry public
  market data still use the authenticated WebSocket session, but they do not impose additional
  per-channel authorization checks"
  ([Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets.md)).
  A browser cannot hold a private key, which is why the dashboard polls REST — recorded as verified, not assumed.
- Sign `GET` + `/trade-api/ws/v2` for the handshake (same header set as REST).
- Channels: private `orderbook_delta`, `fill`, `market_positions`, `communications`,
  `order_group_updates`, `user_orders`; public market-data `ticker`, `trade`, `market_lifecycle_v2`,
  `multivariate_market_lifecycle`.
- Handshake `429` "has two causes": the tier's concurrent-connection limit, or opening connections too
  quickly — "Reconnect with exponential backoff instead of retrying in a tight loop, and close
  connections you no longer use."
- Keep-alive: "Kalshi sends a Ping frame only after 10 seconds without sending a data message … do not
  treat a missing Ping as a dead connection."

## Rate limits and 429s

[Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits.md):

- Token buckets: "Most requests cost the default of **10 tokens**"; `GET /account/endpoint_costs` "is the
  authoritative list of non-default costs currently in effect". Read and Write buckets are independent.
- **Unauthenticated traffic is separate**: "Unauthenticated public requests are subject to separate limits.
  Authenticate requests where supported and back off on `429`." (No numeric limit for unauthenticated
  traffic is published — the repo's flag on this stays open, correctly.)
- Bursting: Basic/Advanced Read buckets hold up to **three seconds** of budget, so "You can then spend up
  to **three times your per-second budget in a single burst**"; some buckets hold only one second.
- `429` body is `{"error": {"code": "too_many_requests", "message": "too many requests"}}`; the response
  carries `X-RateLimit-Limit / -Remaining / -Reset / -Cost` **but not `Retry-After`**; "There is no penalty
  or cooldown … Apply exponential backoff on 429."
- `X-RateLimit-Reset` is "Seconds, to the millisecond, until the bucket is full again" — a better pacing
  signal than a blind backoff (change request R2).

## Alerts / swing detection — semantics note (verified 2026-11-21)

The dashboard's alert detector uses two inputs: the difference between consecutive REST samples, and a
fallback built on `previous_price_dollars`. The official definition of that field is the last traded YES
price **a day ago** (see the market-fields table above), so the fallback measures a **24-hour** reference
move, not a move inside one poll window. `assets/app.js` and `executive-summary.html` are labelled
accordingly by change request **R1** in `COORDINATION.md` (file owned by another session, so not edited here).
Full audit: [`reports/VERIFICATION_9b6ffae0.md`](../reports/VERIFICATION_9b6ffae0.md) rows 9b-J, 9b-G, 9b-H.

## Terms that govern this kind of project (read 2026-11-21)

[Kalshi Developer Agreement v1.1](https://assets.kalshi.com/Kalshi-Developer-Agreement.pdf) —
"Accessing or using Kalshi's API shall be considered a binding acceptance of this Agreement" (§1).
§3 limits API use to "facilitating a members own trading on the Exchange"; §3.1 prohibits "Collecting,
caching, aggregating, or storing data or content accessed via the API except for purposes of facilitating
your own trading on Kalshi" and sharing it "with third parties in any manner without prior written
authorization from Kalshi"; §3.5 prohibits access "for purposes of monitoring the availability,
performance, or functionality of any of Kalshi's services or for any other benchmarking or competitive
purposes"; §4.3 **requires** exponential backoff, a bounded number of retries, and monitoring "with any
dashboards and alerting required"; §5 lets Kalshi change limits "without notice"; §6.4 requires prior
written approval for public statements relating to Kalshi or its API. This repo stores API snapshots and
publishes them, so §3.1/§3.5/§6.4 are **flagged for the owner's decision** (see `flagged.html`,
F-9b-1/2/3). No legal conclusion is offered here.

## Unverified / flagged (kept in the open, never filled in)

- `GET /markets/orderbooks`: existence verified via the official index; **query-parameter spelling and
  per-request limits not re-read this session.**
- Legacy `POST /log_in` / Basic-token auth: **not in the official docs** (third-party SDK behaviour only).
- Whether the demo environment is treated differently under Developer Agreement §3.1: **no carve-out
  appears in the agreement text as read**; owner decision.
- Rule reference inconsistency inside Kalshi's own gas rulebooks (`AAAGASNEW` cites Rule 7.1,
  `AAAGASMINMAX` cites Rule 6.3(c) for the same review process): recorded verbatim, **not** resolved.
- The fee-schedule PDF's "centicent" prose vs its own whole-cent table: engine follows the table
  (already flagged as F-DA-5).
- Every live-response value on this page: the sandbox cannot reach the demo API, so live evidence comes
  from the CI snapshot job and `data/log.md`, not from this file.
