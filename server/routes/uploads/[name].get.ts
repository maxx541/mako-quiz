import fs from 'node:fs'
import path from 'node:path'
import { UPLOAD_DIR } from '../../utils/store'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
}

export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'name') || ''
  // 只允許上傳流程產生的檔名格式，順便擋掉 ../ 之類的路徑穿越
  if (!/^[a-z0-9]+-[a-f0-9]{16}\.(png|jpg|gif|webp|mp3|ogg|wav|m4a|flac)$/i.test(raw)) {
    throw createError({ statusCode: 400, data: { error: '檔名不合法' } })
  }
  const file = path.join(UPLOAD_DIR, path.basename(raw))
  if (!fs.existsSync(file)) throw createError({ statusCode: 404, data: { error: '找不到檔案' } })

  const size = fs.statSync(file).size
  setHeader(event, 'Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'Accept-Ranges', 'bytes')

  // 音檔要能拖曳進度、能從中間開始播，就必須真的回應 Range request
  const range = getHeader(event, 'range')
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m) {
    const start = m[1] ? Number(m[1]) : 0
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (Number.isNaN(start) || start > end || start >= size) {
      setHeader(event, 'Content-Range', `bytes */${size}`)
      throw createError({ statusCode: 416, data: { error: '範圍不合法' } })
    }
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${size}`)
    setHeader(event, 'Content-Length', end - start + 1)
    return sendStream(event, fs.createReadStream(file, { start, end }))
  }

  setHeader(event, 'Content-Length', size)
  return sendStream(event, fs.createReadStream(file))
})
