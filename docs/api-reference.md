# Kalshi Demo API — Verified Reference

Derived from the official sources in [sources.md](./sources.md). Only endpoints verified against
Kalshi's own code/spec are listed. Items that could not be confirmed are marked **(unverified)**.

## Base URLs
| Environment | REST base | WebSocket |
|-------------|-----------|-----------|
| Demo (task-specified) | `https://external-api.demo.kalshi.co/trade-api/v2` | `wss://external-api-demo.kalshi.co/trade-api/ws/v2`* |
| Demo (official starter code) | `https://demo-api.kalshi.co/trade-api/v2` | `wss://demo-api.kalshi.co/trade-api/ws/v2` |

\* The task text writes the WS host as `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`. The
official starter code constructs the WS URL from the same host as REST (`wss://demo-api.kalshi.co` +
`/trade-api/ws/v2`). The dashboard uses the REST host it successfully connects to and appends
`/trade-api/ws/v2`. **(flagged: WS host naming differs across sources)**

## Authentication
**Current (RSA-PSS)** — used by the official starter code for `/trade-api/v2`:
- Sign `msgString = timestamp_ms + method + path`
- Sign with the API private key using RSA-PSS, `MGF1(SHA-256)`, salt length = SHA-256 digest length (32)
- Base64 the signature and send headers:
  - `KALSHI-ACCESS-KEY: <key_id>`
  - `KALSHI-ACCESS-SIGNATURE: <base64>`
  - `KALSHI-ACCESS-TIMESTAMP: <timestamp_ms>`

**Legacy (Basic token)** — used by the PyPI `kalshi` SDK:
- `POST /log_in` with `{email, password}` → `{token, user_id, access_level}`
- Send `Authorization: Basic <token>`

The dashboard implements RSA-PSS via WebCrypto for private endpoints and plain `fetch` for public ones.

## Public endpoints (no auth)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/exchange/status` | Exchange status / reachability |
| GET | `/series` | List series (supports `category`, `tags`, `limit`, `cursor`) |
| GET | `/series/{series_ticker}` | Series detail |
| GET | `/events` | List events (`status`, `limit`, `cursor`) |
| GET | `/events/{event_ticker}` | Event detail |
| GET | `/markets` | List markets (`series_ticker`, `event_ticker`, `status`, `limit`, `cursor`) |
| GET | `/markets/{ticker}` | Market detail (`yes_bid`, `yes_ask`, `last_price`, `volume`, `close_ts`, `status`, `result`) |
| GET | `/markets/{ticker}/orderbook` | Orderbook (`depth` optional) |
| GET | `/markets/candlesticks` | Batch candlesticks |
| GET | `/markets/trades` | Recent trades |

Prices are in **cents** (e.g. `45` = `$0.45`); the dashboard converts to dollars for display.

## Private endpoints (RSA-PSS signed)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/portfolio/balance` | Cash balance |
| GET | `/portfolio/positions` | Open positions (`status=open`) |
| GET | `/portfolio/orders` | Order history |
| GET | `/portfolio/fills` | Your fills |
| GET | `/portfolio/history` | Portfolio value history |
| POST | `/portfolio/events/orders` | Create order **(unverified: exact body — see flagged)** |
| DELETE | `/portfolio/events/orders/{order_id}` | Cancel order |
| POST | `/portfolio/events/orders/{order_id}/amend` | Amend order |
| POST | `/portfolio/events/orders/{order_id}/decrease` | Decrease quantity |

## WebSocket
- URL: `<host>/trade-api/ws/v2`
- Subscribe: `{"id":1,"cmd":"subscribe","params":{"channels":["ticker"]}}`
- Public channels: `ticker`, `trade`, `market_lifecycle_v2`
- Private channels (authenticated handshake, **not usable from a browser**): `orderbook_delta`,
  `fill`, `market_positions`, `user_orders` — the dashboard uses REST orderbook polling instead.

## Unverified / flagged
- Exact JSON body for `POST /portfolio/events/orders` — the sandbox could not reach the endpoint.
  The dashboard uses the documented shape `{ticker, action, side, type, count, yes_price|no_price}`.
- WebSocket host naming differs between the task text and the official starter code (see above).
