import type { AdminItem, GalleryDriver, GalleryItem, GalleryQuery, PublishInput } from './gallery'
import { BundleError } from './gallery'
import { MAX_BUNDLE, readBundleMeta } from './bundle'

/**
 * 題庫市集的 Supabase 驅動。
 *
 * ── 為什麼不用 @supabase/supabase-js ──
 * 我們只需要幾支 REST 端點（PostgREST + Storage），用 fetch 直接打就好，
 * 不值得為此多背一個相依套件。這個專案的相依一直很少，維持下去。
 *
 * ── 兩把金鑰 ──
 * publishable key 是公開的，每個人的程式裡都有，所以安全性完全靠資料庫的 RLS：
 * 只讀得到已上架的，寫一律走 security definer 的函式（見 docs/supabase-setup.sql）。
 *
 * secret key 只有市集主人那台機器的 .env 裡才有，用來做「管理員」的事
 * （列出被隱藏的、刪別人的、上下架）。沒有它就沒有市集後台 ——
 * 這正是我們要的：主持人密碼人人都有，不能拿來當管理員憑證。
 */

// 金鑰在啟動時就從 .env 讀進來（start.ps1 用 node --env-file-if-exists=.env 帶進來的）
const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
// Supabase 把 anon key 改叫 publishable key 了，兩個名字都收
const SUPA_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
const SUPA_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const supabaseConfigured = () => !!(SUPA_URL && SUPA_KEY)

const BUCKET = 'bundles'
// 封面另外一個桶子：bundles 只收 application/zip，圖塞不進去
const COVERS = 'covers'

/*
 * 公開查詢一律列出欄位，不要用 select=*。
 *
 * reports（檢舉理由）在資料庫端就不開放給 anon 讀（見 supabase-setup.sql 的
 * 欄位層級授權），select=* 會直接被 Postgres 以「permission denied for column」
 * 擋下來 —— 列清楚才是對的。後台走 secret key，不受這個限制。
 */
const PUBLIC_COLS =
  'id,title,description,author,slide_count,type_counts,bundle_path,cover_path,bundle_bytes,has_assets,downloads,status,created_at'

/**
 * 把 Supabase 的錯誤翻成使用者看得懂的話。
 *
 * ── 為什麼需要這個 ──
 * Storage 的錯誤**一律回 HTTP 400**，真正的錯誤碼藏在 body 的 `statusCode` 欄位裡
 * （實測：超過上限是 400 + statusCode:"413"、桶子不存在是 400 + statusCode:"404"）。
 * 所以只看 res.status 會得到「上傳失敗（400）」這種等於沒講的訊息。
 *
 * 下面的對應是實際打過 API 記下來的，除了「容量不足」那條 —— 那要真的把
 * 免費版的 1 GB 塞滿才觸發得到，我沒辦法驗，所以用比較寬的字串比對接住它。
 */
export function explainSupabase(httpStatus: number, body: string): string {
  let j: any = {}
  try {
    j = JSON.parse(body)
  } catch {}
  const code = String(j.statusCode || j.code || httpStatus)
  const msg = String(j.message || body || '')

  // 容量不足：這條沒實測過（要塞滿 1 GB），所以比對放寬一點，寧可多接
  if (/quota|storage limit|exceeded your|maximum storage|out of storage|insufficient storage/i.test(msg)) {
    return '雲端資料庫容量不足了 —— 市集上的東西太多，塞不下新的。請到 Supabase 後台清掉一些舊題庫，或升級方案。'
  }
  /*
   * 走到這裡代表「程式這邊已經放行、雲端才擋下來」—— publish 之前就用 MAX_BUNDLE 檢查過了。
   * 所以這不是使用者的包太大，是雲端的上限比程式設的還小，兩邊沒對齊。
   */
  if (code === '413' || /exceeded the maximum allowed size|payload too large|entity too large/i.test(msg)) {
    return (
      `雲端擋下了這一包 —— 雲端的上限比程式設的 ${MAX_BUNDLE / 1024 / 1024} MB 還小，兩邊沒對齊。` +
      '請把 docs/supabase-setup.sql 重新跑一次（裡面會設定桶子的上限），' +
      '並確認 Supabase 專案的全域上限（Dashboard → Storage → Settings）沒有設得更低。'
    )
  }
  if (code === '404' && /bucket not found/i.test(msg)) {
    return '雲端還沒建好（找不到 bundles／covers 桶子）。請把 docs/supabase-setup.sql 貼到 Supabase 的 SQL Editor 跑一次。'
  }
  if (/invalid_mime_type|mime type .* is not supported/i.test(msg)) {
    return '檔案型別不對，雲端擋下來了。'
  }
  if (/invalid api key|jwt|invalid signature/i.test(msg) || httpStatus === 401) {
    return '.env 裡的 Supabase 金鑰不對或過期了，請重新複製一次 Publishable key。'
  }
  if (/PGRST202|could not find the function/i.test(msg)) {
    return '雲端的資料庫版本跟程式對不上（函式簽章不符）。請把 docs/supabase-setup.sql 重新跑一次。'
  }
  if (/PGRST205|could not find the table/i.test(msg)) {
    return '雲端還沒建好（找不到 gallery_items 資料表）。請把 docs/supabase-setup.sql 貼到 SQL Editor 跑一次。'
  }
  /*
   * CHECK 違反（Postgres 23514）。
   *
   * 以前這裡一律翻成「太大，上限 50 MB」，但那常常是錯的 —— 最常見的情況其實是
   * 「資料表是用舊版 SQL 建的，某個欄位上限比現在小」。create table if not exists
   * 不會動到已經存在的表的 CHECK，偏偏 Storage 桶子的上限是用 on conflict 更新的，
   * 於是變成「檔案傳得上去、資料列卻插不進來」，還被回報成「太大」。
   * 把違反的是哪個欄位認出來，講對的話、指對的路（重跑 SQL 會一起修好 CHECK）。
   */
  if (code === '23514' || /violates check constraint/i.test(msg)) {
    const con = /check constraint "?([a-z0-9_]+)"?/i.exec(msg)?.[1] || ''
    const rerun = '請把 docs/supabase-setup.sql 重新跑一次（新版會把上限對齊），再上架一次。'
    if (/bundle_bytes/.test(con)) {
      return `雲端資料庫擋下了這一包的大小 —— 多半是資料庫是用舊版 SQL 建的、上限比現在的 ${MAX_BUNDLE / 1024 / 1024} MB 小（檔案其實有傳上去，是資料列插不進來）。${rerun}`
    }
    if (/slide_count/.test(con)) return `雲端資料庫的題數上限比這份簡報小 —— 多半是舊版 SQL 的限制。${rerun}`
    if (/description/.test(con)) return '發布說明超過雲端上限（500 字），請縮短一點再上架。'
    if (/title/.test(con)) return '標題超過雲端上限（120 字），請縮短一點再上架。'
    if (/author/.test(con)) return '發布者名稱超過雲端上限（40 字），請縮短一點。'
    return `雲端資料庫擋下了這一列（違反 ${con || '某個欄位限制'}）—— 多半是資料庫是用舊版 SQL 建的。${rerun}`
  }
  if (httpStatus >= 500) {
    return `雲端暫時有問題（${code}）。Supabase 免費專案閒置七天會自動暫停，去 Dashboard 看一下是不是睡著了。`
  }
  // 認不出來的就原樣附上 —— 猜錯方向比直接講「不知道」更浪費時間
  return `市集連線失敗（${code}）：${msg.slice(0, 160)}`
}

type Row = {
  id: string
  title: string
  description: string
  author: string
  slide_count: number
  type_counts: Record<string, number>
  bundle_path: string
  cover_path: string | null
  bundle_bytes: number
  has_assets: boolean
  downloads: number
  status: 'published' | 'hidden'
  reports: string[]
  created_at: string
}

/** 送出去給前端的欄位 */
const toItem = (r: Row): GalleryItem => ({
  id: r.id,
  title: r.title,
  description: r.description || '',
  author: r.author,
  slideCount: r.slide_count,
  typeCounts: r.type_counts || {},
  bytes: r.bundle_bytes,
  hasAssets: r.has_assets,
  downloads: r.downloads,
  createdAt: new Date(r.created_at).getTime(),
  // 外部網址直接用；存在 Storage 的就給公開網址（前端直連，不繞經我們的伺服器）
  cover: !r.cover_path
    ? null
    : /^https?:\/\//i.test(r.cover_path)
      ? r.cover_path
      : `${SUPA_URL}/storage/v1/object/public/${COVERS}/${r.cover_path}`,
})

export class SupabaseGallery implements GalleryDriver {
  readonly name = '雲端'
  readonly remote = true
  /** 有 secret key 的那台機器才是管理員 */
  readonly canAdmin = !!SUPA_SECRET

  private async call(path: string, opts: RequestInit & { secret?: boolean } = {}) {
    const key = opts.secret ? SUPA_SECRET : SUPA_KEY
    const res = await fetch(SUPA_URL + path, {
      ...opts,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      throw new BundleError(explainSupabase(res.status, await res.text().catch(() => '')))
    }
    return res.status === 204 ? null : res.json()
  }

  private rpc(fn: string, args: any, secret = false) {
    return this.call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args), secret })
  }

  async list(query: GalleryQuery) {
    const p = new URLSearchParams()
    p.set('select', PUBLIC_COLS)
    p.set('status', 'eq.published')
    p.set('order', query.sort === 'popular' ? 'downloads.desc,created_at.desc' : 'created_at.desc')

    if (query.q?.trim()) {
      // PostgREST 的 or 語法：任一欄位模糊比對（* 是它的萬用字元）
      const kw = query.q.trim().replace(/[(),*]/g, '')
      p.set('or', `(title.ilike.*${kw}*,author.ilike.*${kw}*,description.ilike.*${kw}*)`)
    }
    // jsonb 的鍵存在與否：type_counts ? 'reveal'
    if (query.type) p.set('type_counts', `cs.{"${query.type}":0}`)

    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24))
    const offset = Math.max(0, Number(query.offset) || 0)
    p.set('limit', String(limit))
    p.set('offset', String(offset))

    const res = await fetch(`${SUPA_URL}/rest/v1/gallery_items?${p}`, {
      headers: {
        apikey: SUPA_KEY,
        Authorization: 'Bearer ' + SUPA_KEY,
        // 要總數就得請它回 content-range
        Prefer: 'count=exact',
      },
    })
    if (!res.ok) throw new BundleError(explainSupabase(res.status, await res.text().catch(() => '')))
    const rows: Row[] = await res.json()
    const total = Number(res.headers.get('content-range')?.split('/')?.[1]) || rows.length
    return { items: rows.map(toItem), total }
  }

  async get(id: string) {
    const rows: Row[] = await this.call(`/rest/v1/gallery_items?id=eq.${id}&status=eq.published&select=${PUBLIC_COLS}&limit=1`)
    return rows?.[0] ? toItem(rows[0]) : null
  }

  async publish({ bundle, author, description }: PublishInput) {
    const meta = readBundleMeta(bundle)
    const name = String(author || '').trim().slice(0, 40)
    if (!name) throw new BundleError('請留下發布者名稱')

    // 檔名自己產，不要用使用者給的（路徑穿越 + 覆蓋別人的檔案）
    const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.zip`

    const up = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/zip',
      },
      body: bundle,
    })
    if (!up.ok) {
      throw new BundleError(explainSupabase(up.status, await up.text().catch(() => '')))
    }

    // 封面在上架時就抽出來另存，逛市集才不用為了縮圖下載整包 zip
    let coverPath: string | null = null
    if (meta.cover && 'url' in meta.cover) {
      coverPath = meta.cover.url
    } else if (meta.cover) {
      coverPath = `${path.replace(/\.zip$/, '')}.${meta.cover.ext}`
      const cu = await fetch(`${SUPA_URL}/storage/v1/object/${COVERS}/${coverPath}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: 'Bearer ' + SUPA_KEY,
          'Content-Type': meta.cover.ext === 'png' ? 'image/png' : meta.cover.ext === 'gif' ? 'image/gif' : meta.cover.ext === 'webp' ? 'image/webp' : 'image/jpeg',
        },
        body: meta.cover.bytes,
      })
      // 封面傳不上去不該讓整個上架失敗 —— 沒有縮圖只是難看，不是壞掉
      if (!cu.ok) coverPath = null
    }

    try {
      const row: Row = await this.rpc('publish_item', {
        p_title: meta.title,
        p_description: String(description || '').trim().slice(0, 500) || meta.description,
        p_author: name,
        p_slide_count: meta.slideCount,
        p_type_counts: meta.typeCounts,
        p_bundle_path: path,
        p_cover_path: coverPath,
        p_bundle_bytes: bundle.length,
        p_has_assets: meta.hasAssets,
      })
      return { item: toItem(row) }
    } catch (err) {
      // 檔案已經傳上去了但資料列建不起來 —— 留著會變成沒人指得到的孤兒檔案
      await this.dropObjects({
        bundle: path,
        cover: coverPath && !/^https?:\/\//i.test(coverPath) ? coverPath : undefined,
      })
      throw err
    }
  }

  async download(id: string) {
    const rows: Row[] = await this.call(`/rest/v1/gallery_items?id=eq.${id}&status=eq.published&select=${PUBLIC_COLS}&limit=1`)
    const row = rows?.[0]
    if (!row) return null

    const res = await fetch(`${SUPA_URL}/storage/v1/object/public/${BUCKET}/${row.bundle_path}`)
    if (!res.ok) return null
    const bundle = new Uint8Array(await res.arrayBuffer())

    // 下載數算不算得成不該影響「他到底拿不拿得到檔案」
    await this.rpc('bump_download', { p_id: id }).catch(() => {})
    return { item: toItem(row), bundle }
  }

  async report(id: string, reason: string) {
    await this.rpc('report_item', { p_id: id, p_reason: String(reason || '') })
  }

  /* ---------------- 管理員（只有拿得到 secret key 的那台機器） ---------------- */

  private requireSecret() {
    if (!SUPA_SECRET) {
      throw new BundleError('這台機器沒有市集管理權限（.env 裡沒有 SUPABASE_SECRET_KEY）')
    }
  }

  private async pathsOf(id: string): Promise<{ bundle?: string; cover?: string }> {
    const rows: Row[] = await this.call(`/rest/v1/gallery_items?id=eq.${id}&select=bundle_path,cover_path&limit=1`, {
      secret: !!SUPA_SECRET,
    }).catch(() => [])
    const r = rows?.[0]
    return {
      bundle: r?.bundle_path || undefined,
      // 外部網址的封面不是我們的檔案，沒得刪
      cover: r?.cover_path && !/^https?:\/\//i.test(r.cover_path) ? r.cover_path : undefined,
    }
  }

  /** zip 跟封面一起刪，不然封面會變成沒人指得到的孤兒 */
  private async dropObjects({ bundle, cover }: { bundle?: string; cover?: string }) {
    const key = SUPA_SECRET || SUPA_KEY
    const del = (b: string, p: string) =>
      fetch(`${SUPA_URL}/storage/v1/object/${b}/${p}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: 'Bearer ' + key },
      }).catch(() => {})
    if (bundle) await del(BUCKET, bundle)
    if (cover) await del(COVERS, cover)
  }

  async adminList(): Promise<AdminItem[]> {
    this.requireSecret()
    const rows: Row[] = await this.call('/rest/v1/gallery_items?select=*&order=created_at.desc&limit=200', {
      secret: true,
    })
    return rows.map((r) => ({ ...toItem(r), status: r.status, reports: r.reports || [] }))
  }

  async adminRemove(id: string) {
    this.requireSecret()
    const paths = await this.pathsOf(id)
    if (!paths.bundle) return false
    await this.call(`/rest/v1/gallery_items?id=eq.${id}`, { method: 'DELETE', secret: true })
    await this.dropObjects(paths)
    return true
  }

  async adminSetStatus(id: string, status: 'published' | 'hidden') {
    this.requireSecret()
    await this.call(`/rest/v1/gallery_items?id=eq.${id}`, {
      method: 'PATCH',
      secret: true,
      // 放回去就清掉檢舉紀錄，不然下一個檢舉又立刻把它壓下去
      body: JSON.stringify(status === 'published' ? { status, reports: [] } : { status }),
    })
    return true
  }
}
