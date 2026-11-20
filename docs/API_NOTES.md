# Kalshi Demo API — Verified Reference (docs/API_NOTES.md)

**Session:** `sess-a1-9a0ad587` · **Verified:** 2026-11-20 · **Rule:** every fact below was checked
against an official Kalshi source (documentation page fetched this session, or a live response from
the official demo API host). Anything not verifiable is listed in [FLAGGED.md](FLAGGED.md).

## 1. Environments

| Item | Value | Official source |
|---|---|---|
| Demo REST root (recommended) | `https://external-api.demo.kalshi.co/trade-api/v2` | [docs.kalshi.com — Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md) |
| Demo REST root (also supported) | `https://demo-api.kalshi.co/trade-api/v2` | [docs.kalshi.com — API Environments](https://docs.kalshi.com/getting_started/api_environments.md) |
| Demo WebSocket (recommended) | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [docs.kalshi.com — Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md) |
| Production REST root (reference) | `https://external-api.kalshi.com/trade-api/v2` | [docs.kalshi.com — Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data.md) |
| Demo credentials | Separate from production; mock funds; demo market behavior "may not be reflective of real markets" | [docs.kalshi.com — Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env.md) |

## 2. Authentication model

- **Market data (series, events, markets, orderbooks, trades, candlesticks): no authentication required.**
  Source: [Quick Start: Market Data](https://docs.kalshi.com/getting_started/quick_start_market_data.md) —
  "No authentication headers are required for the endpoints in this guide."
- **Orders, portfolio, and WebSocket connections require a signed API key** (RSA-PSS or Ed25519 signature
  over `timestamp + METHOD + path`; headers `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE`).
  Source: [Quick Start: Authenticated Requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md),
  [API Keys](https://docs.kalshi.com/getting_started/api_keys.md). Consequence for this project: the
  browser dashboard uses public REST polling; live WebSocket streaming needs demo API keys we do not have.
- **Path signing detail:** sign the path *without query string*; demo keys work only against demo hosts.
  Source: [API Environments](https://docs.kalshi.com/getting_started/api_environments.md).

## 3. Public endpoints used by the dashboard (all verified against live demo responses)

| Endpoint | Purpose | Verified params / response facts | Source |
|---|---|---|---|
| `GET /series` | Discover series per topic | `category` (exact, case-sensitive; matches any entry in series `categories`), `tags`, `include_volume`. Series object: `ticker`, `title`, `category`, `categories`, `tags`, `fee_type`, `fee_multiplier`, `contract_terms_url`, `contract_url`, `settlement_sources[]` | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list.md) |
| `GET /events` | List open events | `status=open`, `limit`, `cursor`. Event fields: `category`, `event_ticker`, `series_ticker`, `title`, `sub_title`, `mutually_exclusive`, `settlement_sources[]`, `last_updated_ts` | [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md); live probe 2026-11-20 |
| `GET /markets` | Live market quotes | `series_ticker`, `event_ticker`, `status` filter values `unopened\|open\|closed\|settled`, `limit`, `cursor`; sorted newest-first; **responses cached briefly — prices can lag the exchange by several seconds** | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) |
| `GET /markets/{ticker}/orderbook` | Liquidity: contracts available at each price | Returns `orderbook_fp.yes_dollars` / `no_dollars` = `[price_dollars, count_fp]` pairs, **ascending, best bid last**; a YES bid at X ≡ NO ask at (100−X); `depth` 0–100 | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) |
| `GET /series/{series_ticker}/markets/{ticker}/candlesticks` | Price history graph | `start_ts`/`end_ts` in **seconds**, `period_interval` ∈ **{1, 60, 1440} minutes**, max **5,000 periods** per request; candle fields `end_period_ts`, `price.{open,high,low,close}_dollars`, `volume_fp`, `open_interest_fp`; most recent candles can lag a few seconds | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) |
| `GET /markets/trades` | Trade tape / jump detection | `ticker`, `limit` (1–1000, default 100), `min_ts`/`max_ts` in seconds, cursor; trade fields `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side` (`yes`/`no`), `created_time`, `is_block_trade` | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades.md) |

## 4. Market object fields (verified from live demo response, 2026-11-20)

Verified from `GET /markets?series_ticker=KXBTC&status=open` and `...&status=settled`:
`ticker`, `event_ticker`, `title`, `subtitle`, `yes_sub_title`, `no_sub_title`, `status` (observed values:
`active`, `finalized`), `result` (observed on settled market: `"yes"` / `"no"`; empty while open),
`yes_bid_dollars`, `yes_ask_dollars`, `no_bid_dollars`, `no_ask_dollars`, `yes_bid_size_fp`, `yes_ask_size_fp`,
`last_price_dollars`, `previous_price_dollars`, `open_interest_fp`, `volume_fp`, `volume_24h_fp`,
`notional_value_dollars`, `open_time`, `close_time`, `expected_expiration_time`, `can_close_early`,
`strike_type` (`greater`/`less`/…), `floor_strike`, `cap_strike`, `rules_primary`, `rules_secondary`,
`market_type`, `price_level_structure` (`linear_cent`), `settlement_bounds_type`, `settlement_timer_seconds`,
`custom_strike`, and on settled markets `settlement_ts`, `settlement_value_dollars`, `expiration_value`.

## 5. Resolution ("How the event was resolved — yes or no")

- Settlement: "Yes outcome: Yes contract holders receive $1 per contract. No outcome: No contract holders
  receive $1 per contract." Only net positions are settled. No settlement fee.
  Source: [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement.md).
- Dashboard tracks every market it has shown (watchlist persisted in `localStorage`); when the API reports
  `status=finalized` with `result=yes|no`, the event row flips to **Resolved: YES/NO** with `settlement_ts`.

## 6. Fees (used by the simulated-trade engine)

- Taker fee: `fees = roundup(M × 0.07 × C × P × (1 − P))`, charged only on immediately-matched orders.
- Maker fee: `fees = roundup(M × 0.0175 × C × P × (1 − P))` with M default **0** (i.e., zero unless a series
  is listed in the non-standard table). No settlement fee, no membership fee.
- Series-level `fee_type` / `fee_multiplier` are provided by `GET /series` (verified live: KXGAS
  `fee_multiplier: 1`, `fee_type: quadratic`).
- Source: [Kalshi Fee Schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective July 7, 2026),
  cross-checked with [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list.md) field docs.

## 7. Rate limits (drives the dashboard's polling design)

- Token-bucket model; most requests cost **10 tokens**; separate Read/Write buckets; **unauthenticated
  public requests are subject to separate limits**; on `429`, back off (no `Retry-After` header).
  Source: [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits.md).
- Dashboard design consequence: staggered polling (markets every 5 s per topic, orderbook/trades every
  5 s for the selected market only), exponential backoff on 429, and a visible "API status" indicator.

## 8. Topic → series mapping (each verified live on the demo API, 2026-11-20)

| Topic | Verified on demo | Discovery used by dashboard |
|---|---|---|
| Gas prices | `KXGAS` "Gas weekly", category Economics, settlement source U.S. EIA | `GET /series?category=Economics` + keyword filter (`gas`) + seed series `KXGAS` |
| Elections | Category `Elections` observed on live events (e.g. `KXNEXTNATOSECGEN`, `KXNEWPOPE`) | `GET /events?status=open` filtered to category `Elections` |
| Culture | `KXTIME` "TIME's Person of the Year", category Entertainment | `GET /events?status=open` filtered to categories `Entertainment`/`Culture` |
| Crypto | `KXBTC` "Bitcoin price range", `KXETH` "Ethereum range" (category Crypto, CF Benchmarks settlement) | `GET /series?category=Crypto` + seeds `KXBTC`, `KXETH` |
| Golf | `KXPGA` "PGA Championship", `KXMASTERS` "Masters Tournament" (category Sports, tags `["Golf"]`) | `GET /series?category=Sports` filtered to `tags` containing `Golf` + seeds |
