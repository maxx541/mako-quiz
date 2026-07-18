# 題庫市集（Supabase）規劃

> 狀態：**做完了，已接上真的 Supabase 專案並驗過**。
> 這份留著是為了記錄「為什麼這樣做」—— 操作方式看 README 或程式裡的「說明」按鈕。

---

## 0. 定案的架構

你的原話：

> 只有在瀏覽上架和下載時才會呼叫 database，database 只保存完整的題目簡報，
> 下載完後會保存在本地，都是呼叫本地的。

講得很清楚，就照這個做：

- **Supabase 只在三個時刻被呼叫**：逛市集、上架、下載。
- **Supabase 裡只有完整的題目簡報**（一份 bundle = 一個 zip），不存草稿、不存分數、不存場次。
- **下載完就落地**成本地檔案，之後編輯、播放、辦活動**全部走本地**，跟雲端無關。

推論出來的兩件好事：

1. **`server/utils/store.ts` 一行都不用改。** 它現在整組是同步的
   （`getPresentation(id)` 直接回物件），要是簡報改存 Supabase，這 12 個匯出
   全部得變 async，9 個呼叫點跟著改，測試那套拋棄式資料目錄也會失效。全部省下來了。
2. **沒網路照樣辦活動。** 市集連不上就只是逛不了，`啟動.bat` → 開房 → 掃 QR
   這條主線完全不碰網路。Supabase 免費方案閒置 7 天會自動暫停，這件事也就不會咬到活動現場。

---

## 1. 剩下要拍板的兩件事

### 決策 B：市集上「誰是誰」怎麼認？（已定案：只填製作者，刪除交給管理員）

這是最容易被忽略、但躲不掉的問題。現在的程式**完全沒有使用者帳號**：
`server/api/auth/login.post.ts` 只比對一組 `NUXT_HOST_PASSWORD`，
發一個存在記憶體裡的 token。這是刻意的（Kahoot 風格、不用註冊）。

但「上傳/下載別人的題目」立刻就問：這份是誰傳的？他能不能改？能不能刪？

| | B1：匿名發布（**採用**） | B2：Supabase Auth 真帳號 | B3：唯讀市集 |
| --- | --- | --- | --- |
| 怎麼發布 | 填一個顯示名稱就傳 | 註冊/登入（Email、Google…） | 你手動放上去 |
| 怎麼改/刪自己的 | 找管理員 | 登入就有 | 找你 |
| 使用者成本 | 零 | 要註冊，跟現在「不用帳號」的調性衝突 | 零 |
| 工程量 | 小 | 大（登入頁、session、RLS、忘記密碼…） | 最小 |
| 擋得住亂傳嗎 | 要另外做（見決策 C） | 好擋（綁帳號） | 完全擋得住 |

**為什麼是 B1**：跟整個專案「不用註冊」的調性一致，工程量小。

**管理碼後來拿掉了。** 本來的設計是上架時發一組碼給作者，之後憑它自己下架 ——
但那等於要使用者保管一組他一年用不到一次的密碼，而且市集本來就有管理員
（拿得到 secret key 的那台）。多一個沒人記得住的憑證，換來的只是「少找管理員一次」，
不划算。現在**刪除一律走市集後台**。

---

### 決策 C：公開市集 = 任何人都能上傳，你要擋到什麼程度？

只要是公開可寫的東西，就會有人塞垃圾。**最少**要有：

- 每份 bundle 大小上限（現在素材沒有總量限制，一份可以很肥）
- 同一個 IP／同一段時間的發布次數上限
- 檢舉 + 下架（你要有個地方能一鍵隱藏）
- 上架前**預設不公開**，你審過才出現？還是先公開、被檢舉再說？

這題我沒有建議，看你想不想當管理員。**如果你只是想跟朋友之間互傳，
最省事的做法是市集需要一組「社群密碼」才進得去** —— 不是公開網站，就沒有這些問題。

---

## 2. 架構圖

```
你的電腦（跟現在一模一樣）              Supabase（新的，只有市集）
┌─────────────────────────┐          ┌──────────────────────────┐
│ 啟動.bat                 │          │  Postgres                │
│  └ Nuxt/Nitro           │          │   └ gallery_items        │
│     ├ data/*.json  ←自己的簡報       │      (標題/作者/題數/題型│
│     ├ data/uploads ←自己的素材       │       /下載數/封面)      │
│     └ /admin            │          │                          │
│        └ 題庫市集 ──────────HTTPS───→│  Storage                │
│           逛 / 下載 / 發布│          │   └ bundles/*.zip        │
└─────────────────────────┘          └──────────────────────────┘
                                       ↑ 同一個 Supabase 專案，
                                         所有人的程式都連這裡
```

**傳輸的東西直接用現成的 bundle。** 專案已經有完整的匯出／匯入：
`app/utils/bundle.ts` 用 fflate 在瀏覽器裡打包成 zip（`presentation.json` + `assets/`），
`server/utils/store.ts` 的 `importPresentation()` 負責還原，而且**已經有測試**
在驗「匯出 → 刪除 → 重新匯入能逐位元組還原所有素材」。

所以：
- **發布** = 拿現有的 exportBundle 產出的 zip，丟上 Storage，metadata 寫進 Postgres
- **下載** = 抓 zip → 走現有的匯入流程 → 直接進編輯器

這是這個規劃裡最好的消息：**上傳下載的核心邏輯已經寫完而且測過了**，
剩下的是「把 zip 放到雲端、列出來給人挑」。

### 金鑰要怎麼放（這點很重要，不要弄錯）

每個使用者都是在自己電腦上跑這個程式。所以：

- **絕對不能發 service_role key** —— 那把鑰匙能繞過所有權限，等於每個下載程式的人
  都能把你整個市集刪光。
- 要發的是 **anon key**。它本來就是設計成公開的（會出現在前端），
  **安全性完全靠 Row Level Security（RLS）**。
- 寫入不要讓 client 直接 INSERT/UPDATE 資料表，改成呼叫 **Postgres RPC**
  （`security definer` 函式），在函式裡擋大小、記次數。這樣規則在資料庫裡，client 改不掉。
- **RLS 擋的是「列」不是「欄」** —— policy 放行一列，所有欄位都跟著出來。
  不想外流的欄位（例如檢舉理由）要另外用**欄位層級授權**收掉。
  這個洞是實際拿 publishable key 攻擊自己的市集才發現的，見 `tests/supabase-rls.mjs`。

### 資料表草稿

```sql
create table gallery_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 120),
  description   text default '' check (char_length(description) <= 500),
  author        text not null check (char_length(author) between 1 and 40),
  slide_count   int  not null check (slide_count between 1 and 200),
  type_counts   jsonb not null default '{}',   -- {"single":3,"reveal":2} 用來顯示與篩選
  bundle_path   text not null,                 -- Storage 裡的路徑
  bundle_bytes  int  not null check (bundle_bytes <= 20 * 1024 * 1024),
  has_assets    boolean not null default false,
  downloads     int  not null default 0,
  status        text not null default 'published',  -- published | hidden
  created_at    timestamptz not null default now()
);

alter table gallery_items enable row level security;

-- 任何人都讀得到「已公開」的
create policy "public read" on gallery_items
  for select using (status = 'published');

-- 寫入一律走 RPC，不開放 client 直接寫
-- （沒有 insert/update/delete policy = 全部擋掉）
```

---

## 3. 進度（第 1~3 步做完了）

| 步驟 | 內容 | 狀態 |
| --- | --- | --- |
| **1. gallery 驅動介面 + 本機驅動** | `server/utils/gallery.ts`。本機驅動把 bundle 存在 `data/gallery/`。 | ✅ 完成 |
| **2. 市集 UI** | `/gallery`：搜尋、題型篩選、上架、下載進編輯器、檢舉。 | ✅ 完成 |
| **3. 市集後台** | 同一頁的「市集後台」：列全部（含被隱藏的）、看檢舉理由、隱藏／放回、刪除。 | ✅ 完成 |
| **4. 測試** | e2e 260 項、browser 221 項，全過。 | ✅ 完成 |
| **5. 接上 Supabase** | `server/utils/supabase.ts` + `docs/supabase-setup.sql`。 | ✅ 完成，已對真的專案驗過 |

### 上雲之後實測的結果

對真的 Supabase 專案跑過一輪端到端（上架 → 逛 → 下載 → 後台 → 刪除）：

- 列表的題數／題型是**伺服器拆 zip 算的**（15 題、15 種題型），不採信 client
- **圖片與音檔全部逐位元組一致**：猜圖題的圖、音樂題音檔（129 KB）、解說圖、
  選項圖、大廳音樂（86 KB）、背景圖、表情符號 —— 七種都對得起來
- 下載回來的素材重新落地成本機的 `/uploads/…`，**不是指向雲端網址**（下載完就跟雲端無關）
- 後台隱藏 → 公開列表就查不到；放回去 → 又出現
- 刪除會連 Storage 裡的 zip 一起刪，**不留孤兒檔案**

### 素材的上限

**整包題目簡報 50 MB**（`MAX_BUNDLE`）。這個數字有三個地方要對齊，改一個就要三個一起改：

1. `server/utils/bundle.ts` 的 `MAX_BUNDLE`（伺服器上架時擋）
2. `docs/supabase-setup.sql` 的 `bundles` 桶子 `file_size_limit`，以及 `bundle_bytes` 的 check
3. Supabase 專案的**全域上限**（Dashboard → Storage → Settings）

少改一個會變成「這裡放行、Supabase 擋下來」，而且錯誤訊息很難懂。

單一檔案另外分開擋：**單張圖 5 MB、單一音檔 15 MB**（`server/utils/media.ts`）。
**音樂題才是會踩到 50 MB 的那個** —— 幾首 MP3 就吃掉一大半。真的不夠就用外部網址，
那個不佔額度。

本機驅動不是只為了開發 —— 它同時就是「沒設定 Supabase 時」的預設行為，
程式不會因為沒金鑰就壞掉，只是市集上只有自己的東西。

### 做出來的東西

```
server/utils/bundle.ts          伺服器端拆 zip、驗內容、算 meta
server/utils/gallery.ts         驅動介面 + 本機驅動（之後 Supabase 驅動接同一組介面）
server/api/gallery/…            逛 / 看 / 上架 / 下載 / 檢舉
server/api/gallery-admin/…      後台：列全部 / 隱藏 / 刪除（主持人密碼）
app/pages/gallery.vue           市集頁 + 上架彈窗 + 後台彈窗
app/utils/bundle.ts             buildBundle()：匯出和上架共用同一個打包函式
```

幾個做的時候的決定：

- **列表上的題數與題型是伺服器自己拆 zip 算的**，不採信 client 送什麼 ——
  不然任何人都能傳垃圾卻在列表寫「共 50 題」騙人點。
- **壞東西擋在上架**（不是 zip、沒有 presentation.json、題型不認得、沒有題目、沒填製作者），
  不要等別人下載了才發現是壞的。
- **上架用的 zip 就是匯出用的那個**（`buildBundle()`）。兩邊各寫一份遲早走鐘：
  一邊修了素材處理另一邊沒修，傳上去的東西就是壞的。
- **累積三次檢舉自動隱藏**，一個人的誤按不該讓東西消失；後台可以放回去，
  放回去時會清掉檢舉紀錄，不然下一個檢舉又立刻把它壓下去。

---

## 4. 設定 Supabase（已完成，留著給下一台機器用）

1. 建一個 Supabase 專案（免費方案就夠）
2. 把 `docs/supabase-setup.sql` 整份貼到 SQL Editor 跑一次（可以重跑）
3. 專案根目錄放 `.env`：

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...      # 只放在管理員那台，有它才有「市集後台」
```

**改過 SQL 之後一定要跑一次 `node --env-file=.env tests/supabase-rls.mjs`** ——
那支會拿 publishable key 對真的市集做十種攻擊，確認什麼都弄不壞。

⚠ **service_role / secret key 不能發給使用者**，那把能繞過所有權限。
要發給別人的只有 `SUPABASE_URL` 與 `SUPABASE_PUBLISHABLE_KEY`。

**免費方案閒置 7 天會自動暫停**，要手動去 Dashboard 喚醒。因為市集跟辦活動是分開的，
它睡著也不影響活動，只是逛不了。

---

## 4.5 市集後台為什麼一定要 secret key（這不是「多一層安全」，是唯一做得到的辦法）

**Supabase 根本不知道你的主持人密碼是什麼。**

主持人密碼是 Makoquiz **自己**的東西（`requireAuth` 比對 `NUXT_HOST_PASSWORD`）。
但市集的資料在 Supabase 上，它只認自己的金鑰。所以：

- **publishable key 會出現在每一份 Makoquiz 裡**，任何人都挖得出來，
  然後**繞過 Makoquiz 直接打 Supabase** —— 他根本不需要你的主持人密碼，
  也不需要你的程式。
- 所以「誰能刪市集的東西」只能由 Supabase 的 RLS 決定，跟主持人密碼無關。
- RLS 擋掉 publishable key 的 update/delete 之後，**唯一能做管理動作的就是
  secret key**，而它只存在於 `.env`，不會出現在前端。

所以 `canAdmin = 有沒有 secret key`。這不是不信任誰，是「主持人密碼在 Supabase
那邊不存在，拿它當憑證等於沒有憑證」。

**受信任的人要能管市集？** 把 secret key 給他，讓他放進自己的 `.env` 就好 ——
secret key 就是市集的管理員憑證。沒有它的機器，「市集後台」按鈕不會出現。

---

## 5. 還沒解決的問題（留給未來的我／你）

- **素材重複**：十個人發布同一套 CG 猜圖題，Storage 就有十份一樣的圖。
  之後可以用內容雜湊去重，但第一版不做。
- **版本更新**：別人下載過你的題庫，你之後改了，要不要通知他？第一版不做，下載即分家。
- **授權**：別人的 CG／音樂上傳到公開市集有版權問題。至少要在發布頁寫清楚
  「你要為你上傳的素材負責」，並且提供檢舉下架。
- **`normalizeSlide` 的相容性**：市集上的舊 bundle 被新版程式下載時，
  靠現有的 `normalizeSlide()` 自動補欄位。這個機制已經有測試（匯入舊格式），
  但市集會讓「舊 bundle 遇上新程式」變成常態，之後改資料結構要更小心。
