"""Offline regression tests for the settled-market topic fallback."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.collect import classify, classify_settled_without_event, keyword_match, load_topics


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


if __name__ == "__main__":
    unittest.main()
