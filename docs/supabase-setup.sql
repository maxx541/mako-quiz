-- ============================================================
--  Makoquiz 題庫市集 —— Supabase 建置
--  用法：Supabase Dashboard → SQL Editor → New query → 整份貼上 → Run
--  可以重跑，不會弄壞已經有的資料。
-- ============================================================

-- ---------- 資料表 ----------

create table if not exists gallery_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 500),
  author       text not null check (char_length(author) between 1 and 40),
  slide_count  int  not null check (slide_count between 1 and 200),
  -- {"single":3,"reveal":2}，給列表顯示與題型篩選用
  type_counts  jsonb not null default '{}'::jsonb,
  bundle_path  text not null,
  bundle_bytes int  not null check (bundle_bytes between 1 and 52428800),  -- 50 MB
  has_assets   boolean not null default false,
  downloads    int  not null default 0,
  status       text not null default 'published' check (status in ('published','hidden')),
  reports      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- 封面圖：Storage 裡的路徑，或外部網址（題目用網址配圖時）。
-- 用 add column if not exists，已經建過表的人重跑這份 SQL 也不會壞。
alter table gallery_items add column if not exists cover_path text;

-- 管理碼拿掉了：刪除一律由市集管理員（有 secret key 的那台）處理。
-- 舊表可能還留著這個欄位，一起清掉。
alter table gallery_items drop column if exists manage_hash;

/*
 * 把幾個上限「明確重設成現在的值」。
 *
 * 為什麼非做不可：上面的 create table 是 if not exists —— 已經建過表的人重跑，
 * 它「完全不會」動到既有欄位的 CHECK。偏偏 bundles 桶子的 file_size_limit 是用
 * on conflict do update 更新的（見最後），於是舊表會變成：
 *   Storage 放行 50 MB、但資料列的 CHECK 還卡在舊版更小的上限
 *   → 檔案傳得上去，publish_item 這一步卻 23514（違反 CHECK）被擋，
 *     然後把剛傳上去的檔案回收，使用者只看到一句「太大」卻怎麼縮都沒用。
 * 這裡 drop + add 把 CHECK 重新對齊，重跑這份 SQL 就能修好舊表。
 * 放寬上限不會讓既有資料違規，所以 add constraint 不會失敗。
 */
alter table gallery_items drop constraint if exists gallery_items_bundle_bytes_check;
alter table gallery_items add  constraint gallery_items_bundle_bytes_check check (bundle_bytes between 1 and 52428800);
alter table gallery_items drop constraint if exists gallery_items_slide_count_check;
alter table gallery_items add  constraint gallery_items_slide_count_check check (slide_count between 1 and 200);
alter table gallery_items drop constraint if exists gallery_items_title_check;
alter table gallery_items add  constraint gallery_items_title_check check (char_length(title) between 1 and 120);
alter table gallery_items drop constraint if exists gallery_items_description_check;
alter table gallery_items add  constraint gallery_items_description_check check (char_length(description) <= 500);
alter table gallery_items drop constraint if exists gallery_items_author_check;
alter table gallery_items add  constraint gallery_items_author_check check (char_length(author) between 1 and 40);

create index if not exists gallery_items_browse_idx
  on gallery_items (status, created_at desc);

alter table gallery_items enable row level security;

-- ---------- 權限 ----------
--
-- publishable key 是公開的（它會出現在每個人的程式裡），所以安全性完全靠 RLS。
-- 原則：讀只讀得到已上架的；寫一律走下面的函式，不開放直接 insert/update/delete。

drop policy if exists "public read published" on gallery_items;
create policy "public read published" on gallery_items
  for select using (status = 'published');

-- 沒有 insert/update/delete policy = 拿 publishable key 的人一律寫不進來。
-- 下面的函式是 security definer，它們自己有權限，但只能做我們允許的事。

/*
 * RLS 擋的是「列」，不是「欄」。
 *
 * 光有上面那條 policy 的話，任何人都能 select reports ——
 * policy 放行的是整列，所有欄位都跟著出來。reports 是檢舉理由，
 * 那是管理員才該看的東西，沒有理由出現在公開 API 上。
 *
 * 欄位層級的授權才擋得住這個：先把整表的 select 收回來，再一欄一欄發回去。
 * service_role（secret key）不受影響，後台照樣讀得到全部。
 */
revoke select on gallery_items from anon, authenticated;
grant select (
  id, title, description, author, slide_count, type_counts,
  bundle_path, cover_path, bundle_bytes, has_assets, downloads, status, created_at
) on gallery_items to anon, authenticated;

-- ---------- 上架 ----------

-- 先把舊版的 publish_item 全部清掉再重建。
--
-- 為什麼不是「建完再 drop 舊的」：舊版多一個 p_manage_hash 參數，簽章跟新版不同，
-- 兩個會變成重載並存，PostgREST 就不知道該打哪一個；而且如果只是改參數名字，
-- create or replace 還會直接報「cannot change name of input parameter」。
-- 這裡不寫死簽章，把 public 底下所有同名重載掃掉，重跑幾次都是同樣結果。
--
-- remove_item 一起清掉：管理碼拿掉後，作者自助下架的 RPC 就不該再存在，
-- 刪除一律由市集管理員（有 secret key 的那台）處理。
do $$
declare r record;
begin
  for r in
    select oid::regprocedure as sig
      from pg_proc
     where proname in ('publish_item', 'remove_item')
       and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function ' || r.sig::text || ' cascade';
  end loop;
end $$;

create function publish_item(
  p_title       text,
  p_description text,
  p_author      text,
  p_slide_count int,
  p_type_counts jsonb,
  p_bundle_path text,
  p_bundle_bytes int,
  p_has_assets  boolean,
  p_cover_path  text default null
) returns gallery_items
language plpgsql security definer set search_path = public as $$
declare
  v_row gallery_items;
  v_recent int;
begin
  -- 同一分鐘最多 5 筆：擋腳本洗版，正常人碰不到
  select count(*) into v_recent from gallery_items where created_at > now() - interval '1 minute';
  if v_recent >= 5 then
    raise exception '上架太頻繁，請等一下再試';
  end if;

  insert into gallery_items
    (title, description, author, slide_count, type_counts, bundle_path, cover_path, bundle_bytes, has_assets)
  values
    (trim(p_title), coalesce(trim(p_description), ''), trim(p_author), p_slide_count,
     coalesce(p_type_counts, '{}'::jsonb), p_bundle_path, p_cover_path, p_bundle_bytes,
     coalesce(p_has_assets, false))
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------- 下載數 ----------

create or replace function bump_download(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update gallery_items set downloads = downloads + 1
   where id = p_id and status = 'published';
end;
$$;

-- ---------- 檢舉 ----------

create or replace function report_item(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reports jsonb;
begin
  select reports into v_reports from gallery_items where id = p_id;
  if v_reports is null then return; end if;

  v_reports := v_reports || to_jsonb(left(coalesce(p_reason, ''), 200));

  -- 累積三次自動隱藏，等管理員來看。一個人的誤按不該讓東西消失。
  update gallery_items
     set reports = v_reports,
         status = case when jsonb_array_length(v_reports) >= 3 then 'hidden' else status end
   where id = p_id;
end;
$$;

-- 讓拿 publishable key 的人可以呼叫上面這些（也只有這些）
grant execute on function publish_item(text,text,text,int,jsonb,text,int,boolean,text) to anon, authenticated;
grant execute on function bump_download(uuid) to anon, authenticated;
grant execute on function report_item(uuid, text) to anon, authenticated;

-- ---------- Storage：放 bundle 的桶子 ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bundles', 'bundles', true, 52428800, array['application/zip'])
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['application/zip'];

-- 封面另外一個桶子：bundles 只收 application/zip，圖片塞不進去。
-- 限 5 MB，跟單張圖的上限一致 —— 設小於它的話，比較大的題目圖會靜靜地變成沒有封面。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

-- 誰都能讀（bundle 本來就是要給人下載的，封面本來就是要給人看的）
drop policy if exists "bundles public read" on storage.objects;
create policy "bundles public read" on storage.objects
  for select using (bucket_id in ('bundles', 'covers'));

-- 誰都能上傳，但只能傳進這兩個桶子。
-- 大小與型別由桶子本身的 file_size_limit / allowed_mime_types 擋，不是靠這裡。
drop policy if exists "bundles public upload" on storage.objects;
create policy "bundles public upload" on storage.objects
  for insert with check (bucket_id in ('bundles', 'covers'));

-- 刻意不給 update / delete：拿 publishable key 的人不能改也不能刪別人的檔案。
-- 作者下架與管理員刪除都走伺服器端的 secret key。
