---
title: 介紹與快速開始
description: Makoquiz 是什麼、三步驟把它跑起來。
slug: /intro
---

# 介紹與快速開始

**Makoquiz** 是一套即時搶答互動簡報平台，參考 [AhaSlides](https://presenter.ahaslides.com/)
的架構打造。主持人在大螢幕出題，參與者用手機掃 QR Code 加入作答，**答對越快分數越高**，
還能即時提問、送匿名表情符號。

技術堆疊：**Nuxt 4 + Nitro + Socket.IO**，介面全部使用 SVG 圖示（沒有 emoji）。

![主持人大螢幕出題](/img/screenshots/04-host-question.png)

## 特色

- **掃碼即玩，零安裝** —— 觀眾不用下載 App、不用註冊，填暱稱就開始。
- **15 種題型** —— 單選、複選、配對、分類拖曳、順序、數字、海龜湯、猜圖、音樂、文字雲、觀眾提問……
- **讓 AI 幫你出題** —— 複製出題指南貼給 AI，把 JSON 貼回來就是一份題庫。
- **題庫市集** —— 下載、上架、與朋友共用題庫（可接 Supabase 雲端）。
- **防作弊設計** —— 答案不下發手機、伺服器端批改、公布後才計分。

## 快速開始（三步驟）

需要 **Node.js 22.12 以上**（[nodejs.org](https://nodejs.org) 下載 LTS 版）。

```bash
git clone https://github.com/maxx541/mako-quiz.git
cd mako-quiz
npm install
npm run build
npm start          # → http://localhost:3000/admin （預設密碼 admin123）
```

:::tip 一開起來就有題目可玩
第一次啟動偵測到還沒有任何簡報時，會自動建立一份涵蓋全部 15 種題型的示範簡報
**「Galgame 知識大挑戰（示範）」**，可以直接播放，或複製一份改成自己的內容。
想從乾淨狀態開始，把 `data/presentations.json` 刪掉再啟動即可。
:::

:::info Windows 使用者可以更省事
不用碰終端機，直接雙擊 **`啟動.bat`** —— 它會自動裝相依套件、建置、開一條對外通道
（第一次會自動下載 cloudflared）、帶著網址啟動伺服器並打開後台。
詳見[安裝與啟動](./getting-started)。
:::

## 進入點

| 入口 | 網址 | 給誰 |
| --- | --- | --- |
| 管理後台 | `http://localhost:3000/admin` | 主持人（出題、播放） |
| 參與者 | `http://localhost:3000/` | 觀眾（輸入房號加入） |
| 題庫市集 | `http://localhost:3000/gallery` | 逛題庫、下載、上架 |

## 接下來

- 想馬上辦一場活動 → [辦一場活動](./hosting-an-event)
- 想知道有哪些題型 → [題型](./question-types)
- 想讓 AI 幫你出一整份題庫 → [讓 AI 幫你出題](./ai-authoring)
- 想跟朋友共用題庫 → [接上 Supabase](./supabase)
