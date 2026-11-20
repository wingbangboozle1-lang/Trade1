# Executive summary

Session `a2ec5543` · 2026-11-20 (UTC) · Branch `arena/a2ec5543-trade1` · PR #4 to `main`.

## What this is

A read-only, category-separated monitor of **Kalshi demo** markets for five topics: gas prices, elections, culture, crypto, and golf. It is built from the official Kalshi Trade API (demo host `external-api.demo.kalshi.co`). Each event is shown with its official source link. Nothing is typed in by hand.

Published page: `https://wingbangboozle1-lang.github.io/Trade1/a2ec5543/` (after the `main` publish; see the deployment record in `COORDINATION.md`).

## What it shows

- **Landing page and five topic pages.** Each topic groups its events together. Topics are kept separate and never mixed.
- **Highest estimated dollar volume first.** The API has no 24-hour dollar-volume field. The site ranks by `volume_24h_fp` (contracts) × last YES price, and labels it as an estimate.
- **Price moves of $0.10 or more.** Each move is flagged between consecutive 60-minute candles, with the market record and contract-terms link. **No cause is attributed**, because the API gives no official news link.
- **Resolved events.** Settled markets from the last 30 days, with the official YES or NO result.
- **Simulated strategies (paper only).** Five rules (S0–S4) replayed over settled-market candles. These are not trades on the Kalshi account.
- **Flagged for Review page.** Every unverified value, data gap, and irregularity, with a source link.

## Verified facts that drive the design

| Fact | Source |
|---|---|
| Demo REST base `https://external-api.demo.kalshi.co/trade-api/v2`; demo WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` | [API environments](https://docs.kalshi.com/getting_started/api_environments) |
| Public reads need no key. WebSocket needs auth even for public channels, so the site polls REST. | [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses.md); [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets.md) |
| A winning contract pays $1.00. YES/NO is the official `result` field. | [Market settlement](https://docs.kalshi.com/getting_started/market_settlement.md) |
| The API has no 24h dollar-volume field; volume is in contracts. | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| Settled markets before 2026-09-21 move to `/historical/*`. | [Historical data](https://docs.kalshi.com/getting_started/historical_data.md) |
| Gas contracts settle on AAA regular-gas averages; settlement $1.00; minimum tick $0.01. | [AAAGAS contract terms](https://assets.kalshi.com/contract_terms/AAAGAS.pdf) |

## Results so far

- **Coverage (CI run `44746820363`, branch build):** about 291,200 open markets (excluding multivariate combos) were read. 16,876 of them could not be mapped to a series and are excluded (Flagged F18). Per topic: gas 713, golf 1,986, crypto 76,495, culture 9,861, elections 35,341. The site writes the top 300 per topic.
- **Sharp moves:** the run found 50 moves of at least $0.10 between consecutive 60-minute candles of the top 40 markets. The list is on the Moves page.
- **Resolved sample:** 1 YES and 299 NO (300 rows shown). Reported as data. No conclusion is drawn.
- **Backtest:** 250 settled markets were considered and 6 simulated trades were produced. **Not enough data to judge any strategy** (every group is below the 30-trade threshold).

## What is not done, and why

- **Demo account tracking and trade execution:** blocked. No demo API key was provided, and none was requested or stored. Simulated trades are labelled paper-only.
- **Live WebSocket feed:** not built. The data snapshot is rebuilt every 6 hours and on each `main` push. It is not a live stream.
- **Empty candles for `KXAAAGASM-26OCT31-4.18`:** cause unknown (see Flagged F6).
- **Developer Agreement (S16):** not read. The PDF viewer did not return text.
- **Two gas contract PDFs** (`AAAGASNEW`, `AAAGASMINMAX`): not opened.
- **Publishing:** Pages is legacy `main /`. The site is committed as `a2ec5543/` (see Flagged F13).

## Irregularities to review

The full list is in [FLAGGED_FOR_REVIEW.md](FLAGGED_FOR_REVIEW.md). Repo findings are in [REPO_REVIEW.md](REPO_REVIEW.md). API checks are in [API_VERIFICATION.md](API_VERIFICATION.md). Methods are in [METHODOLOGY.md](METHODOLOGY.md).
