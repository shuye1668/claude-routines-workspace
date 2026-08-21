/**
 * StockPool 買進觀察追蹤 v5
 * ------------------------------------------------------------
 * 【v5 變更重點】
 *   1. 原 `進場價_database` 分頁改名為 `IBD進場價_database`（本檔用 CFG.DB_SHEET 對應）。
 *   2. IBD進場價_database 新增 G 欄「深度研究進場價_更新日期」（格式範例 2026/8/21）：
 *      StockPool 多一欄顯示研究日期，⭐深度研究價觸發時 Email 也一併標註。
 *   3. 新增 `XQ動態進場價_database` 分頁：欄位數不固定，本檔「自動讀取表頭欄名與價格」，
 *      每個價格欄都當一梯「回檔進場價」（現價 ≤ 觸發價才通知），
 *      並在 StockPool「動態展開成多欄」呈現。
 *
 * 【資料來源 1：IBD進場價_database】
 *   A 代號
 *   B 名稱
 *   C 🔴Pivot買入點   = 20日高 + 0.10   （最高，突破確認）
 *   D 🟡早期入場      = BB均線突破       （中間）
 *   E 🟢積極入場      = 趨勢線近似       （最低，最積極）
 *   F ⭐深度研究進場價                    （人工研究價；有值就優先）
 *   G ⭐深度研究進場價_更新日期           （人工填的研究日期，格式 2026/8/21；只顯示不觸發）
 *
 * 【資料來源 2：XQ動態進場價_database】（欄位尚未固定，全自動偵測）
 *   - 以表頭關鍵字找「代號」「名稱」欄；其餘「表頭非空、且該欄至少有一格是數字」的欄位，
 *     一律視為一梯 XQ 動態進場價，欄名直接沿用你在表頭寫的字。
 *   - 你之後在這張表新增／刪除價格欄，StockPool 會自動跟著多／少一欄，不必改程式。
 *   - 觸發方向：現價 ≤ 觸發價（回檔進場）。若某欄想改成突破價（≥），見 CFG.OP_XQ 說明。
 *
 * 【優先用深度研究進場價】
 *   某一列的 F 欄有值時，該檔 IBD 三梯（C/D/E）讓位，只用 F 欄觸發整列狀態；
 *   三梯仍會顯示並單格標色，但不再觸發整列狀態與通知。
 *   XQ 動態進場價是「獨立訊號源」，不受深度研究價讓位影響，會各自觸發並通知。
 *   若想讓 IBD 三梯在有 F 值時照樣觸發，把 CFG.DEEP_OVERRIDES_TIERS 改成 false。
 *
 * 【觸發方向】見 CFG.OP_* 。
 *   ⭐ 深度研究進場價 → 現價 ≤ 觸發價
 *   🔴 Pivot買入點    → 現價 ≥ 觸發價（向上突破）
 *   🟡 早期入場       → 現價 ≤ 觸發價（回檔進場）
 *   🟢 積極入場       → 現價 ≤ 觸發價（回檔更深，價格更好）
 *   📊 XQ動態進場價   → 現價 ≤ 觸發價（回檔進場）
 *
 * 【優先序】IBD 同時符合多梯時，只回報 TIER_PRIORITY 最前面的那一個；
 *   XQ 各梯則各自獨立回報（每欄一筆通知）。整列狀態會把 IBD 與 XQ 觸發合併顯示。
 *
 * 【StockPool 分類】B 欄「分類」（績優股 / 配息股）只用於信件分區小標題。
 *
 * 首次安裝：
 *   a. 專案設定 → 時區設為 (GMT+08:00) Taipei
 *   b. 執行 setupSheet()    → 依目前 XQ 欄位寫入表頭與格式（含分類下拉選單）
 *   c. 執行 setupTriggers() → 每日 10:00 / 14:00
 *   d. 執行 updateStockPool() 測試
 *   ※ StockPool 從 D 欄（含）以右都由程式維護，會依 XQ 欄位數自動重排，
 *     只有 A 代號 / B 分類 / C 名稱 是你手動輸入、程式不會覆蓋的欄位。
 */

/*** ============ 設定區 ============ ***/
const CFG = {
  POOL_SHEET: 'StockPool',
  DB_SHEET: 'IBD進場價_database',       // v5：原「進場價_database」改名
  XQ_SHEET: 'XQ動態進場價_database',    // v5：新增的 XQ 動態進場價來源

  // IBD進場價_database 欄位（1=A）
  DB_CODE_COL:      1,   // A 代號
  DB_NAME_COL:      2,   // B 名稱
  DB_PIVOT_COL:     3,   // C 🔴Pivot買入點 = 20日高+0.10
  DB_EARLY_COL:     4,   // D 🟡早期入場    = BB均線突破
  DB_AGGR_COL:      5,   // E 🟢積極入場    = 趨勢線近似
  DB_DEEP_COL:      6,   // F ⭐深度研究進場價（有值優先）
  DB_DEEP_DATE_COL: 7,   // G ⭐深度研究進場價_更新日期（格式 2026/8/21，只顯示不觸發）
  DB_HEADER_ROWS: 1,

  // XQ動態進場價_database
  XQ_HEADER_ROWS: 1,

  // StockPool「固定左側」欄位（A 代號 / B 分類 / C 名稱 為手動輸入，程式不覆蓋）
  P_CODE: 1,   // A 代號
  P_CAT:  2,   // B 分類（績優股 / 配息股）
  P_NAME: 3,   // C 名稱
  P_HEADER_ROWS: 1,
  //  D~G  ：🟢積極 / 🟡早期 / 🔴Pivot / ⭐深度研究進場價（TIERS 四梯，程式維護）
  //  H    ：⭐深度研究更新日期（程式維護）
  //  I..  ：XQ 動態進場價（依 XQ_SHEET 欄位數動態展開，程式維護）
  //  之後 ：現價 / 更新日期 / 距離進場價 / 觸發狀態（程式維護）
  //  ※ 實際欄位位置由 poolLayout_() 依 XQ 欄位數在執行時計算。

  MAIL_TO: 'sunbeamichelle@gmail.com',
  MAIL_CC: 'juliahsu13@gmail.com',

  // 觸發方向
  OP_DEEP:  '≤',
  OP_PIVOT: '≥',
  OP_EARLY: '≤',
  OP_AGGR:  '≤',
  OP_XQ:    '≤',   // XQ 動態進場價一律回檔進場（現價≤觸發價）。
                   // 若日後某些 XQ 欄是「突破價」需要改成 ≥，最乾淨的做法是
                   // 在 XQ 表把那些欄名字含「突破 / Pivot / 高 / 壓」，
                   // 再把本設定改成依欄名判斷（見 xqOp_()）；預設全部用此值。

  // F 欄有值時，是否讓 IBD 三梯讓位（只用深度研究價觸發；不影響 XQ）
  DEEP_OVERRIDES_TIERS: true,

  // IBD 同時命中時的回報優先序（改 OP_* 時記得一起改這裡）
  TIER_PRIORITY: ['deep', 'pivot', 'aggr', 'early'],

  // 整列顏色
  BG_DEEP:  '#d9d2e9', FT_DEEP:  '#4c1130',  // ⭐ 深度研究進場價
  BG_PIVOT: '#f8cbad', FT_PIVOT: '#833c00',  // 🔴 Pivot 突破
  BG_AGGR:  '#c6efce', FT_AGGR:  '#006100',  // 🟢 積極入場
  BG_EARLY: '#fff2cc', FT_EARLY: '#7f6000',  // 🟡 早期入場
  BG_XQ:    '#bdd7ee', FT_XQ:    '#1f4e79',  // 📊 XQ 動態進場價
  BG_NEAR:  '#ddebf7', FT_NEAR:  '#2e75b6',  // 接近下一個觸發點
  BG_ERR:   '#f4cccc', FT_ERR:   '#9c0006',  // 資料異常
  BG_NONE:  null,      FT_NONE:  '#000000',

  // 單格顏色（哪一梯達標，就把那一格單獨標起來）
  CELL_DEEP_BG:  '#e7e0ef', CELL_DEEP_FT:  '#4c1130',
  CELL_PIVOT_BG: '#fbe5d6', CELL_PIVOT_FT: '#833c00',
  CELL_EARLY_BG: '#fff2cc', CELL_EARLY_FT: '#7f6000',
  CELL_AGGR_BG:  '#e2efda', CELL_AGGR_FT:  '#006100',
  CELL_XQ_BG:    '#deebf7', CELL_XQ_FT:    '#1f4e79',

  NEAR_THRESHOLD: 0.03,   // 距觸發價 3% 以內算「接近」

  // 信件分區順序；不在名單內的分類會依字母序接在後面，空白歸「未分類」
  CAT_ORDER: ['績優股', '配息股'],
  CAT_BLANK: '未分類',
};

// IBD 各梯的靜態描述（順序＝工作表 D~G 的欄位順序）
const TIERS = [
  { key: 'aggr', icon: '🟢', label: '積極入場', desc: '趨勢線近似',
    bg: 'BG_AGGR', ft: 'FT_AGGR', cellBg: 'CELL_AGGR_BG', cellFt: 'CELL_AGGR_FT', op: 'OP_AGGR' },
  { key: 'early', icon: '🟡', label: '早期入場', desc: 'BB均線突破',
    bg: 'BG_EARLY', ft: 'FT_EARLY', cellBg: 'CELL_EARLY_BG', cellFt: 'CELL_EARLY_FT', op: 'OP_EARLY' },
  { key: 'pivot', icon: '🔴', label: 'Pivot買入點', desc: '20日高+0.10',
    bg: 'BG_PIVOT', ft: 'FT_PIVOT', cellBg: 'CELL_PIVOT_BG', cellFt: 'CELL_PIVOT_FT', op: 'OP_PIVOT' },
  { key: 'deep', icon: '⭐', label: '深度研究進場價', desc: '人工研究價',
    bg: 'BG_DEEP', ft: 'FT_DEEP', cellBg: 'CELL_DEEP_BG', cellFt: 'CELL_DEEP_FT', op: 'OP_DEEP' },
];

function tier_(key) {
  for (let i = 0; i < TIERS.length; i++) if (TIERS[i].key === key) return TIERS[i];
  return null;
}

// XQ 每欄的觸發方向：預設一律用 CFG.OP_XQ。
// 若日後要「依欄名自動判斷」，把下面那行註解打開即可（欄名含突破類字眼→≥）。
function xqOp_(name) {
  // if (/突破|pivot|新高|創高|壓力|上緣/i.test(String(name))) return '≥';
  return CFG.OP_XQ;
}

/*** ============ StockPool 動態版面 ============ ***/
// 依 XQ 梯數計算各欄位置。固定左側 8 欄 → XQ 區 → 固定右側 4 欄。
function poolLayout_(nXQ) {
  const XQ_START = 9;                 // A~H 共 8 欄之後
  return {
    CODE: 1, CAT: 2, NAME: 3,
    AGGR: 4, EARLY: 5, PIVOT: 6, DEEP: 7,   // TIERS 四梯（順序同 TIERS）
    DEEPDATE: 8,                            // ⭐深度研究更新日期
    XQ_START: XQ_START,
    XQ_COUNT: nXQ,
    PRICE: XQ_START + nXQ,
    DATE:  XQ_START + nXQ + 1,
    GAP:   XQ_START + nXQ + 2,
    HIT:   XQ_START + nXQ + 3,
    LAST:  XQ_START + nXQ + 3,
  };
}

function poolHeaders_(xqTiers) {
  const h = [
    '代號', '分類', '名稱',
    '🟢積極入場\n(趨勢線近似)', '🟡早期入場\n(BB均線突破)', '🔴Pivot買入點\n(20日高+0.10)',
    '⭐深度研究\n進場價', '⭐深度研究\n更新日期',
  ];
  xqTiers.forEach(t => h.push('📊XQ\n' + t.name));
  h.push('現價', '更新日期', '距離進場價', '觸發狀態');
  return h;
}

// 寫入／重排表頭，確保欄數與 XQ 梯數一致，並清掉多餘的舊 XQ 欄。回傳版面物件 L。
function applyPoolLayout_(pool, xqTiers) {
  const L = poolLayout_(xqTiers.length);
  const need = L.LAST;

  const maxCols = pool.getMaxColumns();
  if (maxCols < need) pool.insertColumnsAfter(maxCols, need - maxCols);

  pool.setFrozenRows(CFG.P_HEADER_ROWS);
  pool.getRange(1, 1, 1, need).setValues([poolHeaders_(xqTiers)])
      .setFontWeight('bold').setBackground('#436379').setFontColor('#ffffff')
      .setWrap(true).setVerticalAlignment('middle');

  // 清掉版面右側殘留的舊欄（例如上次 XQ 欄較多時留下的內容與底色）
  const maxCols2 = pool.getMaxColumns();
  if (maxCols2 > need) {
    pool.getRange(1, need + 1, pool.getMaxRows(), maxCols2 - need)
        .clearContent().setBackground(null).setFontColor(null);
  }
  return L;
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

    // XQ 動態來源（分頁可以還不存在；不存在就當作 0 梯）
    const xqSheet = ss.getSheetByName(CFG.XQ_SHEET);
    const xq = buildXQMap_(xqSheet);       // { tiers:[{name,col,op}], map:{code:{name:price}} }
    const xqTiers = xq.tiers;
    const nXQ = xqTiers.length;

    // 先把 StockPool 版面對齊目前的 XQ 欄位
    const L = applyPoolLayout_(pool, xqTiers);

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

    const oName = [], oDeepDate = [], oPrice = [], oDate = [], oGap = [], oHit = [];
    const oTier = [];                 // D~G 四梯的價格
    const oXQ = [];                   // XQ 動態各梯的價格
    const bgRow = [], ftRow = [];
    const tierBg = [], tierFt = [];   // D~G 四梯各自的顏色
    const xqBg = [], xqFt = [];       // XQ 各梯各自的顏色
    const events = [];

    const blank4 = ['', '', '', ''];
    const blankXQ = new Array(nXQ).fill('');

    for (let i = 0; i < nRows; i++) {
      const code = codes[i];

      if (!code) {
        oName.push([names[i]]);
        oTier.push(blank4.slice());
        oDeepDate.push(['']);
        oXQ.push(blankXQ.slice());
        oPrice.push(['']); oDate.push(['']); oGap.push(['']); oHit.push(['']);
        bgRow.push(CFG.BG_NONE); ftRow.push(CFG.FT_NONE);
        tierBg.push(TIERS.map(() => CFG.BG_NONE));
        tierFt.push(TIERS.map(() => CFG.FT_NONE));
        xqBg.push(blankXQ.map(() => CFG.BG_NONE));
        xqFt.push(blankXQ.map(() => CFG.FT_NONE));
        continue;
      }

      const rec = dbMap[code] || {};
      const lv = {
        aggr:  num_(rec.aggr),
        early: num_(rec.early),
        pivot: num_(rec.pivot),
        deep:  num_(rec.deep)
      };
      const deepDate = String(rec.deepDate || '').trim();
      const price = priceMap[code];
      const name = names[i] || rec.name || '';
      const cat = cats[i] || CFG.CAT_BLANK;

      // XQ 各梯的值（依 xqTiers 順序），以及 name→value 對照（供 Email 一覽）
      const xqRec = xq.map[code] || xq.map[normCode_(code)] || {};
      const xqArr = xqTiers.map(t => num_(xqRec[t.name]));
      const xqLevels = {};
      xqTiers.forEach((t, k) => { xqLevels[t.name] = xqArr[k]; });

      oName.push([name]);
      oTier.push(TIERS.map(t => lv[t.key] === null
        ? (t.key === 'deep' ? '' : '查無')   // 深度研究價沒填是常態，不算「查無」
        : lv[t.key]));
      oDeepDate.push([deepDate]);
      oXQ.push(xqArr.map(v => v === null ? '' : v));
      oPrice.push([price === null || price === undefined ? 'N/A' : price]);
      oDate.push([stamp]);

      const hasPrice = (price !== null && price !== undefined);
      const useDeep = (lv.deep !== null && CFG.DEEP_OVERRIDES_TIERS);

      // --- 各梯是否達標（用於單格標色與事件）---
      const hit = {};
      TIERS.forEach(t => {
        hit[t.key] = hasPrice && lv[t.key] !== null &&
                     compare_(CFG[t.op], price, lv[t.key]);
      });
      const xqHit = xqTiers.map((t, k) =>
        hasPrice && xqArr[k] !== null && compare_(t.op, price, xqArr[k]));

      // --- 異常處理 ---
      if (!hasPrice) {
        oGap.push(['']); oHit.push(['取價失敗']);
        bgRow.push(CFG.BG_ERR); ftRow.push(CFG.FT_ERR);
        tierBg.push(TIERS.map(() => CFG.BG_ERR));
        tierFt.push(TIERS.map(() => CFG.FT_ERR));
        xqBg.push(xqArr.map(() => CFG.BG_ERR));
        xqFt.push(xqArr.map(() => CFG.FT_ERR));
        continue;
      }
      const noIbd = lv.deep === null && lv.pivot === null &&
                    lv.early === null && lv.aggr === null;
      const noXq = xqArr.every(v => v === null);
      if (noIbd && noXq) {
        oGap.push(['']); oHit.push(['database 查無此代號']);
        bgRow.push(CFG.BG_ERR); ftRow.push(CFG.FT_ERR);
        tierBg.push(TIERS.map(() => CFG.BG_ERR));
        tierFt.push(TIERS.map(() => CFG.FT_ERR));
        xqBg.push(xqArr.map(() => CFG.BG_ERR));
        xqFt.push(xqArr.map(() => CFG.FT_ERR));
        continue;
      }

      // --- 距離進場價：深度研究價 > 早期入場 > 第一個有值的 XQ ---
      let gapBase = lv.deep !== null ? lv.deep : (lv.early !== null ? lv.early : null);
      if (gapBase === null) {
        for (let k = 0; k < xqArr.length; k++) {
          if (xqArr[k] !== null) { gapBase = xqArr[k]; break; }
        }
      }
      oGap.push([gapBase === null ? '' : (price - gapBase) / gapBase]);

      // --- IBD 依優先序決定觸發（F 欄有值時三梯讓位）---
      let ibdLabel = null, bg = CFG.BG_NONE, ft = CFG.FT_NONE;
      const priority = useDeep ? ['deep'] : CFG.TIER_PRIORITY;
      for (let p = 0; p < priority.length; p++) {
        const t = tier_(priority[p]);
        if (!t || !hit[t.key]) continue;
        ibdLabel = t.icon + ' ' + t.label + ' (' + lv[t.key].toFixed(2) + ')';
        bg = CFG[t.bg]; ft = CFG[t.ft];
        events.push({
          code: code, name: name, cat: cat, source: 'ibd',
          tier: t.key, icon: t.icon, level: t.label,
          op: CFG[t.op], trigger: lv[t.key], price: price,
          levels: lv, useDeep: useDeep, deepDate: deepDate
        });
        break;
      }

      // --- XQ 各梯獨立觸發（每欄各自一筆事件）---
      const xqParts = [];
      xqTiers.forEach((t, k) => {
        if (!xqHit[k]) return;
        const v = xqArr[k];
        xqParts.push('📊' + t.name + '(' + v.toFixed(2) + ')');
        events.push({
          code: code, name: name, cat: cat, source: 'xq',
          tier: 'xq', icon: '📊', level: t.name,
          op: t.op, trigger: v, price: price, xqLevels: xqLevels
        });
      });

      // --- 合併整列狀態 ---
      let label = null;
      const parts = [];
      if (ibdLabel) parts.push(ibdLabel);
      if (xqParts.length) {
        parts.push(xqParts.join(' '));
        if (!ibdLabel) { bg = CFG.BG_XQ; ft = CFG.FT_XQ; }
      }
      if (parts.length) {
        label = parts.join(' ＋ ');
      } else {
        // --- 未觸發：找最接近的下一個觸發點（含 XQ）---
        let best = null;
        const consider = (icon, lbl, lvl) => {
          if (lvl === null) return;
          const d = Math.abs(price - lvl) / lvl;
          if (d <= CFG.NEAR_THRESHOLD && (best === null || d < best.d)) {
            best = { d: d, icon: icon, label: lbl };
          }
        };
        if (useDeep) consider('⭐', '深度研究進場價', lv.deep);
        else TIERS.forEach(t => consider(t.icon, t.label, lv[t.key]));
        xqTiers.forEach((t, k) => consider('📊', t.name, xqArr[k]));

        if (best) {
          label = '接近 ' + best.icon + best.label + ' (' + (best.d * 100).toFixed(2) + '%)';
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
      xqBg.push(xqTiers.map((t, k) => xqHit[k] ? CFG.CELL_XQ_BG : bg));
      xqFt.push(xqTiers.map((t, k) => xqHit[k] ? CFG.CELL_XQ_FT : ft));
    }

    // --- 寫回數值 ---
    pool.getRange(s, L.NAME,     nRows, 1).setValues(oName);
    pool.getRange(s, L.AGGR,     nRows, TIERS.length).setValues(oTier).setNumberFormat('0.00');
    pool.getRange(s, L.DEEPDATE, nRows, 1).setValues(oDeepDate).setNumberFormat('@');
    if (nXQ > 0) {
      pool.getRange(s, L.XQ_START, nRows, nXQ).setValues(oXQ).setNumberFormat('0.00');
    }
    pool.getRange(s, L.PRICE, nRows, 1).setValues(oPrice).setNumberFormat('0.00');
    pool.getRange(s, L.DATE,  nRows, 1).setValues(oDate);
    pool.getRange(s, L.GAP,   nRows, 1).setValues(oGap).setNumberFormat('+0.00%;-0.00%');
    pool.getRange(s, L.HIT,   nRows, 1).setValues(oHit);

    // --- 先上整列顏色，再用各梯欄覆蓋 ---
    const w = L.LAST;
    pool.getRange(s, 1, nRows, w)
        .setBackgrounds(bgRow.map(c => new Array(w).fill(c)))
        .setFontColors(ftRow.map(c => new Array(w).fill(c)));
    pool.getRange(s, L.AGGR, nRows, TIERS.length)
        .setBackgrounds(tierBg)
        .setFontColors(tierFt);
    if (nXQ > 0) {
      pool.getRange(s, L.XQ_START, nRows, nXQ)
          .setBackgrounds(xqBg)
          .setFontColors(xqFt);
    }

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

/*** ============ IBD進場價_database 對照表 ============ ***/
function buildPriceMap_(db) {
  const n = db.getLastRow() - CFG.DB_HEADER_ROWS;
  const map = {};
  if (n < 1) return map;

  const width = Math.max(CFG.DB_CODE_COL, CFG.DB_NAME_COL, CFG.DB_PIVOT_COL,
                         CFG.DB_EARLY_COL, CFG.DB_AGGR_COL, CFG.DB_DEEP_COL,
                         CFG.DB_DEEP_DATE_COL);
  const data = db.getRange(CFG.DB_HEADER_ROWS + 1, 1, n, width).getDisplayValues();

  const clean = v => num_(String(v).replace(/,/g, '').trim());

  data.forEach(row => {
    const code = String(row[CFG.DB_CODE_COL - 1]).trim();
    if (!code) return;
    map[code] = {
      name:     String(row[CFG.DB_NAME_COL - 1]).trim(),
      pivot:    clean(row[CFG.DB_PIVOT_COL - 1]),
      early:    clean(row[CFG.DB_EARLY_COL - 1]),
      aggr:     clean(row[CFG.DB_AGGR_COL  - 1]),
      deep:     clean(row[CFG.DB_DEEP_COL  - 1]),
      deepDate: String(row[CFG.DB_DEEP_DATE_COL - 1]).trim()   // 研究日期字串，如 2026/8/21
    };
  });
  return map;
}

/*** ============ XQ動態進場價_database 對照表（全自動偵測欄位） ============ ***/
// 回傳 { tiers:[{name,col,op}], map:{ code:{ 欄名:價格,... } } }
//   - 以表頭關鍵字找「代號」「名稱」欄（找不到代號就退回 A 欄）
//   - 其餘「表頭非空、且至少一格是數字」的欄位一律當一梯 XQ 進場價，欄名沿用表頭文字
function buildXQMap_(xq) {
  const out = { tiers: [], map: {} };
  if (!xq) return out;

  const lastRow = xq.getLastRow();
  const lastCol = xq.getLastColumn();
  const n = lastRow - CFG.XQ_HEADER_ROWS;
  if (n < 1 || lastCol < 1) return out;

  const header = xq.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const data = xq.getRange(CFG.XQ_HEADER_ROWS + 1, 1, n, lastCol).getDisplayValues();
  const clean = v => num_(String(v).replace(/,/g, '').trim());

  // 找代號 / 名稱欄（沿用 IBD 匯入那套關鍵字比對）
  let codeCol = -1, nameCol = -1;
  for (let c = 0; c < lastCol; c++) {
    if (codeCol < 0 && matchKey_(header[c], IBD_KEYS.code)) { codeCol = c; continue; }
    if (nameCol < 0 && matchKey_(header[c], IBD_KEYS.name)) { nameCol = c; }
  }
  if (codeCol < 0) codeCol = 0;   // 退回 A 欄

  // 其餘欄位：表頭非空、非代號/名稱、且至少一格有數字 → 視為一梯 XQ 進場價
  const tierCols = [];
  for (let c = 0; c < lastCol; c++) {
    if (c === codeCol || c === nameCol) continue;
    const name = String(header[c] === undefined ? '' : header[c]).replace(/[\r\n]+/g, ' ').trim();
    if (!name) continue;
    let hasNum = false;
    for (let r = 0; r < n; r++) {
      if (clean(data[r][c]) !== null) { hasNum = true; break; }
    }
    if (hasNum) tierCols.push({ name: name, col: c, op: xqOp_(name) });
  }
  out.tiers = tierCols;

  data.forEach(row => {
    const code = normCode_(row[codeCol]);
    if (!code) return;
    const rec = {};
    tierCols.forEach(t => { rec[t.name] = clean(row[t.col]); });
    out.map[code] = rec;
  });
  return out;
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

  const props = PropertiesService.getScriptProperties();
  const tz = Session.getScriptTimeZone();
  const key = 'notified_' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const done = JSON.parse(props.getProperty(key) || '[]');

  // 去重鍵：IBD 用 代號|梯次；XQ 用 代號|xq:欄名（每欄各自一天一次）
  const keyOf = e => e.code + '|' + (e.source === 'xq' ? 'xq:' + e.level : e.tier);

  // 同一去重鍵一天只通知一次
  const fresh = events.filter(e => done.indexOf(keyOf(e)) === -1);
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
                  : e.tier === 'aggr'  ? '#006100'
                  : e.tier === 'xq'    ? '#1f4e79' : '#7f6000';
      // ⭐深度研究進場價觸發時，一併標註研究日期
      const levelText = (e.tier === 'deep' && e.deepDate)
        ? (e.level + '（研究日 ' + e.deepDate + '）') : e.level;
      return '<tr>' +
        '<td style="' + td + '">' + e.code + '</td>' +
        '<td style="' + td + '">' + e.name + '</td>' +
        '<td style="' + td + 'color:' + color + ';font-weight:bold;">' +
          e.icon + ' ' + levelText + '</td>' +
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
    '<b>該檔有填就以此為準，IBD 三梯僅供參考</b>（觸發時標註研究日期）；' +
    '🔴 Pivot買入點（20日高+0.10）：現價 ' + CFG.OP_PIVOT + ' 觸發價；' +
    '🟡 早期入場（BB均線突破）：現價 ' + CFG.OP_EARLY + ' 觸發價；' +
    '🟢 積極入場（趨勢線近似）：現價 ' + CFG.OP_AGGR + ' 觸發價；' +
    '📊 XQ動態進場價：現價 ' + CFG.OP_XQ + ' 觸發價（獨立訊號源，各欄各自通知）。' +
    'IBD 同一檔同時符合多梯時只回報優先序最高的一梯；XQ 各欄各自回報。</p>' +
    '<p><a href="' + url + '">開啟 StockPool 試算表</a></p>' +
    '<p style="color:#999;font-size:12px;">報價來源 Yahoo Finance，台股約 15–20 分鐘延遲，' +
    '下單前請以券商即時報價為準。</p></div>';

  MailApp.sendEmail({
    to: CFG.MAIL_TO,
    cc: CFG.MAIL_CC,
    subject: '【Stock Pool 進場觸發】' + fresh.length + ' 筆 — ' + stamp,
    htmlBody: html
  });

  props.setProperty(key, JSON.stringify(done.concat(fresh.map(keyOf))));
  Object.keys(props.getProperties()).forEach(k => {
    if (k.indexOf('notified_') === 0 && k !== key) props.deleteProperty(k);
  });
}

// 各梯價位一覽，觸發的那一梯加粗
//   - IBD 事件：列出 IBD 四梯；被深度研究價蓋過的三梯以灰字表示僅供參考
//   - XQ  事件：列出該檔所有 XQ 動態價
function ladder_(e) {
  if (e.source === 'xq') {
    const xl = e.xqLevels || {};
    return Object.keys(xl).map(k => {
      const v = xl[k];
      if (v === null || v === undefined) return '';
      const txt = '📊' + k + ' ' + v.toFixed(2);
      return k === e.level ? '<b>' + txt + '</b>' : txt;
    }).filter(x => x !== '').join(' / ');
  }
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
  const ss = SpreadsheetApp.getActive();
  const pool = ss.getSheetByName(CFG.POOL_SHEET);
  if (!pool) throw new Error('找不到分頁：' + CFG.POOL_SHEET);

  const xq = buildXQMap_(ss.getSheetByName(CFG.XQ_SHEET));
  const L = applyPoolLayout_(pool, xq.tiers);

  const rows = pool.getMaxRows() - 1;
  pool.getRange(2, L.CODE, rows, 1).setNumberFormat('@');
  pool.getRange(2, L.CAT, rows, 1).setNumberFormat('@')
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(CFG.CAT_ORDER, true)
        .setAllowInvalid(true)
        .build());
  pool.getRange(2, L.AGGR, rows, TIERS.length).setNumberFormat('0.00');
  pool.getRange(2, L.DEEPDATE, rows, 1).setNumberFormat('@');
  if (L.XQ_COUNT > 0) pool.getRange(2, L.XQ_START, rows, L.XQ_COUNT).setNumberFormat('0.00');
  pool.getRange(2, L.PRICE, rows, 1).setNumberFormat('0.00');
  pool.autoResizeColumns(1, L.LAST);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('買進觀察')
    .addItem('立即更新', 'updateStockPool')
    .addSeparator()
    .addItem('建立/重設觸發器', 'setupTriggers')
    .addItem('初始化表頭格式', 'setupSheet')
    .addItem('清除今日通知紀錄', 'resetNotifyMemory')
    .addSeparator()
    .addItem('IBD 立即匯入', 'importIBDLevels')
    .addItem('預覽 IBD 來源欄位', 'previewIBDSource')
    .addToUi();
}

function resetNotifyMemory() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => {
    if (k.indexOf('notified_') === 0) props.deleteProperty(k);
  });
  SpreadsheetApp.getActive().toast('已清除通知紀錄，下次觸發會重新寄信');
}

/**
 * IBD 買賣點總表 → IBD進場價_database 每週匯入
 * ------------------------------------------------------------
 * 每週六早上從 Google Drive 讀
 *   📐 IBD買賣點總表（工具）.csv
 * 的 U / V / W 三欄：
 *   U 🔴Pivot買入點 = 20日高+0.10
 *   V 🟡早期入場    = BB均線突破
 *   W 🟢積極入場    = 趨勢線近似
 * 寫回「IBD進場價_database」的 C / D / E 三欄。
 *
 * 【來源檔怎麼找】這份 CSV 每天從地端同步覆蓋，檔案 ID 可能每天都不一樣，
 *   只有檔名固定，所以一律用「資料夾 + 檔名」找，不靠 ID：
 *   排除垃圾桶裡的殘骸，同名有多份時取最後更新時間最新的那一份；
 *   檔名被改過就退回關鍵字比對（含「總表」優先，不會誤抓「計算器」）。
 *   來源檔超過 STALE_DAYS 天沒更新會在摘要與信件裡示警（地端同步壞掉的保險）。
 *
 * 【欄位解析】以表頭關鍵字為主（Pivot／早期／積極、代號、名稱），
 *   找不到才退回固定位置 U/V/W。實際用到哪幾欄會寫進 Logger 與匯入摘要，
 *   也可以用選單「預覽 IBD 來源欄位」先確認再正式跑。
 *
 * 【不會動到的東西】
 *   - F 欄「深度研究進場價」、G 欄「深度研究進場價_更新日期」都是人工填的，匯入完全不碰。
 *   - CSV 裡沒出現的代號，database 既有資料原樣保留（只會列在摘要裡）。
 *   - 某一格在 CSV 是空的／非數字，該格保留原值，不會被清成空白。
 *
 * 安裝：
 *   a. 執行 previewIBDSource()        → 確認欄位對到正確位置
 *   b. 執行 setupWeeklyImportTrigger() → 每週六 08:00
 *   c. 執行 importIBDLevels() 測試
 *   ※ 第一次執行會要求授權 Drive 讀取權限。
 */

/*** ============ 設定區 ============ ***/
const IMPORT_CFG = {
  // 來源檔：以「資料夾 + 檔名」為準。
  // ※ 這份 CSV 每天從地端同步覆蓋，檔案 ID 可能會變，只有檔名固定，
  //   所以絕對不要靠 ID 找檔。FILE_ID 只在你要臨時釘住某一份時才填。
  FOLDER_ID: '1P84FTFeXyhVl2MTBQ_-9tgLEhJD0tfKH',
  FILE_NAME: '📐 IBD買賣點總表（工具）.csv',
  FILE_KEYWORD: 'IBD買賣點總表',   // 檔名被改過時的模糊比對關鍵字
  FILE_ID: '',                     // 一般留空
  CHARSET: 'UTF-8',

  // 同步壞掉的保險：來源檔超過這天數沒更新就在摘要裡示警（0 = 不檢查）
  STALE_DAYS: 3,

  // 表頭掃描範圍（前幾列裡面找表頭）
  HEADER_SCAN_ROWS: 10,

  // 找不到表頭關鍵字時的固定位置備援（1=A）
  FALLBACK_CODE_COL:  1,   // A
  FALLBACK_NAME_COL:  2,   // B
  FALLBACK_PIVOT_COL: 21,  // U
  FALLBACK_EARLY_COL: 22,  // V
  FALLBACK_AGGR_COL:  23,  // W

  ADD_NEW_CODES: true,     // CSV 有、database 沒有的代號 → 新增一列
  RUN_UPDATE_AFTER: true,  // 匯入完接著跑一次 updateStockPool()
  MAIL_SUMMARY: true,      // 寄匯入摘要（失敗一定會寄）

  WEEKLY_DAY: 'SATURDAY',
  WEEKLY_HOUR: 8,
};

// 表頭關鍵字（比對前會轉小寫並去掉所有空白／換行）
const IBD_KEYS = {
  code:  ['代號', '代碼', '股號', 'symbol', 'ticker'],
  name:  ['名稱', '股名', '公司'],
  pivot: ['pivot', '20日高'],
  early: ['早期', 'bb均線'],
  aggr:  ['積極', '趨勢線'],
};

/*** ============ 主流程 ============ ***/
function importIBDLevels() {
  let summary;
  try {
    summary = doImportIBD_();
  } catch (err) {
    notifyImportError_(err);
    throw err;
  }

  Logger.log(formatImportSummary_(summary));
  if (IMPORT_CFG.MAIL_SUMMARY) mailImportSummary_(summary);
  toast_(formatImportToast_(summary));

  // 鎖已釋放，這時才接著跑現價更新
  if (IMPORT_CFG.RUN_UPDATE_AFTER && typeof updateStockPool === 'function') {
    updateStockPool();
  }
  return summary;
}

function doImportIBD_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('取得鎖逾時，可能有另一個排程正在執行');

  try {
    const src = readIBDSource_();            // { fileName, grid }
    const cols = resolveIBDColumns_(src.grid);  // { headerRow, code, name, pivot, early, aggr, byHeader }
    const recs = parseIBDRows_(src.grid, cols); // { list, dupes, skipped }

    if (!recs.list.length) {
      throw new Error('來源檔解析後沒有任何有效資料列（表頭列 ' + (cols.headerRow + 1) +
                      '，代號欄 ' + colLetter_(cols.code + 1) + '）');
    }

    const w = writeIntoDatabase_(recs.list);

    return {
      fileName: src.fileName,
      fileId: src.fileId,
      matchedBy: src.matchedBy,
      candidates: src.candidates,
      fileUpdated: src.updated,
      ageDays: src.ageDays,
      stale: src.stale,
      totalRows: src.grid.length,
      cols: cols,
      parsed: recs.list.length,
      dupes: recs.dupes,
      skipped: recs.skipped,
      updated: w.updated,
      unchanged: w.unchanged,
      added: w.added,
      addedCodes: w.addedCodes,
      missingInCsv: w.missingInCsv,
      stamp: stamp_()
    };
  } finally {
    lock.releaseLock();
  }
}

/*** ============ 讀來源檔 ============ ***/
function readIBDSource_() {
  const found = findIBDFile_();
  const file = found.file;
  const mime = file.getMimeType();
  let grid;

  if (mime === MimeType.GOOGLE_SHEETS) {
    // 萬一哪天被轉成 Google 試算表，也照樣讀得到
    grid = SpreadsheetApp.openById(file.getId())
             .getSheets()[0].getDataRange().getDisplayValues();
  } else {
    const text = file.getBlob().getDataAsString(IMPORT_CFG.CHARSET)
                     .replace(/^﻿/, '');   // 去掉 BOM
    grid = Utilities.parseCsv(text);
  }

  if (!grid || !grid.length) throw new Error('來源檔是空的：' + file.getName());

  const updated = file.getLastUpdated();
  const ageDays = (new Date().getTime() - updated.getTime()) / 86400000;

  return {
    fileName: file.getName(),
    fileId: file.getId(),
    matchedBy: found.matchedBy,
    candidates: found.candidates,
    updated: Utilities.formatDate(updated, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'),
    ageDays: ageDays,
    stale: IMPORT_CFG.STALE_DAYS > 0 && ageDays > IMPORT_CFG.STALE_DAYS,
    grid: grid
  };
}

/**
 * 找來源檔。
 * 這份 CSV 每天從地端同步覆蓋，若同步是「刪除後重建」，檔案 ID 每天都會不一樣，
 * 而且資料夾裡可能同時留著同名的舊檔。所以：
 *   - 一律用檔名找，不靠 ID
 *   - 排除垃圾桶裡的檔
 *   - 同名有多份時，取「最後更新時間最新」的那一份
 */
function findIBDFile_() {
  // 只有手動釘住時才走 ID（IMPORT_CFG.FILE_ID 平常留空）
  if (IMPORT_CFG.FILE_ID) {
    try {
      const pinned = DriveApp.getFileById(IMPORT_CFG.FILE_ID);
      if (!pinned.isTrashed()) return { file: pinned, matchedBy: '指定 ID', candidates: 1 };
    } catch (e) { /* 釘住的檔沒了就照常用檔名找 */ }
  }

  const folder = DriveApp.getFolderById(IMPORT_CFG.FOLDER_ID);

  // 1) 資料夾內完全同名
  const exact = collectFiles_(folder.getFilesByName(IMPORT_CFG.FILE_NAME));
  if (exact.length) {
    return { file: newestFile_(exact), matchedBy: '檔名', candidates: exact.length };
  }

  // 2) 檔名關鍵字模糊比對（emoji 或全形括號有出入、檔名被改時的保險）
  let hits = collectFiles_(folder.getFiles())
    .filter(f => f.getName().indexOf(IMPORT_CFG.FILE_KEYWORD) !== -1);
  if (hits.length) {
    // 含「總表」的優先，避免抓到旁邊那份「計算器」
    const better = hits.filter(f => f.getName().indexOf('總表') !== -1);
    if (better.length) hits = better;
    return { file: newestFile_(hits), matchedBy: '關鍵字', candidates: hits.length };
  }

  throw new Error('資料夾中找不到來源檔：' + IMPORT_CFG.FILE_NAME +
                  '（資料夾 ' + IMPORT_CFG.FOLDER_ID + '）');
}

function collectFiles_(it) {
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) out.push(f);   // 同步重建時，舊檔可能還躺在垃圾桶
  }
  return out;
}

function newestFile_(files) {
  return files.reduce((a, b) =>
    a.getLastUpdated().getTime() >= b.getLastUpdated().getTime() ? a : b);
}

/*** ============ 欄位解析 ============ ***/
function normHeader_(v) {
  return String(v === null || v === undefined ? '' : v)
    .toLowerCase().replace(/[\s\r\n　]/g, '');
}

function matchKey_(header, keys) {
  const h = normHeader_(header);
  if (!h) return false;
  for (let i = 0; i < keys.length; i++) {
    if (h.indexOf(normHeader_(keys[i])) !== -1) return true;
  }
  return false;
}

function resolveIBDColumns_(grid) {
  // 在前幾列裡找「最像表頭」的那一列：命中的關鍵字群組最多者
  let bestRow = 0, bestScore = -1;
  const scan = Math.min(IMPORT_CFG.HEADER_SCAN_ROWS, grid.length);
  for (let r = 0; r < scan; r++) {
    let score = 0;
    ['pivot', 'early', 'aggr', 'code', 'name'].forEach(k => {
      if (grid[r].some(c => matchKey_(c, IBD_KEYS[k]))) score++;
    });
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }

  const header = grid[bestRow] || [];
  const used = {};
  const pick = (k, fallbackCol) => {
    for (let i = 0; i < header.length; i++) {
      if (used[i]) continue;
      if (matchKey_(header[i], IBD_KEYS[k])) { used[i] = true; return i; }
    }
    return fallbackCol - 1;   // 退回固定位置
  };

  // 先抓三個價位欄，再抓代號／名稱，避免「代號」被別的欄搶走
  const pivot = pick('pivot', IMPORT_CFG.FALLBACK_PIVOT_COL);
  const early = pick('early', IMPORT_CFG.FALLBACK_EARLY_COL);
  const aggr  = pick('aggr',  IMPORT_CFG.FALLBACK_AGGR_COL);
  const code  = pick('code',  IMPORT_CFG.FALLBACK_CODE_COL);
  const name  = pick('name',  IMPORT_CFG.FALLBACK_NAME_COL);

  return {
    headerRow: bestRow,
    byHeader: bestScore >= 3,   // 三個價位欄都靠表頭找到才算「表頭比對成功」
    code: code, name: name, pivot: pivot, early: early, aggr: aggr,
    headerText: {
      code:  String(header[code]  || ''), name:  String(header[name]  || ''),
      pivot: String(header[pivot] || ''), early: String(header[early] || ''),
      aggr:  String(header[aggr]  || '')
    }
  };
}

/*** ============ 解析資料列 ============ ***/
function normCode_(v) {
  let s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  s = s.replace(/^['"]+|["']+$/g, '').trim();
  s = s.split(/[\s　]+/)[0];              // 「5292 華懋」→「5292」
  s = s.replace(/\.(TW|TWO)$/i, '');           // 「5292.TW」→「5292」
  return /^[0-9A-Za-z]+$/.test(s) ? s : '';
}

function parseNum_(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s　$]/g, '');
  if (!s || s === '-' || s === '—' || /^#/.test(s)) return null;   // 空值 / #N/A / #REF!
  const n = Number(s);
  return (isNaN(n) || !isFinite(n) || n <= 0) ? null : n;
}

function parseIBDRows_(grid, cols) {
  const list = [], seen = {};
  let dupes = 0, skipped = 0;

  for (let r = cols.headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;

    const code = normCode_(row[cols.code]);
    if (!code) { skipped++; continue; }

    const rec = {
      code: code,
      name: String(row[cols.name] === undefined ? '' : row[cols.name]).trim(),
      pivot: parseNum_(row[cols.pivot]),
      early: parseNum_(row[cols.early]),
      aggr:  parseNum_(row[cols.aggr])
    };
    if (rec.pivot === null && rec.early === null && rec.aggr === null) { skipped++; continue; }

    if (seen[code]) { dupes++; continue; }   // 同一檔重複出現，取第一筆
    seen[code] = true;
    list.push(rec);
  }
  return { list: list, dupes: dupes, skipped: skipped };
}

/*** ============ 寫回 IBD進場價_database ============ ***/
function writeIntoDatabase_(recs) {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName(CFG.DB_SHEET);
  if (!db) throw new Error('找不到分頁：' + CFG.DB_SHEET);

  const first = CFG.DB_HEADER_ROWS + 1;
  const n = db.getLastRow() - CFG.DB_HEADER_ROWS;

  const byCode = {};
  recs.forEach(r => byCode[r.code] = r);

  let updated = 0, unchanged = 0;
  const missingInCsv = [];
  const matched = {};

  if (n > 0) {
    const codes = db.getRange(first, CFG.DB_CODE_COL, n, 1)
                    .getDisplayValues().map(r => normCode_(r[0]));
    const names = db.getRange(first, CFG.DB_NAME_COL, n, 1).getValues();

    // C~E 一次讀、一次寫
    const tierRange = db.getRange(first, CFG.DB_PIVOT_COL, n, 3);
    const cur = tierRange.getValues();
    let nameDirty = false;

    for (let i = 0; i < n; i++) {
      const code = codes[i];
      if (!code) continue;
      const rec = byCode[code];
      if (!rec) { missingInCsv.push(code); continue; }
      matched[code] = true;

      // C=Pivot / D=早期 / E=積極；CSV 該格沒值就保留原值
      const next = [rec.pivot, rec.early, rec.aggr];
      let rowChanged = false;
      for (let j = 0; j < 3; j++) {
        if (next[j] === null) continue;
        if (parseNum_(cur[i][j]) !== next[j]) { cur[i][j] = next[j]; rowChanged = true; }
      }
      if (rowChanged) updated++; else unchanged++;

      if (rec.name && !String(names[i][0]).trim()) { names[i][0] = rec.name; nameDirty = true; }
    }

    tierRange.setValues(cur).setNumberFormat('0.00');
    if (nameDirty) db.getRange(first, CFG.DB_NAME_COL, n, 1).setValues(names);
  }

  // --- 新增 CSV 有、database 沒有的代號 ---
  const addedCodes = [];
  if (IMPORT_CFG.ADD_NEW_CODES) {
    recs.forEach(r => { if (!matched[r.code]) addedCodes.push(r.code); });

    if (addedCodes.length) {
      const rows = addedCodes.map(c => {
        const r = byCode[c];
        return [r.code, r.name, r.pivot, r.early, r.aggr];
      });
      const start = db.getLastRow() + 1;
      db.getRange(start, CFG.DB_CODE_COL, rows.length, 1).setNumberFormat('@');
      db.getRange(start, CFG.DB_CODE_COL, rows.length, 5)
        .setValues(rows.map(r => r.map(v => v === null ? '' : v)));
      db.getRange(start, CFG.DB_PIVOT_COL, rows.length, 3).setNumberFormat('0.00');
    }
  }

  return {
    updated: updated, unchanged: unchanged,
    added: addedCodes.length, addedCodes: addedCodes,
    missingInCsv: missingInCsv
  };
}

/*** ============ 預覽（不寫入） ============ ***/
function previewIBDSource() {
  const src = readIBDSource_();
  const cols = resolveIBDColumns_(src.grid);
  const recs = parseIBDRows_(src.grid, cols);

  const lines = [];
  lines.push('來源檔：' + src.fileName + '（比對方式：' + src.matchedBy +
             (src.candidates > 1 ? '，同名 ' + src.candidates + ' 份取最新' : '') + '）');
  lines.push('檔案 ID：' + src.fileId + '（每天同步會變，僅供對照）');
  lines.push('來源檔更新於：' + src.updated + '（' + src.ageDays.toFixed(1) + ' 天前）' +
             (src.stale ? '　⚠️ 疑似地端同步沒跑' : ''));
  lines.push('總列數：' + src.grid.length + '　表頭列：第 ' + (cols.headerRow + 1) + ' 列');
  lines.push('欄位對應（' + (cols.byHeader ? '依表頭關鍵字' : '⚠️ 退回固定位置 U/V/W') + '）：');
  lines.push('  代號 → ' + colLetter_(cols.code + 1) + '「' + oneLine_(cols.headerText.code) + '」');
  lines.push('  名稱 → ' + colLetter_(cols.name + 1) + '「' + oneLine_(cols.headerText.name) + '」');
  lines.push('  🔴Pivot → ' + colLetter_(cols.pivot + 1) + '「' + oneLine_(cols.headerText.pivot) + '」');
  lines.push('  🟡早期 → ' + colLetter_(cols.early + 1) + '「' + oneLine_(cols.headerText.early) + '」');
  lines.push('  🟢積極 → ' + colLetter_(cols.aggr + 1) + '「' + oneLine_(cols.headerText.aggr) + '」');
  lines.push('有效資料：' + recs.list.length + ' 檔（跳過 ' + recs.skipped +
             ' 列、重複 ' + recs.dupes + ' 筆）');
  lines.push('');
  lines.push('前 5 筆：');
  recs.list.slice(0, 5).forEach(r => {
    lines.push('  ' + r.code + ' ' + r.name +
               '　🔴' + fmt_(r.pivot) + '　🟡' + fmt_(r.early) + '　🟢' + fmt_(r.aggr));
  });

  const text = lines.join('\n');
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert('IBD 來源欄位預覽（不會寫入）', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* 沒有 UI（排程執行）就只寫 Log */ }
  return text;
}

function fmt_(v) { return v === null ? '—' : v.toFixed(2); }
function oneLine_(s) { return String(s).replace(/[\r\n]+/g, ' '); }

function colLetter_(col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = (col - m - 1) / 26;
  }
  return s;
}

/*** ============ 摘要與通知 ============ ***/
function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'IBD 匯入', 8); } catch (e) {}
}

function formatImportToast_(s) {
  return '更新 ' + s.updated + '、新增 ' + s.added + '、未變動 ' + s.unchanged;
}

function formatImportSummary_(s) {
  const c = s.cols;
  return [
    'IBD 匯入完成 ' + s.stamp,
    '來源：' + s.fileName + '（' + s.totalRows + ' 列，表頭第 ' + (c.headerRow + 1) + ' 列）',
    '　檔案：' + s.fileId + '　來源檔更新於 ' + s.fileUpdated +
      '（' + s.ageDays.toFixed(1) + ' 天前，比對方式：' + s.matchedBy +
      (s.candidates > 1 ? '，同名 ' + s.candidates + ' 份取最新' : '') + '）' +
      (s.stale ? ' ⚠️ 疑似地端同步沒跑' : ''),
    '欄位：代號=' + colLetter_(c.code + 1) + ' 名稱=' + colLetter_(c.name + 1) +
      ' 🔴=' + colLetter_(c.pivot + 1) + ' 🟡=' + colLetter_(c.early + 1) +
      ' 🟢=' + colLetter_(c.aggr + 1) + (c.byHeader ? '（依表頭）' : '（⚠️ 固定位置備援）'),
    '解析 ' + s.parsed + ' 檔｜更新 ' + s.updated + '｜未變動 ' + s.unchanged +
      '｜新增 ' + s.added + '｜跳過 ' + s.skipped + '｜重複 ' + s.dupes,
    'CSV 未涵蓋（database 保留原值）：' + (s.missingInCsv.length
      ? s.missingInCsv.length + ' 檔 — ' + s.missingInCsv.slice(0, 30).join(', ')
      : '無')
  ].join('\n');
}

function mailImportSummary_(s) {
  const c = s.cols;
  let warn = c.byHeader ? '' :
    '<p style="color:#c00;">⚠️ 表頭關鍵字沒對到，這次是用固定位置 U/V/W 讀的，' +
    '請確認來源檔欄位有沒有搬動。</p>';
  if (s.stale) {
    warn += '<p style="color:#c00;">⚠️ 來源檔已經 ' + s.ageDays.toFixed(1) +
            ' 天沒更新（' + s.fileUpdated + '），地端同步可能沒跑，' +
            '這次匯入的是舊價位。</p>';
  }
  if (s.candidates > 1) {
    warn += '<p style="color:#c60;">ℹ️ 資料夾裡有 ' + s.candidates +
            ' 份同名檔案，已取最後更新時間最新的那一份。</p>';
  }

  const html =
    '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif;font-size:14px;">' +
    '<h3 style="margin-bottom:4px;">IBD 買賣點 → IBD進場價_database 匯入完成</h3>' +
    '<p style="color:#666;margin-top:0;">' + s.stamp + '</p>' + warn +
    '<table style="border-collapse:collapse;">' +
    tr_('來源檔', s.fileName + '（' + s.totalRows + ' 列，表頭第 ' + (c.headerRow + 1) + ' 列）') +
    tr_('來源檔更新於', s.fileUpdated + '（' + s.ageDays.toFixed(1) + ' 天前）' +
        '　比對方式：' + s.matchedBy) +
    tr_('欄位對應',
        '代號 ' + colLetter_(c.code + 1) + '｜名稱 ' + colLetter_(c.name + 1) +
        '｜🔴 ' + colLetter_(c.pivot + 1) + '｜🟡 ' + colLetter_(c.early + 1) +
        '｜🟢 ' + colLetter_(c.aggr + 1)) +
    tr_('解析檔數', String(s.parsed)) +
    tr_('更新 / 未變動 / 新增', s.updated + ' / ' + s.unchanged + ' / ' + s.added) +
    tr_('跳過 / 重複列', s.skipped + ' / ' + s.dupes) +
    tr_('新增代號', s.addedCodes.length ? s.addedCodes.join(', ') : '無') +
    tr_('CSV 未涵蓋', s.missingInCsv.length
        ? s.missingInCsv.length + ' 檔（保留原值）：' + s.missingInCsv.slice(0, 50).join(', ')
        : '無') +
    '</table>' +
    '<p style="color:#666;font-size:13px;">F 欄「深度研究進場價」與 G 欄「深度研究進場價_更新日期」' +
    '為人工維護，匯入不會更動。</p>' +
    '<p><a href="' + SpreadsheetApp.getActive().getUrl() + '">開啟試算表</a></p></div>';

  MailApp.sendEmail({
    to: CFG.MAIL_TO,
    subject: '【IBD 匯入】更新 ' + s.updated + '・新增 ' + s.added + ' — ' + s.stamp,
    htmlBody: html
  });
}

function tr_(k, v) {
  const td = 'padding:5px 10px;border:1px solid #ddd;';
  return '<tr><td style="' + td + 'background:#f2f2f2;font-weight:bold;">' + k +
         '</td><td style="' + td + '">' + v + '</td></tr>';
}

function notifyImportError_(err) {
  const msg = (err && err.message) ? err.message : String(err);
  Logger.log('IBD 匯入失敗：' + msg);
  toast_('匯入失敗：' + msg);
  try {
    MailApp.sendEmail({
      to: CFG.MAIL_TO,
      subject: '【IBD 匯入失敗】' + stamp_(),
      htmlBody: '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif;">' +
                '<h3>IBD 買賣點匯入失敗</h3><p>' + stamp_() + '</p>' +
                '<pre style="background:#f6f6f6;padding:10px;white-space:pre-wrap;">' +
                msg + '</pre>' +
                '<p><a href="' + SpreadsheetApp.getActive().getUrl() + '">開啟試算表</a></p></div>'
    });
  } catch (e) { /* 連信都寄不出去就算了，Log 已經留下 */ }
}

/*** ============ 觸發器 ============ ***/
function setupWeeklyImportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'importIBDLevels') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importIBDLevels')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay[IMPORT_CFG.WEEKLY_DAY])
    .atHour(IMPORT_CFG.WEEKLY_HOUR)
    .nearMinute(0)
    .create();
  toast_('已建立每週六 ' + IMPORT_CFG.WEEKLY_HOUR + ':00 的 IBD 匯入觸發器');
}
