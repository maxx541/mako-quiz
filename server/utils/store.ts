import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/*
 * 測試會改動簡報設定，所以要能指到別的目錄，絕對不能碰到使用者真正的資料。
 *
 * 舊的 QUIZLIVE_DATA_DIR 留著當備援：改名時如果有人的捷徑或腳本還設著它，
 * 直接無視會讓程式默默改讀 ./data —— 從使用者的角度看就是「我的簡報全不見了」。
 */
export const DATA_DIR = path.resolve(
  process.env.MAKOQUIZ_DATA_DIR || process.env.QUIZLIVE_DATA_DIR || path.join(process.cwd(), 'data')
)
const FILE = path.join(DATA_DIR, 'presentations.json')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
/**
 * 按鈕音效。放在 data/ 而不是 public/：換一顆音效只要換檔案，不用重新 build，
 * 也不會在下次 build 的時候被蓋掉。檔名是固定的，見 SOUND_ACTIONS。
 */
export const SOUND_DIR = path.join(DATA_DIR, 'sounds')

let cache: Map<string, any> | null = null

export function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex')
}

function load() {
  if (cache) return cache
  cache = new Map()
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  ensureSoundDir()
  if (fs.existsSync(FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      // 舊版匯入沒有補 id、也沒有新版的欄位，開機時順手修好，使用者不用重匯
      let repaired = 0
      for (const p of raw) {
        for (const s of p.slides || []) if (normalizeSlide(s)) repaired++
        cache.set(p.id, p)
      }
      if (repaired) {
        console.log(`[store] 修好了 ${repaired} 張舊資料的投影片（補上缺少的 id 與欄位）`)
        persist()
      }
    } catch (err: any) {
      // 檔案毀損時保留備份，避免直接覆蓋掉使用者資料
      const backup = FILE + '.broken-' + Date.now()
      fs.copyFileSync(FILE, backup)
      console.error(`[store] presentations.json 解析失敗，已備份到 ${backup}`, err.message)
    }
  }
  return cache
}

function persist() {
  const arr = [...load().values()]
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8')
  fs.renameSync(tmp, FILE)
}

/**
 * 簡報的封面圖：第一張有配圖的投影片（內容頁的圖、猜圖題的 CG、題目圖都算）。
 *
 * 作者自己上傳的優先；沒有才自動抓第一張題目圖。
 *
 * 自動抓的時候只看 slide.image —— 選項圖和解說圖不拿來當封面：
 * 解說圖常常直接畫著答案，拿它當封面等於在列表上爆雷。
 */
export function coverOf(p: any): string | null {
  if (p?.cover) return p.cover
  for (const s of p?.slides || []) if (s?.image) return s.image
  return null
}

export function listPresentations() {
  return [...load().values()]
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || '',
      theme: p.theme || 'slate',
      background: p.background || DEFAULT_BACKGROUND,
      cover: coverOf(p),
      slideCount: p.slides.length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getPresentation(id: string) {
  return load().get(id) || null
}

/** 自訂背景的預設值：沒有圖就只用主題純色 */
export const DEFAULT_BACKGROUND = {
  image: null as string | null,
  /** 遮罩濃度 0~90（%）—— 壓暗背景讓題目讀得清楚 */
  dim: 55,
  /** 背景模糊 0~20（px）—— 讓背景退到後面，不跟文字搶細節 */
  blur: 6,
  /** 上傳時自動分析算出來的建議值，使用者可以覆寫 */
  auto: true,
}

export function createPresentation(data: any = {}) {
  const now = Date.now()
  const p = {
    id: uid('p_'),
    title: data.title || '未命名簡報',
    description: data.description || '',
    theme: data.theme || 'slate',
    background: { ...DEFAULT_BACKGROUND, ...(data.background || {}) },
    /**
     * 封面圖：列表、市集、大廳都用這一張。
     * 沒設定的話 coverOf() 會自動拿第一張題目圖，所以這裡是 null 也不影響。
     */
    cover: data.cover || null,
    /** 大廳等待時可以循環播放的音樂；只在主持人大螢幕播，不下發到手機 */
    lobbyMusic: data.lobbyMusic || null,
    /** 作答過程的背景音樂，跟大廳音樂各播各的；碰到音樂題會自動讓路 */
    quizMusic: data.quizMusic || null,
    /** 作答音樂音量 0–100；背景音樂太大聲會蓋掉主持人講話，預設放小聲 */
    quizMusicVolume: typeof data.quizMusicVolume === 'number' ? data.quizMusicVolume : 35,
    /** 自訂表情符號：[{ id, url, label }]，參與者點了會浮到大螢幕上 */
    reactions: Array.isArray(data.reactions) ? data.reactions : [],
    settings: {
      speedBonus: true,
      showLeaderboard: true,
      allowLateJoin: true,
      qaEnabled: true,
      qaAnonymous: true,
      qaUpvote: true,
      qaModeration: false,
      reactionsEnabled: true,
      ...(data.settings || {}),
    },
    slides: Array.isArray(data.slides) ? data.slides : [],
    createdAt: now,
    updatedAt: now,
  }
  load().set(p.id, p)
  persist()
  return p
}

export function updatePresentation(id: string, patch: any) {
  const p = load().get(id)
  if (!p) return null
  /*
   * 寫進來的投影片也要補齊欄位。
   *
   * load() 只在開機讀檔時補一次，寫入不補的話，這一輪存進去的就是壞資料 ——
   * 少一個 explain，編輯器讀 slide.explain.text 會整頁 render 失敗變成白畫面，
   * 而且要等到下次重開伺服器才會被修好。補的成本很低，就在這裡一起補掉。
   */
  if (Array.isArray(patch.slides)) for (const s of patch.slides) normalizeSlide(s)
  const next = { ...p, ...patch, id: p.id, createdAt: p.createdAt, updatedAt: Date.now() }
  load().set(id, next)
  persist()
  return next
}

export function deletePresentation(id: string) {
  const ok = load().delete(id)
  if (ok) persist()
  return ok
}

export function duplicatePresentation(id: string) {
  const p = load().get(id)
  if (!p) return null
  const copy = JSON.parse(JSON.stringify(p))
  copy.id = uid('p_')
  copy.title = p.title + '（複本）'
  copy.createdAt = copy.updatedAt = Date.now()
  copy.slides = copy.slides.map((s: any) => ({ ...s, id: uid('s_') }))
  load().set(copy.id, copy)
  persist()
  return copy
}

/**
 * 把一張投影片補成完整可用的樣子：補齊 id、補上新版才有的欄位。
 *
 * id 這件事非做不可：匯入進來的題庫（尤其 AI 產的）通常只有 text / correct，
 * 沒有 id。少了 id 會壞得很安靜也很嚴重 ——
 *   - 批改變成 `undefined === undefined` → 答錯也算對
 *   - 統計的 Map key 全是 undefined → 票數全塌到最後一個選項
 *   - 前端 v-for 的 :key 撞在一起 → 排序拖不動、配對點一個選到全部
 *
 * @returns 有沒有動過（用來判斷舊資料要不要寫回檔案）
 */
export function normalizeSlide(s: any): boolean {
  let changed = false

  // 解說：舊資料沒有這個欄位，編輯器讀 slide.explain.text 會炸，要補。
  // 匯入的 JSON 常常直接寫成一個字串（"explain": "因為…"），也接受。
  if (typeof s.explain === 'string') {
    s.explain = { text: s.explain, image: null }
    changed = true
  } else if (!s.explain || typeof s.explain !== 'object' || Array.isArray(s.explain)) {
    s.explain = { text: '', image: null }
    changed = true
  } else {
    const text = String(s.explain.text ?? '')
    const image = s.explain.image ?? null
    if (s.explain.text !== text || s.explain.image !== image) {
      s.explain = { text, image }
      changed = true
    }
  }

  /**
   * 幫一個陣列補 id：沒有的補上，重複的也重新給。
   * 重複跟沒有一樣糟 —— 統計會把兩個項目算成同一個，前端的 :key 也會撞。
   * @returns 舊 id → 新 id 的對照（給 categoryId 換用）
   */
  const fixIds = (list: any[], prefix: string) => {
    const remap = new Map<string, string>()
    const used = new Set<string>()
    for (const x of list) {
      const old = x.id ? String(x.id) : ''
      if (!old || used.has(old)) {
        x.id = uid(prefix)
        changed = true
      }
      used.add(x.id)
      if (old) remap.set(old, x.id)
    }
    return remap
  }

  if (!s.id) {
    s.id = uid('s_')
    changed = true
  }

  // 分類題要先處理 categories，items 的 categoryId 才對得回去
  if (Array.isArray(s.categories)) {
    const remap = fixIds(s.categories, 'c_')
    if (Array.isArray(s.items)) {
      fixIds(s.items, 'i_')
      for (const i of s.items) {
        const mapped = remap.get(String(i.categoryId))
        if (mapped && mapped !== i.categoryId) {
          i.categoryId = mapped
          changed = true
        }
        // 對不到任何分類就掛到第一個，免得變成孤兒（畫面上永遠拿不到分）
        if (!s.categories.some((c: any) => c.id === i.categoryId)) {
          i.categoryId = s.categories[0]?.id
          changed = true
        }
      }
    }
  } else if (Array.isArray(s.items)) {
    fixIds(s.items, 'i_')
  }

  if (Array.isArray(s.options)) fixIds(s.options, 'o_')
  if (Array.isArray(s.pairs)) fixIds(s.pairs, 'm_')

  return changed
}

export function importPresentation(raw: any) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || !Array.isArray(data.slides)) throw new Error('格式不正確：缺少 slides 陣列')
  const slides = data.slides.map((s: any) => {
    // 匯入的題目常常只有 text / correct，缺的欄位用該題型的預設值補齊
    const copy = JSON.parse(JSON.stringify(s))
    copy.id = uid('s_')
    normalizeSlide(copy)
    return copy
  })
  return createPresentation({
    title: data.title || '匯入的簡報',
    description: data.description || '',
    theme: data.theme,
    background: data.background,
    cover: data.cover,
    lobbyMusic: data.lobbyMusic,
    quizMusic: data.quizMusic,
    quizMusicVolume: data.quizMusicVolume,
    reactions: data.reactions,
    settings: data.settings,
    slides,
  })
}

export function isEmpty() {
  return load().size === 0
}

/* ---------------- 按鈕音效 ---------------- */

/**
 * 主持人控制列每一顆按鈕對應的檔名（不含副檔名）。
 * 想換音效就把 data/sounds/ 底下同名的檔案換掉，不用改程式、也不用重新 build。
 */
export const SOUND_ACTIONS = {
  advance: '主要按鈕：開始活動／下一題／下一頁',
  reveal: '公布答案（沒有這個檔就用 advance）',
  back: '上一步',
  stage: '揭露下一階段／給下一條提示',
  addtime: '＋15 秒',
  leaderboard: '看排行榜',
} as const

const SOUND_EXTS = ['.mp3', '.ogg', '.wav', '.m4a', '.flac']

const SOUND_README = `這個資料夾放主持人控制列的按鈕音效。

檔名是固定的，副檔名可以是 .mp3 / .ogg / .wav / .m4a / .flac：

${Object.entries(SOUND_ACTIONS)
  .map(([k, v]) => `  ${k}.mp3   ${v}`)
  .join('\n')}

想換音效就直接換掉同名的檔案，重新整理主持人頁面就會生效
（不用重新 build，也不用重開伺服器）。
沒放的檔案就是沒有聲音 —— 不想要某一顆按鈕出聲，把它的檔案刪掉就好。
`

function ensureSoundDir() {
  fs.mkdirSync(SOUND_DIR, { recursive: true })
  const readme = path.join(SOUND_DIR, '讀我.txt')
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, SOUND_README, 'utf8')
}

/**
 * 掃出實際存在的音效檔。
 *
 * 不寫死副檔名：使用者手上可能是 mp3 也可能是 wav，
 * 逼他先轉檔才聽得到，跟「方便換素材」剛好相反。
 */
export function listSounds() {
  ensureSoundDir()
  const out: Record<string, string> = {}
  for (const name of Object.keys(SOUND_ACTIONS)) {
    for (const ext of SOUND_EXTS) {
      if (fs.existsSync(path.join(SOUND_DIR, name + ext))) {
        out[name] = name + ext
        break
      }
    }
  }
  return out
}
