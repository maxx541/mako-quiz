import { uid } from './store'

/**
 * 題型定義。icon 是 AppIcon 的圖示名稱（不用 emoji）。
 */
export const SLIDE_TYPES: Record<string, { label: string; icon: string; group: string; desc: string }> = {
  single: { label: '單選題', icon: 'radio-single', group: 'quiz', desc: '只有一個正確答案，也可關掉正解變成投票' },
  multi: { label: '複選題', icon: 'check-multi', group: 'quiz', desc: '多個正確答案，答錯會抵銷得分比例' },
  truefalse: { label: '是非題', icon: 'truefalse', group: 'quiz', desc: '快速的二選一判斷題' },
  match: { label: '配對題', icon: 'match', group: 'quiz', desc: '把左右兩欄的項目正確配對起來' },
  categorize: { label: '分類題', icon: 'layers', group: 'quiz', desc: '把項目拖進正確的分類，放對幾個算幾分' },
  order: { label: '順序題', icon: 'order', group: 'quiz', desc: '把項目排成正確的先後順序' },
  type: { label: '填空題', icon: 'keyboard', group: 'quiz', desc: '參與者自行輸入答案，系統比對可接受答案' },
  list: { label: '複數答案', icon: 'list-check', group: 'quiz', desc: '列出多個答案，答對越多分越高，全部答出再額外加分' },
  number: { label: '數字題', icon: 'hash', group: 'quiz', desc: '猜數字，越接近答案分數越高' },
  soup: { label: '海龜湯', icon: 'layers', group: 'quiz', desc: '一階段給一條提示，越早猜中分數越高；答案可設多組' },
  reveal: { label: '猜圖題', icon: 'eye', group: 'media', desc: 'CG／立繪分階段慢慢揭露，越早猜中分數越高' },
  music: { label: '音樂題', icon: 'music', group: 'media', desc: '大螢幕播放音樂，參與者選出答案' },
  scale: { label: '評分題', icon: 'sliders', group: 'interact', desc: '1~N 分量表，看平均與分布，不計分' },
  open: { label: '開放問題', icon: 'message-open', group: 'interact', desc: '自由發表，以文字雲或列表呈現，不計分' },
  qa: { label: '觀眾提問', icon: 'hand', group: 'interact', desc: '參與者即時提問並互相按讚，主持人挑選回答' },
  content: { label: '內容頁', icon: 'file-text', group: 'interact', desc: '純文字說明頁，用來開場或分段' },
}

/** 有這些題型時，圖片／媒體是主角，版面要把空間讓給它 */
export const MEDIA_TYPES = ['reveal', 'music']

export const OPTION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#22c55e', '#a855f7', '#ec4899']

export function createSlide(type = 'single'): any {
  const base = {
    id: uid('s_'),
    type,
    title: '',
    note: '',
    image: null as string | null,
    timeLimit: 30,
    points: 'standard', // none | standard | double
    speedBonus: 'inherit', // inherit | on | off —— 單題可覆寫整份簡報的設定
    /** 解說：只在公布答案時出現，用來說明為什麼是這個答案 */
    explain: { text: '', image: null as string | null },
  }
  const opt = (text = '', correct = false) => ({ id: uid('o_'), text, correct, image: null })

  switch (type) {
    case 'single':
    case 'multi':
      return {
        ...base,
        title: type === 'single' ? '新的單選題' : '新的複選題',
        options: [opt('', type === 'single'), opt(), opt(), opt()],
        poll: false,
      }
    case 'truefalse':
      return { ...base, title: '新的是非題', timeLimit: 20, options: [opt('正確', true), opt('錯誤')], poll: false }
    case 'match':
      return {
        ...base,
        title: '新的配對題',
        timeLimit: 60,
        pairs: [
          { id: uid('m_'), left: '', right: '', leftImage: null, rightImage: null },
          { id: uid('m_'), left: '', right: '', leftImage: null, rightImage: null },
          { id: uid('m_'), left: '', right: '', leftImage: null, rightImage: null },
        ],
      }
    case 'categorize': {
      const c1 = uid('c_')
      const c2 = uid('c_')
      return {
        ...base,
        title: '新的分類題',
        timeLimit: 60,
        points: 'double',
        categories: [
          { id: c1, name: '分類 A' },
          { id: c2, name: '分類 B' },
        ],
        // 每個項目屬於哪一個分類，就是正確答案
        items: [
          { id: uid('i_'), text: '', image: null, categoryId: c1 },
          { id: uid('i_'), text: '', image: null, categoryId: c1 },
          { id: uid('i_'), text: '', image: null, categoryId: c2 },
          { id: uid('i_'), text: '', image: null, categoryId: c2 },
        ],
      }
    }
    case 'order':
      return {
        ...base,
        title: '新的順序題',
        timeLimit: 45,
        items: [
          { id: uid('i_'), text: '', image: null },
          { id: uid('i_'), text: '', image: null },
          { id: uid('i_'), text: '', image: null },
          { id: uid('i_'), text: '', image: null },
        ],
      }
    case 'type':
      return { ...base, title: '新的填空題', accepted: [''], ignoreCase: true, ignoreSpace: true }
    case 'list':
      return {
        ...base,
        title: '列出所有你知道的…',
        timeLimit: 90,
        points: 'double',
        /**
         * 要收集的答案，每一列是一個答案。同一個答案的不同寫法用 | 隔開
         * （例如 `CLANNAD|克蘭納德`），符合任一個就算命中這一列。
         */
        accepted: ['', '', ''],
        /** 全部答出來的額外加分，佔基礎分的比例（0.5 = 多給 50%） */
        allBonus: 0.5,
        /** 每人最多能送出幾個答案（擋洗版） */
        maxSubmissions: 12,
        ignoreCase: true,
        ignoreSpace: true,
      }
    case 'number':
      return {
        ...base,
        title: '新的數字題',
        answer: 100,
        /** 誤差多少之內還有分：剛好答對 100%，差距越大分數線性遞減到 0 */
        tolerance: 20,
        unit: '',
      }
    case 'soup':
      return {
        ...base,
        title: '猜猜這是哪部作品？',
        timeLimit: 120,
        points: 'double',
        /** 一階段給一條提示，由模糊到明確 */
        hints: [{ text: '作品類型是廢萌作' }, { text: '主角是男高中生' }, { text: '有四位女主角' }, { text: '2004 年發售' }],
        /** 每階段停留幾秒自動給下一條；0 = 只由主持人手動給 */
        stageSeconds: 20,
        accepted: [''],
        ignoreCase: true,
        ignoreSpace: true,
      }
    case 'reveal':
      return {
        ...base,
        title: '這是哪個角色？',
        timeLimit: 60,
        points: 'double',
        /** 分幾階段揭露 */
        stages: 5,
        /** 每階段幾秒自動揭下一階段；0 = 只由主持人手動揭 */
        stageSeconds: 6,
        /** tiles=格子逐塊揭開、blur=由模糊轉清晰、zoom=由局部放大逐漸拉遠 */
        revealMode: 'tiles',
        /** 圖片切成幾列幾行（只有 tiles 模式用得到） */
        grid: { rows: 5, cols: 7 },
        /**
         * 每個階段各自要揭開哪幾塊（值是格子索引 row * cols + col）。
         * 空的就交給系統依 slide.id 算出一組固定的隨機順序自動揭。
         */
        stageTiles: [] as number[][],
        options: [opt('', true), opt(), opt(), opt()],
        poll: false,
      }
    case 'music':
      return {
        ...base,
        title: '這是哪首曲子？',
        timeLimit: 45,
        audio: null,
        /** 從第幾秒開始播 */
        audioStart: 0,
        /** 進到這一頁就自動播放 */
        autoPlay: true,
        options: [opt('', true), opt(), opt(), opt()],
        poll: false,
      }
    case 'scale':
      return {
        ...base,
        title: '你覺得如何？',
        timeLimit: 0,
        points: 'none',
        min: 1,
        max: 5,
        minLabel: '完全不同意',
        maxLabel: '非常同意',
      }
    case 'open':
      return { ...base, title: '你的想法是什麼？', timeLimit: 0, points: 'none', maxChars: 120, maxSubmissions: 1, display: 'cloud' }
    case 'qa':
      return { ...base, title: '有什麼想問的嗎？', timeLimit: 0, points: 'none' }
    case 'content':
      return { ...base, title: '標題', body: '', timeLimit: 0, points: 'none' }
    default:
      throw new Error('不支援的題型：' + type)
  }
}

/** 這張投影片會不會計算對錯 */
export function isGraded(slide: any) {
  switch (slide.type) {
    case 'single':
    case 'multi':
    case 'truefalse':
    case 'reveal':
    case 'music':
      return !slide.poll && (slide.options || []).some((o: any) => o.correct)
    case 'match':
      return (slide.pairs || []).length > 0
    case 'categorize':
      return (slide.categories || []).length > 0 && (slide.items || []).length > 0
    case 'order':
      return (slide.items || []).length > 0
    case 'type':
    case 'soup':
    case 'list':
      return (slide.accepted || []).some((a: string) => a.trim() !== '')
    case 'number':
      return typeof slide.answer === 'number' && Number.isFinite(slide.answer)
    default:
      return false
  }
}

/** 會分階段揭露資訊的題型 —— 用階段計分取代速度加分 */
export const STAGED_TYPES = ['reveal', 'soup']
export const isStaged = (slide: any) => STAGED_TYPES.includes(slide?.type)

/** 分階段題型總共幾階段（至少 2）：猜圖題看 stages，海龜湯看提示條數 */
export const stageCount = (slide: any) => {
  if (slide?.type === 'soup') return Math.max(2, (slide.hints || []).length)
  return Math.max(2, Number(slide?.stages) || 5)
}

/**
 * 階段加成：第一階段就猜中拿滿分，拖到最後一階段只剩 40%。
 * 這一類題目「越早猜中越強」本身就是樂趣所在，所以用階段取代速度加分。
 */
export function stageFactor(slide: any, stage: number) {
  const n = stageCount(slide)
  const k = Math.min(Math.max(0, stage), n - 1)
  return 1 - (k / (n - 1)) * 0.6
}

/** 這張投影片會不會收參與者的回覆 */
export function isInteractive(slide: any) {
  return slide.type !== 'content'
}

/**
 * 全員答完就自動公布的題型。
 *
 * 海龜湯與猜圖題排除 —— 它們是分階段的，「大家都送出答案了」不等於
 * 「大家都答完了」：海龜湯每出一條新提示就能再猜一次，這時候自動公布
 * 等於把重猜機制整個砍掉。這兩種一律等主持人按。
 *
 * 觀眾提問與開放問題也排除，它們是討論頁，沒有「答完」這回事。
 */
export function autoRevealable(slide: any) {
  if (!slide || !isInteractive(slide) || isStaged(slide)) return false
  // 複數答案跟開放問題一樣「沒有答完這回事」（隨時能再多寫一個），一律等主持人公布
  return !['qa', 'open', 'list'].includes(slide.type)
}

/**
 * 這一題要不要算速度加分：單題設定優先，沒設就跟著整份簡報走。
 */
export function usesSpeedBonus(slide: any, settings: any = {}) {
  if (slide?.speedBonus === 'on') return true
  if (slide?.speedBonus === 'off') return false
  return settings.speedBonus !== false
}

const BASE_POINTS: Record<string, number> = { none: 0, standard: 1000, double: 2000 }

/**
 * 把參與者打的東西解析成數字。
 *
 * 手機的中文輸入法很容易打出全形數字，人眼看起來一模一樣，
 * 直接丟給 Number() 卻是 NaN —— 那是輸入法的問題，不該算他答錯。
 * 千分位逗號同理。解析不出來才回 NaN。
 */
export function toNumber(value: any) {
  const s = String(value ?? '')
    .replace(/[０-９．＋－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s_]/g, '')
    .trim()
  return s === '' ? NaN : Number(s)
}

function norm(text: any, slide: any) {
  let s = String(text ?? '').trim()
  if (slide.ignoreCase !== false) s = s.toLowerCase()
  if (slide.ignoreSpace !== false) s = s.replace(/\s+/g, '')
  return s
}

/* ---------- 複數答案（list）：一題要收集好幾個答案 ---------- */

/** 把 accepted 拆成一組組答案，每組是「同一個答案的多種寫法」（用 | 隔開） */
function listGroups(slide: any): string[][] {
  return (slide.accepted || [])
    .map((a: string) => String(a || '').split('|').map((s) => s.trim()).filter(Boolean))
    .filter((g: string[]) => g.length)
}

/**
 * 批改一份複數答案作答。
 * @returns hits 命中的組數、total 總組數、marks 逐一標出送出的每個答案對不對
 */
export function listResult(slide: any, value: any) {
  const groups = listGroups(slide)
  const submitted: string[] = Array.isArray(value) ? value.map((v) => norm(v, slide)) : []
  const marks = (Array.isArray(value) ? value : []).map((v) => {
    const nv = norm(v, slide)
    return groups.some((g) => g.some((sp) => norm(sp, slide) === nv))
  })
  // 每一組正解這位參與者有沒有答到（跟 solutionOf 的 answers 同順序，前端拿來標「漏了哪個」）
  const groupHit = groups.map((g) => g.some((sp) => submitted.includes(norm(sp, slide))))
  return { hits: groupHit.filter(Boolean).length, total: groups.length, marks, groupHit }
}

/** 兩個答案在這一題的規則下算不算同一個（給去重用） */
export function sameListAnswer(slide: any, a: string, b: string) {
  return norm(a, slide) === norm(b, slide)
}

/**
 * 批改單一作答。
 * @returns ratio 為 0~1 的答對比例（部分給分用）
 */
export function grade(slide: any, value: any): { ratio: number; correct: boolean } {
  if (!isGraded(slide)) return { ratio: 0, correct: false }
  switch (slide.type) {
    case 'single':
    case 'truefalse':
    case 'reveal':
    case 'music': {
      const right = slide.options.find((o: any) => o.correct)
      // value 跟 right.id 都必須是真的有值 —— 兩邊都是 undefined 時
      // `undefined === undefined` 會讓「答錯也算對」，這種錯誤要擋在這裡
      const ok = !!right?.id && value != null && value === right.id
      return { ratio: ok ? 1 : 0, correct: ok }
    }
    case 'number': {
      const guess = toNumber(value)
      if (!Number.isFinite(guess)) return { ratio: 0, correct: false }
      const diff = Math.abs(guess - slide.answer)
      if (diff === 0) return { ratio: 1, correct: true }
      // 誤差越小分數越高，超出容許範圍就 0 分
      const tol = Math.max(0, Number(slide.tolerance) || 0)
      if (!tol) return { ratio: 0, correct: false }
      return { ratio: Math.max(0, 1 - diff / tol), correct: false }
    }
    case 'multi': {
      const correctIds = new Set(slide.options.filter((o: any) => o.correct && o.id).map((o: any) => o.id))
      const picked = new Set((Array.isArray(value) ? value : []).filter((v) => v != null))
      if (correctIds.size === 0) return { ratio: 0, correct: false }
      let hit = 0
      let miss = 0
      for (const id of picked) correctIds.has(id) ? (hit += 1) : (miss += 1)
      // 選錯會抵銷選對，避免全選拿滿分
      const ratio = Math.max(0, (hit - miss) / correctIds.size)
      return { ratio, correct: ratio === 1 && picked.size === correctIds.size }
    }
    case 'match': {
      const map = value && typeof value === 'object' ? value : {}
      const total = slide.pairs.length
      if (!total) return { ratio: 0, correct: false }
      let hit = 0
      for (const p of slide.pairs) if (p.id && map[p.id] === p.id) hit += 1
      return { ratio: hit / total, correct: hit === total }
    }
    case 'categorize': {
      // value: { itemId: categoryId }
      const map = value && typeof value === 'object' ? value : {}
      const total = slide.items.length
      if (!total) return { ratio: 0, correct: false }
      let hit = 0
      for (const it of slide.items) if (it.id && it.categoryId && map[it.id] === it.categoryId) hit += 1
      return { ratio: hit / total, correct: hit === total }
    }
    case 'order': {
      const arr = Array.isArray(value) ? value : []
      const total = slide.items.length
      if (!total) return { ratio: 0, correct: false }
      let hit = 0
      for (let i = 0; i < total; i++) if (slide.items[i].id && arr[i] === slide.items[i].id) hit += 1
      return { ratio: hit / total, correct: hit === total }
    }
    case 'type':
    case 'soup': {
      // 可以設多組答案，符合任一個就算對
      const answer = norm(value, slide)
      const ok = slide.accepted.some((a: string) => a.trim() !== '' && norm(a, slide) === answer)
      return { ratio: ok ? 1 : 0, correct: ok }
    }
    case 'list': {
      // 命中越多組分越高，全中才算 correct（額外加分在 scoreFor 處理）
      const { hits, total } = listResult(slide, value)
      if (!total) return { ratio: 0, correct: false }
      return { ratio: hits / total, correct: hits === total }
    }
    default:
      return { ratio: 0, correct: false }
  }
}

/**
 * 依答對比例計分。
 *
 * - 猜圖題用「第幾階段答的」當加成（越早揭露階段猜中越高分），不看速度。
 * - 其他題型開啟速度加分時，答得越快分數越高
 *   （最快保留 100%，時間用完剩 50%，中間線性遞減）。
 */
export function scoreFor(slide: any, ratio: number, elapsedMs: number, speedBonus = true, stage = 0) {
  const base = BASE_POINTS[slide.points] ?? 1000
  if (!base || ratio <= 0) return 0

  // 複數答案：答對越多分越高（ratio 就是命中比例），全部答出再加 allBonus。
  // 不吃速度加分 —— 這種題目是「盡量湊多」，用時間壓反而逼人亂猜。
  if (slide.type === 'list') {
    const bonus = ratio >= 1 ? Math.max(0, Number(slide.allBonus) || 0) : 0
    return Math.round(base * (ratio + bonus))
  }

  if (isStaged(slide)) return Math.round(base * ratio * stageFactor(slide, stage))

  let factor = 1
  if (speedBonus && slide.timeLimit > 0) {
    const used = Math.min(1, Math.max(0, elapsedMs / (slide.timeLimit * 1000)))
    factor = 1 - used * 0.5
  }
  return Math.round(base * ratio * factor)
}

/* ---------- 亂序（同一位參與者重連時順序要保持一致） ---------- */

function hashStr(s: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rnd = mulberry32(seed)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 配對題的右欄：每位參與者拿到不同的亂數順序 + 匿名 token。
 *
 * 這裡不能直接把 pair.id 當成右欄項目的 id —— 左欄用的也是同一個 id，
 * 參與者只要比對兩邊的 id 就知道正解了。改成用「洗牌後的位置」當 token，
 * 伺服器批改時再用同樣的種子重算回去。
 */
export function matchRightsFor(slide: any, playerId: string) {
  const seed = hashStr(playerId + ':' + slide.id + ':rights')
  return shuffleSeeded(slide.pairs, seed).map((p: any, i: number) => ({
    token: 'r' + i,
    pairId: p.id,
    text: p.right,
    image: p.rightImage || null,
  }))
}

/**
 * 給大螢幕列出來的項目 —— 讓台下知道現在在排什麼、在分什麼。
 *
 * 順序題的 slide.items 本身就是正解順序，照原樣顯示等於直接公布答案，
 * 所以一定要打亂；用 slide.id 當種子，主持人重新整理也還是同一個順序。
 * 分類題的 items 帶著 categoryId（那也是答案），這裡只挑 text 出來。
 */
export function displayItemsFor(slide: any) {
  if (slide?.type !== 'order' && slide?.type !== 'categorize') return null
  return shuffleSeeded(
    (slide.items || []).map((i: any) => ({ id: i.id, text: i.text, image: i.image || null })),
    hashStr(slide.id + ':stage')
  )
}

/** 把參與者送上來的答案整理成伺服器內部的形式 */
export function normalizeAnswer(slide: any, playerId: string, value: any) {
  // 數字題不在用戶端擋輸入，這裡照原樣留著（批改與統計都會用 toNumber 解析），
  // 只擋掉長度 —— 公布時要把它顯示出來
  if (slide.type === 'number') return String(value ?? '').trim().slice(0, 40)
  if (slide.type !== 'match') return value
  const back = new Map(matchRightsFor(slide, playerId).map((r) => [r.token, r.pairId]))
  const out: Record<string, string> = {}
  for (const [leftId, token] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const pairId = back.get(token as string)
    if (pairId) out[leftId] = pairId
  }
  return out
}

/**
 * 產生給參與者的投影片內容 —— 絕對不能帶出正解。
 */
export function slideForPlayer(slide: any, playerId: string, settings: any = {}, stage = 0) {
  const seed = hashStr(playerId + ':' + slide.id)
  const base = {
    id: slide.id,
    type: slide.type,
    title: slide.title,
    image: slide.image || null,
    timeLimit: slide.timeLimit,
    points: slide.points,
    graded: isGraded(slide),
    speedBonus: usesSpeedBonus(slide, settings),
  }
  const choices = () =>
    slide.options.map((o: any, i: number) => ({
      id: o.id,
      text: o.text,
      image: o.image || null,
      color: OPTION_COLORS[i % OPTION_COLORS.length],
    }))

  switch (slide.type) {
    case 'single':
    case 'multi':
    case 'truefalse':
      return { ...base, options: choices() }
    case 'music':
      // 音檔只在大螢幕播，不送給手機（省流量，也避免有人直接抓檔案看檔名）
      return { ...base, options: choices() }
    case 'reveal':
      // 圖片只在大螢幕上揭露；手機只拿選項，拿不到原圖
      return {
        ...base,
        image: null,
        options: choices(),
        stages: stageCount(slide),
      }
    case 'soup':
      // 只送「已經揭露的提示」，後面的提示不能先給
      return {
        ...base,
        hints: (slide.hints || []).slice(0, stage + 1).map((h: any) => ({ text: h.text })),
        stages: stageCount(slide),
      }
    case 'number':
      // 絕對不能送 answer 出去
      return { ...base, unit: slide.unit || '' }
    case 'scale':
      return { ...base, min: slide.min, max: slide.max, minLabel: slide.minLabel, maxLabel: slide.maxLabel }
    case 'match':
      return {
        ...base,
        lefts: slide.pairs.map((p: any) => ({ id: p.id, text: p.left, image: p.leftImage || null })),
        // 一樣只給 token，pairId 留在伺服器 —— 圖片跟著洗牌後的位置走
        rights: matchRightsFor(slide, playerId).map((r) => ({ id: r.token, text: r.text, image: r.image })),
      }
    case 'categorize':
      // items 絕對不能帶 categoryId 出去 —— 那就是答案
      return {
        ...base,
        categories: slide.categories.map((c: any) => ({ id: c.id, name: c.name })),
        items: shuffleSeeded(
          slide.items.map((i: any) => ({ id: i.id, text: i.text, image: i.image || null })),
          seed
        ),
      }
    case 'order':
      return {
        ...base,
        items: shuffleSeeded(
          slide.items.map((i: any) => ({ id: i.id, text: i.text, image: i.image || null })),
          seed
        ),
      }
    case 'type':
      return { ...base }
    case 'list':
      // 只告訴他要湊幾個（讓他知道進度），答案本身絕對不送出去
      return {
        ...base,
        total: listGroups(slide).length,
        maxSubmissions: Math.max(1, Number(slide.maxSubmissions) || 10),
        allBonus: Math.max(0, Number(slide.allBonus) || 0),
      }
    case 'open':
      return { ...base, maxChars: slide.maxChars, maxSubmissions: slide.maxSubmissions, display: slide.display }
    case 'qa':
      return { ...base }
    case 'content':
      return { ...base, body: slide.body }
    default:
      return base
  }
}

/** 解說（圖＋文），跟正解一樣只在公布答案時才送出去 */
export function explainOf(slide: any) {
  const e = slide?.explain
  if (!e) return null
  const text = String(e.text || '').trim()
  if (!text && !e.image) return null
  return { text, image: e.image || null }
}

/** 正解摘要，只在公布答案時送出 */
export function solutionOf(slide: any) {
  if (!isGraded(slide)) return null
  switch (slide.type) {
    case 'single':
    case 'truefalse':
    case 'multi':
    case 'music':
      return { optionIds: slide.options.filter((o: any) => o.correct).map((o: any) => o.id) }
    case 'reveal':
      // 公布時才把完整的圖送出去
      return { optionIds: slide.options.filter((o: any) => o.correct).map((o: any) => o.id), image: slide.image || null }
    case 'match':
      return {
        pairs: slide.pairs.map((p: any) => ({
          id: p.id,
          left: p.left,
          right: p.right,
          leftImage: p.leftImage || null,
          rightImage: p.rightImage || null,
        })),
      }
    case 'categorize':
      return {
        categories: slide.categories.map((c: any) => ({
          id: c.id,
          name: c.name,
          items: slide.items
            .filter((i: any) => i.categoryId === c.id)
            .map((i: any) => ({ text: i.text, image: i.image || null })),
        })),
      }
    case 'order':
      return { items: slide.items.map((i: any) => ({ id: i.id, text: i.text, image: i.image || null })) }
    case 'type':
      return { accepted: slide.accepted.filter((a: string) => a.trim() !== '') }
    case 'list':
      // 每組顯示第一個寫法當代表，其餘寫法附在 alts（公佈才送）
      return {
        answers: listGroups(slide).map((g) => ({ text: g[0], alts: g.slice(1) })),
        allBonus: Math.max(0, Number(slide.allBonus) || 0),
      }
    case 'soup':
      return {
        accepted: slide.accepted.filter((a: string) => a.trim() !== ''),
        hints: (slide.hints || []).map((h: any) => ({ text: h.text })),
      }
    case 'number':
      return { answer: slide.answer, unit: slide.unit || '', tolerance: slide.tolerance }
    default:
      return null
  }
}

/* ---------- 統計 ---------- */

const CJK = /[㐀-鿿豈-﫿぀-ヿ]/
const SPLIT = /[\s,，。、；;.!?！？:：/\\|()（）「」『』【】\-—~"'`]+/

function tokenize(text: string) {
  const raw = String(text || '').trim()
  if (!raw) return []
  // 短句直接當成一個詞（中文斷詞成本高，短答案整句比較有意義）
  if (raw.length <= 6 && !/\s/.test(raw)) return [raw]
  const parts = raw.split(SPLIT).filter(Boolean)
  return parts.filter((w) => (CJK.test(w) ? w.length >= 1 : w.length >= 2)).slice(0, 20)
}

export function aggregate(slide: any, entries: any[]): any {
  const total = entries.length
  switch (slide.type) {
    case 'number': {
      const nums = entries.map((e) => toNumber(e.value)).filter((n) => Number.isFinite(n))
      const sorted = [...nums].sort((a, b) => a - b)
      const closest = entries
        .filter((e) => Number.isFinite(toNumber(e.value)))
        .sort((a, b) => Math.abs(toNumber(a.value) - slide.answer) - Math.abs(toNumber(b.value) - slide.answer))
        .slice(0, 5)
        .map((e) => ({ name: e.name, value: toNumber(e.value), diff: Math.abs(toNumber(e.value) - slide.answer) }))
      return {
        kind: 'number',
        total,
        answer: slide.answer,
        unit: slide.unit || '',
        closest,
        avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
        median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        min: sorted[0] ?? null,
        max: sorted[sorted.length - 1] ?? null,
        exact: entries.filter((e) => e.correct).length,
        // 公佈時逐人顯示（可滾動）
        people: entries.map((e) => ({ name: e.name, value: String(e.value ?? ''), correct: !!e.correct })),
      }
    }
    case 'scale': {
      const min = Number(slide.min) || 1
      const max = Number(slide.max) || 5
      const buckets = []
      for (let v = min; v <= max; v++) buckets.push({ value: v, count: 0 })
      let sum = 0
      let n = 0
      for (const e of entries) {
        const v = Number(e.value)
        const b = buckets.find((x) => x.value === v)
        if (b) {
          b.count += 1
          sum += v
          n += 1
        }
      }
      return {
        kind: 'scale',
        total,
        buckets,
        avg: n ? sum / n : null,
        min,
        max,
        minLabel: slide.minLabel || '',
        maxLabel: slide.maxLabel || '',
      }
    }
    case 'reveal': {
      const byStage = new Map<number, number>()
      for (const e of entries) {
        if (!e.correct) continue
        byStage.set(e.stage ?? 0, (byStage.get(e.stage ?? 0) || 0) + 1)
      }
      const bars = slide.options.map((o: any, i: number) => ({
        id: o.id,
        text: o.text,
        image: o.image || null,
        color: OPTION_COLORS[i % OPTION_COLORS.length],
        correct: !!o.correct && !slide.poll,
        count: entries.filter((e) => e.value === o.id).length,
      }))
      return {
        kind: 'bars',
        total,
        bars,
        // 額外附上「大家在第幾階段猜中」，公布時很有戲劇效果
        stageHits: [...byStage.entries()].sort((a, b) => a[0] - b[0]).map(([stage, count]) => ({ stage, count })),
      }
    }
    case 'single':
    case 'multi':
    case 'truefalse':
    case 'music': {
      const counts = slide.options.map((o: any, i: number) => ({
        id: o.id,
        text: o.text,
        image: o.image || null,
        color: OPTION_COLORS[i % OPTION_COLORS.length],
        correct: !!o.correct && !slide.poll,
        count: 0,
      }))
      const byId = new Map(counts.map((c: any) => [c.id, c]))
      for (const e of entries) {
        const picks = Array.isArray(e.value) ? e.value : [e.value]
        for (const id of picks) {
          const c: any = byId.get(id)
          if (c) c.count += 1
        }
      }
      return { kind: 'bars', total, bars: counts }
    }
    case 'match': {
      const rows = slide.pairs.map((p: any) => {
        let hit = 0
        for (const e of entries) if (e.value && e.value[p.id] === p.id) hit += 1
        return {
          id: p.id,
          left: p.left,
          right: p.right,
          leftImage: p.leftImage || null,
          rightImage: p.rightImage || null,
          count: hit,
        }
      })
      return { kind: 'pairs', total, rows, perfect: entries.filter((e) => e.correct).length }
    }
    case 'categorize': {
      const cols = slide.categories.map((c: any) => ({
        id: c.id,
        name: c.name,
        items: slide.items
          .filter((i: any) => i.categoryId === c.id)
          .map((i: any) => ({
            id: i.id,
            text: i.text,
            image: i.image || null,
            // 有幾個人把這個項目放對位置
            count: entries.filter((e) => e.value && e.value[i.id] === c.id).length,
          })),
      }))
      return { kind: 'categorize', total, cols, perfect: entries.filter((e) => e.correct).length }
    }
    case 'order': {
      const rows = slide.items.map((it: any, idx: number) => {
        let hit = 0
        for (const e of entries) if (Array.isArray(e.value) && e.value[idx] === it.id) hit += 1
        return { id: it.id, text: it.text, image: it.image || null, position: idx + 1, count: hit }
      })
      return { kind: 'order', total, rows, perfect: entries.filter((e) => e.correct).length }
    }
    case 'type':
    case 'soup': {
      const map = new Map<string, any>()
      for (const e of entries) {
        const key = String(e.value ?? '').trim() || '（空白）'
        const cur = map.get(key) || { text: key, count: 0, correct: e.correct }
        cur.count += 1
        map.set(key, cur)
      }
      const rows = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12)
      const res: any = {
        kind: 'answers',
        total,
        rows,
        correctCount: entries.filter((e) => e.correct).length,
        // 公佈時逐人顯示（可滾動）—— 只要是自己打字的題型都給
        people: entries.map((e) => ({ name: e.name, value: String(e.value ?? ''), correct: !!e.correct })),
      }
      if (slide.type === 'soup') {
        // 大家在第幾條提示就猜到了 —— 公布時很有戲
        const byStage = new Map<number, number>()
        for (const e of entries) if (e.correct) byStage.set(e.stage ?? 0, (byStage.get(e.stage ?? 0) || 0) + 1)
        res.stageHits = [...byStage.entries()].sort((a, b) => a[0] - b[0]).map(([stage, count]) => ({ stage, count }))
      }
      return res
    }
    case 'list': {
      const groups = listGroups(slide)
      // 每一組正解有幾個人答到（公佈時看哪個大家都漏了）
      const rows = groups.map((g) => {
        let count = 0
        for (const e of entries) {
          const submitted = (Array.isArray(e.value) ? e.value : []).map((v: string) => norm(v, slide))
          if (g.some((sp) => submitted.includes(norm(sp, slide)))) count++
        }
        return { text: g[0], count }
      })
      return {
        kind: 'list',
        total,
        groupTotal: groups.length,
        rows,
        perfect: entries.filter((e) => e.correct).length,
        // 逐人顯示每個人寫了哪些、哪些對（公佈時可滾動）
        people: entries.map((e) => {
          const r = listResult(slide, e.value)
          return {
            name: e.name,
            hits: r.hits,
            items: (Array.isArray(e.value) ? e.value : []).map((v: string, i: number) => ({ text: v, ok: !!r.marks[i] })),
          }
        }),
      }
    }
    case 'open': {
      const texts: any[] = []
      for (const e of entries) {
        const list = Array.isArray(e.value) ? e.value : [e.value]
        for (const t of list) if (String(t || '').trim()) texts.push({ name: e.name, text: String(t).trim() })
      }
      const freq = new Map<string, number>()
      for (const t of texts) for (const w of tokenize(t.text)) freq.set(w, (freq.get(w) || 0) + 1)
      const words = [...freq.entries()]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40)
      return { kind: 'open', total: texts.length, texts: texts.slice(-60), words, display: slide.display }
    }
    default:
      return { kind: 'none', total }
  }
}
