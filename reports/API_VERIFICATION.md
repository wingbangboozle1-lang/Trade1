# API verification — Kalshi demo API

Task T2 · Session `a2ec5543` · 2026-11-20 (UTC) · Every row links to an official Kalshi page or an observed demo response. **Unverified** rows are left open and listed on the Flagged page.

Sandbox note: the build sandbox cannot reach Kalshi hosts. Live reads run in GitHub Actions (`site.yml`). Documentation was read through the page fetcher, and the list of pages is in `config/sources.json`.

## A. Environment and access

| # | Claim | Official source | Status |
|---|---|---|---|
| A1 | Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2` (recommended); also `https://demo-api.kalshi.co/trade-api/v2` | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Verified (docs) |
| A2 | Demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Verified (docs). Not used by this site. |
| A3 | Demo and production credentials are separate | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Verified (docs) |
| A4 | WebSocket connections require authentication during the handshake, even for public channels | [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md) | Verified (docs). Reason the site polls REST instead. |
| A5 | Exchange active and trading active on all demo shards | `GET /exchange/status` on the demo host (observed in build log, run `44743945798`) | Verified (observed) |
| A6 | Public reads need no key: `/exchange/status`, `/events`, `/series`, `/markets`, `/markets/{t}/orderbook`, candlesticks | [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses.md) ("No authentication is required"); probe responses in `probe/output2.txt` | Verified (docs + observed) |
| A7 | CORS `Access-Control-Allow-Origin: https://wingbangboozle1-lang.github.io` on `GET /exchange/status` (status 200) | `probe/output2.txt` (observed) | Verified (observed) |

## B. Markets listing (`GET /markets`)

| # | Claim | Official source | Status |
|---|---|---|---|
| B1 | `status` filter values: `unopened`, `open`, `closed`, `settled` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) | Verified (docs) |
| B2 | `status=finalized` and `status=active` are rejected with HTTP 400 | `probe/output2.txt` (observed) | Verified (observed). Only the four values above are used. |
| B3 | `status=settled` returns markets with `status: finalized` and `result` `yes`/`no` | `probe/output2.txt` (observed: results `no`, `no`, `yes`) | Verified (observed) |
| B4 | `mve_filter=exclude` removes multivariate (combo) markets | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) (parameter list) | Verified (docs). Used by `build_site.py`. |
| B5 | `min_settled_ts` works with `status=settled`; results sorted by settlement time, latest first | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) (compatibility table and sort rules) | Verified (docs). Note: the fetch cap therefore keeps the newest rows. |
| B6 | `tickers` filter returns all matches in one response when it is the only filter; `limit` is not applied | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) | Verified (docs). **Not used** by the build. Batch reads are not implemented. |
| B7 | Pagination: `limit` max 1000; follow `cursor` until empty | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) | Verified (docs) |
| B8 | Volume fields are contract counts (`volume_fp`, `volume_24h_fp`); there is no 24h dollar-volume field | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) | Verified (docs). The site's dollar figure is a **derived estimate** (contracts × last price). |
| B9 | Market `result` enum: `yes`, `no`, `scalar`, blank | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets.md) | Verified (docs) |
| B10 | Settled YES pays $1.00 per contract; NO pays $1.00 per No contract | [Market settlement](https://docs.kalshi.com/getting_started/market_settlement.md) | Verified (docs) |
| B11 | Historical cutoff: settled markets older than the cutoff move to `/historical/markets` | [Historical data](https://docs.kalshi.com/getting_started/historical_data.md); `GET /historical/cutoff` (observed `market_settled_ts` 2026-09-21T00:00:00Z) | Verified (docs + observed). The 30-day settled window is after the cutoff. |

## C. Candlesticks

| # | Claim | Official source | Status |
|---|---|---|---|
| C1 | Path `GET /series/{series}/markets/{ticker}/candlesticks`, params `start_ts`, `end_ts` (seconds), `period_interval` ∈ {1, 60, 1440} | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) | Verified (docs) |
| C2 | Max 5,000 periods per request; millisecond timestamps rejected with 400 | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) | Verified (docs) |
| C3 | Response: `ticker`, `candlesticks[]` with `end_period_ts`, `price` (PriceDistribution: `open_dollars`, `low_dollars`, `high_dollars`, `close_dollars`, `mean_dollars`, `previous_dollars`, `min_dollars`, `max_dollars`), `yes_bid`, `yes_ask` (BidAskDistribution), `volume_fp`, `open_interest_fp` | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) (schema, chunks 0–1) | Verified (docs). `build_site.py` `candles()` reads exactly these fields. |
| C4 | Pre-cutoff settled markets use `GET /historical/markets/{ticker}/candlesticks` | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) | Verified (docs). **Not implemented.** The backtest reads live candles only; see Flagged. |
| C5 | `KXAAAGASM-26OCT31-4.18` (finalized, result yes, last price 0.8300, volume 784.60) returned **no** candlesticks for 1-hour period over 3 days | `probe/output2.txt` (observed) | **Unverified cause.** Left as a flag. Not explained. |

## D. Orderbook

| # | Claim | Official source | Status |
|---|---|---|---|
| D1 | `GET /markets/{ticker}/orderbook` returns resting bids only: `yes_dollars` and `no_dollars` arrays of `[price, count]` | [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses.md) | Verified (docs) |
| D2 | Arrays are ascending; best bid is the last element | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) (per source notes S05) | Verified (docs). `orderbook_summary()` uses the last element. |
| D3 | YES ask = 1.00 − best NO bid; NO ask = 1.00 − best YES bid | [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses.md) | Verified (docs) |
| D4 | Unknown ticker returns empty arrays, not 404 | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) (per S05) | Verified (docs) |

## E. Formats and limits

| # | Claim | Official source | Status |
|---|---|---|---|
| E1 | `*_dollars` fields are fixed-point dollar strings; `*_fp` fields are contract counts with 2 decimals | [Fixed-point migration](https://docs.kalshi.com/getting_started/fixed_point_migration.md) | Verified (docs). Parsed with `float()`. |
| E2 | Price grids come from `price_ranges` | [Fixed-point migration](https://docs.kalshi.com/getting_started/fixed_point_migration.md) | Verified (docs). Not used. |
| E3 | Rate limits: token-metered; back off on HTTP 429 | [Rate limits](https://docs.kalshi.com/getting_started/rate_limits.md) | Verified (docs). `kalshi_api.py` retries 429 and 5xx with backoff. |
| E4 | `KalshiError` | Not an official type. It is our own exception class in `scripts/kalshi_api.py` (line 19). | Our code; not an official SDK name. |

## F. Contract terms and agreements

| # | Claim | Official source | Status |
|---|---|---|---|
| F1 | Gas contract AAAGAS: Source Agency AAA; Underlying = average regular-gas price for the area on the date; Settlement Value $1.00; Minimum Tick $0.01; Expiration time 10:15 AM, 11:00 AM or 3:00 PM ET; no data on expiration date → resolves on last available day's data | [AAAGAS contract terms (PDF)](https://assets.kalshi.com/contract_terms/AAAGAS.pdf) | Verified (PDF read) |
| F2 | Other gas terms: `AAAGASNEW.pdf`, `AAAGASMINMAX.pdf` | `contract_terms_url` from `GET /series` | **Not opened.** Unverified. |
| F3 | Kalshi Developer Agreement v1.1 terms | [Developer Agreement](https://kalshi.com/developer-agreement) | **Not read.** The fetch returned only a PDF viewer placeholder. |

## G. Items found in the repo's own code that need a decision

- `scripts/build_site.py` fetches all open non-multivariate markets (about 291,000 in the CI run) and keeps the top 300 per topic by estimated dollars. The rest are counted, not shown.
- The settled fetch stops at 200,000 rows (`SETTLED_PAGE_CAP`) and is flagged when hit.
- `MAX_ROWS_PER_TOPIC` is 300 for the committed snapshot.
