<script setup lang="ts">
useHead({ title: '管理後台 · Makoquiz' })

const route = useRoute()
const nextUrl = computed(() => String(route.query.next || ''))

const ready = ref(false)
const loggedIn = ref(false)
const password = ref('')
const busy = ref(false)
const loginError = ref('')
const list = ref<any[]>([])
const fileEl = ref<HTMLInputElement | null>(null)
const pwEl = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  if (auth.token) {
    try {
      const { ok } = await api<{ ok: boolean }>('/auth/check', { silent: true })
      if (ok) {
        if (nextUrl.value) return location.replace(nextUrl.value)
        loggedIn.value = true
        await refresh()
      } else {
        auth.clear()
      }
    } catch {
      auth.clear()
    }
  }
  ready.value = true
  if (!loggedIn.value) await nextTick(() => pwEl.value?.focus())
})

async function login() {
  if (busy.value) return
  busy.value = true
  loginError.value = ''
  try {
    const { token } = await api<{ token: string }>('/auth/login', {
      method: 'POST',
      body: { password: password.value },
      silent: true,
    })
    auth.token = token
    if (nextUrl.value) return location.replace(nextUrl.value)
    loggedIn.value = true
    await refresh()
  } catch (err: any) {
    loginError.value = err.message || '登入失敗'
    password.value = ''
    pwEl.value?.focus()
  } finally {
    busy.value = false
  }
}

function logout() {
  auth.clear()
  location.reload()
}

async function refresh() {
  list.value = await api('/presentations')
}

async function create() {
  const title = await promptDialog({
    title: '新增簡報',
    message: '幫這份簡報取個名字，之後隨時可以改。',
    placeholder: '例如：Galgame 知識大挑戰',
    defaultValue: '未命名簡報',
    okText: '建立',
  })
  if (title === null) return
  const p = await api<any>('/presentations', { method: 'POST', body: { title } })
  navigateTo('/editor?id=' + p.id)
}

async function duplicate(p: any) {
  await api(`/presentations/${p.id}/duplicate`, { method: 'POST' })
  toast('已複製', 'ok')
  refresh()
}

async function remove(p: any) {
  const yes = await confirmDialog({
    title: `刪除「${p.title}」？`,
    message: '這份簡報和它的所有題目都會被刪除，無法復原。',
    okText: '刪除',
    danger: true,
  })
  if (!yes) return
  await api('/presentations/' + p.id, { method: 'DELETE' })
  toast('已刪除', 'ok')
  refresh()
}

/**
 * 卡片上的「播放」。
 *
 * 清單裡只有 slideCount，檢查缺漏要拿完整的簡報，所以先抓一次再掃。
 * 抓不到就不要卡住他 —— 直接讓他去播，總比按了沒反應好。
 */
async function play(p: any) {
  try {
    const full = await api('/presentations/' + p.id)
    if (!(await confirmPlay(full))) return
  } catch {
    /* 檢查失敗不擋播放 */
  }
  navigateTo({ path: '/present', query: { id: p.id } })
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * 匯出。有素材就打包成 .zip（presentation.json ＋ assets/），沒有就給乾淨的 .json。
 *
 * 打包邏輯在 ~/utils/bundle.ts 的 buildBundle()，跟「發布到市集」共用同一份 ——
 * 市集收的就是這個 zip，兩邊各寫一份遲早會走鐘。
 */
async function exportBundle(p: any) {
  if (exporting.value) return
  exporting.value = p.id
  try {
    const full = await api<any>('/presentations/' + p.id)
    const { kind, blob, assetCount } = await buildBundle(full, { readme: BUNDLE_README })
    if (kind === 'json') {
      download(blob, `${p.title}.json`)
      toast('已匯出 JSON（這份沒有用到圖片或音樂）', 'ok')
      return
    }
    download(blob, `${p.title}.zip`)
    toast(`已匯出整包（含 ${assetCount} 個素材）`, 'ok')
  } catch (err: any) {
    toast('匯出失敗：' + err.message, 'bad')
  } finally {
    exporting.value = ''
  }
}

const BUNDLE_README = `這是一份 Makoquiz 簡報包。

內容：
  presentation.json   題目本體（素材用 assets/ 底下的檔名指過去）
  assets/             題目用到的圖片與音樂

怎麼還原：
  1. 打開 Makoquiz 管理後台 → 匯入題目
  2. 直接把這個 .zip 丟進去（或選擇檔案）
  3. 匯入時會自動把 assets/ 裡的檔案重新上傳並接回題目

想換掉某張圖：直接換掉 assets/ 裡的同名檔案就好，不用改 JSON。
想自己出題：presentation.json 的格式見專案的 docs/AI-出題指南.md。
`

/* ---------------- 一鍵匯入 ---------------- */

// AI 出題指南整份帶進前端，讓使用者一鍵複製、直接貼給 AI，不用自己去翻專案的檔案。
// ?raw 是 Vite 的功能：把檔案原文當字串載進來（打包時就決定，不需要執行期讀檔）。
// @ts-expect-error ?raw import 沒有型別
import aiGuide from '~~/docs/AI-出題指南.md?raw'

const importOpen = ref(false)
const importText = ref('')
const importBusy = ref(false)
const importStatus = ref('')
const guideCopied = ref(false)

async function copyGuide() {
  if (await copyText(aiGuide)) {
    guideCopied.value = true
    setTimeout(() => (guideCopied.value = false), 2500)
    toast('已複製出題指南，貼給 ChatGPT / Claude 再說一句主題就能生題', 'ok')
  } else {
    toast('複製失敗，可手動開啟 docs/AI-出題指南.md 貼給 AI', 'bad')
  }
}

/**
 * 複製文字到剪貼簿。
 * 先試新版的 async clipboard API；它在非 https、部分瀏覽器政策、或沒授權時會被擋，
 * 這時退回老方法（塞一個隱藏 textarea 再 execCommand('copy')）—— 相容性更廣。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 落到下面的後備方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
const exporting = ref('')

/**
 * 使用者附上的素材：檔名（小寫、去路徑）→ 檔案內容。
 * 來源可以是 .zip 裡的 assets/，也可以是直接選的一堆圖。
 */
const supplied = ref(new Map<string, { name: string; blob: Blob }>())

/** 即時檢查貼上的 JSON，讓使用者按下匯入前就知道會發生什麼 */
const importCheck = computed(() => {
  const raw = importText.value.trim()
  if (!raw) return null
  let data: any
  try {
    data = JSON.parse(raw)
  } catch (err: any) {
    return { ok: false, msg: 'JSON 格式錯誤：' + err.message }
  }
  if (!data || typeof data !== 'object') return { ok: false, msg: '最外層要是一個物件' }
  if (!Array.isArray(data.slides)) return { ok: false, msg: '缺少 slides 陣列' }
  if (!data.slides.length) return { ok: false, msg: 'slides 是空的' }
  const bad = data.slides.findIndex((s: any) => !s?.type || !TYPE_META[s.type])
  if (bad >= 0) return { ok: false, msg: `第 ${bad + 1} 題的 type 不正確（${data.slides[bad]?.type ?? '空的'}）` }
  const counts: Record<string, number> = {}
  for (const s of data.slides) counts[s.type] = (counts[s.type] || 0) + 1
  const summary = Object.entries(counts)
    .map(([t, n]) => `${TYPE_META[t]?.label ?? t} ${n}`)
    .join('、')

  // 素材對得起來嗎？在按下匯入之前就要講清楚，不要匯完才發現一片空白
  const need: string[] = []
  const missing: string[] = []
  walkAssets(data, ({ value }) => {
    if (isExternal(value) || isDataUri(value) || isLocalUpload(value)) return
    need.push(value)
    if (!supplied.value.has(assetKey(value))) missing.push(assetKey(value))
  })

  let assetMsg = ''
  if (need.length) {
    const got = need.length - missing.length
    assetMsg = ` · 素材 ${got}/${need.length}`
    if (missing.length) assetMsg += `，缺 ${[...new Set(missing)].slice(0, 3).join('、')}${missing.length > 3 ? ` 等 ${missing.length} 個` : ''}`
  }

  return {
    ok: true,
    warn: missing.length > 0,
    msg: `「${data.title || '未命名'}」共 ${data.slides.length} 題 · ${summary}${assetMsg}`,
    data,
  }
})

async function doImport() {
  const check = importCheck.value
  if (!check?.ok) return
  importBusy.value = true
  try {
    const data = JSON.parse(JSON.stringify(check.data))

    // 把 JSON 裡的邏輯名稱換成這台機器上真的 /uploads/… 網址
    const jobs: { ref: AssetRef; blob: Blob; name: string }[] = []
    walkAssets(data, (ref) => {
      if (isExternal(ref.value) || isLocalUpload(ref.value)) return
      if (isDataUri(ref.value)) {
        jobs.push({ ref, blob: dataUriToBlob(ref.value), name: ref.label })
        return
      }
      const hit = supplied.value.get(assetKey(ref.value))
      if (hit) jobs.push({ ref, blob: hit.blob, name: hit.name })
      else ref.set(null) // 找不到就當作沒有圖，其他題目照樣匯入
    })

    let done = 0
    for (const j of jobs) {
      importStatus.value = `上傳素材 ${++done}/${jobs.length}…`
      const fd = new FormData()
      fd.append('file', j.blob, j.name)
      // silent：失敗訊息由下面的 catch 統一報，不然會跳兩個 toast
      const res = await api<any>('/upload', { method: 'POST', body: fd, silent: true })
      j.ref.set(res.url)
    }

    importStatus.value = '建立簡報…'
    const p = await api<any>('/import', { method: 'POST', body: data, silent: true })
    toast(jobs.length ? `匯入成功（還原了 ${jobs.length} 個素材）` : '匯入成功', 'ok')
    importOpen.value = false
    importText.value = ''
    supplied.value = new Map()
    navigateTo('/editor?id=' + p.id)
  } catch (err: any) {
    toast('匯入失敗：' + err.message, 'bad')
  } finally {
    importBusy.value = false
    importStatus.value = ''
  }
}

function dataUriToBlob(uri: string) {
  const [head, b64] = uri.split(',')
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'application/octet-stream'
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

/**
 * 匯入時可以一次丟：一個 .zip（整包）、一個 .json、或 JSON ＋ 一堆圖片。
 * 圖片依「檔名」跟 JSON 裡寫的名字對起來，所以自己出題的人只要把圖命名成
 * JSON 裡寫的那個名字就好，不用管內部的 /uploads/ 網址。
 */
async function takeFiles(list: FileList | File[]) {
  const files = [...list]
  const zip = files.find((f) => /\.zip$/i.test(f.name))
  if (zip) {
    const { unzipSync } = await import('fflate')
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    for (const [pathname, buf] of Object.entries(entries)) {
      if (pathname.endsWith('/') || !buf.length) continue
      const base = assetKey(pathname)
      if (/\.json$/i.test(base)) importText.value = new TextDecoder().decode(buf)
      else if (!/^讀我\.txt$|^readme/i.test(base)) {
        supplied.value.set(base, { name: base, blob: new Blob([buf as BlobPart]) })
      }
    }
    supplied.value = new Map(supplied.value)
    if (!importText.value) toast('這個 zip 裡沒有 presentation.json', 'bad')
    return
  }

  for (const f of files) {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') importText.value = await f.text()
    else supplied.value.set(f.name.toLowerCase(), { name: f.name, blob: f })
  }
  supplied.value = new Map(supplied.value)
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) await takeFiles(input.files)
  input.value = ''
}

const dragging = ref(false)
async function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files?.length) await takeFiles(e.dataTransfer.files)
}
</script>

<template>
  <div>
    <!-- 登入 -->
    <div v-if="ready && !loggedIn" class="login-wrap">
      <form class="login-card" @submit.prevent="login">
        <div class="logo"><img src="/icon.png" alt="Makoquiz" /></div>
        <h1>主持人登入</h1>
        <p class="sub">輸入密碼以管理你的互動簡報</p>
        <div class="field">
          <label class="label" for="pw">密碼</label>
          <input
            id="pw"
            ref="pwEl"
            v-model="password"
            class="input"
            type="password"
            placeholder="請輸入密碼"
            autocomplete="current-password"
          />
        </div>
        <div v-if="loginError" class="login-err">{{ loginError }}</div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="busy">
          {{ busy ? '登入中…' : '登入' }}
        </button>
        <p class="hint">
          預設密碼為 <code class="mono">admin123</code>，可用環境變數
          <code class="mono">NUXT_HOST_PASSWORD</code> 修改
        </p>
      </form>
    </div>

    <!-- 後台 -->
    <div v-else-if="ready">
      <header class="appbar">
        <NuxtLink class="brand" to="/admin">
          <img src="/icon.png" alt="" class="brand-icon" />
          Makoquiz
        </NuxtLink>
        <div class="spacer" />
        <NuxtLink class="btn btn-sm" to="/gallery"><AppIcon name="layers" :size="14" /> 題庫市集</NuxtLink>
        <button class="btn btn-sm" @click="importOpen = true"><AppIcon name="upload" :size="14" /> 匯入題目</button>
        <button class="btn btn-primary btn-sm" @click="create"><AppIcon name="plus" :size="14" /> 新增簡報</button>
        <AppHelp />
        <button class="btn btn-ghost btn-sm" @click="logout"><AppIcon name="logout" :size="14" /> 登出</button>
      </header>

      <div class="page">
        <div class="page-head">
          <div>
            <h1>我的互動簡報</h1>
            <p>{{ list.length ? `共 ${list.length} 份簡報` : '還沒有任何簡報' }}</p>
          </div>
          <div class="spacer" />
          <a class="btn btn-sm" href="/" target="_blank">參與者入口</a>
        </div>

        <div class="grid">
          <div v-if="!list.length" class="empty-box">
            <AppIcon name="file-text" :size="44" :stroke="1.4" />
            <h3>還沒有任何簡報</h3>
            <p>建立第一份互動簡報，開始你的搶答活動</p>
            <button class="btn btn-primary" style="margin-top: 16px" @click="create">
              <AppIcon name="plus" :size="14" /> 新增簡報
            </button>
          </div>

          <div v-for="p in list" :key="p.id" class="pcard">
            <div class="cover" :class="p.theme || 'slate'" @click="navigateTo('/editor?id=' + p.id)">
              <img v-if="p.cover" :src="p.cover" alt="" class="cover-img" />
              <span class="cover-cap">{{ p.slideCount }} 張投影片</span>
            </div>
            <div class="body" @click="navigateTo('/editor?id=' + p.id)">
              <h3 :title="p.title">{{ p.title }}</h3>
              <div class="sub">更新於 {{ fmtDate(p.updatedAt) }}</div>
            </div>
            <div class="acts">
              <button
                class="btn btn-sm btn-primary"
                :disabled="!p.slideCount"
                :title="p.slideCount ? '播放' : '請先新增投影片'"
                @click="play(p)"
              >
                <AppIcon name="play" :size="13" /> 播放
              </button>
              <button class="btn btn-sm" @click="navigateTo('/editor?id=' + p.id)">
                <AppIcon name="edit" :size="13" /> 編輯
              </button>
              <div class="spacer" />
              <button class="btn btn-sm btn-ghost btn-icon" title="複製" @click="duplicate(p)">
                <AppIcon name="copy" :size="14" />
              </button>
              <button
                class="btn btn-sm btn-ghost btn-icon"
                :disabled="exporting === p.id"
                title="匯出（有圖片或音樂時打包成 .zip，可在別台還原）"
                @click="exportBundle(p)"
              >
                <AppIcon name="download" :size="14" />
              </button>
              <button class="btn btn-sm btn-ghost btn-icon danger" title="刪除" @click="remove(p)">
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 一鍵匯入 -->
    <div v-if="importOpen" class="modal" @mousedown.self="importOpen = false">
      <div
        class="modal-card"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <h2>匯入題目</h2>
        <p class="modal-sub">
          三種都行：把<b>整包 .zip</b> 丟進來會連圖片與音樂一起還原；貼上 <b>JSON</b> 題庫
          再把用到的圖片一起拖進來（依檔名對應）；或直接貼上文字題庫。
        </p>

        <!-- 讓 AI 幫你出題：一鍵複製指南，貼給 AI 就能生出可匯入的 JSON -->
        <div class="ai-hint">
          <div class="ai-hint-text">
            <b>想讓 AI 幫你出題？</b>
            複製出題指南，貼給 ChatGPT / Claude / Gemini，再說一句你要的主題（例如「幫我出 15 題
            Galgame 主題」），把它產生的 JSON 貼回這裡即可。
          </div>
          <button class="btn btn-sm" :class="{ 'btn-primary': !guideCopied }" @click="copyGuide">
            <AppIcon :name="guideCopied ? 'check' : 'copy'" :size="13" />
            {{ guideCopied ? '已複製' : '複製出題指南' }}
          </button>
        </div>

        <textarea
          v-model="importText"
          class="textarea import-box mono"
          rows="8"
          placeholder='把 .zip / .json / 圖片拖進來，或直接貼上 { "title": "…", "slides": [ … ] }'
          spellcheck="false"
        />

        <div v-if="supplied.size" class="assets">
          <div class="assets-head">
            <AppIcon name="image" :size="13" /> 已附上 {{ supplied.size }} 個素材
            <button class="btn btn-sm btn-ghost" @click="supplied = new Map()">清除</button>
          </div>
          <div class="assets-list mono">
            <span v-for="[k, v] in [...supplied].slice(0, 12)" :key="k">{{ v.name }}</span>
            <span v-if="supplied.size > 12">…還有 {{ supplied.size - 12 }} 個</span>
          </div>
        </div>

        <div v-if="importCheck" class="check" :class="importCheck.ok ? (importCheck.warn ? 'warn' : 'ok') : 'bad'">
          <AppIcon :name="importCheck.ok ? (importCheck.warn ? 'alert' : 'check') : 'alert'" :size="14" />
          {{ importCheck.msg }}
        </div>
        <div class="modal-acts">
          <button class="btn" @click="fileEl?.click()"><AppIcon name="upload" :size="13" /> 選擇檔案</button>
          <div class="spacer" />
          <button class="btn" @click="importOpen = false">取消</button>
          <button class="btn btn-primary" :disabled="!importCheck?.ok || importBusy" @click="doImport">
            {{ importBusy ? importStatus || '匯入中…' : '匯入' }}
          </button>
        </div>

        <p class="modal-foot">
          <AppIcon name="download" :size="12" />
          <span>
            想搬到另一台？在簡報卡片按<b>匯出</b>：有圖片或音樂會打包成 <code class="mono">.zip</code>
            （含全部素材），純文字題庫則給乾淨的 <code class="mono">.json</code>——都能丟回這裡還原。
          </span>
        </p>
      </div>
    </div>

    <input
      ref="fileEl"
      type="file"
      multiple
      accept=".zip,application/zip,application/json,.json,image/*,audio/*"
      class="hidden"
      @change="onImportFile"
    />
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #0f172a;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: var(--r-xl);
  padding: 32px 28px;
  box-shadow: var(--sh-3);
}

.login-card .logo {
  text-align: center;
  color: var(--brand);
}

.login-card .logo img {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  object-fit: cover;
}

.brand-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
}

.login-card h1 {
  font-size: 21px;
  font-weight: 800;
  text-align: center;
  margin: 10px 0 4px;
}

.login-card .sub {
  text-align: center;
  color: var(--ink-3);
  font-size: 13px;
  margin-bottom: 22px;
}

.login-err {
  background: var(--bad-soft);
  border: 1px solid #fca5a5;
  color: #b91c1c;
  border-radius: var(--r);
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 14px;
}

.hint {
  margin-top: 14px;
  font-size: 12px;
  color: var(--ink-4);
  text-align: center;
  line-height: 1.7;
}

.appbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 900;
  font-size: 16px;
  letter-spacing: -0.02em;
  text-decoration: none;
  color: var(--ink);
}

.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 20px 60px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.page-head h1 {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.page-head p {
  color: var(--ink-3);
  font-size: 14px;
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 16px;
}

.pcard {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
  transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s;
  display: flex;
  flex-direction: column;
}

.pcard:hover {
  box-shadow: var(--sh-2);
  transform: translateY(-2px);
  border-color: #d5d9e2;
}

.cover {
  position: relative;
  height: 96px;
  display: flex;
  align-items: flex-end;
  padding: 12px 16px;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  overflow: hidden;
}

.cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/*
 * 字要壓在圖上，所以自己帶一層暗底 —— 主題色當背景時看得到，
 * 蓋在亮色的 CG 上時也還讀得出來。
 */
.cover-cap {
  position: relative;
  background: rgba(15, 23, 42, 0.55);
  border-radius: 999px;
  padding: 3px 9px;
}

.cover.slate {
  background: #0f172a;
}
.cover.graphite {
  background: #18181b;
}
.cover.navy {
  background: #0b1f3a;
}
.cover.plum {
  background: #1e1030;
}
.cover.forest {
  background: #0b2a22;
}
.cover.paper {
  background: #eef1f5;
  color: #475569;
}

.body {
  padding: 14px 16px;
  flex: 1;
  cursor: pointer;
}

.body h3 {
  font-size: 16px;
  font-weight: 800;
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body .sub {
  font-size: 12px;
  color: var(--ink-4);
  font-weight: 600;
}

.acts {
  display: flex;
  gap: 4px;
  padding: 10px 12px;
  border-top: 1px solid var(--line-2);
  background: #fbfcfe;
  align-items: center;
}

.acts .danger:hover {
  background: var(--bad-soft);
  color: var(--bad);
}

/* ---------------- 匯入 ---------------- */

.modal {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-card {
  background: #fff;
  border-radius: var(--r-xl);
  padding: 24px;
  width: 100%;
  max-width: 640px;
  box-shadow: var(--sh-3);
  animation: fade-up 0.2s ease-out;
}

.modal-card h2 {
  font-size: 19px;
  font-weight: 800;
}

.modal-sub {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.7;
  margin: 6px 0 14px;
}

.ai-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--brand-soft, #eef2ff);
  border: 1px solid var(--brand-line, #dfe4fb);
  border-radius: var(--r);
  padding: 12px 14px;
  margin-bottom: 14px;
}

.ai-hint-text {
  flex: 1;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-2, var(--ink-3));
}

.ai-hint .btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.modal-foot {
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.65;
  color: var(--ink-3);
  display: flex;
  gap: 6px;
}

.modal-foot svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.import-box {
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
}

.check {
  margin-top: 12px;
  border-radius: var(--r);
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 7px;
}

.check.ok {
  background: var(--ok-soft);
  color: #15803d;
}

.check.bad {
  background: var(--bad-soft);
  color: #b91c1c;
}

/* 素材缺一部分還是能匯入，只是要先講清楚，所以用黃色不用紅色 */
.check.warn {
  background: #fef3c7;
  color: #b45309;
}

.modal-card.dragging {
  outline: 2px dashed var(--brand);
  outline-offset: -6px;
}

.assets {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 10px 12px;
}

.assets-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  color: var(--ink-3);
}

.assets-head .btn {
  margin-left: auto;
}

.assets-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
  max-height: 66px;
  overflow-y: auto;
}

.modal-acts {
  display: flex;
  gap: 8px;
  margin-top: 18px;
  align-items: center;
}

.empty-box {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  border: 2px dashed var(--line);
  border-radius: var(--r-lg);
  color: var(--ink-4);
}

.empty-box h3 {
  color: var(--ink-2);
  font-size: 17px;
  margin: 10px 0 6px;
}

.empty-box p {
  font-size: 13px;
}
</style>
