import fs from 'node:fs'
import path from 'node:path'
import { SOUND_ACTIONS, SOUND_DIR } from '../../utils/store'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
}

export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'name') || ''
  const ext = path.extname(raw).toLowerCase()
  const base = path.basename(raw, ext)
  // 只認得 SOUND_ACTIONS 裡的名字：順便擋掉 ../ 之類的路徑穿越
  if (!Object.prototype.hasOwnProperty.call(SOUND_ACTIONS, base) || !MIME[ext]) {
    throw createError({ statusCode: 400, data: { error: '檔名不合法' } })
  }
  const file = path.join(SOUND_DIR, base + ext)
  if (!fs.existsSync(file)) throw createError({ statusCode: 404, data: { error: '找不到檔案' } })

  setHeader(event, 'Content-Type', MIME[ext])
  // 換檔案要馬上聽得到，所以不做長快取
  setHeader(event, 'Cache-Control', 'no-cache')
  return fs.createReadStream(file)
})
