<script setup lang="ts">
const props = defineProps<{ view: any; hint?: string }>()
const meta = computed(() => TYPE_META[props.view.slide.type] || { label: '', icon: 'info' })
const pointsLabel = computed(() => {
  const s = props.view.slide
  return s.points === 'double' ? '雙倍分數' : s.points === 'none' ? '不計分' : null
})
</script>

<template>
  <div class="qhead">
    <div class="qmeta">
      <span class="tag"><AppIcon :name="meta.icon" :size="12" /> {{ meta.label }}</span>
      <span>第 {{ view.index + 1 }} / {{ view.total }} 題</span>
      <span v-if="pointsLabel" class="tag">{{ pointsLabel }}</span>
      <span v-if="view.slide.speedBonus && view.slide.timeLimit > 0 && view.slide.points !== 'none'" class="tag">
        <AppIcon name="clock" :size="11" /> 越快越高分
      </span>
    </div>
    <h1 class="qtitle">{{ view.slide.title }}</h1>
    <!-- 手機上題目圖最多只有 30vh，細節看不清楚，所以也讓它點得開 -->
    <img
      v-if="view.slide.image"
      :src="view.slide.image"
      class="qimg zoomable"
      alt="題目圖片，點擊放大"
      @click="openZoom(view.slide.image)"
    />
    <div v-if="hint" class="qhint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.qhead {
  margin-bottom: 16px;
}

.qmeta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  font-weight: 700;
  color: var(--t-muted, rgba(255, 255, 255, 0.55));
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.qmeta .tag {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  padding: 3px 9px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.qtitle {
  font-size: 20px;
  font-weight: 800;
  line-height: 1.4;
  letter-spacing: -0.01em;
}

.qimg {
  display: block;
  width: 100%;
  max-height: 30vh;
  object-fit: contain;
  border-radius: var(--r);
  margin-top: 12px;
  background: rgba(0, 0, 0, 0.25);
}

.qhint {
  font-size: 13px;
  color: var(--t-muted, rgba(255, 255, 255, 0.55));
  margin-top: 8px;
  font-weight: 600;
}

@media (min-width: 640px) {
  .qtitle {
    font-size: 24px;
  }
}
</style>
