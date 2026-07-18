<script setup lang="ts">
/**
 * 表情符號浮層：收到 reaction 事件就從畫面下方浮出來，幾秒後淡出。
 *
 * 刻意不顯示發送者是誰 —— 匿名大家才敢按。
 * 伺服器送來的資料本來就不含身分，這裡也沒有任何地方可以推回去。
 */
const props = withDefaults(defineProps<{ socket: any; max?: number }>(), { max: 40 })

type Floater = { key: number; url: string; left: number; drift: number; scale: number; dur: number }
const items = ref<Floater[]>([])

function spawn(r: { id: string; url: string; n: number }) {
  // 同時湧入太多就丟掉舊的，避免洗版把瀏覽器拖垮
  if (items.value.length >= props.max) items.value.splice(0, items.value.length - props.max + 1)

  // 位置與飄移隨機一點，一堆人同時按才不會疊成一條線
  items.value.push({
    key: r.n,
    url: r.url,
    left: 8 + Math.random() * 84,
    drift: (Math.random() - 0.5) * 90,
    scale: 0.85 + Math.random() * 0.5,
    dur: 2600 + Math.random() * 1200,
  })
}

function onEnd(key: number) {
  const i = items.value.findIndex((x) => x.key === key)
  if (i >= 0) items.value.splice(i, 1)
}

onMounted(() => props.socket?.on('reaction', spawn))
onBeforeUnmount(() => props.socket?.off('reaction', spawn))

defineExpose({ spawn, items })
</script>

<template>
  <div class="reaction-layer" aria-hidden="true">
    <img
      v-for="it in items"
      :key="it.key"
      :src="it.url"
      class="floater"
      :style="{
        left: it.left + '%',
        '--drift': it.drift + 'px',
        '--scale': it.scale,
        animationDuration: it.dur + 'ms',
      }"
      @animationend="onEnd(it.key)"
    />
  </div>
</template>

<style scoped>
.reaction-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 40;
}

.floater {
  position: absolute;
  bottom: 0;
  width: 52px;
  height: 52px;
  object-fit: contain;
  will-change: transform, opacity;
  animation-name: float-up;
  animation-timing-function: cubic-bezier(0.25, 0.6, 0.35, 1);
  animation-fill-mode: forwards;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
}

@keyframes float-up {
  0% {
    transform: translate(-50%, 20px) scale(0.4);
    opacity: 0;
  }
  12% {
    transform: translate(-50%, -10px) scale(var(--scale));
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    transform: translate(calc(-50% + var(--drift)), -58vh) scale(var(--scale));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .floater {
    animation-name: fade-only;
  }
  @keyframes fade-only {
    0% {
      opacity: 0;
      transform: translate(-50%, -20vh) scale(var(--scale));
    }
    20%,
    70% {
      opacity: 1;
      transform: translate(-50%, -20vh) scale(var(--scale));
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -20vh) scale(var(--scale));
    }
  }
}
</style>
