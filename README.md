# Kalshi Demo Monitor

A live, interactive dashboard for the **Kalshi demo exchange** ([official demo REST API](https://external-api.demo.kalshi.co/trade-api/v2)), focused on **gas prices, elections, culture, crypto, and golf**. It ranks live events by estimated dollar amount, alerts on **price swings ≥ $0.10 in either direction** through two scrolling feeds (all events + a documented high-ROI model filter), follows tracked events **through resolution (official yes/no result)**, and runs **automated simulated trades** with portfolio analytics — all in the browser, with zero manual input and zero credentials.

**Live site:** https://wingbangboozle1-lang.github.io/Trade1/ (GitHub Pages, deployed from `site/`)

## Architecture

100% static client-side app: your browser talks **directly** to the official demo API's public market-data endpoints (no API key needed per [official docs](https://docs.kalshi.com/getting_started/quick_start_market_data)). No backend, no credentials, no data ever leaves your browser except read-only API calls. All simulated state (alerts, picks, paper trades, resolutions) lives in `localStorage`.

| Piece | Where |
|---|---|
| Shared engine (API client, classifier, alerts, chats, chart, orderbook, tape, resolution tracker, paper bot, portfolio) | `site/assets/app.js` |
| Pages | `site/index.html` (landing), `site/live.html` (full dashboard), `site/{gas-prices,elections,culture,crypto,golf}.html` (topic pages), `site/strategies.html`, `site/findings.html`, `site/resolved.html`, `site/flagged.html` |
| Verified snapshot (values captured 2026-11-20 from official endpoints, source URL per row) | `site/data/snapshot-2026-11-20.json` |
| Unit + smoke tests (fee table vs official schedule, alert engine, classifier, bot P&L, page boots) | `tests/` |
| Executive summary | `EXECUTIVE_SUMMARY.md` |
| Line-by-line verification log | `docs/VERIFICATION.md` |
| Multi-session task board | `COORDINATION.md` |

## Run locally

Any static server works — e.g.:

```bash
cd site && python3 -m http.server 8080
# open http://localhost:8080
```

Tests:

```bash
node tests/engine.test.js   # 36 assertions incl. official fee-table checks
node tests/smoke.test.js    # boots all 11 pages with stubbed network
```

## API usage (all public, unauthenticated)

| Endpoint | Use | Reference |
|---|---|---|
| `GET /events?status=open` (+cursor) | event catalog with category + settlement sources | [Get Events](https://docs.kalshi.com/api-reference/events/get-events) |
| `GET /markets?status=open` (+cursor, +`event_ticker`/`series_ticker`) | prices, sizes, volume, OI | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| `GET /markets/{ticker}/orderbook?depth=` | bid ladder, contracts at each price | [Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) |
| `GET /series/{s}/markets/{t}/candlesticks` | 1-min/1h/1d candles for chart history | [Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) |
| `GET /markets/trades?ticker=` | official trade prints (true traded dollars) | [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) |
| `GET /series?category=Crypto` / `?tags=Golf` | official topic whitelists | [Series list](https://docs.kalshi.com/api-reference/market/get-series-list) |
| `GET /markets?event_ticker=…&status=settled` | official yes/no resolution (`result` field) | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |

The client serializes all requests (350 ms minimum gap), backs off exponentially on HTTP 429, and shows throttle counters. Kalshi documents that unauthenticated requests have separate, unpublished limits ([rate limits](https://docs.kalshi.com/getting_started/rate_limits)).

## Why REST polling instead of WebSocket

Kalshi's WebSocket requires `KALSHI-ACCESS-*` authentication headers **during the handshake** ([official WS quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)); browsers cannot set custom headers on a WebSocket handshake, and this app deliberately holds no credentials. REST polling (~1 request/2.5 s per watched event) is the honest static-site substitute; this and every other limitation is published on the site's **Flagged for Review** page.

## Simulated trading & fees

Four paper strategies (Momentum Rider, Fade the Spike, Extreme Value, Liquidity Scalper) trade automatically against observed top-of-book. Fees use the official schedule (effective 2026-07-07): taker `fees = round_up(0.07 × C × P × (1−P))`, maker multiplier 0 on quadratic series, settlement $1/contract with no settlement fee — verified against the official fee table's worked examples by unit test ([fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf)). **No order is ever sent to the exchange.**

## Scope & safety

- Public market-data endpoints only; **no credentials are requested, stored, or transmitted**. Connecting a real demo account (mock funds at [demo.kalshi.co](https://demo.kalshi.co/), separate credentials per [official demo docs](https://docs.kalshi.com/getting_started/demo_env)) would require your own API keys and is intentionally not part of this build — flagged, not faked.
- "Highest dollar amount" ranking is an **estimate** (Σ volume × last price; Σ OI × mid) because the API publishes volume in contracts, not official per-event dollar volume. True traded dollars come from official trade prints for the selected market's tape.
- News links on alerts are context searches labeled **unverified** — causation is never asserted.
- If the browser/network blocks the API, pages render the verified snapshot and show a banner with a manual CORS check command:

```bash
curl -sS -X OPTIONS "https://external-api.demo.kalshi.co/trade-api/v2/markets" \
  -H "Origin: <this-site>" -H "Access-Control-Request-Method: GET" \
  -D - -o /dev/null | grep -i access-control
```

## Sources

All official: [docs.kalshi.com](https://docs.kalshi.com/) (demo environment, market data, orderbook, candlesticks, trades, series list, rate limits, settlement), [official fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf), and live responses from `https://external-api.demo.kalshi.co/trade-api/v2` captured on 2026-11-20 (each value's request URL is recorded in the snapshot and verification log).

Educational tool — not financial advice. Demo markets use mock funds and need not match real-market behavior (per Kalshi's official documentation).
