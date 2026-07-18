---
title: 環境變數
description: 用 .env 設定密碼、埠號、對外網址、資料目錄與 Supabase。
---

# 環境變數

全部都是**選用**的 —— 連 `.env` 都沒有也跑得起來（用預設密碼 + 本機題庫市集）。
要設定的話，複製一份範例再改：

```bash
cp .env.example .env          # Windows: Copy-Item .env.example .env
```

完整說明與範例值都在
[`.env.example`](https://github.com/maxx541/mako-quiz/blob/main/.env.example)，重點如下：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `NUXT_HOST_PASSWORD` | `admin123` | 管理後台密碼。**正式使用請務必改掉。** |
| `PORT` | `3000` | 服務埠號（用 `啟動.bat` 時改用 `-Port` 參數）。 |
| `NUXT_PUBLIC_URL` | 自動偵測 | 對外網址；未設定時 `啟動.bat` 會帶入 cloudflared 網址，`npm start` 則把 localhost 換成區網 IP。 |
| `MAKOQUIZ_DATA_DIR` | `./data` | 簡報 JSON、上傳素材與音效的存放目錄。 |
| `SUPABASE_URL` | （空） | 題庫市集雲端網址；不填就是本機市集。見[接上 Supabase](./supabase)。 |
| `SUPABASE_PUBLISHABLE_KEY` | （空） | 公開金鑰（舊名 anon key），安全性靠資料庫 RLS。 |
| `SUPABASE_SECRET_KEY` | （空） | 管理員金鑰（舊名 service_role key），**只放在市集管理員那一台**，有它才有市集後台。 |

:::warning
`.env` 已被 `.gitignore` 忽略，不會上傳到 GitHub —— 金鑰放心填，但也**別把自己的 `.env` 貼到公開的地方**。
:::

## node 不會自己讀 .env

那是 Nuxt 開發模式（`npm run dev`）才有的行為。正式啟動（`npm start` / `啟動.bat`）時，
`start.ps1` 是用 `node --env-file-if-exists=.env` 把金鑰帶進去的。用 `-if-exists` 版本是因為
沒有 `.env` 的人（大多數人）也要開得起來 —— 純 `--env-file` 在檔案不存在時會直接讓 node 罷工。
