/**
 * StockPool 買進觀察追蹤 v4
 * ------------------------------------------------------------
 * 【資料來源】進場價_database
 *   A 代號
 *   B 名稱
 *   C 🔴Pivot買入點   = 20日高 + 0.10   （最高，突破確認）
 *   D 🟡早期入場      = BB均線突破       （中間）
 *   E 🟢積極入場      = 趨勢線近似       （最低，最積極）
 *   F ⭐深度研究進場價                    （人工研究價；有值就優先）
 *
 * 【優先用深度研究進場價】
 *   某一列的 F 欄有值時，該檔以 F 欄為唯一觸發價（現價 ≤ 深度研究進場價），
 *   C/D/E 三梯仍會顯示並單格標色，但不再觸發整列狀態與通知。
 *   若想讓三梯在有 F 值時照樣觸發，把 CFG.DEEP_OVERRIDES_TIERS 改成 false。
 *
 * 【觸發方向】見 CFG.OP_* 。預設沿用舊版邏輯的形狀：
 *   ⭐ 深度研究進場價 → 現價 ≤ 觸發價
 *   🔴 Pivot買入點    → 現價 ≥ 觸發價（向上突破）
 *   🟡 早期入場       → 現價 ≤ 觸發價（回檔進場）
 *   🟢 積極入場       → 現價 ≤ 觸發價（回檔更深，價格更好）
 *   若你要把三梯都改成「向上穿越」，把 OP_EARLY / OP_AGGR 改成 '≥'，
 *   並把 TIER_PRIORITY 改成 ['deep', 'pivot', 'early', 'aggr']（見該設定的註解）。
 *
 * 【優先序】同時符合多個梯次時，只回報 TIER_PRIORITY 最前面的那一個。
 *   預設 ['deep', 'pivot', 'aggr', 'early']：
 *   深度研究價最優先；其次突破；再來是跌得最深的積極入場；最後才是早期入場。
 *
 * 【StockPool 分類】B 欄「分類」（績優股 / 配息股）
 *   只用於信件分區小標題：績優股在上、配息股在下，其餘分類接在後面。
 *
 * 【只在平日寄信】CFG.MAIL_WEEKDAYS_ONLY = true（預設）
 *   週六、週日不寄通知信；工作表仍會照排程更新，只是不寄信。
 *   週末沒寄的觸發不會被記成「今天已通知」，下一個平日仍在觸發狀態就會補寄。
 *   要連週末也寄，把它改成 false。
 *
 * 首次安裝：
 *   a. 專案設定 → 時區設為 (GMT+08:00) Taipei
 *   b. 執行 setupSheet()    → 寫入 11 欄表頭與格式（含分類下拉選單）
 *   c. 執行 setupTriggers() → 每日 10:00 / 14:00
 *   d. 執行 updateStockPool() 測試
 */

/*** ============ 設定區 ============ ***/
const CFG = {
  POOL_SHEET: 'StockPool',
  DB_SHEET: '進場價_database',

  // 進場價_database 欄位（1=A）
  DB_CODE_COL:  1,   // A 代號
  DB_NAME_COL:  2,   // B 名稱
  DB_PIVOT_COL: 3,   // C 🔴Pivot買入點 = 20日高+0.10
  DB_EARLY_COL: 4,   // D 🟡早期入場    = BB均線突破
  DB_AGGR_COL:  5,   // E 🟢積極入場    = 趨勢線近似
  DB_DEEP_COL:  6,   // F ⭐深度研究進場價（有值優先）
  DB_HEADER_ROWS: 1,

  // StockPool 欄位（B 已插入「分類」，其餘整體右移一欄）
  P_CODE:  1,   // A 代號
  P_CAT:   2,   // B 分類（績優股 / 配息股）
  P_NAME:  3,   // C 名稱
  P_AGGR:  4,   // D 🟢積極入場
  P_EARLY: 5,   // E 🟡早期入場
  P_PIVOT: 6,   // F 🔴Pivot買入點
  P_DEEP:  7,   // G ⭐深度研究進場價
  P_PRICE: 8,   // H 現價
  P_DATE:  9,   // I 更新日期
  P_GAP:  10,   // J 距離進場價
  P_HIT:  11,   // K 觸發狀態
  P_LAST: 11,
  P_HEADER_ROWS: 1,

  MAIL_TO: 'sunbeamichelle@gmail.com',
  MAIL_CC: 'juliahsu13@gmail.com',

  // 只在平日（週一～週五）寄信；週六、週日不寄。
  // 週末排程仍會更新工作表（現價／狀態／顏色照樣刷新），只是不寄信。
  // 週末沒寄出的觸發不會被記進「今天已通知」，下一個平日照樣會通知。
  MAIL_WEEKDAYS_ONLY: true,

  // 觸發方向
  OP_DEEP:  '≤',
  OP_PIVOT: '≥',
  OP_EARLY: '≤',
  OP_AGGR:  '≤',

  // F 欄有值時，是否讓三梯讓位（只用深度研究價觸發）
  DEEP_OVERRIDES_TIERS: true,

  // 同時命中時的回報優先序（改 OP_* 時記得一起改這裡）
  TIER_PRIORITY: ['deep', 'pivot', 'aggr', 'early'],

  // 整列顏色
  BG_DEEP:  '#d9d2e9', FT_DEEP:  '#4c1130',  // ⭐ 深度研究進場價
  BG_PIVOT: '#f8cbad', FT_PIVOT: '#833c00',  // 🔴 Pivot 突破
  BG_AGGR:  '#c6efce', FT_AGGR:  '#006100',  // 🟢 積極入場
  BG_EARLY: '#fff2cc', FT_EARLY: '#7f6000',  // 🟡 早期入場
  BG_NEAR:  '#ddebf7', FT_NEAR:  '#2e75b6',  // 接近下一個觸發點
  BG_ERR:   '#f4cccc', FT_ERR:   '#9c0006',  // 資料異常
  BG_NONE:  null,      FT_NONE:  '#000000',

  // 單格顏色（哪一梯達標，就把那一格單獨標起來）
  CELL_DEEP_BG:  '#e7e0ef', CELL_DEEP_FT:  '#4c1130',
  CELL_PIVOT_BG: '#fbe5d6', CELL_PIVOT_FT: '#833c00',
  CELL_EARLY_BG: '#fff2cc', CELL_EARLY_FT: '#7f6000',
  CELL_AGGR_BG:  '#e2efda', CELL_AGGR_FT:  '#006100',

  NEAR_THRESHOLD: 0.03,   // 距觸發價 3% 以內算「接近」

  // 信件分區順序；不在名單內的分類會依字母序接在後面，空白歸「未分類」
  CAT_ORDER: ['績優股', '配息股'],
  CAT_BLANK: '未分類',
};

// 各梯的靜態描述，供顯示與迴圈使用（順序＝工作表 D~G 的欄位順序）
const TIERS = [
  { key: 'aggr', icon: '🟢', label: '積極入場', desc: '趨勢線近似',
    col: 'P_AGGR', bg: 'BG_AGGR', ft: 'FT_AGGR',
    cellBg: 'CELL_AGGR_BG', cellFt: 'CELL_AGGR_FT', op: 'OP_AGGR' },
  { key: 'early', icon: '🟡', label: '早期入場', desc: 'BB均線突破',
    col: 'P_EARLY', bg: 'BG_EARLY', ft: 'FT_EARLY',
    cellBg: 'CELL_EARLY_BG', cellFt: 'CELL_EARLY_FT', op: 'OP_EARLY' },
  { key: 'pivot', icon: '🔴', label: 'Pivot買入點', desc: '20日高+0.10',
    col: 'P_PIVOT', bg: 'BG_PIVOT', ft: 'FT_PIVOT',
    cellBg: 'CELL_PIVOT_BG', cellFt: 'CELL_PIVOT_FT', op: 'OP_PIVOT' },
  { key: 'deep', icon: '⭐', label: '深度研究進場價', desc: '人工研究價',
    col: 'P_DEEP', bg: 'BG_DEEP', ft: 'FT_DEEP',
    cellBg: 'CELL_DEEP_BG', cellFt: 'CELL_DEEP_FT', op: 'OP_DEEP' },
];

function tier_(key) {
  for (let i = 0; i < TIERS.length; i++) if (TIERS[i].key === key) return TIERS[i];
  return null;
}

// 以「專案時區」的日曆日判斷星期幾（0=日、1=一 … 6=六）。
// 先用時區格式化成 yyyy-MM-dd 再取星期，避免伺服器時區與專案時區不同而差一天。
function tzDay_(d) {
  const p = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd').split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}

// 今天可不可以寄信：MAIL_WEEKDAYS_ONLY 開著時，週六、週日一律不寄
function isMailDay_(d) {
  if (!CFG.MAIL_WEEKDAYS_ONLY) return true;
  const dow = tzDay_(d || new Date());
  return dow >= 1 && dow <= 5;
}

/*** ============ 主流程 ============ ***/
function updateStockPool() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const ss = SpreadsheetApp.getActive();
    const pool = ss.getSheetByName(CFG.POOL_SHEET);
    const db = ss.getSheetByName(CFG.DB_SHEET);
    if (!pool) throw new Error('找不到分頁：' + CFG.POOL_SHEET);
    if (!db) throw new Error('找不到分頁：' + CFG.DB_SHEET);

    const dbMap = buildPriceMap_(db);

    const lastRow = pool.getLastRow();
    const nRows = lastRow - CFG.P_HEADER_ROWS;
    if (nRows < 1) return;

    const s = CFG.P_HEADER_ROWS + 1;
    const codes = pool.getRange(s, CFG.P_CODE, nRows, 1)
                      .getDisplayValues().map(r => String(r[0]).trim());
    const cats  = pool.getRange(s, CFG.P_CAT, nRows, 1)
                      .getDisplayValues().map(r => String(r[0]).trim());
    const names = pool.getRange(s, CFG.P_NAME, nRows, 1)
                      .getDisplayValues().map(r => String(r[0]).trim());

    const priceMap = fetchPrices_(codes.filter(c => c !== ''));

    const tz = Session.getScriptTimeZone();
    const stamp = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd HH:mm');

    const oName = [], oPrice = [], oDate = [], oGap = [], oHit = [];
    const oTier = [];                 // D~G 四欄的價格
    const bgRow = [], ftRow = [];
    const tierBg = [], tierFt = [];   // D~G 四欄各自的顏色
    const events = [];

    const blank4 = ['', '', '', ''];

    for (let i = 0; i < nRows; i++) {
      const code = codes[i];

      if (!code) {
        oName.push([names[i]]);
        oTier.push(blank4.slice());
        oPrice.push(['']); oDate.push(['']); oGap.push(['']); oHit.push(['']);
        bgRow.push(CFG.BG_NONE); ftRow.push(CFG.FT_NONE);
        tierBg.push(TIERS.map(() => CFG.BG_NONE));
        tierFt.push(TIERS.map(() => CFG.FT_NONE));
        continue;
      }

      const rec = dbMap[code] || {};
      const lv = {
        aggr:  num_(rec.aggr),
        early: num_(rec.early),
        pivot: num_(rec.pivot),
        deep:  num_(rec.deep)
      };
      const price = priceMap[code];
      const name = names[i] || rec.name || '';
      const cat = cats[i] || CFG.CAT_BLANK;

      oName.push([name]);
      oTier.push(TIERS.map(t => lv[t.key] === null
        ? (t.key === 'deep' ? '' : '查無')   // 深度研究價沒填是常態，不算「查無」
        : lv[t.key]));
      oPrice.push([price === null || price === undefined ? 'N/A' : price]);
      oDate.push([stamp]);

      const hasPrice = (price !== null && price !== undefined);
      const useDeep = (lv.deep !== null && CFG.DEEP_OVERRIDES_TIERS);

      // --- 各梯是否達標（用於單格標色）---
      const hit = {};
      TIERS.forEach(t => {
        hit[t.key] = hasPrice && lv[t.key] !== null &&
                     compare_(CFG[t.op], price, lv[t.key]);
      });

      // --- 異常處理 ---
      if (!hasPrice) {
        oGap.push(['']); oHit.push(['取價失敗']);
        bgRow.push(CFG.BG_ERR); ftRow.push(CFG.FT_ERR);
        tierBg.push(TIERS.map(() => CFG.BG_ERR));
        tierFt.push(TIERS.map(() => CFG.FT_ERR));
        continue;
      }
      if (lv.deep === null && lv.pivot === null &&
          lv.early === null && lv.aggr === null) {
        oGap.push(['']); oHit.push(['database 查無此代號']);
        bgRow.push(CFG.BG_ERR); ftRow.push(CFG.FT_ERR);
        tierBg.push(TIERS.map(() => CFG.BG_ERR));
        tierFt.push(TIERS.map(() => CFG.FT_ERR));
        continue;
      }

      // --- 距離進場價：有深度研究價就對它算，否則對🟡早期入場算 ---
      const gapBase = lv.deep !== null ? lv.deep : lv.early;
      oGap.push([gapBase === null ? '' : (price - gapBase) / gapBase]);

      // --- 依優先序決定整列狀態（F 欄有值時，三梯讓位）---
      const priority = useDeep ? ['deep'] : CFG.TIER_PRIORITY;
      let label = null, bg = CFG.BG_NONE, ft = CFG.FT_NONE;
      for (let p = 0; p < priority.length; p++) {
        const t = tier_(priority[p]);
        if (!t || !hit[t.key]) continue;
        label = t.icon + ' ' + t.label + ' (' + lv[t.key].toFixed(2) + ')';
        bg = CFG[t.bg]; ft = CFG[t.ft];
        events.push({
          code: code, name: name, cat: cat,
          tier: t.key, icon: t.icon, level: t.label,
          op: CFG[t.op], trigger: lv[t.key], price: price,
          levels: lv, useDeep: useDeep
        });
        break;
      }

      // --- 未觸發：找最接近的下一個觸發點 ---
      if (label === null) {
        const cands = useDeep ? [tier_('deep')] : TIERS;
        let best = null;
        cands.forEach(t => {
          if (lv[t.key] === null) return;
          const d = Math.abs(price - lv[t.key]) / lv[t.key];
          if (d <= CFG.NEAR_THRESHOLD && (best === null || d < best.d)) {
            best = { d: d, t: t };
          }
        });
        if (best) {
          label = '接近 ' + best.t.icon + best.t.label +
                  ' (' + (best.d * 100).toFixed(2) + '%)';
          bg = CFG.BG_NEAR; ft = CFG.FT_NEAR;
        } else {
          label = '—';
        }
      }

      oHit.push([label]);
      bgRow.push(bg); ftRow.push(ft);

      // 三梯即使被深度研究價蓋過，仍保留單格標色供參考
      tierBg.push(TIERS.map(t => hit[t.key] ? CFG[t.cellBg] : bg));
      tierFt.push(TIERS.map(t => hit[t.key] ? CFG[t.cellFt] : ft));
    }

    // --- 寫回數值 ---
    pool.getRange(s, CFG.P_NAME,  nRows, 1).setValues(oName);
    pool.getRange(s, CFG.P_AGGR,  nRows, TIERS.length).setValues(oTier);
    pool.getRange(s, CFG.P_PRICE, nRows, 1).setValues(oPrice);
    pool.getRange(s, CFG.P_DATE,  nRows, 1).setValues(oDate);
    pool.getRange(s, CFG.P_GAP,   nRows, 1).setValues(oGap)
        .setNumberFormat('+0.00%;-0.00%');
    pool.getRange(s, CFG.P_HIT,   nRows, 1).setValues(oHit);

    // --- 先上整列顏色，再用 D~G 四欄覆蓋 ---
    const w = CFG.P_LAST;
    pool.getRange(s, 1, nRows, w)
        .setBackgrounds(bgRow.map(c => new Array(w).fill(c)))
        .setFontColors(ftRow.map(c => new Array(w).fill(c)));
    pool.getRange(s, CFG.P_AGGR, nRows, TIERS.length)
        .setBackgrounds(tierBg)
        .setFontColors(tierFt);

    notifyNewEvents_(events, stamp);

  } finally {
    lock.releaseLock();
  }
}

function compare_(op, price, level) {
  return op === '≥' ? price >= level : price <= level;
}

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/*** ============ database 對照表 ============ ***/
function buildPriceMap_(db) {
  const n = db.getLastRow() - CFG.DB_HEADER_ROWS;
  const map = {};
  if (n < 1) return map;

  const width = Math.max(CFG.DB_CODE_COL, CFG.DB_NAME_COL, CFG.DB_PIVOT_COL,
                         CFG.DB_EARLY_COL, CFG.DB_AGGR_COL, CFG.DB_DEEP_COL);
  const data = db.getRange(CFG.DB_HEADER_ROWS + 1, 1, n, width).getDisplayValues();

  const clean = v => num_(String(v).replace(/,/g, '').trim());

  data.forEach(row => {
    const code = String(row[CFG.DB_CODE_COL - 1]).trim();
    if (!code) return;
    map[code] = {
      name:  String(row[CFG.DB_NAME_COL - 1]).trim(),
      pivot: clean(row[CFG.DB_PIVOT_COL - 1]),
      early: clean(row[CFG.DB_EARLY_COL - 1]),
      aggr:  clean(row[CFG.DB_AGGR_COL  - 1]),
      deep:  clean(row[CFG.DB_DEEP_COL  - 1])
    };
  });
  return map;
}

/*** ============ Yahoo Finance 取價 ============ ***/
function fetchPrices_(codes) {
  const props = PropertiesService.getScriptProperties();
  const result = {};

  const first = codes.map(c => ({ code: c, suffix: props.getProperty('sfx_' + c) || '.TW' }));
  const r1 = doFetch_(first);
  const retry = [];

  first.forEach(it => {
    const p = r1[it.code];
    if (p !== null && p !== undefined) {
      result[it.code] = p;
      props.setProperty('sfx_' + it.code, it.suffix);
    } else {
      retry.push({ code: it.code, suffix: it.suffix === '.TW' ? '.TWO' : '.TW' });
    }
  });

  if (retry.length) {
    const r2 = doFetch_(retry);
    retry.forEach(it => {
      const p = r2[it.code];
      if (p !== null && p !== undefined) {
        result[it.code] = p;
        props.setProperty('sfx_' + it.code, it.suffix);
      } else {
        result[it.code] = null;
      }
    });
  }
  return result;
}

function doFetch_(items) {
  const out = {};
  if (!items.length) return out;

  const requests = items.map(it => ({
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/'
       + encodeURIComponent(it.code + it.suffix) + '?interval=1d&range=1d',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/122.0 Safari/537.36'
    }
  }));

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (e) {
    items.forEach(it => out[it.code] = null);
    return out;
  }

  responses.forEach((res, i) => {
    const code = items[i].code;
    try {
      if (res.getResponseCode() !== 200) { out[code] = null; return; }
      const json = JSON.parse(res.getContentText());
      const r = json && json.chart && json.chart.result && json.chart.result[0];
      let p = r && r.meta ? r.meta.regularMarketPrice : null;
      if (p === null || p === undefined) {
        const q = r.indicators.quote[0].close.filter(v => v !== null);
        p = q.length ? q[q.length - 1] : null;
      }
      out[code] = num_(p);
    } catch (e) {
      out[code] = null;
    }
  });
  return out;
}

/*** ============ Email 通知 ============ ***/
function notifyNewEvents_(events, stamp) {
  if (!events.length) return;

  // 週末不寄信。刻意在寫入「今天已通知」之前就 return：
  // 週末命中的觸發不會被記成已通知，下一個平日還在觸發狀態就會照樣寄。
  if (!isMailDay_()) {
    Logger.log('週末不寄信（CFG.MAIL_WEEKDAYS_ONLY），本次 ' + events.length + ' 筆觸發略過通知');
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const tz = Session.getScriptTimeZone();
  const key = 'notified_' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const done = JSON.parse(props.getProperty(key) || '[]');

  // 同一檔 × 同一梯次，一天只通知一次
  const fresh = events.filter(e => done.indexOf(e.code + '|' + e.tier) === -1);
  if (!fresh.length) return;

  const url = SpreadsheetApp.getActive().getUrl();
  const td = 'padding:6px 10px;border:1px solid #ddd;';

  // --- 依分類分區：績優股在上、配息股在下 ---
  const groups = {};
  fresh.forEach(e => {
    const c = e.cat || CFG.CAT_BLANK;
    (groups[c] = groups[c] || []).push(e);
  });
  const catNames = Object.keys(groups).sort((a, b) => {
    const ia = CFG.CAT_ORDER.indexOf(a), ib = CFG.CAT_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    if (a === CFG.CAT_BLANK) return 1;
    if (b === CFG.CAT_BLANK) return -1;
    return a.localeCompare(b);
  });

  const COLS = 7;
  let body = '';
  catNames.forEach(cat => {
    body +=
      '<tr><td colspan="' + COLS + '" style="padding:10px 10px 6px;background:#eef3f7;' +
      'border:1px solid #ddd;font-weight:bold;font-size:15px;color:#204056;">' +
      cat + '　<span style="font-weight:normal;color:#666;font-size:13px;">' +
      groups[cat].length + ' 筆</span></td></tr>';

    body += groups[cat].map(e => {
      const color = e.tier === 'deep'  ? '#7030a0'
                  : e.tier === 'pivot' ? '#c55a11'
                  : e.tier === 'aggr'  ? '#006100' : '#7f6000';
      return '<tr>' +
        '<td style="' + td + '">' + e.code + '</td>' +
        '<td style="' + td + '">' + e.name + '</td>' +
        '<td style="' + td + 'color:' + color + ';font-weight:bold;">' +
          e.icon + ' ' + e.level + '</td>' +
        '<td style="' + td + 'text-align:center;">' + e.op + '</td>' +
        '<td style="' + td + 'text-align:right;">' + e.trigger.toFixed(2) + '</td>' +
        '<td style="' + td + 'text-align:right;font-weight:bold;">' + e.price.toFixed(2) + '</td>' +
        '<td style="' + td + 'color:#666;font-size:13px;">' + ladder_(e) + '</td>' +
        '</tr>';
    }).join('');
  });

  const html =
    '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif;">' +
    '<h3 style="margin-bottom:4px;">進場價位觸發通知</h3>' +
    '<p style="color:#666;margin-top:0;">檢查時間：' + stamp + '</p>' +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    '<tr style="background:#436379;color:#fff;">' +
      '<th style="' + td + '">代號</th><th style="' + td + '">名稱</th>' +
      '<th style="' + td + '">觸發梯次</th><th style="' + td + '">方向</th>' +
      '<th style="' + td + '">觸發價</th><th style="' + td + '">現價</th>' +
      '<th style="' + td + '">各梯價位</th>' +
    '</tr>' + body + '</table>' +
    '<p style="font-size:13px;color:#666;">' +
    '⭐ 深度研究進場價：現價 ' + CFG.OP_DEEP + ' 觸發價，' +
    '<b>該檔有填就以此為準，三梯僅供參考</b>；' +
    '🔴 Pivot買入點（20日高+0.10）：現價 ' + CFG.OP_PIVOT + ' 觸發價；' +
    '🟡 早期入場（BB均線突破）：現價 ' + CFG.OP_EARLY + ' 觸發價；' +
    '🟢 積極入場（趨勢線近似）：現價 ' + CFG.OP_AGGR + ' 觸發價。' +
    '同一檔同時符合多梯時，只回報優先序最高的一梯。</p>' +
    '<p><a href="' + url + '">開啟 StockPool 試算表</a></p>' +
    '<p style="color:#999;font-size:12px;">報價來源 Yahoo Finance，台股約 15–20 分鐘延遲，' +
    '下單前請以券商即時報價為準。</p></div>';

  MailApp.sendEmail({
    to: CFG.MAIL_TO,
    cc: CFG.MAIL_CC,
    subject: '【Stock Pool 進場觸發】' + fresh.length + ' 筆 — ' + stamp,
    htmlBody: html
  });

  props.setProperty(key, JSON.stringify(done.concat(fresh.map(e => e.code + '|' + e.tier))));
  Object.keys(props.getProperties()).forEach(k => {
    if (k.indexOf('notified_') === 0 && k !== key) props.deleteProperty(k);
  });
}

// 各梯價位一覽，觸發的那一梯加粗；被深度研究價蓋過的三梯以灰字表示僅供參考
function ladder_(e) {
  return TIERS.map(t => {
    const v = e.levels[t.key];
    if (v === null) return t.key === 'deep' ? '' : t.icon + '—';
    const txt = t.icon + v.toFixed(2);
    if (t.key === e.tier) return '<b>' + txt + '</b>';
    if (e.useDeep && t.key !== 'deep') return '<span style="color:#aaa;">' + txt + '</span>';
    return txt;
  }).filter(x => x !== '').join(' / ');
}

/*** ============ 安裝用工具 ============ ***/
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'updateStockPool') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('updateStockPool').timeBased().atHour(10).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('updateStockPool').timeBased().atHour(14).nearMinute(0).everyDays(1).create();
  SpreadsheetApp.getActive().toast('已建立每日 10:00 / 14:00 觸發器');
}

function setupSheet() {
  const pool = SpreadsheetApp.getActive().getSheetByName(CFG.POOL_SHEET);
  pool.setFrozenRows(CFG.P_HEADER_ROWS);
  pool.getRange(1, 1, 1, CFG.P_LAST).setValues([[
    '代號', '分類', '名稱',
    '🟢積極入場\n(趨勢線近似)', '🟡早期入場\n(BB均線突破)', '🔴Pivot買入點\n(20日高+0.10)',
    '⭐深度研究\n進場價', '現價', '更新日期', '距離進場價', '觸發狀態'
  ]]).setFontWeight('bold').setBackground('#436379').setFontColor('#ffffff')
     .setWrap(true).setVerticalAlignment('middle');

  const rows = pool.getMaxRows() - 1;
  pool.getRange(2, CFG.P_CODE, rows, 1).setNumberFormat('@');
  pool.getRange(2, CFG.P_CAT, rows, 1).setNumberFormat('@')
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(CFG.CAT_ORDER, true)
        .setAllowInvalid(true)
        .build());
  pool.getRange(2, CFG.P_AGGR, rows, TIERS.length).setNumberFormat('0.00');
  pool.getRange(2, CFG.P_PRICE, rows, 1).setNumberFormat('0.00');
  pool.autoResizeColumns(1, CFG.P_LAST);
}

// 整個專案只能有一個 onOpen，IBD 匯入的選單也掛在這裡
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('買進觀察')
    .addItem('立即更新', 'updateStockPool')
    .addSeparator()
    .addItem('立即匯入 IBD 買賣點', 'importIBDLevels')
    .addItem('預覽 IBD 來源欄位（不寫入）', 'previewIBDSource')
    .addSeparator()
    .addItem('建立/重設觸發器（每日現價）', 'setupTriggers')
    .addItem('建立/重設觸發器（每週六匯入）', 'setupWeeklyImportTrigger')
    .addItem('初始化表頭格式', 'setupSheet')
    .addItem('清除今日通知紀錄', 'resetNotifyMemory')
    .addToUi();
}

function resetNotifyMemory() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => {
    if (k.indexOf('notified_') === 0) props.deleteProperty(k);
  });
  SpreadsheetApp.getActive().toast('已清除通知紀錄，下次觸發會重新寄信');
}
