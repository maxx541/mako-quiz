<script setup lang="ts">
/**
 * 猜圖題的揭露排程器。
 *
 * 把圖切成格線，一個階段一個階段指定「這一階段要新揭開哪幾塊」。
 * 每一塊只屬於一個階段（它第一次被揭開的那個），所以大螢幕上第 k 階段
 * 看到的就是第 0～k 階段的聯集 —— 揭開的東西不會再被蓋回去。
 *
 * 完全沒排的話就交還給系統自動揭（依 slide.id 算出一組固定的隨機順序）。
 */
const props = defineProps<{
  modelValue: number[][] | null | undefined
  src: string
  rows: number
  cols: number
  stages: number
}>()

const emit = defineEmits<{
  'update:modelValue': [number[][]]
  'update:rows': [number]
  'update:cols': [number]
}>()

const active = ref(0)
const total = computed(() => props.rows * props.cols)

/** 預覽框要縮成圖片的形狀，格子才會跟大螢幕上蓋的位置一致 */
const ratio = ref('16 / 9')
const onLoad = (e: Event) => {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = `${img.naturalWidth} / ${img.naturalHeight}`
}
watch(() => props.src, () => (ratio.value = '16 / 9'))

watch(
  () => props.stages,
  () => {
    if (active.value > props.stages - 1) active.value = Math.max(0, props.stages - 1)
  }
)

/**
 * 一律正規化再用：階段數和格數都是使用者隨時可以改的，
 * 改完之後舊的排程一定會有對不上的索引（超出格數、階段變少）。
 */
const plan = computed<number[][]>(() => {
  const src = Array.isArray(props.modelValue) ? props.modelValue : []
  const out: number[][] = []
  for (let i = 0; i < props.stages; i++) {
    out.push((src[i] || []).filter((n: any) => Number.isInteger(n) && n >= 0 && n < total.value))
  }
  return out
})

const planned = computed(() => plan.value.some((s) => s.length))

/** 這一塊在第幾階段第一次被揭開（-1 = 從頭到尾沒排到） */
function stageOf(tile: number) {
  for (let i = 0; i < plan.value.length; i++) if (plan.value[i].includes(tile)) return i
  return -1
}

/** 到目前這個階段為止看得到的格子 */
const visible = computed(() => {
  const s = new Set<number>()
  for (let i = 0; i <= active.value; i++) for (const t of plan.value[i]) s.add(t)
  return s
})

function commit(next: number[][]) {
  emit('update:modelValue', next)
}

function toggle(tile: number) {
  // 先從所有階段拿掉，再決定要不要放進目前這一階段 —— 一塊只能屬於一個階段
  const next = plan.value.map((s) => s.filter((t) => t !== tile))
  if (stageOf(tile) !== active.value) next[active.value].push(tile)
  commit(next)
}

/** 把還沒排到的格子全部丟進這一階段（通常用在最後一階段收尾） */
function fillStage() {
  const next = plan.value.map((s) => [...s])
  const taken = new Set(next.flat())
  for (let i = 0; i < total.value; i++) if (!taken.has(i)) next[active.value].push(i)
  commit(next)
}

const clearStage = () => commit(plan.value.map((s, i) => (i === active.value ? [] : [...s])))
const clearAll = () => commit([])

const unassigned = computed(() => total.value - new Set(plan.value.flat()).size)
const ROW_CHOICES = [2, 3, 4, 5, 6, 8, 10]
const COL_CHOICES = [2, 3, 4, 5, 6, 7, 8, 10, 12]
</script>

<template>
  <div class="planner">
    <div class="grid-size">
      <label>
        <span>列</span>
        <select :value="rows" class="select sm" @change="emit('update:rows', Number(($event.target as HTMLSelectElement).value))">
          <option v-for="v in ROW_CHOICES" :key="v" :value="v">{{ v }}</option>
        </select>
      </label>
      <label>
        <span>行</span>
        <select :value="cols" class="select sm" @change="emit('update:cols', Number(($event.target as HTMLSelectElement).value))">
          <option v-for="v in COL_CHOICES" :key="v" :value="v">{{ v }}</option>
        </select>
      </label>
      <div class="spacer" />
      <span class="count">共 {{ total }} 塊</span>
    </div>

    <!-- 階段頁籤：切到哪一階段，就是在編輯那一階段要新揭開的格子 -->
    <div class="stage-tabs">
      <button
        v-for="i in stages"
        :key="i"
        :class="{ on: active === i - 1 }"
        @click="active = i - 1"
      >
        第 {{ i }} 階段
        <b v-if="plan[i - 1]?.length">+{{ plan[i - 1].length }}</b>
      </button>
    </div>

    <!--
      比例一定要跟著「圖片自己」，不能用 cols/rows。
      大螢幕上的格子是精準蓋在圖上的，這裡要是形狀不一樣，
      你在編輯器點的那一塊，播出來就會對到別的地方。
    -->
    <div class="canvas" :style="{ aspectRatio: ratio }">
      <img :src="src" alt="" @load="onLoad" />
      <div class="cells" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }">
        <button
          v-for="i in total"
          :key="i"
          class="cell"
          :class="{
            covered: !visible.has(i - 1),
            now: stageOf(i - 1) === active,
            earlier: stageOf(i - 1) > -1 && stageOf(i - 1) < active,
          }"
          :title="stageOf(i - 1) > -1 ? `第 ${stageOf(i - 1) + 1} 階段揭開` : '還沒排到這一塊'"
          @click="toggle(i - 1)"
        >
          <span v-if="stageOf(i - 1) > -1" class="tag">{{ stageOf(i - 1) + 1 }}</span>
        </button>
      </div>
    </div>

    <div class="acts">
      <button class="mini" @click="fillStage">把剩下的全放進這一階段</button>
      <button class="mini" :disabled="!plan[active]?.length" @click="clearStage">清空這一階段</button>
      <button class="mini warn" :disabled="!planned" @click="clearAll">全部清掉（改回自動）</button>
    </div>

    <div class="hint-box">
      <template v-if="!planned">
        還沒排任何格子 —— 目前是<b>自動揭露</b>：系統會依這一題的 id 算出一組固定的順序，每階段揭開一批。
        點上面的格子就會改成照你排的走。
      </template>
      <template v-else>
        點格子指定它在<b>第 {{ active + 1 }} 階段</b>揭開；再點一次取消。已經揭開的不會再蓋回去。
        <template v-if="unassigned > 0">
          還有 <b>{{ unassigned }}</b> 塊沒排到，它們會留到公布答案才出現。
        </template>
        <template v-else>全部 {{ total }} 塊都排好了。</template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.planner {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.grid-size {
  display: flex;
  align-items: center;
  gap: 12px;
}

.grid-size label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.select.sm {
  padding: 5px 8px;
  font-size: 12px;
  width: auto;
}

.spacer {
  flex: 1;
}

.count {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.stage-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.stage-tabs button {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
}

.stage-tabs button.on {
  border-color: var(--accent, #6366f1);
  background: rgba(99, 102, 241, 0.12);
  color: var(--ink);
}

.stage-tabs button b {
  font-size: 10px;
  color: var(--accent, #6366f1);
}

.canvas {
  position: relative;
  width: 100%;
  border-radius: var(--r);
  overflow: hidden;
  background: #0b1220;
}

/* 框本身已經是圖的形狀了，所以 fill 不會變形，也不會留黑邊 */
.canvas img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.cells {
  position: absolute;
  inset: 0;
  display: grid;
}

.cell {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  position: relative;
  outline: 1px solid rgba(255, 255, 255, 0.14);
  outline-offset: -1px;
  transition: background 0.15s;
}

/*
 * 還沒揭到的蓋起來，跟大螢幕上看到的一樣。
 * 這個 class 千萬不能叫 .hidden —— main.css 有個全域的
 * .hidden { display: none !important }，整個遮罩會直接消失。
 */
.cell.covered {
  background: #0b1220;
}

.cell.covered:hover {
  background: #1e293b;
}

/* 這一階段新揭開的：框起來，一眼看出這次改了哪些 */
.cell.now {
  outline: 2px solid var(--accent, #6366f1);
  outline-offset: -2px;
}

.cell.earlier .tag {
  opacity: 0.5;
}

.cell .tag {
  position: absolute;
  top: 2px;
  left: 2px;
  min-width: 13px;
  height: 13px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  line-height: 13px;
  text-align: center;
}

.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini {
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.mini:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--accent, #6366f1);
}

.mini:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mini.warn:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}
</style>
