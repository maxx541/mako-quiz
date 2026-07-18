/**
 * 題目與素材（圖片／音樂）的綁定。
 *
 * ── 為什麼需要這個檔案 ──
 * 上傳進來的檔案會被存成隨機檔名（`/uploads/mrn32ou7-30fb90.png`），那個名字只在
 * 「上傳的那一台機器」有意義。所以把簡報的 JSON 單獨寄給別人，對方打開一定是一片空白 ——
 * JSON 指到的是對方硬碟上不存在的檔案。
 *
 * 解法是讓 JSON 用**邏輯名稱**指到素材（`assets/q02-題目.png`），素材本身另外附上，
 * 匯入時再依名字把兩邊接回來、重新上傳成該環境自己的 `/uploads/…`。
 * 這樣「JSON ＋ 一包圖」在任何一台機器上都能還原成一模一樣的簡報。
 *
 * ── 素材可以出現在哪裡（就這些地方）──
 *   slide.image              題目圖
 *   slide.audio              音樂題的音檔
 *   slide.explain.image      公布答案時的解說圖
 *   slide.options[].image    選項圖
 *   slide.pairs[].leftImage  配對題左欄的圖
 *   slide.pairs[].rightImage 配對題右欄的圖
 *   slide.items[].image      順序題的項目圖
 *   reactions[].url          自訂表情符號
 *   background.image         自訂背景
 *   cover                    封面圖（作者自己指定的那張）
 *   lobbyMusic               大廳音樂
 *   quizMusic                作答時的背景音樂
 *
 * 這份清單只寫在 walkAssets() 一個地方。以後新增帶素材的欄位，只要改那個函式，
 * 匯出、匯入、檢查就會同時跟著支援 —— 不要在別處再抄一份。
 */

/** 一個素材欄位：怎麼讀、怎麼寫、預設該叫什麼名字 */
export type AssetRef = {
  /** 目前的值（`/uploads/…`、`assets/…`、`data:…` 或外部網址） */
  value: string
  /** 改寫這個欄位 */
  set: (v: string | null) => void
  /** 匯出時給它的檔名（不含副檔名），例如 `q02-題目` */
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 走訪簡報裡所有的素材欄位。
 * 這是「題目 ↔ 素材」綁定的**唯一**定義，匯出與匯入都走這裡。
 */
export function walkAssets(data: any, visit: (ref: AssetRef) => void) {
  for (const [i, s] of (data?.slides || []).entries()) {
    const q = `q${pad(i + 1)}`
    if (s?.image) visit({ value: s.image, set: (v) => (s.image = v), label: `${q}-題目` })
    if (s?.audio) visit({ value: s.audio, set: (v) => (s.audio = v), label: `${q}-音樂` })
    if (s?.explain?.image) visit({ value: s.explain.image, set: (v) => (s.explain.image = v), label: `${q}-解說` })
    for (const [j, o] of (s?.options || []).entries()) {
      if (o?.image) visit({ value: o.image, set: (v) => (o.image = v), label: `${q}-選項${j + 1}` })
    }
    for (const [j, m] of (s?.pairs || []).entries()) {
      if (m?.leftImage) visit({ value: m.leftImage, set: (v) => (m.leftImage = v), label: `${q}-配對${j + 1}題目` })
      if (m?.rightImage) visit({ value: m.rightImage, set: (v) => (m.rightImage = v), label: `${q}-配對${j + 1}答案` })
    }
    for (const [j, it] of (s?.items || []).entries()) {
      if (it?.image) visit({ value: it.image, set: (v) => (it.image = v), label: `${q}-項目${j + 1}` })
    }
  }
  for (const [i, r] of (data?.reactions || []).entries()) {
    if (r?.url) visit({ value: r.url, set: (v) => (r.url = v), label: `表情${pad(i + 1)}${r.label ? '-' + r.label : ''}` })
  }
  if (data?.background?.image) {
    visit({ value: data.background.image, set: (v) => (data.background.image = v), label: '背景' })
  }
  if (data?.cover) {
    visit({ value: data.cover, set: (v) => (data.cover = v), label: '封面' })
  }
  if (data?.lobbyMusic) {
    visit({ value: data.lobbyMusic, set: (v) => (data.lobbyMusic = v), label: '大廳音樂' })
  }
  if (data?.quizMusic) {
    visit({ value: data.quizMusic, set: (v) => (data.quizMusic = v), label: '作答音樂' })
  }
}

/** 這個值是不是「本機上傳的檔案」（只有這種在別台機器會失效，需要打包帶走） */
export const isLocalUpload = (v: string) => typeof v === 'string' && v.startsWith('/uploads/')

/** 這個值是不是外部網址（不打包，原樣保留） */
export const isExternal = (v: string) => /^https?:\/\//i.test(v)

/** 這個值是不是內嵌的 data URI */
export const isDataUri = (v: string) => /^data:/i.test(v)

/**
 * 檔名正規化：只留下檔名本身、轉小寫。
 * 匯入時用這個當 key 去對「JSON 寫的名字」與「使用者給的檔案」，
 * 所以 `assets/渚.png`、`./渚.PNG`、`渚.png` 都會對到同一個檔案。
 */
export const assetKey = (v: string) => String(v).split(/[\\/]/).pop()!.trim().toLowerCase()

/** 把不能當檔名的字元換掉（Windows 特別挑剔） */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').slice(0, 60)

/** 從 `/uploads/xxx.png` 或 `data:image/png;base64,…` 取副檔名 */
function extOf(v: string, fallback = 'png') {
  if (isDataUri(v)) {
    const m = /^data:([^;,]+)/i.exec(v)
    const sub = m?.[1]?.split('/')[1]
    return sub ? sub.replace('jpeg', 'jpg').replace('mpeg', 'mp3').replace('x-wav', 'wav') : fallback
  }
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(v)
  return m ? m[1].toLowerCase() : fallback
}

/** 打包前先把伺服器來的資料整理成乾淨的可攜格式（去掉這台機器才有意義的欄位） */
export function portable(full: any) {
  const data = JSON.parse(JSON.stringify(full))
  delete data.id
  delete data.createdAt
  delete data.updatedAt
  for (const s of data.slides || []) delete s.id
  return data
}

/**
 * 把一份簡報打包成可攜的 bundle。
 *
 * 「匯出成檔案」跟「發布到市集」用的是同一個函式 —— 市集收的就是匯出的那個 zip，
 * 兩邊各寫一份遲早會走鐘（一邊修了素材處理、另一邊沒修，傳上去的東西就是壞的）。
 *
 * @param forceZip 市集一定要 zip（伺服器靠 presentation.json 拆 meta）；
 *                 手動匯出時純文字題庫給 .json 比較好編輯、也好貼給 AI
 */
export async function buildBundle(full: any, { forceZip = false, readme = '' } = {}) {
  const data = portable(full)
  const assets = collectAssets(data)
  const files: [string, Uint8Array][] = []

  for (const a of assets) {
    const res = await fetch(a.url)
    if (!res.ok) throw new Error(`素材讀不到：${a.url}`)
    files.push([a.name, new Uint8Array(await res.arrayBuffer())])
    a.set('assets/' + a.name) // JSON 改指向包裡的檔案
  }

  if (!files.length && !forceZip) {
    return {
      kind: 'json' as const,
      blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      assetCount: 0,
    }
  }

  const { zipSync, strToU8 } = await import('fflate')
  const zip: any = { 'presentation.json': strToU8(JSON.stringify(data, null, 2)) }
  if (readme) zip['讀我.txt'] = strToU8(readme)
  // 圖片與音檔本來就是壓縮格式，再壓一次只是浪費時間，用 level 0 直接存
  for (const [name, buf] of files) zip[`assets/${name}`] = [buf, { level: 0 }]

  return {
    kind: 'zip' as const,
    blob: new Blob([zipSync(zip, { level: 6 }) as BlobPart], { type: 'application/zip' }),
    assetCount: files.length,
  }
}

/**
 * 掃出簡報用到、而且需要打包帶走的素材。
 * @returns [{ url, name }]，name 是它在 assets/ 裡該有的檔名（保證不重複）
 */
export function collectAssets(data: any) {
  const out: { url: string; name: string; set: (v: string | null) => void }[] = []
  const used = new Set<string>()
  walkAssets(data, ({ value, set, label }) => {
    if (!isLocalUpload(value) && !isDataUri(value)) return // 外部網址不打包
    let name = `${safeName(label)}.${extOf(value, 'png')}`
    // 同名就加序號（表情符號可能被取一樣的 label）
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeName(label)}-${n}.${extOf(value, 'png')}`
    used.add(name.toLowerCase())
    out.push({ url: value, name, set })
  })
  return out
}
