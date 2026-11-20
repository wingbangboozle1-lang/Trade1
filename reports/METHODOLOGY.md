# Methodology

Task T3/T5 · Session `a2ec5543` · 2026-11-20 (UTC). Code: `scripts/build_site.py`, `scripts/backtest.py`, `scripts/render_site.py`, `scripts/check_site.py`, `scripts/kalshi_api.py`, `config/topics.json`.

## 1. Data flow

1. **Read** (in GitHub Actions, `.github/workflows/site.yml`): `GET /exchange/status`, `GET /series` (all series, cursor-paginated), `GET /markets?status=open&mve_filter=exclude` (all pages), `GET /markets?status=settled&mve_filter=exclude&min_settled_ts=<now−30d>` (capped at 200,000 rows), orderbooks and candlesticks for the top 40 markets. Every read is public and unauthenticated. Source: [API environments](https://docs.kalshi.com/getting_started/api_environments), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets).
2. **Classify** each market by its series. A series is assigned to a topic by `config/topics.json` (the first matching rule wins):
   - Gas prices: series ticker matches `^(KX)?AAAGAS`. Excludes natural gas (`KXNATGASD`, `KXNGASMIN`) and EIA inventories (`KXEIAGASINVM`).
   - Golf: series tag `Golf`.
   - Crypto: series category `Crypto`.
   - Culture: series category `Entertainment` or `Culture`.
   - Elections: series category `Elections`.
   The rules use only the official series metadata (ticker, category, tags).
3. **Rank** markets within each topic by **estimated dollar volume** = `volume_24h_fp` (contracts) × last traded YES price. This is a **derived estimate**: the API has no 24-hour dollar-volume field ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)). Only the top 300 per topic are written to the snapshot. The counts of all open markets per topic are kept.
4. **Detail**: the top 40 markets by estimated dollars get an orderbook summary (`/markets/{t}/orderbook`) and 60-minute candlesticks (`/series/{s}/markets/{t}/candlesticks`).
5. **Moves**: a "sharp move" is a change of at least **$0.10** between two consecutive candle closes of the same market (either direction). Each move row links to the market's official API record and its contract-terms PDF. **No cause is attributed.** The cause field reads "NOT VERIFIED", because the API gives no official news attribution.
6. **Resolved**: settled markets in the last 30 days, sorted by settlement time (newest first). Outcome = the official `result` field, shown as **YES** or **NO**. Any other result is shown as-is and flagged.
7. **Backtest** (`scripts/backtest.py`): see section 3.
8. **Publish**: the built site is written to `_site/`, checked by `check_site.py` (internal links, JSON parse, required files), and on `main` committed to `monitor/`.

## 2. Verification rules

- Every row has a `source_api` link (official API record) and, where a contract-terms URL exists, a `source_terms` link.
- A value that is not in the official response is left blank and marked unverified. Nothing is inferred.
- Fields are only read where the official schema names them (see [API_VERIFICATION.md](API_VERIFICATION.md)).
- Anything the build could not confirm goes to the flags list and the Flagged for Review page.

## 3. Simulated strategies (paper only)

These are rule-based strategies replayed over settled-market candles. **They are not trades on the Kalshi account.** Each simulated trade is one contract, with no fees, no slippage beyond the quoted candle price, and no position sizing. Kalshi fees are not modelled.

| ID | Rule | Exit |
|---|---|---|
| S0 | Buy YES at the first quoted ask (baseline) | Settlement |
| S1 | Buy YES when the last price first closes ≤ $0.10 | Settlement |
| S2 | Buy NO when the last price first closes ≥ $0.90 (NO entry = 1 − YES bid) | Settlement |
| S3 | After a candle-to-candle rise ≥ $0.10, buy YES | Next candle's YES bid |
| S4 | After a candle-to-candle fall ≥ $0.10, buy YES | Next candle's YES bid |

Results are grouped by strategy, topic, and price band (`<$0.10`, `$0.10–$0.49`, `$0.50–$0.89`, `≥$0.90`). A group with fewer than 30 trades is marked "insufficient sample".

**Current result (CI run `44746820363`):** 250 settled markets were considered, 250 had candle responses, and **6 trades** were produced. Every strategy and band group is below the 30-trade threshold, so no conclusion is drawn. Why only 6 of 250 markets produced a trade is **not explained yet**; see FLAGGED_FOR_REVIEW (F7).

Trade categorisation: every simulated trade is labelled with its strategy, topic, and price band, and carries `source_api` and `source_terms`.

## 4. Limits of this method

- Demo environment only. Demo prices may not reflect production.
- The top-N cap means most markets are counted but not shown.
- The settled fetch is capped at 200,000 rows and is flagged when the cap is reached.
- Candles are 60-minute. Sharp moves within an hour are not seen.
- No news or cause attribution.
- No authenticated (demo account) reads or trades. Demo API credentials were not provided.
