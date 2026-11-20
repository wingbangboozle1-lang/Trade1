"""End-to-end smoke test of the collector with a stub API.

Motivation: a renamed key (`series_count` -> `series_count_relevant`) was not caught by the unit
tests and broke the live pipeline, because every test exercised one module in isolation and none
ran the whole collect() path. This test drives collect() with a fake client so a refactor cannot
break the pipeline silently again.
"""

from __future__ import annotations

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import collector.collect as collect  # noqa: E402


class FakeClient:
    def exchange_status(self):
        return {"trading_active": True, "exchange_active": True}

    def series_list(self, category=None, max_pages=8):
        if category in ("Crypto", "Sports"):
            tags = ["Golf"] if category == "Sports" else ["BTC"]
            return [{"ticker": f"KX{category.upper()}", "category": category,
                     "categories": [category], "tags": tags, "title": "T",
                     "settlement_sources": [], "frequency": "daily"}]
        return []

    def events(self, status=None, max_pages=200):
        return [
            {"event_ticker": "KXCRYPTO-26", "series_ticker": "KXCRYPTO", "title": "Crypto event",
             "category": "Crypto", "strike_date": "2026-12-01"},
            {"event_ticker": "KXSPORTS-26", "series_ticker": "KXSPORTS", "title": "Golf event",
             "category": "Sports", "strike_date": "2026-12-02"},
        ]

    def markets(self, status=None, event_ticker=None, series_ticker=None, max_pages=60, **kw):
        mk = []
        for ev, tk in ((("KXCRYPTO-26"), "KXCRYPTO"), (("KXSPORTS-26"), "KXSPORTS")):
            mk.append({
                "ticker": f"{ev}-Y", "event_ticker": ev, "title": "market", "status": "active",
                "yes_bid_dollars": "0.40", "yes_ask_dollars": "0.42",
                "last_price_dollars": "0.41", "volume_fp": "100",
                "volume_24h_fp": "10", "open_interest_fp": "50",
                "notional_value_dollars": "1.0000", "close_time": "2026-12-01T00:00:00Z",
                "rules_primary": "rules", "rules_secondary": "", "price_ranges": [],
                "yes_sub_title": "yes", "result": "",
            })
        return mk

    def orderbook(self, ticker, depth=10):
        return {"yes": [[0.40, 100]], "no": [[0.58, 80]]}


class TestCollectSmoke(unittest.TestCase):
    def setUp(self):
        self._orig = collect.KalshiClient
        collect.KalshiClient = lambda base: FakeClient()
        self.tmp = os.path.join(ROOT, "data", "markets", "smoke.json")

    def tearDown(self):
        collect.KalshiClient = self._orig
        if os.path.exists(self.tmp):
            os.remove(self.tmp)

    def test_collect_runs_end_to_end(self):
        snap = collect.collect("http://stub", with_depth=True, depth_limit=2)
        self.assertEqual(snap["counts"]["markets"], 2)
        self.assertEqual(snap["counts"]["events"], 2)
        self.assertGreater(snap["counts"]["series"], 0)

    def test_every_row_is_source_linked_and_typed(self):
        snap = collect.collect("http://stub", with_depth=True, depth_limit=2)
        topics_seen = set()
        for m in snap["markets"]:
            topics_seen.update(m["topics"])
            self.assertIn("sources", m)
            self.assertTrue(m["sources"]["market"].startswith("http"))
            self.assertEqual(m["topics"], sorted(set(m["topics"])) if m["topics"] == sorted(m["topics"]) else m["topics"])
            for key in ("yes_bid", "yes_ask", "mid"):
                self.assertTrue(m[key] is None or 0 <= m[key] <= 1)
            self.assertIn("price_label", m)
        self.assertEqual(topics_seen, {"crypto", "golf"})

    def test_orderbook_liquidity_is_computed(self):
        snap = collect.collect("http://stub", with_depth=True, depth_limit=2)
        m = snap["markets"][0]
        book = m["book"]
        # Buying YES lifts the resting NO bid: 80 contracts at (1 - 0.58) = 0.42 -> 33.60
        self.assertAlmostEqual(book["buy_yes_liquidity_usd"], 33.60, places=2)
        # Buying NO lifts the resting YES bid: 100 contracts at (1 - 0.40) = 0.60 -> 60.00
        self.assertAlmostEqual(book["buy_no_liquidity_usd"], 60.00, places=2)
        self.assertAlmostEqual(book["total_liquidity_usd"], 93.60, places=2)
        # the touch is the best resting size on each side
        self.assertAlmostEqual(book["yes_bid_qty_total"], 100.0, places=2)

    def test_event_rollup_sums_market_dollars(self):
        snap = collect.collect("http://stub", with_depth=True, depth_limit=2)
        for e in snap["events"]:
            self.assertGreaterEqual(e["dollar_volume"], 0)
            self.assertIn("site", e)


if __name__ == "__main__":
    unittest.main()
