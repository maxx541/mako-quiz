<script setup lang="ts">
useHead({ title: '播放中 · Makoquiz' })

const route = useRoute()
const id = String(route.query.id || '')

/**
 * 預覽模式：編輯器把這一頁塞在 iframe 裡，好讓作者一眼看到主持端和手機端。
 *
 * 房號是這一頁開場才拿到的，編輯器沒辦法先知道，所以拿到之後 postMessage
 * 告訴它，它才有辦法把另一個 iframe 指到對應的 /play。
 * 關閉預覽時編輯器會回傳一則 ql:end，這一場就跟著收掉，不留垃圾場次。
 */
const isPreview = route.query.preview === '1'
/** 預覽時直接跳到編輯器正在編輯的那一頁（-1 = 從大廳開始） */
const previewStart = isPreview ? Number(route.query.start ?? -1) : -1

const view = ref<any>(null)
const qr = ref('')
const fatal = ref('')
const qaOpen = ref(false)

const socket = useSocket()
const { left, start, clear } = useCountdown()

const slide = computed(() => view.value?.slide)
const results = computed(() => view.value?.results)
const revealed = computed(() => view.value?.state === 'results')
const bg = computed(() => backgroundLayers(view.value?.background))
const RESUME_KEY = 'ql_host_' + id

/* ---------------- 一列一項的題型（配對題、順序題） ---------------- */

/**
 * 這兩種題型的大螢幕版面一樣：.p-rows 一列一項，可以帶縮圖。
 *
 * 有圖而且超過 4 項就排成兩欄。量過：1366x768 的投影機，列表區只有 628px 高，
 * 8 項排一欄的話每張圖只剩 40px —— 「看圖配對／看圖排序」的圖小成那樣就等於沒有圖。
 * 兩欄變成 4 列，同樣的高度每張圖可以放到兩倍大。
 * 沒有圖就維持一欄：純文字本來就不佔高度，排兩欄反而難讀。
 *
 * 縮圖高度看的是「排完之後有幾列」，不是有幾項。
 */
function rowsLayout(n: number, hasImg: boolean) {
  const twoCol = hasImg && n > 4
  const rows = twoCol ? Math.ceil(n / 2) : n
  return { twoCol, imgH: !n ? 0 : rows <= 2 ? 104 : rows === 3 ? 92 : 84 }
}

const pairLayout = computed(() =>
  rowsLayout(
    slide.value?.pairs?.length || 0,
    (slide.value?.pairs || []).some((p: any) => p.leftImage || p.rightImage)
  )
)

/**
 * 配對題的列很窄（編號＋小圖＋箭頭＋問號），撐滿整個寬度的話右邊會空一大片。
 * 有題目圖的話就把它挪到右邊填掉那塊空白，列縮到左邊貼齊內容。
 *
 * 只在「列本來就沒填滿」的時候這樣做：已經排成兩欄的（>4 組帶圖）本來就佔滿寬度，
 * 再切一半給題目圖只會把列擠爛。
 */
const matchSplit = computed(
  () => slide.value?.type === 'match' && !!slide.value?.image && !pairLayout.value.twoCol
)

const orderLayout = computed(() =>
  rowsLayout(slide.value?.items?.length || 0, (slide.value?.items || []).some((i: any) => i.image))
)

/** 作答中大螢幕列出打亂的項目（item-pool），那裡是自由換行，只要縮圖大小 */
const poolImgH = computed(() => {
  const n = slide.value?.displayItems?.length || 0
  return n <= 4 ? 132 : n <= 6 ? 112 : 92
})

/**
 * 分類題的項目池比順序題的小一號：
 * 這一頁的下半部還要留給分類欄，池子不能把整個舞台吃掉。
 */
const catPoolImgH = computed(() => {
  const n = slide.value?.displayItems?.length || 0
  return n <= 4 ? 96 : n <= 6 ? 80 : 64
})

/* ---------------- 音樂題播放 ---------------- */

const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)

function toggleAudio() {
  const el = audioEl.value
  if (!el) return
  if (el.paused) el.play().catch(() => toast('瀏覽器擋下自動播放，請再按一次', 'bad'))
  else el.pause()
}

function restartAudio() {
  const el = audioEl.value
  if (!el) return
  el.currentTime = Number(slide.value?.audioStart) || 0
  el.play().catch(() => {})
}

/* ---------------- 大廳音樂 ---------------- */

const lobbyAudioEl = ref<HTMLAudioElement | null>(null)
const lobbyPlaying = ref(false)

function toggleLobbyMusic() {
  const el = lobbyAudioEl.value
  if (!el) return
  if (el.paused) el.play().catch(() => toast('瀏覽器擋下自動播放，請再按一次', 'bad'))
  else el.pause()
}

/* ---------------- 作答音樂（整場的背景音樂） ---------------- */

const quizAudioEl = ref<HTMLAudioElement | null>(null)
const quizPlaying = ref(false)
/** 主持人自己按了暫停就別再自動接回去，不然每換一頁又響起來 */
const quizMuted = ref(false)

/**
 * 什麼時候該有背景音樂：
 * - 大廳有自己的音樂，別搶
 * - 音樂題自己就有音檔，背景音樂要讓路（不管主持人什麼時候按播放，整頁都讓）
 * - 結束的頒獎畫面留給掌聲
 */
const quizMusicWanted = computed(
  () =>
    !!view.value?.quizMusic &&
    ['live', 'results', 'leaderboard'].includes(view.value?.state) &&
    slide.value?.type !== 'music'
)

function toggleQuizMusic() {
  const el = quizAudioEl.value
  if (!el) return
  if (el.paused) {
    quizMuted.value = false
    el.play().catch(() => toast('瀏覽器擋下自動播放，請再按一次', 'bad'))
  } else {
    quizMuted.value = true
    el.pause()
  }
}

watch(
  [quizMusicWanted, () => view.value?.quizMusicVolume],
  async () => {
    await nextTick()
    const el = quizAudioEl.value
    if (!el) return
    el.volume = Math.min(100, Math.max(0, Number(view.value?.quizMusicVolume ?? 35))) / 100
    if (!quizMusicWanted.value) el.pause()
    else if (!quizMuted.value) el.play().catch(() => {})
  },
  { immediate: true }
)

/*
 * 換到音樂題就自動從設定的秒數開始播。
 *
 * 這裡一定要用「陣列的 getter」而不是「回傳陣列的 getter」：
 * watch(() => [a, b]) 每次都回傳一個新陣列，Vue 只會拿新舊陣列比對參考（Object.is），
 * 永遠不相等 → 只要 view 被換掉（每有一個人作答就會收到 host:sync）callback 就會跑，
 * 音樂就被 currentTime = audioStart 拉回開頭重播。
 * 寫成 watch([() => a, () => b]) 才會逐項比對，真的變了才觸發。
 */
watch(
  [() => slide.value?.id, () => view.value?.state],
  async () => {
    await nextTick()
    const el = audioEl.value
    if (!el) return
    if (slide.value?.type === 'music' && view.value?.state === 'live' && slide.value.autoPlay) {
      el.currentTime = Number(slide.value.audioStart) || 0
      el.play().catch(() => {
        /* 瀏覽器擋自動播放時，主持人自己按播放鍵 */
      })
    } else {
      el.pause()
    }
  }
)

/* ---------------- 按鈕音效 ---------------- */

/*
 * 音效檔放在 data/sounds/，檔名固定（advance / reveal / back / stage / addtime / leaderboard）。
 * 這裡只問伺服器「哪些真的存在」，沒放的就不播 —— 不會有一排 404。
 * 換素材不用改這裡，也不用重新 build，換檔案重新整理就好。
 */
const sounds = ref<Record<string, string>>({})
const sfx = new Map<string, HTMLAudioElement>()

async function loadSounds() {
  try {
    const res = await $fetch<{ sounds: Record<string, string> }>('/api/sounds')
    sounds.value = res.sounds || {}
    for (const [action, url] of Object.entries(sounds.value)) {
      const a = new Audio(url)
      a.preload = 'auto'
      sfx.set(action, a)
    }
  } catch {
    /* 沒有音效不影響主持，安靜就好 */
  }
}

function playSfx(action: string) {
  const el = sfx.get(action)
  if (!el) return
  // 連按時要能重疊：同一個 Audio 物件重播會把前一次切掉，所以複製一份來播
  const one = el.cloneNode() as HTMLAudioElement
  one.play().catch(() => {
    /* 瀏覽器擋自動播放時就算了，按鈕本身還是有作用 */
  })
}

/* ---------------- 連線 ---------------- */

onMounted(() => {
  if (!auth.token) return auth.gotoLogin()
  loadSounds()
  if (!id) return (fatal.value = '缺少簡報 ID')

  socket.on('connect', () => {
    const saved = sessionStorage.getItem(RESUME_KEY)
    const done = (res: any) => {
      if (!res || res.error) {
        if (saved) {
          // 舊場次過期了就重開一場
          sessionStorage.removeItem(RESUME_KEY)
          return socket.emit('host:open', { presentationId: id, token: auth.token, origin: location.origin }, done)
        }
        fatal.value = res?.error || '無法建立場次'
        return
      }
      qr.value = res.qr || qr.value
      if (!isPreview) sessionStorage.setItem(RESUME_KEY, res.code)
      apply(res.view)
      if (isPreview) {
        parent.postMessage({ type: 'ql:code', code: res.code }, location.origin)
        // 直接跳到編輯器正在編輯的那一頁（越界就留在大廳，交給 server 的 goto 夾範圍反而會 end 掉場次）
        if (previewStart >= 0 && previewStart < res.view.total) act('goto', { index: previewStart })
      }
    }
    // 預覽一律開新的一場，不要去接編輯器上一次留下的舊場次
    if (saved && !isPreview) socket.emit('host:resume', { code: saved, token: auth.token }, done)
    else socket.emit('host:open', { presentationId: id, token: auth.token, origin: location.origin }, done)
  })

  socket.on('host:sync', apply)
  socket.on('disconnect', () => toast('連線中斷，重新連線中…', 'bad'))
  window.addEventListener('keydown', onKey)
  if (isPreview) window.addEventListener('message', onPreviewMsg)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('message', onPreviewMsg)
})

/** 編輯器關掉預覽時把這一場收乾淨 */
function onPreviewMsg(e: MessageEvent) {
  if (e.origin !== location.origin || e.data?.type !== 'ql:end') return
  act('end')
}

function apply(v: any) {
  view.value = v
  // 場次一結束就把代碼丟掉，否則回後台再按「播放」會被接回這個已結束的房間
  if (v.state === 'ended') sessionStorage.removeItem(RESUME_KEY)
  if (v.state === 'live' && v.endsAt && !v.locked) start(v.endsAt, v.serverNow)
  else clear()
  // 離開大廳時大廳音樂的 <audio> 會被卸載、自動停播，但按鈕狀態要跟著歸零
  // （卸載不一定會觸發 pause 事件），不然回到大廳時按鈕會顯示成「暫停中」
  if (v.state !== 'lobby') lobbyPlaying.value = false
}

const act = (action: string, payload?: any) =>
  socket.emit('host:action', { action, payload }, (r: any) => r?.error && toast(r.error, 'bad'))

/** 按鈕：先出聲再送出動作 */
function actSfx(action: string, sfxName: string, payload?: any) {
  playSfx(sfxName)
  act(action, payload)
}

/**
 * 主要按鈕會依狀態做不同的事，音效也跟著分：
 * 「公布答案」是整場的重頭戲，值得有自己的聲音；沒放 reveal.* 就退回 advance.*。
 */
function mainAct() {
  const willReveal = view.value?.state === 'live' && !['content', 'qa'].includes(slide.value?.type)
  playSfx(willReveal && sfx.has('reveal') ? 'reveal' : 'advance')
  act('advance')
}

/* ---------------- 控制列 ---------------- */

/**
 * 主要按鈕一路走完流程：開始 → 公布答案 → 排行榜 → 下一題。
 * 「公布答案」只有這一顆，時間到也不會自動公布，一律等主持人按。
 */
const mainLabel = computed(() => {
  const v = view.value
  if (!v) return '…'
  const s = v.slide
  switch (v.state) {
    case 'lobby':
      return '開始活動'
    case 'live':
      return !s || s.type === 'content' || s.type === 'qa' ? '下一頁' : '公布答案'
    case 'results':
      return advanceIsBoard.value ? '看排行榜' : '下一題'
    case 'leaderboard':
      return '下一題'
    default:
      return '已結束'
  }
})

const advanceIsBoard = computed(
  () => view.value?.state === 'results' && slide.value?.graded && view.value?.settings.showLeaderboard !== false
)

const timerRatio = computed(() => {
  const total = (slide.value?.timeLimit || 0) * 1000
  return left.value === null || !total ? null : Math.max(0, Math.min(1, left.value / total))
})
const secsLeft = computed(() => (left.value === null ? null : Math.ceil(left.value / 1000)))
const RING = 2 * Math.PI * 54

const showAddTime = computed(() => view.value?.state === 'live' && (view.value?.endsAt || view.value?.locked))
/** 分階段題型還沒揭完時，主持人可以手動加速 */
const showNextStage = computed(
  () => view.value?.state === 'live' && STAGED_TYPES.includes(slide.value?.type) && view.value.stage < view.value.stages - 1
)
const showBoardBtn = computed(
  () => view.value && view.value.index >= 0 && !advanceIsBoard.value && !['lobby', 'leaderboard', 'ended'].includes(view.value.state)
)

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.matches?.('input, textarea')) return
  // 鍵盤只是同一顆按鈕的捷徑，音效當然也要一樣
  if ([' ', 'ArrowRight', 'PageDown', 'Enter'].includes(e.key)) {
    e.preventDefault()
    mainAct()
  } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
    e.preventDefault()
    actSfx('back', 'back')
  } else if (e.key.toLowerCase() === 'f') toggleFull()
  else if (e.key.toLowerCase() === 'q') qaOpen.value = !qaOpen.value
}

const toggleFull = () =>
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})

async function endSession() {
  const yes = await confirmDialog({
    title: '結束這場活動？',
    message: '參與者會看到最終排名，房間代碼將失效。',
    okText: '結束活動',
    danger: true,
  })
  if (yes) act('end')
}

async function kick(p: any) {
  const yes = await confirmDialog({ title: `把「${p.name}」移出房間？`, okText: '移出', danger: true })
  if (yes) act('kick', { playerId: p.id })
}

/* ---------------- 頒獎台 ---------------- */

/** 前三名，排成「2 1 3」讓第一名在中間 */
const podium3 = computed(() => {
  const p = view.value?.players ?? []
  const at = (rank: number) => p.find((x: any) => x.rank === rank) || { id: 'empty' + rank, rank, name: '', score: 0 }
  return [at(2), at(1), at(3)]
})

const rest = computed(() => (view.value?.players ?? []).filter((p: any) => p.rank > 3).slice(0, 7))

/**
 * 逐名揭曉：第三名 → 第二名 → 第一名 → 其餘名次。
 *
 * 只有最後的「結束」畫面值得吊胃口；每一題中間的排行榜要是也停四秒，
 * 主持人一場下來會被拖死，所以那裡幾乎是立刻全開。
 */
const podiumStep = ref(0)
const onBoard = computed(() => ['leaderboard', 'ended'].includes(view.value?.state))
let podiumTimers: any[] = []

function clearPodium() {
  podiumTimers.forEach(clearTimeout)
  podiumTimers = []
}

function skipPodium() {
  clearPodium()
  podiumStep.value = 4
}

watch(
  [onBoard, () => view.value?.state],
  () => {
    clearPodium()
    if (!onBoard.value) return (podiumStep.value = 0)
    const beats = view.value.state === 'ended' ? [700, 1900, 3100, 4000] : [80, 200, 320, 440]
    podiumStep.value = 0
    beats.forEach((ms, i) => podiumTimers.push(setTimeout(() => (podiumStep.value = i + 1), ms)))
  },
  { immediate: true }
)

onBeforeUnmount(clearPodium)

/* ---------------- 排行榜圖片 ---------------- */

/**
 * 把最終排行榜畫成一張直式 PNG，方便直接丟到群組分享。
 * 用 canvas 自己畫，不依賴任何截圖套件。
 */
async function downloadBoardImage() {
  try {
    const players = view.value.players as any[]

    /*
     * 先把會用到的頭像載進來 —— canvas 只能畫「已經載好」的圖，
     * 沒先等它就 drawImage 會畫到空白。頭像都是同源的 /uploads/…（或 data:），
     * 不會污染 canvas，所以之後照樣 toBlob 得出來。載不到的就回 null，退回文字圓圈。
     */
    const drawn = players.slice(0, 10)
    const avatarImgs = new Map<string, HTMLImageElement>()
    await Promise.all(
      drawn.map(
        (p) =>
          new Promise<void>((resolve) => {
            if (!p.avatar) return resolve()
            const img = new Image()
            img.onload = () => {
              avatarImgs.set(p.id, img)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = p.avatar
          })
      )
    )

    const dpr = 2
    const W = 720
    const rowH = 84
    const headH = 150 // 標題區
    const podH = 360 // 頒獎台
    const footH = 60
    const listH = Math.max(0, Math.min(players.length, 10) - 3) * rowH

    const contentH = headH + (players.length ? podH : 0) + listH
    // 人少的時候內容撐不滿，但輸出一定要是直式（要拿去分享的），所以給一個最低高度，
    // 然後把內容整塊垂直置中，不要讓下半部空一大片。
    const H = Math.max(contentH + footH + 60, Math.round(W * 1.45))
    const top = Math.max(20, (H - footH - contentH) / 2)

    const c = document.createElement('canvas')
    c.width = W * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)

    const font = (size: number, weight = 700) =>
      `${weight} ${size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`
    const MEDAL = ['#facc15', '#cbd5e1', '#d97706']
    const INK = '#f1f5f9'
    const MUTED = 'rgba(241,245,249,0.55)'

    // 底：跟著簡報主題的純色
    const themeBg: Record<string, string> = {
      slate: '#0f172a',
      graphite: '#18181b',
      navy: '#0b1f3a',
      plum: '#1e1030',
      forest: '#0b2a22',
      paper: '#1e293b', // 淺色主題的圖片還是用深色，分享出去比較好看
    }
    g.fillStyle = themeBg[view.value.theme] || '#0f172a'
    g.fillRect(0, 0, W, H)

    // 標題
    g.textAlign = 'center'
    g.fillStyle = MUTED
    g.font = font(18, 700)
    g.fillText('最終排名', W / 2, top + 26)
    g.fillStyle = INK
    g.font = font(34, 900)
    const title = view.value.title.length > 20 ? view.value.title.slice(0, 19) + '…' : view.value.title
    g.fillText(title, W / 2, top + 70)
    g.fillStyle = MUTED
    g.font = font(15, 600)
    g.fillText(`${players.length} 位參與者 · 房間 ${view.value.code}`, W / 2, top + 100)

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      g.beginPath()
      g.roundRect(x, y, w, h, r)
      g.fill()
    }

    const ellipsis = (text: string, max: number) => {
      let t = text
      while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -1)
      return t === text ? t : t.slice(0, -1) + '…'
    }

    /**
     * 畫一個圓形頭像；有上傳圖就用圖（置中裁成正方形，不變形），
     * 沒有就退回底色圓圈＋名字第一個字。ring 是外圈顏色（頒獎台用獎牌色）。
     */
    const drawAvatar = (p: any, cx: number, cy: number, r: number, bg: string, ring?: string) => {
      const img = avatarImgs.get(p.id)
      g.save()
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.closePath()
      g.clip()
      if (img && img.naturalWidth) {
        const s = Math.min(img.naturalWidth, img.naturalHeight)
        g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2)
      } else {
        g.fillStyle = bg
        g.fillRect(cx - r, cy - r, r * 2, r * 2)
        g.fillStyle = '#0f172a'
        g.font = font(Math.round(r * 0.9), 900)
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText((p.name || '?').slice(0, 1).toUpperCase(), cx, cy + 1)
        g.textBaseline = 'alphabetic'
      }
      g.restore()
      if (ring) {
        g.lineWidth = 3
        g.strokeStyle = ring
        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.stroke()
      }
    }

    let y = top + headH

    // 頒獎台：2 1 3
    if (players.length) {
      const order = [2, 1, 3]
      const colW = 200
      const gap = 14
      const startX = (W - (colW * 3 + gap * 2)) / 2
      const blockH: Record<number, number> = { 1: 150, 2: 110, 3: 82 }
      const baseY = y + podH - 40

      order.forEach((rank, i) => {
        const p = players.find((x) => x.rank === rank)
        const x = startX + i * (colW + gap)
        const bh = blockH[rank]
        const topY = baseY - bh

        if (p) {
          // 頭像（有上傳就用圖，外圈套獎牌色）
          const cx = x + colW / 2
          const cy = topY - 92
          drawAvatar(p, cx, cy, 30, MEDAL[rank - 1], MEDAL[rank - 1])

          g.textAlign = 'center'
          g.fillStyle = INK
          g.font = font(17, 800)
          g.fillText(ellipsis(p.name, colW - 12), cx, topY - 38)
          g.fillStyle = MEDAL[rank - 1]
          g.font = font(21, 900)
          g.fillText(p.score.toLocaleString(), cx, topY - 14)
        }

        // 台座
        g.fillStyle = p ? MEDAL[rank - 1] : 'rgba(255,255,255,0.06)'
        roundRect(x, topY, colW, bh, 10)
        g.fillStyle = p ? 'rgba(15,23,42,0.72)' : MUTED
        g.font = font(44, 900)
        g.fillText(String(rank), x + colW / 2, topY + bh / 2 + 16)
      })
      y += podH
    }

    // 第 4 名之後
    const others = players.filter((p) => p.rank > 3).slice(0, 7)
    for (const p of others) {
      const midY = y + (rowH - 12) / 2
      g.fillStyle = 'rgba(255,255,255,0.06)'
      roundRect(40, y, W - 80, rowH - 12, 12)

      g.textAlign = 'center'
      g.fillStyle = MUTED
      g.font = font(20, 800)
      g.fillText(String(p.rank), 72, y + 44)

      // 頭像（有上傳就用圖，沒有就底色圓圈＋名字第一個字）
      drawAvatar(p, 116, midY, 18, 'rgba(255,255,255,0.14)')

      g.textAlign = 'left'
      g.fillStyle = INK
      g.font = font(19, 700)
      g.fillText(ellipsis(p.name, W - 330), 150, y + 44)

      g.textAlign = 'right'
      g.fillStyle = '#fde047'
      g.font = font(19, 900)
      g.fillText(p.score.toLocaleString(), W - 64, y + 44)
      y += rowH
    }

    // 頁尾
    g.textAlign = 'center'
    g.fillStyle = 'rgba(241,245,249,0.35)'
    g.font = font(13, 600)
    g.fillText('Makoquiz', W / 2, H - 30)

    // JPEG 沒有透明色，底色一定要自己先鋪滿（上面已經 fillRect 過整張），
    // 否則沒畫到的地方會變成黑色
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.92))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${view.value.title}-排行榜.jpg`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('排行榜圖片已下載', 'ok')
  } catch (err: any) {
    toast('產生圖片失敗：' + err.message, 'bad')
  }
}

/** 分類題每一欄的顏色（跟手機端的 CategorizeBoard 對齊） */
const CAT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']

/** 答題過程才縮在角落；大廳本來就有大張的，排行榜之後也不用再讓人加入 */
const showMiniQr = computed(() => ['live', 'results'].includes(view.value?.state))

const joinHost = computed(() => (view.value?.joinUrl || '').replace(/^https?:\/\//, '').replace(/\/\?c=\d+$/, ''))

/** 點一下就把「完整的 http 網址」複製起來，方便貼到聊天室給沒在現場的人 */
async function copyJoinUrl() {
  const url = view.value?.joinUrl
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    toast('已複製完整網址', 'ok')
  } catch {
    // clipboard API 在非 https 或舊瀏覽器可能被擋，退回用隱藏 textarea 複製
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {}
    document.body.removeChild(ta)
    toast(ok ? '已複製完整網址' : '複製失敗，請手動複製', ok ? 'ok' : 'bad')
  }
}
const cloudMax = computed(() => Math.max(...(results.value?.words?.map((w: any) => w.count) || [1]), 1))
const barMax = computed(() => Math.max(results.value?.total || 1, 1))
/** 測驗題等公布才顯示票數，投票類則即時顯示 */
const showCounts = computed(() => revealed.value || !slide.value?.graded)
</script>

<template>
  <div class="stage" :class="['theme-' + (view?.theme || 'slate'), { 'has-bg-image': !!bg, 'qr-corner': !!qr && showMiniQr }]">
    <template v-if="bg">
      <div class="bg-layer" :style="bg.image" />
      <div class="bg-scrim" :style="bg.scrim" />
    </template>

    <div v-if="fatal" class="stage-empty">
      <AppIcon name="alert" :size="56" :stroke="1.4" />
      <h2>{{ fatal }}</h2>
      <button class="ctrl-main" @click="navigateTo('/admin')">回到後台</button>
    </div>

    <template v-else-if="view">
      <header class="top">
        <h1>{{ view.title }}</h1>
        <div class="pill"><span class="live-dot" />房間 <b>{{ view.code }}</b></div>
        <div class="pill"><AppIcon name="users" :size="13" /> <b>{{ view.playerCount }}</b></div>
        <div class="spacer" />
        <button class="ghost-btn" :class="{ on: qaOpen }" @click="qaOpen = !qaOpen">
          <AppIcon name="hand" :size="13" /> 提問 <b>{{ view.qa.length }}</b>
        </button>
        <button class="ghost-btn" @click="toggleFull"><AppIcon name="maximize" :size="13" /> 全螢幕</button>
        <button class="ghost-btn" @click="endSession">結束</button>
      </header>

      <main class="canvas">
        <!-- 大廳 -->
        <div v-if="view.state === 'lobby'" class="lobby" :class="{ 'has-cover': !!view.cover }">
          <div>
            <h2 class="lobby-title">{{ view.title }}</h2>
            <div class="steps">
              <div class="jstep">
                <div class="n">1</div>
                <div>
                  <div class="t">用手機開啟網址</div>
                  <button class="v v-copy" type="button" :title="`點擊複製 ${view.joinUrl}`" @click="copyJoinUrl">
                    <span>{{ joinHost }}</span>
                    <AppIcon name="copy" :size="14" />
                  </button>
                </div>
              </div>
              <div class="jstep">
                <div class="n">2</div>
                <div>
                  <div class="t">輸入房間代碼</div>
                  <div class="v code">{{ view.code }}</div>
                </div>
              </div>
            </div>
            <div v-if="view.lobbyMusic" class="lobby-music">
              <button class="ghost-btn" :class="{ on: lobbyPlaying }" @click="toggleLobbyMusic">
                <AppIcon :name="lobbyPlaying ? 'pause' : 'play'" :size="14" />
                {{ lobbyPlaying ? '暫停音樂' : '播放音樂' }}
              </button>
              <audio
                ref="lobbyAudioEl"
                :src="view.lobbyMusic"
                loop
                preload="auto"
                @play="lobbyPlaying = true"
                @pause="lobbyPlaying = false"
              />
            </div>
            <div class="roster">
              <div class="roster-head">
                {{ view.playerCount ? `已加入 ${view.playerCount} 人` : '等待參與者加入…' }}
              </div>
              <div class="roster-list">
                <div v-for="p in view.players" :key="p.id" class="who-chip" :style="{ opacity: p.connected ? 1 : 0.45 }">
                  <img v-if="p.avatar" :src="p.avatar" alt="" class="who-avatar" />
                  {{ p.name }}
                  <button title="移除" @click="kick(p)"><AppIcon name="x" :size="11" /></button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="view.cover" class="lobby-cover">
            <img :src="view.cover" alt="" />
          </div>
          <div v-if="qr" class="qr-card">
            <img :src="qr" alt="加入用的 QR Code" />
            <div class="cap">掃描直接加入</div>
          </div>
        </div>

        <!-- 排行榜 / 結束：點畫面可以跳過揭曉動畫 -->
        <div v-else-if="['leaderboard', 'ended'].includes(view.state)" class="board" @click="skipPodium">
          <h2>
            <AppIcon :name="view.state === 'ended' ? 'flag' : 'trophy'" :size="30" :stroke="1.6" />
            {{ view.state === 'ended' ? '最終排名' : '排行榜' }}
          </h2>

          <template v-if="view.players.length">
            <!-- 前三名做成頒獎台：第一名最高、置中，由第三名開始逐名揭曉 -->
            <div class="podium-3">
              <div
                v-for="p in podium3"
                :key="p.id"
                class="pod"
                :class="['p' + p.rank, { empty: !p.name, shown: podiumStep >= 4 - p.rank }]"
              >
                <div class="pod-who">
                  <div class="pod-avatar" :class="'m' + p.rank">
                    <img v-if="p.avatar" :src="p.avatar" alt="" />
                    <template v-else>{{ (p.name || '').slice(0, 1).toUpperCase() }}</template>
                  </div>
                  <div class="pod-name">{{ p.name || '—' }}</div>
                  <div class="pod-score">{{ p.name ? p.score.toLocaleString() : '' }}</div>
                </div>
                <div class="pod-block" :class="'m' + p.rank">
                  <span class="pod-rank">{{ p.rank }}</span>
                </div>
              </div>
            </div>

            <!-- 第 4 名之後照常列表 -->
            <div v-if="rest.length" class="board-rows" :class="{ shown: podiumStep >= 4 }">
              <div v-for="(p, i) in rest" :key="p.id" class="brow" :style="{ transitionDelay: i * 0.05 + 's' }">
                <span class="rank-badge">{{ p.rank }}</span>
                <img v-if="p.avatar" :src="p.avatar" alt="" class="brow-avatar" />
                <div class="nm">{{ p.name }}</div>
                <div v-if="p.streak > 1" class="streak"><AppIcon name="flame" :size="13" /> {{ p.streak }} 連對</div>
                <div class="sc">{{ p.score.toLocaleString() }}</div>
              </div>
            </div>
          </template>
          <div v-else class="stage-empty"><p>還沒有人得分</p></div>

          <div v-if="view.state === 'ended'" class="end-acts">
            <button class="ghost-btn" @click="downloadBoardImage">
              <AppIcon name="download" :size="13" /> 下載排行榜圖片
            </button>
            <button class="ghost-btn" @click="navigateTo('/admin')">回到後台</button>
          </div>
        </div>

        <!-- 投影片 -->
        <div v-else-if="slide" class="q-wrap">
          <!-- 內容頁 -->
          <template v-if="slide.type === 'content'">
            <div class="q-meta">
              <span class="tag"><AppIcon name="file-text" :size="12" /> 內容頁</span>
            </div>
            <h2 class="q-title">{{ slide.title }}</h2>
            <img v-if="slide.image" :src="slide.image" alt="" class="q-img" />
            <div v-if="slide.body" class="q-body">{{ slide.body }}</div>
          </template>

          <template v-else>
            <div class="q-meta">
              <span class="tag"><AppIcon :name="TYPE_META[slide.type]?.icon" :size="12" /> {{ TYPE_META[slide.type]?.label }}</span>
              <span>第 {{ view.index + 1 }} / {{ view.total }} 題</span>
              <span v-if="slide.points === 'double'" class="tag">雙倍分數</span>
              <span v-if="slide.points === 'none'" class="tag">不計分</span>
              <span v-if="STAGED_TYPES.includes(slide.type)" class="tag stage-tag">
                <AppIcon name="layers" :size="11" />
                {{ slide.type === 'soup' ? `第 ${view.stage + 1} / ${view.stages} 條提示` : `第 ${view.stage + 1} / ${view.stages} 階段` }}
                <b v-if="slide.points !== 'none' && !revealed">· 現在答對 {{ view.stagePoints }}%</b>
              </span>
              <span v-else-if="slide.speedBonusOn && slide.timeLimit > 0 && slide.points !== 'none'" class="tag">
                <AppIcon name="clock" :size="11" /> 越快越高分
              </span>
              <span v-if="revealed" class="tag">已公布答案</span>
              <span v-else-if="view.locked" class="tag locked"><AppIcon name="lock" :size="11" /> 時間到，等你公布</span>
            </div>
            <h2 class="q-title">{{ slide.title }}</h2>

            <!-- 觀眾提問頁 -->
            <template v-if="slide.type === 'qa'">
              <div class="q-meta" style="margin-top: 14px">參與者可以用手機提問並按讚 · 目前 {{ view.qa.length }} 則</div>
              <div class="qa-stage">
                <div v-for="q in view.qa" :key="q.id" class="qa-card" :class="{ pinned: q.pinned, answered: q.answered }">
                  <div class="q">{{ q.text }}</div>
                  <div class="m">
                    <span class="v"><AppIcon name="chevron-up" :size="11" /> {{ q.votes }}</span>
                    <span>{{ q.author }}</span>
                    <span v-if="q.answered">· 已回答</span>
                  </div>
                </div>
                <div v-if="!view.qa.length" class="q-body full-span">還沒有人提問</div>
              </div>
            </template>

            <!-- 海龜湯：提示一條一條浮出來 -->
            <div v-else-if="slide.type === 'soup'" class="soup-stage">
              <ol class="soup-hints">
                <li v-for="(h, i) in slide.hints.slice(0, view.stage + 1)" :key="i" :class="{ latest: i === view.stage }">
                  <span class="hn">{{ i + 1 }}</span>
                  <span class="ht">{{ h.text }}</span>
                </li>
                <li v-for="i in Math.max(0, slide.hints.length - view.stage - 1)" :key="'x' + i" class="pending">
                  <span class="hn">{{ view.stage + 1 + i }}</span>
                  <span class="ht">？？？</span>
                </li>
              </ol>
              <div class="soup-side">
                <div v-if="slide.timeLimit > 0 && view.state === 'live' && !view.locked" class="ring small" :class="{ warn: timerRatio! <= 0.5 && timerRatio! > 0.2, danger: timerRatio! <= 0.2 }">
                  <svg viewBox="0 0 120 120">
                    <circle class="bg" cx="60" cy="60" r="54" />
                    <circle class="fg" cx="60" cy="60" r="54" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - (timerRatio ?? 0))" />
                  </svg>
                  <div class="val">{{ secsLeft ?? '–' }}</div>
                </div>
                <div class="count-box">
                  <b>{{ view.answeredCount }}<small v-if="!revealed"> / {{ view.connectedCount }}</small></b>
                  <span>{{ revealed ? '人已作答' : '人答了這條提示' }}</span>
                </div>
                <div v-if="!revealed" class="soup-wait">全部人答完就自動出下一條提示</div>
                <div class="stage-dots">
                  <i v-for="k in view.stages" :key="k" :class="{ on: k - 1 <= view.stage }" />
                </div>
                <div v-if="revealed" class="soup-answer">
                  <span class="lbl">正確答案</span>
                  <b>{{ (view.solution?.accepted || []).join(' / ') }}</b>
                </div>
              </div>
              <div v-if="revealed" class="soup-results">
                <div class="p-answers">
                  <div v-for="row in results.rows" :key="row.text" class="p-answer" :class="{ ok: row.correct }">
                    <AppIcon v-if="row.correct" name="check" :size="16" />
                    <span>{{ row.text }}</span>
                    <span class="n">{{ row.count }} 人</span>
                  </div>
                </div>
                <div class="q-body">{{ results.correctCount }}/{{ results.total }} 人猜中</div>
                <PeopleAnswers :people="results.people" />
              </div>
            </div>

            <!-- 猜圖題：圖是主角，佔滿整個舞台，選項縮到下面一排 -->
            <div v-else-if="slide.type === 'reveal'" class="reveal-stage">
              <div class="reveal-box">
                <RevealImage
                  v-if="slide.image"
                  :src="slide.image"
                  :seed="slide.id"
                  :stage="view.stage"
                  :stages="view.stages"
                  :mode="slide.revealMode || 'tiles'"
                  :rows="slide.grid?.rows || 5"
                  :cols="slide.grid?.cols || 7"
                  :tiles="slide.stageTiles || null"
                  :revealed="revealed"
                />
                <div v-else class="q-body center-text">這一題還沒設定圖片</div>
              </div>
              <div class="reveal-side">
                <div v-if="slide.timeLimit > 0 && view.state === 'live' && !view.locked" class="ring small" :class="{ warn: timerRatio! <= 0.5 && timerRatio! > 0.2, danger: timerRatio! <= 0.2 }">
                  <svg viewBox="0 0 120 120">
                    <circle class="bg" cx="60" cy="60" r="54" />
                    <circle class="fg" cx="60" cy="60" r="54" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - (timerRatio ?? 0))" />
                  </svg>
                  <div class="val">{{ secsLeft ?? '–' }}</div>
                </div>
                <div class="count-box">
                  <b>{{ view.answeredCount }}</b>
                  <span>人已作答</span>
                </div>
                <div class="stage-dots">
                  <i v-for="k in view.stages" :key="k" :class="{ on: k - 1 <= view.stage }" />
                </div>
              </div>
              <div class="reveal-opts">
                <div
                  v-for="(b, i) in results.bars"
                  :key="b.id"
                  class="p-opt compact"
                  :class="revealed && slide.graded ? (b.correct ? 'win' : 'dim') : ''"
                  :style="{ '--oc': b.color }"
                >
                  <i v-if="revealed" class="fill" :style="{ width: pct(b.count, barMax) + '%' }" />
                  <AppIcon :name="OPTION_SHAPES[i % OPTION_SHAPES.length]" :size="16" class="shape" />
                  <span class="tx">{{ b.text }}</span>
                  <span v-if="revealed" class="cnt"><b>{{ b.count }}</b></span>
                </div>
              </div>
            </div>

            <div v-else class="q-main" :class="{ 'with-explain': !!view.explain }">
              <div class="q-side">
                <div v-if="slide.timeLimit > 0 && view.state === 'live' && !view.locked" class="ring" :class="{ warn: timerRatio! <= 0.5 && timerRatio! > 0.2, danger: timerRatio! <= 0.2 }">
                  <svg viewBox="0 0 120 120">
                    <circle class="bg" cx="60" cy="60" r="54" />
                    <circle class="fg" cx="60" cy="60" r="54" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - (timerRatio ?? 0))" />
                  </svg>
                  <div class="val">{{ secsLeft ?? '–' }}</div>
                </div>
                <div v-else-if="view.locked && !revealed" class="locked-badge">
                  <AppIcon name="lock" :size="26" />
                  <span>時間到</span>
                </div>
                <div class="count-box">
                  <b>{{ view.answeredCount }}</b>
                  <span>{{ slide.type === 'open' ? '則回覆' : '人已作答' }}</span>
                </div>
              </div>

              <div class="q-content" :class="{ 'side-media': matchSplit }">
                <!-- 圖片吃剩下的空間就好，不要把播放器跟選項擠出畫面 -->
                <div v-if="slide.image" class="q-img-wrap">
                  <img :src="slide.image" alt="" class="q-img" />
                </div>

                <!-- 音樂題：大螢幕播放器 -->
                <div v-if="slide.type === 'music'" class="player">
                  <audio
                    ref="audioEl"
                    :src="slide.audio || undefined"
                    preload="auto"
                    @play="playing = true"
                    @pause="playing = false"
                    @ended="playing = false"
                  />
                  <button class="play-btn" :disabled="!slide.audio" @click="toggleAudio">
                    <AppIcon :name="playing ? 'pause' : 'play_circle'" :size="30" />
                  </button>
                  <div class="player-info">
                    <div class="wave" :class="{ on: playing }">
                      <i v-for="n in 24" :key="n" :style="{ animationDelay: n * 0.06 + 's' }" />
                    </div>
                    <div class="player-cap">
                      {{ slide.audio ? (playing ? '播放中…' : '已暫停') : '這一題還沒設定音檔' }}
                    </div>
                  </div>
                  <button class="ghost-btn" :disabled="!slide.audio" @click="restartAudio">
                    <AppIcon name="arrow-left" :size="13" /> 重播
                  </button>
                </div>

                <!-- 選擇題 -->
                <div v-if="CHOICE_TYPES.includes(slide.type)" class="p-opts" :class="{ one: slide.options.length <= 2 }">
                  <div
                    v-for="(b, i) in results.bars"
                    :key="b.id"
                    class="p-opt"
                    :class="revealed && slide.graded ? (b.correct ? 'win' : 'dim') : ''"
                    :style="{ '--oc': b.color }"
                  >
                    <i v-if="showCounts" class="fill" :style="{ width: pct(b.count, barMax) + '%' }" />
                    <img v-if="b.image" :src="b.image" alt="" class="p-opt-img" />
                    <AppIcon :name="OPTION_SHAPES[i % OPTION_SHAPES.length]" :size="20" class="shape" />
                    <span class="tx">{{ b.text }}</span>
                    <span v-if="showCounts" class="cnt">
                      <b>{{ b.count }}</b><span class="pc">{{ pct(b.count, results.total) }}%</span>
                    </span>
                    <AppIcon v-if="revealed && slide.graded && b.correct" name="check" :size="20" class="mark" />
                  </div>
                </div>

                <!-- 配對題 -->
                <div
                  v-else-if="slide.type === 'match'"
                  class="p-rows"
                  :class="{ 'two-col': pairLayout.twoCol }"
                  :style="{ '--pih': pairLayout.imgH + 'px' }"
                >
                  <template v-if="revealed">
                    <div v-for="row in results.rows" :key="row.id" class="p-row">
                      <i class="bar" :style="{ width: pct(row.count, results.total) + '%' }" />
                      <span class="cell">
                        <img v-if="row.leftImage" :src="row.leftImage" class="pimg" alt="" />
                        <span v-if="row.left">{{ row.left }}</span>
                      </span>
                      <AppIcon name="arrow-right" :size="16" class="arrow" />
                      <span class="cell right">
                        <img v-if="row.rightImage" :src="row.rightImage" class="pimg" alt="" />
                        <span v-if="row.right">{{ row.right }}</span>
                      </span>
                      <span class="hit">{{ row.count }}/{{ results.total }} 答對</span>
                    </div>
                  </template>
                  <template v-else>
                    <div v-for="(p, i) in slide.pairs" :key="p.id" class="p-row">
                      <span class="n">{{ i + 1 }}</span>
                      <span class="cell">
                        <img v-if="p.leftImage" :src="p.leftImage" class="pimg" alt="" />
                        <span v-if="p.left">{{ p.left }}</span>
                      </span>
                      <AppIcon name="arrow-right" :size="16" class="arrow" />
                      <span class="arrow">？</span>
                    </div>
                  </template>
                </div>

                <!-- 分類題：還沒公布時把待分類的項目列出來，台下才知道在分什麼 -->
                <div v-else-if="slide.type === 'categorize'" class="cat-stage">
                  <div v-if="!revealed && slide.displayItems?.length" class="item-pool" :style="{ '--poh': catPoolImgH + 'px' }">
                    <span v-for="it in slide.displayItems" :key="it.id" class="pool-chip" :class="{ 'has-img': !!it.image }">
                      <img v-if="it.image" :src="it.image" class="poimg" alt="" />
                      <span v-if="it.text">{{ it.text }}</span>
                    </span>
                  </div>
                  <div class="cat-cols">
                    <div v-for="(c, ci) in (revealed ? results.cols : slide.categories)" :key="c.id" class="cat-col" :style="{ '--cc': CAT_COLORS[ci % CAT_COLORS.length] }">
                      <div class="cat-col-name">{{ c.name }}</div>
                      <div class="cat-col-body">
                        <template v-if="revealed">
                          <div v-for="it in c.items" :key="it.id" class="cat-chip" :class="{ 'has-img': !!it.image }">
                            <i class="bar" :style="{ width: pct(it.count, results.total) + '%' }" />
                            <img v-if="it.image" :src="it.image" class="cimg" alt="" />
                            <span v-if="it.text">{{ it.text }}</span>
                            <b>{{ it.count }}/{{ results.total }}</b>
                          </div>
                        </template>
                        <span v-else class="cat-col-hint">？</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 順序題：displayItems 是打亂過的，直接照 slide.items 列就等於公布答案了 -->
                <div
                  v-else-if="slide.type === 'order'"
                  class="p-rows"
                  :class="{ 'two-col': revealed && orderLayout.twoCol }"
                  :style="{ '--pih': orderLayout.imgH + 'px' }"
                >
                  <template v-if="revealed">
                    <div v-for="row in results.rows" :key="row.id" class="p-row">
                      <i class="bar" :style="{ width: pct(row.count, results.total) + '%' }" />
                      <span class="n">{{ row.position }}</span>
                      <span class="cell right">
                        <img v-if="row.image" :src="row.image" class="pimg" alt="" />
                        <span v-if="row.text">{{ row.text }}</span>
                      </span>
                      <span class="hit">{{ row.count }}/{{ results.total }} 放對</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="item-pool big" :style="{ '--poh': poolImgH + 'px' }">
                      <span v-for="it in slide.displayItems" :key="it.id" class="pool-chip" :class="{ 'has-img': !!it.image }">
                        <img v-if="it.image" :src="it.image" class="poimg" alt="" />
                        <span v-if="it.text">{{ it.text }}</span>
                      </span>
                    </div>
                    <div class="q-body center-text">參與者正在手機上排列順序…</div>
                  </template>
                </div>

                <!-- 填空題 -->
                <template v-else-if="slide.type === 'type'">
                  <div v-if="!revealed" class="q-body center-text big">
                    {{ view.answeredCount ? `已有 ${view.answeredCount} 人送出答案` : '參與者正在輸入答案…' }}
                  </div>
                  <template v-else>
                    <div class="p-answers">
                      <div v-for="row in results.rows" :key="row.text" class="p-answer" :class="{ ok: row.correct }">
                        <i class="bar" :style="{ width: pct(row.count, results.total) + '%' }" />
                        <AppIcon v-if="row.correct" name="check" :size="16" />
                        <span>{{ row.text }}</span>
                        <span class="n">{{ row.count }} 人</span>
                      </div>
                    </div>
                    <div class="q-body">
                      正確答案：{{ (view.solution?.accepted || []).join(' / ') }}　·　{{ results.correctCount }}/{{ results.total }} 人答對
                    </div>
                    <PeopleAnswers :people="results.people" />
                  </template>
                </template>

                <!-- 複數答案：答對越多分越高，全部答出額外加分 -->
                <template v-else-if="slide.type === 'list'">
                  <div v-if="!revealed" class="q-body center-text big">
                    {{ view.answeredCount ? `已有 ${view.answeredCount} 人開始作答` : '參與者正在列出答案…' }}
                  </div>
                  <template v-else>
                    <div class="p-answers">
                      <div v-for="(row, i) in results.rows" :key="i" class="p-answer ok">
                        <i class="bar" :style="{ width: pct(row.count, results.total) + '%' }" />
                        <AppIcon name="check" :size="16" />
                        <span>{{ row.text }}</span>
                        <span class="n">{{ row.count }} 人答到</span>
                      </div>
                    </div>
                    <div class="q-body">
                      共 {{ results.groupTotal }} 個答案　·　{{ results.perfect }}/{{ results.total }} 人全部答出
                    </div>
                    <PeopleAnswers :people="results.people" list />
                  </template>
                </template>

                <!-- 數字題 -->
                <template v-else-if="slide.type === 'number'">
                  <div v-if="!revealed" class="q-body center-text big">
                    {{ view.answeredCount ? `已有 ${view.answeredCount} 人送出答案` : '參與者正在輸入數字…' }}
                  </div>
                  <template v-else>
                    <div class="num-answer">
                      <span class="lbl">正確答案</span>
                      <b>{{ results.answer.toLocaleString() }}{{ results.unit }}</b>
                    </div>
                    <div class="num-stats">
                      <div class="ns"><b>{{ results.exact }}</b><span>剛好猜中</span></div>
                      <div class="ns"><b>{{ results.avg !== null ? Math.round(results.avg).toLocaleString() : '—' }}</b><span>平均猜測</span></div>
                      <div class="ns"><b>{{ results.min !== null ? results.min.toLocaleString() : '—' }}</b><span>最小</span></div>
                      <div class="ns"><b>{{ results.max !== null ? results.max.toLocaleString() : '—' }}</b><span>最大</span></div>
                    </div>
                    <div v-if="results.closest.length" class="p-answers" style="margin-top: 14px">
                      <div v-for="(c, i) in results.closest" :key="i" class="p-answer" :class="{ ok: c.diff === 0 }">
                        <span class="rank-badge" :class="'r' + (i + 1)">{{ i + 1 }}</span>
                        <span>{{ c.name }}</span>
                        <span class="n">{{ c.value.toLocaleString() }}{{ results.unit }}（差 {{ c.diff.toLocaleString() }}）</span>
                      </div>
                    </div>
                    <PeopleAnswers :people="results.people" />
                  </template>
                </template>

                <!-- 評分題 -->
                <template v-else-if="slide.type === 'scale'">
                  <div class="scale-chart">
                    <div v-for="b in results.buckets" :key="b.value" class="sbar">
                      <div class="sbar-track">
                        <i :style="{ height: (results.total ? (b.count / Math.max(...results.buckets.map((x: any) => x.count), 1)) * 100 : 0) + '%' }" />
                      </div>
                      <div class="sbar-n">{{ b.count }}</div>
                      <div class="sbar-v">{{ b.value }}</div>
                    </div>
                  </div>
                  <div class="scale-foot">
                    <span>{{ results.minLabel }}</span>
                    <b v-if="results.avg !== null">平均 {{ results.avg.toFixed(2) }} 分</b>
                    <b v-else>還沒有人評分</b>
                    <span>{{ results.maxLabel }}</span>
                  </div>
                </template>

                <!-- 開放問題 -->
                <template v-else-if="slide.type === 'open'">
                  <div v-if="!results.total" class="q-body center-text">等待參與者回覆…</div>
                  <div v-else-if="results.display === 'list'" class="p-replies">
                    <div v-for="(t, i) in results.texts.slice(-24).reverse()" :key="i" class="p-reply">
                      <div class="who">{{ t.name }}</div>
                      <div class="txt">{{ t.text }}</div>
                    </div>
                  </div>
                  <div v-else class="p-cloud">
                    <span
                      v-for="(w, i) in results.words"
                      :key="w.text"
                      :style="{
                        fontSize: 20 + Math.round((w.count / cloudMax) * 58) + 'px',
                        color: OPTION_COLORS[i % OPTION_COLORS.length],
                        opacity: 0.5 + (w.count / cloudMax) * 0.5,
                      }"
                    >{{ w.text }}</span>
                  </div>
                </template>
              </div>

              <!-- 解說：公布答案後才出現在右邊 -->
              <aside v-if="view.explain" class="explain-panel">
                <div class="ep-head"><AppIcon name="info" :size="14" /> 解說</div>
                <img
                  v-if="view.explain.image"
                  :src="view.explain.image"
                  class="zoomable"
                  alt="解說圖片，點擊放大"
                  @click="openZoom(view.explain.image)"
                />
                <p v-if="view.explain.text">{{ view.explain.text }}</p>
              </aside>
            </div>
          </template>
        </div>
      </main>

      <footer class="controls">
        <button class="ghost-btn" :disabled="['lobby', 'ended'].includes(view.state)" title="上一步（←）" @click="actSfx('back', 'back')">
          <AppIcon name="arrow-left" :size="15" />
        </button>
        <button class="ctrl-main" :disabled="view.state === 'ended'" @click="mainAct">
          {{ mainLabel }}
          <AppIcon v-if="view.state !== 'ended'" :name="view.state === 'lobby' ? 'play' : 'arrow-right'" :size="14" />
        </button>
        <button v-if="showNextStage" class="ghost-btn" @click="actSfx('nextStage', 'stage')">
          <AppIcon name="layers" :size="13" />
          {{ slide?.type === 'soup' ? '給下一條提示' : '揭露下一階段' }}
        </button>
        <button v-if="showAddTime" class="ghost-btn" @click="actSfx('addTime', 'addtime', { seconds: 15 })">+15 秒</button>
        <button v-if="showBoardBtn" class="ghost-btn" @click="actSfx('leaderboard', 'leaderboard')">看排行榜</button>
        <button
          v-if="view.quizMusic && view.state !== 'lobby'"
          class="ghost-btn quiz-music-btn"
          :class="{ on: quizPlaying }"
          :title="quizPlaying ? '關掉作答音樂' : '播放作答音樂'"
          @click="toggleQuizMusic"
        >
          <AppIcon :name="quizPlaying ? 'volume' : 'music'" :size="14" />
        </button>
        <audio
          v-if="view.quizMusic"
          ref="quizAudioEl"
          :src="view.quizMusic"
          loop
          preload="auto"
          @play="quizPlaying = true"
          @pause="quizPlaying = false"
        />
        <div class="spacer" />
        <div class="dots">
          <button
            v-for="(s, i) in view.outline"
            :key="s.id"
            class="dot-s"
            :class="{ on: i === view.index, done: i < view.index }"
            :title="`${i + 1}. ${s.title || TYPE_META[s.type]?.label || ''}`"
            @click="act('goto', { index: i })"
          />
        </div>
        <span class="pill">{{ view.index >= 0 ? `${view.index + 1} / ${view.total}` : `— / ${view.total}` }}</span>
      </footer>

      <!--
        答題過程中把 QR 縮到右上角，讓晚到的人隨時都能掃進來。
        大廳有自己的大張 QR，排行榜和結束畫面則不需要再讓人加入。
      -->
      <Transition name="mini-qr">
        <aside v-if="qr && showMiniQr" class="mini-qr" :class="{ dim: qaOpen }">
          <img :src="qr" alt="加入用的 QR Code" />
          <div class="mini-qr-cap">
            <b>{{ view.code }}</b>
            <span>掃描加入</span>
          </div>
        </aside>
      </Transition>

      <!-- 表情符號浮層：從畫面下方浮上來，幾秒後淡出 -->
      <ReactionLayer :socket="socket" :max="40" />

      <!-- 提問側欄 -->
      <aside class="qa-panel" :class="{ open: qaOpen }">
        <header>
          <AppIcon name="hand" :size="16" />
          <h3>觀眾提問</h3>
          <div class="spacer" />
          <button class="mini" @click="qaOpen = false">關閉</button>
        </header>
        <div class="list">
          <div v-for="q in view.qa" :key="q.id" class="hq" :class="{ pinned: q.pinned, answered: q.answered }">
            <p>{{ q.text }}</p>
            <div class="row">
              <span class="votes"><AppIcon name="chevron-up" :size="10" /> {{ q.votes }}</span>
              <span class="by">{{ q.author }}</span>
              <div class="spacer" />
              <button class="mini" @click="act('qa:update', { id: q.id, patch: { pinned: !q.pinned } })">
                {{ q.pinned ? '取消置頂' : '置頂' }}
              </button>
              <button class="mini" @click="act('qa:update', { id: q.id, patch: { answered: !q.answered } })">
                {{ q.answered ? '未回答' : '已回答' }}
              </button>
              <button class="mini warn" @click="act('qa:delete', { id: q.id })">刪除</button>
            </div>
          </div>
          <div v-if="!view.qa.length" class="qa-empty">還沒有人提問</div>
        </div>
      </aside>
    </template>

    <div v-else class="stage-empty">
      <h2>正在建立房間…</h2>
    </div>
  </div>
</template>

<style scoped src="~/assets/css/present.css"></style>
