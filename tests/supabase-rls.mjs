/**
 * 拿 publishable key 對真的 Supabase 搞破壞，確認什麼都弄不壞。
 *
 * ── 為什麼要獨立成一支 ──
 * npm test 會強制清空 Supabase 金鑰（不然測試會打在正式市集上），
 * 所以這件事沒辦法放進那套跑。但這是整個市集的安全性所繫 ——
 * publishable key 會出現在每一份 Makoquiz 裡，任何人都挖得出來，
 * 然後繞過 Makoquiz 直接打 Supabase。擋得住他的只有資料庫端的 RLS 與欄位授權。
 *
 * ── 什麼時候要跑 ──
 * 每次改過 docs/supabase-setup.sql 之後：
 *
 *   node --env-file=.env tests/supabase-rls.mjs
 *
 * 需要 .env 裡有 SUPABASE_SECRET_KEY（拿來佈置與收拾測試資料）。
 */
const url = process.env.SUPABASE_URL.replace(/\/$/, '')
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
const sec = process.env.SUPABASE_SECRET_KEY
const S = { apikey: sec, Authorization: 'Bearer ' + sec, 'Content-Type': 'application/json' }
const K = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }
let bad = 0
const check = (c, l) => {
  if (!c) bad++
  console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${l}`)
}
const rows = async () => (await (await fetch(`${url}/rest/v1/gallery_items?select=id,title,status,downloads`, { headers: S })).json())

// 先用正常管道放一筆進去（模擬「別人上架的題庫」）
const victim = await (
  await fetch(`${url}/rest/v1/rpc/publish_item`, {
    method: 'POST', headers: K,
    body: JSON.stringify({
      p_title: '別人的題庫', p_description: '', p_author: '別人', p_slide_count: 3,
      p_type_counts: { single: 3 }, p_bundle_path: 'victim.zip', p_bundle_bytes: 100,
      p_has_assets: false, p_manage_hash: 'a'.repeat(64), p_cover_path: null,
    }),
  })
).json()
console.log(`放了一筆「${victim.title}」進去，id=${victim.id}\n`)

console.log('=== 拿 publishable key 試著搞破壞 ===')

// 1. 直接刪
const del = await fetch(`${url}/rest/v1/gallery_items?id=eq.${victim.id}`, { method: 'DELETE', headers: K })
check((await rows()).some((r) => r.id === victim.id), `直接 DELETE（HTTP ${del.status}）之後資料還在`)

// 2. 全表刪
const delAll = await fetch(`${url}/rest/v1/gallery_items?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: K })
check((await rows()).some((r) => r.id === victim.id), `想刪全表（HTTP ${delAll.status}）之後資料還在`)

// 3. 改別人的標題
const upd = await fetch(`${url}/rest/v1/gallery_items?id=eq.${victim.id}`, {
  method: 'PATCH', headers: K, body: JSON.stringify({ title: '被我改掉了' }),
})
check((await rows()).find((r) => r.id === victim.id)?.title === '別人的題庫', `想改標題（HTTP ${upd.status}）但標題沒變`)

// 4. 把別人的東西藏起來
const hide = await fetch(`${url}/rest/v1/gallery_items?id=eq.${victim.id}`, {
  method: 'PATCH', headers: K, body: JSON.stringify({ status: 'hidden' }),
})
check((await rows()).find((r) => r.id === victim.id)?.status === 'published', `想偷偷下架（HTTP ${hide.status}）但還在架上`)

// 5. 用錯的管理碼呼叫下架 RPC
const rm = await fetch(`${url}/rest/v1/rpc/remove_item`, {
  method: 'POST', headers: K, body: JSON.stringify({ p_id: victim.id, p_hash: 'b'.repeat(64) }),
})
check((await rm.text()) === 'false' && (await rows()).some((r) => r.id === victim.id), '管理碼不對，remove_item 回 false 且資料還在')

// 6. 直接 INSERT（繞過 publish_item 的驗證）
const ins = await fetch(`${url}/rest/v1/gallery_items`, {
  method: 'POST', headers: K,
  body: JSON.stringify({ title: '繞過驗證', author: 'x', slide_count: 999, bundle_path: 'x', bundle_bytes: 1, manage_hash: 'x' }),
})
check(!(await rows()).some((r) => r.title === '繞過驗證'), `直接 INSERT（HTTP ${ins.status}）沒有進去`)

// 7. 讀得到別人的管理碼雜湊嗎
const peek = await fetch(`${url}/rest/v1/gallery_items?select=manage_hash&limit=1`, { headers: K })
const peekTxt = await peek.text()
check(!/[0-9a-f]{64}/.test(peekTxt), `讀不到 manage_hash（${peekTxt.slice(0, 60)}）`)

// 8. 看得到被隱藏的嗎
await fetch(`${url}/rest/v1/gallery_items?id=eq.${victim.id}`, { method: 'PATCH', headers: S, body: JSON.stringify({ status: 'hidden' }) })
const hidden = await (await fetch(`${url}/rest/v1/gallery_items?select=id`, { headers: K })).json()
check(!hidden.some?.((r) => r.id === victim.id), '被隱藏的東西，一般人讀不到')

// 9. 能不能把別人的檔案砍掉
const rmObj = await fetch(`${url}/storage/v1/object/bundles/victim.zip`, { method: 'DELETE', headers: K })
check(!rmObj.ok, `刪不掉 Storage 裡的檔案（HTTP ${rmObj.status}）`)

// 10. 下載數可以灌水嗎（這支是開放的，本來就該讓人呼叫）
await fetch(`${url}/rest/v1/rpc/bump_download`, { method: 'POST', headers: K, body: JSON.stringify({ p_id: victim.id }) })
console.log('  （bump_download 本來就開放給所有人，灌水頂多讓排序失真，不是安全問題）')

// 收乾淨
await fetch(`${url}/rest/v1/gallery_items?id=eq.${victim.id}`, { method: 'DELETE', headers: S })
const end = await rows()
console.log(`\n清乾淨：剩 ${end.length} 筆`)
console.log(bad === 0 ? '\x1b[32m\x1b[1m ✓ publishable key 什麼都破壞不了\x1b[0m' : `\x1b[31m\x1b[1m ✗ ${bad} 項有洞\x1b[0m`)
process.exit(bad ? 1 : 0)
