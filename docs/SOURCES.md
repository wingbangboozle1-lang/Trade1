# Sources — Master List (docs/SOURCES.md)

All sources are official Kalshi (or Kalshi-referenced official settlement bodies). Fetched and read
during this session (2026-11-20) unless marked otherwise.

## Kalshi official documentation
| # | Source | URL | Used for |
|---|---|---|---|
| S1 | Test In The Demo Environment | https://docs.kalshi.com/getting_started/demo_env.md | Demo endpoints, mock funds, demo≠production warning |
| S2 | API Environments and Endpoints | https://docs.kalshi.com/getting_started/api_environments.md | Recommended vs. also-supported hosts; credential separation |
| S3 | Quick Start: Market Data | https://docs.kalshi.com/getting_started/quick_start_market_data.md | No-auth public endpoints; browser fetch examples; orderbook format; kalshi.com/markets URL pattern |
| S4 | Quick Start: Authenticated Requests | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md | API-key signing (RSA-PSS / Ed25519), KALSHI-ACCESS-* headers |
| S5 | API Keys | https://docs.kalshi.com/getting_started/api_keys.md | Key creation/usage |
| S6 | Rate Limits and Tiers | https://docs.kalshi.com/getting_started/rate_limits.md | Token buckets, unauthenticated limits, 429 handling |
| S7 | Get Markets (API reference) | https://docs.kalshi.com/api-reference/market/get-markets.md | status filters, pagination, caching/lag |
| S8 | Get Series List (API reference) | https://docs.kalshi.com/api-reference/market/get-series-list.md | category/tags filters, fee_type/fee_multiplier, settlement_sources |
| S9 | Get Market Orderbook (API reference) | https://docs.kalshi.com/api-reference/market/get-market-orderbook.md | orderbook_fp format, yes/no bid equivalence, depth |
| S10 | Get Market Candlesticks (API reference) | https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md | period_interval {1,60,1440}, 5000-period cap, OHLC dollars |
| S11 | Get Trades (API reference) | https://docs.kalshi.com/api-reference/market/get-trades.md | trade tape fields, limits |
| S12 | Market Settlement | https://docs.kalshi.com/getting_started/market_settlement.md | YES/NO payout mechanics ($1/contract), no settlement fee |
| S13 | Market Lifecycle | https://docs.kalshi.com/getting_started/market_lifecycle.md | status model |
| S14 | Kalshi Fee Schedule (PDF, effective July 7, 2026) | https://kalshi.com/docs/kalshi-fee-schedule.pdf | taker/maker fee formulas, general fee table |
| S15 | Quick Start: Create your first order | https://docs.kalshi.com/getting_started/quick_start_create_order.md | order placement flow (dormant demo connector) |
| S16 | Understanding Pagination | https://docs.kalshi.com/getting_started/pagination.md | cursor semantics (empty cursor = last page) |

## Kalshi demo API (official host — live responses fetched this session)
| # | Probe | URL |
|---|---|---|
| P1 | Open events sample | https://external-api.demo.kalshi.co/trade-api/v2/events?limit=5&status=open |
| P2 | Markets (open, KXBTC) | https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXBTC&status=open&limit=2 |
| P3 | Markets (settled, KXBTC) — `result:"no"`, `status:"finalized"` | https://external-api.demo.kalshi.co/trade-api/v2/markets?series_ticker=KXBTC&status=settled&limit=1 |
| P4 | Series KXGAS | https://external-api.demo.kalshi.co/trade-api/v2/series/KXGAS |
| P5 | Series KXETH | https://external-api.demo.kalshi.co/trade-api/v2/series/KXETH |
| P6 | Series KXTIME | https://external-api.demo.kalshi.co/trade-api/v2/series/KXTIME |
| P7 | Series KXPGA | https://external-api.demo.kalshi.co/trade-api/v2/series/KXPGA |
| P8 | Series KXMASTERS | https://external-api.demo.kalshi.co/trade-api/v2/series/KXMASTERS |
| P9 | Exchange status | https://external-api.demo.kalshi.co/trade-api/v2/exchange-status |

## Kalshi public site (contract rules / UI pages)
| # | Source | URL |
|---|---|---|
| W1 | Kalshi site root | https://kalshi.com/ |
| W2 | Kalshi demo environment (login) | https://demo.kalshi.co/ |
| W3 | Series page URL pattern (official example: KXHIGHNY) | https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc |

## Official settlement sources (as returned by the demo API itself)
- U.S. Energy Information Administration (gas): https://www.eia.gov/dnav/pet/PET_PRI_GND_DCUS_NUS_W.htm
- CF Benchmarks BRTI / ETHUSD_RTI (crypto): https://www.cfbenchmarks.com/data/indices/ETHUSD_RTI
- TIME (culture): https://time.com/
- ESPN / WSJ / Fox Sports / AP (golf): https://www.espn.com/ , https://www.wsj.com/ , https://www.foxsports.com/ , https://apnews.com/
- NATO (elections example): https://www.nato.int/

## Third-party libraries (vendored, MIT-licensed)
- Chart.js v4.6.1 — https://www.chartjs.org — obtained from the npm registry (`chart.js@4.6.1`, MIT license), bundled at `site/vendor/chart.umd.js`.
