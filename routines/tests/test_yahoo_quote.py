"""Offline unit tests for yahoo_quote's parsing and time-selection logic.

These exercise everything except the live network call (which is isolated in
``fetch_chart``). Run: python3 -m unittest routines.tests.test_yahoo_quote
"""
import json
import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROUTINES = os.path.dirname(HERE)
sys.path.insert(0, ROUTINES)

import yahoo_quote as yq  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
TAIPEI = timezone(timedelta(hours=8))


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


class TestDatetimeParsing(unittest.TestCase):
    def test_iso_with_offset(self):
        dt = yq.parse_datetime("2026-05-07T13:15:00+08:00", timezone.utc)
        self.assertEqual(dt.utcoffset(), timedelta(hours=8))
        self.assertEqual(dt.hour, 13)

    def test_naive_uses_default_tz(self):
        dt = yq.parse_datetime("2026-05-07 13:15", TAIPEI)
        self.assertEqual(dt.utcoffset(), timedelta(hours=8))

    def test_z_suffix(self):
        dt = yq.parse_datetime("2026-05-07T05:15:00Z", TAIPEI)
        self.assertEqual(dt.utcoffset(), timedelta(0))

    def test_slash_format(self):
        dt = yq.parse_datetime("2026/05/07 09:03", TAIPEI)
        self.assertEqual((dt.month, dt.day, dt.minute), (5, 7, 3))

    def test_date_only(self):
        dt = yq.parse_datetime("2026-05-07", TAIPEI)
        self.assertEqual((dt.hour, dt.minute), (0, 0))

    def test_bad_raises(self):
        with self.assertRaises(ValueError):
            yq.parse_datetime("not-a-date", TAIPEI)


class TestBuildUrl(unittest.TestCase):
    def test_encodes_symbol_and_params(self):
        url = yq.build_url("https://query1.finance.yahoo.com", "^TWII", 100, 200, "5m")
        self.assertIn("/v8/finance/chart/%5ETWII", url)
        self.assertIn("period1=100", url)
        self.assertIn("period2=200", url)
        self.assertIn("interval=5m", url)


class TestParseChart(unittest.TestCase):
    def setUp(self):
        self.parsed = yq.parse_chart(load("yahoo_chart_1m.json"))

    def test_meta(self):
        self.assertEqual(self.parsed["meta"]["symbol"], "2393.TW")
        self.assertEqual(self.parsed["exchange_tz"].utcoffset(None), timedelta(hours=8))

    def test_skips_null_candle(self):
        # fixture has 6 timestamps but the 09:04 candle is all null -> dropped
        self.assertEqual(len(self.parsed["candles"]), 5)
        minutes = [datetime.fromisoformat(c["datetime"]).minute for c in self.parsed["candles"]]
        self.assertEqual(minutes, [0, 1, 2, 3, 5])

    def test_ohlcv_values(self):
        first = self.parsed["candles"][0]
        self.assertEqual(first["open"], 500.0)
        self.assertEqual(first["close"], 501.0)
        self.assertEqual(first["volume"], 12000)

    def test_error_payload_raises(self):
        with self.assertRaises(RuntimeError):
            yq.parse_chart(load("yahoo_chart_error.json"))

    def test_empty_result_raises(self):
        with self.assertRaises(RuntimeError):
            yq.parse_chart({"chart": {"result": [], "error": None}})


class TestSelectQuoteAtTime(unittest.TestCase):
    def setUp(self):
        self.candles = yq.parse_chart(load("yahoo_chart_1m.json"))["candles"]

    def at(self, hh, mm, ss=0):
        return datetime(2026, 5, 7, hh, mm, ss, tzinfo=TAIPEI)

    def test_at_or_before_exact(self):
        c = yq.select_quote_at_time(self.candles, self.at(9, 2), "at_or_before")
        self.assertEqual(datetime.fromisoformat(c["datetime"]).minute, 2)

    def test_at_or_before_between(self):
        # 09:03:30 -> latest candle at/ before is 09:03
        c = yq.select_quote_at_time(self.candles, self.at(9, 3, 30), "at_or_before")
        self.assertEqual(datetime.fromisoformat(c["datetime"]).minute, 3)

    def test_at_or_before_skips_missing(self):
        # 09:04:30 -> 09:04 candle is null/dropped, so 09:03 is the answer
        c = yq.select_quote_at_time(self.candles, self.at(9, 4, 30), "at_or_before")
        self.assertEqual(datetime.fromisoformat(c["datetime"]).minute, 3)

    def test_before_all_returns_none(self):
        self.assertIsNone(yq.select_quote_at_time(self.candles, self.at(8, 0), "at_or_before"))

    def test_nearest_prefers_closest(self):
        # 09:04:30 nearest -> 09:05 (30s) beats 09:03 (90s)
        c = yq.select_quote_at_time(self.candles, self.at(9, 4, 30), "nearest")
        self.assertEqual(datetime.fromisoformat(c["datetime"]).minute, 5)

    def test_at_or_after(self):
        c = yq.select_quote_at_time(self.candles, self.at(9, 4, 30), "at_or_after")
        self.assertEqual(datetime.fromisoformat(c["datetime"]).minute, 5)

    def test_at_or_after_past_end_none(self):
        self.assertIsNone(yq.select_quote_at_time(self.candles, self.at(10, 0), "at_or_after"))


class TestWindowForTarget(unittest.TestCase):
    def test_intraday_tight_window(self):
        target = datetime(2026, 5, 7, 13, 0, tzinfo=TAIPEI)
        p1, p2 = yq.window_for_target(target, "1m", pad_days=2)
        span_days = (p2 - p1) / 86400
        self.assertLessEqual(span_days, 4)
        self.assertGreater(span_days, 0)

    def test_daily_wider_window(self):
        target = datetime(2026, 5, 7, tzinfo=TAIPEI)
        p1, p2 = yq.window_for_target(target, "1d", pad_days=2)
        self.assertGreater((p2 - p1) / 86400, 5)


class TestValidation(unittest.TestCase):
    def test_bad_interval_rejected(self):
        with self.assertRaises(ValueError):
            yq.get_quote_at_time("AAPL", "2026-05-07 13:00", interval="7q")


if __name__ == "__main__":
    unittest.main(verbosity=2)
