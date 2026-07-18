import { requireAuth } from '../../utils/auth'
import { gallery, requireGalleryAdmin } from '../../utils/gallery'

/**
 * 市集後台：列出全部（含被檢舉隱藏的）。
 *
 * 路徑刻意用 /api/gallery-admin 而不是 /api/gallery/admin ——
 * 後者會跟 /api/gallery/[id] 這個動態段撞在一起，"admin" 會被當成一個 id。
 *
 * 兩道關卡：要登入主持後台（requireAuth），而且這台機器要有管理權限。
 * 雲端市集的管理權限＝.env 裡有 secret key，只有市集主人那台才有 ——
 * 主持人密碼是每個人自己設的，光憑它不能當管理員憑證。
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  requireGalleryAdmin()
  return { items: await gallery().adminList() }
})
