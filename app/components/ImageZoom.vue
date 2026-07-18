<script setup lang="ts">
const src = useZoomState()

/**
 * 放大時鍵盤全部歸這裡管。
 *
 * 一定要用 capture：主持端在 window 上也綁了一組快捷鍵（空白／Enter／→ = 下一步），
 * 那組是 bubble 階段。沒有先攔下來的話，主持人放大解說圖後想按空白關掉，
 * 會直接把簡報翻到下一題。
 */
function onKey(e: KeyboardEvent) {
  if (!src.value) return
  e.stopPropagation()
  if (['Escape', ' ', 'Enter'].includes(e.key)) {
    e.preventDefault()
    closeZoom()
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="zoom">
      <!-- 點哪裡都關得掉：這只是看圖，不用讓使用者找關閉鈕 -->
      <div v-if="src" class="zoom-mask" role="dialog" aria-modal="true" aria-label="放大檢視" @click="closeZoom">
        <img :src="src" alt="" />
        <button class="zoom-x" aria-label="關閉" @click="closeZoom"><AppIcon name="x" :size="18" /></button>
        <div class="zoom-tip">點任一處或按 Esc 關閉</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * 這裡要 flex 不能 grid：grid 只有一列而且是 auto 高，會被圖片的原始高度撐開，
 * 圖片的 max-height: 100% 就變成「相對於 1200px 的圖自己」，等於沒有限制，
 * 直式的圖會直接掉出畫面下方。flex item 的百分比高度是對容器的內容框算的，
 * 容器是 fixed inset:0，高度確定，才壓得住。
 */
.zoom-mask {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(8, 11, 20, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  cursor: zoom-out;
}

.zoom-mask img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--r);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
}

.zoom-x {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.zoom-x:hover {
  background: rgba(255, 255, 255, 0.22);
}

.zoom-tip {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
}

.zoom-enter-active,
.zoom-leave-active {
  transition: opacity 0.18s ease;
}

.zoom-enter-active img,
.zoom-leave-active img {
  transition: transform 0.18s cubic-bezier(0.34, 1.3, 0.64, 1);
}

.zoom-enter-from,
.zoom-leave-to {
  opacity: 0;
}

.zoom-enter-from img,
.zoom-leave-to img {
  transform: scale(0.94);
}

@media (max-width: 640px) {
  .zoom-mask {
    padding: 16px;
  }
}
</style>
