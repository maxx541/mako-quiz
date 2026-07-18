import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, uid } from './store'
import { BundleError, MAX_BUNDLE, readBundleMeta, type BundleMeta } from './bundle'
import { SupabaseGallery, supabaseConfigured } from './supabase'

/**
 * 題庫市集。
 *
 * ── 邊界 ──
 * 市集是**唯一**會碰到雲端的地方，而且只在三個時刻：逛、上架、下載。
 * 下載完的東西會走現有的匯入流程落地成本地簡報，之後編輯、播放、辦活動
 * 全部走本地，跟這裡無關。所以 `store.ts` 一行都不用改，沒網路也照樣辦活動。
 *
 * ── 為什麼要有驅動這層 ──
 * 沒設定 Supabase 的時候，市集不該整個壞掉 —— 它會退回本機驅動，
 * 東西存在 data/gallery/。這同時也是開發與測試用的替身：
 * 425 項測試不需要連到真的 Supabase 才能跑。
 *
 * 之後接 Supabase 就是再寫一個驅動實作同一組介面，其他地方都不用動。
 */

export type GalleryItem = {
  id: string
  title: string
  description: string
  author: string
  slideCount: number
  typeCounts: Record<string, number>
  bytes: number
  hasAssets: boolean
  downloads: number
  createdAt: number
  /** 封面圖的網址（沒有配圖的題庫就是 null） */
  cover: string | null
}

export type GalleryQuery = {
  /** 標題／作者／說明的關鍵字 */
  q?: string
  /** 只看有這個題型的（例如只想找猜圖題） */
  type?: string
  sort?: 'new' | 'popular'
  limit?: number
  offset?: number
}

export type PublishInput = {
  bundle: Uint8Array
  author: string
  description?: string
}

/** 管理員看得到的：多了狀態與檢舉，一般人拿不到這些 */
export type AdminItem = GalleryItem & { status: 'published' | 'hidden'; reports: string[] }

export interface GalleryDriver {
  /** 顯示在 UI 上，讓人知道現在連的是哪裡 */
  readonly name: string
  readonly remote: boolean
  /**
   * 這台機器能不能管市集。
   *
   * 本機市集永遠可以（那本來就是你自己的東西）。雲端市集則要有 secret key ——
   * 主持人密碼是每個人自己設的，拿它當管理員憑證等於人人都能刪別人的題庫。
   */
  readonly canAdmin: boolean
  list(query: GalleryQuery): Promise<{ items: GalleryItem[]; total: number }>
  get(id: string): Promise<GalleryItem | null>
  publish(input: PublishInput): Promise<{ item: GalleryItem }>
  /** @returns null = 找不到 */
  download(id: string): Promise<{ item: GalleryItem; bundle: Uint8Array } | null>
  report(id: string, reason: string): Promise<void>

  /* --- 以下是市集管理員用的，不看管理碼 --- */

  /** 連被隱藏的也列出來 */
  adminList(): Promise<AdminItem[]>
  /** 不用管理碼，直接砍 */
  adminRemove(id: string): Promise<boolean>
  /** 上架／下架。被檢舉自動隱藏的東西要有辦法放回去，不然誤報就等於永久消失 */
  adminSetStatus(id: string, status: 'published' | 'hidden'): Promise<boolean>
}

/* ---------------- 本機驅動 ---------------- */

const GALLERY_DIR = path.join(DATA_DIR, 'gallery')
const INDEX_FILE = path.join(GALLERY_DIR, 'index.json')
const BUNDLE_DIR = path.join(GALLERY_DIR, 'bundles')
const COVER_DIR = path.join(GALLERY_DIR, 'covers')

type Row = GalleryItem & {
  status: 'published' | 'hidden'
  reports: string[]
  /** 封面檔名（存在 data/gallery/covers/）。外部網址的話 cover 直接就是網址，這裡是空的 */
  coverFile?: string
}

class LocalGallery implements GalleryDriver {
  readonly name = '本機'
  readonly remote = false
  // 本機市集就是自己的資料，管自己的東西不需要額外憑證
  readonly canAdmin = true
  private cache: Map<string, Row> | null = null

  private load() {
    if (this.cache) return this.cache
    this.cache = new Map()
    fs.mkdirSync(BUNDLE_DIR, { recursive: true })
    if (fs.existsSync(INDEX_FILE)) {
      try {
        for (const r of JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))) this.cache.set(r.id, r)
      } catch (err: any) {
        // 壞掉就備份，不要直接蓋掉使用者的東西（跟 store.ts 同一個處理方式）
        const backup = INDEX_FILE + '.broken-' + Date.now()
        fs.copyFileSync(INDEX_FILE, backup)
        console.error(`[gallery] index.json 解析失敗，已備份到 ${backup}`, err.message)
      }
    }
    return this.cache
  }

  private persist() {
    const tmp = INDEX_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify([...this.load().values()], null, 2), 'utf8')
    fs.renameSync(tmp, INDEX_FILE)
  }

  private bundlePath = (id: string) => path.join(BUNDLE_DIR, `${id}.zip`)

  private toItem(r: Row): GalleryItem {
    // status / reports / coverFile 是管理員才該看的，不外流
    const { status, reports, coverFile, ...item } = r
    return item
  }

  /** 封面檔案的實體路徑（給 cover 路由讀） */
  coverPath(id: string): string | null {
    const r = this.load().get(id)
    if (!r?.coverFile) return null
    const f = path.join(COVER_DIR, r.coverFile)
    return fs.existsSync(f) ? f : null
  }

  async list(query: GalleryQuery) {
    const q = String(query.q || '').trim().toLowerCase()
    let rows = [...this.load().values()].filter((r) => r.status === 'published')
    if (q) {
      rows = rows.filter((r) =>
        [r.title, r.author, r.description].some((f) => String(f).toLowerCase().includes(q))
      )
    }
    if (query.type) rows = rows.filter((r) => (r.typeCounts[query.type!] || 0) > 0)
    rows.sort((a, b) =>
      query.sort === 'popular' ? b.downloads - a.downloads || b.createdAt - a.createdAt : b.createdAt - a.createdAt
    )
    const total = rows.length
    const offset = Math.max(0, Number(query.offset) || 0)
    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24))
    return { items: rows.slice(offset, offset + limit).map((r) => this.toItem(r)), total }
  }

  async get(id: string) {
    const r = this.load().get(id)
    return r && r.status === 'published' ? this.toItem(r) : null
  }

  async publish({ bundle, author, description }: PublishInput) {
    const meta: BundleMeta = readBundleMeta(bundle)
    const name = String(author || '').trim().slice(0, 40)
    if (!name) throw new BundleError('請留下發布者名稱')

    const id = uid('g_')

    // 封面在上架時就抽出來另存，逛市集才不用為了縮圖下載整包 zip
    let cover: string | null = null
    let coverFile: string | undefined
    if (meta.cover && 'url' in meta.cover) {
      cover = meta.cover.url
    } else if (meta.cover) {
      coverFile = `${id}.${meta.cover.ext}`
      fs.mkdirSync(COVER_DIR, { recursive: true })
      fs.writeFileSync(path.join(COVER_DIR, coverFile), meta.cover.bytes)
      cover = `/api/gallery/${id}/cover`
    }

    const row: Row = {
      id,
      title: meta.title,
      // 發布時填的說明優先，沒填就用簡報自己的
      description: String(description || '').trim().slice(0, 500) || meta.description,
      author: name,
      slideCount: meta.slideCount,
      typeCounts: meta.typeCounts,
      bytes: bundle.length,
      hasAssets: meta.hasAssets,
      downloads: 0,
      createdAt: Date.now(),
      cover,
      status: 'published',
      reports: [],
      coverFile,
    }
    fs.mkdirSync(BUNDLE_DIR, { recursive: true })
    try {
      fs.writeFileSync(this.bundlePath(id), bundle)
    } catch (err: any) {
      // 本機市集的「容量不足」就是硬碟滿了，講清楚比丟 ENOSPC 給他好
      if (err?.code === 'ENOSPC') throw new BundleError('硬碟空間不足，存不下這一包。')
      throw err
    }
    this.load().set(id, row)
    this.persist()
    return { item: this.toItem(row) }
  }

  async download(id: string) {
    const r = this.load().get(id)
    if (!r || r.status !== 'published') return null
    const file = this.bundlePath(id)
    if (!fs.existsSync(file)) return null
    r.downloads += 1
    this.persist()
    return { item: this.toItem(r), bundle: new Uint8Array(fs.readFileSync(file)) }
  }

  /** 砍掉一筆的所有檔案（zip ＋ 封面），不然封面會變成沒人指得到的孤兒 */
  private dropFiles(id: string, r: Row) {
    fs.rmSync(this.bundlePath(id), { force: true })
    if (r.coverFile) fs.rmSync(path.join(COVER_DIR, r.coverFile), { force: true })
  }

  async report(id: string, reason: string) {
    const r = this.load().get(id)
    if (!r) return
    r.reports.push(String(reason || '').slice(0, 200))
    // 累積三次檢舉就自動下架，等人來看 —— 一個人的誤按不該讓東西消失
    if (r.reports.length >= 3) r.status = 'hidden'
    this.persist()
  }

  async adminList(): Promise<AdminItem[]> {
    return [...this.load().values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ coverFile, ...rest }) => rest as AdminItem)
  }

  async adminRemove(id: string) {
    const r = this.load().get(id)
    if (!r) return false
    this.dropFiles(id, r)
    this.load().delete(id)
    this.persist()
    return true
  }

  async adminSetStatus(id: string, status: 'published' | 'hidden') {
    const r = this.load().get(id)
    if (!r) return false
    r.status = status
    // 放回去就把檢舉紀錄清掉，不然下一個檢舉又立刻把它壓下去
    if (status === 'published') r.reports = []
    this.persist()
    return true
  }
}

/* ---------------- 選驅動 ---------------- */

let driver: GalleryDriver | null = null

/**
 * .env 有 Supabase 金鑰就連雲端市集，沒有就用本機的。
 *
 * 沒金鑰**不該讓程式壞掉** —— 只是市集上只有自己上架的東西，
 * 其他功能（辦活動、編輯、匯入匯出）本來就跟市集無關。
 *
 * 注意 node 不會自己讀 .env（那是 Nuxt 開發模式才有的事），
 * 所以 start.ps1 是用 `node --env-file-if-exists=.env` 把它帶進來的。
 */
export function gallery(): GalleryDriver {
  if (!driver) {
    driver = supabaseConfigured() ? new SupabaseGallery() : new LocalGallery()
    console.log(`[gallery] 題庫市集：${driver.name}${driver.canAdmin ? '' : '（這台沒有管理權限）'}`)
  }
  return driver
}

/**
 * 市集後台的把關。
 *
 * 主持人密碼擋不住這件事：市集是大家共用的，而每個人手上都有「自己那台機器的
 * 主持人密碼」。所以雲端市集另外要求 secret key，那個只在市集主人的 .env 裡。
 */
export function requireGalleryAdmin() {
  if (!gallery().canAdmin) {
    throw createError({
      statusCode: 403,
      data: { error: '這台機器沒有市集管理權限（只有市集主人設定了 SUPABASE_SECRET_KEY 的那台才有）' },
    })
  }
}

export { MAX_BUNDLE, BundleError }
