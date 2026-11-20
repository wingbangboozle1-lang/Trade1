# Sources — official / trusted references used

Every technical claim in this repo is grounded in one of the sources below. These were reached from
the build sandbox (GitHub/npm/PyPI) or, where a host was unreachable, are the official Kalshi
documentation endpoints the dashboard calls at runtime. No claim is sourced from memory alone.

## Reached and read directly from the sandbox

| # | Source | What it verified | URL |
|---|--------|------------------|-----|
| 1 | Kalshi official starter code (`Kalshi/kalshi-starter-code-python`) | Demo base URL (`https://demo-api.kalshi.co`), `/trade-api/v2` paths, RSA-PSS header auth (`KALSHI-ACCESS-KEY`/`KALSHI-ACCESS-SIGNATURE`/`KALSHI-ACCESS-TIMESTAMP`), signature over `timestamp+method+path`, WebSocket subscribe message, `/portfolio/balance`, `/portfolio/positions`, `/portfolio/events/orders` | https://github.com/Kalshi/kalshi-starter-code-python |
| 2 | `kalshi` Python SDK on PyPI (v0.2.0) | Alternative auth: `POST /log_in` returns a token used as `Authorization: Basic`; base endpoints | https://pypi.org/project/kalshi/ |
| 3 | `mlucy/kalshi_py` SDK + REST spec (`swagger.json`) | Endpoint inventory (markets, orderbook, balance, positions, orders, trades, history) and auth header scheme | https://github.com/mlucy/kalshi_py |

## Official Kalshi endpoints (called at runtime; not reachable from the sandbox)

These are the official Kalshi demo endpoints the dashboard fetches in the browser. They are listed
here as the authoritative source for the values shown; they were **not** reachable from the build
sandbox, which is why live values are fetched client-side and flagged until a browser confirms them.

| Endpoint | Purpose |
|----------|---------|
| https://external-api.demo.kalshi.co/trade-api/v2/markets | Live market list (filters: series_ticker, event_ticker, status, limit, cursor) |
| https://external-api.demo.kalshi.co/trade-api/v2/markets/{ticker} | Single market (title, yes_bid/ask, last_price, volume, close_ts, status, result) |
| https://external-api.demo.kalshi.co/trade-api/v2/markets/{ticker}/orderbook | Orderbook / liquidity (contracts available per price) |
| https://external-api.demo.kalshi.co/trade-api/v2/events | Events |
| https://external-api.demo.kalshi.co/trade-api/v2/series | Series (category/tag discovery) |
| https://external-api.demo.kalshi.co/trade-api/v2/exchange/status | Reachability probe (public) |
| https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance | Demo balance (signed) |
| https://external-api.demo.kalshi.co/trade-api/v2/portfolio/positions | Demo open positions (signed) |
| https://external-api.demo.kalshi.co/trade-api/v2/portfolio/events/orders | Place demo order (signed) |

Demo fallback host: https://demo-api.kalshi.co/trade-api/v2

## Kalshi API documentation (referenced; host blocked from sandbox)

| # | Source | Note | URL |
|---|--------|------|-----|
| 4 | Kalshi API documentation — Quick Start: Market Data | Public market-data flow and endpoint examples (browser fetch) | https://docs.kalshi.com/getting_started/quick_start_market_data |
| 5 | Kalshi API reference | Endpoint + parameter reference | https://docs.kalshi.com |

## Note on verification
Where a value could not be confirmed against an official source (all live Kalshi values, from the
sandbox), it is left blank and flagged on the **Flagged for Review** page. The dashboard's live
client fetches these values from the official endpoints in the browser, so what a user sees is the
official value at view time.
