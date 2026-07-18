import { requireAuth } from '../utils/auth'
import { MAX_AUDIO, MAX_IMAGE, saveUpload, sniff } from '../utils/media'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.filename)
  if (!file?.data?.length) throw createError({ statusCode: 400, data: { error: '沒有收到檔案' } })

  const sig = sniff(file.data)
  if (!sig) {
    throw createError({
      statusCode: 415,
      data: { error: '只支援圖片（PNG / JPG / GIF / WebP）與音訊（MP3 / OGG / WAV / M4A / FLAC）' },
    })
  }

  const limit = sig.kind === 'audio' ? MAX_AUDIO : MAX_IMAGE
  if (file.data.length > limit) {
    throw createError({
      statusCode: 413,
      data: { error: `${sig.kind === 'audio' ? '音訊' : '圖片'}不能超過 ${limit / 1024 / 1024} MB` },
    })
  }

  const { url, name } = await saveUpload(file.data, sig.ext)
  return { url, name, size: file.data.length, type: sig.mime, kind: sig.kind }
})
