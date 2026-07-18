<script setup lang="ts">
/**
 * 題庫市集。
 *
 * 這是整個程式**唯一**會碰到雲端的地方，而且只在三個時刻：逛、上架、下載。
 * 下載回來的東西會走現有的匯入流程落地成本地簡報，之後編輯、播放、辦活動
 * 全部走本地 —— 所以市集連不上只是逛不了，不影響辦活動。
 */
useHead({ title: '題庫市集 · Makoquiz' })

const items = ref<any[]>([])
const total = ref(0)
const source = ref('')
const remote = ref(false)
/** 這台機器有沒有市集管理權限（雲端市集要有 secret key，只有主人那台才有） */
const canAdmin = ref(false)
const loading = ref(true)
const failed = ref('')

const q = ref('')
const type = ref('')
const sort = ref<'new' | 'popular'>('new')

const mine = ref<any[]>([])
const publishing = ref('')
const author = ref('')
const pubDesc = ref('')
const pickOpen = ref(false)
const downloading = ref('')

/** 市集後台：沿用主持人密碼（已經登入就是有權限） */
const adminOpen = ref(false)
const adminItems = ref<any[]>([])

onMounted(async () => {
  if (!auth.token) return auth.gotoLogin()
  author.value = localStorage.getItem('ql_author') || ''
  await Promise.all([refresh(), loadMine()])
})

async function refresh() {
  loading.value = true
  failed.value = ''
  try {
    const p = new URLSearchParams()
    if (q.value.trim()) p.set('q', q.value.trim())
    if (type.value) p.set('type', type.value)
    p.set('sort', sort.value)
    const res = await $fetch<any>('/api/gallery?' + p)
    items.value = res.items
    total.value = res.total
    source.value = res.source
    remote.value = res.remote
    canAdmin.value = !!res.canAdmin
  } catch (err: any) {
    // 市集連不上不是世界末日，把話講清楚就好
    failed.value = err?.data?.data?.error || '市集連不上，你的簡報和活動都不受影響'
  } finally {
    loading.value = false
  }
}

const loadMine = async () => (mine.value = await api<any[]>('/presentations').catch(() => []))

let searchTimer: any = null
watch([q, type, sort], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refresh, 250)
})

/* ---------------- 發布 ---------------- */

async function publish(p: any) {
  const name = author.value.trim()
  if (!name) return toast('請先填製作者名稱', 'bad')
  if (publishing.value) return
  publishing.value = p.id
  try {
    const full = await api<any>('/presentations/' + p.id)
    // 市集一定要 zip：伺服器靠 presentation.json 自己算題數與題型
    const { blob } = await buildBundle(full, { forceZip: true })

    const form = new FormData()
    form.append('bundle', blob, 'bundle.zip')
    form.append('author', name)
    form.append('description', pubDesc.value.trim())

    const res = await fetch('/api/gallery', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + auth.token },
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.data?.error || data?.error || '上架失敗')

    localStorage.setItem('ql_author', name)
    pickOpen.value = false
    pubDesc.value = ''
    await refresh()
    toast(`「${data.item.title}」已經上架`, 'ok')
  } catch (err: any) {
    toast(err.message || '上架失敗', 'bad')
  } finally {
    publishing.value = ''
  }
}

/* ---------------- 下載 ---------------- */

/**
 * 下載 → 直接走現有的匯入流程落地成本地簡報 → 進編輯器。
 * 素材會重新上傳成這台機器自己的 /uploads/…，之後就跟市集沒關係了。
 */
async function download(item: any) {
  if (downloading.value) return
  downloading.value = item.id
  try {
    const res = await fetch(`/api/gallery/${item.id}/download`)
    if (!res.ok) throw new Error('下載失敗')
    const buf = new Uint8Array(await res.arrayBuffer())

    const { unzipSync, strFromU8 } = await import('fflate')
    const files = unzipSync(buf)
    const key = Object.keys(files).find((k) => k.split('/').pop()?.toLowerCase() === 'presentation.json')
    if (!key) throw new Error('這份 bundle 壞掉了（沒有 presentation.json）')
    const data = JSON.parse(strFromU8(files[key]))

    // 先把素材傳成這台機器自己的 /uploads/…，再把 JSON 指過去
    const uploaded = new Map<string, string>()
    for (const [name, bytes] of Object.entries(files)) {
      if (name === key || name.endsWith('/') || !(bytes as Uint8Array).length) continue
      const form = new FormData()
      form.append('file', new Blob([bytes as BlobPart]), name.split('/').pop()!)
      const up = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + auth.token },
        body: form,
      })
      if (up.ok) uploaded.set(assetKey(name), (await up.json()).url)
    }
    walkAssets(data, ({ value, set }) => {
      const hit = uploaded.get(assetKey(value))
      if (hit) set(hit)
      else if (!isExternal(value) && !isDataUri(value)) set(null) // 包裡沒有的就當作沒有
    })

    data.title = data.title || item.title
    const created = await api<any>('/import', { method: 'POST', body: data })
    toast(`「${created.title}」已加入你的簡報`, 'ok')
    navigateTo('/editor?id=' + created.id)
  } catch (err: any) {
    toast(err.message || '下載失敗', 'bad')
  } finally {
    downloading.value = ''
  }
}

async function report(item: any) {
  const reason = await promptDialog({
    title: `檢舉「${item.title}」`,
    message: '累積三次檢舉會自動隱藏，等管理員處理。',
    placeholder: '為什麼要檢舉？',
    okText: '送出檢舉',
  })
  if (reason === null) return
  await $fetch(`/api/gallery/${item.id}/report`, { method: 'POST', body: { reason } })
  toast('已送出檢舉', 'ok')
  refresh()
}

/* ---------------- 市集後台 ---------------- */

async function openAdmin() {
  adminOpen.value = true
  adminItems.value = (await api<any>('/gallery-admin')).items
}

async function adminDelete(item: any) {
  const yes = await confirmDialog({
    title: `刪掉「${item.title}」？`,
    message: `${item.author} 發布的，${item.slideCount} 題。刪掉就沒了，救不回來。`,
    okText: '刪除',
    danger: true,
  })
  if (!yes) return
  await api(`/gallery-admin/${item.id}`, { method: 'DELETE' })
  toast('已刪除', 'ok')
  await Promise.all([openAdmin(), refresh()])
}

async function adminToggle(item: any) {
  const status = item.status === 'published' ? 'hidden' : 'published'
  await api(`/gallery-admin/${item.id}`, { method: 'PATCH', body: { status } })
  await Promise.all([openAdmin(), refresh()])
}

/* ---------------- 顯示 ---------------- */

const TYPE_FILTERS = [
  ['', '全部題型'],
  ['reveal', '猜圖題'],
  ['soup', '海龜湯'],
  ['single', '單選題'],
  ['multi', '複選題'],
  ['music', '音樂題'],
  ['categorize', '分類題'],
  ['order', '順序題'],
]

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * 卡片上只列題數最多的前四種題型。
 * 15 種題型各出一題的簡報（示範簡報就是）會撐出三行標籤，把卡片弄得又高又亂 ——
 * 台下想知道的是「這份主要在玩什麼」，不是完整清單。
 */
const TAG_MAX = 4
function typeList(counts: Record<string, number>) {
  const all = Object.entries(counts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shown = all.slice(0, TAG_MAX).map(([t, n]) => `${TYPE_META[t]?.label || t} ${n}`)
  if (all.length > TAG_MAX) shown.push(`+${all.length - TAG_MAX} 種`)
  return shown
}
</script>

<template>
  <div>
    <header class="appbar">
      <NuxtLink class="brand" to="/admin">
        <img src="/icon.png" alt="" class="brand-icon" />
        Makoquiz
      </NuxtLink>
      <div class="spacer" />
      <NuxtLink class="btn btn-sm" to="/admin"><AppIcon name="arrow-left" :size="14" /> 我的簡報</NuxtLink>
      <button v-if="canAdmin" class="btn btn-sm" @click="openAdmin"><AppIcon name="sliders" :size="14" /> 市集後台</button>
      <button class="btn btn-primary btn-sm" @click="pickOpen = true"><AppIcon name="upload" :size="14" /> 上架我的題庫</button>
      <AppHelp />
    </header>

    <div class="page">
      <div class="page-head">
        <div>
          <h1>題庫市集</h1>
          <p class="src">來源：{{ source || '…' }}{{ remote ? '' : '（本機，還沒接雲端）' }}</p>
        </div>
      </div>

      <div class="filters">
        <div class="search">
          <AppIcon name="search" :size="15" />
          <input v-model="q" placeholder="搜尋標題、製作者…" maxlength="60" />
        </div>
        <select v-model="type" class="select sm">
          <option v-for="[v, l] in TYPE_FILTERS" :key="v" :value="v">{{ l }}</option>
        </select>
        <div class="seg">
          <button :class="{ on: sort === 'new' }" @click="sort = 'new'">最新</button>
          <button :class="{ on: sort === 'popular' }" @click="sort = 'popular'">最多人下載</button>
        </div>
      </div>

      <div v-if="failed" class="empty-box">
        <AppIcon name="alert" :size="40" :stroke="1.4" />
        <h3>{{ failed }}</h3>
        <button class="btn" style="margin-top: 14px" @click="refresh">重試</button>
      </div>

      <div v-else-if="loading" class="empty-box"><p>載入中…</p></div>

      <div v-else-if="!items.length" class="empty-box">
        <AppIcon name="file-text" :size="40" :stroke="1.4" />
        <h3>{{ q || type ? '找不到符合的題庫' : '市集上還沒有東西' }}</h3>
        <p v-if="!q && !type">把你做好的題庫上架，讓別人也玩得到</p>
      </div>

      <div v-else class="grid">
        <article v-for="it in items" :key="it.id" class="card">
          <!-- 封面：第一張有配圖的投影片。沒有配圖的題庫就不佔這塊空間 -->
          <div v-if="it.cover" class="cover">
            <img :src="it.cover" alt="" loading="lazy" @error="($event.target as HTMLElement).closest('.cover')?.remove()" />
          </div>
          <div class="card-body">
            <h3 :title="it.title">{{ it.title }}</h3>
            <p v-if="it.description" class="desc">{{ it.description }}</p>
            <div class="tags">
              <span v-for="t in typeList(it.typeCounts)" :key="t" class="tag">{{ t }}</span>
            </div>
          </div>
          <div class="meta">
            <span><AppIcon name="user" :size="12" /> {{ it.author }}</span>
            <span>{{ it.slideCount }} 題</span>
            <span v-if="it.hasAssets"><AppIcon name="image" :size="12" /> 含素材</span>
            <span>{{ kb(it.bytes) }}</span>
            <div class="spacer" />
            <span><AppIcon name="download" :size="12" /> {{ it.downloads }}</span>
          </div>
          <div class="acts">
            <button class="btn btn-primary btn-sm" :disabled="downloading === it.id" @click="download(it)">
              <AppIcon name="download" :size="13" />
              {{ downloading === it.id ? '下載中…' : '下載到我的簡報' }}
            </button>
            <div class="spacer" />
            <button class="btn btn-ghost btn-sm" title="檢舉" @click="report(it)">
              <AppIcon name="alert" :size="13" />
            </button>
          </div>
        </article>
      </div>
    </div>

    <!-- 挑一份自己的簡報上架 -->
    <Teleport to="body">
      <div v-if="pickOpen" class="gv-mask" @mousedown.self="pickOpen = false">
        <div class="sheet">
          <h2>上架我的題庫</h2>
          <label class="lbl">製作者</label>
          <input v-model="author" class="input" placeholder="要顯示在市集上的名字" maxlength="40" />
          <label class="lbl">說明（選填）</label>
          <input v-model="pubDesc" class="input" placeholder="這份題庫在玩什麼？" maxlength="500" />
          <label class="lbl">要上架哪一份</label>
          <div class="pick-list">
            <button
              v-for="p in mine"
              :key="p.id"
              class="pick"
              :disabled="!p.slideCount || !!publishing"
              @click="publish(p)"
            >
              <div class="tx">
                <div class="tt">{{ p.title }}</div>
                <div class="ty">{{ p.slideCount }} 題</div>
              </div>
              <span v-if="publishing === p.id" class="ty">上架中…</span>
              <AppIcon v-else name="upload" :size="14" />
            </button>
            <div v-if="!mine.length" class="note">你還沒有任何簡報</div>
          </div>
          <div class="acts-end">
            <button class="btn" @click="pickOpen = false">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 市集後台 -->
    <Teleport to="body">
      <div v-if="adminOpen" class="gv-mask" @mousedown.self="adminOpen = false">
        <div class="sheet wide">
          <h2>市集後台</h2>
          <div class="admin-list">
            <div v-for="it in adminItems" :key="it.id" class="arow" :class="{ 'is-hidden': it.status === 'hidden' }">
              <div class="tx">
                <div class="tt">
                  {{ it.title }}
                  <span v-if="it.status === 'hidden'" class="chip warn">已隱藏</span>
                  <span v-if="it.reports?.length" class="chip">{{ it.reports.length }} 次檢舉</span>
                </div>
                <div class="ty">{{ it.author }} · {{ it.slideCount }} 題 · 下載 {{ it.downloads }}</div>
                <div v-if="it.reports?.length" class="ty reasons">檢舉理由：{{ it.reports.join('／') }}</div>
              </div>
              <button class="btn btn-sm" @click="adminToggle(it)">
                {{ it.status === 'published' ? '隱藏' : '放回去' }}
              </button>
              <button class="btn btn-sm btn-danger" @click="adminDelete(it)">刪除</button>
            </div>
            <div v-if="!adminItems.length" class="note">市集上還沒有東西</div>
          </div>
          <div class="acts-end">
            <button class="btn" @click="adminOpen = false">關閉</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="~/assets/css/gallery.css"></style>
