<script setup lang="ts">
/**
 * 分類題：把項目放進正確的分類。
 *
 * 手機上「拖曳」用 Pointer Events 自己做（HTML5 drag & drop 在觸控裝置根本不能用）。
 * 同一套手勢同時支援兩種操作：
 *   - 拖：按住移動，放開時落在哪個分類就放進哪個
 *   - 點：沒怎麼移動就當成點選，再點分類把它丟進去（手指不靈活時比較好按）
 */
const props = defineProps<{
  categories: { id: string; name: string }[]
  items: { id: string; text: string; image?: string | null }[]
  modelValue: Record<string, string>
}>()
const emit = defineEmits<{ 'update:modelValue': [Record<string, string>] }>()

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']
const colorOf = (catId: string) => COLORS[props.categories.findIndex((c) => c.id === catId) % COLORS.length]

const picked = ref<string | null>(null)
const dragId = ref<string | null>(null)
const dragPos = ref({ x: 0, y: 0 })
const hoverCat = ref<string | null>(null)
const boardEl = ref<HTMLElement | null>(null)

const unplaced = computed(() => props.items.filter((i) => !props.modelValue[i.id]))
const inCategory = (catId: string) => props.items.filter((i) => props.modelValue[i.id] === catId)
const allPlaced = computed(() => props.items.every((i) => props.modelValue[i.id]))

function assign(itemId: string, catId: string | null) {
  const next = { ...props.modelValue }
  if (catId) next[itemId] = catId
  else delete next[itemId]
  emit('update:modelValue', next)
  picked.value = null
  navigator.vibrate?.(12)
}

/** 找出這個座標底下是哪一個分類框 */
function catAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest('[data-cat]') as HTMLElement | null
  return el?.dataset.cat ?? null
}

let startX = 0
let startY = 0
let moved = false

function onDown(e: PointerEvent, itemId: string) {
  // 只理會主要按鍵／手指
  if (e.button !== 0 && e.pointerType === 'mouse') return
  dragId.value = itemId
  startX = e.clientX
  startY = e.clientY
  moved = false
  dragPos.value = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!dragId.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  // 移動超過門檻才算拖曳，否則當成點擊
  if (!moved && Math.hypot(dx, dy) > 6) moved = true
  if (!moved) return
  e.preventDefault()
  dragPos.value = { x: e.clientX, y: e.clientY }
  hoverCat.value = catAt(e.clientX, e.clientY)
}

function onUp(e: PointerEvent) {
  const id = dragId.value
  dragId.value = null
  hoverCat.value = null
  if (!id) return

  if (!moved) {
    // 當成點選：再點一次取消
    picked.value = picked.value === id ? null : id
    return
  }
  const cat = catAt(e.clientX, e.clientY)
  // 拖回未分類區就是拿出來
  if (cat) assign(id, cat)
  else if (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pool]')) assign(id, null)
}

/** 點選模式：點分類把選中的項目丟進去 */
function tapCategory(catId: string) {
  if (picked.value) assign(picked.value, catId)
}

const dragItem = computed(() => props.items.find((i) => i.id === dragId.value))

defineExpose({ allPlaced })
</script>

<template>
  <div ref="boardEl" class="cat-board" :class="{ dragging: !!dragId && !!dragItem }">
    <!-- 還沒分類的項目 -->
    <div class="pool" data-pool :class="{ empty: !unplaced.length }">
      <div v-if="!unplaced.length" class="pool-done">全部都放好了</div>
      <button
        v-for="it in unplaced"
        :key="it.id"
        class="chip-item"
        :class="{ picked: picked === it.id, ghost: dragId === it.id, 'has-img': !!it.image }"
        :aria-label="it.text || '圖片項目'"
        @pointerdown="onDown($event, it.id)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="dragId = null"
      >
        <img v-if="it.image" :src="it.image" class="cimg" alt="" draggable="false" />
        <span v-if="it.text">{{ it.text }}</span>
      </button>
    </div>

    <p class="tip">
      {{ picked ? '再點下面的分類，把它放進去' : '把項目拖進分類，或先點項目再點分類' }}
    </p>

    <!-- 分類框 -->
    <div class="cats">
      <div
        v-for="c in categories"
        :key="c.id"
        class="cat"
        :data-cat="c.id"
        :class="{ hot: hoverCat === c.id, armed: !!picked }"
        :style="{ '--cc': colorOf(c.id) }"
        @click="tapCategory(c.id)"
      >
        <div class="cat-name">{{ c.name }}</div>
        <div class="cat-body">
          <button
            v-for="it in inCategory(c.id)"
            :key="it.id"
            class="chip-item in"
            :class="{ ghost: dragId === it.id, 'has-img': !!it.image }"
            :style="{ '--cc': colorOf(c.id) }"
            :aria-label="it.text || '圖片項目'"
            @pointerdown.stop="onDown($event, it.id)"
            @pointermove.stop="onMove"
            @pointerup.stop="onUp"
            @pointercancel="dragId = null"
            @click.stop
          >
            <img v-if="it.image" :src="it.image" class="cimg" alt="" draggable="false" />
            <span v-if="it.text">{{ it.text }}</span>
          </button>
          <span v-if="!inCategory(c.id).length" class="cat-empty">拖到這裡</span>
        </div>
      </div>
    </div>

    <!-- 跟著手指跑的那一個 -->
    <Teleport to="body">
      <div
        v-if="dragId && dragItem"
        class="drag-ghost"
        :class="{ 'has-img': !!dragItem.image }"
        :style="{ left: dragPos.x + 'px', top: dragPos.y + 'px' }"
      >
        <img v-if="dragItem.image" :src="dragItem.image" class="cimg" alt="" draggable="false" />
        <span v-if="dragItem.text">{{ dragItem.text }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cat-board {
  touch-action: manipulation;
}

.cat-board.dragging {
  /* 拖曳中不要讓整頁跟著捲 */
  touch-action: none;
}

.pool {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 60px;
  padding: 12px;
  border-radius: var(--r);
  border: 2px dashed var(--t-line, rgba(255, 255, 255, 0.18));
  background: rgba(255, 255, 255, 0.04);
}

.pool.empty {
  min-height: 44px;
  align-items: center;
  justify-content: center;
}

.pool-done {
  font-size: 13px;
  font-weight: 700;
  color: var(--t-muted, rgba(255, 255, 255, 0.5));
}

.chip-item {
  --cc: #6366f1;
  border: 1px solid var(--t-line, rgba(255, 255, 255, 0.2));
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: transform 0.1s, background 0.15s, border-color 0.15s, opacity 0.15s;
}

/*
 * 有圖的項目：藥丸形狀換成卡片，圖在上、字在下；純圖片的就只有圖。
 * 圖一律 contain 不裁切 —— 看圖分類時被裁掉的常常正是判斷的依據。
 */
.chip-item.has-img,
.drag-ghost.has-img {
  border-radius: var(--r);
  padding: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  white-space: normal;
}

.cimg {
  display: block;
  height: 72px;
  max-width: 108px;
  object-fit: contain;
  border-radius: var(--r-sm);
  background: rgba(0, 0, 0, 0.32);
  pointer-events: none;
}

/*
 * 分類框裡的圖要小一號：手機上分類是並排的窄欄，
 * 用池子那個尺寸的話一個分類放兩三張就把整頁撐爆了。
 */
.cat-body .cimg {
  height: 46px;
  max-width: 100%;
}

.chip-item:active {
  cursor: grabbing;
}

.chip-item.picked {
  border-color: #fff;
  background: rgba(255, 255, 255, 0.28);
  transform: scale(1.05);
}

.chip-item.ghost {
  opacity: 0.3;
}

.chip-item.in {
  background: color-mix(in srgb, var(--cc) 30%, transparent);
  border-color: var(--cc);
}

.tip {
  font-size: 12px;
  font-weight: 600;
  color: var(--t-muted, rgba(255, 255, 255, 0.5));
  text-align: center;
  margin: 12px 0;
}

.cats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.cat {
  --cc: #6366f1;
  border: 2px solid var(--t-line, rgba(255, 255, 255, 0.16));
  border-radius: var(--r);
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}

.cat.hot {
  border-color: var(--cc);
  background: color-mix(in srgb, var(--cc) 18%, transparent);
  transform: scale(1.02);
}

.cat.armed {
  border-color: color-mix(in srgb, var(--cc) 60%, transparent);
  cursor: pointer;
}

.cat-name {
  background: var(--cc);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  padding: 8px 12px;
  text-align: center;
}

.cat-body {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
  min-height: 64px;
  align-content: flex-start;
}

.cat-empty {
  font-size: 12px;
  color: var(--t-muted, rgba(255, 255, 255, 0.35));
  font-weight: 600;
  margin: auto;
}
</style>

<style>
/* Teleport 出去的，不能用 scoped */
.drag-ghost {
  position: fixed;
  z-index: 999;
  transform: translate(-50%, -50%) scale(1.08);
  pointer-events: none;
  background: #6366f1;
  color: #fff;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}
</style>
