<script setup lang="ts">
/**
 * 公布答案時，把「每個人各自打了什麼」逐人列出來（可滾動）。
 *
 * 只要是自己輸入答案的題型（填空、數字、海龜湯、複數答案）都用這個 ——
 * 統計長條看的是「大家答了什麼」，這個看的是「誰答了什麼」，兩個一起才完整。
 *
 * 複數答案（list = true）一個人有一串答案，每個標上對錯；其他題型一人一個答案。
 */
defineProps<{
  people?: { name: string; value?: string; correct?: boolean; hits?: number; items?: { text: string; ok: boolean }[] }[]
  list?: boolean
}>()
</script>

<template>
  <div v-if="people?.length" class="people-scroll">
    <div class="ps-head"><AppIcon name="users" :size="12" /> 每個人的回答（{{ people.length }} 人）</div>
    <div class="ps-list">
      <template v-if="list">
        <div v-for="(p, i) in people" :key="i" class="ps-row is-list">
          <span class="ps-name">{{ p.name }}</span>
          <span class="ps-items">
            <span v-for="(it, j) in p.items" :key="j" class="ps-item" :class="it.ok ? 'ok' : 'no'">{{ it.text }}</span>
            <span v-if="!p.items?.length" class="ps-empty">（沒有作答）</span>
          </span>
          <span class="ps-hits">{{ p.hits }}</span>
        </div>
      </template>
      <template v-else>
        <div v-for="(p, i) in people" :key="i" class="ps-row" :class="{ ok: p.correct }">
          <span class="ps-name">{{ p.name }}</span>
          <span class="ps-val">{{ p.value || '（空白）' }}</span>
          <AppIcon v-if="p.correct" name="check" :size="14" class="ps-mark" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.people-scroll {
  margin-top: 14px;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.ps-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(241, 245, 249, 0.6);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

/* 可滾動：人多也不會把整個舞台撐爆 */
.ps-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ps-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 15px;
}

.ps-row.ok {
  background: rgba(34, 197, 94, 0.14);
}

.ps-name {
  flex: 0 0 auto;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  color: rgba(241, 245, 249, 0.72);
}

.ps-val {
  flex: 1;
  overflow-wrap: anywhere;
  font-weight: 700;
}

.ps-mark {
  flex: none;
  color: #4ade80;
}

/* 複數答案：一個人一串小標籤 */
.ps-row.is-list {
  align-items: flex-start;
}

.ps-items {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.ps-item {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}

.ps-item.ok {
  background: rgba(34, 197, 94, 0.22);
  color: #bbf7d0;
}

.ps-item.no {
  background: rgba(148, 163, 184, 0.16);
  color: rgba(226, 232, 240, 0.6);
  text-decoration: line-through;
}

.ps-empty {
  font-size: 13px;
  color: rgba(226, 232, 240, 0.4);
}

.ps-hits {
  flex: none;
  min-width: 24px;
  text-align: center;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #4ade80;
}
</style>
