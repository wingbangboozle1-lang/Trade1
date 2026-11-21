# Resolved-market topic classifier repair — session `d256bfac`

Date: 2026-11-21 UTC. Scope: correct the previously flagged settled-market classification defect without changing any market data or claiming a fresh live verification.

## What was wrong

The collector's settled-market fallback only runs when the corresponding event is absent from the open-events response. It did not apply a topic's `exclude_keywords` and used unbounded substring matching for `title_keywords`. The existing checked snapshot identified two affected labels:

| Market ticker | Snapshot issue | Official market record |
|---|---|---|
| `KXNATGAS15M-26NOV201415-15` | Natural gas must not be classified as gasoline. | [Official demo market record](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV201415-15) |
| `KXROMLNBMGAME-26NOV201200PLOPIT-PLO` | Basketball title contains `Petrolul`; substring matching incorrectly treated `petrol` as the fuel keyword. | [Official demo market record](https://external-api.demo.kalshi.co/trade-api/v2/markets/KXROMLNBMGAME-26NOV201200PLOPIT-PLO) |

The endpoint and market-record structure are documented by Kalshi's [Get Markets API reference](https://docs.kalshi.com/api-reference/market/get-markets). These links identify the official record locations; this session did **not** fetch them live because the execution environment cannot reach Kalshi hosts.

## Changes made

- Added whole-word/phrase keyword matching and centralized topic exclusions in `scripts/collect.py`.
- Applied those rules to both the standard event classification and the settled-market/no-open-event fallback, plus series discovery filtering.
- Added `tests/test_collect.py`, covering the natural-gas exclusion, the `Petrolul` false positive, positive gasoline/gas-price matches, and exclusions in fallback series matching. The test is part of `npm test`.
- Updated the Resolved and Flagged pages to say the **code fix is present but the snapshot refresh is pending**. These entries stay flagged until a scheduled collector run refreshes the official-source snapshot and confirms the affected labels are gone.
- Follow-up observation from the next scheduled workflow: it received HTTP 429 for the settled-markets request and wrote `settled_count_recent: 0` / an empty `data/resolved.json`. See the recorded request and response in [`data/log.md`](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/log.md) and Kalshi's official [Rate Limits documentation](https://docs.kalshi.com/getting_started/rate_limits). An empty result after a 429 is **not** evidence that the misclassified rows were fixed or absent. *(Salvaged from stale PR #67 by session `fa530a2c` at close, 2026-11-21; facts re-verified against `data/log.md` and the official doc.)*

## Verification performed

- Offline regression tests: `python3 tests/test_collect.py` (4 test methods).
- Full suite: `npm test` (includes the new Python regression test).
- Site validation: `npm run check` checks HTML/JS syntax, internal links, source-linked data rows, page navigation, and published external links.
- `python3 -m py_compile scripts/collect.py tests/test_collect.py`.
- No live Kalshi request, snapshot regeneration, demo account request, or order was attempted. Do not interpret the source changes or passing offline tests as a live API verification.

## Remaining review item

The current `data/resolved.json` is unchanged and may retain the historical misclassified rows. The scheduled GitHub Actions collector must run from the integrated branch and its output must be checked against the two official market records above before the flag can be closed. No source record values were modified or inferred in this session.
