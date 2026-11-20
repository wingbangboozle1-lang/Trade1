# Trade1 — Kalshi Demo Trading Dashboard

Live, interactive dashboard for the **Kalshi demo exchange** (`https://external-api.demo.kalshi.co/trade-api/v2`)
that tracks the **highest dollar-value live events** in five topics only — **gas prices, elections, culture,
crypto, golf** — follows each event until it resolves **YES or NO**, charts price movement over
**seconds / minutes / hours**, shows **liquidity and contracts available at each price level**, flags
**≥ $0.10 price jumps** with source links, and runs **automated simulated trades** (paper strategies with
Kalshi's official fee formula) with full **portfolio performance tracking** by strategy and topic.

## Live site

Deployed to **GitHub Pages** on every push to `main` (workflow: `.github/workflows/deploy-pages.yml`).

## Pages

| Page | What it does |
|---|---|
| `index.html` | Landing page: cross-topic highest-dollar ranking, executive summary, live ≥ $0.10 jump feed |
| `topics/gas-prices.html` | Gas price events (KXGAS; settles on U.S. EIA data) |
| `topics/elections.html` | Elections-category events on demo |
| `topics/culture.html` | Culture/entertainment events (KXTIME and more) |
| `topics/crypto.html` | Bitcoin/Ethereum price ranges (KXBTC, KXETH; settle on CF Benchmarks indices) |
| `topics/golf.html` | Golf events (KXPGA, KXMASTERS — official "Golf" tag) |
| `strategies.html` | Paper strategy engine (Momentum / Mean-Reversion / Book-Imbalance), portfolio performance, P&L by strategy & topic, trade log, optional read-only demo-account connector |
| `flagged.html` | Flagged for Review — irregularities & unverified items, with links |
| `suggestions.html` | Ranked suggestions for making the site more live/interactive |
| `verification.html` | Verification methodology: official sources read + live API probes |

## How it works

- **100% static site** (no backend). The browser fetches Kalshi's public, unauthenticated demo REST endpoints
  directly (markets, events, series, orderbooks, trades, candlesticks — no API key needed per official docs).
- **Rate-limit aware** (staggered polls, 429 exponential backoff) and **honest by design** (blank cells +
  flags instead of invented values; every row links its exact API source).
- Paper portfolio + watchlist + jump history persist in `localStorage` and export to CSV/JSON.
- Vendored Chart.js v4.6.1 (MIT, from the npm registry) — no CDN dependency.

## Docs

- `docs/EXECUTIVE_SUMMARY.md` — executive summary
- `docs/API_NOTES.md` — endpoint-by-endpoint verified reference
- `docs/SOURCES.md` — master source list
- `docs/FLAGGED.md` — flagged irregularities/unverified items
- `COORDINATION.md` — shared task board for parallel agent sessions

## Development

```bash
python3 -m http.server 8080 --directory site
# open http://localhost:8080
```
All market data comes client-side from the official demo API; nothing else leaves the browser.
