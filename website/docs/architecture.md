---
title: 架構
description: 前後端目錄結構、資料儲存與 Socket.IO / Nitro 的整合。
---

# 架構

```text
app/                     ← Nuxt 4 前端
  app.vue                全站外框（toast + 對話框）
  assets/css/            設計系統、播放端與參與端樣式
  components/
    AppIcon.vue          全站唯一的 SVG 圖示來源（取代 emoji）
    AppDialog.vue        自製 prompt / confirm
    ImagePicker.vue      圖片上傳（題目大圖 / 選項小圖）
    RevealImage.vue      猜圖題的分階段揭露（格子／模糊／縮放）
    ReactionLayer.vue    表情符號從下方浮出、幾秒後淡出
    CategorizeBoard.vue  分類題的拖曳板（Pointer Events，觸控也能拖）
    ImageZoom.vue        點縮圖放大檢視（解說圖／題目圖，全站共用）
    QHead / QaItem / CloudView
  composables/
    useImageTone.ts      分析背景圖亮度與細節，自動決定遮罩與模糊
    useBackground.ts     背景圖層樣式
    useZoom.ts           放大檢視的開關狀態
    useApi / useSocket / useToast / useDialog / useQuizMeta
  utils/
    bundle.ts            題目↔素材綁定：匯出打包、匯入依檔名接回（walkAssets）
  pages/
    index.vue            參與者加入
    play.vue             參與者作答（手機）
    present.vue          主持人大螢幕（含大廳音樂／作答音樂）
    admin.vue            簡報列表 + 登入 + 匯入／匯出整包
    editor.vue           題目編輯器
docs/
  AI-出題指南.md         貼給 AI 就能產生可匯入題庫的 prompt
server/                  ← Nitro 後端
  plugins/socket.ts      Socket.IO 掛載 + 場次事件
  api/                   REST（登入、簡報 CRUD、上傳、場次查詢與報表）
  routes/uploads/        供圖
  utils/
    quiz.ts              題型定義、批改、計分、統計、防作弊裁切
    session.ts           場次狀態機、參與者、提問
    store.ts             簡報 JSON 持久化
    auth.ts / seed.ts
tests/
  e2e.mjs                Socket.IO 端對端測試
  browser.mjs            真實瀏覽器測試
```

## 資料儲存

資料存在 `data/presentations.json`（原子寫入，毀損時自動備份），上傳的圖片放在 `data/uploads/`。
進行中的場次存在記憶體，閒置 8 小時自動回收；場次開始後編輯簡報不會影響進行中的活動。

第一次啟動偵測到資料庫為空時，`server/plugins/socket.ts` 會呼叫 `seedDemo()`
建立一份涵蓋全部題型的示範簡報。

## Socket.IO 與 Nitro

Socket.IO 透過 `server/plugins/socket.ts` 掛在 Nitro 上：HTTP long-polling 走
`defineEventHandler` 的 `handler`，WebSocket 升級走 `websocket` hooks，
再把底層 socket 交給 engine.io（需要 `nitro.experimental.websocket = true`）。

:::note
hooks 要直接放在 `websocket` 底下，**不能**再包一層 `{ hooks: ... }`。
包錯不會報錯，只會安靜地永遠不觸發，連線退回 polling。
:::
