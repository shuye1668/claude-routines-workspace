/**
 * ============================================================
 * 美林投資時鐘 自動追蹤器  V4.0
 * ============================================================
 * V3.1 → V4.0 的核心變更（設計理由詳見 README.md）
 *
 *  A.【指針長度終於有意義】V3.1 的黃色「指針」是從圓心拉到座標點，長度＝
 *     sqrt((inf/4)^2 + (g/1.5)^2)——兩軸用了 4 與 1.5 兩個彼此無關的縮放，
 *     長度是一個混合單位、無法解讀，而且超出範圍還被 clamp() 截斷（指針會說謊）。
 *     V4 把兩軸都標準化為 z 分數（以自身 20 年穩健中位數/σ 校準）：
 *        指針角度 = 景氣時刻（幾點鐘）      → 你在循環的哪個位置
 *        指針長度 = 離中性有多遠，單位 σ    → 訊號有多強、體制有多明確
 *     長 ⇒ 體制明確；短 ⇒ 貼在中性帶，任何一個月的雜訊都能讓象限翻面。
 *     這也讓 V3.1 用 ZERO_BAND 硬補的「近零軸雜訊」問題有了統一度量。
 *
 *  B.【修正 CFNAI 偏低假象】V3.1 用「CFNAI > 0」判定成長高於趨勢，但 CFNAI-MA3
 *     近 20 年的穩健中位數約在 -0.15 附近，導致 2023–2024 軟著陸期間水準象限
 *     長期誤判為「滯脹」（原本的歷史解讀欄自己也承認這是假象）。
 *     V4 以「近 20 年穩健中位數」為中性點計算 z，新增「校準象限」欄，
 *     原始「景氣象限」欄保留供對照。
 *
 *  C.【核心通膨鬼影針】新增核心 CPI 座標。油價衝擊時整體 CPI 會把時鐘甩進過熱，
 *     核心卻沒動——這個背離才是真正該分析的東西，現在看得見。
 *
 *  D.【轉折確認改用可證偽規則】丟掉 ZERO_BAND，改為：
 *     指針長度 ≥ 1.0σ ⇒ 當日即「確認」；否則「暫定」，
 *     並在同一象限撐過「第 2 個總經資料版本」時自動升級為「確認」並發通知。
 *     另加信用(OAS Δ20d)與波動(VIX)的市場同步確認註記。
 *
 *  E.【風險分數連續化】V3.1 是階梯函數，VIX 從 14.99 跳到 15.01 分數就跳一階
 *     （資料裡到處是 53 ↔ 62 的假跳動）。V4 改為分段線性內插 + 分項透明化。
 *
 *  F.【金鑰移出程式碼】改讀「指令碼屬性」。請先執行一次 setup_StoreSecrets()。
 *     ⚠️ 舊的 FRED / Gemini 金鑰已外洩，請務必到官網重新產生後再填入。
 *
 *  G.【接上 Claude Remote Routine】每日把「摘要 + 機器可讀 JSON」寫進一份固定的
 *     Google 文件（並提供 ?api=digest 的 JSON 端點），供 Claude 排程讀取、
 *     做深度分析並寄出警示信。Apps Script 這端只負責取數與「事件即時通知」，
 *     深度分析交給 Claude。
 *
 * 部署：Code.gs / Index.html / Backfill.gs 三檔一起更新 → 執行 setup_StoreSecrets()
 *      → 執行 backfill_History(3) 重算歷史 → 重新部署網頁應用程式。
 * ============================================================
 */

// ===================== 全域常數 =====================
const TZ = 'Asia/Taipei';
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const DEFAULT_SHEET_ID = '1oe8ng_ufGYUCf6yskiQK6DDge-k0b6K5006mzkQs8ZM';
const CAL_SHEET_NAME = '校準';
const DIGEST_DOC_NAME = '美林時鐘 每日摘要';

const NEUTRAL_INFLATION = 2.5;   // CPI 中性值 ≈ 2% PCE 目標 + CPI 對 PCE 的結構性楔差
const CAL_YEARS        = 20;     // 校準窗（年）
const CAL_TTL_DAYS     = 7;      // 校準快取有效天數
const Z_NEUTRAL_BAND   = 0.5;    // 指針長度 < 0.5σ ⇒ 中性帶（訊號弱、易翻轉）
const Z_CONFIRM        = 1.0;    // 指針長度 ≥ 1.0σ ⇒ 轉折當日即可判「確認」
const Z_MOM_DEADBAND   = 0.25;   // 動能死區（σ）：小於此值視為持平，避免月頻雜訊翻動階段
const R_MAX_SIGMA      = 3.0;    // 錶面外圈 = 3σ

// 試算表欄位。前端一律依「欄名」讀取，順序不影響前端；
// 前 20 欄刻意維持 V3.1 原順序，舊資料不會錯位。
const HEADERS = [
  // --- V3.1 既有欄位（順序不變）---
  '日期', 'CFNAI_MA3', 'CPI年增率', '核心CPI年增率', '有效聯邦基金利率',
  '利差(10Y-2Y)', '高收益債利差', 'VIX恐慌指數',
  'g分數', 'inf分數', '成長動能Δ3m', '通膨動能Δ3m',
  '景氣象限', '週期階段', '建議資產', '建議類股',
  '風險分數', '衰退警示', '歷史解讀', '象限轉折',
  // --- V4 新增：標準化座標與時鐘讀數 ---
  '成長z', '通膨z', '核心inf分數', '核心通膨z', '成長動能z', '通膨動能z',
  '時鐘角度', '時鐘時刻', '指針長度σ', '訊號強度', '動能長度σ', '動能指向',
  '校準象限', '水準方向一致性',
  '風險分項', '信用動能Δ20d', 'VIX動能Δ20d',
  '轉折狀態', '同象限資料版本數', '每日警示'
];

// ===================== 設定（指令碼屬性）=====================
function P_() { return PropertiesService.getScriptProperties(); }
function prop_(k, dft) { const v = P_().getProperty(k); return (v === null || v === '') ? dft : v; }
function sheetId_()   { return prop_('SHEET_ID', DEFAULT_SHEET_ID); }
function fredKey_()   { return prop_('FRED_API_KEY', ''); }
function geminiKey_() { return prop_('GEMINI_API_KEY', ''); }
function apiToken_()  { return prop_('API_TOKEN', ''); }
function mailTo_() {
  const v = prop_('ALERT_EMAIL', '');
  if (v) return v;
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}
function sendGeminiDaily_() { return prop_('SEND_GEMINI_EMAIL', 'false') === 'true'; }

/**
 * 只執行一次：把金鑰與設定寫進「指令碼屬性」，之後程式碼裡不再有明文金鑰。
 * ⚠️ 請先把下面四個值改成你的真實設定再執行，否則會直接丟出錯誤。
 * ⚠️ 舊的 FRED / Gemini 金鑰已外洩，請到官網重新產生新的再填。
 */
function setup_StoreSecrets() {
  const conf = {
    FRED_API_KEY:      'PASTE_NEW_FRED_KEY',
    GEMINI_API_KEY:    'PASTE_NEW_GEMINI_KEY',   // 不用 Gemini 可留空字串
    ALERT_EMAIL:       'PASTE_YOUR_EMAIL',
    SEND_GEMINI_EMAIL: 'false',                  // true = 保留 V3.1 的每日 Gemini 盤前信
    SHEET_ID:          DEFAULT_SHEET_ID
  };
  if (conf.FRED_API_KEY.indexOf('PASTE_') === 0 || conf.ALERT_EMAIL.indexOf('PASTE_') === 0) {
    throw new Error('請先在 setup_StoreSecrets() 內把 PASTE_... 改成你的真實金鑰與 Email，再執行一次。');
  }
  conf.API_TOKEN = prop_('API_TOKEN', Utilities.getUuid());
  P_().setProperties(conf, false);
  Logger.log('設定已寫入指令碼屬性。API_TOKEN = ' + conf.API_TOKEN);
}

// ===================== 小工具 =====================
function round2_(x) { return (x === null || x === undefined || isNaN(x)) ? null : Math.round(x * 100) / 100; }
function nz_(x) { return (x === null || x === undefined || (typeof x === 'number' && isNaN(x))) ? '' : x; }
function num_(x) { const v = parseFloat(x); return isNaN(v) ? null : v; }
function latest_(arr) { return (arr && arr.length) ? arr[0].value : null; }
function shortName_(s) { return s ? String(s).split(' (')[0] : ''; }

function median_(a) {
  if (!a || !a.length) return null;
  const s = a.slice().sort(function (x, y) { return x - y; });
  const m = Math.floor(s.length / 2);
  return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** 穩健標準差：1.4826 × MAD。對 2020 這種極端月不敏感，比樣本標準差適合當作尺規。 */
function madSigma_(a) {
  const med = median_(a);
  if (med === null) return null;
  const dev = a.map(function (x) { return Math.abs(x - med); });
  const s = 1.4826 * median_(dev);
  return (s && s > 1e-6) ? s : null;
}
/** 分段線性內插（給風險分數用，取代 V3.1 的階梯函數）。 */
function interp_(x, pts) {
  if (x === null || x === undefined || isNaN(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
    }
  }
  return pts[pts.length - 1][1];
}

// ===================== FRED =====================
function buildFredRequest_(seriesId, unit, limit, order) {
  return {
    url: FRED_BASE + '?series_id=' + seriesId + '&api_key=' + fredKey_() +
         '&file_type=json&sort_order=' + (order || 'desc') +
         '&limit=' + (limit || 1) + '&units=' + (unit || 'lin'),
    muteHttpExceptions: true
  };
}
function parseFredResponse_(res) {
  try {
    if (res.getResponseCode() !== 200) return [];
    const txt = res.getContentText();
    if (!txt || txt.trim().charAt(0) !== '{') return [];
    const obs = JSON.parse(txt).observations || [];
    return obs.map(function (o) { return { date: o.date, value: parseFloat(o.value) }; })
              .filter(function (o) { return !isNaN(o.value); });
  } catch (e) { Logger.log('FRED 解析失敗：' + e); return []; }
}
function fredRange_(seriesId, unit, start, end) {
  const url = FRED_BASE + '?series_id=' + seriesId + '&api_key=' + fredKey_() +
    '&file_type=json&observation_start=' + start + '&observation_end=' + end +
    '&sort_order=asc&units=' + (unit || 'lin');
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return parseFredResponse_(res);
  } catch (e) { Logger.log('FRED range ' + seriesId + ' 失敗：' + e); return []; }
}
/** 取 obs 中「日期 ≤ dateStr」的最後一筆（as-of 值）。 */
function asOf_(obs, dateStr) {
  let v = null;
  for (let i = 0; i < obs.length; i++) { if (obs[i].date <= dateStr) v = obs[i].value; else break; }
  return v;
}
/** 取 obs 中「日期 ≤ dateStr」的第 n 筆之前（給 Δ20d 用）。obs 為 desc 排序。 */
function nthBack_(descObs, n) { return (descObs && descObs.length > n) ? descObs[n].value : null; }
function monthsBefore_(dateStr, n) {
  const p = String(dateStr).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setMonth(d.getMonth() - n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function yearsBefore_(dateStr, n) { return monthsBefore_(dateStr, n * 12); }

// ===================== 校準（把座標變成 σ）=====================
/**
 * 用近 CAL_YEARS 年的歷史，算出每個座標的「穩健中位數」與「穩健 σ」。
 * 有了它，指針長度才有單位、才能跨年份比較，也才知道「多短叫做雜訊」。
 * 結果快取在「校準」分頁，CAL_TTL_DAYS 天內重複使用。
 */
function getCalibration_(ss, force) {
  const sh = ss.getSheetByName(CAL_SHEET_NAME);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (!force && sh) {
    const cached = readCalSheet_(sh);
    if (cached && cached.asOf) {
      const age = (new Date(today) - new Date(cached.asOf)) / 86400000;
      if (age >= 0 && age < CAL_TTL_DAYS) return cached;
    }
  }
  const cal = computeCalibration_(today);
  writeCalSheet_(ss, cal);
  return cal;
}
function computeCalibration_(today) {
  const start = yearsBefore_(today, CAL_YEARS);
  const cfnai = fredRange_('CFNAIMA3', 'lin', start, today);
  const cpi   = fredRange_('CPIAUCSL', 'pc1', start, today);
  const core  = fredRange_('CPILFESL', 'pc1', start, today);

  const gArr    = cfnai.map(function (o) { return o.value; });
  const infArr  = cpi.map(function (o) { return o.value - NEUTRAL_INFLATION; });
  const coreArr = core.map(function (o) { return o.value - NEUTRAL_INFLATION; });

  function diff3(obs) {
    const out = [];
    for (let i = 3; i < obs.length; i++) out.push(obs[i].value - obs[i - 3].value);
    return out;
  }
  const gMomArr   = diff3(cfnai);
  const infMomArr = diff3(cpi);

  const cal = {
    asOf: today,
    years: CAL_YEARS,
    n: cfnai.length,
    gMed:      round2_(median_(gArr)),
    gSigma:    round2_(madSigma_(gArr)),
    infMed:    round2_(median_(infArr)),
    infSigma:  round2_(madSigma_(infArr)),
    coreMed:   round2_(median_(coreArr)),
    coreSigma: round2_(madSigma_(coreArr)),
    gMomSigma:   round2_(madSigma_(gMomArr)),
    infMomSigma: round2_(madSigma_(infMomArr))
  };
  // 任何一項算不出來就退回保守預設值，確保流程不中斷。
  if (!cal.gSigma)      cal.gSigma = 0.35;
  if (!cal.infSigma)    cal.infSigma = 1.10;
  if (!cal.coreSigma)   cal.coreSigma = 0.90;
  if (!cal.gMomSigma)   cal.gMomSigma = 0.30;
  if (!cal.infMomSigma) cal.infMomSigma = 0.80;
  if (cal.gMed === null)    cal.gMed = 0;
  if (cal.infMed === null)  cal.infMed = 0;
  if (cal.coreMed === null) cal.coreMed = 0;
  Logger.log('校準完成：' + JSON.stringify(cal));
  return cal;
}
const CAL_KEYS = ['asOf', 'years', 'n', 'gMed', 'gSigma', 'infMed', 'infSigma',
                  'coreMed', 'coreSigma', 'gMomSigma', 'infMomSigma'];
function readCalSheet_(sh) {
  try {
    const last = sh.getLastRow();
    if (last < 2) return null;
    const vals = sh.getRange(1, 1, last, 2).getValues();
    const o = {};
    vals.forEach(function (r) {
      const k = String(r[0]).trim();
      if (CAL_KEYS.indexOf(k) >= 0) o[k] = (k === 'asOf') ? String(r[1]).trim() : num_(r[1]);
    });
    return o.gSigma ? o : null;
  } catch (e) { return null; }
}
function writeCalSheet_(ss, cal) {
  let sh = ss.getSheetByName(CAL_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CAL_SHEET_NAME);
  const rows = CAL_KEYS.map(function (k) { return [k, cal[k]]; });
  rows.push(['說明', '座標標準化用的穩健統計量（中位數與 1.4826×MAD）。指針長度的單位 σ 由此而來。']);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
}

// ===================== 座標 → 時鐘讀數 =====================
/**
 * 這是 V4 的核心：把 (成長, 通膨) 換算成一個真正的鐘面讀數。
 *   bearing = 從正北(成長最高)順時針量的角度 → 幾點鐘
 *   r       = 離中性多遠，單位 σ            → 指針長度＝訊號強度
 */
function clockReading_(zg, zinf) {
  if (zg === null || zinf === null) return { bearing: null, hour: '', r: null, strength: '資料不足' };
  const bearing = (Math.atan2(zinf, zg) * 180 / Math.PI + 360) % 360;
  const r = Math.sqrt(zg * zg + zinf * zinf);
  return { bearing: round2_(bearing), hour: clockHour_(bearing), r: round2_(r), strength: strengthLabel_(r) };
}
function clockHour_(bearing) {
  const h = bearing / 30;
  let hh = Math.floor(h) % 12;
  let mm = Math.round((h - Math.floor(h)) * 60);
  if (mm === 60) { mm = 0; hh = (hh + 1) % 12; }
  if (hh === 0) hh = 12;
  return hh + ':' + (mm < 10 ? '0' : '') + mm;
}
function strengthLabel_(r) {
  if (r === null) return '資料不足';
  if (r < Z_NEUTRAL_BAND) return '弱（中性帶・易翻轉）';
  if (r < Z_CONFIRM)      return '偏弱';
  if (r < 2.0)            return '明確';
  return '極端';
}

// ===================== 分類邏輯 =====================
/** 水準象限（原始座標，V3.1 相容，保留供對照）。 */
function levelQuadrant_(g, inf) {
  if (g === null || inf === null) return '資料不足';
  if (g > 0 && inf > 0) return '過熱 (Overheat)';
  if (g <= 0 && inf > 0) return '滯脹 (Stagflation)';
  if (g <= 0 && inf <= 0) return '衰退 (Recession)';
  return '復甦 (Recovery)';
}
/** 校準象限（以近 20 年穩健中位數為中性點）——修正 CFNAI 偏低造成的「假滯脹」。 */
function calibratedQuadrant_(zg, zinf) {
  if (zg === null || zinf === null) return '資料不足';
  if (zg > 0 && zinf > 0) return '過熱 (Overheat)';
  if (zg <= 0 && zinf > 0) return '滯脹 (Stagflation)';
  if (zg <= 0 && zinf <= 0) return '衰退 (Recession)';
  return '復甦 (Recovery)';
}
/** 方向階段：改用 z 動能 + σ 死區，比 V3.1 的固定 0.05 死區更不易被月頻雜訊翻動。 */
function directionPhase_(zdG, zdInf) {
  if (zdG === null || zdInf === null) return '動能資料不足';
  const g = (Math.abs(zdG) < Z_MOM_DEADBAND) ? 0 : zdG;
  const i = (Math.abs(zdInf) < Z_MOM_DEADBAND) ? 0 : zdInf;
  if (g > 0 && i < 0) return '復甦 (Recovery)';
  if (g > 0 && i >= 0) return '過熱 (Overheat)';
  if (g <= 0 && i > 0) return '滯脹 (Stagflation)';
  return '衰退/再通膨 (Reflation)';
}
function assetByPhase_(phase) {
  if (phase.indexOf('復甦') === 0) return { asset: '股票 Equities', sector: '循環成長：科技、非必需消費' };
  if (phase.indexOf('過熱') === 0) return { asset: '大宗商品 Commodities', sector: '循環價值：能源、原物料、工業' };
  if (phase.indexOf('滯脹') === 0) return { asset: '現金 Cash', sector: '防禦價值：公用事業、電信、必需消費' };
  if (phase.indexOf('衰退') === 0) return { asset: '債券 Bonds', sector: '防禦成長：醫療保健、必需消費' };
  return { asset: '—', sector: '—' };
}
/** 水準（你在哪）與方向（你往哪去）是否一致——背離＝正在過渡，訊號可信度低。 */
function consistency_(quadC, phase) {
  if (!quadC || !phase || quadC.indexOf('資料') >= 0 || phase.indexOf('資料') >= 0) return '資料不足';
  const q = shortName_(quadC), p = shortName_(phase);
  if (q === p) return '一致（體制穩定）';
  if (p === '衰退/再通膨' && q === '衰退') return '一致（體制穩定）';
  return '背離（過渡中：水準 ' + q + '／方向 ' + p + '）';
}

// ===================== 方向階段轉折：資產意涵 =====================
const PHASE_IMPL = {
  '復甦': '成長加速、通膨仍降 → 股票(循環成長)領先、風險偏多。',
  '過熱': '成長強、通膨加速 → 大宗商品/循環價值；留意央行轉鷹、曲線轉平。',
  '滯脹': '成長轉弱、通膨仍高 → 現金/防禦價值；對角風險最高。',
  '衰退/再通膨': '成長與通膨同步走弱 → 債券領先、防禦成長。'
};
function shiftNote_(pq, q, pp, p) {
  const parts = [];
  if (shortName_(pp) !== shortName_(p)) {
    const np = shortName_(p), impl = PHASE_IMPL[np] || '';
    parts.push('⚡ 方向 ' + shortName_(pp) + '→' + np + (impl ? '：' + impl : ''));
  }
  if (shortName_(pq) !== shortName_(q)) parts.push('水準象限 ' + shortName_(pq) + '→' + shortName_(q));
  return parts.join('　｜　');
}

// ===================== 風險綜合分數（0~100，連續）=====================
function riskScore_(spread, hy, vix) {
  const c = interp_(spread, [[-1.0, 97], [-0.5, 90], [0, 72], [0.25, 55], [0.5, 42], [1.0, 25], [2.0, 12]]);
  const h = interp_(hy,     [[2.8, 10], [3.5, 25], [4.5, 45], [5.5, 62], [7.0, 80], [10.0, 95]]);
  const v = interp_(vix,    [[11, 8], [14, 22], [17, 35], [20, 50], [25, 66], [30, 78], [40, 90], [60, 98]]);
  let sum = 0, w = 0; const parts = [];
  if (c !== null) { sum += 0.25 * c; w += 0.25; parts.push('曲線' + Math.round(c)); }
  if (h !== null) { sum += 0.40 * h; w += 0.40; parts.push('信用' + Math.round(h)); }
  if (v !== null) { sum += 0.35 * v; w += 0.35; parts.push('波動' + Math.round(v)); }
  const score = w ? Math.round(sum / w) : 50;
  let label = '中性';
  if (score < 35) label = 'Risk-On 偏多';
  else if (score > 65) label = 'Risk-Off 偏空';
  return { score: score, label: label, parts: parts.join('／') };
}

// ===================== 衰退警示 =====================
function recessionWarning_(cfnai, spread, zg) {
  if (cfnai !== null && cfnai < -0.70) return '⚠️ CFNAI-MA3 < -0.70（歷史衰退門檻）';
  if (zg !== null && zg < -1.5) return '⚠️ 成長 z < -1.5σ（顯著低於近 20 年常態）';
  if (spread !== null && spread < 0) return '⚠️ 殖利率曲線倒掛';
  return '正常';
}

// ===================== 每日警示（給 Claude routine 當觸發訊號）=====================
function dailyAlerts_(cur, prev) {
  const a = [];
  const risk = num_(String(cur['風險分數']).replace(/[^\d.-]/g, ''));
  const pRisk = prev ? num_(String(prev['風險分數']).replace(/[^\d.-]/g, '')) : null;
  if (risk !== null && pRisk !== null) {
    if (pRisk <= 65 && risk > 65) a.push('風險分數上穿 65（轉 Risk-Off）');
    if (pRisk >= 35 && risk < 35) a.push('風險分數下穿 35（轉 Risk-On）');
  }
  const vix = num_(cur['VIX恐慌指數']), pVix = prev ? num_(prev['VIX恐慌指數']) : null;
  if (vix !== null && pVix !== null && pVix > 0 && (vix / pVix - 1) > 0.20) a.push('VIX 單日跳升 >20%（' + pVix + '→' + vix + '）');
  // 以下皆為「邊緣觸發」：只在跨越門檻的當天通知，否則持續狀態會天天寄信。
  if (vix !== null && pVix !== null && pVix < 30 && vix >= 30) a.push('VIX 上穿 30（進入高波動）');
  const dHy = num_(cur['信用動能Δ20d']), pHy = prev ? num_(prev['信用動能Δ20d']) : null;
  if (dHy !== null && pHy !== null && pHy < 0.50 && dHy >= 0.50) a.push('高收益債 OAS 20 日走闊上穿 0.5pp（信用轉壞）');
  if (dHy !== null && pHy !== null && pHy > -0.50 && dHy <= -0.50) a.push('高收益債 OAS 20 日收斂上穿 0.5pp（信用轉好）');
  const sp = num_(cur['利差(10Y-2Y)']), pSp = prev ? num_(prev['利差(10Y-2Y)']) : null;
  if (sp !== null && pSp !== null) {
    if (pSp >= 0 && sp < 0) a.push('殖利率曲線由正轉倒掛');
    if (pSp < 0 && sp >= 0) a.push('殖利率曲線解除倒掛');
  }
  const r = num_(cur['指針長度σ']), pR = prev ? num_(prev['指針長度σ']) : null;
  if (r !== null && pR !== null && pR >= Z_NEUTRAL_BAND && r < Z_NEUTRAL_BAND)
    a.push('指針進入中性帶（<' + Z_NEUTRAL_BAND + 'σ）：象限訊號轉脆弱');
  if (r !== null && pR !== null && pR < Z_CONFIRM && r >= Z_CONFIRM)
    a.push('指針上穿 ' + Z_CONFIRM + 'σ：體制訊號轉明確');
  return a;
}

// ===================== 主流程 =====================
function run_MerrillLynchTracker() {
  Logger.log('啟動美林投資時鐘 V4.0 ...');
  if (!fredKey_()) throw new Error('尚未設定 FRED_API_KEY，請先執行 setup_StoreSecrets()。');

  // (0) 美東週末直接結束：無新交易資料，不抓不寫不寄。
  const dow = Utilities.formatDate(new Date(), 'America/New_York', 'u');
  if (dow === '6' || dow === '7') { Logger.log('美東週末（dow=' + dow + '），略過。'); return; }

  const ss = SpreadsheetApp.openById(sheetId_());
  const sheet = ss.getSheets()[0];
  ensureHeaders_(sheet);
  const cal = getCalibration_(ss, false);

  // (1) 併發抓取。日頻序列多抓幾筆：一方面避開假日的 "." 空值，一方面算 Δ20d。
  const responses = UrlFetchApp.fetchAll([
    buildFredRequest_('VIXCLS', 'lin', 40),        // [0] VIX（含 Δ20d）
    buildFredRequest_('T10Y2Y', 'lin', 10),        // [1] 10Y-2Y
    buildFredRequest_('BAMLH0A0HYM2', 'lin', 40),  // [2] 高收益債 OAS（含 Δ20d）
    buildFredRequest_('DFF', 'lin', 10),           // [3] 有效聯邦基金利率
    buildFredRequest_('CFNAIMA3', 'lin', 8),       // [4] CFNAI-MA3
    buildFredRequest_('CPIAUCSL', 'pc1', 8),       // [5] CPI 年增率
    buildFredRequest_('CPILFESL', 'pc1', 8)        // [6] 核心 CPI 年增率
  ]);
  const vixObs   = parseFredResponse_(responses[0]);
  const spObs    = parseFredResponse_(responses[1]);
  const hyObs    = parseFredResponse_(responses[2]);
  const fedObs   = parseFredResponse_(responses[3]);
  const cfnaiArr = parseFredResponse_(responses[4]);
  const cpiArr   = parseFredResponse_(responses[5]);
  const coreArr  = parseFredResponse_(responses[6]);

  if (!vixObs.length) { Logger.log('VIX 無有效觀測，略過本次執行。'); return; }
  const marketDate = vixObs[0].date;   // 以 VIX 觀測日為交易日鍵（美國假日不會前進 → 天然去重）

  // (2) 讀表：該交易日是否已存在、前一交易日為何
  const parsed = getSheetRows_(sheet);
  const existingRow = parsed.map[marketDate] || null;
  const prevRow = getPrevRowBefore_(parsed, marketDate);

  // (3) 原始座標
  const vix   = latest_(vixObs);
  const sp    = latest_(spObs);
  const hy    = latest_(hyObs);
  const fed   = latest_(fedObs);
  const cfnai = latest_(cfnaiArr);
  const cpi   = latest_(cpiArr);
  const core  = latest_(coreArr);

  const gScore    = round2_(cfnai);
  const infScore  = (cpi === null)  ? null : round2_(cpi - NEUTRAL_INFLATION);
  const coreScore = (core === null) ? null : round2_(core - NEUTRAL_INFLATION);
  const gMom   = (cfnaiArr.length >= 4) ? round2_(cfnaiArr[0].value - cfnaiArr[3].value) : null;
  const infMom = (cpiArr.length   >= 4) ? round2_(cpiArr[0].value   - cpiArr[3].value)   : null;

  // (4) 標準化 → 時鐘讀數
  const zg    = (gScore    === null) ? null : round2_((gScore    - cal.gMed)    / cal.gSigma);
  const zinf  = (infScore  === null) ? null : round2_((infScore  - cal.infMed)  / cal.infSigma);
  const zcore = (coreScore === null) ? null : round2_((coreScore - cal.coreMed) / cal.coreSigma);
  const zgm   = (gMom   === null) ? null : round2_(gMom   / cal.gMomSigma);
  const zim   = (infMom === null) ? null : round2_(infMom / cal.infMomSigma);

  const dial = clockReading_(zg, zinf);
  const mom  = clockReading_(zgm, zim);

  const quadRaw = levelQuadrant_(gScore, infScore);
  const quadCal = calibratedQuadrant_(zg, zinf);
  const phase   = directionPhase_(zgm, zim);
  const rec     = assetByPhase_(phase);
  const risk    = riskScore_(sp, hy, vix);
  const warn    = recessionWarning_(cfnai, sp, zg);

  // (5) 信用/波動的 20 日動能（macro 是月頻，日頻的資訊全在這裡）
  const dHy  = (hy  !== null && nthBack_(hyObs, 20)  !== null) ? round2_(hy  - nthBack_(hyObs, 20))  : null;
  const dVix = (vix !== null && nthBack_(vixObs, 20) !== null) ? round2_(vix - nthBack_(vixObs, 20)) : null;

  // (6) 轉折偵測與確認
  const shiftNote = prevRow
    ? shiftNote_(prevRow['校準象限'] || prevRow['景氣象限'], quadCal, prevRow['週期階段'], phase) : '';
  const isTransition = !!shiftNote;
  const vintages = countVintages_(parsed, marketDate, quadCal, { cfnai: gScore, cpi: cpi });
  let status = '';
  let shiftCell = '';
  if (isTransition) {
    const strong = (dial.r !== null && dial.r >= Z_CONFIRM);
    status = strong ? '確認' : '暫定';
    const cross = crossConfirm_(quadCal, phase, dHy, vix);
    shiftCell = '【' + status + '｜指針 ' + dial.r + 'σ】' + shiftNote + (cross ? '　｜　' + cross : '');
  }
  // 升級：先前的「暫定」轉折在第 2 個總經資料版本仍維持同象限 → 自動確認。
  let upgrade = null;
  if (!isTransition && vintages === 2 && prevRow && num_(prevRow['同象限資料版本數']) === 1) {
    const runStart = findRunStart_(parsed, marketDate, quadCal);
    if (runStart && String(runStart['轉折狀態']) === '暫定') {
      upgrade = '✅ 轉折確認：' + shortName_(quadCal) + ' 已撐過第 2 個總經資料版本（起於 ' + runStart.__date + '）';
      shiftCell = upgrade;
      status = '確認(延後)';
    }
  }

  // (7) 組列
  const rowObj = {
    '日期': marketDate,
    'CFNAI_MA3': nz_(round2_(cfnai)), 'CPI年增率': nz_(round2_(cpi)),
    '核心CPI年增率': nz_(round2_(core)), '有效聯邦基金利率': nz_(round2_(fed)),
    '利差(10Y-2Y)': nz_(round2_(sp)), '高收益債利差': nz_(round2_(hy)), 'VIX恐慌指數': nz_(round2_(vix)),
    'g分數': nz_(gScore), 'inf分數': nz_(infScore),
    '成長動能Δ3m': nz_(gMom), '通膨動能Δ3m': nz_(infMom),
    '景氣象限': quadRaw, '週期階段': phase,
    '建議資產': rec.asset, '建議類股': rec.sector,
    '風險分數': risk.score + '（' + risk.label + '）', '衰退警示': warn,
    '象限轉折': shiftCell,
    '成長z': nz_(zg), '通膨z': nz_(zinf), '核心inf分數': nz_(coreScore), '核心通膨z': nz_(zcore),
    '成長動能z': nz_(zgm), '通膨動能z': nz_(zim),
    '時鐘角度': nz_(dial.bearing), '時鐘時刻': dial.hour, '指針長度σ': nz_(dial.r), '訊號強度': dial.strength,
    '動能長度σ': nz_(mom.r), '動能指向': mom.hour,
    '校準象限': quadCal, '水準方向一致性': consistency_(quadCal, phase),
    '風險分項': risk.parts, '信用動能Δ20d': nz_(dHy), 'VIX動能Δ20d': nz_(dVix),
    '轉折狀態': status, '同象限資料版本數': vintages
  };
  rowObj['每日警示'] = dailyAlerts_(rowObj, prevRow).join('；');

  upsertByDate_(sheet, marketDate, rowObj);
  Logger.log('更新 ' + marketDate + ' ｜ ' + quadCal + ' ｜ ' + dial.hour + ' ｜ ' + dial.r + 'σ' +
             (isTransition ? ' ｜⚡轉折(' + status + ')' : '') + (existingRow ? ' ｜重跑(不重寄)' : ''));

  // (8) 匯出摘要（給 Claude routine 讀）
  try { exportDigest_(); } catch (e) { Logger.log('匯出摘要失敗：' + e); }

  // (9) 通知。深度分析交給 Claude routine；這裡只在「有事」時發即時事件信。
  if (existingRow) { Logger.log('該交易日已存在，僅更新數據、不重寄。'); return; }
  const events = [];
  if (shiftCell) events.push(shiftCell);
  if (rowObj['每日警示']) events.push(rowObj['每日警示']);
  if (events.length) sendEventMail_(marketDate, rowObj, events);
  if (sendGeminiDaily_() && geminiKey_()) sendGeminiMail_(marketDate, rowObj, isTransition ? {
    status: status, prevQuad: prevRow['校準象限'] || prevRow['景氣象限'], prevPhase: prevRow['週期階段'],
    curQuad: quadCal, curPhase: phase, shiftNote: shiftNote,
    prevG: prevRow['成長z'], prevInf: prevRow['通膨z']
  } : null);
}

/** 信用與波動是否同步確認這次轉折（可證偽的第二意見）。 */
function crossConfirm_(quadC, phase, dHy, vix) {
  const risky = (shortName_(quadC) === '衰退' || shortName_(quadC) === '滯脹' ||
                 shortName_(phase) === '滯脹' || shortName_(phase) === '衰退/再通膨');
  const stress = (dHy !== null && dHy >= 0.30) || (vix !== null && vix >= 25);
  if (risky && stress) return '市場同步確認（OAS Δ20d ' + dHy + '、VIX ' + vix + '）';
  if (risky && !stress) return '市場尚未確認（信用與波動平靜，總經單邊訊號）';
  if (!risky && stress) return '市場背離（總經轉好但信用/波動仍緊張）';
  return '';
}
/** 往回數：目前這段「同一校準象限」連續期間，涵蓋了幾個不同的總經資料版本。 */
function countVintages_(parsed, dateStr, quadC, curVintage) {
  const seen = {};
  seen[String(curVintage.cfnai) + '|' + String(curVintage.cpi)] = true;
  const rows = parsed.rows.filter(function (r) { return r.__date < dateStr; })
                          .sort(function (a, b) { return a.__date < b.__date ? 1 : -1; });
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['校準象限'] || '') !== quadC) break;
    seen[String(num_(rows[i]['CFNAI_MA3'])) + '|' + String(num_(rows[i]['CPI年增率']))] = true;
  }
  return Object.keys(seen).length;
}
function findRunStart_(parsed, dateStr, quadC) {
  const rows = parsed.rows.filter(function (r) { return r.__date < dateStr; })
                          .sort(function (a, b) { return a.__date < b.__date ? 1 : -1; });
  let last = null;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['校準象限'] || '') !== quadC) break;
    last = rows[i];
  }
  return last;
}

// ===================== 試算表工具 =====================
/** 標題列維護。欄位順序改變時，以「欄名」為鍵搬移既有資料，不會錯位。 */
function ensureHeaders_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const old = (lastRow >= 1 && lastCol >= 1) ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const same = (old.length === HEADERS.length) && HEADERS.every(function (h, i) { return h === old[i]; });
  if (same) return;

  let data = [];
  if (lastRow > 1 && old.length) {
    const vals = sheet.getRange(2, 1, lastRow - 1, old.length).getValues();
    data = vals.map(function (r) {
      return HEADERS.map(function (h) { const i = old.indexOf(h); return (i >= 0) ? r[i] : ''; });
    });
  }
  if (lastRow >= 1 && lastCol >= 1) sheet.getRange(1, 1, lastRow, lastCol).clearContent();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (data.length) sheet.getRange(2, 1, data.length, HEADERS.length).setValues(data);
  sheet.setFrozenRows(1);
  Logger.log('標題列已更新為 V4（' + HEADERS.length + ' 欄），既有資料依欄名搬移完成。');
}

function getSheetRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dCol = headers.indexOf('日期');
  const rows = [], map = {};
  if (lastRow > 1 && dCol >= 0) {
    const vals = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (let i = 0; i < vals.length; i++) {
      const d = vals[i][dCol];
      const ds = (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d).trim();
      if (!ds) continue;
      const o = {};
      for (let j = 0; j < headers.length; j++) o[headers[j]] = vals[i][j];
      o.__date = ds;
      rows.push(o); map[ds] = o;
    }
  }
  rows.sort(function (a, b) { return a.__date < b.__date ? -1 : (a.__date > b.__date ? 1 : 0); });
  return { headers: headers, rows: rows, map: map };
}
function getPrevRowBefore_(parsed, dateStr) {
  let best = null;
  for (let i = 0; i < parsed.rows.length; i++) {
    const ds = parsed.rows[i].__date;
    if (ds < dateStr && (!best || ds > best.__date)) best = parsed.rows[i];
  }
  return best;
}
function upsertByDate_(sheet, dateStr, rowObj) {
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let targetRow = -1;
  if (lastRow > 1) {
    const dateCol = headers.indexOf('日期') + 1;
    const dates = sheet.getRange(2, dateCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i][0];
      const ds = (d instanceof Date) ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d);
      if (ds === dateStr) { targetRow = i + 2; break; }
    }
  }
  // 更新既有列時，未出現在 rowObj 的欄位沿用原值（不洗掉手動維護的「歷史解讀」）。
  let existing = [];
  if (targetRow > 0) existing = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
  const rowValues = headers.map(function (h, idx) {
    if (h in rowObj) return rowObj[h];
    return (targetRow > 0) ? existing[idx] : '';
  });
  if (targetRow > 0) sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  else sheet.appendRow(rowValues);
}

// ===================== 摘要匯出（Claude routine 的資料來源）=====================
/**
 * 產出一份結構化摘要，同時寫進：
 *  1) 固定名稱的 Google 文件（Claude 用 Google Drive 連接器直接讀，最穩）
 *  2) ?api=digest 的 JSON 端點（備援）
 * 只放「最近的」資料，避免 800 列全表被截斷後讀不到最新的一天。
 */
function buildDigest_(days) {
  days = days || 60;
  const ss = SpreadsheetApp.openById(sheetId_());
  const sheet = ss.getSheets()[0];
  const parsed = getSheetRows_(sheet);
  const cal = getCalibration_(ss, false);
  const all = parsed.rows;
  if (!all.length) return { error: 'no data' };

  const cur = all[all.length - 1];
  const recent = all.slice(Math.max(0, all.length - days));

  // 月度軌跡：以「總經資料版本」去重（同一份 CFNAI/CPI 只留一筆），這才是時鐘真正轉動的節奏。
  const vint = [], seen = {};
  for (let i = all.length - 1; i >= 0 && vint.length < 24; i--) {
    const k = String(num_(all[i]['CFNAI_MA3'])) + '|' + String(num_(all[i]['CPI年增率']));
    if (seen[k]) continue;
    seen[k] = true;
    vint.push({
      日期: all[i].__date, CFNAI: num_(all[i]['CFNAI_MA3']), CPI: num_(all[i]['CPI年增率']),
      核心CPI: num_(all[i]['核心CPI年增率']),
      成長z: num_(all[i]['成長z']), 通膨z: num_(all[i]['通膨z']), 核心通膨z: num_(all[i]['核心通膨z']),
      時鐘時刻: all[i]['時鐘時刻'], 指針長度σ: num_(all[i]['指針長度σ']),
      校準象限: all[i]['校準象限'], 週期階段: all[i]['週期階段']
    });
  }
  vint.reverse();

  const shifts = all.filter(function (r) { return String(r['象限轉折'] || '').trim() !== ''; })
                    .slice(-12)
                    .map(function (r) {
                      return { 日期: r.__date, 轉折: String(r['象限轉折']), 狀態: String(r['轉折狀態'] || ''),
                               指針長度σ: num_(r['指針長度σ']) };
                    });

  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const lagDays = Math.round((new Date(today) - new Date(cur.__date)) / 86400000);

  return {
    產出時間: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' (Asia/Taipei)',
    資料最新日: cur.__date,
    資料延遲天數: lagDays,
    版本: 'V4.0',
    校準: cal,
    座標定義: {
      成長座標: 'CFNAI-MA3（0 = 1967 年以來趨勢成長）',
      通膨座標: 'CPI 年增率 − 2.5%',
      z分數: '(座標 − 近' + cal.years + '年穩健中位數) ÷ 穩健σ(1.4826×MAD)',
      指針角度: '從正北(成長最高)順時針，換算成鐘面時刻；12→3點=過熱，3→6點=滯脹，6→9點=衰退/再通膨，9→12點=復甦',
      指針長度: 'sqrt(成長z² + 通膨z²)，單位 σ。<0.5σ=中性帶(訊號弱易翻轉)，≥1.0σ=體制明確',
      動能長度: '3 個月動能除以其自身 σ，代表時鐘轉動的速度'
    },
    現況: {
      日期: cur.__date,
      時鐘時刻: cur['時鐘時刻'], 時鐘角度: num_(cur['時鐘角度']),
      指針長度σ: num_(cur['指針長度σ']), 訊號強度: cur['訊號強度'],
      動能長度σ: num_(cur['動能長度σ']), 動能指向: cur['動能指向'],
      校準象限: cur['校準象限'], 原始象限: cur['景氣象限'], 週期階段: cur['週期階段'],
      水準方向一致性: cur['水準方向一致性'],
      成長z: num_(cur['成長z']), 通膨z: num_(cur['通膨z']), 核心通膨z: num_(cur['核心通膨z']),
      成長動能z: num_(cur['成長動能z']), 通膨動能z: num_(cur['通膨動能z']),
      CFNAI_MA3: num_(cur['CFNAI_MA3']), CPI年增率: num_(cur['CPI年增率']),
      核心CPI年增率: num_(cur['核心CPI年增率']), 有效聯邦基金利率: num_(cur['有效聯邦基金利率']),
      利差10Y2Y: num_(cur['利差(10Y-2Y)']), 高收益債OAS: num_(cur['高收益債利差']),
      VIX: num_(cur['VIX恐慌指數']),
      風險分數: String(cur['風險分數']), 風險分項: String(cur['風險分項'] || ''),
      信用動能Δ20d: num_(cur['信用動能Δ20d']), VIX動能Δ20d: num_(cur['VIX動能Δ20d']),
      衰退警示: cur['衰退警示'],
      建議資產: cur['建議資產'], 建議類股: cur['建議類股'],
      象限轉折: String(cur['象限轉折'] || ''), 轉折狀態: String(cur['轉折狀態'] || ''),
      同象限資料版本數: num_(cur['同象限資料版本數']),
      今日警示: String(cur['每日警示'] || '').split('；').filter(function (s) { return s; }),
      時期解讀: String(cur['歷史解讀'] || '')
    },
    近日序列: recent.map(function (r) {
      return { 日期: r.__date, 指針長度σ: num_(r['指針長度σ']), 時鐘時刻: r['時鐘時刻'],
               校準象限: r['校準象限'], 週期階段: r['週期階段'],
               風險分數: num_(String(r['風險分數']).replace(/[^\d.-]/g, '')),
               VIX: num_(r['VIX恐慌指數']), OAS: num_(r['高收益債利差']), 利差: num_(r['利差(10Y-2Y)']) };
    }),
    月度軌跡: vint,
    近期轉折事件: shifts
  };
}

function exportDigest_() {
  const d = buildDigest_(60);
  const md = digestToText_(d);
  let id = prop_('DIGEST_DOC_ID', '');
  let doc = null;
  if (id) { try { doc = DocumentApp.openById(id); } catch (e) { doc = null; } }
  if (!doc) { doc = DocumentApp.create(DIGEST_DOC_NAME); P_().setProperty('DIGEST_DOC_ID', doc.getId()); }
  const body = doc.getBody();
  body.clear();
  body.appendParagraph(md);
  doc.saveAndClose();
  Logger.log('摘要已寫入 Google 文件：' + doc.getUrl());
  return doc.getUrl();
}

function digestToText_(d) {
  const c = d.現況 || {};
  const lines = [];
  lines.push('【美林投資時鐘 每日摘要】' + d.產出時間 + '　版本 ' + d.版本);
  lines.push('資料最新日：' + d.資料最新日 + '（距今 ' + d.資料延遲天數 + ' 天）');
  lines.push('');
  lines.push('■ 時鐘讀數');
  lines.push('  現在時刻：' + c.時鐘時刻 + '（角度 ' + c.時鐘角度 + '°）');
  lines.push('  指針長度：' + c.指針長度σ + 'σ → ' + c.訊號強度);
  lines.push('  動能：長度 ' + c.動能長度σ + 'σ，指向 ' + c.動能指向);
  lines.push('  校準象限：' + c.校準象限 + '　方向階段：' + c.週期階段);
  lines.push('  一致性：' + c.水準方向一致性);
  lines.push('  座標：成長z ' + c.成長z + '　通膨z ' + c.通膨z + '　核心通膨z ' + c.核心通膨z);
  lines.push('  動能：成長動能z ' + c.成長動能z + '　通膨動能z ' + c.通膨動能z);
  lines.push('');
  lines.push('■ 市場與風險');
  lines.push('  風險分數：' + c.風險分數 + '（' + c.風險分項 + '）');
  lines.push('  VIX ' + c.VIX + '（Δ20d ' + c.VIX動能Δ20d + '）｜HY OAS ' + c.高收益債OAS +
             '（Δ20d ' + c.信用動能Δ20d + '）｜10Y-2Y ' + c.利差10Y2Y);
  lines.push('  衰退警示：' + c.衰退警示);
  lines.push('');
  lines.push('■ 轉折');
  lines.push('  今日轉折：' + (c.象限轉折 || '無') + (c.轉折狀態 ? '（' + c.轉折狀態 + '）' : ''));
  lines.push('  同象限已撐過 ' + c.同象限資料版本數 + ' 個總經資料版本');
  lines.push('  今日警示：' + ((c.今日警示 && c.今日警示.length) ? c.今日警示.join('；') : '無'));
  lines.push('');
  lines.push('■ 框架建議（教育用途，非投資建議）：' + c.建議資產 + ' ／ ' + c.建議類股);
  lines.push('');
  lines.push('=== MACHINE-READABLE JSON (供程式解析，勿手動編輯) ===');
  lines.push(JSON.stringify(d));
  return lines.join('\n');
}

// ===================== 事件通知信（快、無 AI）=====================
function sendEventMail_(date, r, events) {
  const to = mailTo_();
  if (!to) { Logger.log('未設定 ALERT_EMAIL，略過寄信。'); return; }
  const isShift = String(r['象限轉折'] || '') !== '';
  const subject = (isShift ? '⚡【時鐘轉折｜' + (r['轉折狀態'] || '') + '】' + shortName_(r['校準象限']) +
                             '｜指針 ' + r['指針長度σ'] + 'σ｜' + date
                           : '🔔【時鐘警示】' + date + '｜' + shortName_(r['校準象限']) + '｜' + r['時鐘時刻']);
  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.7;color:#222">' +
    '<h3 style="margin:0 0 10px">美林投資時鐘 事件通知　' + date + '</h3>' +
    '<p><b>🕐 時鐘讀數</b><br>時刻 <b>' + r['時鐘時刻'] + '</b>（角度 ' + r['時鐘角度'] + '°）｜' +
    '指針長度 <b>' + r['指針長度σ'] + 'σ</b>（' + r['訊號強度'] + '）｜動能 ' + r['動能長度σ'] + 'σ 指向 ' + r['動能指向'] + '</p>' +
    '<p><b>📍 定位</b><br>校準象限 ' + r['校準象限'] + '｜方向階段 ' + r['週期階段'] + '<br>' + r['水準方向一致性'] + '</p>' +
    '<p><b>⚠️ 事件</b><br>' + events.map(function (e) { return '・' + e; }).join('<br>') + '</p>' +
    '<p><b>📊 市場</b><br>風險分數 ' + r['風險分數'] + '（' + r['風險分項'] + '）｜VIX ' + r['VIX恐慌指數'] +
    '｜HY OAS ' + r['高收益債利差'] + '（Δ20d ' + r['信用動能Δ20d'] + '）｜10Y-2Y ' + r['利差(10Y-2Y)'] + '</p>' +
    '<p style="color:#777;font-size:12px">指針長度＝離中性有多遠（σ）：&lt;0.5σ 為中性帶、訊號脆弱易翻轉；≥1.0σ 才算體制明確。<br>' +
    '深度分析報告由 Claude 排程另行寄出。本信為量化框架推演，非投資建議。</p></div>';
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
  Logger.log('事件信已寄出：' + subject);
}

// ===================== Gemini 盤前報告（可選，預設關閉）=====================
function sendGeminiMail_(date, r, ctx) {
  const body = generateAiReport_(date, r, ctx);
  const to = mailTo_();
  if (!to) return;
  MailApp.sendEmail({ to: to, subject: '【美林投資時鐘】' + date + ' SPY 量化盤前動態報告',
                      htmlBody: mdToHtml_(body) });
}
function mdToHtml_(md) {
  if (!md) return '';
  const html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,6}\s*(.*)$/gm, '<h3 style="margin:14px 0 6px">$1</h3>')
    .replace(/\n/g, '<br>');
  return '<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.65;color:#222">' + html + '</div>';
}
function generateAiReport_(date, r, ctx) {
  const key = geminiKey_();
  if (!key) return '未設定 Gemini 金鑰。';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
  let transitionBlock = '', transitionRule = '';
  if (ctx) {
    transitionBlock =
      '【⚡ 今日偵測到象限轉折（' + ctx.status + '）】\n' +
      '- 昨日：水準 ' + ctx.prevQuad + '／方向 ' + ctx.prevPhase + '\n' +
      '- 今日：水準 ' + ctx.curQuad + '／方向 ' + ctx.curPhase + '\n' +
      '- 轉折註記：' + ctx.shiftNote + '\n' +
      '- 指針長度：' + r['指針長度σ'] + 'σ（' + r['訊號強度'] + '）；' +
        '轉折狀態判定為「' + ctx.status + '」的依據是指針長度是否 ≥ ' + Z_CONFIRM + 'σ。\n\n';
    transitionRule =
      '\n【特別要求】請在報告最前面新增「⚡ 象限轉折專析」，涵蓋：(a) 哪個座標跨過哪條門檻；' +
      '(b) 判斷屬真體制轉換或中性帶雜訊（依指針長度、水準與方向是否一致、OAS 與 VIX 是否同步確認）；' +
      '(c) 要「確認」還需觀察到什麼可證偽指標；(d) 對 SPY 與資產配置的意涵。\n';
  }
  const prompt =
    '你是專注於全自動宏觀量化交易的頂尖策略分析師。請根據以下指標，撰寫一份 SPY 盤前量化分析報告。\n\n' +
    transitionBlock +
    '【今日核心數據 (' + date + ')】\n' +
    '- 時鐘讀數：時刻 ' + r['時鐘時刻'] + '，指針長度 ' + r['指針長度σ'] + 'σ（' + r['訊號強度'] + '）\n' +
    '- 座標：成長z ' + r['成長z'] + '（CFNAI-MA3 ' + r['CFNAI_MA3'] + '）；通膨z ' + r['通膨z'] +
      '（CPI ' + r['CPI年增率'] + '%）；核心通膨z ' + r['核心通膨z'] + '（核心 CPI ' + r['核心CPI年增率'] + '%）\n' +
    '- 動能：成長動能z ' + r['成長動能z'] + '，通膨動能z ' + r['通膨動能z'] + '，動能指向 ' + r['動能指向'] + '\n' +
    '- 校準象限 ' + r['校準象限'] + '；方向階段 ' + r['週期階段'] + '；' + r['水準方向一致性'] + '\n' +
    '- 資金成本 ' + r['有效聯邦基金利率'] + '%；10Y-2Y ' + r['利差(10Y-2Y)'] + '%；' +
      'HY OAS ' + r['高收益債利差'] + '%（Δ20d ' + r['信用動能Δ20d'] + '）；VIX ' + r['VIX恐慌指數'] + '\n' +
    '- 風險分數 ' + r['風險分數'] + '（' + r['風險分項'] + '）；衰退警示 ' + r['衰退警示'] + '\n' +
    transitionRule + '\n' +
    '【產出規範】Markdown 四區塊：1. 🎯 交易摘要　2. 🧭 時鐘動態與宏觀定價　3. ⏱️ SPY 開盤首小時動能　4. 💡 量化當沖邏輯與風控。\n' +
    '結尾加註：本報告為量化框架推演，非投資建議。';
  const options = { method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }), muteHttpExceptions: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        const cand = json.candidates && json.candidates[0];
        const text = cand && cand.content && cand.content.parts && cand.content.parts[0] &&
                     cand.content.parts[0].text;
        if (text) return text;
      }
      Logger.log('Gemini HTTP ' + res.getResponseCode());
    } catch (e) { Logger.log('Gemini 連線失敗：' + e); }
    Utilities.sleep(1500 * (attempt + 1));
  }
  return '美林投資時鐘更新完成。時刻 ' + r['時鐘時刻'] + '（' + r['指針長度σ'] + 'σ）；校準象限 ' +
         r['校準象限'] + '；方向階段 ' + r['週期階段'] + '。（AI 引擎連線異常，詳細數據請見試算表。）非投資建議。';
}

// ===================== 網頁伺服器 / API =====================
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.api) {
    const tok = apiToken_();
    if (tok && p.token !== tok) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    const days = Math.min(250, Math.max(5, parseInt(p.days || '60', 10) || 60));
    return ContentService.createTextOutput(JSON.stringify(buildDigest_(days)))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('美林投資時鐘動態面板 V4')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 前端資料來源。回傳「JSON 字串」（不是物件）：{rows, cal, meta, debug?}；rows 由新到舊。
 * 為什麼回傳字串？google.script.run 傳輸「大型巢狀物件」時（每列都帶整段歷史解讀長文字，
 * ×數百列）容易序列化失敗、靜默把 null 送到瀏覽器，畫面就會誤顯示「沒有資料」。
 * 字串是 google.script.run 最可靠的回傳型別，前端 JSON.parse 後即可正常使用。
 */
function getClockData(limit) {
  limit = limit || 500;
  const ss = SpreadsheetApp.openById(sheetId_());
  const sheet = ss.getSheets()[0];
  const parsed = getSheetRows_(sheet);
  const cal = getCalibration_(ss, false);
  const rows = parsed.rows.slice(Math.max(0, parsed.rows.length - limit)).map(function (r) {
    const o = {};
    parsed.headers.forEach(function (h) { o[h] = r[h]; });
    o['日期'] = r.__date;
    return o;
  }).reverse();
  var result = { rows: rows, cal: cal, meta: { z_neutral: Z_NEUTRAL_BAND, z_confirm: Z_CONFIRM, r_max: R_MAX_SIGMA } };
  if (!rows.length) {
    result.debug = {
      sheetName: sheet.getName(),
      lastRow: sheet.getLastRow(),
      lastCol: sheet.getLastColumn(),
      headers: parsed.headers.slice(0, 5),
      dCol: parsed.headers.indexOf('日期'),
      parsedRows: parsed.rows.length,
      sheetId: sheetId_()
    };
  }
  return JSON.stringify(result);
}

/** 診斷工具：在 Script 編輯器執行，確認 getClockData 後端有正確回傳資料。 */
function test_getClockData() {
  var raw = getClockData(500);
  Logger.log('回傳型別 = ' + typeof raw + '（應為 string）');
  Logger.log('回傳長度 = ' + (raw ? raw.length : 'null') + ' 字元');
  var obj = JSON.parse(raw);
  Logger.log('rows 筆數 = ' + (obj.rows ? obj.rows.length : 'null'));
  if (obj.rows && obj.rows.length) {
    Logger.log('最新一列日期 = ' + obj.rows[0]['日期']);
    Logger.log('最舊一列日期 = ' + obj.rows[obj.rows.length - 1]['日期']);
  }
  Logger.log('cal = ' + JSON.stringify(obj.cal));
}

/** 診斷工具：在 Script 編輯器執行，查看試算表讀取狀況。 */
function diagnose_DataAccess() {
  var sid = sheetId_();
  Logger.log('SHEET_ID = ' + sid);
  var ss = SpreadsheetApp.openById(sid);
  Logger.log('試算表名稱 = ' + ss.getName());
  var sheets = ss.getSheets();
  Logger.log('分頁數量 = ' + sheets.length);
  sheets.forEach(function(s, i) { Logger.log('  [' + i + '] ' + s.getName() + '  lastRow=' + s.getLastRow() + '  lastCol=' + s.getLastColumn()); });
  var sheet = sheets[0];
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow >= 1 && lastCol >= 1) {
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log('標題列 = ' + JSON.stringify(headers));
    Logger.log('日期欄索引 = ' + headers.indexOf('日期'));
    if (lastRow > 1) {
      var sample = sheet.getRange(2, 1, Math.min(3, lastRow - 1), Math.min(5, lastCol)).getValues();
      Logger.log('前 3 列（前 5 欄）= ' + JSON.stringify(sample));
    }
  } else {
    Logger.log('第一個分頁是空的！');
  }
  var parsed = getSheetRows_(sheet);
  Logger.log('getSheetRows_ 解析到 ' + parsed.rows.length + ' 列');
  if (parsed.rows.length) Logger.log('最舊 = ' + parsed.rows[0].__date + '　最新 = ' + parsed.rows[parsed.rows.length - 1].__date);
}

/** 手動重算校準（換窗期或想強制刷新時執行）。 */
function refresh_Calibration() {
  const ss = SpreadsheetApp.openById(sheetId_());
  Logger.log(JSON.stringify(getCalibration_(ss, true)));
}
/** 手動產生摘要文件（測試 Claude routine 資料來源時用）。 */
function run_ExportDigest() { Logger.log(exportDigest_()); }
