#!/usr/bin/env python3
"""Offline regression tests for the collector's fail-closed behaviour (COORDINATION c96a21b7).

Reproduces the 2026-11-21T06:58:35Z incident without network: every API call returns HTTP 429.
The previously verified artifacts must survive byte-for-byte, and the run must say so.
Run: python3 tests/test_collect_failclosed.py   (stdlib only, no network)
"""
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.chdir(ROOT)
import collect  # noqa: E402  (no side effects on import)

ARTIFACTS = ["resolved.json", "categories.json", "meta.json",
             "topics/gas-prices.json", "topics/elections.json", "topics/culture.json",
             "topics/crypto.json", "topics/golf.json"]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class FailClosedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="collect-test-")
        # seed a "last verified" copy of the artifacts: sentinel content, distinct per file
        for rel in ARTIFACTS:
            full = os.path.join(self.tmp, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            payload = {"sentinel": rel, "markets": [{"ticker": f"KEEP-{rel}"}], "events": [{"e": 1}]}
            with open(full, "w", encoding="utf-8") as f:
                json.dump(payload, f)
        self.before = {rel: sha(os.path.join(self.tmp, rel)) for rel in ARTIFACTS}
        self._saved = (collect.OUT, collect.get, collect.time.sleep)
        collect.OUT = self.tmp
        collect.time.sleep = lambda s: None  # no real waiting in tests
        collect.FAILURES.clear()
        collect.KEPT.clear()

    def tearDown(self):
        collect.OUT, collect.get, collect.time.sleep = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_main(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            collect.main()
        return buf.getvalue()

    def test_retry_then_success(self):
        calls = []

        def fake_get(url, origin=None, method="GET", timeout=45):
            calls.append(url)
            if len(calls) < 3:
                return 429, {}, b'{"error":{"code":"too_many_requests"}}', 0.0
            return 200, {}, b'{"ok": true}', 0.0

        collect.get = fake_get
        self.assertEqual(collect.fetch_json("https://x/test"), {"ok": True})
        self.assertEqual(len(calls), 3)          # two 429s were retried
        self.assertEqual(collect.FAILURES, [])   # a recovered read is not a failure

    def test_retry_gives_up_and_records_failure(self):
        collect.get = lambda url, origin=None, method="GET", timeout=45: (
            429, {}, b'{"error":{"code":"too_many_requests"}}', 0.0)
        self.assertIsNone(collect.fetch_json("https://x/test"))
        self.assertEqual(len(collect.FAILURES), 1)
        self.assertEqual(collect.FAILURES[0]["attempts"], collect.MAX_ATTEMPTS)

    def test_definitive_404_is_not_a_transient_failure(self):
        collect.get = lambda url, origin=None, method="GET", timeout=45: (404, {}, b'{}', 0.0)
        self.assertIsNone(collect.fetch_json("https://x/missing"))
        self.assertEqual(collect.FAILURES, [])

    def test_empty_200_body_is_a_failed_read(self):
        collect.get = lambda url, origin=None, method="GET", timeout=45: (200, {}, b"", 0.0)
        self.assertIsNone(collect.fetch_json("https://x/empty"))
        self.assertEqual(collect.FAILURES[0]["reason"], "empty-body")

    def test_incident_all_429_keeps_every_verified_artifact(self):
        collect.get = lambda url, origin=None, method="GET", timeout=45: (
            429, {}, b'{"error":{"code":"too_many_requests"}}', 0.0)
        out = self.run_main()
        after = {rel: sha(os.path.join(self.tmp, rel)) for rel in ARTIFACTS}
        self.assertEqual(after, self.before, "a 429 run overwrote a verified artifact")
        with open(os.path.join(self.tmp, "collect_status.json"), encoding="utf-8") as f:
            status = json.load(f)
        self.assertEqual(status["status"], "degraded: previous verified artifacts kept")
        self.assertGreater(status["transient_read_failures"], 0)
        self.assertIn("resolved.json", status["kept_previous_artifacts"])
        self.assertIn("KEEP data/resolved.json", out)

    def test_empty_200_responses_do_not_wipe_data(self):
        # Every list endpoint answers 200 with no rows: an empty read must not replace good rows.
        def empty(url, origin=None, method="GET", timeout=45):
            return 200, {}, b'{"markets": [], "events": [], "series": [], "cursor": ""}', 0.0
        collect.get = empty
        self.run_main()
        after = {rel: sha(os.path.join(self.tmp, rel)) for rel in ARTIFACTS}
        self.assertEqual(after["resolved.json"], self.before["resolved.json"])
        self.assertEqual(after["categories.json"], self.before["categories.json"])
        for tid in ["gas-prices", "elections", "culture", "crypto", "golf"]:
            self.assertEqual(after[f"topics/{tid}.json"], self.before[f"topics/{tid}.json"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
