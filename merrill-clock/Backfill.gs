/**
 * ============================================================
 * 歷史回填 backfill_History(years)  V4.0
 * ============================================================
 * 依可調回溯年數產生交易日骨架，對每個日期以 FRED as-of 整列重算，
 * 並套用與 Code.gs 完全相同的 V4 校準（z 分數／時鐘讀數／連續風險分數／轉折確認規則）。
 *
 * 使用：backfill_History()  或  backfill_History(3)
 * 需求：Code.gs V4.0（HEADERS、校準、分類與風險函式皆由 Code.gs 提供，本檔不重複宣告，
 *       以免 Apps Script 同名常數「重複宣告」導致整個專案無法執行）。
 * 注意：本函式會清空並重寫所有資料列，包含「歷史解讀」欄（由下方 PERIODS 重新產生）。
 * ============================================================
 */

const DEFAULT_BACKFILL_YEARS = 3;

// ======== 深度時期解讀 ========
// 註：2023–2024 的「原始象限」多顯示滯脹，是 CFNAI-MA3 長期低於 1967 基準造成的假象（當時為軟著陸）。
//     V4 新增的「校準象限」已用近 20 年穩健中位數為中性點修正此偏誤，請以校準象限與方向階段為準。
const PERIODS = [
  { s:'2023-06-23', e:'2023-07-31', t:'【升息終點／政策利率見頂】Fed 2023/7 升至 5.25–5.50% 為本循環最後一碼。整體 CPI 自 9% 高點回落至約 3%、核心仍黏在 4.8%；2s10s 深度倒掛(≈−1)反映市場篤定高利率將壓抑未來成長。CFNAI 為負但實質 GDP 仍擴張，屬軟著陸非衰退。配置上高利率利現金、長債殖利率仍高具價值，股市靠 AI 主題撐盤。' },
  { s:'2023-08-01', e:'2023-10-31', t:'【殖利率衝高／Higher-for-longer】長端殖利率 Q3 急升、10Y 一度逼近 5%，主因期限溢酬重估與「更高更久」定價而非通膨惡化；高收益債利差仍低(信用平靜)、VIX 升至 20 上下。成長動能轉弱使方向在再通膨/復甦間擺盪。此段股債齊跌、現金最穩，是典型「利率主導」的修正。' },
  { s:'2023-11-01', e:'2023-12-31', t:'【Powell 鴿派轉向／降息狂歡】2023/12 點陣圖暗示 2024 降 3 碼、Powell 轉鴿，長端殖利率與通膨預期同步重挫、曲線開始修正倒掛，VIX 跌至約 12 低檔。通膨續降帶動方向偏再通膨/復甦，風險資產與長債齊彈。要點：此波由「政策預期」驅動，而非基本面已轉強。' },
  { s:'2024-01-01', e:'2024-03-31', t:'【通膨意外偏黏／不著陸疑慮】2024 Q1 連月 CPI 超預期(回升至 3.1–3.5%)，市場將全年降息預期由約 6 碼大幅收斂至 2–3 碼，長端殖利率回升、曲線維持倒掛。成長穩、就業強，形成「不著陸」敘事。方向轉滯脹/過熱，凸顯通膨黏性下防禦與實質資產(商品)的相對價值。' },
  { s:'2024-04-01', e:'2024-04-30', t:'【熱通膨數據／鷹派重定價】3 月 CPI 再偏熱，殖利率與美元走強、VIX 升至約 19，風險資產回檔；降息預期進一步後延。短暫的「過熱」動能提醒此時最忌追逐長存續期成長股。' },
  { s:'2024-05-01', e:'2024-07-31', t:'【去通膨重啟／降息預期重建】通膨重回下行(CPI 跌破 3%)、就業與消費等軟性數據降溫，市場重建首次降息預期但曲線仍倒掛。方向在復甦/再通膨間切換，反映「成長略降、通膨更降」的後段軟著陸，長債開始領先。' },
  { s:'2024-08-01', e:'2024-08-31', t:'【套利去槓桿／成長驚嚇(風險事件)】2024/8 初日圓套利去槓桿疊加疲弱 7 月就業，Sahm 法則短暫觸發，VIX 單日衝至約 38，風險分數正確轉 Risk-Off。但僅為流動性事件、基本面未崩，數週內回穩，曲線於月底解除倒掛——「假衰退訊號」的教科書案例。' },
  { s:'2024-09-01', e:'2024-09-30', t:'【寬鬆啟動／曲線解除倒掛】Fed 2024/9 以 2 碼(至 4.75–5.00%)啟動降息循環，2s10s 正式轉正、衰退警示由倒掛轉正常，標誌利率週期由緊轉鬆的關鍵轉折。成長落底、通膨趨穩，方向偏再通膨/復甦，債券與利率敏感的早週期類股受惠。' },
  { s:'2024-10-01', e:'2024-10-31', t:'【選前韌性／殖利率回升】經濟數據意外強韌、降息預期略收斂，長端殖利率回升、VIX 選前升溫至 20 上下。方向動能偏弱(再通膨)，屬選前觀望、波動放大的過渡期。' },
  { s:'2024-11-01', e:'2024-12-31', t:'【選後再通膨交易／曲線陡化】大選後「再通膨交易」升溫：成長與通膨預期同步上修、長端殖利率與曲線陡化，Fed 11、12 月各續降 1 碼至 4.25–4.50%，但 12 月點陣圖轉鷹(2025 降息次數下修)引發 VIX 跳升至約 28。方向轉過熱，框架偏商品/循環價值。' },
  { s:'2025-01-01', e:'2025-02-28', t:'【Goldilocks／成長轉強】成長明確轉強(CFNAI 2025/2 轉正)、通膨向 2% 靠攏、波動低檔，景氣進入「過熱→復甦」甜蜜帶。水準象限終於脫離滯脹下半部，風險偏多、循環成長領先。' },
  { s:'2025-03-01', e:'2025-03-31', t:'【通膨破 2.5%／政策不確定升溫】通膨降破 2.5%(inf 轉負)使方向切為復甦，但政策不確定性升高、VIX 攀至 20 以上、股市震盪加大。屬「成長正、通膨低」的有利定價，惟波動已預示前方風險。' },
  { s:'2025-04-01', e:'2025-04-30', t:'【關稅衝擊／本區間最大風險事件】2025/4 對等關稅政策引爆全球風險資產重挫：VIX 飆至約 52(本區間最高)、高收益債利差跳升至約 4.6，劇烈 Risk-Off；隨後政策緩和帶動反彈。成長仍正、通膨低，定位偏復甦，但信用與波動同步示警，是「外生政策衝擊」凌駕基本面的案例。' },
  { s:'2025-05-01', e:'2025-06-30', t:'【衝擊後落底／成長轉弱】關稅衝擊後市場回穩，但成長動能反轉走弱(CFNAI 回落至 −0.17~−0.24)、通膨於 2.4–2.7% 區間；方向在再通膨/滯脹間徘徊。屬衝擊後的去化期，風險分數回落、波動收斂。' },
  { s:'2025-07-01', e:'2025-10-31', t:'【成長疲弱／通膨緩升 區間整理】成長持續疲弱、CFNAI 於 10 月探至 −0.39(本區間最弱)，通膨自 2.7% 緩升至 3.0% 後高檔整理；方向動能在過熱/滯脹間擺盪、無明確趨勢，10 月波動回升(VIX 21–25)。屬「弱成長+黏通膨」的低能見度盤整，宜防禦。' },
  { s:'2025-11-01', e:'2026-01-31', t:'【續降息／曲線陡化／成長落底回升】Fed 續降息至約 3.6%、曲線持續陡化(利差升至 0.7 上下)，通膨自 3.0% 回落至 2.4%，成長落底並於 2026/1 翻正。方向轉再通膨→復甦，長債與早週期受惠；11 月一度出現 VIX 26 的波動。' },
  { s:'2026-02-01', e:'2026-03-31', t:'【伊朗戰爭爆發／荷莫茲海峽封鎖 — 油價衝擊啟動】2026/2 底伊朗戰爭爆發、3 月初荷莫茲海峽遭封鎖，IEA 稱為史上最大地緣油供中斷(約占全球 20% 供給)。WTI 由 1 月底約 $60 起飆升，通膨由 2 月 +2.4% 急升——3 月單月跳 +0.9%、年增率回到約 3.3%(2024/5 以來最高)；CFNAI 回到趨勢附近(≈0)、VIX 維持 20–30 高檔。方向由復甦快速翻為過熱，框架轉向商品/循環價值。注意此時「整體 vs 核心通膨」的背離最大，鬼影針會明顯拉開。(此段已過知識截止，依 FRED 指標＋公開報導描述。)' },
  { s:'2026-04-01', e:'2099-12-31', t:'【油價驅動再通膨／過熱→滯脹邊緣】荷莫茲海峽封鎖延續約一季，WTI 4–5 月一度逼近 $94、Brent 約 $105；通膨顯著加速：CPI 升至約 4.2%(主由能源/油價推動)、核心由 2.5 緩升至 2.8%，成長維持趨勢附近(CFNAI≈0)。IEA/ECB 示警停滯性通膨風險升高；框架偏大宗商品/循環價值，並留意通膨黏性是否迫使政策再度轉鷹。6 月中傳停火、油價回落，惟海峽重啟後價格仍需數月正常化。(此段已過知識截止，依 FRED 指標＋公開報導描述，具體事件以新聞為準。)' }
];
function periodOf_(ds) {
  for (let i = 0; i < PERIODS.length; i++) if (ds >= PERIODS[i].s && ds <= PERIODS[i].e) return PERIODS[i].t;
  return '';
}

/** 取 obs 中「日期 ≤ dateStr」的最後一筆索引（obs 需為 asc）。 */
function asOfIdx_(obs, dateStr) {
  let idx = -1;
  for (let i = 0; i < obs.length; i++) { if (obs[i].date <= dateStr) idx = i; else break; }
  return idx;
}
function backAt_(obs, idx, n) { return (idx - n >= 0) ? obs[idx - n].value : null; }

// ======== 主回填 ========
function backfill_History(years) {
  years = (typeof years === 'number' && years > 0) ? years : DEFAULT_BACKFILL_YEARS;
  if (!fredKey_()) throw new Error('尚未設定 FRED_API_KEY，請先執行 setup_StoreSecrets()。');
  Logger.log('開始回填 V4，目標回溯 ' + years + ' 年 ...');

  const ss = SpreadsheetApp.openById(sheetId_());
  const sheet = ss.getSheets()[0];
  ensureHeaders_(sheet);
  const cal = getCalibration_(ss, true);   // 回填時強制重算校準，確保歷史與即時同尺規
  Logger.log('校準：' + JSON.stringify(cal));

  const oldLastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const reqStart = monthsBefore_(today, Math.round(years * 12));
  const fetchStart = monthsBefore_(reqStart, 6);   // 多抓半年，供 Δ3m 與 Δ20d 使用

  const O = {
    cfnai:  fredRange_('CFNAIMA3', 'lin', fetchStart, today),
    cpi:    fredRange_('CPIAUCSL', 'pc1', fetchStart, today),
    core:   fredRange_('CPILFESL', 'pc1', fetchStart, today),
    fed:    fredRange_('DFF', 'lin', fetchStart, today),
    spread: fredRange_('T10Y2Y', 'lin', fetchStart, today),
    hy:     fredRange_('BAMLH0A0HYM2', 'lin', fetchStart, today),
    vix:    fredRange_('VIXCLS', 'lin', fetchStart, today)
  };
  if (!O.vix.length && !O.spread.length) throw new Error('FRED 無回應，請確認金鑰與網路。');
  if (O.hy.length && O.hy[0].date > reqStart) {
    Logger.log('提醒：高收益債 OAS 僅自 ' + O.hy[0].date + ' 起，較早日期風險分數會少一個分項。');
  }

  // 1) 交易日骨架（以 VIX 觀測日為準）
  const spineObs = O.vix.length ? O.vix : O.spread;
  const spineSet = {};
  spineObs.forEach(function (o) { if (o.date >= reqStart && o.date <= today) spineSet[o.date] = true; });
  const dates = Object.keys(spineSet).sort();
  if (!dates.length) throw new Error('骨架為空，請確認回溯年數與 FRED 資料範圍。');
  Logger.log('交易日列數：' + dates.length + '（' + dates[0] + ' ~ ' + dates[dates.length - 1] + '）');

  // 2) 逐日重算
  const recs = dates.map(function (ds) {
    const c  = asOf_(O.cfnai, ds);
    const cp = asOf_(O.cpi,   ds);
    const co = asOf_(O.core,  ds);
    const g    = round2_(c);
    const inf  = (cp === null) ? null : round2_(cp - NEUTRAL_INFLATION);
    const coreDev = (co === null) ? null : round2_(co - NEUTRAL_INFLATION);

    const c3  = asOf_(O.cfnai, monthsBefore_(ds, 3));
    const cp3 = asOf_(O.cpi,   monthsBefore_(ds, 3));
    const gMom   = (c  !== null && c3  !== null) ? round2_(c  - c3)  : null;
    const infMom = (cp !== null && cp3 !== null) ? round2_(cp - cp3) : null;

    const zg    = (g    === null) ? null : round2_((g    - cal.gMed)    / cal.gSigma);
    const zinf  = (inf  === null) ? null : round2_((inf  - cal.infMed)  / cal.infSigma);
    const zcore = (coreDev === null) ? null : round2_((coreDev - cal.coreMed) / cal.coreSigma);
    const zgm   = (gMom   === null) ? null : round2_(gMom   / cal.gMomSigma);
    const zim   = (infMom === null) ? null : round2_(infMom / cal.infMomSigma);

    const dial = clockReading_(zg, zinf);
    const mom  = clockReading_(zgm, zim);

    const hyIdx  = asOfIdx_(O.hy, ds),  vixIdx = asOfIdx_(O.vix, ds);
    const hyV    = (hyIdx  >= 0) ? O.hy[hyIdx].value  : null;
    const vixV   = (vixIdx >= 0) ? O.vix[vixIdx].value : null;
    const hyB20  = backAt_(O.hy, hyIdx, 20);
    const vixB20 = backAt_(O.vix, vixIdx, 20);
    const spV    = asOf_(O.spread, ds);

    const quadRaw = levelQuadrant_(g, inf);
    const quadCal = calibratedQuadrant_(zg, zinf);
    const phase   = directionPhase_(zgm, zim);
    const rec     = assetByPhase_(phase);
    const risk    = riskScore_(spV, hyV, vixV);
    const warn    = recessionWarning_(c, spV, zg);

    return {
      ds: ds, c: c, cp: cp, co: co, g: g, inf: inf, coreDev: coreDev,
      gMom: gMom, infMom: infMom, zg: zg, zinf: zinf, zcore: zcore, zgm: zgm, zim: zim,
      dial: dial, mom: mom, quadRaw: quadRaw, quadCal: quadCal, phase: phase, asset: rec,
      spV: spV, hyV: hyV, vixV: vixV, risk: risk, warn: warn,
      dHy:  (hyV  !== null && hyB20  !== null) ? round2_(hyV  - hyB20)  : null,
      dVix: (vixV !== null && vixB20 !== null) ? round2_(vixV - vixB20) : null,
      fed: asOf_(O.fed, ds)
    };
  });

  // 3) 轉折偵測 + 同象限資料版本數 + 確認/暫定
  let runQuad = null, runSeen = {}, runStartIdx = -1;
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k], pr = recs[k - 1];
    const vkey = String(r.g) + '|' + String(r.cp);
    if (r.quadCal !== runQuad) { runQuad = r.quadCal; runSeen = {}; runStartIdx = k; }
    runSeen[vkey] = true;
    r.vintages = Object.keys(runSeen).length;

    const note = pr ? shiftNote_(pr.quadCal, r.quadCal, pr.phase, r.phase) : '';
    if (note) {
      const strong = (r.dial.r !== null && r.dial.r >= Z_CONFIRM);
      r.status = strong ? '確認' : '暫定';
      const cross = crossConfirm_(r.quadCal, r.phase, r.dHy, r.vixV);
      r.shift = '【' + r.status + '｜指針 ' + r.dial.r + 'σ】' + note + (cross ? '　｜　' + cross : '');
    } else {
      r.status = ''; r.shift = '';
      // 暫定轉折在第 2 個總經資料版本仍維持同象限 → 自動升級為確認
      if (r.vintages === 2 && pr && pr.vintages === 1 && runStartIdx >= 0 &&
          recs[runStartIdx].status === '暫定') {
        r.shift = '✅ 轉折確認：' + shortName_(r.quadCal) +
                  ' 已撐過第 2 個總經資料版本（起於 ' + recs[runStartIdx].ds + '）';
        r.status = '確認(延後)';
      }
    }
  }

  // 4) 映射成列（每日警示需要前一列，故在此一併計算）
  const out = recs.map(function (r, k) {
    const obj = {
      '日期': r.ds,
      'CFNAI_MA3': nz_(round2_(r.c)), 'CPI年增率': nz_(round2_(r.cp)),
      '核心CPI年增率': nz_(round2_(r.co)), '有效聯邦基金利率': nz_(round2_(r.fed)),
      '利差(10Y-2Y)': nz_(round2_(r.spV)), '高收益債利差': nz_(round2_(r.hyV)), 'VIX恐慌指數': nz_(round2_(r.vixV)),
      'g分數': nz_(r.g), 'inf分數': nz_(r.inf),
      '成長動能Δ3m': nz_(r.gMom), '通膨動能Δ3m': nz_(r.infMom),
      '景氣象限': r.quadRaw, '週期階段': r.phase,
      '建議資產': r.asset.asset, '建議類股': r.asset.sector,
      '風險分數': r.risk.score + '（' + r.risk.label + '）', '衰退警示': r.warn,
      '歷史解讀': periodOf_(r.ds), '象限轉折': r.shift,
      '成長z': nz_(r.zg), '通膨z': nz_(r.zinf), '核心inf分數': nz_(r.coreDev), '核心通膨z': nz_(r.zcore),
      '成長動能z': nz_(r.zgm), '通膨動能z': nz_(r.zim),
      '時鐘角度': nz_(r.dial.bearing), '時鐘時刻': r.dial.hour,
      '指針長度σ': nz_(r.dial.r), '訊號強度': r.dial.strength,
      '動能長度σ': nz_(r.mom.r), '動能指向': r.mom.hour,
      '校準象限': r.quadCal, '水準方向一致性': consistency_(r.quadCal, r.phase),
      '風險分項': r.risk.parts, '信用動能Δ20d': nz_(r.dHy), 'VIX動能Δ20d': nz_(r.dVix),
      '轉折狀態': r.status, '同象限資料版本數': r.vintages
    };
    obj['每日警示'] = dailyAlerts_(obj, (k > 0) ? prevObj_(recs[k - 1]) : null).join('；');
    return HEADERS.map(function (h) { return (h in obj) ? obj[h] : ''; });
  });

  // 5) 清空舊資料列 → 一次寫入
  if (oldLastRow > 1) sheet.getRange(2, 1, oldLastRow - 1, Math.max(lastCol, HEADERS.length)).clearContent();
  sheet.getRange(2, 1, out.length, HEADERS.length).setValues(out);
  sheet.setFrozenRows(1);

  const shiftCount = recs.filter(function (r) { return r.shift; }).length;
  Logger.log('回填完成：共 ' + out.length + ' 列，其中 ' + shiftCount + ' 個轉折/確認事件。');

  try { exportDigest_(); Logger.log('摘要文件已同步更新。'); } catch (e) { Logger.log('摘要匯出失敗：' + e); }
}

/** 把 rec 轉成 dailyAlerts_ 需要的欄位形狀（只需用到的幾欄）。 */
function prevObj_(r) {
  return {
    '風險分數': r.risk.score + '（' + r.risk.label + '）',
    'VIX恐慌指數': nz_(round2_(r.vixV)),
    '利差(10Y-2Y)': nz_(round2_(r.spV)),
    '信用動能Δ20d': nz_(r.dHy),
    '指針長度σ': nz_(r.dial.r)
  };
}
