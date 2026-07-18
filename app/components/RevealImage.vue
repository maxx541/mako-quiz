<script setup lang="ts">
/**
 * CG／立繪分階段揭露。
 *
 * 三種模式：
 *  - tiles：切成格子，每階段揭開一批（最經典的「猜圖」手感）
 *  - blur ：從糊到清楚
 *  - zoom ：從局部放大慢慢拉遠
 *
 * 格子的揭開順序用 slide.id 當種子算出來 —— 主持人畫面跟每支手機
 * 都要看到「一模一樣」的揭露進度，所以絕對不能用 Math.random()。
 */
const props = withDefaults(
  defineProps<{
    src: string
    stage: number
    stages: number
    mode?: 'tiles' | 'blur' | 'zoom'
    /** 公布答案後直接全開 */
    revealed?: boolean
    rows?: number
    cols?: number
    seed?: string
    /**
     * 每階段各自要揭開哪幾塊（格子索引）。
     * 有排程就照排程走，沒有就用 seed 算出來的固定隨機順序。
     */
    tiles?: number[][] | null
  }>(),
  { mode: 'tiles', revealed: false, rows: 5, cols: 7, seed: '', tiles: null }
)

function hashStr(s: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const total = computed(() => props.rows * props.cols)

/** 格子揭開的先後順序（同一個 seed 一定算出同一組順序） */
const order = computed(() => {
  const rnd = mulberry32(hashStr(props.seed || props.src))
  const a = [...Array(total.value).keys()]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
})

/** 有沒有自訂排程（每一階段各自指定要揭哪幾塊） */
const scheduled = computed(() => Array.isArray(props.tiles) && props.tiles.some((t) => t?.length))

/** 自動模式下，進行到這個階段時該有幾塊是開的 */
const shownCount = computed(() => {
  const n = Math.max(2, props.stages)
  const k = Math.min(Math.max(0, props.stage), n - 1)
  // 最後一階段留一點沒開，公布答案時才全開，比較有懸念
  return Math.round(total.value * ((k + 1) / n) * 0.92)
})

const hidden = computed(() => {
  // 公布答案一律全開 —— 不管是排程還是自動，最後都要看得到完整的圖
  if (props.revealed) return new Set<number>()

  if (scheduled.value) {
    const list = props.tiles!
    const k = Math.min(Math.max(0, props.stage), list.length - 1)
    // 累積：前面階段揭開的不會再被蓋回去
    const shown = new Set<number>()
    for (let i = 0; i <= k; i++) for (const t of list[i] || []) shown.add(t)
    const out = new Set<number>()
    for (let i = 0; i < total.value; i++) if (!shown.has(i)) out.add(i)
    return out
  }

  return new Set(order.value.slice(shownCount.value))
})

/**
 * 圖片本身的長寬比。
 *
 * 格子遮罩是鋪在容器上的，所以容器必須「剛好等於圖」——
 * 不然 object-fit: contain 會在旁邊留黑邊，格子就跟著蓋到黑邊上，
 * 編輯器裡點的「第 3 塊」在大螢幕上會對到圖的另一個地方。
 */
const ratio = ref<number | null>(null)
const onLoad = (e: Event) => {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = img.naturalWidth / img.naturalHeight
}
watch(() => props.src, () => (ratio.value = null))

const zoomSpot = computed(() => {
  const rnd = mulberry32(hashStr((props.seed || props.src) + ':zoom'))
  return { x: 20 + rnd() * 60, y: 20 + rnd() * 60 }
})

const imgStyle = computed(() => {
  const n = Math.max(2, props.stages)
  const k = Math.min(Math.max(0, props.stage), n - 1)
  const t = props.revealed ? 1 : k / (n - 1) // 0 = 最遮蔽，1 = 全開
  if (props.mode === 'blur') {
    return { filter: `blur(${(1 - t) * 26}px)`, transform: 'scale(1.06)' }
  }
  if (props.mode === 'zoom') {
    const scale = props.revealed ? 1 : 3.4 - t * 2.4
    return { transform: `scale(${scale})`, transformOrigin: `${zoomSpot.value.x}% ${zoomSpot.value.y}%` }
  }
  return {}
})
</script>

<template>
  <!--
    模式的 class 一定要加前綴。
    直接寫 :class="mode" 的話，mode='tiles' 會讓根元素也吃到下面那條給
    格子遮罩用的 .tiles（position:absolute; inset:0），整個元件就會跳出
    .reveal-box、貼著 .canvas 攤開，把倒數計時和標題全蓋掉。
  -->
  <div class="reveal" :class="['mode-' + mode, { sized: ratio !== null }]" :style="{ '--ar': ratio ?? 1 }">
    <img :src="src" alt="" :style="imgStyle" @load="onLoad" />

    <!-- 格子模式：沒揭開的格子蓋起來 -->
    <div v-if="mode === 'tiles'" class="tiles" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }">
      <i v-for="i in total" :key="i" :class="{ off: hidden.has(i - 1) }" />
    </div>
  </div>
</template>

<style scoped>
.reveal {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--r-lg);
  background: #000;
}

/*
 * 量到圖片比例之後，容器就縮成「跟圖一樣的形狀」——
 * 這正是 object-fit: contain 會算出來的尺寸，只是改由容器自己承擔，
 * 於是黑邊落在容器外面，格子遮罩就跟圖片精準對齊了。
 * （父層 .reveal-box 有 container-type: size，cq 單位才有東西可以參照）
 */
.reveal.sized {
  width: min(100cqw, calc(100cqh * var(--ar)));
  height: min(100cqh, calc(100cqw / var(--ar)));
}

.reveal img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: filter 0.6s ease, transform 0.6s ease;
}

.tiles {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 0;
}

.tiles i {
  background: #0b1220;
  opacity: 0;
  transition: opacity 0.45s ease;
}

.tiles i.off {
  opacity: 1;
}
</style>
