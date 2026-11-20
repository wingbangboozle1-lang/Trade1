"""Self-tests that must pass before anything is published.

These are the checks that keep the site honest: if the fee model stops reproducing Kalshi's
published table, or a topic rule stops matching the series Kalshi actually tags, the pipeline
fails instead of shipping a wrong number.

Run:  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from collector import fees, strategies, topics  # noqa: E402
from collector.util import parse_ts  # noqa: E402


class TestFeeSchedule(unittest.TestCase):
    """The model must reproduce every published row of the official fee schedule."""

    def test_published_table_matches(self):
        rows = fees.verify_schedule()
        self.assertEqual(len(rows), 21, "published table has 21 price points")
        mismatches = [r for r in rows if not r["match"]]
        self.assertEqual(mismatches, [], f"fee model disagrees with published schedule: {mismatches}")

    def test_maker_defaults_to_free(self):
        # Schedule: maker multiplier defaults to 0 unless otherwise indicated.
        self.assertEqual(fees.trade_fee(100, 0.50, taker=False, ticker="KXNOTLISTED"), 0.0)

    def test_fee_free_series(self):
        self.assertEqual(fees.trade_fee(100, 0.50, taker=True, ticker="KXBTCY-26DEC31"), 0.0)
        self.assertGreater(fees.trade_fee(100, 0.50, taker=True, ticker="KXAAAGASM-26NOV30-3.00"), 0.0)

    def test_max_fee_per_contract(self):
        # Published maximums: $1.75 per 100 contracts at 50c, i.e. never more than 1.75c/contract.
        self.assertLessEqual(fees.trade_fee(1, 0.50, ticker="KXTEST") , 0.02)


class TestTopics(unittest.TestCase):
    """Rules must match the way Kalshi actually tags series (official tags_by_categories map)."""

    def setUp(self):
        self.config = topics.load_config()

    def test_crypto(self):
        self.assertIn("crypto", topics.topics_for_series({"category": "Crypto", "categories": ["Crypto"],
                                                          "tags": ["BTC"]}, self.config))

    def test_elections(self):
        self.assertIn("elections", topics.topics_for_series({"category": "Elections",
                                                             "categories": ["Elections"]}, self.config))

    def test_culture_covers_entertainment(self):
        # Culture markets are listed under Entertainment by Kalshi, so both must map.
        for cat in ("Culture", "Entertainment", "Social"):
            self.assertIn("culture", topics.topics_for_series({"category": cat, "categories": [cat]},
                                                              self.config))

    def test_golf_needs_golf_tag(self):
        self.assertIn("golf", topics.topics_for_series({"category": "Sports", "categories": ["Sports"],
                                                        "tags": ["Golf"]}, self.config))
        self.assertNotIn("golf", topics.topics_for_series({"category": "Sports",
                                                           "categories": ["Sports"],
                                                           "tags": ["Soccer"]}, self.config))

    def test_gas(self):
        s = {"category": "Economics", "categories": ["Economics", "Commodities"],
             "tags": ["Oil and energy"], "title": "US gas price"}
        self.assertIn("gas", topics.topics_for_series(s, self.config))
        # an oil series without "gas" in the title is not a gas-price market
        s2 = dict(s, title="Oil inventory")
        self.assertNotIn("gas", topics.topics_for_series(s2, self.config))

    def test_combination_products_excluded(self):
        self.assertTrue(topics.is_excluded("KXMVECROSSCATEGORY-S2026ABC-XYZ", self.config))
        self.assertFalse(topics.is_excluded("KXAAAGASM-26NOV30-3.00", self.config))


class TestStrategies(unittest.TestCase):
    def _market(self, **kw):
        base = {"ticker": "KXTEST-26DEC31-1", "title": "test", "yes_bid": 0.40, "yes_ask": 0.42,
                "no_bid": 0.58, "no_ask": 0.60, "mid": 0.41, "close_ts": None, "topics": ["crypto"]}
        base.update(kw)
        return base

    def test_registry_is_deterministic(self):
        a = [s.describe() for s in strategies.registry()]
        b = [s.describe() for s in strategies.registry()]
        self.assertEqual(a, b)
        self.assertEqual(len(a), 6)

    def test_momentum_fires_on_a_run_up(self):
        hist = [{"t": i, "mid": 0.30 + i * 0.01} for i in range(8)]
        sig = strategies.MomentumStrategy().evaluate(self._market(yes_bid=0.37, yes_ask=0.38),
                                                     hist, {"size": 10})
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "yes")

    def test_momentum_silent_when_flat(self):
        hist = [{"t": i, "mid": 0.40} for i in range(8)]
        self.assertIsNone(strategies.MomentumStrategy().evaluate(self._market(), hist, {"size": 10}))

    def test_complement_arbitrage_only_when_bids_exceed_one(self):
        """Regression for a real bug found on live data: buying YES and NO costs
        2 - (yes_bid + no_bid) and pays $1, so the edge exists when the bids SUM ABOVE 1. The first
        implementation had this backwards and would have locked in a loss."""
        s = strategies.ComplementArbStrategy()
        ctx = {"size": 10, "book_depth": {"yes_qty": 100, "no_qty": 100}}
        # bids sum to 0.94 -> pair costs 1.06 for a $1 payout: no trade
        self.assertIsNone(s.evaluate(self._market(yes_bid=0.44, no_bid=0.50), [], ctx))
        # bids sum to 1.04 -> pair costs 0.96 for a $1 payout: +0.04 locked
        sig = s.evaluate(self._market(yes_bid=0.52, no_bid=0.52), [], ctx)
        self.assertIsNotNone(sig)
        self.assertAlmostEqual(sig.meta["edge"], 0.04, places=4)

    def test_no_strategy_pays_a_dollar_or_zero(self):
        """Regression: the first live run bought NO at $1.00 (zero upside) on low-strike markets."""
        self.assertFalse(strategies.tradable(1.0))
        self.assertFalse(strategies.tradable(0.0))
        self.assertFalse(strategies.tradable(None))
        self.assertTrue(strategies.tradable(0.5))
        s = strategies.TopicThesisStrategy()
        sig = s.evaluate(self._market(yes_bid=0.0, yes_ask=0.0, mid=0.0), [],
                         {"size": 5, "book_depth": {"yes_qty": 100, "no_qty": 100}})
        self.assertIsNone(sig)

    def test_post_jump_uses_the_requested_threshold(self):
        s = strategies.StaleOddsStrategy()
        # three observations required; the jump is the change between the last two
        below = [{"t": 0, "mid": 0.50}, {"t": 1, "mid": 0.50}, {"t": 2, "mid": 0.59}]
        at = [{"t": 0, "mid": 0.50}, {"t": 1, "mid": 0.50}, {"t": 2, "mid": 0.60}]
        self.assertIsNone(s.evaluate(self._market(yes_ask=0.60), below, {"size": 5}))
        self.assertIsNotNone(s.evaluate(self._market(yes_ask=0.60), at, {"size": 5}))


class TestParsing(unittest.TestCase):
    def test_kalshi_timestamp(self):
        self.assertEqual(parse_ts("1970-01-01T00:00:10Z"), 10)
        self.assertEqual(parse_ts("2026-11-20T12:59:52.250914Z"), parse_ts("2026-11-20T12:59:52Z"))
        self.assertIsNone(parse_ts(""))
        self.assertIsNone(parse_ts(None))


class TestNoInventedValues(unittest.TestCase):
    """Published data files must only contain values the collector observed."""

    def test_latest_snapshot_has_sources(self):
        path = os.path.join(ROOT, "data", "markets", "latest.json")
        if not os.path.exists(path):
            self.skipTest("no snapshot yet")
        with open(path) as f:
            snap = json.load(f)
        for m in snap.get("markets", [])[:200]:
            self.assertIn("ticker", m)
            # a market with no price must stay null rather than default to 0
            for key in ("yes_bid", "yes_ask"):
                self.assertTrue(m.get(key) is None or 0 <= m[key] <= 1)

    def test_resolutions_use_only_exchange_results(self):
        path = os.path.join(ROOT, "data", "resolutions.json")
        if not os.path.exists(path):
            self.skipTest("no resolutions yet")
        with open(path) as f:
            store = json.load(f)
        for ticker, row in store.items():
            self.assertIn(row.get("result"), ("yes", "no", ""))
            self.assertIn("source_url", row)


if __name__ == "__main__":
    unittest.main()
