/** 題型的顯示資料（跟 server/utils/quiz.ts 的 SLIDE_TYPES 對應） */
export const TYPE_META: Record<string, { label: string; icon: string }> = {
  single: { label: '單選題', icon: 'radio-single' },
  multi: { label: '複選題', icon: 'check-multi' },
  truefalse: { label: '是非題', icon: 'truefalse' },
  match: { label: '配對題', icon: 'match' },
  categorize: { label: '分類題', icon: 'layers' },
  order: { label: '順序題', icon: 'order' },
  type: { label: '填空題', icon: 'keyboard' },
  list: { label: '複數答案', icon: 'list-check' },
  number: { label: '數字題', icon: 'hash' },
  soup: { label: '海龜湯', icon: 'layers' },
  reveal: { label: '猜圖題', icon: 'eye' },
  music: { label: '音樂題', icon: 'music' },
  scale: { label: '評分題', icon: 'sliders' },
  open: { label: '開放問題', icon: 'message-open' },
  qa: { label: '觀眾提問', icon: 'hand' },
  content: { label: '內容頁', icon: 'file-text' },
}

/** 用選項作答的題型（單選家族） */
export const CHOICE_TYPES = ['single', 'multi', 'truefalse', 'reveal', 'music']

/** 會分階段揭露資訊的題型 —— 用階段計分取代速度加分 */
export const STAGED_TYPES = ['reveal', 'soup']

export const OPTION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#22c55e', '#a855f7', '#ec4899']

/** 選項的形狀圖示（取代原本的 ▲◆●■ 字元，統一走 SVG） */
export const OPTION_SHAPES = ['triangle', 'diamond', 'circle', 'square', 'star', 'hexagon']

export const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

export function fmtDate(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 依伺服器時間校正的倒數計時 */
export function useCountdown() {
  const left = ref<number | null>(null)
  let raf: any = null
  let endsAt = 0
  let offset = 0

  function loop() {
    if (!endsAt) return
    left.value = Math.max(0, endsAt - (Date.now() + offset))
    if (left.value <= 0) return stop()
    raf = requestAnimationFrame(loop)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = null
    endsAt = 0
  }

  function start(_endsAt: number | null, serverNow?: number) {
    stop()
    if (!_endsAt) {
      left.value = null
      return
    }
    offset = serverNow ? serverNow - Date.now() : 0
    endsAt = _endsAt
    loop()
  }

  function clear() {
    stop()
    left.value = null
  }

  onScopeDispose(() => stop())
  return { left, start, clear }
}
