"""Unit tests for scripts/analyze.py using SYNTHETIC fixtures (logic only, no market data)."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import analyze as a


class TopicRules(unittest.TestCase):
    def test_categories(self):
        self.assertEqual(a.topic_for_series({"category": "Crypto"}), "crypto")
        self.assertEqual(a.topic_for_series({"category": "Elections"}), "elections")
        self.assertEqual(a.topic_for_series({"category": "Entertainment"}), "culture")
        self.assertEqual(a.topic_for_series({"category": "Sports", "tags": ["Golf"]}), "golf")
        self.assertEqual(a.topic_for_series({"category": "Commodities", "tags": ["Oil & Gas"]}), "gas")
        self.assertEqual(a.topic_for_series({"category": "Economics", "title": "AAA gas price"}), "gas")
        self.assertIsNone(a.topic_for_series({"category": "Sports", "tags": ["Soccer"]}))
        self.assertIsNone(a.topic_for_series({"category": "Sports", "tags": None}))


class Jumps(unittest.TestCase):
    def test_threshold_and_direction(self):
        rec = {"title": "t", "topic": "crypto", "source_url": "u", "settlement_sources": [],
               "candles": {"60": [[1000, None, None, None, 0.50, None, None],
                                  [4600, None, None, None, 0.60, None, None],   # +0.10 -> jump
                                  [8200, None, None, None, 0.55, None, None]]}} # -0.05 -> no
        js = a.find_jumps({"X": rec}, 0.10)
        self.assertEqual(len(js), 1)
        self.assertEqual(js[0]["direction"], "up")
        self.assertEqual(js[0]["delta"], 0.10)
        self.assertEqual(js[0]["cause_status"].split(" ")[0], "unverified")


class Backtest(unittest.TestCase):
    def test_baseline_and_momentum_settle(self):
        closes = [0.30] * 6 + [0.45]  # move +0.15 over 6 candles at index 6
        rows = [[1000 + 3600 * i, None, None, None, c, None, None] for i, c in enumerate(closes)]
        tracked = {"Y": {"resolved": True, "result": "yes", "topic": "golf", "source_url": "u",
                         "candles": {"60": rows}}}
        bt = a.backtest(tracked, {"Y": {}})
        by = {s["strategy"]: s for s in bt["strategies"]}
        self.assertEqual(by["baseline_buy_yes"]["trades"], 1)
        self.assertAlmostEqual(by["baseline_buy_yes"]["total_pnl_per_contract"], 0.70, places=4)
        self.assertEqual(by["momentum_buy_yes"]["trades"], 1)
        self.assertAlmostEqual(by["momentum_buy_yes"]["total_pnl_per_contract"], 0.55, places=4)
        self.assertEqual(by["fade_spike_buy_no"]["trades"], 1)
        self.assertAlmostEqual(by["fade_spike_buy_no"]["total_pnl_per_contract"], -0.55, places=4)

    def test_no_resolved_is_empty_not_invented(self):
        bt = a.backtest({"Z": {"resolved": False, "candles": {"60": []}}}, {})
        self.assertTrue(all(s["trades"] == 0 and s["avg_pnl_per_contract"] is None for s in bt["strategies"]))


class Verify(unittest.TestCase):
    def test_identity_and_generic_source_flag(self):
        tracked = {"A": {"yes_bid": 0.14, "no_ask": 0.86, "title": "a", "source_url": "u",
                         "settlement_sources": [{"name": "The Guardian", "url": "https://kalshi.com/"}]},
                   "B": {"yes_bid": 0.14, "no_ask": 0.50, "title": "b", "source_url": "u",
                         "settlement_sources": [], "close_time": "2099-01-01T00:00:00Z"}}
        v = a.verification_checks(tracked, {}, [])
        ident = [c for c in v["checks"] if c["id"] == "binary_identity"][0]
        self.assertEqual((ident["pass"], ident["fail"]), (1, 1))
        self.assertTrue(any("kalshi.com" in f["issue"] for f in v["flags"]))
        self.assertTrue(any("2099" in f["issue"] for f in v["flags"]))


class Paper(unittest.TestCase):
    def test_open_then_settle(self):
        rows = [[1000 + 3600 * i, None, None, None, c, None, None] for i, c in enumerate([0.3] * 6 + [0.45])]
        tracked = {"P": {"candles": {"60": rows}, "last_price": 0.45, "status": "active", "title": "p",
                         "topic": "gas", "source_url": "u", "resolved": False}}
        paper = a.update_paper({}, tracked, 10**9)
        self.assertEqual(paper["positions"]["momentum_buy_yes|P"]["status"], "open")
        tracked["P"].update({"resolved": True, "result": "no", "last_price": 0.0})
        paper = a.update_paper(paper, tracked, 10**9)
        pos = paper["positions"]["momentum_buy_yes|P"]
        self.assertEqual(pos["status"], "closed")
        self.assertAlmostEqual(pos["pnl"], -0.45, places=4)


if __name__ == "__main__":
    unittest.main()
