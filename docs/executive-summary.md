# Executive Summary — Kalshi Demo Dashboard

## Goal
Build a live, interactive dashboard over the **Kalshi demo Trade API** that collects, organizes, and
analyzes Kalshi prediction-market data, focused on five topics — **gas prices, elections, culture,
crypto, and golf** — tracks events until they resolve, automates simulated trades to test
strategies, and tracks portfolio performance, with an interactive price/liquidity view.

## Official API surface (verified)
- **Recommended demo base (from the task):** `https://external-api.demo.kalshi.co/trade-api/v2`
- **Official demo host (from Kalshi's starter code):** `https://demo-api.kalshi.co/trade-api/v2`
- **WebSocket:** `wss://…/trade-api/ws/v2`, subscription `{"cmd":"subscribe","params":{"channels":["ticker"]}}`
- **Public market data (no auth):** `/series`, `/events`, `/markets`, `/markets/{ticker}`,
  `/markets/{ticker}/orderbook`, `/markets/candlesticks`, `/markets/trades`, `/exchange/status`.
- **Authenticated portfolio/trading:** `/portfolio/balance`, `/portfolio/positions`,
  `/portfolio/orders`, `/portfolio/fills`, `/portfolio/history`, and order create/cancel under
  `/portfolio/events/orders`.
- **Authentication:** the current demo/production API signs requests with **RSA-PSS**. Headers:
  `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP`, where the signature is
  over `timestamp + method + path`. (The older `kalshi` PyPI SDK uses `POST /log_in` → Basic token.)

Sources: [Kalshi/kalshi-starter-code-python](https://github.com/Kalshi/kalshi-starter-code-python),
[kalshi PyPI](https://pypi.org/project/kalshi/),
[mlucy/kalshi_py](https://github.com/mlucy/kalshi_py).

## Key findings
1. **Live data is public and browser-fetchable.** Market data endpoints require no credentials, so
   the dashboard fetches live prices and orderbooks directly from the browser with `fetch`.
2. **Private actions need RSA-PSS signing.** Portfolio balance/positions and order placement are
   signed with a private key via WebCrypto (`RSA-PSS`, salt length = SHA-256 digest length = 32).
   Credentials stay in the browser session and go only to Kalshi.
3. **Resolution tracking.** Settled markets expose a result; the dashboard marks each event
   resolved with a normalized **yes/no**. Paper trades settle against the same result.
4. **Sharp moves.** Any price change ≥ **$0.10** is flagged with a timestamp and a link to the
   official market page, so a trader can correlate jumps with external events/links.
5. **Strategy engine.** Four simulated strategies (momentum, mean-reversion, value, liquidity-first)
   run against live prices, categorize trades by type and topic, and report win-rate and P&L.

## Critical constraint (flagged, not a hallucination)
This build sandbox has outbound access restricted to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org`, and `files.pythonhosted.org`. **All Kalshi hosts
are unreachable from the sandbox** (verified with `curl` → HTTP `000`, TLS reset). Therefore:
- Live market values could not be fetched or confirmed from the build host.
- The dashboard fetches those values **live in the user's browser** directly from the official API.
- Anything unconfirmed is left **blank and flagged** on the site. No market data was invented.

## Deliverables
- `site/` — static, no-build dashboard (landing + 5 topic pages + portfolio + flagged).
- `site/js/kalshi.js` — verified Kalshi demo client (public + RSA-PSS signed).
- `site/js/strategy.js` — simulated strategy engine + trade categorization + performance.
- `docs/` — this summary, the API reference, sources, and line-by-line verification.
- `tools/` — build + link validation used to confirm the site builds with no broken links.
- GitHub Pages deployment via `.github/workflows/pages.yml`.

See [docs/api-reference.md](./api-reference.md), [docs/verification.md](./verification.md), and
[docs/sources.md](./sources.md).
