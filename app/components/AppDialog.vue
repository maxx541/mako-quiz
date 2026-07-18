<script setup lang="ts">
const dialog = useDialogState()
const value = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

watch(dialog, async (d) => {
  if (!d) return
  value.value = d.defaultValue ?? ''
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
})

const ok = () => closeDialog(dialog.value?.kind === 'prompt' ? value.value.trim() : true)
const cancel = () => closeDialog(dialog.value?.kind === 'prompt' ? null : false)
const okDisabled = computed(() => dialog.value?.kind === 'prompt' && !value.value.trim())
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog" class="mask" @mousedown.self="cancel" @keydown.esc="cancel">
      <div class="box" role="dialog" aria-modal="true" :aria-label="dialog.title">
        <h2>{{ dialog.title }}</h2>
        <p v-if="dialog.message">{{ dialog.message }}</p>
        <input
          v-if="dialog.kind === 'prompt'"
          ref="inputEl"
          v-model="value"
          class="input"
          :placeholder="dialog.placeholder"
          maxlength="120"
          @keydown.enter="!okDisabled && ok()"
        />
        <div class="acts">
          <button class="btn" @click="cancel">{{ dialog.cancelText || '取消' }}</button>
          <button class="btn" :class="dialog.danger ? 'btn-danger' : 'btn-primary'" :disabled="okDisabled" @click="ok">
            {{ dialog.okText || '確定' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 20px;
  animation: fade 0.15s;
}

@keyframes fade {
  from {
    opacity: 0;
  }
}

.box {
  background: #fff;
  color: var(--ink);
  border-radius: var(--r-xl);
  padding: 24px;
  width: 100%;
  max-width: 400px;
  box-shadow: var(--sh-3);
  animation: up 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}

@keyframes up {
  from {
    transform: translateY(12px) scale(0.98);
    opacity: 0;
  }
}

h2 {
  font-size: 17px;
  font-weight: 800;
}

/*
 * pre-wrap：播放前的缺漏檢查會一行列一頁，全部擠成一段就看不出有幾個問題。
 * 清單長的時候讓它自己捲，對話框不要撐破畫面。
 */
p {
  color: var(--ink-3);
  font-size: 13.5px;
  line-height: 1.6;
  margin-top: 6px;
  white-space: pre-wrap;
  max-height: 46vh;
  overflow-y: auto;
}

.input {
  margin-top: 14px;
}

.acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
