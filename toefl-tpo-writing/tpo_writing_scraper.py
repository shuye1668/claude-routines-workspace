#!/usr/bin/env python3
"""
TOEFL TPO Writing scraper.

Fetches the *complete* content of TOEFL Practice Online (TPO) writing tasks —
Task 1 (Integrated Writing: reading passage + lecture transcript + prompt) and
Task 2 (Independent Writing / Academic Discussion prompt) — and writes them out
as structured JSON plus human-readable Markdown, one file per TPO.

Design notes
------------
* Standard library only (urllib, re, json, argparse) — no third-party deps, so
  it runs anywhere Python 3.9+ is installed.
* The network extractor is modeled on a *verified* 小站托福 (top.zhan.com) reading
  crawler (Jason-Chen-07/Toefl-IBT-readingTPO-crawler): the site embeds each
  passage/lecture as HTML inside the page, which is extracted with the same
  fetch + regex + clean_html_text pipeline. The writing section uses the same
  CMS; the writing-specific URLs/selectors are grouped in ZHAN_WRITING and are
  the only thing to re-verify against a live page if the site markup changes.
* IMPORTANT: top.zhan.com / lingoleap / ETS are blocked by some sandboxed
  network policies (egress allowlists). If every fetch fails with HTTP 403 at
  the CONNECT stage, you are behind such a policy — run this from an
  unrestricted network. Use `--demo` to emit output from the bundled dataset
  without any network access.

Usage
-----
    # Offline: render the bundled verified dataset (TPO 66-75) to Markdown+JSON
    python3 tpo_writing_scraper.py --demo --out out/

    # Online: scrape a range of TPO writing sets from 小站 into out/
    python3 tpo_writing_scraper.py --source zhan --tpo 66-75 --out out/

    # Online: a single TPO
    python3 tpo_writing_scraper.py --source zhan --tpo 75 --out out/
"""
from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
from dataclasses import dataclass, field, asdict
from html import unescape
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
BUNDLED_DATA = HERE / "data" / "tpo_writing_latest.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #
@dataclass
class IntegratedTask:
    prompt: str = ""
    topic: Optional[str] = None
    reading_passage: Optional[str] = None
    lecture_transcript: Optional[str] = None
    reading_summary: Optional[str] = None
    lecture_summary: Optional[str] = None


@dataclass
class IndependentTask:
    type: str = "unknown"          # agree_disagree | preference | academic_discussion
    prompt: Optional[str] = None
    student_posts: list = field(default_factory=list)  # for academic-discussion tasks


@dataclass
class TpoWriting:
    tpo: int
    integrated_writing: IntegratedTask
    independent_writing: IndependentTask
    source: str = ""


# --------------------------------------------------------------------------- #
# HTML helpers (ported from the verified reading crawler)
# --------------------------------------------------------------------------- #
class CrawlError(RuntimeError):
    pass


def fetch_text(url: str, timeout: int = 30, retries: int = 3) -> str:
    last_error: Optional[Exception] = None
    ctx = ssl.create_default_context()
    for attempt in range(1, retries + 1):
        req = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
            },
        )
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except HTTPError as exc:
            # 403 at this stage on a sandbox usually means the host is blocked
            # by an egress policy rather than a real Forbidden from the site.
            raise CrawlError(
                f"HTTP {exc.code} for {url}. If this is 403 on every host, your "
                f"network policy is blocking the source site — use --demo or run "
                f"from an unrestricted network."
            ) from exc
        except (URLError, TimeoutError) as exc:
            last_error = exc
            if attempt == retries:
                break
            time.sleep(min(2 * attempt, 5))
    reason = getattr(last_error, "reason", str(last_error))
    raise CrawlError(f"Network error for {url}: {reason}")


def clean_html_text(html: str, preserve_breaks: bool = False) -> str:
    text = html
    text = re.sub(r"<br\s*/?>", "\n" if preserve_breaks else " ", text, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<img[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --------------------------------------------------------------------------- #
# 小站托福 (top.zhan.com) writing source
# --------------------------------------------------------------------------- #
# The reading crawler proved these mechanics against /toefl/read/. The writing
# section (综合写作 = integrated, 独立写作 = independent) lives under /toefl/write/
# using the same page template. Selectors below mirror the reading ones and are
# the single place to re-verify if 小站 changes its markup.
ZHAN_WRITING = {
    "integrated_index": "https://top.zhan.com/toefl/write/alltpo.html",
    "integrated_page": "https://top.zhan.com/toefl/write/alltpo{number}.html",
    # A per-task detail page embeds the reading passage, the lecture transcript
    # and the prompt. On the reading side the body sits inside <div class="article">…
    # </div>; the writing template reuses the same container names.
    "reading_container": r'<div class="article">([\s\S]*?)</div>',
    "lecture_container": r'<div class="listening[^"]*">([\s\S]*?)</div>',
    "prompt_container": r'<div class="q_tit[^"]*">([\s\S]*?)</div>',
    "detail_url": r'https://top\.zhan\.com/toefl/write/practicereview-\d+[\d-]*\.html',
}


def scrape_zhan_tpo(number: int) -> TpoWriting:
    """
    Best-effort scrape of one TPO writing set from 小站托福.

    Modeled on the verified reading crawler. Because the live writing pages could
    not be reached from the authoring sandbox (egress-blocked), the container
    selectors are inherited from the reading template; validate them against a
    live page and adjust ZHAN_WRITING if extraction returns empty bodies.
    """
    page = fetch_text(ZHAN_WRITING["integrated_page"].format(number=number))
    detail_urls = list(dict.fromkeys(re.findall(ZHAN_WRITING["detail_url"], page)))
    if not detail_urls:
        raise CrawlError(
            f"No writing detail pages found for TPO {number}. The writing markup "
            f"likely differs from the reading template — inspect a live "
            f"{ZHAN_WRITING['integrated_page'].format(number=number)} and update "
            f"ZHAN_WRITING selectors."
        )

    integrated = IntegratedTask()
    independent = IndependentTask()

    for url in detail_urls:
        html = fetch_text(url)
        rd = re.search(ZHAN_WRITING["reading_container"], html)
        lc = re.search(ZHAN_WRITING["lecture_container"], html)
        pr = re.search(ZHAN_WRITING["prompt_container"], html)
        if rd and lc:  # an integrated task page has both a passage and a lecture
            integrated.reading_passage = clean_html_text(rd.group(1), preserve_breaks=True)
            integrated.lecture_transcript = clean_html_text(lc.group(1), preserve_breaks=True)
            if pr:
                integrated.prompt = clean_html_text(pr.group(1))
        elif pr:  # an independent task page has only a prompt
            independent.prompt = clean_html_text(pr.group(1))
            independent.type = _classify_independent(independent.prompt)

    return TpoWriting(
        tpo=number,
        integrated_writing=integrated,
        independent_writing=independent,
        source=ZHAN_WRITING["integrated_page"].format(number=number),
    )


def _classify_independent(prompt: str) -> str:
    p = (prompt or "").lower()
    if "professor" in p and ("discussion" in p or "post" in p):
        return "academic_discussion"
    if "prefer" in p or "which view" in p:
        return "preference"
    if "agree or disagree" in p or "agree with" in p:
        return "agree_disagree"
    return "unknown"


# --------------------------------------------------------------------------- #
# Bundled dataset (offline / --demo)
# --------------------------------------------------------------------------- #
def load_bundled() -> list[TpoWriting]:
    raw = json.loads(BUNDLED_DATA.read_text(encoding="utf-8"))
    out: list[TpoWriting] = []
    for t in raw["tasks"]:
        iw = t.get("integrated_writing") or {}
        idp = t.get("independent_writing") or {}
        out.append(
            TpoWriting(
                tpo=t["tpo"],
                integrated_writing=IntegratedTask(
                    prompt=iw.get("prompt", "") or "",
                    topic=iw.get("topic"),
                    reading_passage=iw.get("reading_passage"),
                    lecture_transcript=iw.get("lecture_transcript"),
                    reading_summary=iw.get("reading_summary"),
                    lecture_summary=iw.get("lecture_summary"),
                ),
                independent_writing=IndependentTask(
                    type=idp.get("type", "unknown"),
                    prompt=idp.get("prompt"),
                ),
                source="bundled:data/tpo_writing_latest.json",
            )
        )
    return out


# --------------------------------------------------------------------------- #
# Output writers
# --------------------------------------------------------------------------- #
def to_markdown(t: TpoWriting) -> str:
    iw, idp = t.integrated_writing, t.independent_writing
    lines = [f"# TOEFL TPO {t.tpo} — Writing\n"]

    lines.append("## Task 1 — Integrated Writing\n")
    if iw.topic:
        lines.append(f"**Topic:** {iw.topic}\n")
    if iw.reading_passage:
        lines.append("### Reading passage\n")
        lines.append(iw.reading_passage + "\n")
    elif iw.reading_summary:
        lines.append("### Reading passage (summary)\n")
        lines.append(iw.reading_summary + "\n")
    if iw.lecture_transcript:
        lines.append("### Lecture\n")
        lines.append(iw.lecture_transcript + "\n")
    elif iw.lecture_summary:
        lines.append("### Lecture (summary)\n")
        lines.append(iw.lecture_summary + "\n")
    lines.append("### Prompt\n")
    lines.append((iw.prompt or "_not retrieved_") + "\n")

    lines.append("## Task 2 — Independent Writing\n")
    lines.append(f"_Type: {idp.type}_\n")
    lines.append((idp.prompt or "_not retrieved_") + "\n")

    if t.source:
        lines.append(f"---\n\n_Source: {t.source}_\n")
    return "\n".join(lines)


def write_outputs(tasks: list[TpoWriting], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    combined = []
    for t in tasks:
        (out_dir / f"tpo{t.tpo}_writing.md").write_text(to_markdown(t), encoding="utf-8")
        combined.append(asdict(t))
    (out_dir / "tpo_writing.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {len(tasks)} TPO writing set(s) + tpo_writing.json to {out_dir}/")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def parse_tpo_range(spec: str) -> list[int]:
    nums: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            nums.extend(range(int(a), int(b) + 1))
        elif part:
            nums.append(int(part))
    return sorted(set(nums))


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Scrape TOEFL TPO writing tasks.")
    ap.add_argument("--source", choices=["zhan"], default="zhan",
                    help="Live source to scrape (default: zhan = 小站托福).")
    ap.add_argument("--tpo", default="66-75",
                    help="TPO number(s), e.g. '75' or '66-75' or '70,72,75'.")
    ap.add_argument("--out", default="out", help="Output directory.")
    ap.add_argument("--demo", action="store_true",
                    help="Render the bundled verified dataset without any network access.")
    args = ap.parse_args(argv)

    out_dir = Path(args.out)

    if args.demo:
        tasks = load_bundled()
        write_outputs(tasks, out_dir)
        return 0

    numbers = parse_tpo_range(args.tpo)
    tasks: list[TpoWriting] = []
    failures: list[str] = []
    for n in numbers:
        try:
            print(f"Scraping TPO {n} …", file=sys.stderr)
            tasks.append(scrape_zhan_tpo(n))
        except CrawlError as exc:
            failures.append(f"TPO {n}: {exc}")
            print(f"  ! {exc}", file=sys.stderr)

    if tasks:
        write_outputs(tasks, out_dir)
    if failures:
        print("\nSome TPOs failed:", file=sys.stderr)
        for f in failures:
            print("  - " + f, file=sys.stderr)
        if not tasks:
            print("\nAll fetches failed. If these are HTTP 403 CONNECT errors, the "
                  "source host is blocked by your network policy — use --demo or run "
                  "from an unrestricted network.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
