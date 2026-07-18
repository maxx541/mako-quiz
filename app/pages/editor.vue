<script setup lang="ts">
useHead({ title: '編輯簡報 · Makoquiz' })

const route = useRoute()
const id = String(route.query.id || '')

const pres = ref<any>(null)
const cur = ref(0)
const types = ref<Record<string, any>>({})
const saveState = ref<'saved' | 'dirty' | 'saving' | 'failed'>('saved')
const picking = ref<null | 'add' | 'replace'>(null)

const slide = computed(() => pres.value?.slides[cur.value] ?? null)
const uid = (p: string) => p + Math.random().toString(36).slice(2, 10)

/** 這一題最後到底有沒有速度加分（單題設定優先，沒設就跟整份走） */
const speedBonusEffective = computed(() => {
  const s = slide.value
  if (!s) return false
  if (s.speedBonus === 'on') return true
  if (s.speedBonus === 'off') return false
  return pres.value?.settings.speedBonus !== false
})

/**
 * 改猜圖題的格數。
 *
 * 格子索引是 row * cols + col，所以只要列數或行數一變，已經排好的索引
 * 就全部指到別的地方去了 —— 與其默默錯位，不如清掉並講清楚。
 */
function setGrid(key: 'rows' | 'cols', value: number) {
  const s = slide.value
  if (!s) return
  s.grid = { rows: s.grid?.rows || 5, cols: s.grid?.cols || 7, [key]: value }
  if (s.stageTiles?.some((t: number[]) => t?.length)) {
    s.stageTiles = []
    toast('格數改了，原本排好的揭露順序已清空', 'bad')
  }
  touch()
}

const SAVE_LABEL = { saved: '已儲存', dirty: '編輯中…', saving: '儲存中…', failed: '儲存失敗' }

/* ---------------- 載入 / 儲存 ---------------- */

let saveTimer: any = null

function touch() {
  saveState.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 700)
}

async function save() {
  clearTimeout(saveTimer)
  if (!pres.value) return
  saveState.value = 'saving'
  try {
    await api(`/presentations/${id}`, {
      method: 'PUT',
      body: {
        title: pres.value.title,
        description: pres.value.description,
        theme: pres.value.theme,
        background: pres.value.background,
        cover: pres.value.cover,
        lobbyMusic: pres.value.lobbyMusic,
        quizMusic: pres.value.quizMusic,
        quizMusicVolume: pres.value.quizMusicVolume,
        reactions: pres.value.reactions,
        settings: pres.value.settings,
        slides: pres.value.slides,
      },
      silent: true,
    })
    saveState.value = 'saved'
  } catch (err: any) {
    saveState.value = 'failed'
    toast('儲存失敗：' + err.message, 'bad')
  }
}

onMounted(async () => {
  if (!auth.token) return auth.gotoLogin()
  if (!id) return navigateTo('/admin')
  try {
    types.value = await api('/slide-types')
    pres.value = await api('/presentations/' + id)
  } catch (err: any) {
    toast('載入失敗：' + err.message, 'bad')
  }
  window.addEventListener('beforeunload', onLeave)
  window.addEventListener('keydown', onSlideKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onLeave)
  window.removeEventListener('keydown', onSlideKey)
})

/**
 * 上下鍵切換投影片。
 *
 * 什麼時候不該搶這個按鍵：
 * - 正在打字（輸入框、文字區、可編輯區）—— 上下鍵是移動游標
 * - 焦點在滑桿／下拉選單上 —— 上下鍵是調整數值
 * - 有彈窗開著 —— 不能讓方向鍵偷偷把後面的投影片換掉
 * - 有組合鍵 —— 那通常是瀏覽器或系統的快捷鍵
 */
function onSlideKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const el = e.target as HTMLElement | null
  if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
  if (document.querySelector('.gs-mask, .pv-mask, .mask, .help-mask, .zoom-mask')) return

  const total = pres.value?.slides?.length || 0
  const next = cur.value + (e.key === 'ArrowDown' ? 1 : -1)
  if (next < 0 || next >= total) return
  e.preventDefault()
  cur.value = next
  // 縮圖列可能捲很長，切過去要看得到自己選到哪一張
  nextTick(() => document.querySelectorAll('.thumb')[next]?.scrollIntoView({ block: 'nearest' }))
}

function onLeave(e: BeforeUnloadEvent) {
  if (saveState.value !== 'saved') {
    save()
    e.preventDefault()
  }
}

/* ---------------- 驗證 ---------------- */

/** 規則放在 ~/utils/validate.ts，播放前的整份檢查用的是同一份 */
const problems = slideProblems

const curProblems = computed(() => (slide.value ? problems(slide.value) : []))

/* ---------------- 投影片操作 ---------------- */

function moveSlide(from: number, to: number) {
  const slides = pres.value.slides
  if (to < 0 || to >= slides.length || from === to) return
  /*
   * 用 id 記住「原本選中的是哪一張」，不要去算 index。
   * 拖曳可能一次跨好幾格，原本那套「cur===from 就換成 to」只在相鄰對調時才對，
   * 跨格拖曳會選到別張投影片。
   */
  const curId = slides[cur.value]?.id
  const [s] = slides.splice(from, 1)
  slides.splice(to, 0, s)
  const back = slides.findIndex((x: any) => x.id === curId)
  cur.value = back >= 0 ? back : Math.min(to, slides.length - 1)
  touch()
}

/* ---------------- 整份簡報設定 ---------------- */

/**
 * 整份簡報的設定從側欄搬出來變成一個彈窗。
 *
 * 側欄本來同時放「這一頁」和「整份簡報」，但後者跟你正在編的那一題毫無關係 ——
 * 每點一張投影片都要再看一次底色、背景、表情符號、大廳音樂…，把真正在改的東西擠到看不見。
 */
const settingsOpen = ref(false)

/** 「統一套用」的暫存值。不是簡報的欄位，只是這個彈窗裡的選擇。 */
const bulk = ref({ timeLimit: 30, points: 'standard' as string })

/** 這幾種題型本來就沒有時間／分數可言，算數量時要排掉，不然按鈕會騙人 */
const timedSlides = computed(() => (pres.value?.slides || []).filter((s: any) => !['content', 'qa'].includes(s.type)))
const scoredSlides = computed(() =>
  (pres.value?.slides || []).filter((s: any) => !['content', 'qa', 'open', 'scale'].includes(s.type))
)
/*
 * 按鈕上的數字要是「真的會被改到幾題」，不是「總共幾題」。
 * 寫「套用到 13 題」但確認框說「把 11 題改掉」，使用者只會想「那另外 2 題呢？」
 */
const timedCount = computed(() => timedSlides.value.filter((s: any) => s.timeLimit !== bulk.value.timeLimit).length)
const scoredCount = computed(() => scoredSlides.value.filter((s: any) => s.points !== bulk.value.points).length)

/** 有幾題自己設了速度加分，不跟著整份簡報的預設走 */
const speedOverrides = computed(
  () => (pres.value?.slides || []).filter((s: any) => s.speedBonus && s.speedBonus !== 'inherit').length
)

const BULK_LABEL: Record<string, string> = {
  timeLimit: '作答時間',
  points: '分數',
  speedBonus: '速度加分',
}

/**
 * 一次改完全部題目。
 *
 * 這是唯一會覆蓋「個別題目設定」的操作，所以一定要先問 —— 使用者可能花了很久
 * 幫某幾題調過時間，一個按鈕全部推平而且沒得復原。訊息要講清楚會蓋掉幾題。
 */
async function applyAll(key: 'timeLimit' | 'points' | 'speedBonus') {
  const targets =
    key === 'timeLimit' ? timedSlides.value : key === 'points' ? scoredSlides.value : pres.value.slides
  if (!targets.length) return

  const want = key === 'speedBonus' ? 'inherit' : (bulk.value as any)[key]
  // 只算「真的會被改到」的，說「覆蓋 12 題」但其實只有 3 題不一樣，那是嚇人
  const changing = targets.filter((s: any) => (key === 'speedBonus' ? (s.speedBonus || 'inherit') !== 'inherit' : s[key] !== want))
  if (!changing.length) return toast(`所有題目的${BULK_LABEL[key]}本來就是這樣了`, 'ok')

  const yes = await confirmDialog({
    title: `把 ${changing.length} 題的${BULK_LABEL[key]}統一改掉？`,
    message:
      key === 'speedBonus'
        ? `這 ${changing.length} 題現在有自己的速度加分設定，套用之後會改成「跟隨整份簡報」。\n\n無法復原。`
        : `這 ${changing.length} 題現在的${BULK_LABEL[key]}跟你選的不一樣，會被覆蓋掉。\n\n無法復原。`,
    okText: `覆蓋 ${changing.length} 題`,
    danger: true,
  })
  if (!yes) return

  for (const s of changing) (s as any)[key] = want
  touch()
  toast(`${changing.length} 題的${BULK_LABEL[key]}已統一`, 'ok')
}

/* ---------------- 投影片拖曳排序 ---------------- */

const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)

function onDragStart(i: number, e: DragEvent) {
  dragFrom.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 不設 data 的話根本不會開始拖
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDrop(i: number) {
  if (dragFrom.value !== null) moveSlide(dragFrom.value, i)
  dragFrom.value = null
  dragOver.value = null
}

function onDragEnd() {
  dragFrom.value = null
  dragOver.value = null
}

/* ---------------- 選項拖曳排序 ---------------- */

const optFrom = ref<number | null>(null)
const optOver = ref<number | null>(null)

/**
 * 換的是「整個選項物件」的位置，不是把內容抄來抄去。
 *
 * 正解、圖片、文字本來就都掛在同一個物件上，物件搬到哪它們就跟到哪 ——
 * 所以把「第一個（正解）」拖到第二個，內容原封不動，正解自然變成第二個。
 * 顏色與形狀是照 index 算的，不跟著搬，這是對的：
 * 那是「第幾個選項」的識別色，手機上的按鈕位置也是照 index 排。
 */
function moveOption(from: number, to: number) {
  const list = slide.value?.options
  if (!list || to < 0 || to >= list.length || from === to) return
  const [o] = list.splice(from, 1)
  list.splice(to, 0, o)
  touch()
}

function onOptDragStart(i: number, e: DragEvent) {
  optFrom.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 不設 data 的話根本不會開始拖
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onOptDrop(i: number) {
  if (optFrom.value !== null) moveOption(optFrom.value, i)
  optFrom.value = null
  optOver.value = null
}

function onOptDragEnd() {
  optFrom.value = null
  optOver.value = null
}

function dupSlide(i: number) {
  const copy = JSON.parse(JSON.stringify(pres.value.slides[i]))
  copy.id = uid('s_')
  for (const key of ['options', 'pairs', 'items']) {
    if (Array.isArray(copy[key])) copy[key] = copy[key].map((x: any) => ({ ...x, id: uid(key[0] + '_') }))
  }
  pres.value.slides.splice(i + 1, 0, copy)
  cur.value = i + 1
  touch()
}

async function delSlide(i: number) {
  if (pres.value.slides.length === 1) return toast('至少要保留一張投影片', 'bad')
  const yes = await confirmDialog({ title: '刪除這張投影片？', message: '刪除後無法復原。', okText: '刪除', danger: true })
  if (!yes) return
  pres.value.slides.splice(i, 1)
  cur.value = Math.min(cur.value, pres.value.slides.length - 1)
  touch()
}

async function applyType(type: string) {
  const mode = picking.value
  picking.value = null
  const fresh = await api<any>('/slides/new', { method: 'POST', body: { type } })
  if (mode === 'add') {
    pres.value.slides.splice(cur.value + 1, 0, fresh)
    cur.value = Math.min(cur.value + 1, pres.value.slides.length - 1)
  } else {
    const old = pres.value.slides[cur.value]
    fresh.id = old.id
    fresh.title = old.title
    fresh.note = old.note
    fresh.image = old.image
    pres.value.slides[cur.value] = fresh
  }
  touch()
}

const typeGroups = computed(() => ({
  quiz: Object.entries(types.value).filter(([, t]: any) => t.group === 'quiz'),
  media: Object.entries(types.value).filter(([, t]: any) => t.group === 'media'),
  interact: Object.entries(types.value).filter(([, t]: any) => t.group === 'interact'),
}))

const TYPE_GROUP_LABELS: Record<string, string> = {
  quiz: '測驗題型（會計分）',
  media: '圖片與音樂',
  interact: '互動與內容',
}

/* ---------------- 背景 ---------------- */

const bgBusy = ref(false)
const bgFileEl = ref<HTMLInputElement | null>(null)
const bgPreview = computed(() => backgroundLayers(pres.value?.background))

/**
 * 上傳背景圖後自動分析亮度與細節量，決定要壓多暗、糊多少。
 * 使用者之後想自己調也可以，調了就把 auto 關掉。
 */
async function uploadBackground(file: File | undefined | null) {
  if (!file) return
  bgBusy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await $fetch<{ url: string; kind: string }>('/api/upload', {
      method: 'POST',
      body: fd,
      headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
    })
    if (res.kind !== 'image') throw new Error('背景只能用圖片')
    pres.value.background.image = res.url
    if (pres.value.background.auto !== false) {
      const tone = await analyzeImage(res.url)
      pres.value.background.dim = tone.dim
      pres.value.background.blur = tone.blur
      toast(`已自動最佳化：遮罩 ${tone.dim}%、模糊 ${tone.blur}px`, 'ok')
    } else {
      toast('背景已更新', 'ok')
    }
    touch({ rail: false, side: true })
  } catch (err: any) {
    toast(err?.data?.data?.error || err?.data?.error || err.message || '上傳失敗', 'bad')
  } finally {
    bgBusy.value = false
    if (bgFileEl.value) bgFileEl.value.value = ''
  }
}

async function reAuto() {
  if (!pres.value.background.image) return
  const tone = await analyzeImage(pres.value.background.image)
  pres.value.background.dim = tone.dim
  pres.value.background.blur = tone.blur
  pres.value.background.auto = true
  touch({ rail: false, side: true })
  toast(`已重新最佳化：遮罩 ${tone.dim}%、模糊 ${tone.blur}px`, 'ok')
}

function tweakBg() {
  // 手動動過就不再自動覆寫
  pres.value.background.auto = false
  touch({ rail: false })
}

function clearBg() {
  pres.value.background.image = null
  touch({ rail: false, side: true })
}

/* ---------------- 自訂表情符號 ---------------- */

const reactionBusy = ref(false)
const reactionFileEl = ref<HTMLInputElement | null>(null)

async function uploadReactions(files: FileList | null) {
  if (!files?.length) return
  reactionBusy.value = true
  try {
    for (const file of [...files].slice(0, 12 - pres.value.reactions.length)) {
      const fd = new FormData()
      fd.append('file', file)
      const res = await $fetch<{ url: string; kind: string }>('/api/upload', {
        method: 'POST',
        body: fd,
        headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
      })
      if (res.kind !== 'image') throw new Error('表情符號只能用圖片')
      pres.value.reactions.push({
        id: uid('r_'),
        url: res.url,
        // 用檔名當預設說明，之後可以改
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 20) || '表情',
      })
    }
    touch({ rail: false, side: true })
    toast('表情符號已加入', 'ok')
  } catch (err: any) {
    toast(err?.data?.data?.error || err?.data?.error || err.message || '上傳失敗', 'bad')
  } finally {
    reactionBusy.value = false
    if (reactionFileEl.value) reactionFileEl.value.value = ''
  }
}

function removeReaction(i: number) {
  pres.value.reactions.splice(i, 1)
  touch({ rail: false, side: true })
}

/* ---------------- 封面 ---------------- */

/*
 * 沒指定封面時實際會用到的那一張。
 *
 * 規則要跟伺服器的 coverOf() 一致：第一張有 slide.image 的題目。
 * 只看 slide.image —— 解說圖常常直接畫著答案，拿來當封面等於爆雷。
 */
const autoCoverIndex = computed(() => (pres.value?.slides || []).findIndex((s: any) => s.image))
const autoCover = computed(() =>
  autoCoverIndex.value >= 0 ? pres.value.slides[autoCoverIndex.value].image : null
)

/* ---------------- 大廳音樂 / 作答音樂 ---------------- */

const lobbyMusicBusy = ref(false)
const lobbyMusicFileEl = ref<HTMLInputElement | null>(null)
const quizMusicBusy = ref(false)
const quizMusicFileEl = ref<HTMLInputElement | null>(null)

/** 兩種背景音樂的上傳流程一樣，只差存到哪個欄位、失敗時要清哪個 input */
async function uploadMusic(
  file: File | undefined | null,
  opts: { field: 'lobbyMusic' | 'quizMusic'; label: string; busy: Ref<boolean>; input: Ref<HTMLInputElement | null> }
) {
  if (!file) return
  opts.busy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await $fetch<{ url: string; kind: string }>('/api/upload', {
      method: 'POST',
      body: fd,
      headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
    })
    if (res.kind !== 'audio') throw new Error('請選擇音訊檔')
    pres.value[opts.field] = res.url
    touch({ rail: false, side: true })
    toast(`${opts.label}已設定`, 'ok')
  } catch (err: any) {
    toast(err?.data?.data?.error || err?.data?.error || err.message || '上傳失敗', 'bad')
  } finally {
    opts.busy.value = false
    if (opts.input.value) opts.input.value.value = ''
  }
}

const uploadLobbyMusic = (file: File | undefined | null) =>
  uploadMusic(file, { field: 'lobbyMusic', label: '大廳音樂', busy: lobbyMusicBusy, input: lobbyMusicFileEl })

const uploadQuizMusic = (file: File | undefined | null) =>
  uploadMusic(file, { field: 'quizMusic', label: '作答音樂', busy: quizMusicBusy, input: quizMusicFileEl })

/* ---------------- 音檔上傳 ---------------- */

const audioBusy = ref(false)
const audioFileEl = ref<HTMLInputElement | null>(null)

/**
 * 直接用外部音檔網址。
 *
 * 跟圖片一樣，資料層本來就吃網址（walkAssets/isExternal 會原樣保留、不打包）。
 * 音檔比圖片更值得用網址 —— 整包題目簡報上限 50 MB，幾首 MP3 就吃掉一大半，
 * 用網址就不佔那個額度。代價是那個檔案不在你手上。
 */
async function pasteAudioUrl() {
  const url = await promptDialog({
    title: '用音檔網址',
    message:
      '貼上音檔的直接連結（.mp3 / .ogg / .wav / .m4a / .flac 結尾的那種，不是 YouTube 之類的網頁）。\n\n' +
      '好處：不佔上架的 50 MB 額度。\n' +
      '風險：檔案在對方的伺服器上，他換掉或刪掉，這一題就沒聲音了。',
    placeholder: 'https://example.com/song.mp3',
    defaultValue: isExternal(slide.value?.audio || '') ? slide.value.audio : '',
    okText: '使用這個網址',
  })
  if (url === null) return
  const v = url.trim()
  if (!v) return
  if (!/^https?:\/\//i.test(v)) return toast('網址要用 http:// 或 https:// 開頭', 'bad')
  slide.value.audio = v
  touch({ edit: true })
  toast('已設定音檔網址', 'ok')
}

async function uploadAudio(file: File | undefined | null) {
  if (!file) return
  audioBusy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await $fetch<{ url: string; kind: string }>('/api/upload', {
      method: 'POST',
      body: fd,
      headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
    })
    if (res.kind !== 'audio') throw new Error('請選擇音訊檔')
    slide.value.audio = res.url
    touch({ edit: true })
    toast('音檔已上傳', 'ok')
  } catch (err: any) {
    toast(err?.data?.data?.error || err?.data?.error || err.message || '上傳失敗', 'bad')
  } finally {
    audioBusy.value = false
    if (audioFileEl.value) audioFileEl.value.value = ''
  }
}

/* ---------------- 各題型的編輯操作 ---------------- */

const addOption = () => {
  slide.value.options.push({ id: uid('o_'), text: '', correct: false, image: null })
  touch()
}
const delOption = (i: number) => {
  slide.value.options.splice(i, 1)
  touch()
}
const markCorrect = (o: any) => {
  if (slide.value.type === 'multi') o.correct = !o.correct
  else slide.value.options.forEach((x: any) => (x.correct = x === o))
  touch()
}
const moveItem = (arr: any[], i: number, d: number) => {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  const [x] = arr.splice(i, 1)
  arr.splice(j, 0, x)
  touch()
}

/* ---------------- 分類題 ---------------- */

const CAT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']

function addCategory() {
  slide.value.categories.push({ id: uid('c_'), name: '' })
  touch({ edit: true })
}

/** 刪掉分類時，原本屬於它的項目要改掛到第一個分類，不然會變成孤兒 */
function removeCategory(i: number) {
  const gone = slide.value.categories[i]
  slide.value.categories.splice(i, 1)
  const fallback = slide.value.categories[0]?.id
  for (const it of slide.value.items) if (it.categoryId === gone.id) it.categoryId = fallback
  touch({ edit: true })
}

function addCatItem() {
  slide.value.items.push({ id: uid('i_'), text: '', image: null, categoryId: slide.value.categories[0]?.id })
  touch({ edit: true })
}

function togglePoll(v: boolean) {
  slide.value.poll = v
  if (v) slide.value.points = 'none'
  else if (slide.value.points === 'none') slide.value.points = 'standard'
  touch()
}

async function play() {
  if (!pres.value.slides.length) return toast('請先新增至少一張投影片', 'bad')
  await save()
  // 上台才發現音樂題沒音檔就來不及了，先掃一遍；堅持要播還是讓他播
  if (!(await confirmPlay(pres.value))) return
  window.open('/present?id=' + id, '_blank')
}

/* ---------------- 預覽 ---------------- */

/**
 * 開一場真的預覽場次，把主持端和手機端並排放在兩個 iframe 裡。
 *
 * 不做「靜態版面快照」是因為那要把兩邊的畫面邏輯再實作一次，
 * 之後只要有人改了真正的畫面，預覽就會偷偷跟現實脫節 —— 預覽騙人比沒有預覽更糟。
 * 房號要等 /present 開場才知道，所以由它 postMessage 回來。
 */
const previewOpen = ref(false)
const previewCode = ref('')
const previewStart = ref(0)
const previewHost = ref<HTMLIFrameElement | null>(null)

async function openPreview() {
  if (!pres.value.slides.length) return toast('請先新增至少一張投影片', 'bad')
  await save()
  // 直接從正在編輯的這一頁開始預覽，不用每次都從大廳按到目標題
  // （設在 open 當下，之後在編輯器切頁不會害 iframe 的 src 變動而重開一場）
  previewStart.value = cur.value
  previewCode.value = ''
  previewOpen.value = true
}

function onPreviewMsg(e: MessageEvent) {
  if (e.origin !== location.origin || e.data?.type !== 'ql:code') return
  previewCode.value = e.data.code
}

function closePreview() {
  // 叫預覽場次自己結束，不然這些練習用的房間會留到 8 小時後才被回收
  previewHost.value?.contentWindow?.postMessage({ type: 'ql:end' }, location.origin)
  previewOpen.value = false
  previewCode.value = ''
}

onMounted(() => window.addEventListener('message', onPreviewMsg))
onBeforeUnmount(() => {
  window.removeEventListener('message', onPreviewMsg)
  if (previewOpen.value) closePreview()
})

/** 純色主題 —— 漸層在投影機上會有色帶，也會跟題目搶注意力 */
const THEMES: [string, string, string][] = [
  ['slate', '#0f172a', '石板'],
  ['graphite', '#18181b', '石墨'],
  ['navy', '#0b1f3a', '海軍藍'],
  ['plum', '#1e1030', '梅紫'],
  ['forest', '#0b2a22', '森綠'],
  ['paper', '#eef1f5', '淺色'],
]

const TIME_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180]
const REVEAL_MODES: [string, string][] = [
  ['tiles', '格子揭開'],
  ['blur', '由糊變清'],
  ['zoom', '由近拉遠'],
]
</script>

<template>
  <div v-if="pres">
    <header class="appbar">
      <NuxtLink class="btn btn-ghost btn-icon" to="/admin" title="回到後台"><AppIcon name="arrow-left" :size="16" /></NuxtLink>
      <input v-model="pres.title" class="title-edit" placeholder="簡報名稱" maxlength="120" @input="touch" />
      <span class="save-state" :class="saveState">{{ SAVE_LABEL[saveState] }}</span>
      <div class="spacer" />
      <button class="btn btn-sm" @click="settingsOpen = true"><AppIcon name="sliders" :size="13" /> 整份簡報</button>
      <button class="btn btn-sm" @click="openPreview"><AppIcon name="monitor" :size="13" /> 預覽</button>
      <button class="btn btn-primary btn-sm" @click="play"><AppIcon name="play" :size="13" /> 播放</button>
      <AppHelp />
    </header>

    <!-- 預覽：左邊大螢幕、右邊手機，兩個都是真的畫面 -->
    <Teleport to="body">
      <div v-if="previewOpen" class="pv-mask" @mousedown.self="closePreview">
        <div class="pv-box">
          <header class="pv-head">
            <AppIcon name="monitor" :size="15" />
            <h3>預覽</h3>
            <span class="pv-note">這是一場真的預覽場次，可以直接操作；關掉就會收乾淨。</span>
            <div class="spacer" />
            <button class="btn btn-sm" @click="closePreview">關閉預覽</button>
          </header>
          <div class="pv-body">
            <div class="pv-pane">
              <div class="pv-cap">主持人的大螢幕</div>
              <iframe ref="previewHost" :src="`/present?id=${id}&preview=1&start=${previewStart}`" title="主持端預覽" />
            </div>
            <div class="pv-pane phone">
              <div class="pv-cap">參與者的手機</div>
              <iframe
                v-if="previewCode"
                :src="`/play?c=${previewCode}&n=${encodeURIComponent('預覽')}`"
                title="參與者預覽"
              />
              <div v-else class="pv-wait">正在建立預覽場次…</div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <div class="editor">
      <!-- 左：投影片列 -->
      <aside class="rail">
        <button class="rail-add" @click="picking = 'add'"><AppIcon name="plus" :size="14" /> 新增投影片</button>
        <!-- 拖曳排序：整列都可以抓，放開就換位置 -->
        <div
          v-for="(s, i) in pres.slides"
          :key="s.id"
          class="thumb"
          :class="{
            on: i === cur,
            warn: problems(s).length,
            'is-dragging': dragFrom === i,
            'drop-here': dragOver === i && dragFrom !== i,
          }"
          draggable="true"
          @click="cur = i"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent="dragOver = i"
          @dragleave="dragOver === i && (dragOver = null)"
          @drop.prevent="onDrop(i)"
          @dragend="onDragEnd"
        >
          <div class="idx">{{ i + 1 }}</div>
          <AppIcon :name="types[s.type]?.icon || 'file-text'" :size="14" />
          <div class="tx">
            <div class="tt">{{ s.title?.trim() || '（未命名）' }}</div>
            <div class="ty">{{ types[s.type]?.label || s.type }}{{ problems(s).length ? ' · 待完成' : '' }}</div>
          </div>
          <div class="tools">
            <button title="複製" @click.stop="dupSlide(i)"><AppIcon name="copy" :size="11" /></button>
            <button class="del" title="刪除" @click.stop="delSlide(i)"><AppIcon name="x" :size="11" /></button>
          </div>
        </div>
      </aside>

      <!-- 中：題目編輯 -->
      <main class="stage">
        <div v-if="slide" class="edit-box">
          <textarea
            v-model="slide.title"
            class="q-input"
            rows="1"
            :placeholder="slide.type === 'content' ? '輸入標題…' : '輸入題目…'"
            maxlength="300"
            @input="touch"
          />

          <div class="sec">
            <div class="sec-title">
              <AppIcon name="image" :size="13" />
              {{ slide.type === 'reveal' ? '要猜的圖片（CG／立繪）' : '題目圖片（選填）' }}
            </div>
            <ImagePicker
              v-model="slide.image"
              variant="cover"
              :label="slide.type === 'reveal' ? '上傳要讓大家猜的圖' : '為這一題加入圖片'"
              @update:model-value="touch"
            />
            <div v-if="slide.type === 'reveal' && slide.image" class="hint-box" style="margin-top: 10px">
              大螢幕會依設定的階段慢慢揭開這張圖；手機端只會看到選項，拿不到原圖。
            </div>
          </div>

          <!-- 音樂題：音檔 -->
          <div v-if="slide.type === 'music'" class="sec">
            <div class="sec-title"><AppIcon name="music" :size="13" /> 音檔</div>
            <div v-if="slide.audio" class="audio-box">
              <audio :src="slide.audio" controls preload="metadata" />
              <div class="audio-acts">
                <button class="btn btn-sm" :disabled="audioBusy" @click="audioFileEl?.click()">
                  <AppIcon name="edit" :size="12" /> 更換
                </button>
                <button class="btn btn-sm" :disabled="audioBusy" @click="pasteAudioUrl">
                  <AppIcon name="link" :size="12" /> 網址
                </button>
                <button class="btn btn-sm danger" @click="slide.audio = null; touch({ edit: true })">
                  <AppIcon name="trash" :size="12" /> 移除
                </button>
                <span v-if="isExternal(slide.audio)" class="ext-note" title="這個音檔存在別人的伺服器上，對方換掉就會失效">
                  <AppIcon name="link" :size="10" /> 外部網址
                </span>
              </div>
            </div>
            <template v-else>
              <button class="add-row audio-drop" :disabled="audioBusy" @click="audioFileEl?.click()">
                <AppIcon name="music" :size="20" />
                <span>{{ audioBusy ? '上傳中…' : '上傳音檔' }}</span>
                <small>MP3 / OGG / WAV / M4A / FLAC · 最大 15 MB</small>
                <span class="url-link" role="button" @click.stop="pasteAudioUrl">或貼上音檔網址</span>
              </button>
            </template>
            <input
              ref="audioFileEl"
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/flac,.mp3,.ogg,.wav,.m4a,.flac"
              class="hidden"
              @change="uploadAudio(($event.target as HTMLInputElement).files?.[0])"
            />
            <div class="hint-box" style="margin-top: 10px">
              音樂只會在主持人的大螢幕播放，不會傳到參與者手機（省流量，也避免有人偷看檔名）。
            </div>
          </div>

          <!-- 海龜湯 -->
          <template v-if="slide.type === 'soup'">
            <div class="sec">
              <div class="sec-title"><AppIcon name="layers" :size="13" /> 提示（一階段給一條，由模糊到明確）</div>
              <div v-for="(h, i) in slide.hints" :key="i" class="ord-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="h.text" class="input" :placeholder="`第 ${i + 1} 條提示，例如：作品類型是廢萌作`" maxlength="120" @input="touch" />
                <div class="mv">
                  <button :disabled="i === 0" @click="moveItem(slide.hints, i, -1)"><AppIcon name="chevron-up" :size="9" /></button>
                  <button :disabled="i === slide.hints.length - 1" @click="moveItem(slide.hints, i, 1)"><AppIcon name="chevron-down" :size="9" /></button>
                </div>
                <button class="icon-x" :disabled="slide.hints.length <= 2" @click="slide.hints.splice(i, 1); touch({ edit: true })">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.hints.length >= 8" @click="slide.hints.push({ text: '' }); touch({ edit: true })">
                {{ slide.hints.length >= 8 ? '最多 8 條提示' : '＋ 新增提示' }}
              </button>
              <div class="hint-box" style="margin-top: 12px">
                提示會一條一條出現，<b>越早猜中分數越高</b>：第 1 條就猜中拿 100%，
                看到最後一條才猜中剩 40%。目前 {{ slide.hints.length }} 條 = {{ slide.hints.length }} 個階段。
              </div>
            </div>

            <div class="sec">
              <div class="sec-title">可接受的答案（符合任一個就算對）</div>
              <div v-for="(a, i) in slide.accepted" :key="i" class="pair-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="slide.accepted[i]" class="input" placeholder="例如：CLANNAD" maxlength="80" @input="touch" />
                <button class="icon-x" :disabled="slide.accepted.length <= 1" @click="slide.accepted.splice(i, 1); touch({ edit: true })">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.accepted.length >= 10" @click="slide.accepted.push(''); touch({ edit: true })">
                ＋ 新增可接受答案
              </button>
              <div class="hint-box" style="margin-top: 12px">
                多列幾種寫法（繁體、簡體、英文、通稱、縮寫）可以避免誤判。大小寫與空白的處理在右側設定。
              </div>
            </div>
          </template>

          <!-- 數字題 -->
          <template v-else-if="slide.type === 'number'">
            <div class="sec">
              <div class="sec-title">正確答案</div>
              <div class="num-grid">
                <div>
                  <label class="label">答案</label>
                  <input v-model.number="slide.answer" class="input" type="number" @input="touch" />
                </div>
                <div>
                  <label class="label">單位（選填）</label>
                  <input v-model="slide.unit" class="input" placeholder="例如：萬套、年" maxlength="10" @input="touch" />
                </div>
                <div>
                  <label class="label">容許誤差</label>
                  <input v-model.number="slide.tolerance" class="input" type="number" min="0" @input="touch" />
                </div>
              </div>
              <div class="hint-box" style="margin-top: 12px">
                剛好猜中拿滿分；差距越大分數越低，超過容許誤差就 0 分。
                目前設定：猜 <b>{{ slide.answer }}{{ slide.unit }}</b> 滿分，差 <b>{{ slide.tolerance }}</b> 以上沒分，
                差一半（{{ Math.round((Number(slide.tolerance) || 0) / 2) }}）約拿 50%。
              </div>
            </div>
          </template>

          <!-- 評分題 -->
          <template v-else-if="slide.type === 'scale'">
            <div class="sec">
              <div class="sec-title">量表範圍</div>
              <div class="num-grid">
                <div>
                  <label class="label">最小值</label>
                  <input v-model.number="slide.min" class="input" type="number" @input="touch" />
                </div>
                <div>
                  <label class="label">最大值</label>
                  <input v-model.number="slide.max" class="input" type="number" @input="touch" />
                </div>
              </div>
              <div class="num-grid" style="margin-top: 10px">
                <div>
                  <label class="label">最小值的說明</label>
                  <input v-model="slide.minLabel" class="input" maxlength="20" @input="touch" />
                </div>
                <div>
                  <label class="label">最大值的說明</label>
                  <input v-model="slide.maxLabel" class="input" maxlength="20" @input="touch" />
                </div>
              </div>
              <div class="hint-box" style="margin-top: 12px">
                評分題不計分，大螢幕會顯示平均分與分布長條圖，適合收集意見。
              </div>
            </div>
          </template>

          <!-- 選擇題（含猜圖、音樂） -->
          <template v-if="CHOICE_TYPES.includes(slide.type)">
            <div class="sec">
              <div class="sec-title">{{ slide.poll ? '投票選項' : '選項（點右邊的勾勾標記正確答案）' }}</div>
              <div
                v-for="(o, i) in slide.options"
                :key="o.id"
                class="opt-row"
                :class="{ 'is-correct': o.correct && !slide.poll, 'opt-dragging': optFrom === i, 'opt-over': optOver === i && optFrom !== i }"
                @dragover.prevent="optOver = i"
                @drop.prevent="onOptDrop(i)"
              >
                <div class="swatch" :style="{ background: OPTION_COLORS[i % OPTION_COLORS.length] }" />
                <!-- 拖曳握把：整列設 draggable 會搶掉輸入框裡選字的操作，所以只讓這裡可以拖 -->
                <button
                  class="opt-grip"
                  draggable="true"
                  title="拖曳調整順序"
                  @dragstart="onOptDragStart(i, $event)"
                  @dragend="onOptDragEnd"
                >
                  <AppIcon name="grip" :size="14" />
                </button>
                <AppIcon :name="OPTION_SHAPES[i % OPTION_SHAPES.length]" :size="13" class="shape" />
                <div class="opt-main">
                  <input v-model="o.text" type="text" :placeholder="`選項 ${i + 1}`" maxlength="120" @input="touch" />
                </div>
                <ImagePicker v-model="o.image" variant="chip" label="為這個選項加圖" @update:model-value="touch" />
                <button
                  v-if="!slide.poll"
                  class="correct-btn"
                  :class="{ on: o.correct }"
                  title="標記為正確答案"
                  @click="markCorrect(o)"
                >
                  <AppIcon name="check" :size="13" />
                </button>
                <button
                  v-if="slide.type !== 'truefalse'"
                  class="icon-x"
                  title="刪除選項"
                  :disabled="slide.options.length <= 2"
                  @click="delOption(i)"
                >
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button v-if="slide.type !== 'truefalse'" class="add-row" :disabled="slide.options.length >= 6" @click="addOption">
                {{ slide.options.length >= 6 ? '最多 6 個選項' : '＋ 新增選項' }}
              </button>
              <div v-if="slide.type === 'reveal'" class="hint-box" style="margin-top: 12px">
                猜圖題用階段計分取代速度加分：第 1 階段就猜中拿滿分，拖到最後一階段剩 40%。
              </div>
              <div v-if="slide.poll" class="hint-box" style="margin-top: 12px">
                投票模式：沒有對錯、不計分，結果會即時顯示在大螢幕上。
              </div>
            </div>
          </template>

          <!-- 配對題 -->
          <template v-else-if="slide.type === 'match'">
            <div class="sec">
              <div class="sec-title">配對組合</div>
              <div v-for="(p, i) in slide.pairs" :key="p.id" class="pair-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="p.left" class="input" :placeholder="p.leftImage ? '（只用圖片）' : '題目項目'" maxlength="80" @input="touch" />
                <ImagePicker v-model="p.leftImage" variant="chip" label="為這一格加圖" @update:model-value="touch" />
                <AppIcon name="arrow-right" :size="14" class="arrow" />
                <input v-model="p.right" class="input" :placeholder="p.rightImage ? '（只用圖片）' : '正確答案'" maxlength="80" @input="touch" />
                <ImagePicker v-model="p.rightImage" variant="chip" label="為這一格加圖" @update:model-value="touch" />
                <button class="icon-x" :disabled="slide.pairs.length <= 2" @click="slide.pairs.splice(i, 1); touch()">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.pairs.length >= 8" @click="slide.pairs.push({ id: uid('m_'), left: '', right: '', leftImage: null, rightImage: null }); touch()">
                {{ slide.pairs.length >= 8 ? '最多 8 組' : '＋ 新增配對' }}
              </button>
              <div class="hint-box" style="margin-top: 12px">
                右欄答案在參與者手機上會自動打亂順序。答對幾組就給幾分之幾的分數。
                每一格都可以只放圖、只放字，或圖字都放（例如左邊立繪、右邊角色名）。
              </div>
            </div>
          </template>

          <!-- 分類題 -->
          <template v-else-if="slide.type === 'categorize'">
            <div class="sec">
              <div class="sec-title">分類</div>
              <div v-for="(c, i) in slide.categories" :key="c.id" class="pair-row">
                <div class="n cat-n" :style="{ background: CAT_COLORS[i % CAT_COLORS.length] }">{{ i + 1 }}</div>
                <input v-model="c.name" class="input" :placeholder="`分類 ${i + 1} 的名稱`" maxlength="30" @input="touch" />
                <button class="icon-x" :disabled="slide.categories.length <= 2" title="刪除分類" @click="removeCategory(i)">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.categories.length >= 6" @click="addCategory">
                {{ slide.categories.length >= 6 ? '最多 6 個分類' : '＋ 新增分類' }}
              </button>
            </div>

            <div class="sec">
              <div class="sec-title">項目（選它屬於哪一個分類，這就是正確答案）</div>
              <div v-for="(it, i) in slide.items" :key="it.id" class="pair-row">
                <input v-model="it.text" class="input" :placeholder="it.image ? '（只用圖片）' : `項目 ${i + 1}`" maxlength="60" @input="touch" />
                <ImagePicker v-model="it.image" variant="chip" label="為這個項目加圖" @update:model-value="touch" />
                <select v-model="it.categoryId" class="select cat-select" :style="{ borderColor: CAT_COLORS[slide.categories.findIndex((c: any) => c.id === it.categoryId) % CAT_COLORS.length] }" @change="touch">
                  <option v-for="c in slide.categories" :key="c.id" :value="c.id">{{ c.name || '（未命名）' }}</option>
                </select>
                <button class="icon-x" :disabled="slide.items.length <= 2" @click="slide.items.splice(i, 1); touch({ edit: true })">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.items.length >= 12" @click="addCatItem">
                {{ slide.items.length >= 12 ? '最多 12 個項目' : '＋ 新增項目' }}
              </button>
              <div class="hint-box" style="margin-top: 12px">
                參與者會看到打亂的項目，把它們拖進分類框（也可以點項目再點分類）。
                放對幾個就拿幾分之幾的分數，全對才算完全正確。
                項目可以只放圖、只放字，或圖字都放（例如把立繪分到所屬作品）。
              </div>
            </div>
          </template>

          <!-- 順序題 -->
          <template v-else-if="slide.type === 'order'">
            <div class="sec">
              <div class="sec-title">正確順序（由上到下）</div>
              <div v-for="(it, i) in slide.items" :key="it.id" class="ord-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="it.text" class="input" :placeholder="it.image ? '（只用圖片）' : `第 ${i + 1} 個`" maxlength="100" @input="touch" />
                <ImagePicker v-model="it.image" variant="chip" label="為這個項目加圖" @update:model-value="touch" />
                <div class="mv">
                  <button :disabled="i === 0" @click="moveItem(slide.items, i, -1)"><AppIcon name="chevron-up" :size="9" /></button>
                  <button :disabled="i === slide.items.length - 1" @click="moveItem(slide.items, i, 1)"><AppIcon name="chevron-down" :size="9" /></button>
                </div>
                <button class="icon-x" :disabled="slide.items.length <= 2" @click="slide.items.splice(i, 1); touch()">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.items.length >= 8" @click="slide.items.push({ id: uid('i_'), text: '', image: null }); touch()">
                {{ slide.items.length >= 8 ? '最多 8 個項目' : '＋ 新增項目' }}
              </button>
              <div class="hint-box" style="margin-top: 12px">
                這裡的排列就是正確答案；參與者手機上會看到打亂的順序。每放對一個位置就拿到對應比例的分數。
                項目可以只放圖、只放字，或圖字都放（例如把 CG 依劇情先後排）。
              </div>
            </div>
          </template>

          <!-- 填空題 -->
          <template v-else-if="slide.type === 'type'">
            <div class="sec">
              <div class="sec-title">可接受的答案（符合任一個就算對）</div>
              <div v-for="(a, i) in slide.accepted" :key="i" class="pair-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="slide.accepted[i]" class="input" placeholder="可接受的答案" maxlength="80" @input="touch" />
                <button class="icon-x" :disabled="slide.accepted.length <= 1" @click="slide.accepted.splice(i, 1); touch()">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.accepted.length >= 10" @click="slide.accepted.push(''); touch()">
                ＋ 新增可接受答案
              </button>
              <div class="hint-box" style="margin-top: 12px">
                多列幾個常見寫法（簡體、英文、別名）可以避免誤判。大小寫與空白的處理在右側設定。
              </div>
            </div>
          </template>

          <!-- 複數答案 -->
          <template v-else-if="slide.type === 'list'">
            <div class="sec">
              <div class="sec-title">要收集的答案（一列一個；同一個答案的不同寫法用 | 隔開）</div>
              <div v-for="(a, i) in slide.accepted" :key="i" class="pair-row">
                <div class="n">{{ i + 1 }}</div>
                <input v-model="slide.accepted[i]" class="input" placeholder="例如：CLANNAD|克蘭納德" maxlength="80" @input="touch" />
                <button class="icon-x" :disabled="slide.accepted.length <= 1" @click="slide.accepted.splice(i, 1); touch({ edit: true })">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
              <button class="add-row" :disabled="slide.accepted.length >= 30" @click="slide.accepted.push(''); touch({ edit: true })">
                ＋ 新增一個答案
              </button>
              <div class="hint-box" style="margin-top: 12px">
                參與者在手機上一個一個把答案打進來，答對越多分越高，把全部
                {{ slide.accepted.filter((a: string) => a.trim()).length }} 個都答出來還有額外加分。
                同一個答案的別名／簡體／英文寫法用 <b>|</b> 隔開，符合任一個就算命中。
              </div>
            </div>
          </template>

          <!-- 內容頁 -->
          <template v-else-if="slide.type === 'content'">
            <div class="sec">
              <div class="sec-title">內文</div>
              <textarea v-model="slide.body" class="textarea" rows="6" placeholder="輸入內文…（可換行）" maxlength="800" @input="touch" />
              <div class="hint-box" style="margin-top: 12px">
                內容頁只會顯示在大螢幕上，參與者不需要作答，適合用來開場或分段說明。
              </div>
            </div>
          </template>

          <div v-else-if="slide.type === 'open'" class="sec">
            <div class="hint-box">參與者會在手機上自由輸入想法，主持人的大螢幕會即時顯示文字雲或回覆列表。這個題型不計分。</div>
          </div>

          <div v-else-if="slide.type === 'qa'" class="sec">
            <div class="hint-box">
              參與者可以隨時提問並幫別人的問題按讚。主持人可以在播放畫面右側的提問面板置頂、標記已回答或刪除問題。
            </div>
          </div>

          <!-- 解說：只在公布答案時出現 -->
          <div v-if="!['content', 'qa'].includes(slide.type)" class="sec">
            <div class="sec-title">
              <AppIcon name="info" :size="13" /> 答案解說（選填，只在公布答案時顯示）
            </div>
            <textarea
              v-model="slide.explain.text"
              class="textarea"
              rows="3"
              placeholder="為什麼是這個答案？補充說明、出處、冷知識…"
              maxlength="500"
              @input="touch({ rail: false })"
            />
            <div style="margin-top: 8px">
              <ImagePicker v-model="slide.explain.image" variant="cover" label="加入解說圖片" @update:model-value="touch({ rail: false })" />
            </div>
            <div class="hint-box" style="margin-top: 10px">
              公布答案後，大螢幕與參與者手機都會看到這段說明。作答期間不會外流。
            </div>
          </div>

          <div v-if="curProblems.length" class="warn-box">
            <AppIcon name="alert" :size="14" /> 這一頁還沒完成：{{ curProblems.join('、') }}
          </div>
        </div>
      </main>

      <!-- 右：設定 -->
      <aside class="side">
        <template v-if="slide">
          <h3>這一頁</h3>
          <button class="btn btn-block type-btn" @click="picking = 'replace'">
            <span class="tl"><AppIcon :name="types[slide.type]?.icon || 'file-text'" :size="15" /> {{ types[slide.type]?.label }}</span>
            <span class="tr">更換 <AppIcon name="chevron-down" :size="12" /></span>
          </button>

          <div v-if="!['content', 'qa'].includes(slide.type)" class="field">
            <label class="label">作答時間</label>
            <select v-model.number="slide.timeLimit" class="select" @change="touch">
              <option v-for="v in TIME_OPTIONS" :key="v" :value="v">{{ v === 0 ? '不限時' : v + ' 秒' }}</option>
            </select>
            <p class="note">時間到只會停止作答，答案一律由你按「公布答案」才會揭曉。</p>
          </div>

          <div v-if="!['content', 'qa', 'open', 'scale'].includes(slide.type)" class="field">
            <label class="label">分數</label>
            <div class="seg">
              <button v-for="p in [['none', '不計分'], ['standard', '標準'], ['double', '雙倍']]" :key="p[0]"
                :class="{ on: slide.points === p[0] }" @click="slide.points = p[0]; touch()">{{ p[1] }}</button>
            </div>
          </div>

          <!-- 猜圖題設定 -->
          <template v-if="slide.type === 'reveal'">
            <div class="field">
              <label class="label">揭露方式</label>
              <div class="seg">
                <button v-for="[k, l] in REVEAL_MODES" :key="k" :class="{ on: (slide.revealMode || 'tiles') === k }"
                  @click="slide.revealMode = k; touch({ rail: false, side: true })">{{ l }}</button>
              </div>
            </div>
            <div class="field">
              <label class="label">分幾階段揭露</label>
              <select v-model.number="slide.stages" class="select" @change="touch({ rail: false, side: true })">
                <option v-for="v in [3, 4, 5, 6, 8]" :key="v" :value="v">{{ v }} 階段</option>
              </select>
              <p class="note">
                第 1 階段猜中拿 100%，最後一階段剩 40%，中間平均遞減。
              </p>
            </div>
            <div class="field">
              <label class="label">每階段停留</label>
              <select v-model.number="slide.stageSeconds" class="select" @change="touch({ rail: false })">
                <option :value="0">不自動，只由主持人手動揭</option>
                <option v-for="v in [3, 4, 5, 6, 8, 10]" :key="v" :value="v">{{ v }} 秒</option>
              </select>
            </div>

            <!-- 格子模式才排得了：模糊與拉遠沒有「哪幾塊」可言 -->
            <div v-if="(slide.revealMode || 'tiles') === 'tiles'" class="field">
              <label class="label">每階段揭開哪幾塊</label>
              <RevealPlanner
                v-if="slide.image"
                v-model="slide.stageTiles"
                :src="slide.image"
                :rows="slide.grid?.rows || 5"
                :cols="slide.grid?.cols || 7"
                :stages="slide.stages || 5"
                @update:model-value="touch({ rail: false, side: true })"
                @update:rows="setGrid('rows', $event)"
                @update:cols="setGrid('cols', $event)"
              />
              <p v-else class="note">先在上面上傳要猜的圖片，才能排揭露順序。</p>
            </div>
          </template>

          <!-- 音樂題設定 -->
          <template v-if="slide.type === 'music'">
            <div class="field">
              <label class="label">從第幾秒開始播</label>
              <input v-model.number="slide.audioStart" class="input" type="number" min="0" @input="touch({ rail: false })" />
              <p class="note">前奏太長時可以直接跳到副歌。</p>
            </div>
            <label class="switch mb">
              <input type="checkbox" :checked="slide.autoPlay !== false" @change="slide.autoPlay = ($event.target as HTMLInputElement).checked; touch({ rail: false })" />
              <span class="track" /><span>進到這一頁自動播放</span>
            </label>
          </template>

          <!--
            速度加分有兩層：整份簡報一個預設值，單題可以覆寫。
            兩邊的文案要講清楚自己是哪一層，不然看起來就像重複的開關。
          -->
          <div v-if="!['content', 'qa', 'open', 'scale', ...STAGED_TYPES].includes(slide.type) && slide.points !== 'none'" class="field">
            <label class="label">這一題要不要速度加分</label>
            <div class="seg">
              <button v-for="p in [['inherit', '跟隨整份'], ['on', '這題開'], ['off', '這題關']]" :key="p[0]"
                :class="{ on: (slide.speedBonus || 'inherit') === p[0] }" @click="slide.speedBonus = p[0]; touch()">{{ p[1] }}</button>
            </div>
            <p class="note">
              <template v-if="(slide.speedBonus || 'inherit') === 'inherit'">
                跟著下面「整份簡報」的設定走（目前是<b>{{ pres.settings.speedBonus !== false ? '開啟' : '關閉' }}</b>）。
              </template>
              <template v-else>
                <b>只覆寫這一題</b>，不影響其他題。
              </template>
              <br />
              實際效果：<b>{{ speedBonusEffective ? '答得越快分數越高' : '不看速度，答對就是滿分' }}</b>
              <template v-if="slide.timeLimit === 0"> —— 這題不限時，所以速度加分不會生效</template>
            </p>
          </div>

          <label v-if="['single', 'multi'].includes(slide.type)" class="switch mb">
            <input type="checkbox" :checked="!!slide.poll" @change="togglePoll(($event.target as HTMLInputElement).checked)" />
            <span class="track" />
            <span>這是投票（沒有正確答案、不計分）</span>
          </label>

          <!-- 海龜湯：提示節奏 -->
          <div v-if="slide.type === 'soup'" class="field">
            <label class="label">每條提示停留</label>
            <select v-model.number="slide.stageSeconds" class="select" @change="touch({ rail: false })">
              <option :value="0">不自動，只由主持人手動給</option>
              <option v-for="v in [10, 15, 20, 30, 45, 60]" :key="v" :value="v">{{ v }} 秒</option>
            </select>
            <p class="note">海龜湯建議留久一點，讓大家有時間想。</p>
          </div>

          <template v-if="['type', 'soup', 'list'].includes(slide.type)">
            <label class="switch mb">
              <input type="checkbox" :checked="slide.ignoreCase !== false" @change="slide.ignoreCase = ($event.target as HTMLInputElement).checked; touch()" />
              <span class="track" /><span>忽略英文大小寫</span>
            </label>
            <label class="switch mb">
              <input type="checkbox" :checked="slide.ignoreSpace !== false" @change="slide.ignoreSpace = ($event.target as HTMLInputElement).checked; touch()" />
              <span class="track" /><span>忽略空白</span>
            </label>
          </template>

          <!-- 複數答案：額外加分與提交上限 -->
          <template v-if="slide.type === 'list'">
            <div class="field">
              <label class="label">全部答出的額外加分</label>
              <div class="seg">
                <button v-for="p in [['0', '無'], ['0.25', '+25%'], ['0.5', '+50%'], ['1', '+100%']]" :key="p[0]"
                  :class="{ on: String(slide.allBonus ?? 0.5) === p[0] }" @click="slide.allBonus = Number(p[0]); touch()">{{ p[1] }}</button>
              </div>
              <p class="note">把所有答案都湊齊的人，在原本得分之外再多拿這個比例。</p>
            </div>
            <div class="field">
              <label class="label">每人最多送幾個</label>
              <select v-model.number="slide.maxSubmissions" class="select" @change="touch">
                <option v-for="v in [6, 10, 12, 20, 30]" :key="v" :value="v">{{ v }} 個</option>
              </select>
            </div>
          </template>

          <template v-if="slide.type === 'open'">
            <div class="field">
              <label class="label">顯示方式</label>
              <div class="seg">
                <button v-for="p in [['cloud', '文字雲'], ['list', '回覆列表']]" :key="p[0]"
                  :class="{ on: slide.display === p[0] }" @click="slide.display = p[0]; touch()">{{ p[1] }}</button>
              </div>
            </div>
            <div class="field">
              <label class="label">每人可送出幾則</label>
              <select v-model.number="slide.maxSubmissions" class="select" @change="touch">
                <option v-for="v in [1, 2, 3, 5]" :key="v" :value="v">{{ v }} 則</option>
              </select>
            </div>
            <div class="field">
              <label class="label">字數上限</label>
              <select v-model.number="slide.maxChars" class="select" @change="touch">
                <option v-for="v in [30, 60, 120, 200]" :key="v" :value="v">{{ v }} 字</option>
              </select>
            </div>
          </template>

          <div class="field">
            <label class="label">主持人備註</label>
            <textarea v-model="slide.note" class="textarea" rows="3" placeholder="只有主持人看得到的備註…" maxlength="400" @input="touch" />
          </div>
        </template>

      </aside>
    </div>

    <!-- 整份簡報設定：從每一頁的側欄搬出來的，不然每張投影片都要看一次同樣的東西 -->
    <Teleport to="body">
      <div v-if="settingsOpen" class="gs-mask" @mousedown.self="settingsOpen = false">
        <div class="gs-box">
          <header class="gs-head">
            <AppIcon name="sliders" :size="16" />
            <h2>整份簡報</h2>
            <span class="gs-note">這裡改的東西會套用到整份簡報</span>
            <div class="spacer" />
            <button class="btn btn-sm" @click="settingsOpen = false">關閉</button>
          </header>

          <div class="gs-body">
            <!--
              統一套用：這一區是唯一會「覆蓋每一頁自己的設定」的地方，
              所以按鈕要講清楚會蓋掉幾題，而且按下去先問一次。
            -->
            <h3>統一套用到所有題目</h3>
            <p class="note mb">
              每一題本來可以各自設定。這裡是一次改完全部 —— <b>按下「套用」會覆蓋掉個別題目的設定</b>。
            </p>

            <div class="field">
              <label class="label">作答時間</label>
              <div class="gs-row">
                <select v-model.number="bulk.timeLimit" class="select">
                  <option :value="0">不限時</option>
                  <option v-for="v in [10, 15, 20, 30, 45, 60, 90, 120]" :key="v" :value="v">{{ v }} 秒</option>
                </select>
                <button class="btn btn-sm" :disabled="!timedCount" @click="applyAll('timeLimit')">
                  {{ timedCount ? `套用到 ${timedCount} 題` : '全部都是了' }}
                </button>
              </div>
            </div>

            <div class="field">
              <label class="label">分數</label>
              <div class="gs-row">
                <div class="seg">
                  <button v-for="p in [['none', '不計分'], ['standard', '標準'], ['double', '雙倍']]" :key="p[0]"
                    :class="{ on: bulk.points === p[0] }" @click="bulk.points = p[0]">{{ p[1] }}</button>
                </div>
                <button class="btn btn-sm" :disabled="!scoredCount" @click="applyAll('points')">
                  {{ scoredCount ? `套用到 ${scoredCount} 題` : '全部都是了' }}
                </button>
              </div>
            </div>

            <div class="divider" />
            <h3>速度加分</h3>
            <p class="note mb">
              答對越快分數越高。這是整份簡報的<b>預設值</b> —— 沒有自己設定的題目就跟著這個走。
            </p>
            <label class="switch mb">
              <input type="checkbox" :checked="pres.settings.speedBonus !== false"
                @change="pres.settings.speedBonus = ($event.target as HTMLInputElement).checked; touch()" />
              <span class="track" /><span>預設開啟速度加分</span>
            </label>
            <div v-if="speedOverrides" class="gs-row">
              <p class="note">有 <b>{{ speedOverrides }}</b> 題自己設了不同的值，不會跟著這個預設走。</p>
              <button class="btn btn-sm" @click="applyAll('speedBonus')">讓它們跟隨預設</button>
            </div>

            <div class="divider" />
            <h3>封面</h3>
        <p class="note mb">
          列表、題庫市集、還有<b>大廳等人的時候</b>都會顯示這一張。
          沒有指定的話自動抓<b>第一張有配圖的題目</b>。
        </p>
        <ImagePicker v-model="pres.cover" label="指定封面圖" @update:model-value="touch({ rail: false, side: true })" />
        <div v-if="!pres.cover" class="auto-cover">
          <template v-if="autoCover">
            <img :src="autoCover" alt="" />
            <span>目前自動用這張（第 {{ autoCoverIndex + 1 }} 題的圖）</span>
          </template>
          <span v-else class="note">還沒有任何題目配圖，所以大廳那塊會是空的。</span>
        </div>

        <div class="divider" />
        <h3>外觀</h3>

        <div class="field">
          <label class="label">底色</label>
          <div class="themes">
            <button v-for="[n, color, label] in THEMES" :key="n" class="theme-dot" :class="{ on: pres.theme === n }"
              :style="{ background: color }" :title="label" @click="pres.theme = n; touch()" />
          </div>
        </div>

        <!-- 自訂背景 -->
        <div class="field">
          <label class="label">自訂背景圖</label>

          <div v-if="pres.background.image" class="bg-preview" :class="'theme-' + pres.theme">
            <div class="bg-layer" :style="bgPreview.image" />
            <div class="bg-scrim" :style="bgPreview.scrim" />
            <div class="bg-sample">
              <b>題目看起來像這樣</b>
              <span>選項文字</span>
            </div>
          </div>

          <button v-if="!pres.background.image" class="add-row bg-drop" :disabled="bgBusy" @click="bgFileEl?.click()">
            <AppIcon name="image" :size="18" />
            <span>{{ bgBusy ? '分析中…' : '上傳背景圖' }}</span>
          </button>
          <div v-else class="bg-acts">
            <button class="btn btn-sm" :disabled="bgBusy" @click="bgFileEl?.click()"><AppIcon name="edit" :size="12" /> 更換</button>
            <button class="btn btn-sm" :disabled="bgBusy" title="重新自動分析亮度與細節" @click="reAuto">
              <AppIcon name="wand" :size="12" /> 自動最佳化
            </button>
            <button class="btn btn-sm danger" @click="clearBg"><AppIcon name="trash" :size="12" /></button>
          </div>

          <input ref="bgFileEl" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden bg-input"
            @change="uploadBackground(($event.target as HTMLInputElement).files?.[0])" />

          <template v-if="pres.background.image">
            <div class="slider-row">
              <span>遮罩</span>
              <input v-model.number="pres.background.dim" type="range" min="0" max="90" @input="tweakBg" />
              <b>{{ pres.background.dim }}%</b>
            </div>
            <div class="slider-row">
              <span>模糊</span>
              <input v-model.number="pres.background.blur" type="range" min="0" max="20" @input="tweakBg" />
              <b>{{ pres.background.blur }}px</b>
            </div>
            <p class="note bg-note">
              <template v-if="pres.background.auto !== false">
                <AppIcon name="wand" :size="11" /> 已依這張圖的亮度與細節自動調整，確保題目清晰。
              </template>
              <template v-else>已手動調整；想回到自動請按「自動最佳化」。</template>
            </p>
          </template>
        </div>

        <!-- 速度加分的開關在上面「速度加分」那一區，這裡不要再放一個 -->
        <div class="divider" />
        <h3>流程</h3>

        <label class="switch mb">
          <input type="checkbox" :checked="pres.settings.showLeaderboard !== false" @change="pres.settings.showLeaderboard = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>每題後顯示排行榜</span>
        </label>
        <label class="switch mb">
          <input type="checkbox" :checked="pres.settings.allowLateJoin !== false" @change="pres.settings.allowLateJoin = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>開放中途加入</span>
        </label>

        <div class="divider" />
        <h3>自訂表情符號</h3>
        <p class="note mb">
          參與者點了會從大螢幕下方浮出來、幾秒後淡出，<b>不會顯示是誰送的</b>。
        </p>

        <div v-if="pres.reactions.length" class="react-grid">
          <div v-for="(r, i) in pres.reactions" :key="r.id" class="react-cell">
            <img :src="r.url" :alt="r.label" />
            <button class="chip-x" title="移除" @click="removeReaction(i)"><AppIcon name="x" :size="10" /></button>
            <input v-model="r.label" class="react-label" maxlength="20" placeholder="說明" @input="touch({ rail: false })" />
          </div>
        </div>

        <button class="add-row" :disabled="reactionBusy || pres.reactions.length >= 12" @click="reactionFileEl?.click()">
          {{ reactionBusy ? '上傳中…' : pres.reactions.length >= 12 ? '最多 12 個' : '＋ 上傳表情符號（可多選）' }}
        </button>
        <input ref="reactionFileEl" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple class="hidden"
          @change="uploadReactions(($event.target as HTMLInputElement).files)" />

        <label class="switch mb" style="margin-top: 12px">
          <input type="checkbox" :checked="pres.settings.reactionsEnabled !== false" @change="pres.settings.reactionsEnabled = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>開放參與者送表情符號</span>
        </label>

        <div class="divider" />
        <h3>大廳音樂</h3>
        <p class="note mb">
          等待參與者加入時，主持人可以在大廳按播放，循環播放這段音樂。<b>只在大螢幕播，不會傳到手機。</b>
        </p>
        <div v-if="pres.lobbyMusic" class="audio-box lobby-music-box">
          <audio :src="pres.lobbyMusic" controls preload="metadata" />
          <div class="audio-acts">
            <button class="btn btn-sm" :disabled="lobbyMusicBusy" @click="lobbyMusicFileEl?.click()">
              <AppIcon name="edit" :size="12" /> 更換
            </button>
            <button class="btn btn-sm danger" @click="pres.lobbyMusic = null; touch({ rail: false, side: true })">
              <AppIcon name="trash" :size="12" /> 移除
            </button>
          </div>
        </div>
        <button v-else class="add-row audio-drop lobby-music-drop" :disabled="lobbyMusicBusy" @click="lobbyMusicFileEl?.click()">
          <AppIcon name="music" :size="20" />
          <span>{{ lobbyMusicBusy ? '上傳中…' : '上傳大廳音樂' }}</span>
          <small>MP3 / OGG / WAV / M4A / FLAC · 最大 15 MB</small>
        </button>
        <input
          ref="lobbyMusicFileEl"
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/flac,.mp3,.ogg,.wav,.m4a,.flac"
          class="hidden lobby-music-input"
          @change="uploadLobbyMusic(($event.target as HTMLInputElement).files?.[0])"
        />

        <div class="divider" />
        <h3>作答音樂</h3>
        <p class="note mb">
          開始出題後整場循環播放的背景音樂，跟大廳音樂各播各的。<b>一樣只在大螢幕播，不會傳到手機。</b>
          碰到音樂題會自動停下來讓路，離開那一頁再接回去；主持人也可以隨時在下方控制列按掉。
        </p>
        <div v-if="pres.quizMusic" class="audio-box quiz-music-box">
          <audio :src="pres.quizMusic" controls preload="metadata" />
          <div class="audio-acts">
            <button class="btn btn-sm" :disabled="quizMusicBusy" @click="quizMusicFileEl?.click()">
              <AppIcon name="edit" :size="12" /> 更換
            </button>
            <button class="btn btn-sm danger" @click="pres.quizMusic = null; touch({ rail: false, side: true })">
              <AppIcon name="trash" :size="12" /> 移除
            </button>
          </div>
          <div class="slider-row">
            <span>音量</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              class="quiz-music-volume"
              :value="pres.quizMusicVolume ?? 35"
              @input="pres.quizMusicVolume = Number(($event.target as HTMLInputElement).value); touch({ rail: false, side: true })"
            />
            <b>{{ pres.quizMusicVolume ?? 35 }}%</b>
          </div>
          <p class="note">背景音樂放太大聲會蓋掉主持人講話，建議 30–40%。</p>
        </div>
        <button v-else class="add-row audio-drop quiz-music-drop" :disabled="quizMusicBusy" @click="quizMusicFileEl?.click()">
          <AppIcon name="music" :size="20" />
          <span>{{ quizMusicBusy ? '上傳中…' : '上傳作答音樂' }}</span>
          <small>MP3 / OGG / WAV / M4A / FLAC · 最大 15 MB</small>
        </button>
        <input
          ref="quizMusicFileEl"
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/flac,.mp3,.ogg,.wav,.m4a,.flac"
          class="hidden quiz-music-input"
          @change="uploadQuizMusic(($event.target as HTMLInputElement).files?.[0])"
        />

        <div class="divider" />
        <h3>觀眾提問</h3>
        <label class="switch mb">
          <input type="checkbox" :checked="pres.settings.qaEnabled !== false" @change="pres.settings.qaEnabled = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>開放參與者提問</span>
        </label>
        <label class="switch mb">
          <input type="checkbox" :checked="pres.settings.qaAnonymous !== false" @change="pres.settings.qaAnonymous = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>匿名提問</span>
        </label>
        <label class="switch mb">
          <input type="checkbox" :checked="pres.settings.qaUpvote !== false" @change="pres.settings.qaUpvote = ($event.target as HTMLInputElement).checked; touch()" />
          <span class="track" /><span>可以幫問題按讚</span>
        </label>

        <div class="divider" />
        <h3>備份與搬移</h3>
        <p class="note mb">
          編輯會即時自動儲存。想備份或搬到另一台電腦，回<NuxtLink class="link" to="/admin">後台</NuxtLink>
          在這份簡報的卡片按<b>匯出</b>：有圖片或音樂會打包成一個 <code class="mono">.zip</code>（連素材一起），
          在別台的「匯入題目」丟回去就能完整還原。
        </p>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 題型選單 -->
    <div v-if="picking" class="modal" @mousedown.self="picking = null">
      <div class="modal-card">
        <h2>{{ picking === 'add' ? '選擇題型' : '更換題型' }}</h2>
        <p class="sub">{{ picking === 'add' ? '挑一個題型加到簡報裡' : '換題型會清掉這一頁目前的答案設定' }}</p>
        <template v-for="(label, group) in TYPE_GROUP_LABELS" :key="group">
          <div class="group-label">{{ label }}</div>
          <div class="type-grid">
            <button v-for="[key, t] in typeGroups[group]" :key="key" class="type-card" @click="applyType(key)">
              <AppIcon :name="t.icon" :size="17" />
              <div class="nm">{{ t.label }}</div>
              <div class="ds">{{ t.desc }}</div>
            </button>
          </div>
        </template>
        <div style="text-align: right; margin-top: 18px">
          <button class="btn" @click="picking = null">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---------------- 整份簡報設定 ---------------- */

.gs-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.6);
  display: grid;
  place-items: center;
  padding: 20px;
}

.gs-box {
  background: var(--card, #fff);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-3);
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.gs-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.gs-head h2 {
  font-size: 15px;
  font-weight: 800;
}

.gs-note {
  font-size: 11.5px;
  color: var(--muted);
}

.gs-body {
  padding: 16px;
  overflow-y: auto;
}

/* 設定值跟「套用」按鈕排一起，看得出那顆按鈕是套用哪一個 */
.gs-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gs-row .select,
.gs-row .seg {
  flex: 1;
}

.gs-row .note {
  flex: 1;
  margin: 0;
}

/* ---------------- 預覽 ---------------- */

.pv-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.72);
  display: grid;
  place-items: center;
  padding: 20px;
}

.pv-box {
  width: 100%;
  max-width: 1500px;
  height: 100%;
  max-height: 900px;
  background: var(--card, #fff);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pv-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.pv-head h3 {
  font-size: 15px;
  font-weight: 800;
}

.pv-note {
  font-size: 12px;
  color: var(--muted);
}

.pv-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  padding: 14px;
  background: var(--bg, #f1f5f9);
}

.pv-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 手機那一欄照手機的比例，不要被拉成寬螢幕 */
.pv-pane.phone {
  flex: none;
  width: 390px;
}

.pv-cap {
  font-size: 11px;
  font-weight: 800;
  color: var(--muted);
  flex: none;
}

.pv-pane iframe {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r);
  background: #0f172a;
}

.pv-wait {
  flex: 1;
  display: grid;
  place-items: center;
  border: 1px dashed var(--line);
  border-radius: var(--r);
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .pv-pane.phone {
    width: 300px;
  }
}

.appbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
  height: 53px;
}

.title-edit {
  border: none;
  background: transparent;
  font-size: 15px;
  font-weight: 800;
  outline: none;
  padding: 5px 8px;
  border-radius: 7px;
  min-width: 120px;
  max-width: 340px;
  flex: 1;
}

.title-edit:hover {
  background: var(--line-2);
}

.title-edit:focus {
  background: #fff;
  box-shadow: 0 0 0 2px var(--brand);
}

.save-state {
  font-size: 12px;
  color: var(--ink-4);
  font-weight: 700;
  min-width: 58px;
}

.save-state.failed {
  color: var(--bad);
}

.editor {
  display: grid;
  grid-template-columns: 232px 1fr 300px;
  height: calc(100dvh - 53px);
  overflow: hidden;
}

.rail {
  border-right: 1px solid var(--line);
  background: #fbfcfe;
  overflow-y: auto;
  padding: 12px;
  /* sticky 的子元素不能被父層裁掉 */
  overflow-x: clip;
}

/*
 * 釘在左欄頂端：題目一多的時候，不該為了新增一頁還要先滑到最上面。
 * 底下墊一層底色，捲動時投影片才不會從按鈕後面透出來。
 */
.rail-add {
  position: sticky;
  top: 0;
  z-index: 2;
  width: 100%;
  border: 1px dashed #c7cdd8;
  background: #fff;
  border-radius: var(--r);
  padding: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-3);
  cursor: pointer;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: 0 0 0 8px #fbfcfe, 0 6px 10px -6px rgba(15, 23, 42, 0.18);
}

.rail-add:hover {
  border-color: var(--brand);
  color: var(--brand-600);
  background: var(--brand-soft);
}

.thumb {
  position: relative;
  display: flex;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: var(--r);
  margin-bottom: 8px;
  cursor: grab;
  color: var(--ink-3);
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
}

.thumb:active {
  cursor: grabbing;
}

/* 正在被拖的那一張淡掉，看得出來「它現在不在原位」 */
.thumb.is-dragging {
  opacity: 0.4;
}

/*
 * 放開會落在哪裡：用上緣一條線標出來。
 * 整塊變色的話會跟「目前選中」（.on）搞混。
 */
.thumb.drop-here {
  border-color: var(--brand);
}

.thumb.drop-here::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -5px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand);
}

.thumb:hover {
  border-color: #c7cdd8;
}

.thumb.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}

.thumb.warn {
  border-color: #fbbf24;
  background: #fffbeb;
}

.thumb .idx {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-4);
  width: 12px;
  flex: none;
}

.thumb .tx {
  flex: 1;
  min-width: 0;
}

.thumb .tt {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.thumb .ty {
  font-size: 10px;
  color: var(--ink-4);
  font-weight: 700;
  margin-top: 3px;
}

.thumb .tools {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 1px;
  background: #fff;
  border-radius: 6px;
  padding: 2px;
  box-shadow: var(--sh-1);
}

.thumb:hover .tools {
  display: flex;
}

.thumb .tools button {
  border: none;
  background: none;
  cursor: pointer;
  padding: 3px;
  color: var(--ink-4);
  border-radius: 4px;
  line-height: 0;
}

.thumb .tools button:hover:not(:disabled) {
  background: var(--line-2);
  color: var(--ink);
}

.thumb .tools button:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.thumb .tools button.del:hover {
  background: var(--bad-soft);
  color: var(--bad);
}

.stage {
  overflow-y: auto;
  padding: 26px 30px 60px;
  background: var(--bg);
}

.edit-box {
  max-width: 720px;
  margin: 0 auto;
}

.q-input {
  width: 100%;
  border: none;
  border-bottom: 2px solid var(--line);
  background: transparent;
  font-size: 24px;
  font-weight: 800;
  padding: 8px 2px 12px;
  outline: none;
  letter-spacing: -0.02em;
  line-height: 1.4;
  resize: none;
  font-family: inherit;
  field-sizing: content;
}

.q-input:focus {
  border-color: var(--brand);
}

.q-input::placeholder {
  color: #cbd5e1;
}

.sec {
  margin-top: 26px;
}

.sec-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--ink-3);
  letter-spacing: 0.05em;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 8px 10px 8px 0;
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

/* 握把平常很淡，滑過整列才浮出來 —— 不要跟選項內容搶注意力 */
.opt-grip {
  border: none;
  background: transparent;
  color: var(--ink-4);
  padding: 0;
  cursor: grab;
  opacity: 0.3;
  flex: none;
  display: grid;
  place-items: center;
  transition: opacity 0.15s, color 0.15s;
}

.opt-row:hover .opt-grip {
  opacity: 0.75;
}

.opt-grip:hover {
  opacity: 1;
  color: var(--brand-600);
}

.opt-grip:active {
  cursor: grabbing;
}

.opt-dragging {
  opacity: 0.4;
}

/* 放開會落在這一列 */
.opt-over {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-soft);
}

.opt-row:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.opt-row.is-correct {
  border-color: #86efac;
  background: #f0fdf4;
}

.opt-row .swatch {
  width: 6px;
  align-self: stretch;
  border-radius: var(--r) 0 0 var(--r);
  flex: none;
  margin: -8px 0;
}

.opt-row .shape {
  opacity: 0.6;
}

.opt-main {
  flex: 1;
  min-width: 0;
}

.opt-main input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-weight: 600;
}

.correct-btn {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--line);
  background: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: transparent;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.correct-btn:hover {
  border-color: #86efac;
  color: #bbf7d0;
}

.correct-btn.on {
  background: var(--ok);
  border-color: var(--ok);
  color: #fff;
}

.icon-x {
  flex: none;
  border: none;
  background: none;
  color: var(--ink-4);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  line-height: 0;
}

.icon-x:hover:not(:disabled) {
  background: var(--bad-soft);
  color: var(--bad);
}

.icon-x:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.add-row {
  border: 1px dashed #c7cdd8;
  background: #fff;
  border-radius: var(--r);
  padding: 9px;
  width: 100%;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-3);
  cursor: pointer;
}

.add-row:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand-600);
  background: var(--brand-soft);
}

.add-row:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pair-row,
.ord-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.pair-row .n,
.ord-row .n {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  display: grid;
  place-items: center;
  flex: none;
}

.pair-row .n {
  background: var(--line-2);
  color: var(--ink-3);
}

.ord-row .n {
  background: var(--brand-soft);
  color: var(--brand-700);
}

.pair-row .arrow {
  color: var(--ink-4);
  flex: none;
}

.cat-n {
  color: #fff !important;
}

.cat-select {
  width: 150px;
  flex: none;
  border-width: 2px;
  font-weight: 700;
}

.ord-row .mv {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
}

.ord-row .mv button {
  width: 24px;
  height: 15px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink-3);
  line-height: 0;
  padding: 0;
  display: grid;
  place-items: center;
}

.ord-row .mv button:hover:not(:disabled) {
  background: var(--line-2);
}

.ord-row .mv button:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.hint-box {
  background: var(--brand-soft);
  border: 1px solid #c7d2fe;
  border-radius: var(--r);
  padding: 11px 13px;
  font-size: 12.5px;
  color: var(--brand-700);
  line-height: 1.6;
  font-weight: 600;
}

.warn-box {
  background: var(--warn-soft);
  border: 1px solid #fcd34d;
  border-radius: var(--r);
  padding: 11px 13px;
  font-size: 12.5px;
  color: #92400e;
  line-height: 1.6;
  font-weight: 600;
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.side {
  border-left: 1px solid var(--line);
  background: #fff;
  overflow-y: auto;
  padding: 20px;
}

.side h3 {
  font-size: 13px;
  font-weight: 800;
  color: var(--ink-3);
  letter-spacing: 0.05em;
  margin-bottom: 14px;
}

.type-btn {
  justify-content: space-between;
  margin-bottom: 16px;
}

.type-btn .tl {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink);
}

.type-btn .tr {
  color: var(--ink-4);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.note {
  font-size: 11.5px;
  color: var(--ink-4);
  line-height: 1.6;
  margin-top: 6px;
  font-weight: 600;
}

.note .link {
  color: var(--brand-600);
  text-decoration: underline;
}

.seg {
  display: flex;
  background: var(--line-2);
  border-radius: var(--r);
  padding: 3px;
  gap: 3px;
}

.seg button {
  flex: 1;
  border: none;
  background: none;
  border-radius: 9px;
  padding: 7px 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-3);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.seg button.on {
  background: #fff;
  color: var(--ink);
  box-shadow: var(--sh-1);
}

.mb {
  margin-bottom: 12px;
}

.divider {
  height: 1px;
  background: var(--line);
  margin: 20px 0;
}

.themes {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

/* ---------------- 背景設定 ---------------- */

.bg-preview {
  position: relative;
  height: 108px;
  border-radius: var(--r);
  overflow: hidden;
  border: 1px solid var(--line);
  margin-bottom: 8px;
  background: var(--t-bg);
}

.bg-preview .bg-layer,
.bg-preview .bg-scrim {
  position: absolute;
}

.bg-sample {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--t-ink);
}

.bg-sample b {
  font-size: 15px;
  font-weight: 900;
}

.bg-sample span {
  font-size: 11px;
  color: var(--t-muted);
  font-weight: 600;
}

.bg-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.bg-acts {
  display: flex;
  gap: 5px;
}

.bg-acts .btn {
  flex: 1;
  justify-content: center;
}

.bg-acts .danger {
  flex: none;
}

.bg-acts .danger:hover {
  background: var(--bad-soft);
  border-color: #fca5a5;
  color: var(--bad);
}

.auto-cover {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-4);
}

.auto-cover img {
  width: 56px;
  height: 40px;
  object-fit: contain;
  border-radius: var(--r-sm);
  background: var(--line-2);
  border: 1px solid var(--line);
  flex: none;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-3);
}

.slider-row input[type='range'] {
  flex: 1;
  accent-color: var(--brand);
}

.slider-row b {
  width: 38px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}

/* ---------------- 音檔 ---------------- */

.audio-box {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 12px;
  background: #fff;
}

.audio-box audio {
  width: 100%;
  display: block;
}

.audio-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

/* 用外部網址時標一下，讓人知道這個檔案不在自己手上 */
.ext-note {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 800;
  color: var(--muted);
}

.audio-drop .url-link {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--brand);
  text-decoration: underline;
  font-weight: 700;
}

.audio-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 22px 14px;
}

.audio-drop small {
  font-size: 11px;
  color: var(--ink-4);
  font-weight: 600;
}

.audio-box .danger:hover {
  background: var(--bad-soft);
  border-color: #fca5a5;
  color: var(--bad);
}

/* ---------------- 自訂表情符號 ---------------- */

.react-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.react-cell {
  position: relative;
}

.react-cell img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--line-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 4px;
}

.react-label {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  color: var(--ink-3);
  outline: none;
  padding: 3px 0 0;
}

.react-label:focus {
  color: var(--ink);
}

.react-cell .chip-x {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: none;
  background: var(--ink-2);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  box-shadow: var(--sh-1);
}

.react-cell .chip-x:hover {
  background: var(--bad);
}

/* ---------------- 數字／評分題 ---------------- */

.num-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.num-grid .label {
  margin-bottom: 4px;
}

.theme-dot {
  aspect-ratio: 1;
  border-radius: 9px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.12s;
}

.theme-dot:hover {
  transform: scale(1.1);
}

.theme-dot.on {
  border-color: var(--ink);
  box-shadow: 0 0 0 2px #fff inset;
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  place-items: center;
  padding: 20px;
  backdrop-filter: blur(2px);
}

.modal-card {
  background: #fff;
  border-radius: var(--r-xl);
  padding: 24px;
  width: 100%;
  max-width: 620px;
  max-height: 86dvh;
  overflow-y: auto;
  box-shadow: var(--sh-3);
}

.modal-card h2 {
  font-size: 19px;
  font-weight: 800;
  margin-bottom: 4px;
}

.modal-card .sub {
  color: var(--ink-3);
  font-size: 13px;
  margin-bottom: 18px;
}

.group-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-4);
  letter-spacing: 0.06em;
  margin: 16px 0 8px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 9px;
}

.type-card {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: var(--r);
  padding: 13px;
  text-align: left;
  cursor: pointer;
  color: var(--brand);
  transition: border-color 0.15s, background 0.15s, transform 0.12s;
}

.type-card:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
  transform: translateY(-1px);
}

.type-card .nm {
  font-size: 13.5px;
  font-weight: 800;
  margin: 6px 0 3px;
  color: var(--ink);
}

.type-card .ds {
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.45;
  font-weight: 600;
}

@media (max-width: 1080px) {
  .editor {
    grid-template-columns: 190px 1fr;
  }

  .side {
    display: none;
  }
}
</style>
