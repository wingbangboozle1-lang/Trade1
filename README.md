# Market Lens · Kalshi demo monitor

A static GitHub Pages dashboard prototype for Kalshi's **demo** market-data API. It focuses on five requested topic filters—gas prices, elections, culture, crypto, and golf—and keeps a source link on each market, alert, orderbook, resolution, and paper-trade row.

## What the site does

- Discovers open demo markets via the public `GET /markets?status=open` endpoint with cursor pagination (up to 20 pages per discovery pass). It refreshes the matching ticker set about every 30 seconds and re-discovers markets about every five minutes.
- Groups matching markets by topic and `event_ticker`. Topic assignment is a title/subtitle/ticker keyword heuristic, not an official Kalshi category, and may include false positives or omit relevant markets.
- Displays API-reported YES bid/ask, best-side sizes, 24-hour contract volume, and raw status. Reported prices/sizes are not replaced with sample values when missing. Event groups are ordered by the highest fresh 24-hour **market contract-volume** reading among their markets; markets are ordered within each event by the same field. This is not an event-level sum or dollar-volume ranking.
- Leaves aggregate dollar notional blank. The market schema contains `notional_value_dollars`, but the reviewed documentation does not establish that field as event-level traded dollar volume for the requested ranking; the dashboard does not infer volume × price.
- Records a price alert when a market's observed `yes_bid_dollars` changes by at least $0.10 between successful snapshots. Two scrolling feeds show all qualifying moves and an experimental liquidity/spread-screen subset. Each alert also links to a title-based Google News search for possible context; no article is verified or attributed as the cause of a move.
- Charts a selected market's YES bid over 30 seconds, 5 minutes, 1 hour, or 6 hours, sampled locally while this page is open. It fetches the selected market's public orderbook and shows a selectable top 5/10/20/50 YES/NO bid depth with the reported contract quantity at each price.
- Automatically records browser-local paper trades by default after a candidate passes the documented-on-page screen. Momentum and mean-reversion strategies are available for comparison. Paper P&L is indicative only: fills, fees, queue position, slippage, and partial fills are not simulated.
- Keeps a local resolution watch for tickers discovered by this browser and displays a result only when the API returns `status: settled` or the review-observed `status: finalized`, together with `result: yes` or `no`. Raw status labels remain visible. Local storage is not a server-side archive.

## Important boundaries

- This project does **not** authenticate to a Kalshi account, retrieve account balances/positions, or place real/demo orders. It never requests or stores API keys or private keys. Kalshi documents signed authentication for private portfolio endpoints; a static browser page is not a safe place for a private signing key.
- The candidate stream is **not** a validated high-ROI model. It checks a $0.10 observed move, YES spread no greater than $0.05, best bid/ask sizes of at least 5 contracts each, binary market type, and default settlement bounds. These are transparent experimental thresholds, not evidence of profitability.
- REST market-data responses can be cached and lag the exchange. WebSocket connections require authentication according to Kalshi's guide; this static site uses best-effort REST polling instead.
- During source review on 2026-11-20, the official demo query using `status=open` returned raw `status: active`; a `status=settled` query returned a record with raw `status: finalized` and a yes/no result. The app displays raw statuses without mapping `active` to `open`; `settled` and observed `finalized` are treated as terminal for result handling only when a yes/no result is present. Both observations are flagged on the [Flagged for Review page](flagged-for-review.html#status-mismatch).
- Browser access from the eventual GitHub Pages origin (including CORS behavior) and successful deployment must be confirmed in the GitHub Actions run after merge. No live market rows are bundled in the repository.

## Run locally

Use an HTTP server so browser JavaScript modules can load:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://localhost:8000`. The app contacts the public demo API from the browser; network access and the API's browser response policy are required.

## Verify

```sh
npm test
```

Tests use Node's built-in test runner and Python's standard library only. They cover topic matching, numeric missing-value handling, the $0.10 threshold in both directions, the candidate screen, orderbook depth ordering, paper P&L, source links, and local HTML links/fragments. No live API response is used as test fixture data.

## Separate published `/trade1/` site

PR #18 added a distinct dashboard under [`trade1/`](https://wingbangboozle1-lang.github.io/Trade1/trade1/), with its own topic pages, public-data collector, checks, and six-hour refresh workflow. It is a separate integrated site, not a dependency of this Market Lens root dashboard. Its sources and limitations are recorded in `COORDINATION.md` and `trade1/flagged/`.

## Separate standalone paper engine

The repository also preserves `scripts/paper_engine.py` from an earlier integration. It is a separate, dependency-free simulation script and is not used by this browser dashboard. Its output is hypothetical only; it does not connect to an account or place orders.

## Deployment

GitHub Pages is currently configured to publish the repository root from `main` (legacy Pages source). The existing workflow keeps that deployment mode, runs the prior repository checks plus `npm test` on pushes and pull requests, and refreshes the repository's separate official-data snapshot on scheduled/manual runs. This dashboard itself reads live public demo data from the browser and does not use that snapshot. The Pages API reported the legacy source as built before this change; verify the post-merge Pages build before considering deployment complete.

## Official references

- [Kalshi API environments and endpoint pairs](https://docs.kalshi.com/getting_started/api_environments)
- [Kalshi public market-data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Kalshi Get Markets API reference](https://docs.kalshi.com/api-reference/market/get-markets)
- [Kalshi Get Market response schema](https://docs.kalshi.com/api-reference/market/get-market)
- [Kalshi orderbook response format](https://docs.kalshi.com/getting_started/orderbook_responses)
- [Kalshi WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Kalshi authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- [Kalshi portfolio Get Positions reference](https://docs.kalshi.com/api-reference/portfolio/get-positions)
- [Kalshi settlement overview](https://docs.kalshi.com/getting_started/market_settlement)
- [Kalshi cursor pagination guide](https://docs.kalshi.com/getting_started/pagination)
- [Flagged for Review](flagged-for-review.html) — verified facts, observed irregularity, and implementation gaps
- [Shared task board and verification log](COORDINATION.md)
