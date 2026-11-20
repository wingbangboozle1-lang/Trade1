# Kalshi Demo Dashboard

A static GitHub Pages dashboard for observing **live Kalshi demo markets** across five
topics — **gas prices, elections, culture, crypto, golf** — with real-time swing
alerting, price charts, order-book depth, a paper (simulated) strategy-trading lab, and
resolved-event tracking. Every market row links to the official Kalshi market page, and
every reference fact on the [Sources](sources.html) page links to official Kalshi
documentation.

## What it does

- **Live market monitor** — polls the public Kalshi demo REST API (`GET /markets`,
  `GET /markets/{ticker}/orderbook`) with no credentials, filtered to the five topics.
- **$0.10 swing alerts** — sampled YES-bid moves of ≥ $0.10 in either direction are
  written to two scrolling chat feeds: **all events** and a **high-ROI** selective feed
  (heuristic potential-return screen).
- **Price charts** — per-market YES price vs. time, with selectable windows
  (seconds → hours) on the X axis and the contract price on the Y axis.
- **Order-book depth** — contracts available at each bid price (bids only; the implied
  YES ask is derived as `1 − best NO bid`, flagged).
- **Paper trading lab** — auto-places simulated trades (momentum, mean-reversion,
  value), settles them against the official `result` / `settlement_value_dollars`
  fields, and reports performance by strategy.
- **Resolved events** — tracks markets until they settle and records the YES/NO outcome
  from the official `result` field.

## Safety and scope

- **Public market data only.** No account authentication, API keys, or real orders.
  The demo REST endpoints used here require no key and are browser-readable.
- **Paper trades are hypothetical** and stored in the browser (localStorage). No fills,
  fees, settlement, or P&L are sent to or validated by Kalshi.
- **WebSocket streaming is not used** — the handshake requires authentication, so the
  site uses public REST polling (~20s).
- **Topic matching is a keyword heuristic** (word-boundary) on title/subtitle/ticker text;
  it is not an official category call and can miss or mis-bucket markets.
- **Derived values are flagged**: "Est $ vol" = `volume_fp × notional_value_dollars` is
  a derived estimate, not an official field. The default ranking uses the official
  `volume_fp`.
- Live values are fetched at runtime; if the endpoint is unreachable, rows are left blank
  (never guessed) and the status indicator turns red.
- See the [Flagged for Review](flagged.html) page and [COORDINATION.md](COORDINATION.md).

## Pages

| Page | Purpose |
|---|---|
| [index.html](index.html) | Landing, executive summary, live overview, alert preview, suggestions |
| [pages/gas.html](pages/gas.html) | Gas prices dashboard |
| [pages/elections.html](pages/elections.html) | Elections dashboard |
| [pages/culture.html](pages/culture.html) | Culture dashboard |
| [pages/crypto.html](pages/crypto.html) | Crypto dashboard |
| [pages/golf.html](pages/golf.html) | Golf dashboard |
| [alerts.html](alerts.html) | Both live scrolling alert chats |
| [trading.html](trading.html) | Paper trades, portfolio, strategies, resolved events |
| [flagged.html](flagged.html) | Irregularities & unverified items |
| [sources.html](sources.html) | Verified reference tables with official source links |

## Run locally

Open `index.html` in a modern browser with network access. GitHub Pages deployment is
configured in `.github/workflows/pages.yml` (deploys on push to `main`; repository Pages
must use GitHub Actions).

## Standalone paper-trade engine

`scripts/paper_engine.py` mirrors the browser strategy engine as a runnable script
(stdlib only, no dependencies):

```bash
python3 scripts/paper_engine.py --once     # one pass
python3 scripts/paper_engine.py --loop --interval 20
```

## Official references

- [Kalshi demo environment](https://docs.kalshi.com/getting_started/demo_env)
- [API environments and endpoints](https://docs.kalshi.com/getting_started/api_environments)
- [Market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Create your first order](https://docs.kalshi.com/getting_started/quick_start_create_order)
- [Authenticated requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book)
- [API changelog](https://docs.kalshi.com/changelog)
