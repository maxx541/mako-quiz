<script setup lang="ts">
useHead({ title: '作答中 · Makoquiz' })

const route = useRoute()
const code = String(route.query.c || '')
const wantName = String(route.query.n || '')

const view = ref<any>(null)
const dead = ref('')
const sheetOpen = ref(false)
const seenQa = ref(0)
const draft = ref<any>(null)
const draftSlide = ref<string | null>(null)

/**
 * 參與者身分：像 Kahoot 一樣不需要註冊帳號，身分只存在於「這一場活動」的 session 中。
 *
 * 伺服器發一組 token，帶著它重連就會拿回原本的暱稱、分數與作答紀錄；沒帶就是新的參與者。
 * token 是不可猜測的亂數，所以沒辦法冒充別人。
 *
 * 主要放 sessionStorage —— 這才是真正的「瀏覽器 session」，關掉分頁就結束。
 * 另外備份一份到 localStorage，是為了手機把分頁被系統回收後回來時不會掉分數。
 *
 * localStorage 的 key 要帶上暱稱：localStorage 是整個瀏覽器共用的，
 * 如果只用房號當 key，同一台電腦換人加入時會直接被還原成前一個人的身分。
 * 加上暱稱之後，換個名字加入就是新的身分，同名重新整理才會接回原本的分數。
 */
const SKEY = 'ql_sess_' + code
const LKEY = 'ql_sess_' + code + '_' + (wantName || '')
const identity = {
  get: () => sessionStorage.getItem(SKEY) || localStorage.getItem(LKEY) || '',
  set(t: string) {
    sessionStorage.setItem(SKEY, t)
    localStorage.setItem(LKEY, t)
  },
  clear() {
    sessionStorage.removeItem(SKEY)
    localStorage.removeItem(LKEY)
  },
}

const socket = useSocket()
const { left, start, clear } = useCountdown()

const slide = computed(() => view.value?.slide)
const me = computed(() => view.value?.me)
// 手機螢幕小，背景再壓暗一點，題目才讀得清楚
const bg = computed(() => backgroundLayers(view.value?.background, { extraDim: 12 }))
const timeRatio = computed(() => {
  const total = (slide.value?.timeLimit || 0) * 1000
  return left.value === null || !total ? null : Math.max(0, Math.min(1, left.value / total))
})
const unread = computed(() => Math.max(0, (view.value?.qa.length || 0) - seenQa.value))

let joined = false

onMounted(() => {
  if (!/^\d{6}$/.test(code)) return navigateTo('/')

  socket.on('connect', () => {
    socket.emit('player:join', { code, name: wantName || localStorage.getItem('ql_name') || '玩家', token: identity.get() }, (res: any) => {
      if (!res || res.error) {
        identity.clear()
        return fatal(res?.error || '無法加入房間')
      }
      identity.set(res.token)
      localStorage.setItem('ql_name', res.name)
      if (res.resumed && joined) toast('已重新連線，分數都還在', 'ok')
      joined = true
      apply(res.view)
    })
  })

  socket.on('player:sync', apply)
  socket.on('session:closed', ({ reason }: any) => fatal(reason || '場次已結束'))
  socket.on('disconnect', () => {
    if (!dead.value) toast('連線中斷，重新連線中…', 'bad')
  })
})

function fatal(msg: string) {
  dead.value = msg
  clear()
  identity.clear() // 這一場結束了，session 身分跟著失效
}

function apply(v: any) {
  if (dead.value) return
  view.value = v
  // 換頁時清掉還沒送出的暫存
  if (v.slide?.id !== draftSlide.value) {
    draftSlide.value = v.slide?.id ?? null
    draft.value = null
  }
  if (v.state === 'live' && v.endsAt && !v.locked) start(v.endsAt, v.serverNow)
  else clear()
  if (sheetOpen.value) seenQa.value = v.qa.length
}

/** 每種題型的作答提示。分類題自己的板子上就有動態提示，這裡不用再講一次。 */
const answerHint = computed(() => {
  const s = slide.value
  if (!s) return ''
  switch (s.type) {
    case 'multi':
      return '可以選擇多個答案，選錯會抵銷得分'
    case 'match':
      return '先點左邊的項目，再點右邊配對的答案'
    case 'categorize':
      return ''
    case 'order':
      return '照你認為的順序，一個一個點下去'
    case 'type':
      return '直接輸入答案，錯字可能會被判錯喔'
    case 'soup':
      return '看提示打出你的猜測，每出一條新提示都能再猜一次'
    case 'list':
      return '想到就打進去，一個一個送 —— 答對越多分越高，全部湊齊還有額外加分'
    case 'number':
      return '猜一個數字，越接近答案分數越高'
    case 'scale':
      return '選一個你的分數'
    default:
      return s.graded ? '選出你認為正確的答案' : '選出你的想法'
  }
})

function send(value: any, then?: () => void) {
  socket.emit('player:answer', { slideId: slide.value.id, value }, (res: any) => {
    if (res?.error) return toast(res.error, 'bad')
    navigator.vibrate?.(24)
    then?.()
  })
}

/* ---------------- 選擇題 ---------------- */

/**
 * 一定要盯 slide.id，不能直接盯 slide。
 *
 * slide 是 computed(() => view.value?.slide)，每收到一次 player:sync 就是一個新物件，
 * Vue 拿參考比對永遠不相等 —— 盯著它的話，只要有人加入、有人提問，
 * 所有人選到一半的選項和打到一半的答案就會被清空。
 */
const slideId = computed(() => slide.value?.id ?? null)

const picked = ref<Set<string>>(new Set())
watch(slideId, () => (picked.value = new Set()))

function tapOption(o: any) {
  if (slide.value.type === 'multi') {
    picked.value.has(o.id) ? picked.value.delete(o.id) : picked.value.add(o.id)
    triggerRef(picked)
  } else {
    send(o.id)
  }
}

/* ---------------- 配對題 ---------------- */

const activeLeft = ref<string | null>(null)
const pairs = computed<Record<string, string>>(() => {
  if (!draft.value || slide.value?.type !== 'match') draft.value = {}
  return draft.value
})
const rightOwner = (rightId: string) => Object.keys(pairs.value).find((k) => pairs.value[k] === rightId) || null
const leftIndex = (leftId: string) => slide.value.lefts.findIndex((l: any) => l.id === leftId)
const matchDone = computed(() => slide.value?.lefts && Object.keys(pairs.value).length === slide.value.lefts.length)

/**
 * 配對圖在手機上很吃高度：兩欄各 N 格，每格再塞一張圖，
 * 8 組就是 16 張。組數越多每張就得越小，不然整頁都在捲、看不到全貌。
 */
const matchImgH = computed(() => {
  const n = slide.value?.lefts?.length || 0
  return n <= 3 ? 104 : n <= 5 ? 82 : 64
})

function tapLeft(id: string) {
  if (pairs.value[id]) {
    delete pairs.value[id]
    activeLeft.value = id
  } else {
    activeLeft.value = activeLeft.value === id ? null : id
  }
  triggerRef(draft)
}

function tapRight(id: string) {
  const owner = rightOwner(id)
  if (owner) {
    delete pairs.value[owner]
    triggerRef(draft)
    return
  }
  if (!activeLeft.value) return toast('請先點選左邊的項目')
  pairs.value[activeLeft.value] = id
  activeLeft.value = slide.value.lefts.find((l: any) => !pairs.value[l.id])?.id ?? null
  triggerRef(draft)
}

/* ---------------- 分類題 ---------------- */

const catMap = computed<Record<string, string>>({
  get: () => {
    if (!draft.value || slide.value?.type !== 'categorize') draft.value = {}
    return draft.value
  },
  set: (v) => {
    draft.value = v
  },
})
const catDone = computed(
  () => slide.value?.items && slide.value.items.every((i: any) => catMap.value[i.id])
)

/* ---------------- 順序題 ---------------- */

/**
 * 依序點選：draft 存的是「點下去的先後」，那就是要送出的答案順序。
 * 項目本身留在原位不動 —— 會跳動的清單在手機上很難點。
 */
const orderPicks = computed<string[]>(() => {
  if (!draft.value || slide.value?.type !== 'order') draft.value = []
  return draft.value
})

/** 這個項目排第幾（0 = 還沒點） */
const orderRank = (id: string) => orderPicks.value.indexOf(id) + 1
const orderLeft = computed(() => (slide.value?.items.length || 0) - orderPicks.value.length)
const orderDone = computed(() => slide.value?.items?.length > 0 && orderLeft.value === 0)

/** 項目多的時候圖要小一點，不然一頁只看得到兩三個、要一直捲才排得出順序 */
const orderImgH = computed(() => {
  const n = slide.value?.items?.length || 0
  return n <= 4 ? 92 : n <= 6 ? 72 : 58
})

/** 純圖片的項目沒有文字可以念，至少給個「第幾個」 */
const orderLabel = (it: any, i: number) => {
  const name = it.text || `第 ${i + 1} 個項目`
  return orderRank(it.id) ? `${name}，第 ${orderRank(it.id)} 個，再點一次取消` : name
}

function tapOrder(id: string) {
  const i = orderPicks.value.indexOf(id)
  // 再點一次就取消，後面的號碼會自動遞補上來
  if (i >= 0) orderPicks.value.splice(i, 1)
  else orderPicks.value.push(id)
  triggerRef(draft)
  navigator.vibrate?.(12)
}

/* ---------------- 文字輸入 ---------------- */

const textAnswer = ref('')
const openText = ref('')
const listText = ref('')
const numberAnswer = ref('')
const scaleValue = ref<number | null>(null)
watch(slideId, () => {
  textAnswer.value = ''
  openText.value = ''
  listText.value = ''
  numberAnswer.value = ''
  scaleValue.value = null
})

/* ---------------- 複數答案 ---------------- */

/** 我已經送出的答案清單（複數答案題一個一個累積） */
const myList = computed<string[]>(() => view.value?.myAnswer?.value || [])
const listLeft = computed(() => Math.max(0, (slide.value?.maxSubmissions || 10) - myList.value.length))

/**
 * 只擋空白。
 *
 * 這裡刻意不驗證「是不是合法數字」—— 全形數字、千分位逗號、前後空白
 * 在手機輸入法上太容易打出來了，在用戶端擋掉只會讓人送不出去又不知道為什麼。
 * 一律送給伺服器，由它解析與判定。
 */
const numberValid = computed(() => numberAnswer.value.trim() !== '')

/* ---------------- 頭像 ---------------- */

const avatarInput = ref<HTMLInputElement | null>(null)
const avatarBusy = ref(false)

/**
 * 在手機上先把圖縮成 256 見方的 JPEG 再上傳。
 *
 * 現在手機隨手一張照片就是好幾 MB，活動現場幾十個人同時上傳原圖，
 * 光是等上傳就毀了開場。縮圖只要幾十 KB，而且是在他自己的裝置上算的。
 * 伺服器端仍然會驗 magic bytes 與大小 —— 前端縮圖是為了快，不是當作信任。
 */
function shrink(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const S = 256
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const g = c.getContext('2d')!
      // 取中央的正方形裁切，頭像是圓的，變形比裁切難看得多
      const side = Math.min(img.width, img.height)
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S)
      URL.revokeObjectURL(img.src)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('轉檔失敗'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('這個檔案讀不出圖片'))
    }
    img.src = URL.createObjectURL(file)
  })
}

async function pickAvatar(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 選同一張還要能再上傳一次
  if (!file) return
  avatarBusy.value = true
  try {
    const blob = await shrink(file)
    const form = new FormData()
    form.append('file', blob, 'avatar.jpg')
    form.append('code', code)
    form.append('token', identity.get())
    const res = await fetch('/api/avatar', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.data?.error || data?.error || '上傳失敗')
    toast('頭像換好了', 'ok')
  } catch (err: any) {
    toast(err.message || '上傳失敗', 'bad')
  } finally {
    avatarBusy.value = false
  }
}

/* ---------------- 表情符號 ---------------- */

const reactionsOpen = ref(false)
const reactionLayer = ref<any>(null)
const canReact = computed(() => view.value?.settings.reactionsEnabled && (view.value?.reactions?.length || 0) > 0)

function sendReaction(r: any) {
  socket.emit('player:reaction', { id: r.id }, (res: any) => {
    // 節流被擋下是正常的，不用吵使用者
    if (res?.error && !/慢一點/.test(res.error)) toast(res.error, 'bad')
  })
  navigator.vibrate?.(12)
}
const scaleRange = computed(() => {
  const s = slide.value
  if (!s) return []
  return Array.from({ length: (s.max || 5) - (s.min || 1) + 1 }, (_, i) => (s.min || 1) + i)
})

const myOpen = computed<string[]>(() => view.value?.myAnswer?.value || [])
const openLeft = computed(() => Math.max(0, (slide.value?.maxSubmissions || 1) - myOpen.value.length))

/**
 * 海龜湯每出一條新提示就能再猜一次。
 * 已經答對、或這條提示已經猜過了，就要等下一條。
 */
const soupState = computed(() => {
  const v = view.value
  if (!v || v.slide?.type !== 'soup') return null
  const a = v.myAnswer
  if (!a) return { canAnswer: true, why: '' }
  if (a.correct) return { canAnswer: false, why: 'correct' }
  if (a.stage === v.stage) return { canAnswer: false, why: 'used' }
  return { canAnswer: true, why: 'retry' }
})

/**
 * 海龜湯換提示時「不」清空輸入框。
 *
 * 提示是定時自動跳的，正在打字的人會被清掉半句話 —— 中文還在組字時
 * 更是直接消失。上一次猜錯的內容留著也無妨，他自己會改。
 * 真正該清掉的時機是送出成功，那個在 send() 的 callback 裡做。
 */

/* ---------------- 結果 ---------------- */

const resultKind = computed(() => {
  const a = view.value?.myAnswer
  if (!a) return 'none'
  return a.correct ? 'ok' : a.ratio > 0 ? 'mid' : 'no'
})

/** 純圖片的項目在「正確答案」那一行沒有文字可寫，用這個佔位 */
const IMG_ONLY = '（圖片）'

const solutionText = computed(() => {
  const s = slide.value
  const sol = view.value?.solution
  if (!s || !sol) return null
  switch (s.type) {
    case 'single':
    case 'truefalse':
    case 'multi':
    case 'reveal':
    case 'music':
      return sol.optionIds.map((id: string) => s.options.find((o: any) => o.id === id)?.text).filter(Boolean).join('、')
    case 'number':
      return `${sol.answer}${sol.unit || ''}`
    case 'soup':
      return sol.accepted.join(' / ')
    /*
     * 配對／分類／順序題的項目可以「只有圖沒有文字」。
     *
     * 那種項目在這一行文字裡沒東西可寫，硬擠會變成「 → 」或「甲：、、」。
     * 有文字的照寫，沒文字的用「（圖片）」代替；整題都是圖的話就回 null，
     * 讓「正確答案」整塊不要出現 —— 大螢幕上本來就看得到圖，手機這裡不需要硬湊。
     */
    case 'match':
      if (!sol.pairs.some((p: any) => p.left || p.right)) return null
      return sol.pairs.map((p: any) => `${p.left || IMG_ONLY} → ${p.right || IMG_ONLY}`).join('\n')
    case 'categorize':
      if (!sol.categories.some((c: any) => c.items.some((i: any) => i.text))) return null
      return sol.categories
        .map((c: any) => `${c.name}：${c.items.map((i: any) => i.text || IMG_ONLY).join('、')}`)
        .join('\n')
    case 'order':
      if (!sol.items.some((i: any) => i.text)) return null
      return sol.items.map((i: any, n: number) => `${n + 1}. ${i.text || IMG_ONLY}`).join('\n')
    case 'type':
      return sol.accepted.join(' / ')
    default:
      return null
  }
})

/* ---------------- 文字雲 ---------------- */

const cloudSource = computed(() => view.value?.liveResults || view.value?.results)

function cloudStyle(w: any, i: number, max: number) {
  return {
    fontSize: 13 + Math.round((w.count / max) * 22) + 'px',
    color: OPTION_COLORS[i % OPTION_COLORS.length],
    opacity: 0.55 + (w.count / max) * 0.45,
  }
}

/* ---------------- 提問 ---------------- */

const qaText = ref('')

function askQa() {
  const text = qaText.value.trim()
  if (!text) return
  socket.emit('player:qa:ask', { text }, (res: any) => {
    if (res?.error) return toast(res.error, 'bad')
    qaText.value = ''
    toast('問題已送出', 'ok')
  })
}

const voteQa = (id: string) => socket.emit('player:qa:vote', { id }, (res: any) => res?.error && toast(res.error, 'bad'))

function toggleSheet() {
  sheetOpen.value = !sheetOpen.value
  if (sheetOpen.value) seenQa.value = view.value?.qa.length || 0
}
</script>

<template>
  <div class="page" :class="['theme-' + (view?.theme || 'slate'), { 'has-bg-image': !!bg }]">
    <template v-if="bg">
      <div class="bg-layer" :style="bg.image" />
      <div class="bg-scrim" :style="bg.scrim" />
    </template>

    <!-- 結束 / 被踢出 -->
    <div v-if="dead" class="main">
      <div class="center">
        <AppIcon name="door" :size="58" :stroke="1.4" />
        <h2>{{ dead }}</h2>
        <button class="submit" style="max-width: 260px" @click="navigateTo('/')">回到首頁</button>
      </div>
    </div>

    <template v-else-if="view">
      <header class="topbar">
        <div class="me">
          <div class="avatar">
            <img v-if="me.avatar" :src="me.avatar" alt="" />
            <template v-else>{{ (me.name || '?').slice(0, 1).toUpperCase() }}</template>
          </div>
          <div>
            <div class="me-name">{{ me.name }}</div>
            <div class="me-sub">房間 {{ view.code }} · {{ view.playerCount }} 人</div>
          </div>
        </div>
        <div class="spacer" />
        <div class="score-pill">
          <b>{{ me.score.toLocaleString() }}</b>
          <span>{{ me.rank ? `第 ${me.rank} 名` : '分數' }}</span>
        </div>
        <button v-if="canReact" class="qa-btn react-toggle" :class="{ on: reactionsOpen }" title="送表情符號" @click="reactionsOpen = !reactionsOpen">
          <AppIcon name="smile" :size="15" />
        </button>
        <button v-if="view.settings.qaEnabled" class="qa-btn qa-toggle" @click="toggleSheet">
          <AppIcon name="hand" :size="14" /> 提問
          <span v-if="unread && !sheetOpen" class="dot">{{ unread > 9 ? '9+' : unread }}</span>
        </button>
      </header>

      <!-- 表情符號：點了就浮到大螢幕上（也會浮在自己畫面上當回饋） -->
      <Transition name="react-bar">
        <div v-if="canReact && reactionsOpen" class="react-bar">
          <button v-for="r in view.reactions" :key="r.id" class="react-btn" :title="r.label" @click="sendReaction(r)">
            <img :src="r.url" :alt="r.label" />
          </button>
        </div>
      </Transition>

      <div v-if="timeRatio !== null" class="timerbar" :class="{ warn: timeRatio < 0.35 }">
        <i :style="{ width: timeRatio * 100 + '%' }" />
      </div>

      <main class="main">
        <!-- 大廳：只有這裡能換頭像，開打之後就別分心了 -->
        <div v-if="view.state === 'lobby'" class="center">
          <button class="avatar-pick" :disabled="avatarBusy" @click="avatarInput?.click()">
            <img v-if="me.avatar" :src="me.avatar" alt="你的頭像" />
            <AppIcon v-else name="gamepad" :size="42" :stroke="1.4" />
            <span class="avatar-edit">
              <AppIcon :name="avatarBusy ? 'hourglass' : 'image'" :size="13" />
            </span>
          </button>
          <input ref="avatarInput" type="file" accept="image/*" hidden @change="pickAvatar" />
          <h2>你已加入，{{ me.name }}！</h2>
          <p>「{{ view.title }}」即將開始，請看主持人的大螢幕。</p>
          <button class="avatar-hint" :disabled="avatarBusy" @click="avatarInput?.click()">
            {{ avatarBusy ? '上傳中…' : me.avatar ? '換一張頭像' : '點上面的圓圈設定頭像' }}
          </button>
          <div class="pulse"><i /><i /><i /></div>
          <p class="tiny">目前有 {{ view.playerCount }} 位參與者</p>

          <!-- 大廳也能送表情：等待開始時炒熱氣氛，浮到主持人的大螢幕上 -->
          <div v-if="canReact" class="lobby-reacts">
            <span class="lobby-reacts-cap">送個表情炒熱氣氛</span>
            <div class="lobby-reacts-row">
              <button v-for="r in view.reactions" :key="r.id" class="react-btn" :title="r.label" @click="sendReaction(r)">
                <img :src="r.url" :alt="r.label" />
              </button>
            </div>
          </div>
        </div>

        <!-- 進行中 -->
        <template v-else-if="view.state === 'live'">
          <!-- 內容頁 -->
          <div v-if="slide.type === 'content'" class="center">
            <AppIcon name="monitor" :size="58" :stroke="1.4" />
            <h2>{{ slide.title }}</h2>
            <p v-if="slide.body" style="white-space: pre-wrap">{{ slide.body }}</p>
            <p>請看主持人的大螢幕</p>
          </div>

          <!-- 觀眾提問頁 -->
          <div v-else-if="slide.type === 'qa'">
            <QHead :view="view" hint="送出問題，也可以幫別人的問題按讚" />
            <textarea v-model="qaText" class="big-input" placeholder="寫下你想問的問題…" maxlength="300" rows="2" />
            <button class="submit" :disabled="!qaText.trim()" @click="askQa">送出問題</button>
            <div class="qhint mt">大家的問題</div>
            <div class="qa-list flat">
              <QaItem v-for="q in view.qa" :key="q.id" :q="q" :upvote="view.settings.qaUpvote" @vote="voteQa" />
              <div v-if="!view.qa.length" class="empty">還沒有人提問，成為第一個吧！</div>
            </div>
          </div>

          <!-- 開放問題 -->
          <div v-else-if="slide.type === 'open'">
            <QHead :view="view" :hint="openLeft > 0 ? `想到什麼就寫什麼，還可以送出 ${openLeft} 則` : '你的想法已送出，感謝分享！'" />
            <template v-if="openLeft > 0 && !view.locked">
              <textarea v-model="openText" class="big-input" placeholder="寫下你的想法…" :maxlength="slide.maxChars || 120" rows="3" />
              <div class="counter">{{ openText.length }} / {{ slide.maxChars || 120 }}</div>
              <button class="submit" :disabled="!openText.trim()" @click="send(openText.trim(), () => (openText = ''))">送出</button>
            </template>
            <div v-if="myOpen.length" class="mt">
              <div class="qhint">你送出的內容</div>
              <div class="replies">
                <div v-for="(t, i) in myOpen" :key="i" class="reply">{{ t }}</div>
              </div>
            </div>
            <div class="mt">
              <div class="qhint">大家的想法</div>
              <CloudView :res="cloudSource" />
            </div>
          </div>

          <!-- 複數答案：一個一個把答案送進去，湊越多越好（自己一直留在這頁，不跳「已作答」） -->
          <div v-else-if="slide.type === 'list'">
            <QHead :view="view" :hint="answerHint" />
            <div class="list-goal">
              <AppIcon name="list-check" :size="16" />
              <span>盡量列出，目標 {{ slide.total }} 個</span>
              <b>已送出 {{ myList.length }}</b>
            </div>
            <div v-if="myList.length" class="list-mine">
              <span v-for="(t, i) in myList" :key="i" class="list-chip">{{ t }}</span>
            </div>
            <template v-if="!view.locked && listLeft > 0">
              <input
                v-model="listText"
                class="big-input"
                placeholder="想到一個答案就打進來…"
                maxlength="80"
                autocomplete="off"
                @keydown.enter="!$event.isComposing && listText.trim() && send(listText.trim(), () => (listText = ''))"
              />
              <button class="submit" :disabled="!listText.trim()" @click="send(listText.trim(), () => (listText = ''))">
                送出這個答案
              </button>
              <p class="soup-note">
                <AppIcon name="info" :size="13" />
                答對越多分越高，把 {{ slide.total }} 個全湊齊還有額外加分！還能再送 {{ listLeft }} 個。
              </p>
            </template>
            <div v-else class="soup-done wait">
              <AppIcon name="hourglass" :size="20" />
              <div>
                <b>{{ view.locked ? '時間到！' : '已送到上限' }}</b>
                <span>你送出了 {{ myList.length }} 個答案，等主持人公布</span>
              </div>
            </div>
          </div>

          <!-- 時間到，等公布 -->
          <div v-else-if="view.locked" class="center">
            <AppIcon name="hourglass" :size="58" :stroke="1.4" />
            <h2>時間到！</h2>
            <p>{{ view.myAnswer ? '你的答案已送出，' : '這題你沒有作答，' }}等主持人公布答案</p>
            <div class="pulse"><i /><i /><i /></div>
          </div>

          <!-- 已作答，等其他人（海龜湯除外：它每條新提示都還能再猜） -->
          <div v-else-if="view.myAnswer && slide.type !== 'soup'" class="center">
            <AppIcon name="check" :size="58" :stroke="1.6" />
            <h2>答案已送出</h2>
            <p>等主持人公布答案</p>
            <div class="pulse"><i /><i /><i /></div>
          </div>

          <!-- 作答 -->
          <div v-else>
            <QHead :view="view" :hint="answerHint" />

            <!-- 海龜湯：提示一條一條出現，自己打答案 -->
            <div v-if="slide.type === 'soup'">
              <div class="stage-hint">
                <AppIcon name="layers" :size="15" />
                <span>第 {{ view.stage + 1 }} / {{ slide.stages }} 條提示</span>
                <b v-if="slide.points !== 'none'">現在答對可拿 {{ view.stagePoints }}%</b>
              </div>
              <ol class="hints">
                <li v-for="(h, i) in slide.hints" :key="i" :class="{ latest: i === slide.hints.length - 1 }">
                  <span class="hn">{{ i + 1 }}</span>
                  <span>{{ h.text }}</span>
                </li>
              </ol>
              <template v-if="soupState.canAnswer">
                <div v-if="soupState.why === 'retry'" class="soup-retry">
                  <AppIcon name="info" :size="14" />
                  上一個猜錯了 —— 有新提示了，再試一次！
                </div>
                <!-- isComposing：中文選字時按 Enter 是在挑候選字，不是要送出 -->
                <input
                  v-model="textAnswer"
                  class="big-input"
                  placeholder="想到答案就打進來…"
                  maxlength="80"
                  autocomplete="off"
                  @keydown.enter="!$event.isComposing && textAnswer.trim() && send(textAnswer.trim(), () => (textAnswer = ''))"
                />
                <button class="submit" :disabled="!textAnswer.trim()" @click="send(textAnswer.trim(), () => (textAnswer = ''))">
                  送出答案
                </button>
                <p class="soup-note">
                  <AppIcon name="info" :size="13" />
                  每一條提示都能猜一次 —— 先送出你這輪的猜測，大家都送出後才會出下一條提示，越早猜中分數越高。
                </p>
              </template>

              <div v-else-if="soupState.why === 'correct'" class="soup-done ok">
                <AppIcon name="check" :size="20" />
                <div>
                  <b>答對了！</b>
                  <span>你在第 {{ view.myAnswer.stage + 1 }} 條提示就猜中，拿到 {{ view.myAnswer.points.toLocaleString() }} 分</span>
                </div>
              </div>

              <div v-else class="soup-done wait">
                <AppIcon name="hourglass" :size="20" />
                <div>
                  <b>「{{ view.myAnswer.value }}」不對</b>
                  <span>大家都答完這輪就會出下一條提示，到時再猜一次</span>
                </div>
              </div>
            </div>

            <!-- 猜圖題：圖在大螢幕上，手機只挑答案 -->
            <div v-if="slide.type === 'reveal'" class="stage-hint">
              <AppIcon name="eye" :size="15" />
              <span>看大螢幕的圖，第 {{ view.stage + 1 }} / {{ slide.stages }} 階段</span>
              <b v-if="slide.points !== 'none'">現在答對可拿 {{ view.stagePoints }}%</b>
            </div>

            <!-- 音樂題：音樂在大螢幕播 -->
            <div v-if="slide.type === 'music'" class="stage-hint">
              <AppIcon name="volume" :size="15" />
              <span>聽大螢幕播放的音樂，選出答案</span>
            </div>

            <!-- 單選 / 複選 / 是非 / 猜圖 / 音樂 -->
            <div v-if="CHOICE_TYPES.includes(slide.type)">
              <div class="opts" :class="{ two: slide.options.length === 2 || slide.options.length === 4 }">
                <button
                  v-for="(o, i) in slide.options"
                  :key="o.id"
                  class="opt"
                  :class="{ sel: picked.has(o.id), 'has-img': o.image }"
                  :style="{ '--oc': o.color }"
                  @click="tapOption(o)"
                >
                  <img v-if="o.image" :src="o.image" alt="" class="opt-img" />
                  <div class="opt-line">
                    <AppIcon :name="OPTION_SHAPES[i % OPTION_SHAPES.length]" :size="16" class="shape" />
                    <span>{{ o.text || (o.image ? '' : `選項 ${i + 1}`) }}</span>
                    <span v-if="slide.type === 'multi'" class="tick"><AppIcon name="check" :size="12" /></span>
                  </div>
                </button>
              </div>
              <button v-if="slide.type === 'multi'" class="submit" :disabled="!picked.size" @click="send([...picked])">
                送出答案
              </button>
            </div>

            <!-- 配對題 -->
            <div v-else-if="slide.type === 'match'">
              <div class="match-grid" :style="{ '--mih': matchImgH + 'px' }">
                <div>
                  <div class="col-title">題目</div>
                  <button
                    v-for="(l, li) in slide.lefts"
                    :key="l.id"
                    class="mcell"
                    :class="{ active: activeLeft === l.id, paired: !!pairs[l.id], 'has-img': !!l.image }"
                    :style="{ '--pc': OPTION_COLORS[leftIndex(l.id) % OPTION_COLORS.length] }"
                    :aria-label="l.text || `題目第 ${li + 1} 項`"
                    @click="tapLeft(l.id)"
                  >
                    <span v-if="pairs[l.id]" class="pin">{{ leftIndex(l.id) + 1 }}</span>
                    <img v-if="l.image" :src="l.image" class="mimg" alt="" />
                    <span v-if="l.text" class="mtext">{{ l.text }}</span>
                  </button>
                </div>
                <div>
                  <div class="col-title">答案</div>
                  <button
                    v-for="(r, ri) in slide.rights"
                    :key="r.id"
                    class="mcell"
                    :class="{ paired: !!rightOwner(r.id), 'has-img': !!r.image }"
                    :style="{ '--pc': rightOwner(r.id) ? OPTION_COLORS[leftIndex(rightOwner(r.id)!) % OPTION_COLORS.length] : 'transparent' }"
                    :aria-label="r.text || `答案第 ${ri + 1} 項`"
                    @click="tapRight(r.id)"
                  >
                    <span v-if="rightOwner(r.id)" class="pin">{{ leftIndex(rightOwner(r.id)!) + 1 }}</span>
                    <img v-if="r.image" :src="r.image" class="mimg" alt="" />
                    <span v-if="r.text" class="mtext">{{ r.text }}</span>
                  </button>
                </div>
              </div>
              <button class="submit" :disabled="!matchDone" @click="send({ ...pairs })">送出配對</button>
            </div>

            <!-- 分類題 -->
            <div v-else-if="slide.type === 'categorize'">
              <CategorizeBoard v-model="catMap" :categories="slide.categories" :items="slide.items" />
              <button class="submit" :disabled="!catDone" @click="send({ ...catMap })">
                {{ catDone ? '送出分類' : `還有 ${slide.items.length - Object.keys(catMap).length} 個沒放` }}
              </button>
            </div>

            <!-- 順序題：照你認為的順序一個一個點下去，號碼自動編 -->
            <div v-else-if="slide.type === 'order'">
              <div class="order-list" :style="{ '--oih': orderImgH + 'px' }">
                <button
                  v-for="(it, oi) in slide.items"
                  :key="it.id"
                  class="orow"
                  :class="{ picked: orderRank(it.id) > 0, 'has-img': !!it.image }"
                  :aria-label="orderLabel(it, oi)"
                  @click="tapOrder(it.id)"
                >
                  <div class="num" :class="{ on: orderRank(it.id) > 0 }">{{ orderRank(it.id) || '' }}</div>
                  <img v-if="it.image" :src="it.image" class="oimg" alt="" />
                  <div v-if="it.text" class="txt">{{ it.text }}</div>
                </button>
              </div>
              <button class="submit" :disabled="!orderDone" @click="send([...orderPicks])">
                {{ orderDone ? '送出順序' : `依序點選，還有 ${orderLeft} 個` }}
              </button>
            </div>

            <!-- 填空題 -->
            <div v-else-if="slide.type === 'type'">
              <input
                v-model="textAnswer"
                class="big-input"
                placeholder="輸入你的答案…"
                maxlength="80"
                autocomplete="off"
                @keydown.enter="!$event.isComposing && textAnswer.trim() && send(textAnswer.trim())"
              />
              <button class="submit" :disabled="!textAnswer.trim()" @click="send(textAnswer.trim())">送出答案</button>
            </div>

            <!-- 數字題 -->
            <div v-else-if="slide.type === 'number'">
              <!--
                type 一定要是 text：Vue 對 <input type="number"> 會自動把 v-model 轉成數字，
                字串方法就全部炸掉；瀏覽器也會在內容不合它的胃口時把 value 直接清成空字串。
                inputmode 保留數字鍵盤，實際的解析與判定交給伺服器。
              -->
              <div class="num-wrap">
                <input
                  v-model="numberAnswer"
                  class="big-input num"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  autocomplete="off"
                  @keydown.enter="!$event.isComposing && numberValid && send(numberAnswer.trim())"
                />
                <span v-if="slide.unit" class="unit">{{ slide.unit }}</span>
              </div>
              <button class="submit" :disabled="!numberValid" @click="send(numberAnswer.trim())">送出答案</button>
            </div>

            <!-- 評分題 -->
            <div v-else-if="slide.type === 'scale'">
              <div class="scale-row">
                <button
                  v-for="v in scaleRange"
                  :key="v"
                  class="scale-btn"
                  :class="{ sel: scaleValue === v }"
                  @click="scaleValue = v"
                >{{ v }}</button>
              </div>
              <div class="scale-labels">
                <span>{{ slide.minLabel }}</span>
                <span>{{ slide.maxLabel }}</span>
              </div>
              <button class="submit" :disabled="scaleValue === null" @click="send(scaleValue)">送出</button>
            </div>
          </div>
        </template>

        <!-- 公布答案 -->
        <div v-else-if="view.state === 'results'" class="center">
          <template v-if="!slide.graded">
            <AppIcon :name="slide.type === 'open' ? 'message-open' : 'bar-chart'" :size="58" :stroke="1.4" />
            <h2>{{ view.myAnswer ? '感謝你的回覆！' : '這題你沒有回覆' }}</h2>
            <p>結果正顯示在主持人的大螢幕上</p>
            <div v-if="slide.type === 'open'" style="width: 100%; max-width: 400px">
              <CloudView :res="view.results" />
            </div>
          </template>

          <template v-else>
            <div v-if="!view.myAnswer">
              <AppIcon name="hourglass" :size="58" :stroke="1.4" />
              <h2>沒有作答</h2>
              <p>下一題加油！</p>
            </div>
            <div v-else class="result-hero" :class="resultKind">
              <AppIcon :name="resultKind === 'ok' ? 'smile' : resultKind === 'mid' ? 'meh' : 'frown'" :size="52" :stroke="1.6" />
              <h2>{{ resultKind === 'ok' ? '答對了！' : resultKind === 'mid' ? '部分正確' : '答錯了' }}</h2>
              <p v-if="slide.type === 'list'">
                答對 {{ view.myAnswer.hits }} / {{ view.solution?.answers?.length ?? 0 }} 個{{ resultKind === 'ok' ? '，全部命中！' : '' }}
              </p>
              <p v-else-if="resultKind === 'mid' && slide.type === 'number'">
                你猜 {{ view.myAnswer.value }}{{ slide.unit }}，很接近了
              </p>
              <p v-else-if="resultKind === 'mid'">答對 {{ Math.round(view.myAnswer.ratio * 100) }}%</p>
              <p v-if="slide.type === 'reveal' && resultKind === 'ok'">
                你在第 {{ view.myAnswer.stage + 1 }} 階段就猜中了
              </p>
              <div v-if="view.myAnswer.points > 0" class="gain">+{{ view.myAnswer.points.toLocaleString() }}</div>
            </div>

            <div class="stat-row">
              <div class="stat"><b>{{ me.score.toLocaleString() }}</b><span>總分</span></div>
              <div class="stat"><b>{{ me.rank ? '#' + me.rank : '—' }}</b><span>目前排名</span></div>
              <div class="stat"><b>{{ me.streak }}</b><span>連續答對</span></div>
            </div>

            <div v-if="solutionText" class="solution">
              <div class="st">正確答案</div>
              <div class="sv">{{ solutionText }}</div>
            </div>

            <!-- 複數答案：逐一標出我寫的對不對，再列出完整答案（漏掉的另外標） -->
            <div v-if="slide.type === 'list' && view.solution" class="list-result">
              <div v-if="myList.length" class="list-mine">
                <span v-for="(t, i) in myList" :key="i" class="list-chip" :class="view.myAnswer.marks?.[i] ? 'ok' : 'no'">
                  <AppIcon :name="view.myAnswer.marks?.[i] ? 'check' : 'x'" :size="12" />
                  {{ t }}
                </span>
              </div>
              <div class="solution">
                <div class="st">完整答案（你命中 {{ view.myAnswer.hits }} / {{ view.solution.answers.length }}）</div>
                <div class="list-answers">
                  <span v-for="(a, i) in view.solution.answers" :key="i" class="list-chip" :class="view.myAnswer.groupHit?.[i] ? 'ok' : 'miss'">
                    {{ a.text }}
                  </span>
                </div>
              </div>
            </div>
          </template>

          <!-- 解說：公布答案後才會拿到 -->
          <div v-if="view.explain" class="explain">
            <div class="st"><AppIcon name="info" :size="12" /> 解說</div>
            <img
              v-if="view.explain.image"
              :src="view.explain.image"
              class="zoomable"
              alt="解說圖片，點擊放大"
              @click="openZoom(view.explain.image)"
            />
            <p v-if="view.explain.text">{{ view.explain.text }}</p>
          </div>
        </div>

        <!-- 排行榜 / 結束 -->
        <div v-else-if="['leaderboard', 'ended'].includes(view.state)" class="center">
          <AppIcon :name="view.state === 'ended' ? 'flag' : 'trophy'" :size="52" :stroke="1.5" />
          <h2>{{ view.state === 'ended' ? '活動結束！' : '目前排名' }}</h2>
          <p v-if="view.state === 'ended'">
            你在 {{ view.playerCount }} 位參與者中排第 {{ me.rank }} 名，總分 {{ me.score.toLocaleString() }} 分
          </p>

          <div v-if="view.podium?.length" class="podium">
            <div
              v-for="(p, i) in view.podium"
              :key="p.id"
              class="prow"
              :class="[i < 3 ? 'top' + (i + 1) : '', { mine: p.id === me.id }]"
              :style="{ animationDelay: i * 0.07 + 's' }"
            >
              <span class="rank-badge" :class="'r' + p.rank">{{ p.rank }}</span>
              <div class="nm">{{ p.name }}</div>
              <div class="sc">{{ p.score.toLocaleString() }}</div>
            </div>
          </div>

          <div v-if="me.rank > (view.podium?.length || 0)" class="podium" style="margin-top: 8px">
            <div class="prow mine">
              <span class="rank-badge">{{ me.rank }}</span>
              <div class="nm">{{ me.name }}（你）</div>
              <div class="sc">{{ me.score.toLocaleString() }}</div>
            </div>
          </div>

          <button v-if="view.state === 'ended'" class="leave" @click="navigateTo('/')">離開</button>
        </div>
      </main>

      <ReactionLayer ref="reactionLayer" :socket="socket" :max="24" />

      <!-- 提問面板 -->
      <Transition name="sheet">
        <div v-if="sheetOpen" class="sheet" @mousedown.self="toggleSheet">
          <div class="sheet-body">
            <div class="grip" />
            <div class="sheet-head">
              <AppIcon name="hand" :size="17" />
              <h3>觀眾提問</h3>
              <div class="spacer" />
              <button class="btn btn-ghost btn-sm" style="color: #94a3b8" @click="toggleSheet">關閉</button>
            </div>
            <div class="qa-list">
              <QaItem v-for="q in view.qa" :key="q.id" :q="q" :upvote="view.settings.qaUpvote" @vote="voteQa" />
              <div v-if="!view.qa.length" class="empty">還沒有人提問，成為第一個吧！</div>
            </div>
            <div class="qa-compose">
              <textarea v-model="qaText" placeholder="想問什麼？" maxlength="300" rows="1" />
              <button class="btn btn-primary" :disabled="!qaText.trim()" @click="askQa">送出</button>
            </div>
          </div>
        </div>
      </Transition>
    </template>

    <!-- 連線中 -->
    <div v-else class="main">
      <div class="center">
        <div class="pulse"><i /><i /><i /></div>
        <p>連線中…</p>
      </div>
    </div>
  </div>
</template>

<style scoped src="~/assets/css/play.css"></style>
