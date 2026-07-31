/**
 * IBD 買賣點總表 → 進場價_database 每週匯入
 * ------------------------------------------------------------
 * 每週六早上從 Google Drive 讀
 *   📐 IBD買賣點總表（工具）.csv
 * 的 U / V / W 三欄：
 *   U 🔴Pivot買入點 = 20日高+0.10
 *   V 🟡早期入場    = BB均線突破
 *   W 🟢積極入場    = 趨勢線近似
 * 寫回「進場價_database」的 C / D / E 三欄。
 *
 * 【欄位解析】以表頭關鍵字為主（Pivot／早期／積極、代號、名稱），
 *   找不到才退回固定位置 U/V/W。實際用到哪幾欄會寫進 Logger 與匯入摘要，
 *   也可以用選單「預覽 IBD 來源欄位」先確認再正式跑。
 *
 * 【不會動到的東西】
 *   - F 欄「深度研究進場價」是人工填的，匯入完全不碰。
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
  // 來源檔（先用 FILE_ID，抓不到再用資料夾 + 檔名 / 關鍵字找）
  FILE_ID: '1mEcTpzagoXwMMKSR8FY9kZC8TUQCwVIX',
  FOLDER_ID: '1P84FTFeXyhVl2MTBQ_-9tgLEhJD0tfKH',
  FILE_NAME: '📐 IBD買賣點總表（工具）.csv',
  FILE_KEYWORD: 'IBD買賣點總表',   // 檔名被改過時的模糊比對關鍵字
  CHARSET: 'UTF-8',

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
  const file = findIBDFile_();
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
  return { fileName: file.getName(), grid: grid };
}

function findIBDFile_() {
  // 1) 直接用檔案 ID
  if (IMPORT_CFG.FILE_ID) {
    try { return DriveApp.getFileById(IMPORT_CFG.FILE_ID); } catch (e) { /* 落到下一步 */ }
  }

  const folder = DriveApp.getFolderById(IMPORT_CFG.FOLDER_ID);

  // 2) 資料夾內完全同名
  const exact = folder.getFilesByName(IMPORT_CFG.FILE_NAME);
  if (exact.hasNext()) return exact.next();

  // 3) 檔名關鍵字模糊比對（檔名被改、emoji 有出入時的保險）
  const it = folder.getFiles();
  const hits = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(IMPORT_CFG.FILE_KEYWORD) !== -1) hits.push(f);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // 檔名同時含「總表」的優先，避免抓到「計算器」那份
    const better = hits.filter(f => f.getName().indexOf('總表') !== -1);
    if (better.length) return better[0];
    return hits[0];
  }

  throw new Error('資料夾中找不到來源檔：' + IMPORT_CFG.FILE_NAME);
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

/*** ============ 寫回 進場價_database ============ ***/
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
  lines.push('來源檔：' + src.fileName);
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
  const warn = c.byHeader ? '' :
    '<p style="color:#c00;">⚠️ 表頭關鍵字沒對到，這次是用固定位置 U/V/W 讀的，' +
    '請確認來源檔欄位有沒有搬動。</p>';

  const html =
    '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif;font-size:14px;">' +
    '<h3 style="margin-bottom:4px;">IBD 買賣點 → 進場價_database 匯入完成</h3>' +
    '<p style="color:#666;margin-top:0;">' + s.stamp + '</p>' + warn +
    '<table style="border-collapse:collapse;">' +
    tr_('來源檔', s.fileName + '（' + s.totalRows + ' 列，表頭第 ' + (c.headerRow + 1) + ' 列）') +
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
    '<p style="color:#666;font-size:13px;">F 欄「深度研究進場價」為人工維護，匯入不會更動。</p>' +
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
