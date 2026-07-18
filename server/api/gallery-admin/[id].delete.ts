import { requireAuth } from '../../utils/auth'
import { gallery, requireGalleryAdmin } from '../../utils/gallery'

/** 市集後台：直接刪掉，不用管理碼 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  requireGalleryAdmin()
  const ok = await gallery().adminRemove(getRouterParam(event, 'id')!)
  if (!ok) throw createError({ statusCode: 404, data: { error: '找不到這份題庫' } })
  return { ok: true }
})
