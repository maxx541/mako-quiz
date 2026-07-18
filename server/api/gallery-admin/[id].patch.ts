import { requireAuth } from '../../utils/auth'
import { gallery, requireGalleryAdmin } from '../../utils/gallery'

/** 市集後台：上架／下架。被檢舉自動隱藏的東西要有辦法放回去。 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  requireGalleryAdmin()
  const { status } = (await readBody(event)) || {}
  if (status !== 'published' && status !== 'hidden') {
    throw createError({ statusCode: 400, data: { error: 'status 只能是 published 或 hidden' } })
  }
  const ok = await gallery().adminSetStatus(getRouterParam(event, 'id')!, status)
  if (!ok) throw createError({ statusCode: 404, data: { error: '找不到這份題庫' } })
  return { ok: true }
})
