<script setup lang="ts">
useHead({ title: '加入活動 · Makoquiz' })

const route = useRoute()
const code = ref('')
const name = ref('')
const step = ref<'code' | 'name'>('code')
const room = ref<{ title: string; players: number } | null>(null)
const error = ref('')
const busy = ref(false)
const nameEl = ref<HTMLInputElement | null>(null)
const codeEl = ref<HTMLInputElement | null>(null)

watch(code, (v) => {
  const clean = v.replace(/\D/g, '').slice(0, 6)
  if (clean !== v) code.value = clean
  error.value = ''
  if (clean.length === 6) check()
})

async function check() {
  if (code.value.length !== 6 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const data = await $fetch<any>(`/api/sessions/${code.value}/exists`)
    room.value = data
    step.value = 'name'
    name.value = localStorage.getItem('ql_name') || ''
    await nextTick()
    nameEl.value?.focus()
  } catch (err: any) {
    error.value = err?.data?.data?.error || err?.data?.error || '找不到這個房間'
  } finally {
    busy.value = false
  }
}

function join() {
  const n = name.value.trim()
  if (!n) return nameEl.value?.focus()
  localStorage.setItem('ql_name', n)
  navigateTo(`/play?c=${code.value}&n=${encodeURIComponent(n)}`)
}

function back() {
  step.value = 'code'
  nextTick(() => codeEl.value?.focus())
}

onMounted(() => {
  // 從 QR Code 進來會直接帶代碼
  const pre = String(route.query.c || '')
  if (/^\d{6}$/.test(pre)) code.value = pre
  else codeEl.value?.focus()
})
</script>

<template>
  <div class="wrap">
    <div class="inner">
      <div class="brand">
        <img src="/icon.png" alt="" class="brand-mark" />
        <h1>Makoquiz</h1>
        <p>輸入主持人螢幕上的房間代碼即可加入</p>
      </div>

      <div class="panel">
        <div v-if="step === 'code'">
          <div class="lbl">房間代碼</div>
          <input
            ref="codeEl"
            v-model="code"
            class="code-input"
            inputmode="numeric"
            autocomplete="off"
            maxlength="6"
            placeholder="000000"
            aria-label="房間代碼"
            @keydown.enter="check"
          />
          <button class="go" :disabled="busy || code.length !== 6" @click="check">
            {{ busy ? '查詢中…' : '下一步' }}
          </button>
          <div v-if="error" class="err">{{ error }}</div>
        </div>

        <div v-else>
          <div class="found">
            <AppIcon name="check" :size="15" />
            已找到「{{ room?.title }}」　目前 {{ room?.players }} 人
          </div>
          <div class="lbl" style="margin-top: 18px">你的暱稱</div>
          <input
            ref="nameEl"
            v-model="name"
            class="name-input"
            maxlength="20"
            placeholder="例如：小明"
            autocomplete="off"
            aria-label="暱稱"
            @keydown.enter="join"
          />
          <button class="go" :disabled="!name.trim()" @click="join">加入活動</button>
          <button class="link" @click="back">換一個代碼</button>
        </div>
      </div>

      <div class="foot">
        <NuxtLink to="/admin">我是主持人 · 前往管理後台</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #0f172a;
  color: #f1f5f9;
}

.inner {
  width: 100%;
  max-width: 420px;
}

.brand {
  text-align: center;
  margin-bottom: 22px;
  color: #a5b4fc;
}

.brand-mark {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  object-fit: cover;
  margin: 0 auto 4px;
  display: block;
}

.brand h1 {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-top: 8px;
  color: #f8fafc;
}

.brand p {
  color: rgba(248, 250, 252, 0.6);
  font-size: 14px;
  margin-top: 6px;
}

.panel {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--r-xl);
  padding: 26px 22px;
  backdrop-filter: blur(14px);
  box-shadow: var(--sh-3);
}

.code-input,
.name-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--r-lg);
  color: #fff;
  outline: none;
  transition: border-color 0.16s, box-shadow 0.16s;
}

.code-input {
  text-align: center;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 0.28em;
  padding: 16px 12px 16px 22px;
}

.code-input::placeholder {
  color: rgba(248, 250, 252, 0.28);
  letter-spacing: 0.2em;
}

.name-input {
  font-size: 16px;
  font-weight: 600;
  padding: 14px 16px;
}

.name-input::placeholder {
  color: rgba(248, 250, 252, 0.3);
  font-weight: 500;
}

.code-input:focus,
.name-input:focus {
  border-color: #818cf8;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25);
}

.lbl {
  font-size: 12px;
  font-weight: 700;
  color: rgba(248, 250, 252, 0.55);
  margin-bottom: 8px;
  letter-spacing: 0.06em;
}

.go {
  width: 100%;
  margin-top: 20px;
  padding: 15px;
  font-size: 17px;
  font-weight: 800;
  border: none;
  border-radius: var(--r-lg);
  background: var(--brand);
  color: #fff;
  cursor: pointer;
  transition: transform 0.12s, background 0.15s, opacity 0.15s;
}

.go:hover:not(:disabled) {
  background: var(--brand-600);
}

.go:active:not(:disabled) {
  transform: translateY(1px);
}

.go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.link {
  width: 100%;
  margin-top: 10px;
  background: none;
  border: none;
  color: rgba(248, 250, 252, 0.5);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px;
}

.link:hover {
  color: #c7d2fe;
}

.err,
.found {
  margin-top: 14px;
  border-radius: var(--r);
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.err {
  background: rgba(220, 38, 38, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.45);
  color: #fecaca;
}

.found {
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(74, 222, 128, 0.4);
  color: #bbf7d0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.foot {
  text-align: center;
  margin-top: 22px;
  font-size: 13px;
}

.foot a {
  color: rgba(248, 250, 252, 0.5);
  text-decoration: none;
  font-weight: 600;
}

.foot a:hover {
  color: #c7d2fe;
}
</style>
