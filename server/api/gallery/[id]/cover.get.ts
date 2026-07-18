import fs from 'node:fs'
import { gallery } from '../../../utils/gallery'

/**
 * 本機市集的封面圖。
 *
 * 雲端市集的封面是 Supabase Storage 的公開網址，前端直接連過去，不會走到這裡。
 */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export default defineEventHandler(async (event) => {
  const driver: any = gallery()
  const file = driver.coverPath?.(getRouterParam(event, 'id')!)
  if (!file) throw createError({ statusCode: 404, data: { error: '沒有封面' } })

  const ext = file.split('.').pop()!.toLowerCase()
  setHeader(event, 'content-type', MIME[ext] || 'application/octet-stream')
  // 封面上架後就不會變了，讓瀏覽器存著，逛市集才不會每次都重抓
  setHeader(event, 'cache-control', 'public, max-age=86400')
  return fs.readFileSync(file)
})
