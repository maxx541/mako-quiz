import { unzipSync } from 'fflate'
import { SLIDE_TYPES } from './quiz'

/**
 * 伺服器端的 bundle 檢查。
 *
 * 市集收到的 zip 是使用者給的，所以列表上顯示的標題／題數／題型
 * 一律**由伺服器自己拆開來算**，不採信 client 一起送上來的欄位 ——
 * 不然任何人都能傳一份垃圾、卻在列表上寫「共 50 題」騙人點。
 *
 * 順便當作把關：拆不開、沒有 presentation.json、沒有題目的，publish 當場就擋掉，
 * 不要等到別人下載了才發現是壞的。
 */

/**
 * 一整包題目簡報的上限 50 MB（單張圖 5 MB、單一音檔 15 MB 是另外分開擋的）。
 *
 * 三個地方要對齊，改一個就要三個一起改：
 *   1. 這裡（伺服器上架時擋）
 *   2. docs/supabase-setup.sql 的 bundles 桶子 file_size_limit
 *   3. Supabase 專案的全域上限（Dashboard → Storage → Settings）
 * 少改一個的話，會變成「這裡放行、Supabase 擋下來」，錯誤訊息還很難懂。
 */
export const MAX_BUNDLE = 50 * 1024 * 1024

export type BundleMeta = {
  title: string
  description: string
  slideCount: number
  /** { single: 3, reveal: 2 } —— 給列表顯示與篩選用 */
  typeCounts: Record<string, number>
  assetCount: number
  hasAssets: boolean
  /**
   * 封面圖：第一張有配圖的投影片的圖，從 zip 裡抽出來。
   *
   * 上架時就抽好另存，逛市集才不用為了一張縮圖去下載整包 ——
   * 一份 bundle 可能有 50 MB，列表上二十張卡片就是 1 GB。
   * 圖在外部網址（不在 zip 裡）時 bytes 是 null，只給 url。
   */
  cover: { bytes: Uint8Array; ext: string } | { url: string } | null
}

/** 圖片的 magic bytes（封面只收圖，不能讓人塞別的東西進 covers 桶） */
function imageExt(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp'
  return null
}

export class BundleError extends Error {}

export function readBundleMeta(data: Uint8Array): BundleMeta {
  if (!data?.length) throw new BundleError('沒有收到檔案')
  if (data.length > MAX_BUNDLE) throw new BundleError(`檔案不能超過 ${MAX_BUNDLE / 1024 / 1024} MB`)

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new BundleError('這不是一個有效的 zip 檔')
  }

  // 匯出時就叫這個名字；大小寫與路徑前綴都寬鬆一點，別人手動打包的也收
  const key = Object.keys(files).find((k) => k.split('/').pop()?.toLowerCase() === 'presentation.json')
  if (!key) throw new BundleError('zip 裡找不到 presentation.json')

  let pres: any
  try {
    pres = JSON.parse(new TextDecoder().decode(files[key]))
  } catch {
    throw new BundleError('presentation.json 不是合法的 JSON')
  }

  const slides = Array.isArray(pres?.slides) ? pres.slides : null
  if (!slides) throw new BundleError('presentation.json 裡缺少 slides 陣列')
  if (!slides.length) throw new BundleError('這份簡報沒有任何題目')
  if (slides.length > 200) throw new BundleError('一份簡報最多 200 題')

  const typeCounts: Record<string, number> = {}
  for (const s of slides) {
    const t = String(s?.type || '')
    // 不認得的題型直接擋 —— 下載回去也是壞的
    if (!SLIDE_TYPES[t]) throw new BundleError(`不支援的題型：${t || '(空白)'}`)
    typeCounts[t] = (typeCounts[t] || 0) + 1
  }

  const assetCount = Object.keys(files).filter((k) => k !== key && !k.endsWith('/')).length

  return {
    title: String(pres.title || '').trim().slice(0, 120) || '未命名簡報',
    description: String(pres.description || '').trim().slice(0, 500),
    slideCount: slides.length,
    typeCounts,
    assetCount,
    hasAssets: assetCount > 0,
    cover: findCover(pres, slides, files),
  }
}

/**
 * 挑封面：作者自己指定的那張優先，沒有才拿第一張有配圖的投影片。
 *
 * 規則要跟 store.ts 的 coverOf() 一致。自動挑的時候只看 slide.image ——
 * 解說圖常常直接畫著答案，拿它當封面等於在市集列表上爆雷。
 */
function findCover(pres: any, slides: any[], files: Record<string, Uint8Array>): BundleMeta['cover'] {
  for (const ref of [pres?.cover, ...slides.map((s: any) => s?.image)]) {
    if (!ref || typeof ref !== 'string') continue

    // 外部網址不在包裡，直接把網址帶著走
    if (/^https?:\/\//i.test(ref)) return { url: ref.slice(0, 500) }

    // JSON 寫的是 assets/xxx.png，用檔名去對（大小寫與路徑寬鬆一點）
    const want = ref.split(/[\\/]/).pop()?.toLowerCase()
    const hit = Object.keys(files).find((k) => k.split('/').pop()?.toLowerCase() === want)
    if (!hit) continue
    const ext = imageExt(files[hit])
    if (ext) return { bytes: files[hit], ext }
  }
  return null
}
