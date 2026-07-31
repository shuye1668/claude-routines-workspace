# TOEFL TPO Writing — scraper + latest tasks (TPO 66–75)

爬取 **TOEFL Practice Online (TPO) 寫作題** 完整內容的工具與資料。
Tooling and data for the complete content of **TOEFL Practice Online (TPO) writing** tasks.

Each TPO writing section has two tasks:

- **Task 1 — Integrated Writing (綜合寫作):** a reading passage + a lecture that responds to it + the prompt.
- **Task 2 — Independent Writing (獨立寫作):** an agree/disagree or preference essay prompt. *(The live TOEFL replaced this with "Writing for an Academic Discussion" in July 2023; the numbered TPO sets still use the Independent task.)*

## Contents

| File | What it is |
|------|-----------|
| `TPO66-75_Writing_Tasks.md` | **Human-readable reference** for the 10 latest TPO sets (66–75): exact prompts + task topics, TPO 75 with full reading/lecture summaries. |
| `data/tpo_writing_latest.json` | **Machine-readable** version of the same, with per-field provenance/confidence flags. |
| `tpo_writing_scraper.py` | **Runnable scraper** (stdlib-only) that pulls complete TPO writing content into JSON + Markdown. Includes an offline `--demo` mode. |

## Quick start

```bash
# Offline — render the bundled verified dataset (TPO 66–75) to Markdown + JSON:
python3 tpo_writing_scraper.py --demo --out out/

# Online — scrape a range from 小站托福 (top.zhan.com):
python3 tpo_writing_scraper.py --source zhan --tpo 66-75 --out out/

# A single TPO:
python3 tpo_writing_scraper.py --source zhan --tpo 75 --out out/
```

Requires Python 3.9+. No third-party packages.

## ⚠️ Important: network policy in this environment

The sites that host the **full verbatim** TPO writing text — `top.zhan.com` (小站),
`lingoleap.ai`, `ets.org`, `kmf.com` — are **blocked by this workspace's outbound
network policy** (every request is refused with `HTTP 403` at the proxy CONNECT
stage; only `github.com` / package registries are reachable). So this repo was
built as follows:

- **Prompts & topics** (in the `.md` / `.json`) were verified from public prep-site
  pages via web search. **Prompt wording is verbatim**; reading/lecture bodies are
  **summaries** (TPO 75 has full summaries; others have prompts only).
- **Full verbatim reading passages + lecture transcripts** must be pulled with
  `tpo_writing_scraper.py` **from a machine with unrestricted internet**. Running
  it here fails fast with a clear 403 message and points you to `--demo`.

## How the scraper works

The network extractor is modeled on a **verified** 小站托福 reading crawler
([`Jason-Chen-07/Toefl-IBT-readingTPO-crawler`](https://github.com/Jason-Chen-07/Toefl-IBT-readingTPO-crawler)):
小站 embeds each passage/lecture as HTML in the page, extracted with a
`fetch → regex → clean_html_text` pipeline. The writing section (`/toefl/write/`)
reuses the same page template. The writing-specific URLs/selectors are grouped in
the `ZHAN_WRITING` dict at the top of the script — **that is the one place to
re-verify against a live writing page** if 小站 changes its markup (the reading
template was verified; the writing selectors are inherited and marked as such in
the code).

### Getting the new "Academic Discussion" prompts

Prep sites publish the post-2023 *Writing for an Academic Discussion* items as a
separate series (professor question + two student posts). The scraper's
`IndependentTask` model already carries a `student_posts` list and an
`academic_discussion` type; point a source adapter at those pages to populate it.

## Sources

- `lingoleap.ai` — per-task TPO writing sample pages (prompt text is verbatim in the URLs/titles).
- `curio.classicenglish.com.tw` — 英漢對照 integrated-writing analyses (e.g. TPO-075 Northern Pacific Sea Stars).
- `top.zhan.com` / `toefl.zhan.com` (小站托福) — full TPO writing bank (blocked here).
- `ets.org/s/toefl/free-practice/writing.html` — official format reference.

## Legal / usage note

TPO items are ETS copyrighted material redistributed by third-party prep sites.
This repo stores prompts and topic summaries for study/reference and provides
tooling to fetch full text for personal practice; respect ETS's terms and each
source site's terms when running the scraper.
