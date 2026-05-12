# ROUTINE PROMPT — 修改建議（籌碼面資料來源 patch）

> 產生日期：2026-05-12
> 觸發背景：Section 6 籌碼面使用 WebFetch 失效；今日以實驗確認各來源可行性

---

## 一、來源可行性測試結果

| 方法 | 目標 | 結果 | 說明 |
|---|---|---|---|
| WebFetch — Goodinfo | 三大法人日統計 | ❌ HTTP 403 | 封鎖非瀏覽器 UA |
| WebFetch — HiStock | 三大法人 | ❌ HTTP 403 | 同上 |
| WebFetch — Yahoo 股市 | 法人買賣 | ❌ HTTP 403 | 同上 |
| WebFetch — TWSE 官方 API | T86 / TWT38U / TWT44U | ❌ HTTP 403 | 全部端點封鎖 |
| WebFetch — openapi.twse.com.tw | v1 Fund 系列 | ❌ HTTP 403 | 同上 |
| WebFetch — cnyes.com | 個股總覽 | ❌ HTTP 403 | 同上 |
| WebFetch — wantgoo.com | 法人買賣超 | ❌ HTTP 403 | 同上 |
| WebFetch — cmoney.tw | 討論頁 | ❌ HTTP 403 | 同上 |
| **WebSearch（特定 pattern）** | 三大法人前日數據 | **⚠️ 部分可行** | 需用具體日期 + 張數關鍵字 |
| **Google Sheet（GAS 寫入）** | 任何 TWSE 數據 | **✅ 最穩定** | 推薦長期方案 |

**結論**：WebFetch 對台灣所有主要財經站台均 403（伺服器端 User-Agent 過濾）。  
唯一在 Claude 側可行的 web 方法是 **WebSearch**，但需使用能讓搜尋引擎回傳日粒度數字的特定 query pattern。

---

## 二、有效 WebSearch Pattern（已驗證）

### 三大法人（前一交易日）

```
{Name} {Ticker} 外資買超 投信 {前一交易日 YYYY/MM/DD} 幾張 法人籌碼
```

**範例**（2026-05-12 當日，查前日 5/11）：
```
聯電 2303 外資買超 投信 2026/05/11 幾張 法人籌碼
```

**成功回傳示例**：
> 2026年5月11日外資買超23,943張、投信2,160張、自營商247張，合計26,349張，收盤95.00元。

### 融資融券（前一交易日或最近可查日）

```
{Name} {Ticker} 融資融券 餘額 券資比 {YYYY年MM月}
```

---

## 三、ROUTINE PROMPT 具體修改建議

### 修改位置：Section 6 籌碼面（fallback 三層化 → 改為四層化）

**原文（第 4 層 fallback）**：
```
4. 完全找不到 → 誠實寫：「外資 / 投信當日買賣超未查證」+ 簡短說明可能意涵
```

**建議改為（完整 fallback 四層）**：

```
**三大法人查詢方式（依優先順序）**：

1. **讀 Google Sheet**（若 GAS 已寫入三大法人資料）→ 最準確，直接使用
2. **WebSearch（前一交易日）**：
   query pattern：`{Name} {Ticker} 外資買超 投信 {前一交易日 YYYY/MM/DD} 幾張 法人籌碼`
   → 適用查「前一日」盤後已公布的數據（T+1 日查 T 日）
3. **WebSearch（最近可得）**：若前一日查無，改用「最近 2-5 日」的新聞摘要
4. **完全查無** → 誠實寫「外資 / 投信當日買賣超未查證」

> **注意**：WebFetch 對 Goodinfo、HiStock、Yahoo股市、TWSE API、cnyes、wantgoo 等
> 主要財經站台均回傳 HTTP 403，**不要嘗試 WebFetch 取三大法人數據**，直接用 WebSearch。
```

---

### 修改位置：Section 6 籌碼面「禁止」清單（新增一條）

在現有兩條「禁止」後面加入：

```
- ❌ 以 WebFetch 嘗試抓取 Goodinfo / HiStock / TWSE API 等財經站台（全數 403，浪費搜尋次數）
```

---

## 四、理想長期方案：GAS 新增三大法人寫入

在 `Main_TWSE.gs` 中新增每日呼叫以下 TWSE API 並寫入新分頁 `TWSE_Chips`：

```
https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date={YYYYMMDD}&selectType=ALLBUT0999
```

欄位建議：`TradeDate | Ticker | Foreign_NetBuy | Trust_NetBuy | Dealer_NetBuy | Total_NetBuy`  
（單位：千股，即 1 = 1 張）

ROUTINE PROMPT 中 Section 6 讀取方式改為：  
```
讀 Google Sheet `TWSE_Chips` 分頁，找 TradeDate = 最大日期 AND Ticker = {Top1 Ticker}
```

**效果**：完全不依賴 WebFetch / WebSearch，資料與 TradeDate 完全同步。

---

## 五、今日（2026-05-12）實際查到的籌碼數據補充

### 5/11 盤後三大法人（WebSearch 取得，單一來源，請自行複核）

| 日期 | 外資 | 投信 | 自營商 | 合計 |
|---|---|---|---|---|
| 2026-05-11 | **+23,943 張** | +2,160 張 | +247 張 | **+26,349 張** |
| 2026-05-08 | -11,332 張 | +2,535 張 | -3,297 張 | -12,094 張 |

→ 外資從 5/8 賣超 1.1 萬張，到 5/11 大幅翻多買超 2.4 萬張，是今日漲停前的重要籌碼鋪墊。

### 其他補充（Yahoo 財經新聞標題，2026-05-12）

- 某法人目標價上調至 **108 元**（高於大摩 68 元、野村 80 元，具體來源未驗證）
- 「長老（大戶）提款逾 32 億元」—— 今日漲停過程中大戶滾動獲利出場（具體張數未查）
- 庫藏股計畫（4/30-6/29/2026）：回購上限 **109.5 元**，規模 5 萬張（此為已查證資訊，宜補入 Bear/Bull 兩面分析）
