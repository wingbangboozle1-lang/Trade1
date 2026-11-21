#!/usr/bin/env python3
"""Regression tests for the collector's topic classification
(scripts/collect.py) and its browser mirror (assets/model.js, checked by
tests/collector.test.mjs).

Run: python3 tests/test_collect.py

WHY THIS EXISTS — flagged item 9d-1 (open defect, verified against the
official demo API):
  * KXNATGAS15M-26NOV201415-15 — "Natural Gas price up in next 15 mins?"
    (https://external-api.demo.kalshi.co/trade-api/v2/markets/KXNATGAS15M-26NOV201415-15).
    NATURAL gas, which the gas-prices topic explicitly excludes
    ("natural gas|natgas|propane|heating oil"). It was labelled gas-prices
    because the settled-market fallback re-applied the topic's title keywords
    while SKIPPING the topic's own exclusion rules, and "Natural Gas price"
    contains the substring "gas price".
  * KXROMLNBMGAME-26NOV201200PLOPIT-PLO — "CSM BBA Petrolul Ploiesti wins"
    (https://external-api.demo.kalshi.co/trade-api/v2/markets/KXROMLNBMGAME-26NOV201200PLOPIT-PLO).
    A Romanian basketball match; it matched the gas keyword "petrol" inside
    "Petrolul" because the keyword was matched as a raw substring.

The fix: the fallback now applies the topic's exclusion rules and matches
title keywords on word boundaries. These tests lock that behaviour in and
also prove the fix does NOT change the classification of any event that is
already in the committed, officially sourced snapshot (data/topics/*.json,
data/resolved.json).

Nothing here is inferred: every title used is verbatim from the official
demo API response, and the regression corpus is the committed snapshot that
scripts/collect.py wrote from those responses (see data/log.md).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import collect  # noqa: E402

TOPICS = collect.load_topics()

passed = 0
failed = 0


def eq(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + " - got " + repr(got) + ", want " + repr(want))


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return json.load(f)


print("1. Official demo records must classify as expected (shared corpus, "
      "tests/fixtures/topic_cases.json):")
CASES = load("tests/fixtures/topic_cases.json")["cases"]
for c in CASES:
    tid, why = collect.classify(
        {"title": c["title"], "sub_title": c["sub_title"],
         "series_ticker": c["series_ticker"], "category": c["category"]},
        TOPICS)
    eq("%s -> %s" % (c["id"], c["expect_topic"]), tid, c["expect_topic"])

print("2. Settled markets that must NOT be labelled gas-prices (flagged 9d-1):")

NAT_GAS = {
    "ticker": "KXNATGAS15M-26NOV201415-15",
    "event_ticker": "KXNATGAS15M-26NOV201415",
    "title": "Natural Gas price up in next 15 mins?",
}
PETROLUL = {
    "ticker": "KXROMLNBMGAME-26NOV201200PLOPIT-PLO",
    "event_ticker": "KXROMLNBMGAME-26NOV201200PLOPIT",
    "title": "CSM BBA Petrolul Ploiesti wins",
}
# The official records also carry these strings; they are part of the title
# that the collector concatenates (market title + event title).
NAT_GAS_EVENT_TITLE = "Natural Gas price up in next 15 mins?"
PETROLUL_EVENT_TITLE = "CSM BBA Petrolul Ploiesti wins"

tid, why = collect.classify_settled(NAT_GAS, None, TOPICS)
eq("natural gas market is out of scope (no event object)", tid, None)
eq("natural gas market match reason", why, None)

tid, why = collect.classify_settled(PETROLUL, None, TOPICS)
eq("'Petrolul' basketball market is out of scope", tid, None)
eq("'Petrolul' basketball market match reason", why, None)

# ... and the same two markets when their event IS known (event in the open
# list): the exclusion rules must still win.
tid, why = collect.classify_settled(
    NAT_GAS, {"title": NAT_GAS_EVENT_TITLE, "series_ticker": "KXNATGAS15M",
              "category": "Economics"}, TOPICS)
eq("natural gas with a known event is out of scope", tid, None)

tid, why = collect.classify_settled(
    PETROLUL, {"title": PETROLUL_EVENT_TITLE, "series_ticker": "KXROMLNBMW",
               "category": "Sports"}, TOPICS)
eq("'Petrolul' with a known event is out of scope", tid, None)

print("3. Positive controls - real gasoline markets must still be gas-prices:")

GAS_EVENTS = [
    # (title, sub_title, series_ticker, category) - verbatim from the
    # committed official snapshot data/topics/gas-prices.json
    ("Gas prices in the US in Nov 2026?", "On Nov 30, 2026", "KXAAAGASM", "Economics"),
    ("US gas prices this week", "Nov 23 - Nov 29, 2026", "KXAAAGASW", "Economics"),
    ("How low will gas prices in Texas get this year?", "2026", "KXAAAGASMINTX", "Economics"),
    ("US gas prices tomorrow", "Nov 22, 2026", "KXAAAGASD", "Economics"),
    ("New Jersey gas prices this week", "Nov 23 - Nov 29, 2026", "KXAAAGASWNJ", "Economics"),
]
for title, sub, series, cat in GAS_EVENTS:
    tid, why = collect.classify(
        {"title": title, "sub_title": sub, "series_ticker": series, "category": cat},
        TOPICS)
    eq("gas event classified: " + title[:44], tid, "gas-prices")

# A gasoline market whose event is not in the open list still resolves by the
# title keyword, with the topic's exclusion rules applied.
tid, why = collect.classify_settled(
    {"ticker": "KXAAAGASM-26NOV30-3.90", "event_ticker": "KXAAAGASM-26NOV30",
     "title": "Will average gas price be above $3.90?"}, None, TOPICS)
eq("settled gasoline market resolves by title keyword", tid, "gas-prices")
# 'series-prefix' wins over the title keyword: KXAAAGASM matches the gas
# topic's series_prefix ^(KX)?(AAA)?GAS.
eq("settled gasoline market match reason", why, "series-prefix")

print("4. Other topics are unaffected:")
eq("elections event", collect.classify(
    {"title": "Who will be the Democratic nominee in 2028?", "sub_title": "",
     "series_ticker": "KXPRESNOMD", "category": "Elections"}, TOPICS)[0], "elections")
eq("crypto event", collect.classify(
    {"title": "Bitcoin price at the end of 2026", "sub_title": "",
     "series_ticker": "KXBTCY", "category": "Crypto"}, TOPICS)[0], "crypto")
eq("golf event", collect.classify(
    {"title": "The RSM Classic Winner", "sub_title": "2026 The RSM Classic",
     "series_ticker": "KXPGATOUR", "category": "Sports"}, TOPICS)[0], "golf")
eq("culture event", collect.classify(
    {"title": "Oscar for Best Picture?", "sub_title": "",
     "series_ticker": "KXOSCARPIC", "category": "Entertainment"}, TOPICS)[0], "culture")
eq("politics golf market is excluded from golf (PR #20 finding)",
   collect.classify({"title": "Will Donald Trump play golf at his own course?",
                     "sub_title": "", "series_ticker": "KXPGATOUR",
                     "category": "Politics"}, TOPICS)[0], None)

print("5. Regression: every event in the committed official snapshot that was "
      "classified by classify() keeps its topic:")
# Events whose _match_reason is 'series-discovery' were NOT classified by
# classify(): they came from the GET /series?category= listing, which groups
# by the official SERIES category (a series can carry events whose own
# category differs - e.g. KXDSENATESEATS series category 'Elections', event
# category 'Politics'). That path is exercised live by the collector, not by
# classify(), so it is excluded from this comparison.
changed = []
total = 0
for topic_id in ("gas-prices", "elections", "culture", "crypto", "golf"):
    data = load("data/topics/%s.json" % topic_id)
    for ev in data.get("events", []):
        if ev.get("_match_reason") not in ("category", "series-prefix"):
            continue
        total += 1
        tid, _ = collect.classify(ev, TOPICS)
        if tid != topic_id:
            changed.append((topic_id, ev.get("event_ticker"), ev.get("title"), tid))
eq("open-event snapshot rows re-classified unchanged (%d events)" % total,
   changed, [])

print("6. Regression: the committed resolved rows keep their topic, except the "
      "known-bad natural-gas rows:")
resolved = load("data/resolved.json")
kept, dropped = [], []
for row in resolved.get("markets", []):
    tid, _ = collect.classify_settled(row, None, TOPICS)
    if tid == row.get("_topic"):
        kept.append(row["ticker"])
    else:
        dropped.append((row["ticker"], row.get("_topic"), tid))
eq("resolved rows that change topic are exactly the natural-gas rows",
   sorted(d[0] for d in dropped),
   sorted(r["ticker"] for r in resolved["markets"]
          if "natural gas" in (r.get("title") or "").lower()))
eq("every changed row is now out of scope",
   sorted(set(d[2] for d in dropped)), [None])
eq("resolved rows that keep their topic",
   len(kept), len(resolved["markets"]) - len(dropped))
eq("no other resolved row changed topic",
   [d[0] for d in dropped if "natural gas" not in
    next((r.get("title") or "" for r in resolved["markets"] if r["ticker"] == d[0]), "").lower()],
   [])

print("")
print("%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
