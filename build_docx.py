#!/usr/bin/env python3
"""Generate Word docx from the 2393 Deep Dive analysis."""
from docx import Document
from docx.shared import Pt, RGBColor, Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement

OUT = "/home/user/claude-routines-workspace/2393_Everlight_DeepDive_2026-05-07.docx"

doc = Document()

# ---- Set default font to a CJK-friendly stack ----
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(10.5)
rpr = style.element.get_or_add_rPr()
rfonts = rpr.find(qn("w:rFonts"))
if rfonts is None:
    rfonts = OxmlElement("w:rFonts")
    rpr.append(rfonts)
rfonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
rfonts.set(qn("w:ascii"), "Calibri")
rfonts.set(qn("w:hAnsi"), "Calibri")

# Heading styles - apply CJK font as well
for h_name in ("Heading 1", "Heading 2", "Heading 3", "Title"):
    s = doc.styles[h_name]
    rpr = s.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:eastAsia"), "Microsoft JhengHei")
    rf.set(qn("w:ascii"), "Calibri")
    rf.set(qn("w:hAnsi"), "Calibri")

def set_cell_shading(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex)
    tcPr.append(shd)

def add_para(text, bold=False, italic=False, size=10.5, color=None, align=None, style=None):
    p = doc.add_paragraph(style=style)
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    if color:
        run.font.color.rgb = RGBColor(*color)
    return p

def add_bullet(text, bold_lead=None):
    p = doc.add_paragraph(style="List Bullet")
    if bold_lead:
        r = p.add_run(bold_lead)
        r.bold = True
    p.add_run(text)
    return p

def add_rich_bullet(segments):
    """segments = list of (text, bold_bool)"""
    p = doc.add_paragraph(style="List Bullet")
    for text, bold in segments:
        run = p.add_run(text)
        run.bold = bold
    return p

def add_numbered(text):
    return doc.add_paragraph(text, style="List Number")

def add_table(headers, rows, header_fill="305496", first_col_bold=False):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Light Grid Accent 1"
    table.autofit = True

    # Header row
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        para = hdr[i].paragraphs[0]
        run = para.add_run(h)
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.size = Pt(10)
        set_cell_shading(hdr[i], header_fill)
        hdr[i].vertical_alignment = WD_ALIGN_VERTICAL.CENTER

    # Body
    for r_idx, row in enumerate(rows):
        cells = table.rows[r_idx + 1].cells
        for c_idx, val in enumerate(row):
            cells[c_idx].text = ""
            para = cells[c_idx].paragraphs[0]
            run = para.add_run(str(val))
            run.font.size = Pt(9.5)
            if first_col_bold and c_idx == 0:
                run.bold = True
            cells[c_idx].vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    return table

# ============================================================
# TITLE PAGE
# ============================================================
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
trun = title.add_run("$2393 億光電子（Everlight Electronics）")
trun.bold = True
trun.font.size = Pt(20)
trun.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
srun = sub.add_run("Deep Dive Research Note")
srun.italic = True
srun.font.size = Pt(13)
srun.font.color.rgb = RGBColor(0x59, 0x59, 0x59)

doc.add_paragraph()

# ---- METADATA BOX ----
meta_table = doc.add_table(rows=4, cols=2)
meta_table.style = "Light Shading Accent 1"
meta_data = [
    ("標的", "2393 億光電子 (Everlight Electronics Co., Ltd.)"),
    ("研究日期", "2026-05-07"),
    ("研究框架", "TWStock Deep Dive v1.0（--深版本）"),
    ("整體信度", "中高"),
]
for i, (k, v) in enumerate(meta_data):
    c0, c1 = meta_table.rows[i].cells
    c0.text = ""
    p0 = c0.paragraphs[0]
    r0 = p0.add_run(k)
    r0.bold = True
    r0.font.size = Pt(10)
    set_cell_shading(c0, "DDEBF7")
    c1.text = ""
    p1 = c1.paragraphs[0]
    r1 = p1.add_run(v)
    r1.font.size = Pt(10)

doc.add_paragraph()

# ============================================================
# 區塊 1：BOTTOM LINE — gray-shaded callout box
# ============================================================
doc.add_heading("區塊 1：Bottom Line", level=1)

# Build a single-cell table to act as the callout box
cb = doc.add_table(rows=1, cols=1)
cb.autofit = True
cb_cell = cb.rows[0].cells[0]
set_cell_shading(cb_cell, "F2F2F2")  # light gray
cb_cell.text = ""

# Heading line in callout
p1 = cb_cell.paragraphs[0]
r1 = p1.add_run("Directional view：傾向看好，分類為「Cigar Butt 偏向 Re-rating Compounder 中間態」，但建議列入觀察名單而非立即重押。")
r1.bold = True
r1.font.size = Pt(11.5)
r1.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)

# 核心矛盾
p2 = cb_cell.add_paragraph()
r2a = p2.add_run("核心矛盾：")
r2a.bold = True
r2a.font.size = Pt(10.5)
r2b = p2.add_run("以 EV/EBITDA ~4–5x、淨現金占市值 ~33%、PB 1.62x、殖利率 7.3% 的價格，買進一家結構性毛利率已從 2017–2020 年的 22–24% 抬升到 2024–2025 年穩定 30%+ 的公司。市場仍用 commodity 一般照明 LED 廠的估值給它，但業務組合已經是「IR + 車用 + 光耦合器 + 光通訊周邊」為主。")
r2b.font.size = Pt(10.5)

# 關鍵指標
p3 = cb_cell.add_paragraph()
r3a = p3.add_run("關鍵可驗證指標：")
r3a.bold = True
r3a.font.size = Pt(10.5)
r3b = p3.add_run("(1) 2026 年 4–6 月月營收 YoY 是否從 -4.4%（3 月）轉正；(2) 2026 Q1 法說會（預估 5–6 月）車用佔比是否揭露 ≥20%；(3) 投信 5 日 +98K 張認養是否延續、外資 60 日 +1.58M 張的加碼是否轉為持股比例上升。")
r3b.font.size = Pt(10.5)

# 改變看法
p4 = cb_cell.add_paragraph()
r4a = p4.add_run("改變看法的條件：")
r4a.bold = True
r4a.font.size = Pt(10.5)

p5 = cb_cell.add_paragraph()
p5.paragraph_format.left_indent = Cm(0.6)
r5a = p5.add_run("• 翻多升級：")
r5a.bold = True
r5a.font.size = Pt(10.5)
r5b = p5.add_run("H2 2026 月營收 YoY 連 3 個月轉正 + 車用 LED 揭露佔比突破 25% → 加碼")
r5b.font.size = Pt(10.5)

p6 = cb_cell.add_paragraph()
p6.paragraph_format.left_indent = Cm(0.6)
r6a = p6.add_run("• 翻空：")
r6a.bold = True
r6a.font.size = Pt(10.5)
r6b = p6.add_run("2026 年累計 EPS 跌破 4.0 元（隱含 H2 大幅惡化）或外資 60 日由買轉賣超過 500K 張")
r6b.font.size = Pt(10.5)

doc.add_page_break()

# ============================================================
# 區塊 2：核心論點
# ============================================================
doc.add_heading("區塊 2：核心論點（4 條）", level=1)

# 論點 1
doc.add_heading("論點 1：估值極端錯位，市場仍用「衰退 LED 廠」框架定價（Cigar Butt 特徵）", level=2)

add_para("事實：", bold=True)
add_bullet("市值 321 億 TWD（@ 72.4），淨現金 109 億（cash 121 億 − debt 12 億，BBG Q4 2025），淨現金占市值 34%")
add_bullet("EV ~141 億，TTM EBITDA 約 33 億（Q1–Q4 2025 加總），EV/EBITDA ≈ 4.3x")
add_bullet("現金調整後 PE ≈ 10.5x（(72.4−24.3 元淨現金/股) ÷ TTM EPS 4.6）")
add_bullet("2025 配息 5.31 元，殖利率 7.3%")
add_rich_bullet([("市場共識的錨：", True), ("把它和富采（3714 = 晶電+隆達合併，市值 523 億）放在同一籃子比較，認定 LED 是衰退結構，給予低估值。", False)])
add_rich_bullet([("差距點：", True), ("富采主要是 chip / epi（更接近 commodity），億光是 packaging + sensors + photo coupler，後者的客戶黏著度與 ASP 結構不同。從毛利率長期軌跡可驗證：2017 GM 22.7% → 2025 全年平均 31% +800bps（BBG quarterly data 可逐季回測）。", False)])
add_rich_bullet([("可驗證時點：", True), ("Q2 2026 法說會（8 月）若再次驗證 GM 31–32%，估值錨應該被打破。", False)])

# 論點 2
doc.add_heading("論點 2：產品結構已悄悄轉向「不可見光 + 車用」雙引擎，市場仍用舊組合估值（結構錯位）", level=2)

add_para("事實（億光 2025 H1 法說會）：", bold=True)
add_bullet("不可見光（IR）產品佔營收 41%（最大段）")
add_bullet("消費電子產品佔 23%（最高毛利）")
add_bullet("車用 LED 進入主要 OEM 客戶供應鏈，2026 年雙位數成長 guidance")
add_rich_bullet([("新業務佔比 ≥10pp 結構變化：", True), ("對照 2017–2019 時期一般照明 LED 仍占主導，現在不可見光 + 消費電子 ≈ 64%，這就是毛利率拉抬 800bps 的根因。", False)])
add_rich_bullet([("市場仍貼舊標籤：", True), ("在主要財經媒體與散戶討論中，億光仍被歸類於「傳統 LED」、被高息 ETF 視為「殖利率股」而非成長股 — 但 2025/12/17 已被 00919 剔除（這是壓抑去年 H2 股價的因素之一），意味著未來不會被動賣壓減少，反而為基本面投資人提供進場窗口。", False)])

# 論點 3
doc.add_heading("論點 3：「車用 + 機器人 + 光通訊」三主題共振，但市場尚未把它放進任何一個熱門題材籃（敘事錯位）", level=2)

add_table(
    ["主題", "億光的角色", "2026 進度"],
    [
        ["車用 LED 大燈", "2026 量產期、雙位數營收成長", "中"],
        ["Mini LED 車用顯示背光", "已穩定出貨", "中"],
        ["機器人 / 機械手臂 / 掃地機", "photo coupler + IR sensor + 高功率 IR", "中早"],
        ["EV 充電 / 工業自動化 / PV inverter", "photo coupler + IGBT gate driver（漲價中）", "已成"],
        ["AI 伺服器", "指示燈 + 高電流 power supply", "中早"],
        ["光通訊 / 矽光子周邊", "DigiTimes 2026/4/24 確認「ramping up」", "中早"],
    ],
    first_col_bold=True,
)

doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run("關鍵敘事差距：")
r.bold = True
p.add_run("每個主題單獨力道不強，導致億光在任何一個熱門題材族群（CPO、矽光子、機器人、AI server）中都不是主角，但合計提供 2026–2027 雙位數成長的多角支撐。SmartKarma 2026/4 出 primer report、DigiTimes 2026/4/24 的光通訊報導都是「敘事即將轉折」的早期訊號。")

# 論點 4
doc.add_heading("論點 4：籌碼結構出現基本面投資人接手的早期跡象（籌碼錯位）", level=2)

add_bullet("外資 60 日加碼 +1,580K 張（極大量級，對應約市值 5–7% 的籌碼移轉），20 日 +525K 張，5 日轉小幅賣超 -22.6K — 短線獲利了結，不是趨勢反轉")
add_bullet("投信 5 日 +98K 張（首次明顯認養訊號）、20 日 +25.8K 張 — 投信通常在外資加碼後 3–6 個月才進場，這是接力訊號")
add_bullet("集保 21 日 -2.52%（散戶在分散，籌碼向長線投資人集中）")
add_bullet("融資餘額 110M（相對 321 億市值的小規模散戶槓桿，沒有過熱）")
add_bullet("外資持股 32.98%（仍有上升空間，台灣中型權值股典型外資持股 35–45%）")
add_bullet("股價已突破 MA20、MA60，60 日漲幅 ~12%（從 65.3 → 73.1）")
add_bullet("被 00919 剔除生效後（2025/12/17）的賣壓已經消化")

doc.add_page_break()

# ============================================================
# 區塊 3
# ============================================================
doc.add_heading("區塊 3：產業鏈定位 × 利潤池故事", level=1)

doc.add_heading("全球競爭地位（從中文一手 + GMI 報告交叉驗證）", level=2)
add_bullet("全球 IR LED 包裝 top-2")
add_bullet("全球 LED 市佔 top-5")
add_bullet("台灣 LED 包裝最大廠")
add_bullet("IR LED 全球 top 5（含 Lumileds、ams-OSRAM、富采、Excelitas）合計約 42% 市佔")

doc.add_heading("利潤池遷移地圖（過去 5 年）", level=2)

add_table(
    ["環節", "利潤池流向", "億光位置"],
    [
        ["一般照明 LED（visible，commodity）", "↓↓ 萎縮", "已縮減暴露"],
        ["Mini LED 背光（顯示器）", "↑ 適中", "中下游包裝有參與"],
        ["IR LED（sensor / 通訊 / 安防 / 醫療）", "↑↑ 結構性擴張", "核心受益者"],
        ["車用 LED（內外飾 + ADAS）", "↑↑ 擴張", "2026 量產 inflection"],
        ["Photo coupler / IGBT gate driver", "↑ 漲價 + EV / 工業擴張", "第二受益點（被忽略）"],
        ["矽光子 / CPO（chip 級）", "↑↑↑ 但門檻高", "僅周邊參與（指示、power）"],
    ],
    first_col_bold=True,
)

doc.add_paragraph()
p = doc.add_paragraph()
p.add_run("Bull 觀點：").bold = True
p.add_run("億光站在三個「利潤上升環節」（IR、車用、power coupler），但被市場用 commodity LED 估值定錨。")

p = doc.add_paragraph()
p.add_run("Bear 觀點：").bold = True
p.add_run("在矽光子 / CPO 這個 2026 年最熱主題裡，億光不是主角（不是聯亞、華星光），所以無法享受純題材股的 valuation re-rating。")

# ============================================================
# 區塊 4
# ============================================================
doc.add_heading("區塊 4：「被低估 / 剛起漲」訊號評分", level=1)

doc.add_heading("A. 五種錯位檢核", level=2)
add_table(
    ["錯位類型", "結果", "證據"],
    [
        ["預期錯位", "✓", "BBG Q1 2026 EPS 共識 1.11，實際月營收已 beat 6%（Q1 累計 50.39 億 vs est 47.35 億）。Q2 2026 EPS 共識 1.27 可能再被上修"],
        ["時序錯位", "✓", "月營收 YoY 從 -11.5%（Q3 25）→ -6.6%（Q4 25）→ +0.3%（Q1 26 cum）改善，但本益比仍在 5 年低檔"],
        ["結構錯位", "✓✓", "不可見光 + 消費電子組合佔 64%，毛利率結構性 +800bps；市場仍給「衰退 LED」估值"],
        ["籌碼錯位", "✓", "sell-side coverage 稀薄（SmartKarma 4 月才出 primer），但外資 60 日大量加碼 + 投信開始認養"],
        ["敘事錯位", "✓", "三主題共振但不是任何主題主角，被任何熱門族群忽略"],
    ],
    first_col_bold=True,
)
doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run("錯位密度：5/5 全中（罕見）")
r.bold = True
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)

doc.add_heading("B. 三種起漲領先訊號評分（0-3）", level=2)
add_table(
    ["訊號類別", "分數", "說明"],
    [
        ["基本面 inflection", "2/3", "Q1 月營收 beat、毛利率連 4 季 30%+，但 EPS 還未明顯上修"],
        ["籌碼 inflection", "3/3", "外資 60 日 +1.58M 張、投信 5 日 +98K 首次認養、董監持股穩定、被 00919 剔除消化完"],
        ["敘事 inflection", "2/3", "SmartKarma primer + DigiTimes 光通訊報導、龍頭法說會點名（部分），但尚無外資首次發報告或熱門 ETF 新納入"],
    ],
    first_col_bold=True,
)
doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run("合計：7/9 → 強烈起漲訊號（門檻 ≥6/9）")
r.bold = True
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)

doc.add_heading("C. 分類判斷", level=2)
add_para("Cigar Butt + 早期 Compounder 中間態：", bold=True)
add_bullet("Cigar Butt 特徵：淨現金占市值 33%、EV/EBITDA 4-5x、PB 1.62x、殖利率 7.3% — 純資產面就有保護")
add_bullet("早期 Compounder 特徵：毛利率結構性提升、產品組合往高毛利傾斜、不是純被動型 deep value")
add_rich_bullet([("不適用 Value Trap 警示：", True), ("因為 ROE ~10%、EPS 趨勢非結構性下滑（2024 = 5.25, 2025 = 4.6, 2026E ≥ 4.8 估），且 incremental ROIC 改善", False)])
add_rich_bullet([("不是 Special Situation：", True), ("無重大事件催化", False)])

doc.add_page_break()

# ============================================================
# 區塊 5
# ============================================================
doc.add_heading("區塊 5：估值與隱含預期（Mauboussin 反向 DCF）", level=1)

doc.add_heading("目前股價（72.4 元）隱含的市場假設", level=2)
add_para("用 EV 141 億、TTM FCF 約 24 億（BBG 2025 全年加總）反推：")
add_bullet("FCF yield on EV ≈ 17% — 對照無風險利率 + ERP，這意味著市場預期 FCF 將永久性下滑 50% 並再無成長")
add_bullet("或等價於：未來 5 年營收 CAGR -3% 到 -5%、營業利益率回退到 2017–2020 年的 5–8%")

doc.add_heading("對照公司實際軌跡與合理推估", level=2)
add_table(
    ["指標", "過去 5 年實際", "中性推估", "市場隱含"],
    [
        ["營收 CAGR", "-2% (2021–2025)", "0~+3% (2026–2028)", "-3 ~ -5%"],
        ["EBITDA margin", "12–18% (擴張中)", "17–19%", "退回 10–12%"],
        ["FCF (億 TWD)", "13–28 區間", "22–28", "<15"],
    ],
    first_col_bold=True,
)
doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run("結論：")
r.bold = True
p.add_run("市場隱含的悲觀比公司過去 5 年最差年份還差。即使只是 reversion to mean（EBITDA margin 維持 17%，營收持平），合理 EV 應達 200–250 億（EV/EBITDA 6–7.5x），對應股價區間 ")
r2 = p.add_run("89–100 元")
r2.bold = True
p.add_run("（含淨現金回填）。")

doc.add_heading("第二層思考（Howard Marks）", level=2)
add_rich_bullet([("共識敘事：", True), ("億光是 mature LED 廠，看股息就好，沒有成長故事 → 因此給 7.3% 殖利率", False)])
add_rich_bullet([("我看到的不同：", True), ("產品組合已換、毛利率已結構性提升、車用+機器人+光通訊三題材在 2026 年同時 ramp，但因為三者都不是「主角」，沒被任何題材族群定價", False)])
add_rich_bullet([("如果共識正確（純息收股）：", True), ("股價合理區間 65–75（在區間中段）", False)])
add_rich_bullet([("如果我正確（題材+基本面雙引擎）：", True), ("股價合理區間 85–105", False)])
add_rich_bullet([("非對稱性：", True), ("下檔 ~10%（殖利率支撐 + 淨現金底）vs 上檔 +20–45%。下檔 1 vs 上檔 2–4.5 的不對稱", False)])

doc.add_heading("Page 16 stories 掃描", level=2)
add_numbered("Photo coupler 漲價：研究機構（CMoney）已點名但未進主流敘事 — 隱性 catalyst")
add_numbered("新北市 1983 年成立的土地資產：總部位於新北中和，老廠土地若處分為隱性資產（未驗證、僅警示應追蹤）")
add_numbered("CEO 葉寅夫為創辦人，掌握公司方向 40+ 年 — 治理穩定但缺乏 fresh narrative；若有接班規劃公布是 catalyst")

# ============================================================
# 區塊 6
# ============================================================
doc.add_heading("區塊 6：Bear Case + 主要下行風險", level=1)

doc.add_heading("真實的 Bear Case（4 條）", level=2)
add_numbered("2025 EPS 同比下滑 12%（5.25 → 4.6）尚未止穩：若 2026 H2 月營收 YoY 未能轉正，去年高基期將拖累 EPS 進一步下行至 4.0 以下")
add_numbered("被 00919 剔除可能不是孤例：若殖利率因股價上漲下降到 5% 以下，其他高息 ETF（00929、00713）可能跟進剔除，被動賣壓 second wave")
add_numbered("光通訊敘事可能 oversold：億光的角色是周邊（指示、power），不是 transceiver / laser 本體 — 若市場意識到這點，敘事溢價無法持續")
add_numbered("中國產能 / 客戶風險未驗證：本研究未能查證中國子公司營收佔比、是否在中美科技戰受影響清單")

doc.add_heading("量化下行情境", level=2)
add_bullet("若 2026 EPS 退到 3.8（H2 大幅惡化），假設 PE 12x → 股價 45.6")
add_bullet("加回淨現金 24 元 → 公允價值 ~70 元（仍接近現價）")
add_bullet("即極悲觀情境下的下檔，仍有殖利率與淨現金保護")

doc.add_page_break()

# ============================================================
# 查證透明度
# ============================================================
doc.add_heading("查證透明度", level=1)

doc.add_heading("搜尋資源使用", level=2)
add_bullet("MCP 呼叫：7 次（FMP profile 與 peers 成功；Quartr 無覆蓋訂閱；FMP analyst/quote/segmentation 受方案限制）")
add_bullet("Web 搜尋：8 次成功")
add_bullet("Web fetch：6 次嘗試，5 次 403（cnyes、winvest、blog.fugle、money.udn、digitimes）— Web fetch 對台股媒體成功率低，倚賴 search snippet")
add_bullet("總計：21 次（額度內）")

doc.add_heading("主要資料來源", level=2)
add_numbered("使用者提供 Bloomberg Terminal 資料（Q3 2016 – Q2 2026E 季度財務、共識、市值、EV）— 高信度權威")
add_numbered("FMP MCP（公司基本資料、peers）")
add_numbered("鉅亨網新聞（2025 法說會綜整、月營收）")
add_numbered("經濟日報 - LED 廠轉型機器人鏈（2026/04 報導）")
add_numbered("CMoney 研究報告（光耦合器漲價、Mini LED + 車用論點）")
add_numbered("Vocus / 富果（法說會逐字摘要 — 部分擷取）")
add_numbered("DigiTimes 2026/4/24（光通訊 ramping up — 標題確認）")
add_numbered("Goodinfo / statementdog（基本面 EPS 與股利驗證）")
add_numbered("億光官方 IR 描述（FMP profile description）")

doc.add_heading("未能查證項目（誠實標記）", level=2)
add_bullet("2026 年 1、2、4 月月營收（僅取得 3 月）")
add_bullet("中國子公司營收與資產佔比")
add_bullet("主要 5 大客戶具體名單與集中度（若有）")
add_bullet("億光 2025 年 Q4 法說會逐字內容（受 web fetch 失敗影響）")
add_bullet("ROE 螢幕擷取顯示的 2.8% 與 BBG/實際數字落差原因（合理推測為平台計算口徑問題，非真實惡化）")
add_bullet("BBG Q3 2025 EPS 2.02 vs 統計狗 1.29 的差距 — 推測 BBG 含一次性業外項，需法說會原文驗證")
add_bullet("SmartKarma 2026/4 primer 完整內容（付費牆）")
add_bullet("董監持股質押比、內部人申讓細節")

doc.add_heading("整體信心水平：中高", level=2)
add_rich_bullet([("高信度：", True), ("估值、產品組合、籌碼結構、毛利率結構性改善、被 00919 剔除事件", False)])
add_rich_bullet([("中信度：", True), ("催化劑時序與量化營收貢獻", False)])
add_rich_bullet([("低信度：", True), ("客戶名單、中國暴露", False)])

doc.add_heading("待追蹤指標（接下來 1–3 個月）", level=2)
add_table(
    ["優先", "指標", "公布時點", "關鍵閾值"],
    [
        ["★★★", "2026 年 4 月月營收", "2026/05/10 前", "YoY 是否轉正（先前 3 月 YoY -4.4%）"],
        ["★★★", "Q1 2026 法說會", "預估 5–6 月", "車用佔比揭露 + 全年 guidance"],
        ["★★", "三大法人籌碼", "每日", "外資是否從小幅賣超回到買超"],
        ["★★", "投信持股比例", "每月", "是否從 5 日認養延伸到 20 日連買"],
        ["★", "DigiTimes / 工商 / 經濟日報", "rolling", "是否有「光通訊客戶名稱」具體曝光"],
    ],
    first_col_bold=True,
)

doc.add_heading("強烈建議補充的 Bloomberg 指標（若使用者有 BBG 存取）", level=2)
add_numbered("最新 IBES 共識 EPS 修正幅度（2026E、2027E）")
add_numbered("外資 sell-side analyst 目標價中位數變化（過去 6 個月）")
add_numbered("機構持股名單變動（過去 2 季新進的長線基金）")
add_numbered("與富采（3714）的 paired-trade 相對表現")

# ============================================================
# Final Note
# ============================================================
doc.add_heading("Final Note for PM", level=1)

# Single-cell box for emphasis
fb = doc.add_table(rows=1, cols=1)
fb_cell = fb.rows[0].cells[0]
set_cell_shading(fb_cell, "FFF2CC")  # light amber
fb_cell.text = ""
p = fb_cell.paragraphs[0]
r = p.add_run("這檔股票的特徵是「五種錯位全中、起漲訊號 7/9、Cigar Butt 估值底護」。")
r.font.size = Pt(10.5)
r2 = p.add_run("最大的非 alpha 風險")
r2.bold = True
r2.font.size = Pt(10.5)
r3 = p.add_run("是它沒有單一強敘事 — 所以 re-rating 速度可能慢、但下檔有保護。適合作為核心 portfolio 中「低 beta + 收息 + optionality on 三主題」的小型衛星部位，不適合 momentum strategy。")
r3.font.size = Pt(10.5)

# ============================================================
# Sources
# ============================================================
doc.add_heading("Sources", level=1)

sources = [
    ("Goodinfo! 2393 億光", "https://goodinfo.tw/tw2/StockDetail.asp?STOCK_ID=2393"),
    ("鉅亨網 億光下半年獲利優於上半年（2025）", "https://news.cnyes.com/news/id/6163413"),
    ("鉅亨網 億光法說 Q2 估持平不可見光車用雙引擎", "https://news.cnyes.com/news/id/5994094"),
    ("經濟日報 LED 廠轉型切入機器人鏈", "https://money.udn.com/money/story/5612/9157069"),
    ("CMoney 研究報告 億光 Mini LED 車用 光耦合器漲價", "https://www.cmoney.tw/notes/note-detail.aspx?nid=244540"),
    ("SmartKarma Primer Everlight 2393 TT Apr 2026", "https://www.smartkarma.com/insights/primer-everlight-electronics-co-ltd-2393-tt-apr-2026"),
    ("DigiTimes Everlight ramping up in optical communications 2026", "https://www.digitimes.com/news/a20260424PD202/everlight-communications-automotive-revenue-2026.html"),
    ("Vocus 億光 2025 H1 解密", "https://vocus.cc/article/68b2c243fd8978000144b7f8"),
    ("statementdog 億光 EPS", "https://statementdog.com/analysis/2393/eps"),
    ("statementdog 億光 PE", "https://statementdog.com/analysis/2393/pe"),
    ("Win 投資 2393 評估", "https://winvest.tw/Stock/Symbol/Comment/2393"),
    ("Yahoo Finance 2393.TW", "https://finance.yahoo.com/quote/2393.TW/"),
    ("00919 成分股調整名單", "https://tw.stock.yahoo.com/news/094500409.html"),
]
for title, url in sources:
    p = doc.add_paragraph(style="List Bullet")
    r1 = p.add_run(title + " — ")
    r1.font.size = Pt(10)
    r2 = p.add_run(url)
    r2.font.size = Pt(9)
    r2.font.color.rgb = RGBColor(0x05, 0x63, 0xC1)
    r2.italic = True

doc.save(OUT)
print(f"Saved: {OUT}")
