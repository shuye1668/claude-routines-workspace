#!/usr/bin/env python3
"""Capture everything on a WantGoo page (default: the global markets board).

Produces, in a timestamped output directory:
  - screenshot.png : full-page PNG screenshot (the primary data source)
  - page.html      : the fully-rendered DOM after JS execution
  - text.txt       : the page's visible text (body innerText)
  - tables.json    : every <table> on the page as structured rows
  - data.json      : extracted key/value tiles (index name -> value/change)
  - meta.json      : run metadata (url, timestamp, viewport, sizes, title)

Designed to be called from a Claude Code local routine. It only needs the
target host (``www.wantgoo.com`` by default) to be permitted by the running
environment's network policy. See routines/README.md.

Usage:
  python3 wantgoo_capture.py                       # capture /global
  python3 wantgoo_capture.py --url https://www.wantgoo.com/global
  python3 wantgoo_capture.py --out-dir ./snapshots --label global
  python3 wantgoo_capture.py --url file:///tmp/sample.html   # local test

Exit code 0 on success, non-zero on failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# Allow running both as a module and as a plain script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.browser import launch_kwargs  # noqa: E402

TAIPEI_TZ = timezone(timedelta(hours=8))

DEFAULT_URL = "https://www.wantgoo.com/global"

# JavaScript evaluated in the page to pull structured data out of the DOM.
# Kept dependency-free so it works on any rendered page.
EXTRACT_JS = r"""
() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Every table -> array of rows -> array of cell strings.
  const tables = Array.from(document.querySelectorAll('table')).map((tbl) => {
    const rows = Array.from(tbl.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.innerText))
    );
    return rows.filter((r) => r.some((c) => c.length));
  }).filter((t) => t.length);

  // Heuristic "tiles": elements that look like quote cards. WantGoo renders
  // index quotes as repeated blocks; we grab anything with a numeric-looking
  // value near a label. This is best-effort colour on top of the screenshot.
  const tiles = [];
  const seen = new Set();
  const candidates = Array.from(document.querySelectorAll(
    '[class*="quote"],[class*="index"],[class*="card"],[class*="item"],li,tr'
  ));
  for (const el of candidates) {
    const txt = clean(el.innerText);
    if (!txt || txt.length > 120) continue;
    // must contain at least one number with a decimal or comma
    if (!/[0-9][0-9.,]*\.?[0-9]/.test(txt)) continue;
    if (seen.has(txt)) continue;
    seen.add(txt);
    tiles.push(txt);
    if (tiles.length >= 400) break;
  }

  return {
    title: document.title,
    url: location.href,
    tables,
    tiles,
    text: clean(document.body ? document.body.innerText : ''),
    html: document.documentElement.outerHTML,
  };
}
"""


def capture(
    url: str,
    out_dir: str,
    *,
    viewport_width: int = 1600,
    viewport_height: int = 1200,
    device_scale: float = 2.0,
    timeout_ms: int = 45000,
    wait_selector: str | None = None,
    settle_ms: int = 2500,
    locale: str = "zh-TW",
    tz_id: str = "Asia/Taipei",
) -> dict:
    """Load ``url``, screenshot it full-page, and dump structured data.

    Returns a summary dict (also written to meta.json). Raises on hard failure.
    """
    from playwright.sync_api import sync_playwright

    os.makedirs(out_dir, exist_ok=True)
    started = datetime.now(TAIPEI_TZ)

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs(headless=True))
        context = browser.new_context(
            viewport={"width": viewport_width, "height": viewport_height},
            device_scale_factor=device_scale,
            locale=locale,
            timezone_id=tz_id,
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        try:
            page.goto(url, wait_until="load", timeout=timeout_ms)
            # Give client-side rendering / lazy quotes a moment to populate.
            try:
                page.wait_for_load_state("networkidle", timeout=timeout_ms)
            except Exception:
                pass  # networkidle can time out on pages with live sockets
            if wait_selector:
                page.wait_for_selector(wait_selector, timeout=timeout_ms)
            if settle_ms:
                page.wait_for_timeout(settle_ms)

            data = page.evaluate(EXTRACT_JS)

            shot_path = os.path.join(out_dir, "screenshot.png")
            page.screenshot(path=shot_path, full_page=True)
        finally:
            context.close()
            browser.close()

    # Persist the pulled-apart data next to the screenshot.
    _write(os.path.join(out_dir, "page.html"), data.pop("html", ""))
    _write(os.path.join(out_dir, "text.txt"), data.get("text", ""))
    _write_json(os.path.join(out_dir, "tables.json"), data.get("tables", []))
    _write_json(
        os.path.join(out_dir, "data.json"),
        {"title": data.get("title"), "tiles": data.get("tiles", [])},
    )

    shot_path = os.path.join(out_dir, "screenshot.png")
    summary = {
        "url": data.get("url", url),
        "requested_url": url,
        "title": data.get("title"),
        "captured_at": started.isoformat(),
        "viewport": {"width": viewport_width, "height": viewport_height, "scale": device_scale},
        "screenshot": shot_path,
        "screenshot_bytes": os.path.getsize(shot_path) if os.path.exists(shot_path) else 0,
        "num_tables": len(data.get("tables", [])),
        "num_tiles": len(data.get("tiles", [])),
        "text_chars": len(data.get("text", "")),
        "out_dir": out_dir,
    }
    _write_json(os.path.join(out_dir, "meta.json"), summary)
    return summary


def _write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content or "")


def _write_json(path: str, obj) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _default_out_dir(base: str, label: str) -> str:
    stamp = datetime.now(TAIPEI_TZ).strftime("%Y%m%d_%H%M%S")
    return os.path.join(base, f"{label}_{stamp}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL, help=f"page to capture (default: {DEFAULT_URL})")
    ap.add_argument("--out-dir", default=None, help="exact output directory (overrides --base/--label)")
    ap.add_argument("--base", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"),
                    help="base directory for timestamped runs")
    ap.add_argument("--label", default="wantgoo_global", help="label prefix for the run directory")
    ap.add_argument("--viewport-width", type=int, default=1600)
    ap.add_argument("--viewport-height", type=int, default=1200)
    ap.add_argument("--device-scale", type=float, default=2.0)
    ap.add_argument("--timeout-ms", type=int, default=45000)
    ap.add_argument("--wait-selector", default=None, help="CSS selector to wait for before capture")
    ap.add_argument("--settle-ms", type=int, default=2500, help="extra wait after load for live quotes")
    args = ap.parse_args(argv)

    out_dir = args.out_dir or _default_out_dir(args.base, args.label)
    try:
        summary = capture(
            args.url,
            out_dir,
            viewport_width=args.viewport_width,
            viewport_height=args.viewport_height,
            device_scale=args.device_scale,
            timeout_ms=args.timeout_ms,
            wait_selector=args.wait_selector,
            settle_ms=args.settle_ms,
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the routine
        print(f"[wantgoo_capture] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
