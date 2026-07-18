<script setup lang="ts">
defineProps<{ q: any; upvote?: boolean }>()
const emit = defineEmits<{ vote: [string] }>()
</script>

<template>
  <div class="qa-item" :class="{ answered: q.answered, pinned: q.pinned }">
    <!-- 有沒有按過讚由伺服器依 session 身分判定，重連回來狀態也還在 -->
    <button v-if="upvote" class="vote" :class="{ on: q.voted }" @click="emit('vote', q.id)">
      <AppIcon name="chevron-up" :size="12" />
      <span class="n">{{ q.votes }}</span>
    </button>
    <div v-else class="vote"><span class="n">{{ q.votes }}</span></div>

    <div class="qa-text">
      <p>{{ q.text }}</p>
      <div class="qa-meta">
        <span>{{ q.author }}</span>
        <span v-if="q.answered" class="chip chip-ok">已回答</span>
        <span v-if="q.pinned" class="chip"><AppIcon name="pin" :size="10" /> 主持人挑選</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qa-item {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.qa-item.answered {
  opacity: 0.5;
}

.qa-item.pinned {
  border-color: rgba(250, 204, 21, 0.5);
  background: rgba(250, 204, 21, 0.09);
}

.qa-text {
  flex: 1;
  min-width: 0;
}

.qa-text p {
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.qa-meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-weight: 700;
  margin-top: 5px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.qa-meta .chip {
  padding: 1px 7px;
  font-size: 10px;
}

.vote {
  flex: none;
  width: 46px;
  border-radius: var(--r-sm);
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 6px 0;
  cursor: pointer;
  font-weight: 800;
  transition: background 0.15s, border-color 0.15s;
}

button.vote:hover {
  background: rgba(255, 255, 255, 0.14);
}

.vote.on {
  background: rgba(99, 102, 241, 0.34);
  border-color: #818cf8;
  color: #c7d2fe;
}

.vote .n {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
</style>
