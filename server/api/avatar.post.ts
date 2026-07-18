import { findSession } from '../utils/session'
import { saveUpload, sniff } from '../utils/media'

/**
 * 參與者上傳頭像。
 *
 * 這支不能用 requireAuth —— 參與者沒有主持人的密碼，他手上只有加入這一場時
 * 拿到的 session token。所以改成「房號 + 自己的 token」認人：token 是不可猜的
 * 亂數，而且只認得出他自己，換不到別人的身分。
 *
 * 手機端已經先用 canvas 縮成 256x256 了，所以這裡的上限壓得很低：
 * 正常流程根本碰不到，會碰到的就是繞過前端硬塞的人。
 */
const MAX_AVATAR = 512 * 1024

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const field = (n: string) => parts?.find((p) => p.name === n && !p.filename)?.data?.toString('utf8') || ''

  const session = findSession(field('code'))
  if (!session) throw createError({ statusCode: 404, data: { error: '場次不存在或已過期' } })

  const player = session.playerByToken(field('token'))
  if (!player) throw createError({ statusCode: 401, data: { error: '請重新加入房間' } })

  const file = parts?.find((p) => p.name === 'file' && p.filename)
  if (!file?.data?.length) throw createError({ statusCode: 400, data: { error: '沒有收到檔案' } })

  const sig = sniff(file.data)
  if (!sig || sig.kind !== 'image') throw createError({ statusCode: 415, data: { error: '頭像必須是圖片' } })
  if (file.data.length > MAX_AVATAR) throw createError({ statusCode: 413, data: { error: '頭像太大了' } })

  const { url } = await saveUpload(file.data, sig.ext)
  session.setAvatar(player.id, url)
  return { url }
})
