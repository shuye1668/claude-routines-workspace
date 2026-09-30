#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_routines.py — 由母版 + config 生成四支「美股 Top1 深度分析」routine。

單一來源原則：
  - 共同流程與規則 → routine_美股Top1深度分析_v2_母版.md（含 {{TOKEN}} 佔位）
  - 各指數差異    → routine_indices_config.json
  - 生成          → routine_美股Top1深度分析_{version}_{INDEX}.md（四支）

改規則改母版、改差異改 config，然後執行：
    python3 build_routines.py            # 生成四支
    python3 build_routines.py --check    # 只驗證：生成結果與磁碟現況一致否（CI 用，不寫檔）

TOKEN 一律用雙大括號 {{...}}；routine 內文的單大括號 {Ticker} 等原樣保留。
"""
import json
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
MASTER = ROOT / "routine_美股Top1深度分析_v2_母版.md"
CONFIG = ROOT / "routine_indices_config.json"


def tabs(names):
    """['SPX','NDX'] -> '`SPX_Movers`、`NDX_Movers`'"""
    return "、".join(f"`{n}_Movers`" for n in names)


def render_step0(idx):
    """依 priors 生成完整 Step 0 區塊。"""
    index = idx["index"]
    n = idx["run_order"]
    priors = idx["priors"]
    if not priors:
        return (
            f"## Step 0 重疊檢查（本支 RUN_ORDER = {n}，無前置指數）\n"
            f"本支為管線**第 {n} 支**，前面沒有其他指數可比對，**不做重疊檢查**，直接進 Step 1。\n"
            f"（RUN_ORDER 2–4 的 NDX／SOX／INDU 會反過來比對本支 {index} 的 Rank 1；因此 {index} 的榜單務必先於它們產出。）"
        )
    count = len(priors)
    prior_tabs = tabs(priors)
    prior_names_or = " 或 ".join(priors) if count > 1 else priors[0]
    read_count = f"（{count} 張都要讀）" if count > 1 else ""
    anyone = "任一" if count > 1 else ""
    all_word = "皆" if count > 1 else ""
    multi_hint = (
        f"   - 若同時命中多個前置指數 → 主旨列出全部（例 `[重疊於 SPX/NDX]`）；只命中其一 → 標該指數\n"
        if count > 1 else ""
    )
    note = idx.get("step0_note", "").strip()
    note_block = f"\n\n{note}" if note else ""
    return (
        f"## Step 0 重疊檢查（必做，本支 RUN_ORDER = {n}）\n"
        f"1. 讀 `{index}_Movers` 最新 Date、`Type=Gainer`、`Rank=1`，記下 `top1_ticker`\n"
        f"2. 讀 {prior_tabs} 最新 Date 的 Rank 1 Gainer Ticker{read_count}\n"
        f"3. **若 `top1_ticker` 與{anyone}前置指數（{prior_names_or}）的 Rank 1 相同** → "
        f"**不做深度分析**，建 placeholder draft（主旨加 `[重疊於 {{命中的指數}}]`、收件人 2 人），回報後**終止**\n"
        f"{multi_hint}"
        f"4. 若{all_word}不重疊 → 進 Step 1"
        f"{note_block}"
    )


def render_step0_stream(idx):
    priors = idx["priors"]
    if not priors:
        return f"Step 0 完成：本支為第 {idx['run_order']} 支，無需重疊檢查"
    if len(priors) == 1:
        return f"Step 0 完成：重疊檢查 = {{重疊於 {priors[0]} / 不重疊}}"
    return f"Step 0 完成：重疊檢查 = {{重疊於 XXX / 不重疊}}（已比對 {'、'.join(priors)}）"


def render_step6_overlap(idx):
    priors = idx["priors"]
    if not priors:
        return "無（本支為第 1 支，不做重疊檢查）"
    return f"對 {'、'.join(priors)} 共 {len(priors)} 張"


def render_contract_overlap_tabs(idx):
    priors = idx["priors"]
    if not priors:
        return "（本支為第 1 支，無前置指數，不做重疊檢查）"
    if len(priors) == 1:
        return tabs(priors)
    return f"{tabs(priors)}（{len(priors)} 張前置指數，任一命中即重疊）"


def render_contract_subject_overlap(idx):
    if not idx["priors"]:
        return "（本支為第 1 支，無重疊情境）"
    prefix = f"[{idx['index']}-DEEP-AUTOSEND]"
    return (
        f"`{prefix} {idx['index']} 深度分析：{{Ticker}} {{±pct}}% \\| "
        f"{{trade_date}} [重疊於 {{指數}}]`"
    )


def render_config_summary(idx):
    priors = "、".join(idx["priors"]) if idx["priors"] else "無（第 1 支）"
    return (
        "# 本支設定（由 `routine_indices_config.json` 生成）\n\n"
        "| 項目 | 值 |\n|---|---|\n"
        f"| 指數 | {idx['index']}（{idx['cn']}） |\n"
        f"| 執行順序 | {idx['run_order']}/4 |\n"
        f"| 本指數分頁 | `{idx['index']}_Movers` |\n"
        f"| 重疊比對前置榜 | {priors} |\n"
        f"| 主旨前綴 | `[{idx['index']}-DEEP-AUTOSEND]` |\n"
        f"| Header 產業欄 | {idx['sector_label']}（變數 `{{{idx['sector_var']}}}`） |\n"
    )


def build_one(master, idx, version):
    prefix = f"[{idx['index']}-DEEP-AUTOSEND]"
    banner = (
        "> ⚙️ **本檔為自動生成，請勿手改。** 由 `build_routines.py` 從 "
        "`routine_美股Top1深度分析_v2_母版.md` ＋ `routine_indices_config.json` 生成；"
        "要調規則請改母版或 config 後重跑 `python3 build_routines.py`。"
    )
    repl = {
        "{{GEN_BANNER}}": banner,
        "{{RUN_ORDER_LABEL}}": f"{idx['run_order']}/4",
        "{{SUBJECT_PREFIX}}": prefix,
        "{{ROLE_FOCUS}}": idx["role_focus"],
        "{{CONTRACT_OVERLAP_TABS}}": render_contract_overlap_tabs(idx),
        "{{CONTRACT_SUBJECT_OVERLAP}}": render_contract_subject_overlap(idx),
        "{{STEP0}}": render_step0(idx),
        "{{STEP0_STREAM}}": render_step0_stream(idx),
        "{{STEP6_OVERLAP}}": render_step6_overlap(idx),
        "{{ALLBLACK_NOTE}}": idx.get("allblack_note", ""),
        "{{WH_SEARCH}}": idx["wh_search"],
        "{{ABBREV_LIST}}": idx["abbrev_list"],
        "{{SECTOR_SEARCH}}": idx["sector_search"],
        "{{CROSSBOARD_EXAMPLE}}": idx["crossboard_example"],
        "{{SECTOR_LABEL}}": idx["sector_label"],
        "{{SECTOR_VAR}}": idx["sector_var"],
        "{{PROPER_NOUNS}}": idx["proper_nouns"],
        "{{CONFIG_SUMMARY}}": render_config_summary(idx),
        "{{INDEX}}": idx["index"],  # 放最後，避免與其他 token 內含字互吃
    }
    out = master
    for k, v in repl.items():
        out = out.replace(k, v)
    # 完整性檢查：不得殘留任何未替換 token
    if "{{" in out:
        leftover = out[out.index("{{"): out.index("{{") + 40]
        raise SystemExit(f"[{idx['index']}] 尚有未替換 token：{leftover!r}")
    return out


def main():
    check = "--check" in sys.argv
    master = MASTER.read_text(encoding="utf-8")
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    version = cfg.get("version", "v2.5")
    mismatched = []
    for idx in cfg["indices"]:
        content = build_one(master, idx, version)
        target = ROOT / f"routine_美股Top1深度分析_{version}_{idx['index']}.md"
        if check:
            cur = target.read_text(encoding="utf-8") if target.exists() else None
            status = "OK" if cur == content else "DRIFT"
            if cur != content:
                mismatched.append(target.name)
            print(f"  {status:5} {target.name}")
        else:
            target.write_text(content, encoding="utf-8")
            print(f"  生成 {target.name}（{len(content):,} 字元）")
    if check and mismatched:
        raise SystemExit(f"與磁碟不一致：{mismatched}；請跑 python3 build_routines.py 重新生成後 commit。")
    print("完成。" if not check else "檢查通過：四支與母版一致。")


if __name__ == "__main__":
    main()
