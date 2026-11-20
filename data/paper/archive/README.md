# Archived simulated ledgers

## `ledger-2026-11-20-pre-arbitrage-fix.json`

Kept, not deleted, because it is the evidence for a bug this project found and fixed.

The first live pipeline runs (13:17Z and 13:33Z on 2026-11-20) executed a complement "arbitrage"
strategy whose direction was inverted. Buying YES and NO together costs `2 - (YES bid + NO bid)` and
pays exactly $1 at settlement, so the locked edge is `YES bid + NO bid - 1`: it exists when the two
bids SUM ABOVE 1.00. The original code required the sum to be BELOW 1.00 and therefore bought
guaranteed-loss pairs; it also allowed buying NO at $1.00, where the upside is zero.

The ledger records 26 closed arbitrage trades for **-$449.84** realized, plus fee drag, before the fix.
That is the correct, reproducible output of the buggy rule — the numbers are real results of the code as
it ran, and rewriting them would be the kind of retroactive fudging this repo is meant to avoid.

The corrected rule (`collector/strategies.py`, `ComplementArbStrategy`) requires
`YES bid + NO bid >= 1 + min_edge` and both legs priced inside $0.02-$0.98, with regression tests in
`tests/test_verification.py`. The live ledger was reset after the fix so the Portfolio page reflects the
corrected engine only. This archive file is the audit trail.
