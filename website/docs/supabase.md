---
title: 接上 Supabase
description: 把題庫市集接上雲端，跟別人共用題庫（選用）。
---

# 接上 Supabase（選用）

沒設定就是本機市集（存在 `data/gallery/`），只有自己上架的東西，程式一切正常。
要跟別人共用題庫的話：

1. 建一個 Supabase 專案，把
   [`docs/supabase-setup.sql`](https://github.com/maxx541/mako-quiz/blob/main/docs/supabase-setup.sql)
   貼進 SQL Editor 跑一次（建表、RLS、四個函式、`bundles` 桶子）
2. 複製 [`.env.example`](https://github.com/maxx541/mako-quiz/blob/main/.env.example)
   成 `.env`，填入金鑰：

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...      # 選用，有它才有「市集後台」
```

`SUPABASE_ANON_KEY` 是舊名稱，一樣收。**改過 `supabase-setup.sql` 之後要重跑一次。**

## 兩把金鑰的分工

- **publishable key** 是公開的，每個人的程式裡都有，所以安全性完全靠資料庫的 RLS：
  只讀得到已上架的，寫一律走 security definer 的函式。
- **secret key** 只有市集主人那台機器的 `.env` 裡才有，用來做「管理員」的事
  （列出被隱藏的、刪別人的、上下架）。沒有它就沒有市集後台。

為什麼不能用主持人密碼當管理員憑證：Supabase 根本不知道你的主持人密碼是什麼，
而 publishable key 會出現在每一份程式裡，任何人都能繞過 Makoquiz 直接打 Supabase ——
所以「誰能刪」只能由 RLS 決定，而唯一能做管理動作的就是 secret key。

## 50 MB 這個數字有三個地方要對齊

改一個就要三個一起改，不然會變成「程式放行、雲端擋下來」：

1. `server/utils/bundle.ts` 的 `MAX_BUNDLE`
2. `docs/supabase-setup.sql`（`bundles` 桶子的 `file_size_limit` ＋ `bundle_bytes` 的 check）
3. Supabase 專案的全域上限（Dashboard → Storage → Settings）

## 錯誤訊息會告訴你怎麼修

市集出問題時錯誤訊息會直接告訴你該做什麼（容量不足、桶子沒建、函式簽章對不上、
金鑰過期、專案睡著了都分得出來）。Supabase 的 Storage 錯誤一律回 HTTP 400、真正的碼藏在 body 裡，
所以原始訊息完全看不出所以然，`server/utils/supabase.ts` 的 `explainSupabase()` 負責翻譯。
