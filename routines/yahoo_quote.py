#!/usr/bin/env python3
"""Fetch a ticker's quote at a specific point in time from Yahoo Finance.

Uses the public chart endpoint
``https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}`` which returns
OHLCV candles.  Given a target datetime, we pick the candle at-or-before that
instant (the realistic "what was the price at time T" reading) and report it.

The network fetch is isolated in ``fetch_chart`` so the selection logic
(``select_quote_at_time`` / ``parse_chart``) is fully unit-testable offline.

Examples:
  # Last daily close for a US name
  python3 yahoo_quote.py --symbol AAPL --at "2026-05-06 16:00" --interval 1d

  # Intraday 1-minute quote for a Taiwan-listed stock (TWSE .TW / TPEx .TWO)
  python3 yahoo_quote.py --symbol 2393.TW --at "2026-05-07 13:15" --interval 1m

  # Taiwan weighted index at a moment
  python3 yahoo_quote.py --symbol '^TWII' --at "2026-05-07 11:00" --interval 5m

Notes on Yahoo limits:
  * 1m data is only available for roughly the last 30 days.
  * Intraday intervals (1m/2m/5m/15m/30m/60m/90m) have limited history windows.
  * For older dates use --interval 1d (daily).
Output is JSON on stdout; exit 0 on success, non-zero on failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Optional

HOSTS = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
]

VALID_INTERVALS = {
    "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h",
    "1d", "5d", "1wk", "1mo", "3mo",
}

INTRADAY = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}


# --------------------------------------------------------------------------- #
# Time parsing
# --------------------------------------------------------------------------- #
def parse_datetime(text: str, default_tz: timezone) -> datetime:
    """Parse a user datetime string into an aware datetime.

    Accepts ISO-8601 (with or without offset) plus a few common layouts.
    Naive inputs are interpreted in ``default_tz``.
    """
    text = text.strip()
    # Try fromisoformat first (handles "2026-05-07T13:15:00+08:00" etc).
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=default_tz)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S",
                "%Y/%m/%d %H:%M", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.replace(tzinfo=default_tz)
        except ValueError:
            continue
    raise ValueError(f"unrecognized datetime: {text!r}")


def tz_from_offset_hours(hours: float) -> timezone:
    return timezone(timedelta(hours=hours))


# --------------------------------------------------------------------------- #
# URL / fetch
# --------------------------------------------------------------------------- #
def build_url(host: str, symbol: str, period1: int, period2: int, interval: str,
              include_prepost: bool = True) -> str:
    from urllib.parse import urlencode, quote

    params = {
        "period1": period1,
        "period2": period2,
        "interval": interval,
        "includePrePost": "true" if include_prepost else "false",
        "events": "div,splits",
    }
    return f"{host}/v8/finance/chart/{quote(symbol)}?{urlencode(params)}"


def _ca_bundle() -> Optional[str]:
    # Honour standard override, else auto-use the Claude proxy CA if present.
    env = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if env:
        return env
    ccr = "/root/.ccr/ca-bundle.crt"
    return ccr if os.path.exists(ccr) else None


def fetch_chart(symbol: str, period1: int, period2: int, interval: str,
                include_prepost: bool = True, timeout: int = 30) -> dict:
    """Fetch raw chart JSON from Yahoo, trying both hosts. Returns parsed dict."""
    import requests

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json,text/plain,*/*",
    }
    verify = _ca_bundle() or True
    last_err: Optional[Exception] = None
    for host in HOSTS:
        url = build_url(host, symbol, period1, period2, interval, include_prepost)
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, verify=verify)
            if resp.status_code == 200:
                return resp.json()
            last_err = RuntimeError(f"HTTP {resp.status_code} from {host}: {resp.text[:200]}")
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise RuntimeError(f"could not fetch chart for {symbol!r}: {last_err}")


# --------------------------------------------------------------------------- #
# Parsing / selection (pure functions - unit tested offline)
# --------------------------------------------------------------------------- #
def parse_chart(payload: dict) -> dict:
    """Normalise a Yahoo chart payload into meta + a list of candle dicts.

    Returns {"meta": {...}, "candles": [{"ts", "datetime", "open","high",
    "low","close","volume"}...]}. Raises on Yahoo-reported errors / empty data.
    """
    chart = (payload or {}).get("chart") or {}
    err = chart.get("error")
    if err:
        desc = err.get("description") if isinstance(err, dict) else str(err)
        raise RuntimeError(f"Yahoo error: {desc}")
    results = chart.get("result") or []
    if not results:
        raise RuntimeError("Yahoo returned no result for symbol")
    res = results[0]
    meta = res.get("meta") or {}
    timestamps = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    adjclose = None
    adj = (res.get("indicators") or {}).get("adjclose")
    if adj and isinstance(adj, list) and adj:
        adjclose = adj[0].get("adjclose")

    gmtoffset = meta.get("gmtoffset", 0) or 0
    tz = timezone(timedelta(seconds=gmtoffset))

    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    vols = quote.get("volume") or []

    candles = []
    for i, ts in enumerate(timestamps):
        c = closes[i] if i < len(closes) else None
        # Skip empty candles (Yahoo pads gaps with nulls).
        if c is None and (i >= len(opens) or opens[i] is None):
            continue
        candles.append({
            "ts": ts,
            "datetime": datetime.fromtimestamp(ts, tz).isoformat(),
            "open": opens[i] if i < len(opens) else None,
            "high": highs[i] if i < len(highs) else None,
            "low": lows[i] if i < len(lows) else None,
            "close": c,
            "adjclose": adjclose[i] if adjclose and i < len(adjclose) else None,
            "volume": vols[i] if i < len(vols) else None,
        })

    return {"meta": meta, "candles": candles, "exchange_tz": tz}


def select_quote_at_time(candles: list, target: datetime, mode: str = "at_or_before") -> Optional[dict]:
    """Pick the candle matching ``target`` per ``mode``.

    mode:
      * "at_or_before": latest candle with ts <= target (default; the price
        "as of" that instant). None if target precedes all data.
      * "nearest": candle whose ts is closest to target in either direction.
      * "at_or_after": earliest candle with ts >= target.
    """
    if not candles:
        return None
    target_ts = int(target.timestamp())

    if mode == "nearest":
        return min(candles, key=lambda c: abs(c["ts"] - target_ts))

    if mode == "at_or_after":
        after = [c for c in candles if c["ts"] >= target_ts]
        return after[0] if after else None

    # at_or_before (default)
    before = [c for c in candles if c["ts"] <= target_ts]
    return before[-1] if before else None


def window_for_target(target: datetime, interval: str, pad_days: int = 2) -> tuple[int, int]:
    """Build a (period1, period2) unix window around ``target``.

    Daily intervals get a wider window; intraday gets a tight one so Yahoo
    honours the short-history limits.
    """
    if interval in INTRADAY:
        start = target - timedelta(days=max(1, pad_days))
        end = target + timedelta(days=1)
    else:
        start = target - timedelta(days=max(7, pad_days * 5))
        end = target + timedelta(days=2)
    now = datetime.now(timezone.utc)
    if end > now:
        end = now
    return int(start.timestamp()), int(end.timestamp())


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def get_quote_at_time(symbol: str, at: str, interval: str = "1m",
                      mode: str = "at_or_before", tz_offset_hours: Optional[float] = None,
                      pad_days: int = 2) -> dict:
    """High-level: parse time, fetch, select. Returns a result dict."""
    if interval not in VALID_INTERVALS:
        raise ValueError(f"invalid interval {interval!r}; choose from {sorted(VALID_INTERVALS)}")

    default_tz = tz_from_offset_hours(tz_offset_hours) if tz_offset_hours is not None else timezone.utc
    target = parse_datetime(at, default_tz)

    period1, period2 = window_for_target(target, interval, pad_days)
    payload = fetch_chart(symbol, period1, period2, interval)
    parsed = parse_chart(payload)

    # If the user gave a naive time and did not pin a tz, re-interpret it in the
    # exchange timezone so "13:15" means 13:15 *local to the exchange*.
    if tz_offset_hours is None and _looks_naive(at):
        target = parse_datetime(at, parsed["exchange_tz"])

    candle = select_quote_at_time(parsed["candles"], target, mode)
    meta = parsed["meta"]
    return {
        "symbol": meta.get("symbol", symbol),
        "requested_symbol": symbol,
        "currency": meta.get("currency"),
        "exchange": meta.get("exchangeName") or meta.get("fullExchangeName"),
        "exchange_timezone": meta.get("exchangeTimezoneName"),
        "interval": interval,
        "target_time": target.isoformat(),
        "selection_mode": mode,
        "quote": candle,
        "matched": candle is not None,
        "num_candles": len(parsed["candles"]),
        "regular_market_price": meta.get("regularMarketPrice"),
    }


def _looks_naive(text: str) -> bool:
    t = text.strip()
    return not (t.endswith("Z") or "+" in t[10:] or (t[10:].count("-") > 0))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", required=True, help="Yahoo ticker, e.g. AAPL, 2393.TW, 6414.TWO, ^TWII")
    ap.add_argument("--at", required=True, help="target datetime, e.g. '2026-05-07 13:15' or ISO-8601")
    ap.add_argument("--interval", default="1m", help=f"candle interval (default 1m); one of {sorted(VALID_INTERVALS)}")
    ap.add_argument("--mode", default="at_or_before",
                    choices=["at_or_before", "at_or_after", "nearest"],
                    help="how to pick the candle relative to --at")
    ap.add_argument("--tz-offset-hours", type=float, default=None,
                    help="interpret a naive --at in this UTC offset (default: exchange tz)")
    ap.add_argument("--pad-days", type=int, default=2, help="history padding around --at")
    args = ap.parse_args(argv)

    try:
        result = get_quote_at_time(
            args.symbol, args.at, interval=args.interval, mode=args.mode,
            tz_offset_hours=args.tz_offset_hours, pad_days=args.pad_days,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[yahoo_quote] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("matched") else 2


if __name__ == "__main__":
    raise SystemExit(main())
