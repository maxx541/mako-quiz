<script setup lang="ts">
const props = defineProps<{ res: any }>()
const max = computed(() => Math.max(...(props.res?.words?.map((w: any) => w.count) || [1]), 1))
</script>

<template>
  <div v-if="!res || !res.total" class="empty">還沒有人回覆</div>

  <div v-else-if="res.display === 'list'" class="replies">
    <div v-for="(t, i) in res.texts.slice(-20).reverse()" :key="i" class="reply">
      <div class="who">{{ t.name }}</div>
      <div>{{ t.text }}</div>
    </div>
  </div>

  <div v-else class="cloud">
    <span
      v-for="(w, i) in res.words"
      :key="w.text"
      :style="{
        fontSize: 13 + Math.round((w.count / max) * 22) + 'px',
        color: OPTION_COLORS[i % OPTION_COLORS.length],
        opacity: 0.55 + (w.count / max) * 0.45,
      }"
    >{{ w.text }}</span>
  </div>
</template>

<style scoped>
.cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  justify-content: center;
  align-items: center;
  padding: 10px 0;
}

.cloud span {
  font-weight: 800;
  line-height: 1.2;
  animation: pop-in 0.3s ease-out;
}

.replies {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.reply {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--t-line, rgba(255, 255, 255, 0.12));
  border-radius: var(--r);
  padding: 10px 12px;
  font-size: 14px;
  text-align: left;
  line-height: 1.5;
  word-break: break-word;
}

.reply .who {
  font-size: 11px;
  color: var(--t-muted, rgba(255, 255, 255, 0.5));
  font-weight: 700;
  margin-bottom: 3px;
}

.empty {
  text-align: center;
  color: var(--t-muted, rgba(255, 255, 255, 0.4));
  font-size: 13px;
  padding: 24px 10px;
  font-weight: 600;
}
</style>
