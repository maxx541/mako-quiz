import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { UPLOAD_DIR } from './store'

/*
 * 單一檔案的上限（整包 bundle 的上限是另一回事，見 bundle.ts 的 MAX_BUNDLE）。
 *
 * 改這裡的話，這幾個地方的文案要一起改：
 *   app/components/ImagePicker.vue  「最大 5 MB」
 *   app/pages/editor.vue            音檔的「最大 15 MB」（兩處）
 *   README.md
 */
export const MAX_IMAGE = 5 * 1024 * 1024
export const MAX_AUDIO = 15 * 1024 * 1024

export type Sig = { ext: string; mime: string; kind: 'image' | 'audio'; test: (b: Buffer) => boolean }

/** 一律用檔案本身的 magic bytes 判斷，不信任副檔名或 client 給的 MIME */
export const SIGNATURES: Sig[] = [
  // 圖片
  { ext: 'png', mime: 'image/png', kind: 'image', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', kind: 'image', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  {
    ext: 'webp',
    mime: 'image/webp',
    kind: 'image',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  // 音訊
  {
    ext: 'mp3',
    mime: 'audio/mpeg',
    kind: 'audio',
    // 有 ID3 標籤，或直接是 MPEG frame header
    test: (b) => b.subarray(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  },
  { ext: 'ogg', mime: 'audio/ogg', kind: 'audio', test: (b) => b.subarray(0, 4).toString('ascii') === 'OggS' },
  {
    ext: 'wav',
    mime: 'audio/wav',
    kind: 'audio',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
  {
    ext: 'm4a',
    mime: 'audio/mp4',
    kind: 'audio',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && /M4A|mp4|isom|iso2/.test(b.subarray(8, 12).toString('ascii')),
  },
  { ext: 'flac', mime: 'audio/flac', kind: 'audio', test: (b) => b.subarray(0, 4).toString('ascii') === 'fLaC' },
]

export const sniff = (buf: Buffer) => SIGNATURES.find((s) => s.test(buf)) || null

/** 檔名一律自己產生，不用使用者給的（避免路徑穿越與覆蓋別人的檔案） */
export async function saveUpload(data: Buffer, ext: string) {
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${ext}`
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.writeFile(path.join(UPLOAD_DIR, name), data)
  return { url: `/uploads/${name}`, name }
}
