<script setup lang="ts">
const toasts = useToasts()
</script>

<template>
  <div>
    <NuxtPage />

    <AppDialog />
    <ImageZoom />

    <Teleport to="body">
      <div class="toasts">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" role="status">{{ t.text }}</div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<style>
.toasts {
  position: fixed;
  z-index: 300;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}

.toast {
  background: rgba(15, 23, 42, 0.94);
  color: #fff;
  padding: 11px 18px;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--sh-3);
  max-width: min(90vw, 420px);
  text-align: center;
}

.toast.bad {
  background: #b91c1c;
}

.toast.ok {
  background: #15803d;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s, transform 0.22s;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
