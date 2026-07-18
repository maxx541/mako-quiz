import crypto from 'node:crypto'
import { coverOf, uid } from './store'
import {
  aggregate,
  autoRevealable,
  displayItemsFor,
  grade,
  isGraded,
  isInteractive,
  isStaged,
  listResult,
  normalizeAnswer,
  sameListAnswer,
  scoreFor,
  slideForPlayer,
  explainOf,
  solutionOf,
  stageCount,
  stageFactor,
  usesSpeedBonus,
} from './quiz'

const sessions = new Map<string, Session>()
const SESSION_TTL = 1000 * 60 * 60 * 8 // 閒置 8 小時後回收

/** 表情符號的流水號，只是給前端動畫當 key，跟身分無關 */
let reactionSeq = 0

function newCode() {
  for (let i = 0; i < 500; i++) {
    const code = String(crypto.randomInt(100000, 1000000))
    if (!sessions.has(code)) return code
  }
  throw new Error('無法配發房間代碼，請稍後再試')
}

export function findSession(code: any) {
  return sessions.get(String(code || '').trim()) || null
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    code: s.code,
    title: s.presentation.title,
    state: s.state,
    players: s.players.size,
    createdAt: s.createdAt,
  }))
}

export function createSession(presentation: any, io: any) {
  const s = new Session(presentation, io)
  sessions.set(s.code, s)
  return s
}

let sweeper: any = null
export function startSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [code, s] of sessions) {
      if (now - s.touchedAt > SESSION_TTL) {
        s.dispose()
        sessions.delete(code)
      }
    }
  }, 1000 * 60 * 10)
  sweeper.unref?.()
}

export class Session {
  io: any
  code: string
  presentation: any
  state: 'lobby' | 'live' | 'results' | 'leaderboard' | 'ended'
  index: number
  players: Map<string, any>
  byToken: Map<string, string>
  answers: Map<string, Map<string, any>>
  qa: any[]
  startedAt: number | null
  endsAt: number | null
  /** 時間到之後就不再收答案，但時間到「不會」自動公布 —— 那要嘛主持人按，要嘛全員答完 */
  locked: boolean
  /** 猜圖題目前揭露到第幾階段（0 起算） */
  stage: number
  /** 表情符號的節流：playerId -> 最近一次發送時間 */
  private _lastReaction: Map<string, number>
  /** 已經結算過分數的投影片，避免回上一步再公布一次會重複加分 */
  private _scored: Set<string>
  createdAt: number
  touchedAt: number
  hostSockets: Set<string>
  joinUrl: string
  qrDataUrl: string
  private _timer: any
  private _stageTimer: any
  private _syncTimer: any

  constructor(presentation: any, io: any) {
    this.io = io
    this.code = newCode()
    // 深拷貝：開始播放後編輯簡報不會影響進行中的場次
    this.presentation = JSON.parse(JSON.stringify(presentation))
    this.state = 'lobby'
    this.index = -1
    this.players = new Map()
    this.byToken = new Map()
    this.answers = new Map()
    this.qa = []
    this.startedAt = null
    this.endsAt = null
    this.locked = false
    this.stage = 0
    this._lastReaction = new Map()
    this._scored = new Set()
    this.createdAt = Date.now()
    this.touchedAt = Date.now()
    this.hostSockets = new Set()
    this.joinUrl = ''
    this.qrDataUrl = ''
    this._timer = null
    this._stageTimer = null
    this._syncTimer = null
  }

  get slides() {
    return this.presentation.slides
  }

  get settings() {
    return this.presentation.settings || {}
  }

  get currentSlide() {
    return this.slides[this.index] || null
  }

  room() {
    return `room:${this.code}`
  }

  touch() {
    this.touchedAt = Date.now()
  }

  dispose() {
    clearTimeout(this._timer)
    clearTimeout(this._stageTimer)
    clearTimeout(this._syncTimer)
    this.io.to(this.room()).emit('session:closed', { reason: '場次已結束' })
  }

  /* ---------------- 參與者 ---------------- */

  uniqueName(want: string) {
    const name = String(want || '').trim().slice(0, 20) || '匿名玩家'
    const taken = new Set([...this.players.values()].map((p) => p.name))
    if (!taken.has(name)) return name
    for (let i = 2; i < 999; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`
    return name + ' ' + crypto.randomInt(1000, 9999)
  }

  /**
   * 加入房間。像 Kahoot 一樣不需要帳號：身分綁在這一場的 session 上。
   * 回傳的 token 是這位參與者的憑證，只給他本人，絕對不能出現在廣播出去的畫面資料裡。
   */
  addPlayer(name: string, socket: any) {
    const player = {
      id: uid('u_'),
      token: crypto.randomBytes(24).toString('hex'),
      name: this.uniqueName(name),
      avatar: null as string | null,
      score: 0,
      streak: 0,
      socketId: socket.id,
      connected: true,
      joinedAt: Date.now(),
    }
    this.players.set(player.id, player)
    this.byToken.set(player.token, player.id)
    socket.join(this.room())
    this.touch()
    // 大家的畫面都會顯示人數，所以進出房間要同步「所有人」，不是只有主持端
    this.syncAllSoon()
    return player
  }

  /**
   * 用 session token 找回原本的身分（重新整理、換網路、手機休眠後回來）。
   * 只認 token —— 不能用 player.id，否則任何人看到排行榜上的 id 就能冒充別人。
   */
  resumePlayer(token: string, socket: any) {
    const id = this.byToken.get(String(token || ''))
    const p = id ? this.players.get(id) : null
    if (!p) return null
    p.socketId = socket.id
    p.connected = true
    socket.join(this.room())
    this.touch()
    this.syncAllSoon()
    return p
  }

  /** 用 session token 找人 —— 只認得出他自己，換不到別人的身分 */
  playerByToken(token: string) {
    const id = this.byToken.get(String(token || ''))
    return (id && this.players.get(id)) || null
  }

  setAvatar(playerId: string, url: string) {
    const p = this.players.get(playerId)
    if (!p) return
    p.avatar = url
    this.touch()
    // 大廳名單、排行榜、頒獎台都會用到，所以是全體同步
    this.syncAllSoon()
  }

  detachSocket(socketId: string) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false
        p.socketId = null
        this.syncAllSoon()
      }
    }
    this.hostSockets.delete(socketId)
  }

  kick(playerId: string) {
    const p = this.players.get(playerId)
    if (!p) return
    if (p.socketId) this.io.to(p.socketId).emit('session:closed', { reason: '你已被主持人移出房間' })
    this.players.delete(playerId)
    this.byToken.delete(p.token) // 讓 token 失效，被踢掉就不能靠重連回來
    for (const m of this.answers.values()) m.delete(playerId)
    this.syncAllSoon()
  }

  /* ---------------- 流程控制 ---------------- */

  start() {
    if (this.state !== 'lobby') return
    this.goto(0)
  }

  goto(index: number) {
    clearTimeout(this._timer)
    clearTimeout(this._stageTimer)
    if (index >= this.slides.length) return this.end()
    if (index < 0) index = 0
    this.index = index
    this.state = 'live'
    this.locked = false
    this.stage = 0
    this.startedAt = Date.now()
    const slide = this.currentSlide
    if (!this.answers.has(slide.id)) this.answers.set(slide.id, new Map())
    this.endsAt = slide.timeLimit > 0 && isInteractive(slide) ? this.startedAt + slide.timeLimit * 1000 : null
    if (this.endsAt) {
      // 時間到只鎖定作答，不自動公布 —— 沒答完就時間到的時候，
      // 主持人通常要先講評再揭曉（全員答完的自動公布是另一條路，見 maybeAutoReveal）
      this._timer = setTimeout(() => this.lock(), this.endsAt - Date.now() + 250)
    }
    this.armStageTimer()
    this.touch()
    this.syncAll()
  }

  /** 分階段題型：每隔 stageSeconds 自動揭露下一階段（設 0 就只能手動揭） */
  private armStageTimer() {
    clearTimeout(this._stageTimer)
    const slide = this.currentSlide
    if (!isStaged(slide) || this.state !== 'live') return
    const secs = Number(slide.stageSeconds) || 0
    if (secs <= 0 || this.stage >= stageCount(slide) - 1) return
    this._stageTimer = setTimeout(() => this.nextStage(), secs * 1000)
  }

  /** 揭露下一階段（主持人手動按，或自動計時觸發） */
  nextStage() {
    clearTimeout(this._stageTimer)
    const slide = this.currentSlide
    if (!isStaged(slide) || this.state !== 'live') return
    if (this.stage >= stageCount(slide) - 1) return
    this.stage += 1
    this.armStageTimer()
    this.touch()
    this.syncAll()
  }

  next() {
    this.goto(this.index + 1)
  }

  prev() {
    this.goto(Math.max(0, this.index - 1))
  }

  /** 時間到：停止收答案，畫面留在題目上等主持人公布 */
  lock() {
    clearTimeout(this._timer)
    clearTimeout(this._stageTimer)
    if (this.state !== 'live') return
    this.locked = true
    this.endsAt = null
    this.touch()
    this.syncAll()
  }

  /** 主持人的「下一步」：依目前狀態自動走到下一個合理畫面 */
  advance() {
    const slide = this.currentSlide
    if (this.state === 'lobby') return this.start()
    if (this.state === 'ended') return
    if (this.state === 'live') {
      if (!slide || slide.type === 'content' || slide.type === 'qa') return this.next()
      return this.reveal()
    }
    if (this.state === 'results') {
      if (slide && isGraded(slide) && this.settings.showLeaderboard !== false) return this.showLeaderboard()
      return this.next()
    }
    if (this.state === 'leaderboard') return this.next()
  }

  back() {
    if (this.state === 'results' || this.state === 'leaderboard') return this.goto(this.index)
    return this.prev()
  }

  reveal() {
    clearTimeout(this._timer)
    clearTimeout(this._stageTimer)
    if (this.state !== 'live') return
    this.state = 'results'
    this.locked = true
    this.endsAt = null
    // 公布答案時分階段題型直接全開
    const slide = this.currentSlide
    if (isStaged(slide)) this.stage = stageCount(slide) - 1
    this.applyScores(slide)
    this.touch()
    this.syncAll()
  }

  /**
   * 把這一題的分數與連對結算到參與者身上。
   *
   * 分數刻意留到公布答案才入帳：送出的當下就加分的話，手機上的總分和排名
   * 會立刻跳動 —— 等於在主持人公布之前就先告訴大家自己答對了沒。
   */
  private applyScores(slide: any) {
    if (!slide || this._scored.has(slide.id)) return
    this._scored.add(slide.id)
    for (const [pid, a] of this.answers.get(slide.id) || []) {
      const p = this.players.get(pid)
      if (!p) continue
      p.score += a.points || 0
      // 海龜湯猜錯當下不歸零是因為他還能再試，撐到公布都沒中才中斷連對
      p.streak = a.correct ? p.streak + 1 : 0
    }
  }

  showLeaderboard() {
    clearTimeout(this._timer)
    this.state = 'leaderboard'
    this.endsAt = null
    this.touch()
    this.syncAll()
  }

  end() {
    clearTimeout(this._timer)
    this.state = 'ended'
    this.endsAt = null
    this.touch()
    this.syncAll()
  }

  /** 加時：如果已經鎖住了就重新開放作答 */
  addTime(seconds: number) {
    if (this.state !== 'live') return
    clearTimeout(this._timer)
    const from = this.endsAt && !this.locked ? this.endsAt : Date.now()
    this.endsAt = from + seconds * 1000
    this.locked = false
    this._timer = setTimeout(() => this.lock(), this.endsAt - Date.now() + 250)
    this.touch()
    this.syncAll()
  }

  /* ---------------- 作答 ---------------- */

  submit(playerId: string, slideId: string, value: any) {
    const player = this.players.get(playerId)
    const slide = this.currentSlide
    if (!player || !slide) return { ok: false, error: '尚未開始' }
    if (this.state !== 'live') return { ok: false, error: '目前無法作答' }
    if (this.locked) return { ok: false, error: '時間到了，等主持人公布答案' }
    if (slide.id !== slideId) return { ok: false, error: '題目已經換了' }
    if (!isInteractive(slide)) return { ok: false, error: '這一頁不需要作答' }

    const bucket = this.answers.get(slide.id)!
    const existing = bucket.get(playerId)

    if (slide.type === 'open') {
      const max = Math.max(1, slide.maxSubmissions || 1)
      const list = existing ? [...existing.value] : []
      if (list.length >= max) return { ok: false, error: '已達提交次數上限' }
      const text = String(value || '').trim().slice(0, slide.maxChars || 200)
      if (!text) return { ok: false, error: '請先輸入內容' }
      list.push(text)
      bucket.set(playerId, { value: list, at: Date.now(), ms: Date.now() - this.startedAt!, ratio: 0, correct: false, points: 0 })
      this.touch()
      this.syncHosts()
      this.syncPlayer(player)
      return { ok: true }
    }

    /**
     * 複數答案：一題要湊好幾個答案，一個一個送、累積成一份清單。
     * 對錯與分數先算好放著，但公佈前不回傳（跟其他計分題一樣不先爆雷）。
     */
    if (slide.type === 'list') {
      const max = Math.max(1, slide.maxSubmissions || 10)
      const list = existing ? [...existing.value] : []
      if (list.length >= max) return { ok: false, error: `最多送出 ${max} 個答案` }
      const text = String(value || '').trim().slice(0, 80)
      if (!text) return { ok: false, error: '請先輸入答案' }
      if (list.some((t: string) => sameListAnswer(slide, t, text))) return { ok: false, error: '這個答案你已經寫過了' }
      list.push(text)
      const { ratio, correct } = grade(slide, list)
      const ms = Date.now() - this.startedAt!
      // 不吃速度加分（speedBonus=false）：這種題目是盡量湊多，不是比快
      const points = scoreFor(slide, ratio, ms, false, 0)
      bucket.set(playerId, { value: list, at: Date.now(), ms, ratio, correct, points, tries: list.length })
      this.touch()
      this.syncHosts()
      this.syncPlayer(player)
      return { ok: true }
    }

    /**
     * 海龜湯「每出一條新提示就能再猜一次」—— 這才是這種題目的玩法：
     * 先賭一把，猜錯了等下一條提示再修正。其他題型仍然只有一次機會。
     */
    if (existing) {
      if (slide.type !== 'soup') return { ok: false, error: '你已經作答過了' }
      if (existing.correct) return { ok: false, error: '你已經答對了' }
      if (existing.stage === this.stage) return { ok: false, error: '這條提示你已經猜過了，等下一條提示再試' }
    }

    const ms = Date.now() - this.startedAt!
    // 配對題送上來的是每人專屬的 token，先換回內部 id 再批改
    const clean = normalizeAnswer(slide, playerId, value)
    const { ratio, correct } = grade(slide, clean)
    // 分階段題型記下「在第幾階段答的」，越早階段分數越高
    const stage = isStaged(slide) ? this.stage : 0
    // 只先算好放著，等主持人公布答案時才由 applyScores 入帳
    const points = scoreFor(slide, ratio, ms, usesSpeedBonus(slide, this.settings), stage)

    bucket.set(playerId, {
      value: clean,
      at: Date.now(),
      ms,
      stage,
      ratio,
      correct,
      points,
      tries: (existing?.tries || 0) + 1,
    })

    // 海龜湯：這一輪大家都猜完了就自動出下一條提示（都猜對了就直接公布）
    if (this.maybeAdvanceSoupStage()) return { ok: true }
    // 其他題型全員答完就直接公布，不必再等主持人（reveal 自己會 syncAll）
    if (this.maybeAutoReveal()) return { ok: true }

    this.touch()
    this.syncHosts()
    this.syncPlayer(player)
    return { ok: true }
  }

  /**
   * 這一輪提示，是不是「該算進度」的人都表態了。
   *
   * 一位還連著的人算「這一輪完成」的條件：已經猜對（之後就不再作答），
   * 或這一輪已經猜過（answer.stage === 目前階段）。上一輪猜錯、這一輪還沒
   * 再猜的人不算 —— 要等他這一輪也出手，或計時器把大家帶到下一階段。
   */
  private soupDone(pid: string, bucket: Map<string, any>) {
    const a = bucket.get(pid)
    return !!a && (a.correct || a.stage === this.stage)
  }

  /** 海龜湯目前這一條提示，已經表態的人數（換提示就重新計）——給大螢幕顯示用 */
  private soupAnsweredThisStage(slide: any) {
    const bucket = this.answers.get(slide.id)
    if (!bucket) return 0
    let n = 0
    for (const p of this.players.values()) if (p.connected && this.soupDone(p.id, bucket)) n++
    return n
  }

  /**
   * 海龜湯：這一條提示大家都表態了就往下走。
   *
   * - 全部連線的人都猜對了 → 沒必要再拖，直接公布。
   * - 還有下一條提示 → 自動揭露，讓還沒猜中的人再猜一次（這就是「等全部人都答再
   *   公佈下一個線索」）。
   * - 已經是最後一條、還有人沒中 → 留給主持人公布，跟原本一樣。
   *
   * 只看「還連著的人」，理由跟 maybeAutoReveal 一樣：關掉分頁的人不會再作答，
   * 把他算進去這一輪永遠等不完。
   *
   * @returns 有沒有真的推進（推進了就由 nextStage / reveal 自己 syncAll）
   */
  private maybeAdvanceSoupStage() {
    const slide = this.currentSlide
    if (!slide || slide.type !== 'soup' || this.state !== 'live' || this.locked) return false
    const bucket = this.answers.get(slide.id)
    if (!bucket) return false
    const waiting = [...this.players.values()].filter((p) => p.connected)
    if (!waiting.length) return false
    if (!waiting.every((p) => this.soupDone(p.id, bucket))) return false
    if (waiting.every((p) => bucket.get(p.id)?.correct)) {
      this.reveal()
      return true
    }
    if (this.stage < stageCount(slide) - 1) {
      this.nextStage()
      return true
    }
    return false
  }

  /**
   * 大家都答完了就自動公布，不要乾等。
   *
   * 只看「還連著的人」：有人把分頁關掉就不會再作答了，把他算進去的話
   * 這一題永遠等不到自動公布。
   *
   * @returns 有沒有真的公布出去
   */
  private maybeAutoReveal() {
    const slide = this.currentSlide
    if (this.state !== 'live' || this.locked || !autoRevealable(slide)) return false
    const waiting = [...this.players.values()].filter((p) => p.connected)
    if (!waiting.length) return false
    const bucket = this.answers.get(slide.id)
    if (!bucket || waiting.some((p) => !bucket.has(p.id))) return false
    this.reveal()
    return true
  }

  /* ---------------- 表情符號 ---------------- */

  /**
   * 參與者送一個表情符號到大螢幕上。
   *
   * 刻意「不」廣播發送者是誰 —— 匿名才敢按。送出去的只有表符 id 和一個
   * 一次性的流水號（給前端當動畫的 key 用，不能反推是誰）。
   */
  react(playerId: string, reactionId: string) {
    const player = this.players.get(playerId)
    if (!player) return { ok: false, error: '尚未加入' }
    if (this.settings.reactionsEnabled === false) return { ok: false, error: '主持人已關閉表情符號' }

    const list = this.presentation.reactions || []
    const found = list.find((r: any) => r.id === reactionId)
    if (!found) return { ok: false, error: '沒有這個表情符號' }

    // 節流：每人每 700ms 最多一個，避免洗版或被拿來打伺服器
    const now = Date.now()
    const last = this._lastReaction.get(playerId) || 0
    if (now - last < 700) return { ok: false, error: '慢一點' }
    this._lastReaction.set(playerId, now)

    this.touch()
    // 主持端與參與者都在同一個 room 裡，一次廣播就夠；內容不含任何身分資訊
    this.io.to(this.room()).emit('reaction', { id: found.id, url: found.url, n: ++reactionSeq })
    return { ok: true }
  }

  /* ---------------- 觀眾提問 ---------------- */

  qaAsk(playerId: string, text: string) {
    const player = this.players.get(playerId)
    if (!player) return { ok: false, error: '尚未加入' }
    if (this.settings.qaEnabled === false) return { ok: false, error: '主持人已關閉提問功能' }
    const body = String(text || '').trim().slice(0, 300)
    if (!body) return { ok: false, error: '請先輸入問題' }
    const item = {
      id: uid('q_'),
      text: body,
      authorId: playerId,
      author: this.settings.qaAnonymous ? '匿名' : player.name,
      votes: [] as string[],
      answered: false,
      pinned: false,
      approved: this.settings.qaModeration !== true,
      createdAt: Date.now(),
    }
    this.qa.push(item)
    this.touch()
    this.syncAll()
    return { ok: true, id: item.id }
  }

  qaVote(playerId: string, questionId: string) {
    const q = this.qa.find((x) => x.id === questionId)
    if (!q || !this.players.has(playerId)) return { ok: false }
    const i = q.votes.indexOf(playerId)
    if (i >= 0) q.votes.splice(i, 1)
    else q.votes.push(playerId)
    this.touch()
    this.syncAll()
    return { ok: true }
  }

  qaUpdate(questionId: string, patch: any) {
    const q = this.qa.find((x) => x.id === questionId)
    if (!q) return
    Object.assign(q, patch)
    this.touch()
    this.syncAll()
  }

  qaDelete(questionId: string) {
    this.qa = this.qa.filter((x) => x.id !== questionId)
    this.touch()
    this.syncAll()
  }

  /**
   * @param forHost 主持人才看得到尚未審核的提問
   * @param viewerId 用來標記「我按過讚了」—— 只送布林值，不把投票者名單廣播出去
   */
  qaList(forHost: boolean, viewerId: string | null = null) {
    return this.qa
      .filter((q) => forHost || q.approved)
      .map((q) => ({
        id: q.id,
        text: q.text,
        author: q.author,
        votes: q.votes.length,
        voted: viewerId ? q.votes.includes(viewerId) : false,
        answered: q.answered,
        pinned: q.pinned,
        approved: q.approved,
        createdAt: q.createdAt,
      }))
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          Number(a.answered) - Number(b.answered) ||
          b.votes - a.votes ||
          a.createdAt - b.createdAt
      )
  }

  /* ---------------- 檢視資料 ---------------- */

  entriesFor(slide: any) {
    const bucket = this.answers.get(slide.id) || new Map()
    const out: any[] = []
    for (const [pid, a] of bucket) {
      const p = this.players.get(pid)
      if (!p) continue
      out.push({ playerId: pid, name: p.name, ...a })
    }
    return out
  }

  leaderboard(limit = 0) {
    const arr = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || null, score: p.score, streak: p.streak, connected: p.connected }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((p, i) => ({ ...p, rank: i + 1 }))
    return limit > 0 ? arr.slice(0, limit) : arr
  }

  hostView() {
    const slide = this.currentSlide
    // 海龜湯每換一條提示就重新算「這一輪答了幾個」；其他題型看整題累計的作答人數
    const answered = slide
      ? slide.type === 'soup'
        ? this.soupAnsweredThisStage(slide)
        : this.answers.get(slide.id)?.size ?? 0
      : 0
    return {
      code: this.code,
      joinUrl: this.joinUrl,
      title: this.presentation.title,
      theme: this.presentation.theme || 'slate',
      background: this.presentation.background || null,
      // 大廳那塊空白放封面圖：作者自己指定的優先，沒有就自動抓第一張題目圖
      cover: coverOf(this.presentation),
      // 大廳音樂只給主持端，手機端不會收到（也就不會有聲音）
      lobbyMusic: this.presentation.lobbyMusic || null,
      quizMusic: this.presentation.quizMusic || null,
      quizMusicVolume:
        typeof this.presentation.quizMusicVolume === 'number' ? this.presentation.quizMusicVolume : 35,
      reactions: this.presentation.reactions || [],
      state: this.state,
      locked: this.locked,
      stage: this.stage,
      stages: isStaged(slide) ? stageCount(slide) : 0,
      stagePoints: isStaged(slide) ? Math.round(stageFactor(slide, this.stage) * 100) : 100,
      index: this.index,
      total: this.slides.length,
      slide: slide
        ? {
            ...slide,
            graded: isGraded(slide),
            speedBonusOn: usesSpeedBonus(slide, this.settings),
            // 大螢幕要列出項目，但順序題的 items 就是正解順序，只能給打亂過的
            displayItems: displayItemsFor(slide),
          }
        : null,
      outline: this.slides.map((s: any) => ({ id: s.id, type: s.type, title: s.title })),
      endsAt: this.endsAt,
      serverNow: Date.now(),
      playerCount: this.players.size,
      connectedCount: [...this.players.values()].filter((p) => p.connected).length,
      answeredCount: answered,
      players: this.leaderboard(),
      results: slide && this.state !== 'lobby' ? aggregate(slide, this.entriesFor(slide)) : null,
      solution: slide && this.state === 'results' ? solutionOf(slide) : null,
      explain: slide && this.state === 'results' ? explainOf(slide) : null,
      qa: this.qaList(true),
      settings: this.settings,
    }
  }

  playerView(player: any) {
    const slide = this.currentSlide
    const bucket = slide ? this.answers.get(slide.id) : null
    const mine = bucket?.get(player.id) || null
    const board = this.leaderboard()
    const me = board.find((p) => p.id === player.id)
    const showResult = this.state === 'results' || this.state === 'leaderboard' || this.state === 'ended'
    /**
     * 海龜湯是唯一要即時回對錯的題型 —— 「猜錯了、等下一條提示再試」就是它的玩法，
     * 不告訴他猜錯就沒得玩。其他題型一律等公布，免得手機先一步爆雷。
     */
    const judged = showResult || slide?.type === 'soup'
    return {
      code: this.code,
      title: this.presentation.title,
      theme: this.presentation.theme || 'slate',
      background: this.presentation.background || null,
      reactions: this.presentation.reactions || [],
      state: this.state,
      locked: this.locked,
      stage: this.stage,
      stagePoints: isStaged(slide) ? Math.round(stageFactor(slide, this.stage) * 100) : 100,
      stages: isStaged(slide) ? stageCount(slide) : 0,
      index: this.index,
      total: this.slides.length,
      slide: slide && this.state !== 'lobby' ? slideForPlayer(slide, player.id, this.settings, this.stage) : null,
      endsAt: this.endsAt,
      serverNow: Date.now(),
      me: {
        id: player.id,
        name: player.name,
        avatar: player.avatar || null,
        score: player.score,
        rank: me?.rank ?? 0,
        streak: player.streak,
      },
      playerCount: this.players.size,
      myAnswer: mine
        ? {
            value: mine.value,
            correct: judged ? mine.correct : null,
            ratio: judged ? mine.ratio : null,
            points: judged ? mine.points : null,
            stage: mine.stage ?? 0,
            tries: mine.tries ?? 1,
            // 複數答案公佈時，逐一標出送出的每個答案對不對、共命中幾組
            ...(slide?.type === 'list' && judged
              ? (() => {
                  const r = listResult(slide, mine.value)
                  return { marks: r.marks, hits: r.hits, groupHit: r.groupHit }
                })()
              : {}),
          }
        : null,
      solution: slide && showResult ? solutionOf(slide) : null,
      // 解說跟正解一樣，公布之前不能外流
      explain: slide && showResult ? explainOf(slide) : null,
      results: slide && showResult ? aggregate(slide, this.entriesFor(slide)) : null,
      liveResults:
        slide && (slide.type === 'open' || slide.type === 'qa') && this.state === 'live'
          ? aggregate(slide, this.entriesFor(slide))
          : null,
      podium: this.state === 'leaderboard' || this.state === 'ended' ? this.leaderboard(5) : null,
      qa: this.qaList(false, player.id),
      settings: {
        qaEnabled: this.settings.qaEnabled !== false,
        qaUpvote: this.settings.qaUpvote !== false,
        qaAnonymous: this.settings.qaAnonymous !== false,
        reactionsEnabled: this.settings.reactionsEnabled !== false,
      },
    }
  }

  syncHosts() {
    if (!this.hostSockets.size) return
    const view = this.hostView()
    for (const id of this.hostSockets) this.io.to(id).emit('host:sync', view)
  }

  syncPlayer(player: any) {
    if (player.socketId) this.io.to(player.socketId).emit('player:sync', this.playerView(player))
  }

  syncPlayers() {
    for (const p of this.players.values()) this.syncPlayer(p)
  }

  syncAll() {
    clearTimeout(this._syncTimer)
    this._syncTimer = null
    this.syncHosts()
    this.syncPlayers()
  }

  /**
   * 合併短時間內的多次全體同步。
   *
   * 每個人的畫面內容都不一樣（分數、排名、自己的答案），所以一次 syncAll
   * 就要組出 n 份 playerView。開場時所有人幾乎同時掃 QR 進來，一人一次
   * syncAll 就是 O(n²)；併成一次廣播才不會在最尖峰的時候卡住。
   */
  syncAllSoon() {
    if (this._syncTimer) return
    this._syncTimer = setTimeout(() => this.syncAll(), 150)
    this._syncTimer.unref?.()
  }

  /** 匯出成績報表 */
  report() {
    const slides = this.slides.filter((s: any) => isInteractive(s))
    return {
      code: this.code,
      title: this.presentation.title,
      startedAt: this.createdAt,
      players: this.leaderboard(),
      slides: slides.map((s: any) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        graded: isGraded(s),
        results: aggregate(s, this.entriesFor(s)),
        entries: this.entriesFor(s).map((e) => ({ name: e.name, value: e.value, correct: e.correct, points: e.points, ms: e.ms })),
      })),
      qa: this.qaList(true),
    }
  }
}
