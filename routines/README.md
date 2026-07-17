# Market-data routine tools

Reusable collectors for a **Claude Code local routine**:

| Tool | What it does |
|------|--------------|
| `wantgoo_capture.py` | Loads a WantGoo page (default the **global markets board** `wantgoo.com/global`), takes a **full-page screenshot**, and scrapes the tables / tiles / text / HTML. |
| `yahoo_quote.py` | Fetches a ticker's **OHLCV quote at a specific point in time** from Yahoo Finance (`AAPL`, `2393.TW`, `6414.TWO`, `^TWII`, …). |
| `market_snapshot.py` | One-shot orchestrator: runs both into one dated folder. This is what a routine calls on a schedule. |

The screenshot is the primary data source you asked for: `wantgoo_capture` grabs
the pixels; the routine's Claude can then **`Read` the PNG** to interpret the board
visually. Structured `tables.json` / `text.txt` are saved alongside as a backup.

---

## ⚠️ Prerequisite: network policy must allow the data hosts

Routines run **headless** in an ephemeral cloud container whose outbound access is
governed by the **environment's network policy** (chosen when the environment is
created — see the [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web)).

These tools need two hosts reachable:

- `www.wantgoo.com`
- `query1.finance.yahoo.com` and `query2.finance.yahoo.com`

**In the session where this was built, the policy blocked both (HTTP 403 at the
egress proxy).** The tool logic is fully tested against local fixtures, but to pull
*live* data your routine's environment must run a network policy that permits those
hosts (e.g. a "trusted"/custom-allowlist policy). If a host is blocked, the tool
fails cleanly with a clear message and a non-zero exit code — it never hangs.

> Why not "Claude in Chrome"? That extension is **interactive** and needs your local
> desktop Chrome with you present to approve actions; a headless scheduled routine
> can't drive it, and interactively-authenticated connectors may be dropped in
> cron/headless runs. Headless Chromium via Playwright (used here) is the reliable
> unattended path.

---

## Setup

```bash
pip install -r routines/requirements.txt
```

Do **not** run `playwright install` in the Claude Code web/remote environment — a
Chromium build already ships under `$PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers`)
and `lib/browser.py` points Playwright straight at it. (On a normal machine where
you *have* run `playwright install`, it falls back to Playwright's own browser.)

---

## Usage

### Capture the WantGoo global board
```bash
python3 routines/wantgoo_capture.py                       # -> routines/output/wantgoo_global_<ts>/
python3 routines/wantgoo_capture.py --url https://www.wantgoo.com/global --out-dir ./snap
```
Output folder: `screenshot.png`, `page.html`, `text.txt`, `tables.json`,
`data.json`, `meta.json`.

### Quote at a specific time
```bash
# Latest daily close
python3 routines/yahoo_quote.py --symbol AAPL --at "2026-05-06 16:00" --interval 1d

# Intraday 1-minute quote for a TWSE stock (naive time = exchange local time)
python3 routines/yahoo_quote.py --symbol 2393.TW --at "2026-05-07 13:15" --interval 1m

# Taiwan weighted index, nearest 5-min candle
python3 routines/yahoo_quote.py --symbol '^TWII' --at "2026-05-07 11:00" --interval 5m --mode nearest
```
Key flags: `--interval` (`1m 2m 5m 15m 30m 60m 1h 1d 1wk 1mo` …), `--mode`
(`at_or_before` default | `at_or_after` | `nearest`), `--tz-offset-hours` (force a
timezone for a naive `--at`; default is the exchange's own timezone).

Yahoo limits: 1-minute data only covers ~the last 30 days; other intraday intervals
have limited history windows. For older dates use `--interval 1d`.

Ticker suffixes: TWSE = `.TW` (e.g. `2393.TW`), TPEx = `.TWO` (e.g. `6414.TWO`),
indices start with `^` (`^TWII`, `^SOX`, `^DJI`).

### One-shot snapshot (what the routine runs)
```bash
python3 routines/market_snapshot.py --at "2026-05-07 13:30" --interval 5m \
    --symbols "2393.TW,6414.TWO,^TWII,^SOX"
```
Writes `output/snapshot_<ts>/` with `wantgoo/` + `quotes.json` + `report.json`.
Sources are independent — one blocked source doesn't abort the others; exit is
non-zero only if *everything* failed.

---

## Wiring into a Claude Code local routine

1. **Create/choose an environment** whose network policy allows `wantgoo.com` and
   `finance.yahoo.com` (see prerequisite above), with this repo as a source.
2. **Schedule a routine** (e.g. a cron trigger) with a prompt like:

   > Run `python3 routines/market_snapshot.py --at "now" --interval 5m --symbols "2393.TW,6414.TWO,^TWII,^SOX"`.
   > Then `Read` the `wantgoo/screenshot.png` it produced and summarise the global
   > board (major index moves, notable movers). Combine that with the quotes in
   > `report.json` into a short market note. Commit the snapshot folder if I ask you to.

   Adjust the symbols/interval/time to your targets. Use `--at "13:30"` style times
   for a fixed daily reading, or `"now"` for a live snapshot.

3. The routine's Claude gets the **screenshot as a visual data source** (via `Read`)
   plus machine-readable `tables.json` / `quotes.json` for exact numbers.

---

## Testing

```bash
cd routines
python3 -m unittest discover -s tests -v
```

- `test_yahoo_quote.py` — 22 offline unit tests for datetime parsing, URL building,
  chart parsing (incl. null-candle skipping & Yahoo error payloads), and the
  time-point selection modes. No network needed.
- `test_wantgoo_capture.py` — drives the **real** Playwright + headless Chromium
  stack against a bundled HTML fixture and asserts the screenshot, tables, text and
  HTML are all produced. Proves the capture mechanism works end-to-end without the
  blocked live host.

All 28 tests pass in this environment.
