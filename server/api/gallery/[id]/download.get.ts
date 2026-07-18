import { gallery } from '../../../utils/gallery'

/**
 * 下載一份題庫的 bundle。
 *
 * 回傳的就是原本那個 zip —— client 拿到之後走現有的匯入流程落地成本地簡報，
 * 素材也會重新上傳成這台機器自己的 /uploads/…。那套邏輯已經有測試在守
 * （「匯出 → 刪除 → 重新匯入能逐位元組還原所有素材」），這裡不重做。
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const got = await gallery().download(id)
  if (!got) throw createError({ statusCode: 404, data: { error: '找不到這份題庫' } })

  setHeader(event, 'content-type', 'application/zip')
  // 檔名可能有中文，用 RFC 5987 的寫法，不然瀏覽器會存成亂碼
  const safe = encodeURIComponent(`${got.item.title}.zip`)
  setHeader(event, 'content-disposition', `attachment; filename*=UTF-8''${safe}`)
  return got.bundle
})
