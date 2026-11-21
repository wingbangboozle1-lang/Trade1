#!/usr/bin/env python3
"""
Offline regression gate for scripts/collect.py's topic classification.

Runs with no network and no credentials. It pins the two rules that defect D1
(flagged 2026-11-20 as item 9d-1) showed were missing from the settled-market
fallback path of the collector:

  D1-a  `exclude_keywords` must be honoured when a SETTLED market is
        classified without a category. Before the fix, "Natural Gas price up in
        next 15 mins?" was filed under `gas-prices`, whose own rule
        (scripts/topics.json -> gas-prices.exclude_keywords) excludes natural
        gas. Four such rows were published in data/resolved.json.
  D1-b  `title_keywords` must match on word boundaries, so the keyword
        "petrol" cannot match "Petrolul" (the Romanian basketball club).

The same fixtures are the ones that appeared in the published
data/resolved.json snapshot, so a regression here reproduces the published
defect rather than a synthetic one.

Official sources for the underlying API behaviour (read 2026-11-21):
  Get Events   https://docs.kalshi.com/api-reference/events/get-events
  Get Markets  https://docs.kalshi.com/api-reference/market/get-markets
  Market lifecycle https://docs.kalshi.com/getting_started/market_lifecycle

Usage:  python3 scripts/collect_test.py     (exit 0 = pass, 1 = fail)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import collect  # noqa: E402  (import after sys.path setup)

FAILURES = []
CHECKS = 0


def check(name, condition, detail=""):
    global CHECKS
    CHECKS += 1
    if condition:
        print(f"pass {name}")
    else:
        print(f"FAIL {name} {detail}".rstrip())
        FAILURES.append(name)


def main():
    topics = collect.load_topics()
    ids = [t["id"] for t in topics]
    check("topics load", ids == ["gas-prices", "elections", "culture", "crypto", "golf"],
          f"got {ids}")

    # ---- D1-a: natural gas must never be filed under gas-prices -------------
    # These four tickers are published in data/resolved.json with
    # _topic = "gas-prices" (generated 2026-11-21T03:59:57Z).
    natgas = [
        ("KXNATGAS15M-26NOV202300-00", "Natural Gas price up in next 15 mins?", "KXNATGAS15M"),
        ("KXNATGAS15M-26NOV202245-45", "Natural Gas price up in next 15 mins?", "KXNATGAS15M"),
        ("KXNATGAS15M-26NOV202230-30", "Natural Gas price up in next 15 mins?", "KXNATGAS15M"),
        ("KXNATGAS15M-26NOV202215-15", "Natural Gas price up in next 15 mins?", "KXNATGAS15M"),
    ]
    for ticker, title, series in natgas:
        tid, why = collect.classify_settled_fallback(title, series, topics)
        check(f"D1-a natural gas excluded from gas-prices ({ticker})",
              tid != "gas-prices", f"got {tid} via {why}")

    # ---- D1-b: "petrol" must not match "Petrolul" --------------------------
    tid, why = collect.classify_settled_fallback(
        "Will Petrolul win?", "KXROMLNBMGAME", topics)
    check("D1-b 'petrol' does not match 'Petrolul'", tid != "gas-prices",
          f"got {tid} via {why}")

    # ---- the fallback must still classify what it is supposed to -----------
    tid, why = collect.classify_settled_fallback(
        "Will average gas price be above $3.50 on November 30?",
        "KXAAAGASM-26NOV30", topics)
    check("fallback still files AAA gasoline markets under gas-prices",
          tid == "gas-prices", f"got {tid} via {why}")

    tid, why = collect.classify_settled_fallback(
        "Will Bitcoin be above $100,000 on December 31?", "KXBTCY-26DEC31", topics)
    check("fallback still files crypto series under crypto",
          tid == "crypto", f"got {tid} via {why}")

    tid, why = collect.classify_settled_fallback(
        "Will Scottie Scheffler win the 2026 Masters?", "KXPGATOUR-26MASTERS", topics)
    check("fallback still files golf series under golf",
          tid == "golf", f"got {tid} via {why}")

    # ---- word-boundary helper behaviour ------------------------------------
    kb = collect.keyword_regex("gasoline|gas price|gas prices|average gas|fuel price|petrol")
    check("keyword_regex matches a whole word", bool(kb.search("average gas price")))
    check("keyword_regex does not match inside a word", not kb.search("Petrolul"))
    check("keyword_regex matches the trailing-dot case", bool(kb.search("Gas price.")))
    check("keyword_regex handles an empty pattern",
          collect.keyword_regex("") is None and collect.keyword_regex(None) is None)

    # ---- the main classify() path must stay unchanged ----------------------
    tid, why = collect.classify(
        {"title": "Natural Gas price up in next 15 mins?", "sub_title": "",
         "series_ticker": "KXNATGAS15M", "category": "Economics"}, topics)
    check("classify() still excludes natural gas from gas-prices",
          tid != "gas-prices", f"got {tid} via {why}")

    tid, why = collect.classify(
        {"title": "Will X win?", "sub_title": "", "series_ticker": "KXPGATOUR-26X",
         "category": "Sports"}, topics)
    check("classify() still files golf series under golf",
          tid == "golf", f"got {tid} via {why}")

    # ---- every in-scope topic keeps an exclude rule it can evaluate -------
    for t in topics:
        if t["id"] == "gas-prices":
            check("gas-prices carries exclude_keywords",
                  bool(t.get("exclude_keywords")),
                  "scripts/topics.json lost gas-prices.exclude_keywords")

    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed")
    if FAILURES:
        print("failed: " + ", ".join(FAILURES))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
