#!/usr/bin/env python3
"""Offline checks for the collector's request accounting, publish gate and row
selection. No network: `collect.get()` is stubbed, `time.sleep` is disabled.

Why these exist (2026-11-21): a `snapshot` run lost every request after its first
12 pages to HTTP 429, wrote zero-row files anyway, and CI published them
(`data/resolved.json` 321 B / 0 rows, `topics/crypto.json` 260 kB -> 4.5 kB). The
fail-closed reads themselves came from session `c96a21b7` and are covered by
`tests/test_collect_failclosed.py`; what is covered here is the accounting that
proves the throttle works, the per-topic selection that keeps the Resolved page
from becoming a single-topic page, and the two CI steps that refuse to publish an
incomplete run or a tree with committed conflict markers.
"""

import json
import os
import re
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.argv = [sys.argv[0]]

import scripts.collect as collect  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOPICS = [{"id": "gas-prices"}, {"id": "elections"}, {"id": "culture"},
          {"id": "crypto"}, {"id": "golf"}]
IDS = [t["id"] for t in TOPICS]


def rows():
    """A settled batch shaped like the 2026-11-21 one: a huge recent crypto block,
    a handful of burst-settling rows in three other topics, one topic with nothing,
    and two rows whose topic is not configured at all."""
    out = ([{"_topic": "crypto", "settlement_ts": "2026-11-21T%02d:%02dZ" % (10 + i // 60, i % 60)}
            for i in range(1000)]
           + [{"_topic": "golf", "settlement_ts": "2026-11-20T01:00Z"}] * 5
           + [{"_topic": "elections", "settlement_ts": "2026-11-19T01:00Z"}] * 5
           + [{"_topic": "culture", "settlement_ts": "2026-11-18T01:00Z"}] * 3
           + [{"_topic": "unlisted", "settlement_ts": "2026-11-17T01:00Z"}] * 2)
    out.sort(key=lambda m: m["settlement_ts"], reverse=True)
    return out


class SelectResolvedTest(unittest.TestCase):
    """Flagged item 78-8: the published Resolved rows were 200 of one topic."""

    def test_every_topic_with_rows_appears(self):
        picked = collect.select_resolved(rows(), 200, IDS)
        self.assertEqual(len(picked), 200)
        self.assertEqual({r["_topic"] for r in picked},
                         {"crypto", "golf", "elections", "culture"})

    def test_small_topics_keep_their_rows_and_crypto_gets_the_backfill(self):
        picked = collect.select_resolved(rows(), 200, IDS)
        counts = {t: sum(1 for r in picked if r["_topic"] == t) for t in IDS}
        self.assertEqual(counts["golf"], 5)
        self.assertEqual(counts["elections"], 5)
        self.assertEqual(counts["culture"], 3)
        self.assertEqual(counts["gas-prices"], 0)      # nothing settled in the window
        self.assertEqual(counts["crypto"], 200 - 13)   # its share, then the backfill

    def test_order_is_newest_first_and_the_limit_is_exact(self):
        picked = collect.select_resolved(rows(), 200, IDS)
        self.assertEqual(picked, sorted(picked, key=lambda m: m["settlement_ts"], reverse=True))
        self.assertEqual(len(collect.select_resolved(rows(), 5, IDS)), 5)
        self.assertEqual(len(collect.select_resolved(rows()[:7], 200, IDS)), 7)

    def test_degenerate_inputs_never_crash_or_overfill(self):
        self.assertEqual(collect.select_resolved(rows(), 0, IDS), [])
        self.assertEqual(collect.select_resolved([], 200, IDS), [])
        self.assertEqual(len(collect.select_resolved(rows(), 200, [])), 200)  # plain recency slice
        only_other = [{"_topic": "x", "settlement_ts": "2026-11-01T00:00Z"}] * 10
        self.assertEqual(len(collect.select_resolved(only_other, 200, IDS)), 10)  # not dropped

    def test_the_published_payload_documents_the_selection(self):
        """`published_per_topic` has to be in the file: the whole point is that the
        shape is checkable from published data instead of from a code read."""
        src = open(os.path.join(ROOT, "scripts", "collect.py"), encoding="utf-8").read()
        for key in ('"published_count"', '"published_per_topic"', '"row_selection"',
                    '"markets": published'):
            self.assertIn(key, src, f"resolved.json must publish {key}")


class SeriesGuessAtTheCallSiteTest(unittest.TestCase):
    """Flagged item 78-3: `GET /markets/{ticker}` publishes no `series_ticker`
    (official Get Market schema, re-read 2026-11-21; 200/200 committed settled rows
    carry none), so the settled fallback has to fall back on the event ticker."""

    def setUp(self):
        self.topics = json.load(open(os.path.join(ROOT, "scripts", "topics.json"),
                                     encoding="utf-8"))["topics"]

    def test_empty_series_loses_the_row_but_the_guess_recovers_it(self):
        title = "Ethereum price at Nov 20, 2026 at 5pm EST?"
        self.assertEqual(collect.classify_settled_without_event(title, "", self.topics)[0], None)
        self.assertEqual(collect.classify_settled_without_event(
            title, collect.series_guess("KXETHD-26NOV2017"), self.topics),
            ("crypto", "series-prefix"))

    def test_the_settled_path_passes_the_guess_not_the_raw_field(self):
        src = open(os.path.join(ROOT, "scripts", "collect.py"), encoding="utf-8").read()
        call = re.search(r"=\s*classify_settled_without_event\((.*?)\)", src, re.S)
        self.assertTrue(call, "the settled fallback call site disappeared")
        self.assertIn("series_guess", call.group(1),
                      "the fallback must receive `series or series_guess(event_ticker)`")

    def test_exclusions_still_win_over_the_guess(self):
        # PR #65 behaviour must survive the call-site change: natural gas is not the
        # retail-gasoline topic, even though the series prefix would otherwise match.
        title = "Natural Gas price up in next 15 mins?"
        tid, _why = collect.classify_settled_without_event(
            title, collect.series_guess("KXNATGAS15M-26NOV202300-00"), self.topics)
        self.assertNotEqual(tid, "gas-prices")


class RequestStatsTest(unittest.TestCase):
    """The docs claim (EXECUTIVE_SUMMARY "throttling and back-off on 429") is only
    honest if the run publishes the counters that prove it happened."""

    def setUp(self):
        self.real_get, self.real_sleep = collect.get, time.sleep
        self.saved = dict(collect.STATS)
        collect.STATS.update({"requests": 0, "retried": 0, "throttled_429": 0})
        collect.time.sleep = lambda *_a, **_k: None   # no wall time in tests

    def tearDown(self):
        collect.get, collect.time.sleep = self.real_get, self.real_sleep
        collect.STATS.clear()
        collect.STATS.update(self.saved)

    def test_counters_track_a_throttled_then_ok_request(self):
        seq = [(429, {"retry-after": "0"}, b"", 0.0), (200, {}, b"{}", 0.1)]

        def fake_get(url, origin=None, method="GET", timeout=45):
            return seq.pop(0)

        collect.get = fake_get
        code, body, _dt, attempts = collect.get_with_retry("https://x/y")
        self.assertEqual((code, attempts), (200, 2))
        self.assertEqual(collect.STATS["requests"], 2)
        self.assertEqual(collect.STATS["retried"], 1)
        self.assertEqual(collect.STATS["throttled_429"], 1)

    def test_a_clean_request_is_not_counted_as_a_retry(self):
        collect.get = lambda url, origin=None, method="GET", timeout=45: (200, {}, b"{}", 0.1)
        collect.get_with_retry("https://x/y")
        self.assertEqual(collect.STATS, {"requests": 1, "retried": 0, "throttled_429": 0})

    def test_giving_up_records_the_failure_and_counts_every_attempt(self):
        n = {"calls": 0}

        def always_429(url, origin=None, method="GET", timeout=45):
            n["calls"] += 1
            return 429, {}, b"", 0.0

        collect.get = always_429
        code, _b, _dt, attempts = collect.get_with_retry("https://x/y")
        self.assertEqual(code, 429)
        self.assertEqual(attempts, collect.MAX_ATTEMPTS)
        self.assertEqual(n["calls"], collect.MAX_ATTEMPTS)
        self.assertEqual(collect.STATS["requests"], collect.MAX_ATTEMPTS)

    def test_the_counters_are_published(self):
        src = open(os.path.join(ROOT, "scripts", "collect.py"), encoding="utf-8").read()
        self.assertIn('"request_stats": dict(STATS)', src,
                      "collect_status.json must carry the request counters")


class WorkflowGateTest(unittest.TestCase):
    """Both CI guards are the cheap part of the fix, so pin them: a workflow edit
    that drops a step is exactly how the 06:58Z snapshot got committed."""

    @classmethod
    def setUpClass(cls):
        cls.yml = open(os.path.join(ROOT, ".github", "workflows", "pages.yml"),
                       encoding="utf-8").read()

    def test_snapshot_job_refuses_an_incomplete_snapshot_before_committing(self):
        block = self.yml[self.yml.index("Refuse to publish a snapshot"):]
        block = block[:block.index("Commit refreshed snapshots")]
        for needle in ("events_open_count", "markets_open_count", "settled_count_recent",
                       "sys.exit("):
            self.assertIn(needle, block, f"the gate must check {needle}")

    def test_checks_job_runs_both_collector_test_files(self):
        for step in ("tests/test_collect.py", "tests/test_collect_hardening.py",
                     "tests/test_collect_failclosed.py"):
            self.assertIn(step, self.yml, f"checks must run {step}")

    def test_checks_job_rejects_committed_conflict_markers(self):
        self.assertRegex(self.yml, r"No committed Git conflict markers anywhere in the tree")
        self.assertIn("git grep -nI -E", self.yml)

    def test_test_package_script_runs_the_hardening_tests(self):
        pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
        self.assertIn("test_collect_hardening.py", pkg["scripts"]["test"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
