"""Offline regression tests for the settled-market topic fallback and 429 handling."""
import io
import sys
import time
import unittest
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.collect import classify, classify_settled_without_event, keyword_match, load_topics
import scripts.collect as collect


class RateLimitBackoffTests(unittest.TestCase):
    """https://docs.kalshi.com/getting_started/rate_limits — 429 means back off with
    exponential backoff; no Retry-After header is sent and X-RateLimit-Reset (seconds)
    is available. The 2026-11-21 run logged 220x 429 with no retry."""

    def setUp(self):
        self._urlopen = collect.urllib.request.urlopen
        self._sleep = collect.REQUEST_SLEEP_S
        collect.REQUEST_SLEEP_S = 0.0
        self._time_sleep = collect.time.sleep
        collect.time.sleep = lambda _s: None      # tests must never really sleep
        collect.LOG.clear()

    def tearDown(self):
        collect.urllib.request.urlopen = self._urlopen
        collect.time.sleep = self._time_sleep
        collect.REQUEST_SLEEP_S = self._sleep

    @staticmethod
    def _err(reset=None):
        err = urllib.error.HTTPError("https://x", 429, "Too Many Requests",
                                    {"X-RateLimit-Reset": reset} if reset else {}, io.BytesIO(b"{}"))
        err.read = lambda: b'{"error":{"code":"too_many_requests"}}'
        return err

    @staticmethod
    def _resp():
        class R:
            status = 200
            headers = {}
            def read(self): return b'{"ok":true}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return R()

    def test_429_is_retried_then_succeeds(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) < 3:
                raise self._err()
            return self._resp()

        collect.urllib.request.urlopen = fake
        code, _, body, _ = collect.get("https://x")
        self.assertEqual(code, 200)
        self.assertEqual(len(calls), 3)
        self.assertEqual(body, b'{"ok":true}')

    def test_x_ratelimit_reset_is_honoured(self):
        waited = []
        collect.time.sleep = waited.append
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                raise self._err(reset="0.75")
            return self._resp()

        collect.urllib.request.urlopen = fake
        code, _, _, _ = collect.get("https://x")
        self.assertEqual(code, 200)
        self.assertEqual(waited, [0.75])

    def test_retries_are_bounded(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            raise self._err()

        collect.urllib.request.urlopen = fake
        code, _, _, _ = collect.get("https://x")
        self.assertEqual(code, 429)
        self.assertEqual(len(calls), collect.MAX_RETRIES_429 + 1)

    def test_backoff_cap_is_applied(self):
        waited = []
        collect.time.sleep = waited.append
        collect.urllib.request.urlopen = lambda req, timeout=0: (_ for _ in ()).throw(self._err(reset="999"))
        collect.get("https://x")
        self.assertTrue(all(w <= collect.BACKOFF_CAP_S for w in waited), waited)


class SettledTopicClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics = load_topics()

    def test_natural_gas_is_excluded_with_or_without_open_event(self):
        self.assertEqual(
            classify({"title": "Natural gas price on November 21", "category": "Energy", "series_ticker": "KXNATGAS"}, self.topics),
            (None, None),
        )
        self.assertEqual(
            classify_settled_without_event("Natural gas price on November 21", "KXNATGAS", self.topics),
            (None, None),
        )

    def test_petrolul_does_not_match_petrol_keyword_inside_word(self):
        self.assertFalse(keyword_match("petrol", "CSM BBA Petrolul Ploiesti wins"))
        self.assertEqual(
            classify_settled_without_event("CSM BBA Petrolul Ploiesti wins", "KXROMLNBMGAME", self.topics),
            (None, None),
        )

    def test_real_gasoline_terms_still_match_as_whole_words(self):
        self.assertEqual(
            classify_settled_without_event("US average gasoline price", "KXGASPRICE", self.topics),
            ("gas-prices", "series-prefix"),
        )
        self.assertEqual(
            classify({"title": "US average gas prices", "category": "Economics"}, self.topics),
            ("gas-prices", "category"),
        )

    def test_series_discovery_fallback_honors_exclusions(self):
        self.assertEqual(
            classify_settled_without_event("Natural gas", "KXAAAGASM", self.topics),
            (None, None),
        )


class RateLimitBackoffTests(unittest.TestCase):
    """https://docs.kalshi.com/getting_started/rate_limits — 429 means back off; no Retry-After
    header is sent, and X-RateLimit-Reset (seconds) is available when the API includes it.
    The 2026-11-21 run logged 220x 429 with no retry (Flag BE-1)."""

    def setUp(self):
        self._urlopen = collect.urllib.request.urlopen
        self._sleep = collect.time.sleep
        collect.time.sleep = lambda _s: None      # tests must never really sleep
        collect.LOG.clear()
        collect.FAILURES.clear()

    def tearDown(self):
        collect.urllib.request.urlopen = self._urlopen
        collect.time.sleep = self._sleep

    @staticmethod
    def _err(code=429, headers=None):
        err = urllib.error.HTTPError("https://x", code, "err", headers or {}, io.BytesIO(b"{}"))
        err.read = lambda: b'{"error":{"code":"too_many_requests"}}'
        return err

    @staticmethod
    def _resp():
        class R:
            status = 200
            headers = {}
            def read(self): return b'{"ok":true}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return R()

    def test_429_is_retried_then_succeeds(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) < 3:
                raise self._err()
            return self._resp()

        collect.urllib.request.urlopen = fake
        code, body, _, attempts = collect.get_with_retry("https://x")
        self.assertEqual(code, 200)
        self.assertEqual(attempts, 3)
        self.assertEqual(body, b'{"ok":true}')
        self.assertEqual(collect.FAILURES, [])

    def test_x_ratelimit_reset_drives_the_backoff(self):
        waited = []
        collect.time.sleep = waited.append
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                raise self._err(headers={"X-RateLimit-Reset": "0.75"})
            return self._resp()

        collect.urllib.request.urlopen = fake
        code, _, _, _ = collect.get_with_retry("https://x")
        self.assertEqual(code, 200)
        self.assertIn(0.75, waited)          # the reset value, not 2**1 = 2s

    def test_retry_after_wins_over_reset_when_present(self):
        waited = []
        collect.time.sleep = waited.append
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) == 1:
                raise self._err(headers={"Retry-After": "3", "X-RateLimit-Reset": "0.75"})
            return self._resp()

        collect.urllib.request.urlopen = fake
        collect.get_with_retry("https://x")
        self.assertIn(3.0, waited)

    def test_retries_are_bounded_and_the_failure_is_recorded(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            raise self._err()

        collect.urllib.request.urlopen = fake
        code, _, _, attempts = collect.get_with_retry("https://x")
        self.assertEqual(code, 429)
        self.assertEqual(attempts, collect.MAX_ATTEMPTS)
        self.assertEqual(len(calls), collect.MAX_ATTEMPTS)
        collect.fetch_json("https://x")      # a failed read must reach FAILURES
        self.assertTrue(any(f["url"] == "https://x" and f["reason"] == "transient" for f in collect.FAILURES))

    def test_backoff_cap_is_applied(self):
        waited = []
        collect.time.sleep = waited.append
        collect.urllib.request.urlopen = lambda req, timeout=0: (_ for _ in ()).throw(
            self._err(headers={"X-RateLimit-Reset": "999"}))
        collect.get_with_retry("https://x")
        self.assertTrue(all(w <= collect.BACKOFF_CAP_S for w in waited), waited)

    def test_a_definitive_4xx_is_not_retried(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            raise self._err(code=400)

        collect.urllib.request.urlopen = fake
        code, _, _, attempts = collect.get_with_retry("https://x")
        self.assertEqual((code, attempts, len(calls)), (400, 1, 1))


if __name__ == "__main__":
    unittest.main()
