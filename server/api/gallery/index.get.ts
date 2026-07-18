import { gallery } from '../../utils/gallery'

/**
 * 逛市集。
 *
 * 刻意不要求登入 —— 市集是拿來逛的，而且之後接上 Supabase 之後
 * 本來就是公開資料。發布與刪除才需要身分。
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const driver = gallery()
  const { items, total } = await driver.list({
    q: String(q.q || ''),
    type: String(q.type || '') || undefined,
    sort: q.sort === 'popular' ? 'popular' : 'new',
    limit: Number(q.limit) || 24,
    offset: Number(q.offset) || 0,
  })
  // canAdmin 決定前端要不要顯示「市集後台」的按鈕
  return { items, total, source: driver.name, remote: driver.remote, canAdmin: driver.canAdmin }
})
