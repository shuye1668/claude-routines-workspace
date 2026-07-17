#!/usr/bin/env python3
"""One-shot market snapshot for a Claude Code local routine.

Runs both data collectors into a single timestamped folder:
  1. Screenshots + scrapes the WantGoo global board  (wantgoo_capture)
  2. Fetches Yahoo Finance quotes for a watchlist at a target time (yahoo_quote)

Each source is independent: if one fails (e.g. host blocked, symbol delisted)
the other still runs and the failure is recorded in report.json. This is what
a routine should invoke on a schedule.

Examples:
  # Snapshot now, default Taiwan-focused watchlist, latest daily quotes
  python3 market_snapshot.py

  # Specific instant + custom watchlist + 5-minute candles
  python3 market_snapshot.py --at "2026-05-07 13:30" --interval 5m \
      --symbols "2393.TW,6414.TWO,^TWII,^SOX"

Output folder contains: wantgoo/ (screenshot.png, tables.json, ...),
quotes.json, report.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wantgoo_capture as wc  # noqa: E402
import yahoo_quote as yq  # noqa: E402

TAIPEI = timezone(timedelta(hours=8))
DEFAULT_WATCHLIST = ["^TWII", "^SOX", "2393.TW", "6414.TWO"]


def run(at: str, interval: str, symbols: list, mode: str, out_dir: str,
        wantgoo_url: str, do_wantgoo: bool = True) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    report = {
        "started_at": datetime.now(TAIPEI).isoformat(),
        "target_time": at,
        "interval": interval,
        "out_dir": out_dir,
        "wantgoo": None,
        "quotes": [],
    }

    # --- WantGoo global board ---
    if do_wantgoo:
        try:
            report["wantgoo"] = {
                "ok": True,
                "summary": wc.capture(wantgoo_url, os.path.join(out_dir, "wantgoo")),
            }
        except Exception as exc:  # noqa: BLE001
            report["wantgoo"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    # --- Yahoo quotes ---
    for sym in symbols:
        entry = {"symbol": sym, "ok": False}
        try:
            entry["result"] = yq.get_quote_at_time(sym, at, interval=interval, mode=mode)
            entry["ok"] = entry["result"].get("matched", False)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"{type(exc).__name__}: {exc}"
        report["quotes"].append(entry)

    with open(os.path.join(out_dir, "quotes.json"), "w", encoding="utf-8") as f:
        json.dump(report["quotes"], f, ensure_ascii=False, indent=2)
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--at", default="now", help="target time ('now' or e.g. '2026-05-07 13:30')")
    ap.add_argument("--interval", default="1d", help="candle interval (default 1d)")
    ap.add_argument("--symbols", default=",".join(DEFAULT_WATCHLIST),
                    help="comma-separated Yahoo tickers")
    ap.add_argument("--mode", default="at_or_before", choices=["at_or_before", "at_or_after", "nearest"])
    ap.add_argument("--wantgoo-url", default=wc.DEFAULT_URL)
    ap.add_argument("--no-wantgoo", action="store_true", help="skip the screenshot step")
    ap.add_argument("--out-base", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    args = ap.parse_args(argv)

    at = args.at
    if at == "now":
        at = datetime.now(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")

    stamp = datetime.now(TAIPEI).strftime("%Y%m%d_%H%M%S")
    out_dir = os.path.join(args.out_base, f"snapshot_{stamp}")
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]

    report = run(at, args.interval, symbols, args.mode, out_dir, args.wantgoo_url,
                 do_wantgoo=not args.no_wantgoo)

    # Console summary
    wg = report["wantgoo"]
    if wg is not None:
        print(f"wantgoo: {'OK' if wg.get('ok') else 'FAIL - ' + wg.get('error', '')}")
    for q in report["quotes"]:
        if q["ok"]:
            c = q["result"]["quote"]
            print(f"  {q['symbol']:<10} {c['datetime']}  close={c['close']}")
        else:
            print(f"  {q['symbol']:<10} FAIL - {q.get('error', 'no match')}")
    print(f"\nsaved -> {out_dir}")

    # Exit non-zero only if EVERYTHING failed (routine can alert on that).
    any_ok = (wg or {}).get("ok") or any(q["ok"] for q in report["quotes"])
    return 0 if any_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
