"""Offline tests for the collector's request discipline and publish gate.

Why these exist: on 2026-11-21T06:58Z a scheduled snapshot run fired ~60 requests in
two seconds, was rate-limited (`429 too_many_requests`) on every `/markets` call, and
still WROTE the resulting empty files to `data/`, which CI committed and Pages
published - the live tables went blank. The official rate-limit page says to
"back off on 429" (https://docs.kalshi.com/getting_started/rate_limits), and the run
must not publish an incomplete snapshot. Both are covered here, offline, with no
network: `python3 tests/test_collect_hardening.py`.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scripts.collect as collect  # noqa: E402


class FakeClock:
    """Replace the module clock+sleep so back-off and throttling are observable."""

    def __init__(self):
        self.now = 1_000.0
        self.slept = []

    def sleep(self, secs):
        self.slept.append(secs)
        self.now += secs

    def time(self):
        return self.now


class RetryTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self._time = collect.time
        self._attempts, self._base = collect.MAX_ATTEMPTS, collect.BACKOFF_BASE_S
        collect.time = self.clock            # type: ignore[assignment]
        collect.STATS.update({"requests": 0, "retried": 0, "throttled_429": 0, "failed": 0})
        self._real = collect._get_once

    def tearDown(self):
        collect.time = self._time            # type: ignore[assignment]
        collect._get_once = self._real
        collect.MAX_ATTEMPTS, collect.BACKOFF_BASE_S = self._attempts, self._base
        collect.LOG.clear()

    def _stub(self, codes):
        calls = {"n": 0}

        def fake(url, origin=None, method="GET", timeout=45):
            i = min(calls["n"], len(codes) - 1)
            calls["n"] += 1
            code, hs = codes[i]
            return code, hs, json.dumps({"ok": True}).encode(), 0.0

        collect._get_once = fake
        return calls

    def test_throttles_consecutive_requests(self):
        collect._last_request_at[0] = self.clock.now
        collect._throttle()                       # first request: no wait owed yet
        collect._throttle()                       # second one owes MIN_GAP_S
        self.assertTrue(any(s >= collect.MIN_GAP_S for s in self.clock.slept),
                        f"no spacing between requests: slept {self.clock.slept}")

    def test_backs_off_on_429_and_recovers(self):
        calls = self._stub([(429, {}), (429, {}), (200, {})])
        code, _hs, body, _dt = collect.get("https://x/1")
        self.assertEqual(code, 200)
        self.assertEqual(calls["n"], 3, "expected two retries then success")
        self.assertEqual(self.clock.slept[0], collect.BACKOFF_BASE_S)
        self.assertEqual(self.clock.slept[1], collect.BACKOFF_BASE_S * 2)
        self.assertEqual(collect.STATS["retried"], 2)

    def test_honours_retry_after(self):
        calls = self._stub([(429, {"retry-after": "7"}), (200, {})])
        code, _hs, _b, _dt = collect.get("https://x/1")
        self.assertEqual(code, 200)
        self.assertIn(7.0, self.clock.slept, self.clock.slept)

    def test_gives_up_after_max_attempts_and_counts_the_failure(self):
        calls = self._stub([(429, {})] * 9)
        code, _hs, _b, _dt = collect.get("https://x/1")
        self.assertEqual(code, 429)
        self.assertEqual(calls["n"], collect.MAX_ATTEMPTS)
        self.assertEqual(collect.STATS["failed"], 1)
        self.assertEqual(collect.STATS["throttled_429"], collect.MAX_ATTEMPTS)

    def test_backoff_is_capped(self):
        self._stub([(500, {})] * 9)
        collect.MAX_ATTEMPTS, collect.BACKOFF_BASE_S = 8, 16.0
        try:
            collect.get("https://x/1")
        finally:
            collect.MAX_ATTEMPTS = self._attempts
            collect.BACKOFF_BASE_S = self._base
        self.assertTrue(all(s <= collect.BACKOFF_MAX_S for s in self.clock.slept),
                        self.clock.slept)


class GuardTest(unittest.TestCase):
    def test_zero_counts_are_refused(self):
        healthy = {"events": 2200, "markets": 6000, "settled": 6000,
                   "topic_events": 120, "resolved_rows": 200, "failed": 0}
        self.assertEqual(collect.snapshot_guard(healthy), [])
        for key in ("events", "markets", "settled", "topic_events"):
            bad = dict(healthy)
            bad[key] = 0
            self.assertTrue(collect.snapshot_guard(bad), f"{key}=0 must abort the publish")
        many = dict(healthy)
        many["failed"] = 5
        self.assertTrue(any("429" in r or "rate-limit" in r for r in collect.snapshot_guard(many)),
                        "5 endpoints failing after back-off must abort the publish")

    def test_a_small_nonzero_snapshot_still_publishes(self):
        # A quiet day is not a broken run: only "the API did not answer us" is refused.
        self.assertEqual(collect.snapshot_guard({"events": 3, "markets": 1, "settled": 1,
                                                 "topic_events": 1, "resolved_rows": 0,
                                                 "failed": 1}), [])


class StagingTest(unittest.TestCase):
    """Outputs must land in data/ only when the run is promoted."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="trade1-stage-"))
        self._out, self._stage, self._written = collect.OUT, collect.STAGE, list(collect.WRITTEN)
        collect.OUT = str(self.tmp)
        collect.STAGE = str(self.tmp / ".staging")
        collect.WRITTEN.clear()
        collect.begin_run()

    def tearDown(self):
        collect.OUT, collect.STAGE, collect.WRITTEN[:] = self._out, self._stage, self._written
        shutil.rmtree(self.tmp, ignore_errors=True)
        collect.LOG.clear()

    def test_write_is_staged_and_promoted(self):
        collect.wjson("topics/demo.json", {"hello": "world"})
        self.assertTrue((self.tmp / ".staging" / "topics" / "demo.json").exists())
        self.assertFalse((self.tmp / "topics" / "demo.json").exists(),
                         "data/ must be untouched before promote()")
        collect.promote()
        published = json.loads((self.tmp / "topics" / "demo.json").read_text())
        self.assertEqual(published, {"hello": "world"})
        self.assertFalse((self.tmp / ".staging").exists(), "staging must be cleaned up")

    def test_discard_leaves_no_trace(self):
        collect.wjson("resolved.json", {"markets": []})
        collect.discard("test: incomplete run")
        self.assertFalse((self.tmp / ".staging").exists())
        self.assertFalse((self.tmp / "resolved.json").exists())
        self.assertEqual(collect.read_output("resolved.json"), None)

    def test_read_output_prefers_this_runs_staged_copy(self):
        collect.promote()                       # publish one version
        collect.wjson("resolved.json", {"v": 2})
        collect.promote()
        collect.wjson("resolved.json", {"v": 3})
        self.assertEqual(collect.read_output("resolved.json"), {"v": 3})

    def test_label_warnings_flag_a_row_the_topic_excludes(self):
        topics = [{"id": "gas-prices", "label": "Gas prices", "categories": ["Economics"],
                   "title_keywords": "gasoline", "series_prefix": "^(KX)?GAS",
                   "exclude_keywords": "natural gas|propane"}]
        collect.wjson("resolved.json", {"markets": [
            {"ticker": "KXNATGAS15M-1-1", "event_ticker": "KXNATGAS15M-1", "_topic": "gas-prices",
             "title": "Natural Gas price up in next 15 mins?"},
            {"ticker": "KXGAS-1", "event_ticker": "KXGAS-1", "_topic": "gas-prices",
             "title": "Average gasoline price in December"},
        ]})
        warns = collect.label_warnings(topics)
        self.assertEqual(len(warns), 1, warns)
        self.assertIn("KXNATGAS15M-1-1", warns[0])


class ClassifierTest(unittest.TestCase):
    """The published data must agree with the topic rules that produced it."""

    @classmethod
    def setUpClass(cls):
        cls.topics = collect.load_topics()

    def test_natural_gas_never_enters_the_retail_gasoline_topic(self):
        row = {"title": "Natural Gas price up in next 15 mins?",
               "series_ticker": "KXNATGAS15M"}
        self.assertEqual(collect.classify(row, self.topics), (None, None))
        self.assertEqual(collect.classify_settled_without_event(row["title"], "KXNATGAS15M",
                                                                self.topics), (None, None))

    def test_settled_fallback_uses_the_series_guessed_from_the_event_ticker(self):
        # GET /markets/{ticker} publishes no series_ticker (official Get Market schema,
        # re-read 2026-11-21), so the guess is what keeps crypto rows in scope.
        row_title = "Ethereum price at Nov 20, 2026 at 5pm EST?"
        self.assertEqual(collect.classify_settled_without_event(row_title,
                                                                collect.series_guess("KXETHD-26NOV2017"),
                                                                self.topics),
                         ("crypto", "series-prefix"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
