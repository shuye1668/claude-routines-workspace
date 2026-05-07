#!/usr/bin/env python3
"""Generate Word .docx for 3008 Largan Deep Dive note."""

from docx import Document
from docx.shared import Pt, RGBColor, Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement

OUT = "/home/user/claude-routines-workspace/3008_Largan_DeepDive_2026-05-07.docx"

doc = Document()

# ---- Default font: use a CJK-friendly stack ----
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)
rpr = style.element.get_or_add_rPr()
rfonts = rpr.find(qn("w:rFonts"))
if rfonts is None:
    rfonts = OxmlElement("w:rFonts")
    rpr.append(rfonts)
rfonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
rfonts.set(qn("w:hAnsi"), "Calibri")
rfonts.set(qn("w:ascii"), "Calibri")

# Set default east-asia for headings too
for hname in ["Heading 1", "Heading 2", "Heading 3"]:
    hs = doc.styles[hname]
    hs.font.name = "Calibri"
    hrpr = hs.element.get_or_add_rPr()
    hrfonts = hrpr.find(qn("w:rFonts"))
    if hrfonts is None:
        hrfonts = OxmlElement("w:rFonts")
        hrpr.append(hrfonts)
    hrfonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    hrfonts.set(qn("w:hAnsi"), "Calibri")
    hrfonts.set(qn("w:ascii"), "Calibri")

def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)

def set_para_shading(paragraph, fill):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)

def add_para(text="", bold=False, italic=False, size=None, align=None):
    p = doc.add_paragraph()
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if text:
        run = p.add_run(text)
        run.bold = bold
        run.italic = italic
        if size:
            run.font.size = Pt(size)
    return p

def add_runs(parts, align=None):
    """parts: list of (text, bold)"""
    p = doc.add_paragraph()
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for text, bold in parts:
        r = p.add_run(text)
        r.bold = bold
    return p

def add_h1(text):
    h = doc.add_heading(text, level=1)
    return h

def add_h2(text):
    h = doc.add_heading(text, level=2)
    return h

def add_table(rows, header=True, col_widths=None):
    """rows: list of list of cell strings (or list of (text, bold) for richer cells).
       First row is header if header=True."""
    n_cols = len(rows[0])
    table = doc.add_table(rows=len(rows), cols=n_cols)
    table.style = "Light Grid Accent 1"
    for i, row in enumerate(rows):
        for j, cell_value in enumerate(row):
            cell = table.cell(i, j)
            # clear default paragraph
            cell.text = ""
            p = cell.paragraphs[0]
            if isinstance(cell_value, list):
                # list of (text, bold) tuples
                for text, bold in cell_value:
                    r = p.add_run(text)
                    r.bold = bold
                    if i == 0 and header:
                        r.bold = True
            else:
                r = p.add_run(str(cell_value))
                if i == 0 and header:
                    r.bold = True
        if i == 0 and header:
            for j in range(n_cols):
                set_cell_shading(table.cell(i, j), "D9E2F3")
    return table

def add_bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    r = p.add_run(text)
    return p

def add_bullet_runs(parts):
    p = doc.add_paragraph(style="List Bullet")
    for text, bold in parts:
        r = p.add_run(text)
        r.bold = bold
    return p

def add_numbered(text):
    p = doc.add_paragraph(style="List Number")
    r = p.add_run(text)
    return p

def add_numbered_runs(parts):
    p = doc.add_paragraph(style="List Number")
    for text, bold in parts:
        r = p.add_run(text)
        r.bold = bold
    return p

def hr():
    """Insert horizontal rule using a 1-cell table with bottom border."""
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "999999")
    pBdr.append(bottom)
    pPr.append(pBdr)

# ====== Title ======
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
trun = title.add_run("大立光（3008 TT）— Deep Dive Note")
trun.bold = True
trun.font.size = Pt(20)

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
srun = sub.add_run("TWStock Deep Dive v1.0  |  --深 mode  |  2026-05-07")
srun.italic = True
srun.font.size = Pt(11)
srun.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

# ====== Metadata block ======
meta_table = doc.add_table(rows=8, cols=2)
meta_table.style = "Light Shading Accent 1"
meta_data = [
    ("標的",            "大立光精密 (Largan Precision)"),
    ("代號",            "3008 TT"),
    ("市場別",          "上市 / 電子零組件 / 光學"),
    ("研究日期",        "2026-05-07"),
    ("報告版本",        "TWStock Deep Dive v1.0 (--深 mode)"),
    ("Directional View","CONSTRUCTIVE（看好）"),
    ("整體信心水平",    "中高"),
    ("參考股價 / 市值", "NT$2,520  /  約 NT$3,385 億"),
]
for i, (k, v) in enumerate(meta_data):
    c0 = meta_table.cell(i, 0)
    c1 = meta_table.cell(i, 1)
    c0.text = ""
    c1.text = ""
    r0 = c0.paragraphs[0].add_run(k)
    r0.bold = True
    c1.paragraphs[0].add_run(v)
    set_cell_shading(c0, "F2F2F2")

doc.add_paragraph()  # spacer

# ====== BOTTOM LINE BOX (Page 1, visually prominent) ======
# Use a single-cell table with grey shading for the prominent box
bl_table = doc.add_table(rows=1, cols=1)
bl_table.style = "Table Grid"
bl_cell = bl_table.cell(0, 0)
set_cell_shading(bl_cell, "E7E6E6")
bl_cell.text = ""
# header
p = bl_cell.paragraphs[0]
r = p.add_run("📌 BOTTOM LINE  —  Directional View：CONSTRUCTIVE（看好，conviction 中高）")
r.bold = True
r.font.size = Pt(13)

# body
p2 = bl_cell.add_paragraph()
p2_runs = [
    ("大立光是一檔", False),
    ("敘事剛轉折、籌碼開始換手、但共識尚未追上", True),
    ("的標的。市場仍在用 TTM ROE 3.27% 與「成熟手機鏡頭股」的低期望錨定它的估值；但三個訊號正在同時發生：", False),
]
for text, bold in p2_runs:
    rr = p2.add_run(text)
    rr.bold = bold

# numbered list inside the cell
for idx, (front_bold, body) in enumerate([
    ("CPO/FAU 已被董座林恩平於 4/16 法說會親口定性為「公司第二大業務」",
     "——這從未在過去任何一份大立光 sell-side 報告的估值假設中出現過。"),
    ("史上第二次庫藏股執行中",
     "（上限 1,796.6 億、實際截至 12/31 已買 819 張、19.88 億），林恩平公開表示「PE 在光學股偏低、不該是最差的」——這是內部人定價訊號。"),
    ("4 月月營收 53.62 億、YoY +24.48%（同期新高）",
     "，1-4 月累計 YoY +10.69%；這個加速度與市場對 H2 的保守 guidance 之間存在預期差。"),
], start=1):
    pp = bl_cell.add_paragraph()
    rb = pp.add_run(f"{idx}. ")
    rb.bold = True
    rb2 = pp.add_run(front_bold)
    rb2.bold = True
    pp.add_run(body)

# classification
p3 = bl_cell.add_paragraph()
p3.add_run("分類：").bold = True
p3.add_run("Compounder 在轉型期 + 起漲初期（不是 Value Trap，不是 Cigar Butt）。")

p4 = bl_cell.add_paragraph()
p4.add_run("翻空條件：").bold = True
p4.add_run("5/6 月月營收 YoY 跌回個位數 + CPO 客戶認證未進展 + 庫藏股執行率 <30%。")

p5 = bl_cell.add_paragraph()
p5.add_run("翻多條件：").bold = True
p5.add_run("Q2 EPS 顯著超共識（共識被 Q2 2025 7.64 元低基期錨住）+ FAU 首批客戶名公布。")

doc.add_page_break()

# ====== 區塊 2 ======
add_h1("區塊 2：核心論點（三條，每條都有可驗證指標）")

add_h2("論點 A｜TTM ROE 3.27% 是會計假象，正常化 ROE 接近 18-20%")
for parts in [
    [("BBG 顯示 Q2 2025 EPS 僅 7.64 元、YoY -77%，造成 TTM EPS 被嚴重壓低 → ROE 機械式拖到 3.27%。", False)],
    [("林恩平自己在法說會上承認：Q2 2025 衰退主因是", False), ("匯損", True), ("（一次性業外）。本業毛利率 53.6%、營收年增 6.3% 並無問題。", False)],
    [("若還原 Q2 2025 為正常化 EPS（推估 ~50 元），則 TTM EPS 約 196 元，PE 從 15.8x 降到 12.9x，ROE 還原到 ~16-18% 區間。", False)],
    [("市場共識（Factset）今年 EPS 158-176 元，但已有法人喊上看 200 元", True), ("——共識仍以 Q2 25 低基期作為錨定，這是", False), ("最容易被 Q2 2026 結果打臉", True), ("的盲點。", False)],
    [("可驗證時點", True), ("：8 月 Q2 法說會。BBG consensus 顯示 Q2 2026E EPS 35.01 元（YoY +358%、低基期反彈），任何超過 40 元都將觸發共識上修。", False)],
]:
    add_bullet_runs(parts)

add_h2("論點 B｜CPO/FAU 是被市場零估值的二次成長曲線")
for parts in [
    [("林恩平 4/16 親口：FAU（光纖陣列單元）已是除手機鏡頭外", False), ("排序第二大業務", True), ("，正在送樣認證。", False)],
    [("切入邏輯：FAU 製造痛點是「精密對位」與「dB 損耗控制」——這正是大立光手機鏡頭組裝精度的橫向延伸；連測試與對位設備都在自研（沒有現成設備可買）。", False)],
    [("量產時程：認證後仍需 1-2 年建產能 → 真正貢獻營收要等 ", False), ("2027-2028", True), ("。", False)],
    [("為何重要：CPO 是 AI 伺服器內部光通訊的下一代架構（取代 pluggable optics），台廠目前主要受惠者是上游材料與封裝；FAU 是 light input/output 介面，", False), ("沒有別家台廠在做", True), ("。", False)],
    [("市場零估值證據", True), ("：目前 sell-side 共識完全建立在手機鏡頭模型上，PE 15.8x 沒有反映任何 ASOM（adjacent market）option value。", False)],
    [("可驗證時點", True), ("：法說會 Q&A、CPO 客戶（傳產業界看 Broadcom、NVIDIA 系統商）任何具名認證消息。", False)],
]:
    add_bullet_runs(parts)

add_h2("論點 C｜iPhone 18 規格升級 × 庫藏股 floor：下行有限、上行有題材")
for parts in [
    [("iPhone 18 系列導入", False), ("可變光圈（VCM）+ AI 鏡頭 + 潛望式下放", True), ("，大立光是可變光圈主供（Sunny Optical 為次供）。", False)],
    [("高階 8P/9P 鏡頭佔比上升 → ASP 提升 → 毛利率有從 49% 回升到 52%+ 的空間。", False)],
    [("庫藏股提供下行 floor：公司明確表態認為「PE 不該是光學股最差的」，這是隱性的「公司認為合理估值下限」訊號。上次（2021）執行率僅 ~50%，但", False), ("這一次 12/22 開始僅 9 個工作日就買到 30%+", True), ("，執行強度高於上次。", False)],
    [("可驗證時點", True), ("：5 月 10 日左右 5 月月營收公告 + 庫藏股執行進度週揭露。", False)],
]:
    add_bullet_runs(parts)

# ====== 區塊 3 ======
add_h1("區塊 3：產業鏈定位 × 利潤池故事")

add_table([
    ["項目", "大立光現況", "利潤池流向"],
    ["全球手機鏡頭市佔",
     [("與 Sunny + 玉晶光合計 >65%，大立光仍是", False), ("高階（≥8P）價值占比第一", True)],
     [("利潤池從中低階流向高階；大立光站在", False), ("利潤上升環節", True), ("但", False), ("份額被 Sunny 蠶食", True)]],
    ["iPhone 鏡頭結構",
     "4 月產品組合：1000 萬畫素 50-60%、20MP 10-20%",
     [("仍以中階為主，", False), ("ASP upside 來自 iPhone 18 高階規格", True)]],
    ["AR/VR pancake 鏡頭",
     [("次要供應商", True), ("，2026 才加入 Vision Pro 產線", False)],
     [("玉晶光（3406）才是 Vision Pro / Apple Glasses 主供，大立光此題材", False), ("不是 alpha 主軸", True)]],
    ["CPO/矽光子 FAU",
     "「公司第二大業務」、認證中、自研設備",
     [("新利潤池、台廠唯一切入者", True), ("；2027-28 兌現", False)]],
    ["車用鏡頭",
     "次要、未拆分",
     "利潤偏低、不影響估值"],
])

p = doc.add_paragraph()
p.add_run("結論：").bold = True
p.add_run("大立光在手機鏡頭內部的份額正被 Sunny 侵蝕（這是市場已知的 bear narrative），但市場")
p.add_run("尚未消化").bold = True
p.add_run(" CPO/FAU 帶來的全新利潤池。AR/VR 不是它的故事，那是玉晶光的。")

# ====== 區塊 4 ======
add_h1("區塊 4：「被低估 / 剛起漲」訊號評分")

add_h2("五種錯位")
add_table([
    ["錯位類型", "是否成立", "證據"],
    ["預期錯位", "✓", "法人喊 EPS 200，共識 158-176，差距 15-25%"],
    ["時序錯位", "✓", "月營收 YoY 由 -7%（Q3 25）→+6.6%（Q1 26）→+24%（4 月）加速；股價反跌破 5/20MA"],
    ["結構錯位", "✓", "CPO/FAU 已是第二大業務，市場仍用 100% 手機鏡頭模型估值"],
    ["籌碼錯位", "△", "外資 60 日 +10,910 張、20 日 +10,103 張（集中近一個月）；投信 20 日仍賣超 -2,987 張 → 外資先動、投信尚未認養"],
    ["敘事錯位", "✓", "從「成熟手機鏡頭」→「CPO 概念股」（經濟日報、TechNews、DIGITIMES 連發）"],
])

add_h2("三種 inflection 評分")
add_table([
    ["維度", "分數", "依據"],
    ["基本面 inflection", [("2/3", True)], "月營收 YoY 由負轉正並加速 ✓；毛利率 Q4 48% → Q1 49.4% 微升；guidance 仍偏保守（Q2 內部說 4/5 月逐月低）"],
    ["籌碼 inflection",   [("2/3", True)], "庫藏股=內部人增持 ✓；外資 60 日大買 ✓；投信尚未認養（-）"],
    ["敘事 inflection",   [("2/3", True)], "CPO 新題材外資首發報告 ✓；iPhone 18 可變光圈題材 ✓；ETF 變化未驗證"],
])

p = doc.add_paragraph()
r = p.add_run("合計 6/9 → 強烈起漲訊號")
r.bold = True
r.font.size = Pt(13)

# ====== 區塊 5 ======
add_h1("區塊 5：反向 DCF / 預期差")

add_h2("現價隱含的市場假設（從 EV/EBITDA 反推）")
for parts in [
    [("市值 3,385 億 - 淨現金 1,360 億 = ", False), ("EV 約 2,025 億", True)],
    [("TTM EBITDA（Q2 25 至 Q1 26 加總）≈ 314 億 → ", False), ("EV/EBITDA 6.5x", True)],
    [("這個倍數隱含「", False), ("EBITDA 持平、無新業務、無 ASP upside", True), ("」", False)],
]:
    add_bullet_runs(parts)

add_h2("還原的合理假設")
for parts in [
    [("若 Q2 25 一次性匯損還原 → 正常化 EBITDA 約 350-380 億", False)],
    [("對應 EV/EBITDA 約 5.3-5.8x → ", False), ("比現在的 6.5x 還便宜", True)],
    [("歷史區間：高峰 15-20x（2017）、低谷 5-7x，目前在歷史低段", False)],
]:
    add_bullet_runs(parts)

add_h2("第二層思考（Howard Marks 框架）")
add_table([
    ["場景", "共識正確：手機鏡頭穩定衰退", "我的看法：CPO + iPhone 18 兌現"],
    ["12M EPS", "150 元", "200 元"],
    ["給予 PE", "13-14x", "17-18x"],
    ["目標價區間", [("1,950 - 2,100", True)], [("3,400 - 3,600", True)]],
    ["距現價", "-22% to -17%", "+35% to +43%"],
])

p = doc.add_paragraph()
p.add_run("非對稱性：").bold = True
p.add_run("上行 +35% / 下行 -20%，但")
p.add_run("庫藏股 floor 進一步壓縮下行").bold = True
p.add_run("——林恩平已明示 PE 不該是光學股最差，意味公司願在更低價位買回，floor 接近 2,300-2,400 區間。")
p.add_run("有效非對稱性 ≈ +35% / -10%").bold = True
p.add_run("，比例 ")
p.add_run("3.5 : 1 偏正").bold = True
p.add_run("。")

# ====== 區塊 6 ======
add_h1("區塊 6：Peer Comp（深版補強）")
add_table([
    ["比較項", "大立光 3008", "舜宇光學 2382 HK", "玉晶光 3406"],
    ["在 Apple 高階手機鏡頭份額", [("主供", True), ("（份額流失中）", False)], "次供（份額上升中）", "次供"],
    ["iPhone 18 可變光圈", [("主供", True)], "第二供", "未明"],
    ["Apple Vision Pro / Glasses pancake", "2026 才入線、次要", "—", [("主供", True), ("（黑馬）", False)]],
    ["CPO/FAU", [("唯一切入者", True), ("、第二大業務", False)], "也在做 FAU、進度未明", "未涉入"],
    ["TTM 毛利率", "49.4%", "~17%（業務組合不同）", "~36%"],
    ["TTM PE", "15.8x（含匯損低基期）", "~28x（HK 上市）", "~22x"],
    ["淨現金 / 市值", [("40%+", True), ("（極高）", False)], "~10%", "~25%"],
    ["Narrative 標籤", "CPO 新題材未 priced in", "手機 Apple 訂單上升 priced in", "AR/VR Apple Glasses priced in"],
])

p = doc.add_paragraph()
p.add_run("結論：").bold = True
p.add_run("在三家光學雙雄中，大立光是")
p.add_run("唯一同時擁有「庫藏股 floor」+「CPO option」+「iPhone 18 主供」+「估值在歷史低段」的組合").bold = True
p.add_run("。Sunny 與玉晶光的 narrative 已大幅 priced in，大立光是最不擁擠的選擇。")

# ====== 區塊 7 ======
add_h1("區塊 7：Bear Case（有實質訊號才寫）")

p = doc.add_paragraph()
r = p.add_run("真實的下行風險（非空泛）：")
r.bold = True

bear_cases = [
    [("Sunny Optical 在 iPhone 訂單份額持續上升", True), ("（Ming-Chi Kuo 4 月明確指出舜宇光學受惠未來兩年 Apple 訂單成長與規格升級）—— 大立光的「iPhone 18 主供」可能在 iPhone 19 變成 50/50。", False)],
    [("記憶體漲價 → 手機 OEM 規格降級", True), ("：林恩平自己提到「部分品牌客戶開始出現規格降級或暫停升級」——若這擴大，可變光圈滲透率不如預期。", False)],
    [("CPO/FAU 量產延遲", True), ("：認證 + 自研設備兩個變數，1-2 年是樂觀情境。任何延遲消息將擊穿題材敘事。", False)],
    [("5 月、6 月月營收不及預期", True), ("：林恩平自己 guidance 4 月 < 3 月、5 月 < 4 月。若 5 月 YoY 跌破 +10%，成長加速論破功。", False)],
    [("短線技術面已破位", True), ("：股價 2,520 已跌破 5MA(2,550) 與 20MA(2,555)，價/MA20 -1.38%。在等基本面催化劑前，可能再測 60MA(2,378) 或庫藏股區間。", False)],
]
for parts in bear_cases:
    add_numbered_runs(parts)

# ====== 區塊 8 ======
add_h1("區塊 8：查證透明度與待追蹤")

add_h2("搜尋次數")
add_para("MCP 嘗試 3 次（Quartr/FMP 訂閱不足，全失敗）+ Web search 12 次 + Bloomberg 用戶提供 1 套（Q4 2016-Q1 2026 完整 quarterly + Q2/Q3 2026 estimates）= 共 16 次")

add_h2("主要資料來源")
for s in [
    "Bloomberg Terminal（用戶提供，2026/05/07）— Q1 2026 與歷史財報基底",
    "經濟日報、工商時報、中央社、鉅亨網、TechNews — 4/16 法說會 + 庫藏股 + 月營收",
    "DIGITIMES — Largan / Sunny FAU 比較",
    "Ming-Chi Kuo Medium — Sunny 訂單成長",
    "用戶提供截圖 — 籌碼快照（外資/投信/集保/PE/ROE）",
]:
    add_bullet(s)

add_h2("未能查證項目（標明）")
for s in [
    "借券賣出餘額具體數字（影響「軋空」訊號評分）",
    "大立光在 0050 / 主流 ETF 中的精確權重",
    "CPO/FAU 的具體客戶名稱（公司未揭露）",
    "4 月月營收 +24% 中，iPhone 17 vs iPhone 18 規格升級的拆分",
    "Q2 2025 匯損的精確金額（用 EPS 反推為 ~30-35 億 NTD）",
]:
    add_bullet(s)

add_h2("整體信心水平：中高")
for parts in [
    [("高信心", True), ("：CPO/FAU 是公司第二大業務、庫藏股執行、4 月營收加速、共識 EPS 區間", False)],
    [("中信心", True), ("：iPhone 18 大立光主供份額穩定（vs Sunny 滲透）", False)],
    [("低信心", True), ("：CPO 量產時點、客戶名單", False)],
]:
    add_bullet_runs(parts)

add_h2("接下來 1-3 個月關鍵 3 個指標（按重要性排序）")
for parts in [
    [("5 月月營收（6/10 前公告）", True), ("：YoY 是否 ≥ +15%（Q1 +6.6%、4 月 +24%，5 月維持 >15% 即確認加速持續）", False)],
    [("8 月 Q2 2026 法說會 EPS", True), ("：是否顯著超 BBG consensus 的 35.01 元（任何 ≥45 元 = 共識被迫上修）", False)],
    [("庫藏股執行率突破 50%", True), ("：截至 1/8 已 30%+，若 5 月底前突破 50% 即代表公司認為 2,500 以下是合理回購區", False)],
]:
    add_numbered_runs(parts)

# ====== 最終 PM 一句話 ======
add_h1("最終 PM 一句話")

pm_table = doc.add_table(rows=1, cols=1)
pm_table.style = "Table Grid"
pmcell = pm_table.cell(0, 0)
set_cell_shading(pmcell, "FFF2CC")
pmcell.text = ""
pp = pmcell.paragraphs[0]
pp.add_run("大立光不是「光學產業衰退故事」，是「")
r = pp.add_run("手機鏡頭 stable cash flow + CPO option + 庫藏股 floor")
r.bold = True
pp.add_run("」的三軌組合，目前股價只 priced in 第一軌。風報比 3.5:1 偏正，建議")
r2 = pp.add_run("列入主動追蹤、Q2 法說會前建立 1/3 部位")
r2.bold = True
pp.add_run("（不建議在 5 月月營收公告前 all-in，先讓基本面驗證一次）。")

# ====== Sources ======
add_h1("資料來源 / Sources")
sources = [
    "大立光成CPO概念股？為何切入矽光子FAU？林恩平親解 — 經濟日報",
    "  https://money.udn.com/money/story/5612/9460891",
    "2026/04/16 大立光(3008.TW)法說會：毛利跌破5成，CPO新動能布局啟動 — vocus",
    "  https://vocus.cc/article/69e60f73fd89780001ce9b37",
    "大立光攻 CPO，林恩平：準備送樣、量產需一兩年 — TechNews",
    "  https://technews.tw/2026/04/16/largan-precision-targets-cpo-samples-ready-mass-production-1-2-years/",
    "大立光揭密矽光子 林恩平：FAU躍居公司發展第二大業務 — 旺得富/中時",
    "  https://wantrich.chinatimes.com/news/20260416900651-420101",
    "Largan, Sunny Optical target FAU in push toward CPO and AI optics — DIGITIMES",
    "  https://www.digitimes.com/news/a20260423PD227/sunny-optical-optics-largan-precision-cpo-smartphone.html",
    "大立光擬買回2670張庫藏股 總金額上限1796億創新高 — 中央社 CNA",
    "  https://www.cna.com.tw/news/afe/202512190205.aspx",
    "大立光累計買回近20億元庫藏股 — Yahoo 股市",
    "大立光4月營收53.62億元年增24% — CMoney",
    "  https://cmnews.com.tw/article/newsyoudeservetoknow-14e419af-486b-11f1-9cc2-b417ba626102",
    "Sunny Optical to Benefit Significantly from Apple's Optical Order Growth — Ming-Chi Kuo",
    "  https://medium.com/@mingchikuo/sunny-optical-to-benefit-significantly-from-apples-optical-order-growth-and-spec-upgrades-over-220ec84343ad",
    "大立光(3008) 搭上iPhone 18可變光圈與AI鏡頭利多，法人預期全年EPS上看200元 — CMoney",
    "  https://cmnews.com.tw/notes/note-detail.aspx?nid=1176753",
    "大立光Q2獲利大減84%「EPS僅7.73元」 林恩平認：匯損影響大 — ETtoday",
    "  https://finance.ettoday.net/news/2993941",
    "11家台廠入列Vision Pro供應鏈 — 鏡週刊",
    "  https://www.mirrormedia.mg/story/20230630money003",
]
for s in sources:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    if s.startswith("  "):
        r = p.add_run(s.strip())
        r.italic = True
        r.font.size = Pt(9)
        r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    else:
        p.add_run(s)

# Disclaimer
hr()
disclaimer = doc.add_paragraph()
disclaimer.alignment = WD_ALIGN_PARAGRAPH.CENTER
dr = disclaimer.add_run("本報告為研究分析，不構成投資建議。所有判斷均標明信心水平，數據來源已明列。")
dr.italic = True
dr.font.size = Pt(9)
dr.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

doc.save(OUT)
print(f"OK: {OUT}")
import os
print(f"Size: {os.path.getsize(OUT)} bytes")
