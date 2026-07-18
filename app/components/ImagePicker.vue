<script setup lang="ts">
/**
 * 圖片上傳。題目用大尺寸（cover），選項用小尺寸（chip）。
 * 上傳後只把 URL 存進投影片資料，檔案本身放在伺服器的 data/uploads。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | null
    /** cover=題目大圖、chip=選項旁的小圖示 */
    variant?: 'cover' | 'chip'
    label?: string
  }>(),
  { variant: 'cover', label: '加入圖片' }
)
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const fileEl = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const dragging = ref(false)

/**
 * 大圖平常收起來，按了才展開拖放區 —— 多數題目沒有圖，
 * 沒必要讓一塊空的虛線框一直佔著版面。已經有圖的話就直接展開。
 */
const expanded = ref(false)
const showDrop = computed(() => expanded.value || dragging.value)

watch(
  () => props.modelValue,
  (v) => {
    if (!v) expanded.value = false
  }
)

async function upload(file: File | undefined | null) {
  if (!file) return
  if (!file.type.startsWith('image/')) return toast('請選擇圖片檔', 'bad')
  busy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await $fetch<{ url: string }>('/api/upload', {
      method: 'POST',
      body: fd,
      headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
    })
    emit('update:modelValue', res.url)
    toast('圖片已上傳', 'ok')
  } catch (err: any) {
    toast(err?.data?.data?.error || err?.data?.error || '上傳失敗', 'bad')
  } finally {
    busy.value = false
    if (fileEl.value) fileEl.value.value = ''
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  upload(e.dataTransfer?.files?.[0])
}

/**
 * 直接用外部網址。
 *
 * 資料層本來就吃網址：bundle.ts 的 walkAssets／isExternal 會把 http(s) 開頭的
 * 原樣保留、不打包（換一台機器也照樣連得到），缺的只是這個入口。
 *
 * 代價要講清楚：那張圖是別人家的，對方換掉或砍掉，你的題目就開天窗 ——
 * 所以正式活動還是建議上傳。
 */
async function pasteUrl() {
  const url = await promptDialog({
    title: '用圖片網址',
    message:
      '貼上圖片的直接連結（要 .png / .jpg / .gif / .webp 結尾的那種，不是網頁網址）。\n\n' +
      '注意：圖存在對方的伺服器上，他哪天換掉或刪掉，你的題目就會開天窗。' +
      '正式活動建議還是用上傳的。',
    placeholder: 'https://example.com/cg.png',
    defaultValue: isExternal(props.modelValue || '') ? props.modelValue! : '',
    okText: '使用這個網址',
  })
  if (url === null) return
  const v = url.trim()
  if (!v) return
  if (!/^https?:\/\//i.test(v)) return toast('網址要用 http:// 或 https:// 開頭', 'bad')
  emit('update:modelValue', v)
  expanded.value = false
  toast('已設定圖片網址', 'ok')
}
</script>

<template>
  <div class="picker" :class="[variant, { dragging }]">
    <!-- 大圖（題目用）：平常收合，按了才展開 -->
    <template v-if="variant === 'cover'">
      <div v-if="modelValue" class="preview">
        <img :src="modelValue" alt="" />
        <div class="tools">
          <button class="btn btn-sm" :disabled="busy" @click="fileEl?.click()">
            <AppIcon name="edit" :size="12" /> 更換
          </button>
          <button class="btn btn-sm" :disabled="busy" @click="pasteUrl">
            <AppIcon name="link" :size="12" /> 網址
          </button>
          <button class="btn btn-sm danger" :disabled="busy" @click="emit('update:modelValue', null)">
            <AppIcon name="trash" :size="12" /> 移除
          </button>
        </div>
        <!-- 用網址的話要講清楚這張圖不在你手上 -->
        <div v-if="isExternal(modelValue)" class="ext-tag" title="這張圖存在別人的伺服器上，對方換掉就會失效">
          <AppIcon name="link" :size="10" /> 外部網址
        </div>
      </div>

      <!-- 收合狀態：只有一顆小按鈕。整個區域仍然接受拖放，拖進來就自動展開。 -->
      <button
        v-else-if="!showDrop"
        class="add-image"
        :disabled="busy"
        @click="expanded = true"
        @dragover.prevent="dragging = true"
      >
        <AppIcon name="image" :size="14" />
        <span>{{ busy ? '上傳中…' : label }}</span>
      </button>

      <button
        v-else
        class="drop"
        :disabled="busy"
        @click="fileEl?.click()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
        @blur="dragging = false"
      >
        <AppIcon name="image" :size="22" />
        <span>{{ busy ? '上傳中…' : '點擊選檔，或把圖片拖進來' }}</span>
        <small>PNG / JPG / GIF / WebP · 最大 5 MB</small>
        <span class="url-link" role="button" @click.stop="pasteUrl">或貼上圖片網址</span>
        <span class="cancel" role="button" @click.stop="expanded = false">取消</span>
      </button>
    </template>

    <!-- 小圖（選項用）：平常只是一個淡淡的小圖示，不搶版面；
         有圖之後才變成縮圖，角落一個叉叉可以移除。 -->
    <div v-else class="chip-slot">
      <button
        class="chip-btn"
        :class="{ filled: !!modelValue }"
        :disabled="busy"
        :title="modelValue ? '更換圖片' : label"
        @click="fileEl?.click()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <img v-if="modelValue" :src="modelValue" alt="" />
        <AppIcon v-else :name="busy ? 'clock' : 'image'" :size="14" />
        <span class="sr-only">{{ modelValue ? '更換圖片' : label }}</span>
      </button>
      <button v-if="modelValue" class="chip-x" title="移除圖片" @click="emit('update:modelValue', null)">
        <AppIcon name="x" :size="10" />
      </button>
    </div>

    <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="upload(($event.target as HTMLInputElement).files?.[0])" />
  </div>
</template>

<style scoped>
.picker {
  width: 100%;
}

.drop {
  width: 100%;
  border: 1px dashed #c7cdd8;
  background: #fff;
  border-radius: var(--r);
  color: var(--ink-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.cover .drop {
  flex-direction: column;
  padding: 22px 14px;
  gap: 6px;
}

.drop small {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-4);
}

.drop:hover:not(:disabled),
.dragging .drop {
  border-color: var(--brand);
  color: var(--brand-600);
  background: var(--brand-soft);
}

.drop:disabled {
  opacity: 0.5;
  cursor: wait;
}

.preview {
  position: relative;
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
  background: var(--line-2);
}

.cover .preview img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  background: #0f172a;
}

/* ---- 題目大圖：收合狀態的小按鈕 ---- */

.add-image {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: var(--r);
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-4);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.add-image:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand-600);
  background: var(--brand-soft);
}

.drop .cancel {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ink-4);
  text-decoration: underline;
  font-weight: 700;
}

.drop .cancel:hover {
  color: var(--bad);
}

.drop .url-link {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--brand);
  text-decoration: underline;
  font-weight: 700;
}

/* 用外部網址時標一下，讓人知道這張圖不在自己手上 */
.ext-tag {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  border-radius: 999px;
  padding: 2px 7px;
}

/* ---- 選項用的小圖示 ---- */

.chip {
  width: 30px;
  flex: none;
}

.chip-slot {
  position: relative;
  width: 30px;
  height: 30px;
}

/*
 * 平常只是一個淡淡的圖示（半透明），不要跟選項文字搶注意力；
 * 滑過去或已經有圖時才變清楚。
 */
.chip-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--ink-4);
  opacity: 0.35;
  cursor: pointer;
  display: grid;
  place-items: center;
  overflow: hidden;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}

.chip-btn:hover:not(:disabled),
.dragging .chip-btn {
  opacity: 1;
  color: var(--brand-600);
  background: var(--brand-soft);
}

.chip-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.chip-btn.filled {
  opacity: 1;
  border: 1px solid var(--line);
  background: var(--line-2);
}

.opt-row:hover .chip-btn:not(.filled) {
  opacity: 0.7;
}

.chip-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.chip-x {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: none;
  background: var(--ink-2);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  box-shadow: var(--sh-1);
}

.chip-x:hover {
  background: var(--bad);
}

.tools {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  gap: 4px;
}

.tools .btn {
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(6px);
}

.tools .danger:hover {
  background: var(--bad);
  border-color: var(--bad);
  color: #fff;
}
</style>
