/**
 * 瀏覽器實測：用真的 Chrome（或 Edge）跑一遍
 * 「登入 → 編輯 → 上傳圖片 → 播放 → 手機加入 → 作答 → 公布 → 提問」，
 * 過程中只要有任何 console 錯誤就算失敗，最後輸出截圖。
 *
 * 用法：先啟動伺服器，再執行
 *   node tests/browser.mjs
 *   BROWSER=edge node tests/browser.mjs      （用 Edge 跑）
 *   SHOTS=D:\somewhere node tests/browser.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.env.BASE || 'http://localhost:3123'
const PASSWORD = process.env.HOST_PASSWORD || 'admin123'
const SHOTS = process.env.SHOTS || path.join(process.cwd(), 'screenshots')

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
]
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const WANT_EDGE = process.env.BROWSER === 'edge'
const BROWSER = (WANT_EDGE ? EDGE_PATHS : CHROME_PATHS).find((p) => fs.existsSync(p))

let pass = 0
let fail = 0
const ok = (cond, label) => {
  if (cond) {
    pass++
    console.log('   \x1b[32m✓\x1b[0m ' + label)
  } else {
    fail++
    console.log('   \x1b[31m✗ ' + label + '\x1b[0m')
  }
}
const step = (s) => console.log('\n\x1b[36m▸ ' + s + '\x1b[0m')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 點擊前一定要把分頁帶到前景。
 * puppeteer 的 click 會先用 IntersectionObserver 確認元素可見，
 * 而 IntersectionObserver 在隱藏的背景分頁不會觸發 —— 直接卡死。
 * 這個測試會在主持人／手機兩個分頁之間來回操作，所以每次都要切。
 */
const click = async (page, sel) => {
  await page.bringToFront()
  await page.click(sel)
}

/**
 * 整份簡報的設定（底色／背景／表符／大廳音樂）從側欄搬進彈窗了，
 * 要先打開才摸得到裡面的東西。彈窗是 Teleport 到 body 的，所以選擇器是 .gs-box 不是 .side。
 */
const openGlobalSettings = async (page) => {
  await page.bringToFront()
  if (await page.$('.gs-box')) return
  await page.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('整份簡報'))?.click())
  await page.waitForSelector('.gs-box', { timeout: 6000 })
}

const errors = []

/** PNG chunk 要的 CRC-32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 產生一段真的能解碼播放的 WAV（正弦波）。
 * 測音樂題一定要用真的音檔 —— 假的 mp3 標頭瀏覽器根本不會播，currentTime 永遠是 0，
 * 那樣測「有人作答會不會把音樂拉回開頭」等於什麼都沒測到。
 */
function sineWavFile(seconds, rate = 8000) {
  const n = rate * seconds
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * 2 * Math.PI) * 8000), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28) // byte rate
  head.writeUInt16LE(2, 32) // block align
  head.writeUInt16LE(16, 34) // bits
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** 產生一張指定尺寸的純色 PNG（測試素材，不想為了幾張圖裝影像套件） */
function solidPngFile(W, H, r, g, b) {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < W; x++) {
      raw[row + 1 + x * 3] = r
      raw[row + 2 + x * 3] = g
      raw[row + 3 + x * 3] = b
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 掃描畫面上「看得到的文字」有沒有 emoji。
 * 排除 → ← 這種中文排版常用的箭號，那是標點不是 emoji。
 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u
async function assertNoEmoji(page, label) {
  const text = await page.evaluate(() => document.body.innerText)
  const found = [...text].filter((c) => new RegExp('[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]', 'u').test(c))
  ok(found.length === 0, found.length ? `${label} 仍有 emoji：${found.join(' ')}` : `${label} 畫面上沒有任何 emoji`)
}

/** 掛上 console / 例外監聽，任何前端錯誤都會被記下來 */
function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // 測試會故意輸入錯誤密碼，登入端點回的 401 是預期中的
    if ((m.location()?.url || '').includes('/api/auth/login')) return
    if (!/favicon|net::ERR_/.test(m.text())) errors.push(`[${tag}] ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`))
  return page
}

async function main() {
  if (!BROWSER) throw new Error('找不到瀏覽器，無法執行測試')
  console.log('使用瀏覽器：' + BROWSER)
  fs.mkdirSync(SHOTS, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: true,
    protocolTimeout: 30000,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // 這個測試會在主持人分頁與手機分頁之間來回切換；
      // Chrome 預設會凍結背景分頁的 JS，讓等待條件永遠等不到。
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      // 音樂題要測真的播放：解掉自動播放限制，同時靜音（不要真的從喇叭放出來）
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  })

  /* ---------- 管理者：登入 ---------- */
  step('管理者後台')
  const admin = watch(await browser.newPage(), 'admin')
  await admin.setViewport({ width: 1440, height: 900 })
  await admin.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
  await admin.waitForSelector('#pw', { timeout: 8000 })
  ok(true, '未登入時顯示登入畫面')

  await admin.type('#pw', 'wrong')
  await click(admin, '.login-card button[type=submit]')
  await admin.waitForSelector('.login-err', { timeout: 5000 })
  ok((await admin.$eval('.login-err', (e) => e.textContent)).includes('密碼'), '⭐ 密碼錯誤會顯示提示（不會整頁跳走）')
  ok(!!(await admin.$('#pw')), '密碼錯誤後仍停在登入頁')

  await admin.type('#pw', PASSWORD)
  await click(admin, '.login-card button[type=submit]')
  await admin.waitForSelector('.pcard', { timeout: 8000 })
  const cards = await admin.$$eval('.pcard h3', (els) => els.map((e) => e.textContent))
  ok(cards.length > 0, `登入後看到 ${cards.length} 份簡報：${cards.join('、')}`)
  await assertNoEmoji(admin, '⭐ 後台列表')
  await admin.screenshot({ path: path.join(SHOTS, '1-後台列表.png') })

  const token = await admin.evaluate(() => localStorage.getItem('ql_token'))

  /* ---------- 新增簡報（原本是死按鈕）---------- */
  step('新增簡報（自製對話框取代 prompt）')
  const before = cards.length
  await click(admin, '.appbar .btn-primary')
  await admin.waitForSelector('.mask input', { timeout: 4000 })
  ok(true, '⭐ 按下「新增簡報」跳出自製對話框（不是被瀏覽器擋掉的 prompt）')
  await admin.$eval('.mask input', (e) => (e.value = ''))
  await admin.type('.mask input', '瀏覽器測試用簡報')
  await click(admin, '.mask .btn-primary')
  await admin.waitForFunction(() => location.pathname === '/editor', { timeout: 8000, polling: 200 })
  ok(true, '⭐ 建立後直接進入編輯器')
  const newId = new URL(admin.url()).searchParams.get('id')

  /* ---------- 編輯器 + 圖片上傳 ---------- */
  step('題目編輯器與圖片上傳')
  await admin.waitForSelector('.thumb', { timeout: 6000 })
  ok((await admin.$$('.thumb')).length === 2, '新簡報預設有 2 張投影片')
  await admin.evaluate(() => document.querySelectorAll('.thumb')[1].click())
  await admin.waitForSelector('.opt-row', { timeout: 4000 })
  ok((await admin.$$('.opt-row')).length === 4, '單選題顯示 4 個選項')

  // 題目圖片欄位平常要收合，不能一直佔一大塊
  ok(!(await admin.$('.sec .picker .drop')), '⭐ 題目圖片欄位預設是收合的')
  const addBtn = await admin.$('.sec .picker .add-image')
  ok(!!addBtn, '收合時只有一顆小的「加圖片」按鈕')
  const addH = await admin.$eval('.sec .picker', (e) => e.getBoundingClientRect().height)
  ok(addH < 60, `⭐ 收合狀態只佔 ${Math.round(addH)}px（展開的拖放區要 80px 以上）`)

  await click(admin, '.sec .picker .add-image')
  await admin.waitForSelector('.sec .picker .drop', { timeout: 3000 })
  ok(true, '⭐ 按了才展開拖放區')
  const dropH = await admin.$eval('.sec .picker .drop', (e) => e.getBoundingClientRect().height)
  ok(dropH > addH, `展開後變高（${Math.round(addH)}px → ${Math.round(dropH)}px）`)

  // 選項的加圖入口要是小小的半透明圖示，不要佔版面
  const chip = await admin.$eval('.opt-row .chip-btn', (e) => ({
    w: e.getBoundingClientRect().width,
    opacity: Number(getComputedStyle(e).opacity),
    border: getComputedStyle(e).borderStyle,
  }))
  ok(chip.w <= 32, `⭐ 選項的加圖入口是小圖示（${Math.round(chip.w)}px）`)
  ok(chip.opacity < 0.5, `⭐ 平常是半透明的（opacity ${chip.opacity}）`)
  ok(chip.border === 'none', '沒有虛線框，不搶注意力')

  const png = path.join(SHOTS, '_fixture.png')
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAPElEQVR42u3OMQEAAAgDoJnc6BpjDwlgSjLdCgQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAsG3BXsuAAGvKPHFAAAAAElFTkSuQmCC', 'base64'))
  const fileInput = await admin.$('.sec .picker input[type=file]')
  await fileInput.uploadFile(png)
  await admin.waitForSelector('.sec .picker .preview img', { timeout: 8000 })
  const imgSrc = await admin.$eval('.sec .picker .preview img', (e) => e.getAttribute('src'))
  ok(/^\/uploads\//.test(imgSrc), `⭐ 題目圖片上傳成功：${imgSrc}`)

  // 選項圖片：縮圖要真的顯示出來，而且不能被移除鈕蓋住
  const optInput = await admin.$('.opt-row .picker input[type=file]')
  await optInput.uploadFile(png)
  // 等圖片「真的載完」，不只是 <img> 出現在 DOM 上 ——
  // 上傳完 src 馬上就設好了，但位元組還在路上，太早量會量到 naturalWidth = 0
  await admin.waitForFunction(
    () => {
      const img = document.querySelector('.opt-row .chip-btn.filled img')
      return !!img && img.complete && img.naturalWidth > 0
    },
    { timeout: 8000 }
  )
  const thumb = await admin.$eval('.opt-row .chip-btn.filled img', (e) => ({
    w: e.getBoundingClientRect().width,
    h: e.getBoundingClientRect().height,
    loaded: e.naturalWidth > 0,
  }))
  ok(thumb.loaded && thumb.w > 20 && thumb.h > 20, `⭐ 選項圖片上傳後縮圖正常顯示（${Math.round(thumb.w)}x${Math.round(thumb.h)}）`)
  ok(!!(await admin.$('.opt-row .chip-x')), '選項縮圖有移除鈕')

  // 填好題目才能播放
  await click(admin, '.q-input')
  await admin.keyboard.type('這張圖是什麼顏色？')
  await admin.evaluate(() => {
    // 選項若已上傳圖片，.opt-main 裡會多一個 file input，要明確只挑文字欄位
    const inputs = document.querySelectorAll('.opt-row .opt-main input[type=text]')
    const setVal = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      s.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setVal(inputs[0], '紅色')
    setVal(inputs[1], '藍色')
  })
  await admin.evaluate(() => document.querySelectorAll('.correct-btn')[0].click())
  await admin.waitForFunction(() => document.querySelector('.save-state')?.textContent === '已儲存', { timeout: 8000, polling: 200 })
  ok(true, '⭐ 編輯後自動儲存')

  const saved = await (await fetch(`${BASE}/api/presentations/${newId}`, { headers: { Authorization: 'Bearer ' + token } })).json()
  ok(saved.slides[1].image === imgSrc, '⭐ 題目圖片有寫進伺服器')
  ok(!!saved.slides[1].options[0].image, '⭐ 選項圖片有寫進伺服器')

  // 速度加分開關存在
  ok((await admin.$$eval('.side .label', (els) => els.map((e) => e.textContent))).some((t) => t.includes('速度加分')), '⭐ 右側有這一題自己的速度加分開關')
  await admin.screenshot({ path: path.join(SHOTS, '2-編輯器.png') })

  /* ---------- 預覽：直接從正在編輯的那一頁開始 ---------- */
  step('預覽：直接跳到正在編輯的那一頁（不是從大廳從頭開始）')
  {
    // 目前停在第 2 張（單選題，index 1）
    await admin.bringToFront()
    await admin.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('預覽')).click())
    await admin.waitForSelector('.pv-mask iframe', { timeout: 8000 })
    const hostFrame = await (await admin.$('.pv-mask iframe')).contentFrame()
    // 主持端預覽應該直接進到 live 的第 2 張，而不是停在大廳
    await hostFrame.waitForSelector('.q-title', { timeout: 15000 })
    const ttl = await hostFrame.$eval('.q-title', (e) => e.textContent)
    ok(ttl.includes('這張圖是什麼顏色'), `⭐ 預覽直接停在正在編輯的第 2 張（${ttl}）`)
    ok(!(await hostFrame.$('.lobby')), '⭐ 預覽沒有從大廳從頭開始')
    const pill = await hostFrame.$eval('.controls .pill', (e) => e.textContent.trim())
    ok(pill.startsWith('2 /'), `⭐ 頁碼顯示第 2 頁（${pill}）`)
    // 收掉預覽場次，不要留垃圾房間
    await admin.evaluate(() => [...document.querySelectorAll('.pv-head .btn')].find((b) => b.textContent.includes('關閉')).click())
    await admin.waitForFunction(() => !document.querySelector('.pv-mask'), { timeout: 5000, polling: 100 })
    ok(true, '關閉預覽後把場次收乾淨')
  }

  /* ---------- 播放示範簡報 ---------- */
  step('主持人播放畫面')
  const list = await (await fetch(BASE + '/api/presentations', { headers: { Authorization: 'Bearer ' + token } })).json()
  // 只認種子產生的示範簡報 —— 測試會改動它的表符與背景，不能跑到使用者自己的簡報上
  const demo = list.find((p) => p.title.includes('知識大挑戰（示範）'))
  if (!demo) throw new Error('找不到示範簡報，測試不會去動使用者自己的簡報')

  const host = watch(await browser.newPage(), 'present')
  await host.setViewport({ width: 1600, height: 900 })
  await host.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
  await host.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
  const code = await host.$eval('.pill b', (e) => e.textContent)
  ok(/^\d{6}$/.test(code), `大廳顯示房間代碼 ${code}`)
  ok(!!(await host.$('.qr-card img')), '大廳顯示 QR Code')
  await assertNoEmoji(host, '⭐ 主持人大廳')
  await host.screenshot({ path: path.join(SHOTS, '3-主持人大廳.png') })

  /* ---------- 大廳網址：點一下複製完整 http 網址 ---------- */
  step('大廳網址：點一下複製完整 http 網址')
  {
    await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write'])
    await host.bringToFront()
    const copyBtn = await host.$('.jstep .v-copy')
    ok(!!copyBtn, '⭐ 大廳網址是一顆可以點的複製鈕')
    const ttl = await host.$eval('.jstep .v-copy', (e) => e.getAttribute('title'))
    ok(/https?:\/\/.+\/\?c=\d{6}/.test(ttl), `⭐ 滑鼠提示帶完整 http 網址（${ttl}）`)
    await copyBtn.click()
    await sleep(200)
    const clip = await host.evaluate(() => navigator.clipboard.readText().catch(() => ''))
    ok(/^https?:\/\/.+\/\?c=\d{6}$/.test(clip), `⭐ 點一下就把完整網址複製到剪貼簿：${clip || '（空）'}`)
    ok(clip.includes(code), '⭐ 複製的網址帶著這一場的房號')
  }

  /* ---------- 參與者加入 ---------- */
  step('參與者手機加入')
  const phone = watch(await browser.newPage(), 'play')
  await phone.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
  await phone.goto(`${BASE}/?c=${code}`, { waitUntil: 'networkidle2' })
  await phone.waitForSelector('.found', { timeout: 8000 })
  ok((await phone.$eval('.found', (e) => e.textContent)).includes('已找到'), '掃 QR 進來自動帶入代碼並找到房間')
  await phone.type('.name-input', '測試玩家')
  await click(phone, '.go')
  await phone.waitForSelector('.center h2', { timeout: 10000 })
  ok((await phone.$eval('.center h2', (e) => e.textContent)).includes('測試玩家'), '加入後顯示等待畫面')
  await host.waitForFunction(() => document.querySelectorAll('.pill b')[1]?.textContent === '1', { timeout: 8000, polling: 200 })
  ok(true, '⭐ 主持人畫面即時顯示參與者已加入')
  await phone.screenshot({ path: path.join(SHOTS, '4-參與者等待.png') })

  // 給測試玩家上傳一張純紅色頭像 —— 之後驗證它有被畫進頒獎台與排行榜圖片
  {
    const redAvatar = path.join(SHOTS, '_red-avatar.png')
    fs.writeFileSync(redAvatar, solidPngFile(80, 80, 255, 0, 0))
    const avaInput = await phone.$('.center input[type=file]')
    await avaInput.uploadFile(redAvatar)
    await phone.waitForFunction(
      () => {
        const img = document.querySelector('.avatar-pick img')
        return !!img && img.complete && img.naturalWidth > 0
      },
      { timeout: 8000 }
    )
    ok(true, '⭐ 測試玩家在大廳上傳了頭像（純紅色，方便之後驗證有畫進圖片）')
    fs.unlinkSync(redAvatar)
  }

  /* ---------- 作答 ---------- */
  step('作答與自動公布')
  await click(host, '.ctrl-main') // → 內容頁
  await host.waitForFunction(() => document.querySelector('.controls .pill')?.textContent.trim().startsWith('1 /'), { timeout: 6000, polling: 200 })
  await click(host, '.ctrl-main') // → 單選題
  await phone.waitForSelector('.opt', { timeout: 8000 })
  const opts = await phone.$$eval('.opt', (els) => els.map((e) => e.textContent.trim()))
  ok(opts.length === 4, `參與者看到 4 個選項：${opts.join('、')}`)

  const leaked = await phone.evaluate(() => document.body.innerHTML.includes('correct'))
  ok(!leaked, '⭐ 參與者的 HTML 裡沒有正解資訊')

  const colors = await phone.$$eval('.opt', (els) => els.map((e) => getComputedStyle(e).backgroundColor))
  ok(new Set(colors).size === 4, `⭐ 四個選項各有不同顏色（${new Set(colors).size} 種）`)
  const hostColors = await host.$$eval('.p-opt', (els) => els.map((e) => getComputedStyle(e).backgroundColor))
  ok(new Set(hostColors).size === 4, '⭐ 大螢幕選項也是四種顏色')

  await host.screenshot({ path: path.join(SHOTS, '5-主持人出題.png') })
  await phone.screenshot({ path: path.join(SHOTS, '6-參與者作答.png') })

  // 還沒有人作答，這時候主要按鈕應該是「公布答案」
  ok(!(await host.$('.p-opt.win')), '還沒作答時大螢幕沒有揭曉')
  ok((await host.$eval('.ctrl-main', (e) => e.textContent)).includes('公布答案'), '主要按鈕顯示「公布答案」')
  // 控制列裡（不含投影片圓點）只能有一顆寫著「公布」的按鈕
  const revealBtns = await host.$$eval('.controls button:not(.dot-s)', (els) =>
    els.map((e) => e.textContent.trim()).filter((t) => t.includes('公布'))
  )
  ok(revealBtns.length === 1, `⭐ 控制列只有一顆公布按鈕（找到 ${revealBtns.length} 顆：${revealBtns.join('、')}）`)

  const idx = opts.findIndex((t) => t.includes('古河渚'))
  ok(idx >= 0, '找到正確選項「古河渚」')
  await phone.bringToFront()
  await (await phone.$$('.opt'))[idx].click()

  // 這一場只有這一位參與者，所以他一送出就是「全員答完」→ 不等主持人直接公布
  await phone.waitForSelector('.result-hero.ok', { timeout: 8000 })
  ok(true, '⭐ 全員答完自動公布，參與者直接看到「答對了！」')
  await host.waitForSelector('.p-opt.win', { timeout: 6000 })
  ok(true, '⭐ 大螢幕同步揭曉正確答案')
  const gain = await phone.$eval('.gain', (e) => e.textContent).catch(() => '')
  ok(gain.startsWith('+'), `顯示得分 ${gain}`)
  await assertNoEmoji(phone, '⭐ 參與者答對畫面')
  await phone.screenshot({ path: path.join(SHOTS, '7-參與者答對.png') })

  await host.waitForSelector('.p-opt.win', { timeout: 6000 })
  ok(true, '⭐ 主持人畫面高亮正確答案並顯示長條圖')
  await host.screenshot({ path: path.join(SHOTS, '8-主持人公布答案.png') })

  /* ---------- 排行榜 ---------- */
  step('排行榜（Kahoot 風格頒獎台）')

  // 頒獎台要三個人才看得出金銀銅，多找兩位進來各拿不同分數
  const extras = []
  for (const [name, pick] of [['第二名', 1], ['第三名', 2]]) {
    const pg = watch(await browser.newPage(), 'play-' + name)
    await pg.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await pg.goto(`${BASE}/?c=${code}`, { waitUntil: 'networkidle2' })
    await pg.waitForSelector('.found', { timeout: 8000 })
    // 暱稱欄會用 localStorage 的上一次暱稱預填，要先清掉不然會接在後面
    await pg.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await pg.type('.name-input', name)
    await click(pg, '.go')
    await pg.waitForSelector('.center', { timeout: 10000 })
    extras.push({ pg, pick })
  }
  // 回到單選題讓他們作答（分數會比先答的測試玩家低）
  await host.bringToFront()
  await host.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), 1)
  for (const { pg, pick } of extras) {
    await pg.bringToFront()
    await pg.waitForSelector('.opt', { timeout: 8000 }).catch(async () => {
      console.log('   [debug] 這一頁顯示的是：', (await pg.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\n/g, ' | '))
      throw new Error('extra player 看不到選項')
    })
    const opts2 = await pg.$$eval('.opt', (els) => els.map((e) => e.textContent.trim()))
    const correctIdx = opts2.findIndex((t) => t.includes('古河渚'))
    await (await pg.$$('.opt'))[correctIdx].click()
    await sleep(400) // 錯開作答時間，速度加分會拉開名次
  }
  // 全員答完會自動公布，不用再按「公布答案」
  await host.bringToFront()
  await host.waitForSelector('.p-opt.win', { timeout: 8000 })
  ok(true, '⭐ 全體作答完畢自動公布')
  await click(host, '.ctrl-main') // → 排行榜
  await host.waitForSelector('.podium-3', { timeout: 6000 })
  ok(true, '⭐ 前三名做成頒獎台')

  // 逐名揭曉是動畫，量尺寸前要等它跑完；順便測「點畫面可以跳過」
  await host.evaluate(() => document.querySelector('.board').click())
  await host.waitForFunction(() => document.querySelectorAll('.pod.shown').length === 3, { timeout: 6000, polling: 100 })
  ok(true, '⭐ 點畫面可以跳過逐名揭曉動畫')

  // 版面要是 2-1-3：第一名在中間、而且最高
  const pods = await host.$$eval('.pod', (els) =>
    els.map((e) => ({
      cls: e.className,
      name: e.querySelector('.pod-name')?.textContent?.trim(),
      blockH: e.querySelector('.pod-block')?.getBoundingClientRect().height,
      x: e.getBoundingClientRect().left,
    }))
  )
  ok(pods.length === 3, `頒獎台有三個位置（實際 ${pods.length}：${JSON.stringify(pods.map((p) => p.cls))}）`)
  ok(pods[0].cls.includes('p2') && pods[1].cls.includes('p1') && pods[2].cls.includes('p3'), '⭐ 排成 2-1-3，第一名在正中間')
  ok(pods[1].blockH > pods[0].blockH && pods[0].blockH > pods[2].blockH, `⭐ 台座高度 1 > 2 > 3（${pods[1].blockH} > ${pods[0].blockH} > ${pods[2].blockH}）`)
  const scores = await host.$$eval('.pod-score', (els) => els.map((e) => Number(e.textContent.replace(/[^\d]/g, '')) || 0))
  ok(scores[1] >= scores[0] && scores[0] >= scores[2], `⭐ 中間就是第一名，分數由高到低 ${scores[1]} / ${scores[0]} / ${scores[2]}`)
  ok(pods.every((p) => p.name && p.name !== '—'), `三個位置都有人：${pods.map((p) => p.name).join(' / ')}`)
  ok(!!(await host.$('.pod-avatar img')), '⭐ 頒獎台顯示參與者上傳的頭像')

  // 金銀銅
  const medals = await host.$$eval('.pod-block', (els) => els.map((e) => getComputedStyle(e).backgroundColor))
  ok(new Set(medals).size === 3, `⭐ 金銀銅三種顏色都不一樣（${[...new Set(medals)].join(' / ')}）`)
  const gold = await host.$eval('.pod-block.m1', (e) => getComputedStyle(e).backgroundColor)
  const silver = await host.$eval('.pod-block.m2', (e) => getComputedStyle(e).backgroundColor)
  const bronze = await host.$eval('.pod-block.m3', (e) => getComputedStyle(e).backgroundColor)
  ok(gold === 'rgb(250, 204, 21)', `⭐ 第一名金色 ${gold}`)
  ok(silver === 'rgb(203, 213, 225)', `⭐ 第二名銀色 ${silver}`)
  ok(bronze === 'rgb(217, 119, 6)', `⭐ 第三名銅色 ${bronze}`)

  await assertNoEmoji(host, '⭐ 排行榜')
  await sleep(1000) // 頒獎台有入場動畫，等它跑完截圖才看得到東西
  await host.screenshot({ path: path.join(SHOTS, '9-排行榜.png') })

  /* ---------- 觀眾提問 ---------- */
  step('觀眾提問')
  await click(phone, '.qa-toggle')
  await phone.waitForSelector('.sheet-body textarea', { timeout: 4000 })
  // 面板是從畫面外滑上來的，動畫沒跑完就點會點到畫面外的座標
  await sleep(400)
  await phone.type('.sheet-body textarea', '請問還有第二場嗎？')
  await click(phone, '.qa-compose .btn-primary')
  await phone.waitForSelector('.qa-item', { timeout: 5000 })
  ok((await phone.$eval('.qa-item .qa-text p', (e) => e.textContent)).includes('第二場'), '參與者送出的問題出現在列表')
  await phone.screenshot({ path: path.join(SHOTS, '10-觀眾提問.png') })

  await click(host, '.top .ghost-btn')
  await host.waitForSelector('.hq', { timeout: 4000 })
  ok((await host.$eval('.hq p', (e) => e.textContent)).includes('第二場'), '⭐ 主持人側欄即時收到提問')
  await host.screenshot({ path: path.join(SHOTS, '11-主持人提問面板.png') })

  /* ---------- 文字雲 ---------- */
  step('開放問題文字雲')
  // 提問面板是全螢幕遮罩，不關掉的話下面的送出鈕會被它攔截
  await click(phone, '.qa-toggle')
  await phone.waitForFunction(() => !document.querySelector('.sheet'), { timeout: 4000, polling: 100 })

  // 不要寫死頁碼 —— 示範簡報加題目時就會錯位，改成查出開放問題在第幾頁
  const full = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
  const openIdx = full.slides.findIndex((s) => s.type === 'open')
  ok(openIdx >= 0, `開放問題在第 ${openIdx + 1} 頁`)

  await host.bringToFront()
  await host.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), openIdx)
  await phone.waitForSelector('textarea.big-input', { timeout: 8000 })
  await phone.type('textarea.big-input', 'CLANNAD')
  await click(phone, '.submit')
  await host.waitForSelector('.p-cloud span', { timeout: 8000 })
  ok((await host.$eval('.p-cloud', (e) => e.textContent)).includes('CLANNAD'), '⭐ 大螢幕文字雲即時出現參與者的回覆')
  await host.screenshot({ path: path.join(SHOTS, '12-文字雲.png') })

  /* ---------- 排行榜直式圖片（會結束場次，所以放在最後） ---------- */
  step('排行榜直式圖片')
  {
    await host.bringToFront()
    await host.evaluate(() => {
      const btn = [...document.querySelectorAll('.top .ghost-btn')].find((b) => b.textContent.trim() === '結束')
      btn.click()
    })
    await host.waitForSelector('.mask .btn-danger', { timeout: 4000 })
    await click(host, '.mask .btn-danger')
    await host.waitForSelector('.end-acts', { timeout: 6000 })

    ok(await host.evaluate(() => !document.body.innerText.includes('CSV')), '⭐ CSV 匯出已移除')
    ok((await host.$eval('.end-acts .ghost-btn', (e) => e.textContent)).includes('排行榜圖片'), '改成「下載排行榜圖片」')

    // 攔下 blob，實際檢查畫出來的 PNG
    const img = await host.evaluate(async () => {
      const btn = [...document.querySelectorAll('.end-acts .ghost-btn')].find((b) => b.textContent.includes('圖片'))
      const origCreate = URL.createObjectURL
      const origClick = HTMLAnchorElement.prototype.click
      let captured = null
      URL.createObjectURL = (blob) => {
        captured = blob
        return 'blob:fake'
      }
      HTMLAnchorElement.prototype.click = function () {}
      btn.click()
      await new Promise((r) => setTimeout(r, 1500))
      URL.createObjectURL = origCreate
      HTMLAnchorElement.prototype.click = origClick
      if (!captured) return null
      const buf = await captured.arrayBuffer()
      const dv = new DataView(buf)

      /*
       * JPEG 的寬高不像 PNG 固定放在開頭的 IHDR，它藏在 SOF 段裡，
       * 要從第 2 byte 開始一段一段跳著找。
       * 0xC4(DHT)、0xC8、0xCC(DAC) 的編號雖然落在 SOF 區間內，但不帶尺寸，要跳過。
       */
      let w = 0
      let h = 0
      for (let off = 2; off < dv.byteLength - 8; ) {
        if (dv.getUint8(off) !== 0xff) break
        const marker = dv.getUint8(off + 1)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          h = dv.getUint16(off + 5)
          w = dv.getUint16(off + 7)
          break
        }
        off += 2 + dv.getUint16(off + 2)
      }

      // 解碼像素，確認上傳的純紅色頭像真的被畫進圖片（畫面上其他地方沒有純紅）
      let red = 0
      try {
        const bmp = await createImageBitmap(captured)
        const cc = document.createElement('canvas')
        cc.width = bmp.width
        cc.height = bmp.height
        const gg = cc.getContext('2d')
        gg.drawImage(bmp, 0, 0)
        const px = gg.getImageData(0, 0, bmp.width, bmp.height).data
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] > 170 && px[i + 1] < 90 && px[i + 2] < 90) red++
        }
      } catch {}

      return {
        type: captured.type,
        size: buf.byteLength,
        sig: [...new Uint8Array(buf.slice(0, 3))].join(','),
        w,
        h,
        red,
        // 圖片有十幾萬 bytes，不能直接 spread 進 fromCharCode（會爆堆疊），要分塊
        b64: (() => {
          const u8 = new Uint8Array(buf)
          let s = ''
          for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192))
          return btoa(s)
        })(),
      }
    })
    ok(!!img, '按下按鈕會產生圖片檔')
    ok(img.type === 'image/jpeg' && img.sig === '255,216,255', `⭐ 產生的是合法 JPG（${img.type}）`)
    ok(img.h > img.w, `⭐ 是直式圖片（${img.w} x ${img.h}）`)
    ok(img.size > 3000, `圖片有實際內容（${Math.round(img.size / 1024)} KB）`)
    ok(img.red > 300, `⭐ 上傳的頭像有被畫進排行榜圖片（紅色像素 ${img.red}）`)
    // 把產生的圖存下來，才能真的用眼睛看它長什麼樣
    fs.writeFileSync(path.join(SHOTS, '15-排行榜圖片.jpg'), Buffer.from(img.b64, 'base64'))

    await host.screenshot({ path: path.join(SHOTS, '14-最終排名.png') })
  }

  /* ---------- 大螢幕不能溢出 ---------- */
  step('主持畫面塞得進一個螢幕')
  {
    // 先給音樂題上傳一張大圖 —— 「標題＋大圖＋播放器＋四個選項」是最容易擠爆的組合
    const full3 = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const musicIdx = full3.slides.findIndex((s) => s.type === 'music')
    const tall = path.join(SHOTS, '_tall.png')
    fs.writeFileSync(tall, solidPngFile(900, 1200, 40, 30, 60))
    const up = new FormData()
    up.append('file', new Blob([fs.readFileSync(tall)], { type: 'image/png' }), 'tall.png')
    const upRes = await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: up })).json()
    full3.slides[musicIdx].image = upRes.url
    // 順便給單選題的解說配一張圖，等一下要測點擊放大
    const singleIdx = full3.slides.findIndex((s) => s.type === 'single')
    full3.slides[singleIdx].explain.image = upRes.url
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: full3.slides }),
    })

    // 場次是開場時深拷貝的，要重開一場才吃得到新圖
    const h3 = watch(await browser.newPage(), 'present-fit')
    await h3.setViewport({ width: 1366, height: 768 }) // 常見的投影機解析度
    await h3.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await h3.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })

    const check = async (idx, label) => {
      await h3.bringToFront()
      await h3.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), idx)
      await sleep(500)
      const o = await h3.evaluate(() => {
        const el = document.querySelector('.canvas')
        return { need: el.scrollHeight - el.clientHeight, body: document.documentElement.scrollHeight - document.documentElement.clientHeight }
      })
      ok(o.need <= 2 && o.body <= 2, `⭐ ${label} 塞得進一個螢幕（需要多捲 ${o.need}px）`)
    }

    await check(musicIdx, '音樂題＋大圖')
    await check(full3.slides.findIndex((s) => s.type === 'single'), '單選題')
    await check(full3.slides.findIndex((s) => s.type === 'match'), '配對題')
    await check(full3.slides.findIndex((s) => s.type === 'categorize'), '分類題')
    await check(full3.slides.findIndex((s) => s.type === 'soup'), '海龜湯')
    await h3.screenshot({ path: path.join(SHOTS, '18-音樂題不溢出.png') })

    // 公布答案帶解說時也不能溢出
    await h3.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), full3.slides.findIndex((s) => s.type === 'single'))
    await sleep(300)
    await click(h3, '.ctrl-main')
    await h3.waitForSelector('.explain-panel', { timeout: 5000 })
    ok(true, '⭐ 公布答案時顯示解說面板')
    ok((await h3.$eval('.explain-panel', (e) => e.textContent)).includes('古河麵包店'), '解說內容正確')
    await sleep(400)
    const o3 = await h3.evaluate(() => {
      const el = document.querySelector('.canvas')
      return el.scrollHeight - el.clientHeight
    })
    ok(o3 <= 2, `⭐ 帶解說的公布畫面也塞得進一個螢幕（需要多捲 ${o3}px）`)
    await h3.screenshot({ path: path.join(SHOTS, '19-解說.png') })

    /* 解說圖點擊放大 */
    const thumb3 = await h3.$eval('.explain-panel img.zoomable', (e) => e.getBoundingClientRect().width)
    await click(h3, '.explain-panel img.zoomable')
    await h3.waitForSelector('.zoom-mask img', { timeout: 4000 })
    ok(true, '⭐ 點解說縮圖會打開放大檢視')
    await sleep(400) // 等淡入動畫跑完再量，不然量到的是 scale(0.94) 的過程中
    const big = await h3.$eval('.zoom-mask img', (e) => {
      const r = e.getBoundingClientRect()
      return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, loaded: e.naturalWidth > 0 }
    })
    ok(big.loaded, '放大的圖有載入')
    ok(big.w > thumb3, `⭐ 放大後真的變大（${Math.round(thumb3)}px → ${Math.round(big.w)}px）`)
    // 直式的圖最容易掉出畫面外（900x1200 這張就是），一定要整張看得到
    const vh = await h3.evaluate(() => window.innerHeight)
    ok(
      big.top >= -1 && big.bottom <= vh + 1,
      `⭐ 放大的圖完整在畫面內（高 ${Math.round(big.h)}px，畫面 ${vh}px）`
    )
    await h3.screenshot({ path: path.join(SHOTS, '20-解說放大.png') })

    // 主持端的空白鍵是「下一步」。放大時按空白應該只是關掉放大，
    // 絕對不能穿透過去把簡報翻到下一題（主持人會直接跳過整段解說）。
    const slideBefore = await h3.$eval('.q-title', (e) => e.textContent)
    await h3.keyboard.press('Space')
    await h3.waitForFunction(() => !document.querySelector('.zoom-mask'), { timeout: 3000 })
    ok(true, '⭐ 放大時按空白鍵是關掉放大')
    await sleep(350)
    ok(!!(await h3.$('.explain-panel')), '⭐ 沒有被翻到下一題（解說還在）')
    ok(slideBefore === (await h3.$eval('.q-title', (e) => e.textContent)), '⭐ 簡報還停在同一題')

    // Esc 也要關得掉
    await click(h3, '.explain-panel img.zoomable')
    await h3.waitForSelector('.zoom-mask', { timeout: 4000 })
    await h3.keyboard.press('Escape')
    await h3.waitForFunction(() => !document.querySelector('.zoom-mask'), { timeout: 3000 })
    ok(true, '⭐ 按 Esc 關掉放大檢視')

    // 點畫面任一處也要關得掉
    await click(h3, '.explain-panel img.zoomable')
    await h3.waitForSelector('.zoom-mask', { timeout: 4000 })
    await click(h3, '.zoom-mask')
    await h3.waitForFunction(() => !document.querySelector('.zoom-mask'), { timeout: 3000 })
    ok(true, '⭐ 點畫面任一處也關得掉')

    // 關掉之後快捷鍵要恢復正常，不能把鍵盤鎖死
    await h3.keyboard.press('ArrowRight')
    await sleep(400)
    ok(slideBefore !== (await h3.$eval('.q-title', (e) => e.textContent).catch(() => '')), '⭐ 關掉後快捷鍵恢復正常（→ 會翻頁）')

    /* 手機端也要點得開 —— 參與者是用手指的，而且螢幕更小、更需要放大 */
    const code3 = await h3.$eval('.pill b', (e) => e.textContent)
    const ph3 = watch(await browser.newPage(), 'play-zoom')
    await ph3.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await ph3.goto(`${BASE}/?c=${code3}`, { waitUntil: 'networkidle2' })
    await ph3.waitForSelector('.name-input', { timeout: 8000 })
    // 同上：暱稱欄會用 localStorage 的上一次暱稱預填，不清掉會接在後面
    await ph3.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await ph3.type('.name-input', '看圖的人')
    await click(ph3, '.go')
    await ph3.waitForSelector('.center h2', { timeout: 10000 })

    await h3.bringToFront()
    await h3.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), singleIdx)
    await sleep(300)
    await click(h3, '.ctrl-main') // 公布答案
    await ph3.waitForSelector('.explain img.zoomable', { timeout: 8000 })
    ok(true, '⭐ 手機端解說也看得到縮圖')
    await click(ph3, '.explain img.zoomable')
    await ph3.waitForSelector('.zoom-mask img', { timeout: 4000 })
    await sleep(400)
    const mob = await ph3.evaluate(() => {
      const r = document.querySelector('.zoom-mask img').getBoundingClientRect()
      return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight }
    })
    ok(mob.top >= -1 && mob.bottom <= mob.vh + 1 && mob.left >= -1 && mob.right <= mob.vw + 1,
      `⭐ 手機上放大的圖完整在畫面內（${Math.round(mob.w)}x${Math.round(mob.h)} / 螢幕 ${mob.vw}x${mob.vh}）`)
    await ph3.screenshot({ path: path.join(SHOTS, '21-手機解說放大.png') })
    await click(ph3, '.zoom-mask')
    await ph3.waitForFunction(() => !document.querySelector('.zoom-mask'), { timeout: 3000 })
    ok(true, '⭐ 手機上點一下就關掉')
    await ph3.close()

    await h3.close()
    fs.unlinkSync(tall)
    full3.slides[musicIdx].image = null
    full3.slides[singleIdx].explain.image = null
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: full3.slides }),
    })
  }

  /* ---------- 猜圖題的版面 ---------- */
  step('猜圖題：圖片待在自己的框裡')
  {

    /*
     * 這一段是在擋一個真的發生過的 bug：RevealImage 的根元素寫成
     * :class="mode"，mode='tiles' 就讓根元素吃到了給格子遮罩用的
     * .tiles{position:absolute;inset:0}，整個元件因此跳出 .reveal-box、
     * 貼著 .canvas 攤開，把倒數計時和標題全蓋掉。
     */
    const full4 = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const revealIdx = full4.slides.findIndex((s) => s.type === 'reveal')
    const cg = path.join(SHOTS, '_cg.png')
    fs.writeFileSync(cg, solidPngFile(640, 360, 200, 60, 90)) // 16:9
    const fd4 = new FormData()
    fd4.append('file', new Blob([fs.readFileSync(cg)], { type: 'image/png' }), 'cg.png')
    const cgUrl = (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd4 })).json()).url
    full4.slides[revealIdx].image = cgUrl
    full4.slides[revealIdx].timeLimit = 60
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: full4.slides }),
    })

    const h4 = watch(await browser.newPage(), 'present-reveal')
    await h4.setViewport({ width: 1366, height: 768 })
    await h4.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await h4.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    await h4.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), revealIdx)
    await h4.waitForSelector('.reveal-stage', { timeout: 8000 })
    await sleep(900)

    const geo = await h4.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }
      }
      const ring = document.querySelector('.reveal-stage .ring')
      const img = r('.reveal img')
      const ringBox = r('.reveal-stage .ring')
      // 倒數環的中心點上，最上層的是誰？被圖蓋住的話這裡就會是圖
      let topAtRing = null
      if (ringBox) {
        const el = document.elementFromPoint(ringBox.x + ringBox.w / 2, ringBox.y + ringBox.h / 2)
        topAtRing = el ? el.tagName : null
      }
      return { box: r('.reveal-box'), img, ring: ringBox, ringVal: ring?.querySelector('.val')?.textContent, topAtRing, title: !!r('.q-title') }
    })

    const inside =
      geo.img.x >= geo.box.x - 1 &&
      geo.img.y >= geo.box.y - 1 &&
      geo.img.right <= geo.box.right + 1 &&
      geo.img.bottom <= geo.box.bottom + 1
    ok(inside, `⭐ 猜圖的圖片待在 .reveal-box 裡（圖 ${Math.round(geo.img.w)}x${Math.round(geo.img.h)}，框 ${Math.round(geo.box.w)}x${Math.round(geo.box.h)}）`)
    ok(Math.abs(geo.img.w / geo.img.h - 16 / 9) < 0.02, `⭐ 容器縮成圖片的比例，格子才對得準（${(geo.img.w / geo.img.h).toFixed(2)} vs 1.78）`)
    ok(!!geo.ring && geo.ring.w > 0, '猜圖題有倒數計時環')
    ok(/^\d+$/.test(geo.ringVal || ''), `⭐ 倒數計時看得到讀秒（${geo.ringVal}）`)
    ok(geo.topAtRing !== 'IMG', `⭐ 倒數計時沒有被圖片蓋住（最上層是 ${geo.topAtRing}）`)
    ok(geo.title, '標題沒有被圖片蓋掉')

    // 公布答案要全開
    const tiles = () => h4.evaluate(() => ({ total: document.querySelectorAll('.tiles i').length, off: document.querySelectorAll('.tiles i.off').length }))
    const before = await tiles()
    ok(before.off > 0, `第 1 階段大部分還蓋著（${before.off}/${before.total} 塊）`)
    await h4.evaluate(() => document.querySelector('.ctrl-main').click())
    await sleep(900)
    const after = await tiles()
    ok(after.off === 0, `⭐ 公布答案時圖片全開（還蓋著 ${after.off}/${after.total} 塊）`)
    await h4.screenshot({ path: path.join(SHOTS, '25-猜圖題.png') })
    await h4.close()
    fs.unlinkSync(cg)
  }

  /* ---------- 猜圖題的揭露排程器 ---------- */
  step('猜圖題：每階段揭露排程')
  {
    const ed2 = watch(await browser.newPage(), 'editor-planner')
    await ed2.setViewport({ width: 1440, height: 900 })
    await ed2.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ed2.waitForSelector('.thumb', { timeout: 8000 })
    const full5 = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const revealIdx = full5.slides.findIndex((s) => s.type === 'reveal')
    await ed2.evaluate((i) => document.querySelectorAll('.thumb')[i].click(), revealIdx)
    await ed2.waitForSelector('.planner', { timeout: 8000 })

    const cells = await ed2.$$eval('.planner .cell', (els) => els.length)
    ok(cells === 35, `預設切成 5x7 = ${cells} 塊`)

    /*
     * 遮罩的 class 曾經叫 .hidden，撞上 main.css 的全域
     * .hidden{display:none!important}，35 塊遮罩全部消失、格線也塌掉。
     * 所以這裡要確認「蓋著的格子真的有畫出來、而且是深色的」。
     */
    const mask = await ed2.evaluate(() => {
      const cs = [...document.querySelectorAll('.planner .cell')]
      const covered = cs.filter((c) => c.classList.contains('covered'))
      const laidOut = covered.filter((c) => c.getBoundingClientRect().width > 0)
      const cellsRect = document.querySelector('.planner .cells').getBoundingClientRect()
      const imgRect = document.querySelector('.planner .canvas img').getBoundingClientRect()
      return {
        covered: covered.length,
        laidOut: laidOut.length,
        bg: covered[0] ? getComputedStyle(covered[0]).backgroundColor : null,
        aligned: Math.abs(cellsRect.width - imgRect.width) < 1 && Math.abs(cellsRect.height - imgRect.height) < 1,
      }
    })
    ok(mask.laidOut === mask.covered && mask.covered > 0, `⭐ 蓋著的 ${mask.covered} 塊遮罩真的有畫出來（不是被全域 .hidden 弄成 display:none）`)
    ok(mask.bg === 'rgb(11, 18, 32)', `⭐ 遮罩是深色的（${mask.bg}）`)
    ok(mask.aligned, '⭐ 格線跟圖片精準對齊（編輯器點的那一塊，播出來才是同一塊）')

    // 點三塊進第 1 階段，確認會存回伺服器
    for (const i of [8, 9, 16]) await ed2.evaluate((n) => document.querySelectorAll('.planner .cell')[n].click(), i)
    await sleep(1600)
    const saved = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const st = saved.slides[revealIdx].stageTiles
    ok(JSON.stringify(st?.[0]) === '[8,9,16]', `⭐ 排好的格子存得起來（第 1 階段：${JSON.stringify(st?.[0])}）`)

    const shown = await ed2.$$eval('.planner .cell.now', (els) => els.length)
    ok(shown === 3, `⭐ 這一階段新揭的 3 塊有標記出來（${shown} 塊）`)
    await ed2.screenshot({ path: path.join(SHOTS, '26-揭露排程器.png') })
    await ed2.close()

    // 排程清掉，才不會影響後面的測試
    saved.slides[revealIdx].stageTiles = []
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: saved.slides }),
    })
  }

  /* ---------- 匯出整包 → 刪掉 → 匯入還原 ---------- */
  step('匯出整包再匯入（換一台機器也還原得出來）')
  {
    const api = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })

    // 先做一份「什麼素材都有」的簡報
    const put = async (buf, name, type) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type }), name)
      return (await (await api('/upload', { method: 'POST', body: fd })).json()).url
    }
    const imgA = solidPngFile(120, 90, 200, 30, 30)
    const imgB = solidPngFile(60, 60, 30, 200, 30)
    const wavBuf = sineWavFile(2)
    const lobbyBuf = sineWavFile(3, 11025)
    const quizBuf = sineWavFile(4, 8000)
    const [uQ, uOpt, uExp, uBg, uReact, uAudio, uLobby, uQuiz, uPairL, uPairR, uItem] = await Promise.all([
      put(imgA, 'a.png', 'image/png'),
      put(imgB, 'b.png', 'image/png'),
      put(imgA, 'c.png', 'image/png'),
      put(imgB, 'd.png', 'image/png'),
      put(imgA, 'e.png', 'image/png'),
      put(wavBuf, 'f.wav', 'audio/wav'),
      put(lobbyBuf, 'g.wav', 'audio/wav'),
      put(quizBuf, 'h.wav', 'audio/wav'),
      put(imgA, 'pl.png', 'image/png'),
      put(imgB, 'pr.png', 'image/png'),
      put(imgA, 'it.png', 'image/png'),
    ])

    const created = await (
      await api('/presentations', { method: 'POST', body: JSON.stringify({ title: '匯出匯入測試' }) })
    ).json()
    await api(`/presentations/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        background: { image: uBg, dim: 40, blur: 4, auto: false },
        lobbyMusic: uLobby,
        quizMusic: uQuiz,
        quizMusicVolume: 25,
        reactions: [{ id: 'r1', url: uReact, label: '讚' }],
        slides: [
          {
            id: 's1',
            type: 'single',
            title: '有圖的題目',
            image: uQ,
            explain: { text: '這是解說', image: uExp },
            options: [
              { id: 'o1', text: 'A', correct: true, image: uOpt },
              { id: 'o2', text: 'B', correct: false, image: null },
            ],
          },
          { id: 's2', type: 'music', title: '音樂題', audio: uAudio, audioStart: 3, autoPlay: true, options: [{ id: 'o3', text: 'X', correct: true }] },
          {
            id: 's3',
            type: 'match',
            title: '有圖的配對題',
            pairs: [
              // 純圖片的一組：文字是空的，圖才是內容
              { id: 'm1', left: '', right: '', leftImage: uPairL, rightImage: uPairR },
              { id: 'm2', left: '純文字', right: '純文字答案', leftImage: null, rightImage: null },
            ],
          },
          {
            id: 's4',
            type: 'order',
            title: '有圖的順序題',
            items: [
              { id: 'i1', text: '', image: uItem },
              { id: 'i2', text: '純文字項目', image: null },
            ],
          },
        ],
      }),
    })

    // 匯出：從真的 UI 按下按鈕。
    // 不走瀏覽器真的存檔（CDP 的下載行為在 Chrome/Edge 各版本很不穩），
    // 改成攔下 <a download> 的那一刻直接把 blob 讀出來 —— 產生 zip 的程式碼一樣是真的在跑。
    const dlDir = path.join(SHOTS, '_dl')
    fs.rmSync(dlDir, { recursive: true, force: true })
    fs.mkdirSync(dlDir, { recursive: true })
    await admin.bringToFront()
    await admin.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
    await admin.waitForSelector('.pcard', { timeout: 8000 })
    await admin.evaluate(() => {
      window.__dl = null
      URL.revokeObjectURL = () => {} // 不然 blob 在我們讀到之前就被收掉了
      const orig = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) return void (window.__dl = { name: this.download, href: this.href })
        return orig.apply(this, arguments)
      }
    })
    const clicked = await admin.evaluate(() => {
      const card = [...document.querySelectorAll('.pcard')].find((c) => c.querySelector('h3')?.textContent === '匯出匯入測試')
      if (!card) return 'card not found: ' + [...document.querySelectorAll('.pcard h3')].map((h) => h.textContent).join('|')
      // 一定要限定 .acts button：卡片標題的 h3 也有 title 屬性，
      // 簡報叫「匯出匯入測試」的時候 [title^="匯出"] 會先選到那個 h3，
      // 點下去等於點在卡片上 → 直接跳去編輯器
      const btn = card.querySelector('.acts button[title^="匯出"]')
      if (!btn) return 'button not found: ' + [...card.querySelectorAll('button')].map((b) => b.title).join('|')
      btn.click()
      return 'ok'
    })
    if (clicked !== 'ok') throw new Error('匯出按鈕點不到 → ' + clicked)
    await admin
      .waitForFunction(() => window.__dl, { timeout: 15000, polling: 100 })
      .catch(async () => {
        const t = await admin.$$eval('.toast', (els) => els.map((e) => e.textContent)).catch(() => [])
        const st = await admin.evaluate(() => ({
          url: location.href,
          cards: [...document.querySelectorAll('.pcard h3')].map((h) => h.textContent),
          login: !!document.querySelector('#pw'),
          tok: (localStorage.getItem('ql_token') || '').slice(0, 8),
        }))
        throw new Error(
          `匯出沒有產生下載。toast：${t.join(' / ') || '（沒有）'}；狀態=${JSON.stringify(st)}；console：${errors.slice(-3).join(' | ') || '（沒有）'}`
        )
      })
    const dl = await admin.evaluate(async () => {
      const buf = new Uint8Array(await (await fetch(window.__dl.href)).arrayBuffer())
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return { name: window.__dl.name, b64: btoa(s) }
    })
    ok(dl.name === '匯出匯入測試.zip', `⭐ 匯出成一包 zip：${dl.name}`)
    const zipPath = path.join(dlDir, dl.name)
    fs.writeFileSync(zipPath, Buffer.from(dl.b64, 'base64'))

    // 包裡該有的東西
    const { unzipSync } = await import('fflate')
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))
    const names = Object.keys(entries)
    ok(names.includes('presentation.json'), '包裡有 presentation.json')
    const assetNames = names.filter((n) => n.startsWith('assets/'))
    ok(assetNames.length === 11, `⭐ 十一個素材都打包進去了：${assetNames.map((n) => n.replace('assets/', '')).join('、')}`)
    ok(names.includes('讀我.txt'), '包裡附了說明檔')

    const bundled = JSON.parse(new TextDecoder().decode(entries['presentation.json']))
    const raw = JSON.stringify(bundled)
    ok(!raw.includes('/uploads/'), '⭐ 包裡的 JSON 完全沒有本機的 /uploads/ 路徑（這是能換機器的關鍵）')
    ok(bundled.slides[0].image.startsWith('assets/'), `題目圖指向包裡的檔案：${bundled.slides[0].image}`)
    ok(bundled.slides[0].explain.image.startsWith('assets/'), '解說圖也指向包裡的檔案')
    ok(bundled.slides[0].options[0].image.startsWith('assets/'), '選項圖也指向包裡的檔案')
    ok(bundled.slides[1].audio.startsWith('assets/'), '音樂也指向包裡的檔案')
    ok(bundled.background.image.startsWith('assets/'), '背景也指向包裡的檔案')
    ok(bundled.reactions[0].url.startsWith('assets/'), '表情符號也指向包裡的檔案')
    ok(bundled.lobbyMusic.startsWith('assets/'), '大廳音樂也指向包裡的檔案')
    ok(bundled.quizMusic.startsWith('assets/'), '作答音樂也指向包裡的檔案')
    ok(bundled.slides[2].pairs[0].leftImage.startsWith('assets/'), '配對題左欄的圖也指向包裡的檔案')
    ok(bundled.slides[2].pairs[0].rightImage.startsWith('assets/'), '配對題右欄的圖也指向包裡的檔案')
    ok(bundled.slides[3].items[0].image.startsWith('assets/'), '順序題的項目圖也指向包裡的檔案')
    ok(!bundled.id && !bundled.slides[0].id, '⭐ 不帶原本的 id（換環境會重新配）')

    // 模擬「另一台機器」：原本那份刪掉
    await api(`/presentations/${created.id}`, { method: 'DELETE' })

    // 匯入：一樣走真的 UI，把 zip 丟進檔案選擇器
    await admin.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
    await admin.waitForSelector('.pcard, .empty-box', { timeout: 8000 })
    await admin.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('匯入'))?.click())
    await admin.waitForSelector('.import-box', { timeout: 4000 })
    await (await admin.$('input[type=file][multiple]')).uploadFile(zipPath)
    await admin.waitForFunction(() => document.querySelector('.import-box')?.value.includes('slides'), { timeout: 8000, polling: 100 })
    ok(true, '⭐ 丟一個 zip 進去就自動讀出題目與素材')
    const assetsShown = await admin.$eval('.assets-head', (e) => e.textContent).catch(() => '')
    ok(assetsShown.includes('11'), `⭐ 介面顯示已附上 11 個素材（${assetsShown.trim()}）`)
    const checkMsg = await admin.$eval('.check', (e) => e.textContent.trim())
    ok(checkMsg.includes('素材 11/11'), `⭐ 匯入前就先告訴你素材對得起來（${checkMsg}）`)
    await admin.screenshot({ path: path.join(SHOTS, '22-匯入整包.png') })

    await click(admin, '.modal-acts .btn-primary')
    await admin.waitForFunction(() => location.pathname === '/editor', { timeout: 20000, polling: 200 })
    ok(true, '⭐ 匯入成功並進入編輯器')
    const newId = new URL(admin.url()).searchParams.get('id')

    // 還原出來的簡報：每個素材都要真的抓得到，而且內容跟原本一模一樣
    const restored = await (await api('/presentations/' + newId)).json()
    const grab = async (u) => Buffer.from(await (await fetch(BASE + u)).arrayBuffer())
    ok(restored.slides.length === 4, '四題都還原了')
    ok(restored.slides[0].image.startsWith('/uploads/'), `⭐ 素材被重新上傳成這台機器的網址：${restored.slides[0].image}`)
    ok(restored.slides[0].image !== uQ, '⭐ 是新的檔案，不是沿用原本那一份')
    ok((await grab(restored.slides[0].image)).equals(imgA), '⭐ 題目圖的內容跟原本一模一樣')
    ok((await grab(restored.slides[0].options[0].image)).equals(imgB), '⭐ 選項圖的內容一模一樣')
    ok((await grab(restored.slides[0].explain.image)).equals(imgA), '⭐ 解說圖的內容一模一樣')
    ok((await grab(restored.background.image)).equals(imgB), '⭐ 背景圖的內容一模一樣')
    ok((await grab(restored.reactions[0].url)).equals(imgA), '⭐ 表情符號的內容一模一樣')
    ok((await grab(restored.slides[1].audio)).equals(wavBuf), '⭐ 音樂的內容一模一樣')
    ok(restored.lobbyMusic.startsWith('/uploads/'), `⭐ 大廳音樂被重新上傳：${restored.lobbyMusic}`)
    ok((await grab(restored.lobbyMusic)).equals(lobbyBuf), '⭐ 大廳音樂的內容一模一樣')
    ok(restored.quizMusic.startsWith('/uploads/'), `⭐ 作答音樂被重新上傳：${restored.quizMusic}`)
    ok((await grab(restored.quizMusic)).equals(quizBuf), '⭐ 作答音樂的內容一模一樣')
    ok(restored.quizMusicVolume === 25, '作答音樂的音量有跟著回來')
    ok((await grab(restored.slides[2].pairs[0].leftImage)).equals(imgA), '⭐ 配對題左欄圖的內容一模一樣')
    ok((await grab(restored.slides[2].pairs[0].rightImage)).equals(imgB), '⭐ 配對題右欄圖的內容一模一樣')
    ok(restored.slides[2].pairs[0].left === '' && restored.slides[2].pairs[1].left === '純文字', '純圖片與純文字的配對都照原樣回來')
    ok((await grab(restored.slides[3].items[0].image)).equals(imgA), '⭐ 順序題項目圖的內容一模一樣')
    ok(restored.slides[3].items[0].text === '' && restored.slides[3].items[1].text === '純文字項目', '純圖片與純文字的項目都照原樣回來')
    ok(!(await grab(restored.quizMusic)).equals(lobbyBuf), '⭐ 作答音樂沒被大廳音樂蓋掉（兩軌是分開的）')
    ok(restored.slides[0].explain.text === '這是解說', '解說文字有跟著回來')
    ok(restored.slides[1].audioStart === 3, '音樂的起始秒數有跟著回來')
    ok(restored.background.dim === 40 && restored.background.blur === 4, '背景的遮罩／模糊設定有跟著回來')
    ok(restored.reactions[0].label === '讚', '表情符號的名稱有跟著回來')

    await api('/presentations/' + newId, { method: 'DELETE' })
    fs.rmSync(dlDir, { recursive: true, force: true })
  }

  /* ---------- JSON ＋ 自己的圖（AI 出題的人最常這樣用）---------- */
  step('JSON ＋ 自己命名的圖片（依檔名對應）')
  {
    const dir = path.join(SHOTS, '_own')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    // 使用者自己的圖，檔名是自己取的
    const nagisa = path.join(dir, '渚.png')
    fs.writeFileSync(nagisa, solidPngFile(80, 80, 10, 90, 200))

    await admin.bringToFront()
    await admin.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
    await admin.waitForSelector('.pcard, .empty-box', { timeout: 8000 })
    await admin.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('匯入'))?.click())
    await admin.waitForSelector('.import-box', { timeout: 4000 })

    // JSON 直接用「渚.png」指圖，沒有任何 /uploads/ 路徑
    const json = JSON.stringify({
      title: '自己配圖測試',
      slides: [
        { type: 'single', title: '她是誰？', image: '渚.png', options: [{ text: '古河渚', correct: true }, { text: '別人' }], explain: { text: '就是渚', image: '渚.png' } },
        { type: 'single', title: '缺圖的題目', image: '不存在的圖.png', options: [{ text: 'A', correct: true }, { text: 'B' }] },
      ],
    })
    await admin.$eval('.import-box', (e, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(e, v)
      e.dispatchEvent(new Event('input', { bubbles: true }))
    }, json)

    let msg = await admin.$eval('.check', (e) => e.textContent.trim())
    ok(msg.includes('缺'), `⭐ 還沒給圖時就先說缺什麼（${msg}）`)

    await (await admin.$('input[type=file][multiple]')).uploadFile(nagisa)
    await admin.waitForFunction(() => document.querySelector('.assets-head'), { timeout: 5000, polling: 100 })
    msg = await admin.$eval('.check', (e) => e.textContent.trim())
    ok(msg.includes('素材 2/3'), `⭐ 給了圖之後對應數量就更新（${msg}）`)

    await click(admin, '.modal-acts .btn-primary')
    await admin.waitForFunction(() => location.pathname === '/editor', { timeout: 20000, polling: 200 })
    const ownId = new URL(admin.url()).searchParams.get('id')
    const own = await (
      await fetch(`${BASE}/api/presentations/${ownId}`, { headers: { Authorization: 'Bearer ' + token } })
    ).json()
    ok(own.slides[0].image.startsWith('/uploads/'), `⭐ 用檔名就把自己的圖接上了：${own.slides[0].image}`)
    ok(own.slides[0].explain.image.startsWith('/uploads/'), '⭐ 同一張圖用在兩個地方都接得上')
    const got = Buffer.from(await (await fetch(BASE + own.slides[0].image)).arrayBuffer())
    ok(got.equals(fs.readFileSync(nagisa)), '⭐ 接上的就是我給的那張圖')
    ok(own.slides[1].image === null, '⭐ 找不到的圖就當作沒有，其他題目照樣匯入')

    await fetch(`${BASE}/api/presentations/${ownId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
    fs.rmSync(dir, { recursive: true, force: true })
  }

  /* ---------- 音樂題：有人作答不能把音樂拉回開頭 ---------- */
  step('音樂題播放（有人作答不會重播）')
  {
    const fullM = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const mIdx = fullM.slides.findIndex((s) => s.type === 'music')

    // 上傳一段真的 10 秒 WAV
    const wav = path.join(SHOTS, '_tone.wav')
    fs.writeFileSync(wav, sineWavFile(10))
    const fd = new FormData()
    fd.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'tone.wav')
    const wavRes = await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd })).json()
    ok(wavRes.kind === 'audio', `測試音檔上傳成功：${wavRes.url}`)
    fullM.slides[mIdx].audio = wavRes.url
    fullM.slides[mIdx].audioStart = 0
    fullM.slides[mIdx].autoPlay = true
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: fullM.slides }),
    })

    // 場次是開場時深拷貝的，要重開一場才吃得到新音檔
    const h4 = watch(await browser.newPage(), 'present-music')
    await h4.setViewport({ width: 1366, height: 768 })
    await h4.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await h4.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const code4 = await h4.$eval('.pill b', (e) => e.textContent)

    const ph4 = watch(await browser.newPage(), 'play-music')
    await ph4.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await ph4.goto(`${BASE}/?c=${code4}`, { waitUntil: 'networkidle2' })
    await ph4.waitForSelector('.name-input', { timeout: 8000 })
    await ph4.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await ph4.type('.name-input', '聽音樂的人')
    await click(ph4, '.go')
    await ph4.waitForSelector('.center h2', { timeout: 10000 })

    /*
     * 再拉一個「不作答的人」進來。
     *
     * 全員答完會自動公布，只有一個參與者的話他一送出就直接揭曉、音樂也跟著停 ——
     * 那樣就測不到這一題真正要測的東西（有人作答會觸發 host:sync，
     * 而 sync 不可以把音樂拉回開頭）。留一個人不答，題目才會停在 live。
     */
    const ph4b = watch(await browser.newPage(), 'play-music-idle')
    await ph4b.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await ph4b.goto(`${BASE}/?c=${code4}`, { waitUntil: 'networkidle2' })
    await ph4b.waitForSelector('.name-input', { timeout: 8000 })
    await ph4b.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await ph4b.type('.name-input', '不作答的人')
    await click(ph4b, '.go')
    await ph4b.waitForSelector('.center h2', { timeout: 10000 })

    await h4.bringToFront()
    await h4.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), mIdx)
    await h4.waitForSelector('.player audio', { timeout: 8000 })

    // 先確認音樂真的在跑（不然下面的斷言等於沒測）
    await h4.waitForFunction(() => {
      const a = document.querySelector('.player audio')
      return a && !a.paused && a.currentTime > 0.3
    }, { timeout: 8000, polling: 100 })
    const t1 = await h4.$eval('.player audio', (a) => a.currentTime)
    ok(t1 > 0.3, `⭐ 音樂題自動播放中（currentTime ${t1.toFixed(2)}s）`)

    // 參與者送出選項 → 主持端會收到 host:sync
    await ph4.waitForSelector('.opt', { timeout: 8000 })
    await ph4.bringToFront()
    await (await ph4.$$('.opt'))[1].click()
    await ph4.waitForFunction(() => document.querySelector('.center h2')?.textContent.includes('已送出'), { timeout: 8000, polling: 100 })
    await h4.bringToFront()
    await h4.waitForFunction(() => document.querySelector('.count-box b')?.textContent === '1', { timeout: 8000, polling: 100 })

    const t2 = await h4.$eval('.player audio', (a) => ({ t: a.currentTime, paused: a.paused }))
    ok(!t2.paused, '⭐ 有人作答後音樂還在播（沒有被暫停）')
    ok(
      t2.t >= t1,
      `⭐ 有人作答不會把音樂拉回開頭（作答前 ${t1.toFixed(2)}s → 作答後 ${t2.t.toFixed(2)}s）`
    )

    // 再多幾個 sync 也一樣（重按讚／再作答都會觸發）
    await h4.evaluate(() => document.querySelector('.player audio').currentTime)
    await sleep(600)
    const t3 = await h4.$eval('.player audio', (a) => a.currentTime)
    ok(t3 >= t2.t, `⭐ 音樂持續往前跑（${t2.t.toFixed(2)}s → ${t3.toFixed(2)}s）`)

    await ph4.close()
    await ph4b.close()
    await h4.close()
    fs.unlinkSync(wav)
    fullM.slides[mIdx].audio = null
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: fullM.slides }),
    })
  }

  /* ---------- 大廳音樂：主持人在大廳按播放，手機不會有聲音 ---------- */
  step('封面圖（自己指定 → 大廳顯示；沒指定 → 自動抓第一張題目圖）')
  {
    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })
    const put = async (buf, name) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'image/png' }), name)
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    }

    const fullK = await (await rq(`/presentations/${demo.id}`)).json()
    const firstImg = fullK.slides.find((sl) => sl.image)?.image
    ok(!!firstImg, `示範簡報有題目圖可以當自動封面：${firstImg}`)

    // 1) 沒指定封面 → 自動抓第一張題目圖
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ cover: null }) })
    const listAuto = await (await rq('/presentations')).json()
    const rowAuto = listAuto.find((p) => p.id === demo.id)
    ok(rowAuto.cover === firstImg, '⭐ 沒指定封面時，列表自動用第一張題目圖')

    const hk = watch(await browser.newPage(), 'present-cover-auto')
    await hk.setViewport({ width: 1600, height: 900 })
    await hk.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hk.waitForSelector('.lobby', { timeout: 10000 })
    await hk.waitForSelector('.lobby-cover img', { timeout: 6000 })
    ok(
      (await hk.$eval('.lobby-cover img', (e) => e.getAttribute('src'))) === firstImg,
      '⭐ 大廳也顯示自動抓來的那張'
    )
    await hk.close()

    // 2) 自己指定 → 兩邊都改用指定的那張
    const own = await put(solidPngFile(320, 200, 240, 80, 160), 'cover.png')
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ cover: own }) })
    const listOwn = await (await rq('/presentations')).json()
    ok(listOwn.find((p) => p.id === demo.id).cover === own, '⭐ 指定之後列表改用指定的那張')

    const hk2 = watch(await browser.newPage(), 'present-cover-own')
    await hk2.setViewport({ width: 1600, height: 900 })
    await hk2.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hk2.waitForSelector('.lobby-cover img', { timeout: 10000 })
    ok((await hk2.$eval('.lobby-cover img', (e) => e.getAttribute('src'))) === own, '⭐ 大廳改顯示指定的那張')
    ok(await hk2.$eval('.lobby-cover img', (e) => e.naturalWidth > 0), '⭐ 圖真的載入成功')
    ok(
      (await hk2.$eval('.lobby-cover img', (e) => getComputedStyle(e).objectFit)) === 'contain',
      '⭐ 封面 contain 不裁切'
    )

    // 版面：封面要坐在「加入資訊」與 QR 中間那塊空白，不能擋到誰
    const geo = await hk2.evaluate(() => {
      const c = document.querySelector('.lobby-cover').getBoundingClientRect()
      const qrEl = document.querySelector('.qr-card')
      const q = qrEl.getBoundingClientRect()
      const steps = document.querySelector('.steps').getBoundingClientRect()
      return {
        coverLeft: Math.round(c.left),
        coverRight: Math.round(c.right),
        stepsRight: Math.round(steps.right),
        qrLeft: Math.round(q.left),
        overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }
    })
    ok(geo.coverLeft >= geo.stepsRight - 2, `⭐ 封面在加入資訊的右邊（資訊到 ${geo.stepsRight}px，封面從 ${geo.coverLeft}px）`)
    ok(geo.coverRight <= geo.qrLeft + 2, `⭐ 封面在 QR 的左邊（封面到 ${geo.coverRight}px，QR 從 ${geo.qrLeft}px）`)
    ok(geo.overflow <= 2, `⭐ 加了封面大廳一樣不溢出（需要多捲 ${geo.overflow}px）`)
    await hk2.screenshot({ path: path.join(SHOTS, '27-大廳封面.png') })
    await hk2.close()

    // 3) 編輯器：整份簡報彈窗裡設得到，也看得到「現在自動用哪張」
    const ek2 = watch(await browser.newPage(), 'editor-cover')
    await ek2.setViewport({ width: 1440, height: 900 })
    await ek2.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ek2.waitForSelector('.thumb', { timeout: 8000 })
    await openGlobalSettings(ek2)
    const heads = await ek2.$$eval('.gs-box h3', (els) => els.map((e) => e.textContent.trim()))
    ok(heads.includes('封面'), `⭐ 設定彈窗有「封面」（${heads.join('、')}）`)
    await ek2.close()

    // 收拾
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ cover: null }) })
  }

  step('按鈕音效（放進資料夾就會自動讀到）')
  {
    const soundDir = path.join(process.env.MAKOQUIZ_DATA_DIR || 'data', 'sounds')
    ok(fs.existsSync(path.join(soundDir, '讀我.txt')), '⭐ 開機時自動建好 sounds/ 並附上說明檔')

    // 還沒放東西之前應該是空的
    const before = await (await fetch(`${BASE}/api/sounds`)).json()
    ok(Object.keys(before.sounds).length === 0, '⭐ 資料夾是空的時候清單也是空的（不會硬指一個不存在的檔）')

    // 丟一個進去 —— 不重開伺服器，直接再問一次
    fs.writeFileSync(path.join(soundDir, 'advance.mp3'), sineWavFile(1))
    const list = await (await fetch(`${BASE}/api/sounds`)).json()
    ok(list.sounds.advance === '/sounds/advance.mp3', `⭐ 檔案丟進去就讀得到，不用重開伺服器（${JSON.stringify(list.sounds)}）`)
    ok(!('back' in list.sounds), '⭐ 沒放的音效不會出現在清單裡（前端就不會去要一個 404）')

    // 換副檔名也要認得：手上是 wav 就不該逼人先轉檔
    fs.renameSync(path.join(soundDir, 'advance.mp3'), path.join(soundDir, 'advance.wav'))
    const asWav = await (await fetch(`${BASE}/api/sounds`)).json()
    ok(asWav.sounds.advance === '/sounds/advance.wav', `⭐ mp3 換成 wav 一樣讀得到（${asWav.sounds.advance}）`)
    fs.renameSync(path.join(soundDir, 'advance.wav'), path.join(soundDir, 'advance.mp3'))

    const res = await fetch(`${BASE}/sounds/advance.mp3`)
    ok(res.ok && res.headers.get('content-type') === 'audio/mpeg', `⭐ 音效檔拿得到（${res.status} ${res.headers.get('content-type')}）`)
    ok((await res.arrayBuffer()).byteLength > 1000, '⭐ 拿到的是真的音檔（不是空檔）')

    // 只認得固定的那幾個名字：擋掉路徑穿越
    const bad = await fetch(`${BASE}/sounds/..%2F..%2Fpresentations.json`)
    ok(!bad.ok, `⭐ 亂七八糟的檔名要擋掉（${bad.status}）`)
    const notAllowed = await fetch(`${BASE}/sounds/advance.txt`)
    ok(!notAllowed.ok, `⭐ 不是音檔的副檔名也擋掉（${notAllowed.status}）`)

    // 主持端真的會去載
    const hs = watch(await browser.newPage(), 'present-sfx')
    await hs.setViewport({ width: 1366, height: 768 })
    const asked = []
    hs.on('request', (r) => r.url().includes('/sounds/') && asked.push(r.url()))
    await hs.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hs.waitForSelector('.lobby', { timeout: 10000 })
    await sleep(600)
    ok(asked.some((u) => u.endsWith('/sounds/advance.mp3')), `⭐ 主持端會去載音效（${asked.length} 個請求）`)
    await hs.close()
  }

  step('作答音樂（整場的背景音樂，只在主持端播）')
  {
    const wav = path.join(SHOTS, '_quiz-bgm.wav')
    fs.writeFileSync(wav, sineWavFile(5, 8000))

    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })

    // 1) 從編輯器 UI 上傳（跟大廳音樂是分開的兩個欄位）
    await admin.bringToFront()
    await admin.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await admin.waitForSelector('.thumb', { timeout: 8000 })
    await openGlobalSettings(admin)
    await admin.waitForSelector('.gs-box .quiz-music-input', { timeout: 8000 })
    ok(!!(await admin.$('.gs-box .quiz-music-drop')), '⭐ 設定彈窗出現「上傳作答音樂」')
    await (await admin.$('.gs-box .quiz-music-input')).uploadFile(wav)
    await admin.waitForSelector('.gs-box .quiz-music-box audio', { timeout: 8000 })

    // 音量滑桿：拉到 20%
    await admin.$eval('.gs-box .quiz-music-volume', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '20')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await admin.waitForFunction(() => document.querySelector('.save-state')?.textContent?.includes('已儲存'), {
      timeout: 8000,
      polling: 200,
    })

    // 2) 同時也放一首大廳音樂：重點是兩首要各播各的，不能互相蓋掉
    const lobbyWav = await (async () => {
      const fd = new FormData()
      fd.append('file', new Blob([sineWavFile(3, 11025)], { type: 'audio/wav' }), 'lobby-bgm.wav')
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    })()
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ lobbyMusic: lobbyWav }) })

    const savedQ = await (await rq(`/presentations/${demo.id}`)).json()
    ok(/^\/uploads\/.+\.wav$/.test(savedQ.quizMusic || ''), `⭐ 作答音樂存進簡報：${savedQ.quizMusic}`)
    ok(savedQ.quizMusicVolume === 20, `⭐ 音量存進簡報：${savedQ.quizMusicVolume}%`)
    ok(
      savedQ.lobbyMusic === lobbyWav && savedQ.quizMusic !== savedQ.lobbyMusic,
      '⭐ 兩首歌各存各的欄位，設作答音樂沒有動到大廳音樂'
    )

    // 3) 大廳：放大廳音樂的場子，作答音樂不能插隊
    const hq = watch(await browser.newPage(), 'present-quizbgm')
    await hq.setViewport({ width: 1600, height: 900 })
    await hq.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hq.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const codeQ = await hq.$eval('.pill b', (e) => e.textContent)
    await hq.waitForSelector('.lobby-music audio', { timeout: 6000 })
    ok(!(await hq.$('.quiz-music-btn')), '⭐ 大廳不出現作答音樂按鈕（大廳有自己的音樂）')
    await sleep(500)
    ok(await hq.$eval('.controls audio', (a) => a.paused), '⭐ 大廳裡作答音樂是停著的')

    // 大廳音樂照樣能播，不受作答音樂影響
    await click(hq, '.lobby-music button')
    await hq.waitForFunction(() => {
      const a = document.querySelector('.lobby-music audio')
      return a && !a.paused && a.currentTime > 0.2
    }, { timeout: 8000, polling: 100 })
    ok(await hq.$eval('.controls audio', (a) => a.paused), '⭐ 大廳音樂在放的時候，作答音樂仍然安靜（沒有兩首一起響）')

    // 4) 開始出題 → 大廳音樂收掉、背景音樂接手，音量照設定
    await click(hq, '.ctrl-main')
    await hq.waitForFunction(() => {
      const a = document.querySelector('.controls audio')
      return a && !a.paused && a.currentTime > 0.2
    }, { timeout: 8000, polling: 100 })
    ok(true, '⭐ 進到題目後作答音樂自動接上')
    ok(!(await hq.$('.lobby-music')), '⭐ 大廳音樂隨著大廳畫面收掉，不會跟作答音樂疊在一起')
    ok(await hq.$eval('.controls audio', (a) => a.loop), '⭐ 作答音樂會循環（整場不會斷）')
    ok(Math.abs((await hq.$eval('.controls audio', (a) => a.volume)) - 0.2) < 0.01, '⭐ 音量套用了設定的 20%')
    await hq.screenshot({ path: path.join(SHOTS, '23b-作答音樂.png') })

    // 5) 音樂題自己有音檔，背景音樂要讓路，離開那一頁再接回去
    const musicIdx = savedQ.slides.findIndex((sl) => sl.type === 'music')
    ok(musicIdx >= 0, `示範簡報第 ${musicIdx + 1} 頁是音樂題`)
    const gotoSlide = async (i) => {
      const dots = await hq.$$('.dot-s')
      await dots[i].click()
      await hq.waitForFunction((n) => document.querySelector('.controls .pill')?.textContent?.startsWith(`${n} /`), { timeout: 6000, polling: 100 }, i + 1)
    }
    await gotoSlide(musicIdx)
    await hq.waitForFunction(() => document.querySelector('.controls audio')?.paused, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 走到音樂題，背景音樂自動讓路（不會兩首一起響）')
    const plainIdx = savedQ.slides.findIndex((sl, i) => i !== musicIdx && !['content', 'qa'].includes(sl.type))
    await gotoSlide(plainIdx)
    await hq.waitForFunction(() => !document.querySelector('.controls audio')?.paused, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 離開音樂題後背景音樂自己接回去')

    // 6) 手機端一樣不能拿到網址
    const phQ = watch(await browser.newPage(), 'play-quizbgm')
    await phQ.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await phQ.goto(`${BASE}/?c=${codeQ}`, { waitUntil: 'networkidle2' })
    await phQ.waitForSelector('.name-input', { timeout: 8000 })
    await phQ.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await phQ.type('.name-input', '路人')
    await click(phQ, '.go')
    await phQ.waitForSelector('.qhead, .center h2', { timeout: 10000 })
    ok(!(await phQ.$('audio')), '⭐ 手機端根本沒有 audio 元素')
    ok(
      !(await phQ.evaluate((u) => document.body.innerHTML.includes(u), savedQ.quizMusic)),
      '⭐ 手機端的資料裡完全找不到作答音樂網址'
    )
    await phQ.close()

    // 7) 主持人按一下就閉嘴，而且不會被下一頁自動接回去
    await hq.bringToFront()
    await click(hq, '.quiz-music-btn')
    await hq.waitForFunction(() => document.querySelector('.controls audio')?.paused, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 主持人按下去就靜音')
    await click(hq, '.ctrl-main')
    await sleep(700)
    ok(await hq.$eval('.controls audio', (a) => a.paused), '⭐ 換頁不會把主持人關掉的音樂又接回來')
    await click(hq, '.quiz-music-btn')
    await hq.waitForFunction(() => !document.querySelector('.controls audio')?.paused, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 再按一下可以放回來')

    await hq.close()
    fs.unlinkSync(wav)
    // 收拾：兩首都拿掉，後面的大廳音樂測試要從「還沒設定」的狀態開始
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ quizMusic: null, lobbyMusic: null }) })
  }

  step('大廳音樂（只在主持端播，不下發到手機）')
  {
    const wav = path.join(SHOTS, '_lobby.wav')
    fs.writeFileSync(wav, sineWavFile(4))

    // 1) 從編輯器 UI 上傳（彈窗裡有兩個音訊輸入：大廳音樂、作答音樂，要指名）
    await admin.bringToFront()
    await admin.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await admin.waitForSelector('.thumb', { timeout: 8000 })
    await openGlobalSettings(admin)
    await admin.waitForSelector('.gs-box .lobby-music-input', { timeout: 8000 })
    ok(!!(await admin.$('.gs-box .lobby-music-drop')), '⭐ 設定彈窗出現「上傳大廳音樂」')
    await (await admin.$('.gs-box .lobby-music-input')).uploadFile(wav)
    await admin.waitForSelector('.gs-box .lobby-music-box audio', { timeout: 8000 })
    await admin.waitForFunction(() => document.querySelector('.save-state')?.textContent === '已儲存', { timeout: 8000, polling: 200 })
    ok(true, '⭐ 上傳後存檔完成')
    const savedMusic = await (
      await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })
    ).json()
    ok(/^\/uploads\/.+\.wav$/.test(savedMusic.lobbyMusic || ''), `⭐ 大廳音樂存進簡報：${savedMusic.lobbyMusic}`)

    // 2) 開一場，大廳要出現播放按鈕
    const hl = watch(await browser.newPage(), 'present-lobby')
    await hl.setViewport({ width: 1600, height: 900 })
    await hl.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hl.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const codeL = await hl.$eval('.pill b', (e) => e.textContent)
    await hl.waitForSelector('.lobby-music button', { timeout: 6000 })
    ok(true, '⭐ 大廳出現播放音樂按鈕')
    ok((await hl.$eval('.lobby-music button', (e) => e.textContent)).includes('播放'), '按鈕預設是「播放音樂」')
    ok(await hl.$eval('.lobby-music audio', (a) => a.loop), '⭐ 大廳音樂會循環播放')
    ok(await hl.$eval('.lobby-music audio', (a) => a.currentTime === 0 && a.paused), '一開始是停著的，不會自動放')

    // 3) 按下去要真的開始播
    await click(hl, '.lobby-music button')
    await hl.waitForFunction(() => {
      const a = document.querySelector('.lobby-music audio')
      return a && !a.paused && a.currentTime > 0.2
    }, { timeout: 8000, polling: 100 })
    ok(true, '⭐ 按播放後音樂真的開始跑')
    ok((await hl.$eval('.lobby-music button', (e) => e.textContent)).includes('暫停'), '按鈕變成「暫停音樂」')
    await hl.screenshot({ path: path.join(SHOTS, '23-大廳音樂.png') })

    // 4) 手機加入，絕對不能拿到大廳音樂的網址（不然手機會有聲音）
    const phL = watch(await browser.newPage(), 'play-lobby')
    await phL.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await phL.goto(`${BASE}/?c=${codeL}`, { waitUntil: 'networkidle2' })
    await phL.waitForSelector('.name-input', { timeout: 8000 })
    await phL.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await phL.type('.name-input', '大廳聽眾')
    await click(phL, '.go')
    await phL.waitForSelector('.center h2', { timeout: 10000 })
    ok(!(await phL.$('audio')), '⭐ 手機端根本沒有 audio 元素')
    ok(!(await phL.evaluate((u) => document.body.innerHTML.includes(u), savedMusic.lobbyMusic)), '⭐ 手機端的資料裡完全找不到大廳音樂網址')

    // 5) 暫停也要有效
    await hl.bringToFront()
    await click(hl, '.lobby-music button')
    await hl.waitForFunction(() => document.querySelector('.lobby-music audio')?.paused, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 再按一下就暫停')

    // 6) 開始出題後，大廳音樂的元素要消失（自動停播）
    await click(hl, '.ctrl-main')
    await hl.waitForFunction(() => !document.querySelector('.lobby-music'), { timeout: 6000, polling: 100 })
    ok(true, '⭐ 進到題目後大廳音樂就停了')

    await phL.close()
    await hl.close()
    fs.unlinkSync(wav)
    // 收拾：把大廳音樂拿掉，不要影響後面的測試與使用者資料
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ lobbyMusic: null }),
    })
  }

  /* ---------- 分類題：真的用拖的 ---------- */
  step('配對題的圖片（純圖片也要能玩）')
  {
    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })
    const put = async (buf, name) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'image/png' }), name)
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    }

    // 直式圖（像角色立繪）最吃高度，用 80x120 當素材
    const [iL1, iR1, iL2, iR2, imgs3] = await Promise.all([
      put(solidPngFile(80, 120, 220, 40, 40), 'L1.png'),
      put(solidPngFile(80, 120, 40, 220, 40), 'R1.png'),
      put(solidPngFile(80, 120, 40, 40, 220), 'L2.png'),
      put(solidPngFile(80, 120, 220, 220, 40), 'R2.png'),
      put(solidPngFile(400, 300, 90, 90, 200), 'Q3.png'),
    ])

    const fullM = await (await rq(`/presentations/${demo.id}`)).json()
    const mIdx = fullM.slides.findIndex((sl) => sl.type === 'match')
    // 先留一份原本的「整張投影片」，收拾的時候要還原。
    // 只留 pairs 不夠 —— 下面還會動到 slide.image（驗左右分欄要有題目圖）
    const origSlide = JSON.parse(JSON.stringify(fullM.slides[mIdx]))
    /*
     * 用「上限 8 組」而不是隨便 3 組：8 組全帶圖是最擠的情況，
     * 大螢幕溢不溢出要用最壞狀況驗，不然這個檢查等於沒驗到。
     * 同時混進三種寫法：只有圖、圖＋字、只有字。
     */
    fullM.slides[mIdx].pairs = [
      { id: 'mi1', left: '', right: '', leftImage: iL1, rightImage: iR1 },
      { id: 'mi2', left: '有字也有圖', right: '答案也是', leftImage: iL2, rightImage: iR2 },
      { id: 'mi3', left: '只有字', right: '只有字的答案', leftImage: null, rightImage: null },
      ...Array.from({ length: 5 }, (_, k) => ({
        id: 'mx' + k,
        left: `第 ${k + 4} 題`,
        right: `第 ${k + 4} 答`,
        leftImage: k % 2 ? iL1 : iL2,
        rightImage: k % 2 ? iR1 : iR2,
      })),
    ]
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: fullM.slides }) })

    // 場次是開場時深拷貝的，要重開一場才吃得到新題目
    const hm = watch(await browser.newPage(), 'present-match-img')
    await hm.setViewport({ width: 1366, height: 768 })
    await hm.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hm.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const codeM = await hm.$eval('.pill b', (e) => e.textContent)

    const phm = watch(await browser.newPage(), 'play-match-img')
    await phm.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await phm.goto(`${BASE}/?c=${codeM}`, { waitUntil: 'networkidle2' })
    await phm.waitForSelector('.name-input', { timeout: 8000 })
    await phm.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await phm.type('.name-input', '配對圖')
    await click(phm, '.go')

    await hm.bringToFront()
    await click(hm, '.ctrl-main')
    await hm.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), mIdx)
    await phm.bringToFront()
    await phm.waitForSelector('.match-grid', { timeout: 8000 })

    // 手機：圖片真的畫出來了，而且是「看得到整張」不是被裁掉
    // 8 組裡有 7 組帶圖，左右各 7 張
    await phm.waitForFunction(() => document.querySelectorAll('.match-grid .mimg').length === 14, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 手機上 14 張配對圖都出現了（8 組裡 7 組有圖、1 組純文字）')
    const fits = await phm.$$eval('.match-grid .mimg', (els) =>
      els.map((e) => ({ fit: getComputedStyle(e).objectFit, loaded: e.naturalWidth > 0, h: Math.round(e.getBoundingClientRect().height) }))
    )
    ok(fits.every((f) => f.fit === 'contain'), '⭐ 圖片一律 contain —— 看圖配對被裁掉就等於毀了題目')
    ok(fits.every((f) => f.loaded), '⭐ 每張圖都真的載入成功（不是壞掉的圖示）')
    ok(new Set(fits.map((f) => f.h)).size === 1, `每格圖高度一致（${fits[0].h}px）`)

    // 純圖片的格子：沒有文字節點，但仍然有可讀的名稱
    const cells = await phm.$$eval('.match-grid .mcell', (els) =>
      els.map((e) => ({
        hasImg: !!e.querySelector('.mimg'),
        text: (e.querySelector('.mtext')?.textContent || '').trim(),
        label: e.getAttribute('aria-label') || '',
        h: Math.round(e.getBoundingClientRect().height),
      }))
    )
    const imgOnly = cells.filter((c) => c.hasImg && !c.text)
    ok(imgOnly.length === 2, `⭐ 有兩格是純圖片（沒有空白文字撐版面）`)
    ok(imgOnly.every((c) => c.label), '⭐ 純圖片的格子仍有 aria-label，不是一顆沒名字的按鈕')
    ok(cells.every((c) => c.h > 0), '每一格都有高度（純圖片的格子不會塌掉）')

    // 最重要的：右欄多了圖，也絕對不能因此洩漏配對關係
    const leak = await phm.evaluate(() => document.body.innerHTML)
    ok(!leak.includes('mi1') && !leak.includes('mi2'), '⭐ 手機端拿不到 pairId（右欄只給洗過牌的 token）')
    ok(!leak.includes('rightImage') && !leak.includes('leftImage'), '⭐ 手機端沒有原始的 leftImage／rightImage 欄位')

    // 大螢幕：8 組圖也不能擠爆版面
    await hm.bringToFront()
    const over = await hm.evaluate(() => {
      const el = document.querySelector('.canvas')
      return { need: el.scrollHeight - el.clientHeight, body: document.documentElement.scrollHeight - document.documentElement.clientHeight }
    })
    ok(over.need <= 2 && over.body <= 2, `⭐ 8 組全帶圖也塞得進一個螢幕（需要多捲 ${over.need}px）`)
    ok((await hm.$$('.p-row .pimg')).length === 7, '⭐ 大螢幕作答中顯示左欄的圖（右欄還是問號）')

    /*
     * 版面：配對列很窄，撐滿整個寬度的話右邊會空一大片。
     * 有題目圖的時候要改成「左邊列、右邊題目圖」，把那塊空白補起來。
     * 這一題有 8 組（排兩欄、本來就佔滿寬度），所以不該切 —— 另外用 3 組的驗。
     */
    ok(!(await hm.$('.q-content.side-media')), '8 組排兩欄時不切左右（列本來就佔滿寬度）')
    await hm.screenshot({ path: path.join(SHOTS, '24-配對題圖片.png') })

    // 換成 3 組＋題目圖：這就是會空出一大片的情況，要切成左右兩欄
    const narrow = JSON.parse(JSON.stringify(fullM.slides[mIdx]))
    narrow.pairs = narrow.pairs.slice(0, 3)
    narrow.image = imgs3
    const slides3 = JSON.parse(JSON.stringify(fullM.slides))
    slides3[mIdx] = narrow
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: slides3 }) })

    const hm3 = watch(await browser.newPage(), 'present-match-split')
    await hm3.setViewport({ width: 1366, height: 768 })
    await hm3.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hm3.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    await click(hm3, '.ctrl-main')
    await hm3.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), mIdx)
    await hm3.waitForSelector('.p-row', { timeout: 6000 })
    await sleep(400)

    ok(!!(await hm3.$('.q-content.side-media')), '⭐ 3 組＋題目圖：改成左右分欄')
    const geo = await hm3.evaluate(() => {
      const rows = document.querySelector('.p-rows').getBoundingClientRect()
      const img = document.querySelector('.q-img').getBoundingClientRect()
      return {
        rowsRight: Math.round(rows.right),
        rowsW: Math.round(rows.width),
        imgLeft: Math.round(img.left),
        imgW: Math.round(img.width),
        vw: window.innerWidth,
      }
    })
    ok(geo.imgLeft >= geo.rowsRight - 2, `⭐ 題目圖在配對列的右邊（列到 ${geo.rowsRight}px，圖從 ${geo.imgLeft}px 開始）`)
    ok(geo.rowsW < geo.vw * 0.72, `⭐ 配對列不再撐滿整個寬度（${geo.rowsW}px / 畫面 ${geo.vw}px）`)
    ok(geo.imgW > 180, `⭐ 題目圖拿到實際的空間，不再是上方那張小圖（寬 ${geo.imgW}px）`)
    const over3 = await hm3.evaluate(() => {
      const el = document.querySelector('.canvas')
      return el.scrollHeight - el.clientHeight
    })
    ok(over3 <= 2, `⭐ 左右分欄後一樣不溢出（需要多捲 ${over3}px）`)
    await hm3.screenshot({ path: path.join(SHOTS, '24c-配對題左右分欄.png') })
    await hm3.close()

    // 公布答案：左右兩邊的圖都要出來
    await click(hm, '.ctrl-main')
    await hm.waitForFunction(() => document.querySelectorAll('.p-row .pimg').length === 14, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 公布後左右兩欄的圖都顯示')
    const rOver = await hm.evaluate(() => {
      const el = document.querySelector('.canvas')
      return el.scrollHeight - el.clientHeight
    })
    ok(rOver <= 2, `⭐ 公布答案時一樣不溢出（需要多捲 ${rOver}px）`)
    await hm.screenshot({ path: path.join(SHOTS, '24b-配對題公布.png') })

    await phm.close()
    await hm.close()
    // 收拾：把配對題整張還原回原本的樣子
    const backM = await (await rq(`/presentations/${demo.id}`)).json()
    backM.slides[mIdx] = origSlide
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: backM.slides }) })
  }

  step('順序題的圖片（純圖片也要能排）')
  {
    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })
    const put = async (buf, name) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'image/png' }), name)
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    }
    // 每個項目一張顏色不同的圖：圖片網址不重複，才認得出手機上排的是哪個順序
    const imgs = await Promise.all(
      Array.from({ length: 8 }, (_, k) => put(solidPngFile(100, 70, 20 + k * 28, 240 - k * 26, 60 + k * 20), `o${k}.png`))
    )

    const fullO = await (await rq(`/presentations/${demo.id}`)).json()
    const oIdx = fullO.slides.findIndex((sl) => sl.type === 'order')
    const origItems = JSON.parse(JSON.stringify(fullO.slides[oIdx].items))
    // 上限 8 個、7 個帶圖：最壞情況才驗得出大螢幕溢不溢出
    fullO.slides[oIdx].items = [
      { id: 'oi1', text: '', image: imgs[0] },
      { id: 'oi2', text: '', image: imgs[1] },
      { id: 'oi3', text: '只有字', image: null },
      ...Array.from({ length: 5 }, (_, k) => ({ id: 'ox' + k, text: `第 ${k + 4} 件事`, image: imgs[k + 3] })),
    ]
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: fullO.slides }) })

    const ho = watch(await browser.newPage(), 'present-order-img')
    await ho.setViewport({ width: 1366, height: 768 })
    await ho.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ho.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const codeO = await ho.$eval('.pill b', (e) => e.textContent)

    const pho = watch(await browser.newPage(), 'play-order-img')
    await pho.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await pho.goto(`${BASE}/?c=${codeO}`, { waitUntil: 'networkidle2' })
    await pho.waitForSelector('.name-input', { timeout: 8000 })
    await pho.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await pho.type('.name-input', '排序圖')
    await click(pho, '.go')

    await ho.bringToFront()
    await click(ho, '.ctrl-main')
    await ho.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), oIdx)

    // 手機
    await pho.bringToFront()
    await pho.waitForSelector('.order-list', { timeout: 8000 })
    await pho.waitForFunction(() => document.querySelectorAll('.order-list .oimg').length === 7, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 手機上 7 張項目圖都出現了（8 個裡 7 個有圖、1 個純文字）')
    const ofits = await pho.$$eval('.order-list .oimg', (els) =>
      els.map((e) => ({ fit: getComputedStyle(e).objectFit, loaded: e.naturalWidth > 0 }))
    )
    ok(ofits.every((f) => f.fit === 'contain'), '⭐ 圖片一律 contain，不裁切')
    ok(ofits.every((f) => f.loaded), '⭐ 每張圖都真的載入成功')

    const orows = await pho.$$eval('.order-list .orow', (els) =>
      els.map((e) => ({
        hasImg: !!e.querySelector('.oimg'),
        text: (e.querySelector('.txt')?.textContent || '').trim(),
        label: e.getAttribute('aria-label') || '',
        h: Math.round(e.getBoundingClientRect().height),
      }))
    )
    ok(orows.filter((o) => o.hasImg && !o.text).length === 2, '⭐ 有兩個是純圖片項目')
    ok(orows.every((o) => o.label), '⭐ 純圖片的項目仍有 aria-label')
    ok(orows.every((o) => o.h > 0), '每一列都有高度')

    /*
     * 最重要的：順序題的 items 原始順序「就是」答案。
     * 手機上一定要是打亂過的 —— 圖片跟著自己的項目走，不能因為多了圖就把順序漏出去。
     * 用「每一列的圖片網址（沒圖就用文字）」當簽名，跟正解的簽名比。
     */
    const sign = (items) => items.map((it) => it.image || it.text).join('|')
    const trueSign = sign(fullO.slides[oIdx].items)
    const phoneSign = await pho.$$eval('.order-list .orow', (els) =>
      els.map((e) => e.querySelector('.oimg')?.getAttribute('src') || e.querySelector('.txt')?.textContent.trim()).join('|')
    )
    ok(phoneSign.split('|').length === 8, '八個項目都在手機上')
    ok(phoneSign !== trueSign, '⭐ 手機上的順序跟正解不一樣（有洗過牌，沒被圖片洩漏）')
    ok(
      phoneSign.split('|').sort().join() === trueSign.split('|').sort().join(),
      '⭐ 洗牌只是換順序，八個項目與各自的圖都還在（沒有錯位或掉圖）'
    )

    // 大螢幕：作答中列出打亂的項目（含圖），公布後才是正確順序
    await ho.bringToFront()
    await ho.waitForFunction(() => document.querySelectorAll('.item-pool .poimg').length === 7, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 大螢幕作答中列出打亂的項目，圖也一起顯示')
    const poolOver = await ho.evaluate(() => {
      const el = document.querySelector('.canvas')
      return { need: el.scrollHeight - el.clientHeight, body: document.documentElement.scrollHeight - document.documentElement.clientHeight }
    })
    ok(poolOver.need <= 2 && poolOver.body <= 2, `⭐ 作答中的項目池塞得進一個螢幕（需要多捲 ${poolOver.need}px）`)
    await ho.screenshot({ path: path.join(SHOTS, '25-順序題圖片.png') })

    await click(ho, '.ctrl-main')
    await ho.waitForFunction(() => document.querySelectorAll('.p-row .pimg').length === 7, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 公布後的正確順序也帶圖')
    const revOver = await ho.evaluate(() => {
      const el = document.querySelector('.canvas')
      return el.scrollHeight - el.clientHeight
    })
    ok(revOver <= 2, `⭐ 公布正確順序時 8 個全帶圖也不溢出（需要多捲 ${revOver}px）`)
    const revTexts = await ho.$$eval('.p-row .n', (els) => els.map((e) => e.textContent.trim()))
    ok(revTexts.join(',') === '1,2,3,4,5,6,7,8', `⭐ 公布的是 1~8 的正確順序（${revTexts.join(',')}）`)
    await ho.screenshot({ path: path.join(SHOTS, '25b-順序題公布.png') })

    await pho.close()
    await ho.close()
    const backO = await (await rq(`/presentations/${demo.id}`)).json()
    backO.slides[oIdx].items = origItems
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: backO.slides }) })
  }

  step('分類題（手機上用拖曳）')
  {
    const full2 = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const catIdx = full2.slides.findIndex((s) => s.type === 'categorize')
    await host.bringToFront()
    await host.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), catIdx)
    await phone.waitForSelector('.cat-board', { timeout: 8000 })
    ok(true, '參與者看到分類板')

    const pool = await phone.$$('.pool .chip-item')
    const cats = await phone.$$('.cat')
    ok(pool.length === 6 && cats.length === 3, `${pool.length} 個項目、${cats.length} 個分類`)
    ok(!(await phone.evaluate(() => document.body.innerHTML.includes('categoryId'))), '⭐ HTML 裡沒有答案')

    // 真的用手指拖第一個項目到第一個分類
    await phone.bringToFront()
    const box = await pool[0].boundingBox()
    const target = await cats[0].boundingBox()
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await phone.mouse.down()
    await phone.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
    ok(!!(await phone.$('.drag-ghost')), '⭐ 拖曳時有跟著手指跑的浮動元素')
    ok(!!(await phone.$('.cat.hot')), '⭐ 拖到分類上方時該分類會高亮')
    await phone.mouse.up()

    await phone.waitForFunction(() => document.querySelectorAll('.cat .chip-item.in').length === 1, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 放開後項目真的進到分類裡')
    ok((await phone.$$('.pool .chip-item')).length === 5, '未分類區少了一個')
    ok(!(await phone.$('.drag-ghost')), '放開後浮動元素消失')

    // 點選模式：手指不方便拖的人也要能用
    const pool2 = await phone.$$('.pool .chip-item')
    await pool2[0].click()
    await phone.waitForSelector('.chip-item.picked', { timeout: 2000 })
    ok(true, '⭐ 點一下項目會選起來（不用拖也能玩）')
    // 點分類標題，不要點框中間 —— 中間可能已經有項目了（點項目是「選它」不是「指派」）
    await (await phone.$$('.cat-name'))[1].click()
    await phone.waitForFunction(() => document.querySelectorAll('.cat .chip-item.in').length === 2, { timeout: 3000, polling: 100 })
    ok(true, '⭐ 再點分類就放進去了')

    // 沒放完不能送出
    ok(await phone.$eval('.submit', (e) => e.disabled), '還沒全部放完，送出鈕是停用的')
    ok((await phone.$eval('.submit', (e) => e.textContent)).includes('4'), '按鈕會顯示還剩幾個沒放')

    // 剩下的用點的放完
    for (let i = 0; i < 6; i++) {
      const items = await phone.$$('.pool .chip-item')
      if (!items.length) break
      await phone.bringToFront()
      await items[0].click()
      await (await phone.$$('.cat-name'))[i % 3].click()
      await sleep(150)
    }
    await phone.waitForFunction(() => !document.querySelector('.submit').disabled, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 全部放完後可以送出')
    await phone.screenshot({ path: path.join(SHOTS, '16-分類題.png') })

    await click(phone, '.submit')
    await phone.waitForFunction(() => document.querySelector('.center h2')?.textContent.includes('已送出'), { timeout: 6000, polling: 200 })
    ok(true, '送出成功')

    await click(host, '.ctrl-main') // 公布
    await host.waitForSelector('.cat-cols .cat-chip', { timeout: 6000 })
    ok(true, '⭐ 大螢幕公布時顯示每個分類的正解與答對人數')
    await host.screenshot({ path: path.join(SHOTS, '17-分類題公布.png') })
  }

  /* ---------- 自訂表情符號 ---------- */
  step('分類題的圖片（純圖片也要能分）')
  {
    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })
    const put = async (buf, name) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'image/png' }), name)
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    }
    const cimgs = await Promise.all(
      Array.from({ length: 6 }, (_, k) => put(solidPngFile(90, 60, 40 + k * 34, 210 - k * 30, 120), `c${k}.png`))
    )

    const fullC = await (await rq(`/presentations/${demo.id}`)).json()
    const cIdx = fullC.slides.findIndex((sl) => sl.type === 'categorize')
    const origC = JSON.parse(JSON.stringify(fullC.slides[cIdx]))
    const cats = fullC.slides[cIdx].categories
    fullC.slides[cIdx].items = [
      { id: 'ci1', text: '', image: cimgs[0], categoryId: cats[0].id },
      { id: 'ci2', text: '', image: cimgs[1], categoryId: cats[1].id },
      { id: 'ci3', text: '只有字', image: null, categoryId: cats[0].id },
      ...Array.from({ length: 3 }, (_, k) => ({
        id: 'cx' + k,
        text: `項目 ${k + 4}`,
        image: cimgs[k + 2],
        categoryId: cats[k % cats.length].id,
      })),
    ]
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: fullC.slides }) })

    const hc = watch(await browser.newPage(), 'present-cat-img')
    await hc.setViewport({ width: 1366, height: 768 })
    await hc.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hc.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const codeC = await hc.$eval('.pill b', (e) => e.textContent)

    const phc = watch(await browser.newPage(), 'play-cat-img')
    await phc.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await phc.goto(`${BASE}/?c=${codeC}`, { waitUntil: 'networkidle2' })
    await phc.waitForSelector('.name-input', { timeout: 8000 })
    await phc.$eval('.name-input', (e) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(e, '')
      e.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await phc.type('.name-input', '分類圖')
    await click(phc, '.go')

    await hc.bringToFront()
    await click(hc, '.ctrl-main')
    await hc.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), cIdx)

    // 手機
    await phc.bringToFront()
    await phc.waitForSelector('.cat-board', { timeout: 8000 })
    await phc.waitForFunction(() => document.querySelectorAll('.pool .chip-item .cimg').length === 5, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 手機池子裡 5 張項目圖都出現了（6 個裡 5 個有圖、1 個純文字）')
    const cfits = await phc.$$eval('.pool .chip-item .cimg', (els) =>
      els.map((e) => ({ fit: getComputedStyle(e).objectFit, loaded: e.naturalWidth > 0 }))
    )
    ok(cfits.every((f) => f.fit === 'contain' && f.loaded), '⭐ 圖片一律 contain 且都載入成功')

    const cchips = await phc.$$eval('.pool .chip-item', (els) =>
      els.map((e) => ({
        hasImg: !!e.querySelector('.cimg'),
        text: (e.querySelector('span')?.textContent || '').trim(),
        label: e.getAttribute('aria-label') || '',
        radius: getComputedStyle(e).borderRadius,
      }))
    )
    ok(cchips.filter((c) => c.hasImg && !c.text).length === 2, '⭐ 有兩個是純圖片項目')
    ok(cchips.every((c) => c.label), '⭐ 純圖片的項目仍有 aria-label')
    ok(
      cchips.filter((c) => c.hasImg).every((c) => !c.radius.startsWith('999')),
      '⭐ 有圖的項目不再是藥丸形（換成卡片，圖才不會被圓角切掉）'
    )

    // 答案絕對不能漏
    ok(
      !(await phc.evaluate(() => document.body.innerHTML.includes('categoryId'))),
      '⭐ 手機端 HTML 裡沒有 categoryId（多了圖也沒把答案帶出去）'
    )

    /*
     * 真的拖一個「純圖片」的項目：跟著手指跑的 ghost 不能是空的。
     *
     * 項目池是「每位參與者一個亂數順序」，種子是隨機的 playerId ——
     * 所以不能假設第 0 個就是純圖片的那個（那樣時好時壞，跟擲骰子一樣）。
     * 這裡指名去找「有圖、沒文字」的那一個。
     */
    const pool = await phc.$$('.pool .chip-item')
    const imgOnlyIdx = await phc.$$eval('.pool .chip-item', (els) =>
      els.findIndex((e) => e.querySelector('.cimg') && !e.querySelector('span')?.textContent?.trim())
    )
    ok(imgOnlyIdx >= 0, `池子裡找得到純圖片的項目（第 ${imgOnlyIdx + 1} 個）`)
    const catBoxes = await phc.$$('.cat')
    const pbox = await pool[imgOnlyIdx].boundingBox()
    const tbox = await catBoxes[0].boundingBox()
    await phc.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2)
    await phc.mouse.down()
    await phc.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 12 })
    const ghost = await phc.evaluate(() => {
      const g = document.querySelector('.drag-ghost')
      if (!g) return null
      const img = g.querySelector('.cimg')
      return { hasImg: !!img, w: Math.round(g.getBoundingClientRect().width), h: Math.round(g.getBoundingClientRect().height) }
    })
    ok(!!ghost, '⭐ 拖曳時有跟著手指跑的浮動元素')
    ok(ghost.hasImg, '⭐ 拖純圖片的項目時，浮動元素裡也有圖（不是一塊空白）')
    ok(ghost.w > 20 && ghost.h > 20, `浮動元素有實際大小（${ghost.w}x${ghost.h}）`)
    await phc.mouse.up()
    await phc.waitForFunction(() => document.querySelectorAll('.cat .chip-item.in').length === 1, { timeout: 4000, polling: 100 })
    ok(true, '⭐ 放開後純圖片的項目真的進到分類裡')
    ok(!!(await phc.$('.cat .chip-item.in .cimg')), '⭐ 進了分類之後圖還在')
    const inH = await phc.$eval('.cat .chip-item.in .cimg', (e) => Math.round(e.getBoundingClientRect().height))
    const poolH = await phc.$eval('.pool .chip-item .cimg', (e) => Math.round(e.getBoundingClientRect().height))
    ok(inH < poolH, `⭐ 分類框裡的圖比池子裡小（${inH}px < ${poolH}px）—— 窄欄放不下大圖`)
    await phc.screenshot({ path: path.join(SHOTS, '26-分類題圖片.png') })

    // 大螢幕
    await hc.bringToFront()
    await hc.waitForFunction(() => document.querySelectorAll('.item-pool .poimg').length === 5, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 大螢幕作答中列出打亂的項目，圖也一起顯示')
    const cOver = await hc.evaluate(() => {
      const el = document.querySelector('.canvas')
      return { need: el.scrollHeight - el.clientHeight, body: document.documentElement.scrollHeight - document.documentElement.clientHeight }
    })
    ok(cOver.need <= 2 && cOver.body <= 2, `⭐ 分類題有圖也塞得進一個螢幕（需要多捲 ${cOver.need}px）`)

    await click(hc, '.ctrl-main')
    await hc.waitForFunction(() => document.querySelectorAll('.cat-chip .cimg').length === 5, { timeout: 6000, polling: 100 })
    ok(true, '⭐ 公布後每個分類欄裡的項目也帶圖')
    const revC = await hc.evaluate(() => {
      const el = document.querySelector('.canvas')
      return el.scrollHeight - el.clientHeight
    })
    ok(revC <= 2, `⭐ 公布答案時一樣不溢出（需要多捲 ${revC}px）`)
    await hc.screenshot({ path: path.join(SHOTS, '26b-分類題公布.png') })

    await phc.close()
    await hc.close()
    const backC = await (await rq(`/presentations/${demo.id}`)).json()
    backC.slides[cIdx] = origC
    await rq(`/presentations/${demo.id}`, { method: 'PUT', body: JSON.stringify({ slides: backC.slides }) })
  }

  step('自訂表情符號（上傳 → 送出 → 浮出 → 淡出）')
  {
    // 先歸零，這樣測試重跑（或上次跑一半掛掉）都不會被殘留的表符干擾
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ reactions: [] }),
    })

    // 在編輯器上傳兩個表符
    const ed2 = watch(await browser.newPage(), 'editor-react')
    await ed2.setViewport({ width: 1440, height: 900 })
    await ed2.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ed2.waitForSelector('.thumb', { timeout: 8000 })
    await openGlobalSettings(ed2)

    const emo = path.join(SHOTS, '_emo.png')
    fs.writeFileSync(emo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mP8z8BQz0AEYBxVSF+FjIOKUIUAAP//AwDPqQPTs5A1QQAAAABJRU5ErkJggg==', 'base64'))
    const reactInput = await ed2.$$('.gs-box input[type=file]')
    // 彈窗裡好幾個 file input（封面、背景、表符、兩首音樂），表符那個是唯一 multiple 的
    const multiInput = await ed2.$('.gs-box input[type=file][multiple]')
    ok(!!multiInput, `找到表符上傳欄位（彈窗共 ${reactInput.length} 個 file input）`)
    await multiInput.uploadFile(emo, emo)
    await ed2.waitForSelector('.react-cell img', { timeout: 10000 })
    const cells = await ed2.$$('.react-cell')
    ok(cells.length === 2, `⭐ 一次上傳兩個表符都加進來了（${cells.length} 個）`)

    await ed2.waitForFunction(() => document.querySelector('.save-state')?.textContent === '已儲存', { timeout: 8000, polling: 200 })
    const savedR = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    ok(savedR.reactions.length === 2 && savedR.reactions[0].url.startsWith('/uploads/'), '⭐ 表符有存進伺服器')
    await ed2.close()

    // 開新場次才吃得到新表符（場次是開場時深拷貝簡報）
    const host2 = watch(await browser.newPage(), 'present-react')
    await host2.setViewport({ width: 1280, height: 800 })
    await host2.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await host2.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const code2 = await host2.$eval('.pill b', (e) => e.textContent)

    const phone2 = watch(await browser.newPage(), 'play-react')
    await phone2.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await phone2.goto(`${BASE}/?c=${code2}`, { waitUntil: 'networkidle2' })
    await phone2.waitForSelector('.found', { timeout: 8000 })
    await phone2.type('.name-input', '表符測試員')
    await click(phone2, '.go')
    await phone2.waitForSelector('.center h2', { timeout: 10000 })

    // 大廳（還沒開始）就能送表情：等待畫面直接放一排表情鈕，不用只靠頂列的小圖示
    ok(!!(await phone2.$('.lobby-reacts')), '⭐ 大廳等待畫面出現表情列')
    const lobbyReactBtns = await phone2.$$('.lobby-reacts .react-btn')
    ok(lobbyReactBtns.length === 2, `⭐ 大廳表情列有 2 顆可選（${lobbyReactBtns.length}）`)
    await phone2.bringToFront()
    await lobbyReactBtns[0].click()
    await host2.bringToFront()
    await host2.waitForSelector('.reaction-layer .floater', { timeout: 5000 })
    ok(true, '⭐ 大廳送出的表情就浮到主持人的大螢幕（開始前也能炒熱氣氛）')
    // 等它淡出，免得干擾後面「頂列送出後浮出」那段的計數
    await host2.waitForFunction(() => !document.querySelector('.reaction-layer .floater'), { timeout: 10000, polling: 200 })

    // 大廳也能提問：開始前就把問題先丟出來，主持人在大廳就收得到
    ok(!!(await phone2.$('.qa-toggle')), '⭐ 大廳也出現「提問」按鈕')
    await phone2.bringToFront()
    await click(phone2, '.qa-toggle')
    await phone2.waitForSelector('.sheet-body textarea', { timeout: 4000 })
    await sleep(300) // 面板是滑上來的，等動畫跑完再打字
    await phone2.type('.sheet-body textarea', '大廳可以先問嗎')
    await click(phone2, '.qa-compose .btn-primary')
    await phone2.waitForSelector('.qa-item', { timeout: 5000 })
    ok(true, '⭐ 大廳就能送出提問')
    await host2.bringToFront()
    await host2.waitForFunction(
      () => {
        const b = [...document.querySelectorAll('.top .ghost-btn')].find((x) => x.textContent.includes('提問'))
        return b && (b.querySelector('b')?.textContent || '0') !== '0'
      },
      { timeout: 5000, polling: 100 }
    )
    ok(true, '⭐ 主持人在大廳就收到提問')
    // 關掉面板，免得全螢幕遮罩擋住後面對頂列表符的點擊
    await phone2.bringToFront()
    await phone2.evaluate(() => [...document.querySelectorAll('.sheet-head button')].find((x) => x.textContent.includes('關閉'))?.click())
    await phone2.waitForFunction(() => !document.querySelector('.sheet'), { timeout: 4000, polling: 100 })

    // 手機上也要出現頂列的表符按鈕
    ok(!!(await phone2.$('.react-toggle')), '手機頂列出現表符按鈕')
    await click(phone2, '.react-toggle')
    await phone2.waitForSelector('.react-bar .react-btn', { timeout: 4000 })
    // 只數頂列那一排（.lobby-reacts 底下也有 .react-btn，不要一起算進來）
    const btns = await phone2.$$('.react-bar .react-btn')
    ok(btns.length === 2, `⭐ 表符列顯示 2 顆可選`)

    // 送出 → 大螢幕要浮出來
    await sleep(300)
    await phone2.bringToFront()
    await btns[0].click()
    await host2.waitForSelector('.reaction-layer .floater', { timeout: 5000 })
    ok(true, '⭐ 參與者送出後，大螢幕浮出表情符號')

    const floater = await host2.$eval('.reaction-layer .floater', (e) => ({
      src: e.getAttribute('src'),
      bottom: getComputedStyle(e).bottom,
      pos: getComputedStyle(e).position,
      anim: getComputedStyle(e).animationName,
    }))
    ok(floater.src.startsWith('/uploads/'), '浮出來的是上傳的那張圖')
    ok(floater.bottom === '0px' && floater.pos === 'absolute', '⭐ 從畫面下方浮出')
    // Vue 的 scoped CSS 會在 keyframe 名稱後面加雜湊，所以只比對開頭
    ok(floater.anim.startsWith('float-up'), `套用浮出動畫（${floater.anim}）`)

    // 表符本身不能洩漏是誰送的。
    // （大廳的參與者名單會列出名字，那是給主持人踢人用的功能，跟表符無關，
    //   所以這裡只檢查表符浮層本身。）
    const layer = await host2.$eval('.reaction-layer', (e) => ({
      html: e.innerHTML,
      text: e.innerText.trim(),
      onlyImages: [...e.children].every((c) => c.tagName === 'IMG'),
    }))
    ok(!layer.html.includes('表符測試員'), '⭐ 表符浮層不含發送者名稱')
    ok(layer.text === '', '⭐ 表符浮層沒有任何文字（純圖片，看不出是誰送的）')
    ok(layer.onlyImages, '浮層裡只有圖片元素')

    await host2.screenshot({ path: path.join(SHOTS, '13-表情符號.png') })

    // 幾秒後要自己淡出消失
    // （CSS 動畫在背景分頁會被暫停，animationend 不會觸發，所以要先切到前景）
    await host2.bringToFront()
    await host2.waitForFunction(() => !document.querySelector('.reaction-layer .floater'), { timeout: 10000, polling: 200 })
    ok(true, '⭐ 幾秒後自動淡出並從 DOM 移除（不會越積越多）')

    // 連按多顆，畫面要能同時容納
    for (const b of btns) {
      await phone2.bringToFront()
      await b.click()
      await sleep(800) // 避開伺服器節流
    }
    await host2.bringToFront()
    await host2.waitForFunction(() => document.querySelectorAll('.reaction-layer .floater').length >= 2, { timeout: 6000, polling: 150 })
    ok(true, '⭐ 連送多顆會同時浮在畫面上')

    await host2.close()
    await phone2.close()
    fs.unlinkSync(emo)
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ reactions: [] }),
    })
  }

  /* ---------- 沒有漸層 ---------- */
  step('專業扁平設計')
  {
    const grads = await host.evaluate(() => {
      const hits = []
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage
        if (bg && bg.includes('gradient')) hits.push(el.className?.toString?.().slice(0, 40) || el.tagName)
      }
      return hits
    })
    ok(grads.length === 0, grads.length ? `大螢幕還有漸層：${grads.slice(0, 3).join(', ')}` : '⭐ 大螢幕沒有任何漸層背景')

    const phoneGrads = await phone.evaluate(() => {
      const hits = []
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage
        if (bg && bg.includes('gradient')) hits.push(el.className?.toString?.().slice(0, 40) || el.tagName)
      }
      return hits
    })
    ok(phoneGrads.length === 0, phoneGrads.length ? `手機端還有漸層：${phoneGrads.slice(0, 3).join(', ')}` : '⭐ 手機端沒有任何漸層背景')
  }

  /* ---------- 自訂背景 + 自動最佳化 ---------- */
  step('自訂背景與自動最佳化')
  {
    const ed = watch(await browser.newPage(), 'editor-bg')
    await ed.setViewport({ width: 1440, height: 900 })
    await ed.goto(`${BASE}/editor?id=${newId}`, { waitUntil: 'networkidle2' })
    await ed.waitForSelector('.thumb', { timeout: 8000 })
    await openGlobalSettings(ed)

    const solidPng = (file, r, g, b) => {
      fs.writeFileSync(file, solidPngFile(64, 64, r, g, b))
      return file
    }

    /** 等自動分析跑完（滑桿數值不再變動就算完成） */
    const readTone = async () => {
      await ed.waitForSelector('.bg-preview', { timeout: 10000 })
      let last = null
      for (let i = 0; i < 40; i++) {
        const cur = await ed.evaluate(() => {
          const rows = [...document.querySelectorAll('.slider-row')]
          const get = (label) => rows.find((r) => r.querySelector('span').textContent === label)?.querySelector('b').textContent
          return { dim: parseInt(get('遮罩')), blur: parseInt(get('模糊')) }
        })
        if (last && cur.dim === last.dim && cur.blur === last.blur) return cur
        last = cur
        await sleep(150)
      }
      return last
    }

    // 先丟一張暗圖
    const darkPng = solidPng(path.join(SHOTS, '_dark.png'), 12, 12, 16)
    await (await ed.$('.gs-box .bg-input')).uploadFile(darkPng)
    const darkTone = await readTone()
    ok(true, `⭐ 背景圖上傳成功並顯示預覽（暗圖 → 遮罩 ${darkTone.dim}%）`)

    // 再換一張亮圖，遮罩應該要自動壓更重
    const brightPng = solidPng(path.join(SHOTS, '_bright.png'), 245, 245, 250)
    await (await ed.$('.gs-box .bg-input')).uploadFile(brightPng)
    await ed.waitForFunction(
      (prev) => {
        const rows = [...document.querySelectorAll('.slider-row')]
        const dim = parseInt(rows.find((r) => r.querySelector('span').textContent === '遮罩')?.querySelector('b').textContent)
        return dim !== prev
      },
      { timeout: 10000, polling: 150 },
      darkTone.dim
    )
    const brightTone = await readTone()
    ok(
      brightTone.dim > darkTone.dim,
      `⭐ 亮圖自動壓更暗：暗圖 ${darkTone.dim}% → 亮圖 ${brightTone.dim}%（不是套固定值）`
    )
    ok(brightTone.dim >= 35 && brightTone.dim <= 90, `遮罩落在合理範圍（${brightTone.dim}%）`)
    ok((await ed.$eval('.gs-box .bg-note', (e) => e.textContent)).includes('自動'), '顯示「已自動調整」的說明')

    // 預覽的遮罩要跟算出來的值一致
    const scrim = await ed.$eval('.bg-preview .bg-scrim', (e) => getComputedStyle(e).backgroundColor)
    const alpha = Number(/rgba?\([^)]*?([\d.]+)\)$/.exec(scrim)?.[1] ?? 1)
    ok(Math.abs(alpha * 100 - brightTone.dim) < 1.5, `⭐ 預覽遮罩濃度 ${scrim} 跟設定的 ${brightTone.dim}% 一致`)

    await ed.waitForFunction(() => document.querySelector('.save-state')?.textContent === '已儲存', { timeout: 8000, polling: 200 })
    const savedBg = await (await fetch(`${BASE}/api/presentations/${newId}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    ok(savedBg.background.image?.startsWith('/uploads/'), `⭐ 背景圖有存進伺服器：${savedBg.background.image}`)
    ok(savedBg.background.dim === brightTone.dim, '自動算出的遮罩值有存下來')

    fs.unlinkSync(darkPng)
    fs.unlinkSync(brightPng)
    await ed.close()
  }

  /* ---------- 一鍵匯入 ---------- */
  /* ---------- 題庫市集 ---------- */
  step('題庫市集（上架 → 逛 → 下載 → 後台）')
  {
    const gp = watch(await browser.newPage(), 'gallery')
    await gp.setViewport({ width: 1440, height: 940 })
    await gp.goto(BASE + '/gallery', { waitUntil: 'networkidle2' })
    await gp.waitForSelector('.page-head h1', { timeout: 8000 })
    ok((await gp.$eval('.page-head h1', (e) => e.textContent)) === '題庫市集', '市集頁打得開')
    ok(
      (await gp.$eval('.page-head p', (e) => e.textContent)).includes('本機'),
      '⭐ 有標示現在的來源（還沒接雲端就講清楚）'
    )

    // 上架
    await click(gp, '.appbar .btn-primary')
    await gp.waitForSelector('.sheet', { timeout: 5000 })
    await gp.type('.sheet .input', '麵包店老闆')
    // 一定要指名示範簡報：清單是照更新時間排的，前面的步驟做過別的簡報，
    // 抓「第一個」會抓到那些兩三題的測試用簡報，下面的斷言就沒意義了
    const picked = await gp.evaluate((title) => {
      const b = [...document.querySelectorAll('.pick:not(:disabled)')].find((x) => x.textContent.includes(title))
      b?.click()
      return !!b
    }, demo.title)
    ok(picked, `挑得到示範簡報「${demo.title}」來上架`)

    await gp.waitForSelector('.card', { timeout: 10000 })
    ok(true, '⭐ 上架成功（不再有管理碼那一關）')

    /*
     * 用搜尋把畫面縮到「我剛上架的那一張」再驗。
     * 市集上可能還有別的東西（e2e 那一輪跟 browser 這一輪共用同一台伺服器、
     * 同一個資料目錄），直接抓 .card .tag 會把別人卡片的標籤也算進來。
     */
    const only = async (kw) => {
      await gp.$eval(
        '.search input',
        (e, v) => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          set.call(e, v)
          e.dispatchEvent(new Event('input', { bubbles: true }))
        },
        kw
      )
      await sleep(500)
    }

    await only(demo.title)
    await gp.waitForSelector('.card', { timeout: 5000 })
    ok((await gp.$$('.card')).length === 1, '搜尋縮到剛上架的那一張')

    const tags = await gp.$$eval('.card .tag', (els) => els.map((e) => e.textContent))
    // 示範簡報 15 種題型各一，是標籤爆掉的最壞情況
    ok(tags.length <= 5, `⭐ 題型標籤不會爆版（${tags.length} 個：${tags.join('、')}）`)
    ok(tags.some((t) => /^\+\d+ 種$/.test(t)), '⭐ 多出來的用「+N 種」收掉')
    ok((await gp.$eval('.meta', (e) => e.textContent)).includes('麵包店老闆'), '卡片顯示製作者')
    await gp.screenshot({ path: path.join(SHOTS, '27-題庫市集.png') })

    await only('不可能存在的東西')
    ok(!!(await gp.$('.empty-box')), '⭐ 搜尋不到會講「找不到符合的題庫」')
    await only(demo.title)
    await gp.waitForSelector('.card', { timeout: 5000 })

    // 後台：隱藏 → 市集上就看不到 → 放回去
    // 一樣要指名，後台列表裡也可能有別的東西
    const adminRow = (label) =>
      gp.evaluate(
        (title, l) => {
          const row = [...document.querySelectorAll('.arow')].find((r) => r.textContent.includes(title))
          const btn = [...(row?.querySelectorAll('.btn') || [])].find((b) => b.textContent.trim() === l)
          btn?.click()
          return !!btn
        },
        demo.title,
        label
      )
    // waitForFunction 的 callback 是丟到瀏覽器裡跑的，不能包 gp.evaluate（那邊沒有 gp），
    // 要傳成純粹的瀏覽器端函式 + 參數
    /*
     * 一定要驗「量得到高度」，不能只看 class。
     *
     * 之前這裡寫的是 classList.contains('hidden')，結果 .hidden 撞到 main.css 全域的
     * .hidden{display:none!important} —— 被隱藏的題庫在後台整列消失、管理員再也找不回來，
     * 而測試因為 class 還在，一路綠燈。看得見與否要用 offsetHeight 量。
     */
    const waitRow = (want) =>
      gp.waitForFunction(
        (title, w) => {
          const r = [...document.querySelectorAll('.arow')].find((x) => x.textContent.includes(title))
          return !!r && r.offsetHeight > 0 && r.classList.contains('is-hidden') === w
        },
        { timeout: 5000, polling: 100 },
        demo.title,
        want
      )

    const openAdmin = async () => {
      await gp.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('市集後台')).click())
      await gp.waitForSelector('.admin-list .arow', { timeout: 6000 })
    }
    const closeAdmin = () =>
      gp.evaluate(() => [...document.querySelectorAll('.acts-end .btn')].find((b) => b.textContent.includes('關閉')).click())

    await openAdmin()
    ok(await adminRow('隱藏'), '後台找得到剛上架的那一筆')
    await waitRow(true)
    ok(true, '⭐ 後台隱藏得了，而且一眼看得出被隱藏')
    // 這是使用者回報的 bug：隱藏之後後台自己也看不到那一筆了
    const stillThere = await gp.evaluate(
      (t) => {
        const r = [...document.querySelectorAll('.arow')].find((x) => x.textContent.includes(t))
        return !!r && r.offsetHeight > 0
      },
      demo.title
    )
    ok(stillThere, '⭐ 隱藏之後，後台自己還是看得到它（不然就放不回去了）')
    await closeAdmin()
    await gp.reload({ waitUntil: 'networkidle2' })
    await only(demo.title)
    ok(!!(await gp.$('.empty-box')), '⭐ 隱藏後市集上就逛不到了')

    await openAdmin()
    await adminRow('放回去')
    await waitRow(false)
    await closeAdmin()
    await gp.reload({ waitUntil: 'networkidle2' })
    await only(demo.title)
    await gp.waitForSelector('.card', { timeout: 6000 })
    ok(true, '⭐ 誤報救得回來')

    // 下載 → 落地成本地簡報 → 直接進編輯器
    const before = (await (await fetch(`${BASE}/api/presentations`, { headers: { Authorization: 'Bearer ' + token } })).json()).length
    await click(gp, '.card .btn-primary')
    await gp.waitForFunction(() => location.pathname.startsWith('/editor'), { timeout: 20000 })
    await gp.waitForSelector('.thumb', { timeout: 10000 })
    const after = (await (await fetch(`${BASE}/api/presentations`, { headers: { Authorization: 'Bearer ' + token } })).json()).length
    ok(after === before + 1, `⭐ 下載後真的變成自己的簡報（${before} → ${after} 份）`)
    ok((await gp.$$('.thumb')).length === 16, `⭐ 16 題原封不動下載回來（${(await gp.$$('.thumb')).length} 題）`)
    await gp.screenshot({ path: path.join(SHOTS, '28-市集下載後.png') })

    // 收乾淨，不要影響後面的步驟
    const id = new URL(await gp.url()).searchParams.get('id')
    await fetch(`${BASE}/api/presentations/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
    await gp.close()
  }

  /* ---------- 複數答案（列出多個答案、公布逐人顯示） ---------- */
  step('複數答案（列出多個、公布逐人顯示、可滾動）')
  {
    const full = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    const listIdx = full.slides.findIndex((s) => s.type === 'list')
    ok(listIdx >= 0, `示範簡報有複數答案題（第 ${listIdx + 1} 頁）`)

    const hl = watch(await browser.newPage(), 'present-list')
    await hl.setViewport({ width: 1280, height: 800 })
    await hl.goto(`${BASE}/present?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await hl.waitForFunction(() => /^\d{6}$/.test(document.querySelector('.pill b')?.textContent || ''), { timeout: 10000, polling: 200 })
    const lcode = await hl.$eval('.pill b', (e) => e.textContent)

    const pl = watch(await browser.newPage(), 'play-list')
    await pl.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true })
    await pl.goto(`${BASE}/?c=${lcode}`, { waitUntil: 'networkidle2' })
    await pl.waitForSelector('.found', { timeout: 8000 })
    await pl.type('.name-input', '列表玩家')
    await click(pl, '.go')
    await pl.waitForSelector('.center h2', { timeout: 10000 })

    // 主持人直接跳到複數答案題
    await hl.bringToFront()
    await hl.evaluate((i) => document.querySelectorAll('.dot-s')[i].click(), listIdx)

    // 手機看到列表作答介面，送出兩個答案（一對一錯）
    await pl.bringToFront()
    await pl.waitForSelector('.list-goal', { timeout: 8000 })
    ok(!!(await pl.$('.list-goal')), '⭐ 手機出現複數答案的作答介面（不是一次作答就跳走）')
    await pl.type('.big-input', 'CLANNAD')
    await click(pl, '.submit')
    await pl.waitForFunction(() => document.querySelectorAll('.list-mine .list-chip').length === 1, { timeout: 5000, polling: 100 })
    await pl.type('.big-input', '亂寫的答案')
    await click(pl, '.submit')
    await pl.waitForFunction(() => document.querySelectorAll('.list-mine .list-chip').length === 2, { timeout: 5000, polling: 100 })
    ok((await pl.$$('.list-mine .list-chip')).length === 2, '⭐ 送出的答案累積成清單（可以一直加）')
    ok(!(await pl.$('.list-mine .list-chip.ok')) && !(await pl.$('.list-mine .list-chip.no')), '⭐ 作答期間不透露哪個對')

    // 主持人公布答案
    await hl.bringToFront()
    await click(hl, '.ctrl-main')
    await hl.waitForSelector('.people-scroll', { timeout: 6000 })
    ok(!!(await hl.$('.people-scroll')), '⭐ 大螢幕公布時逐人列出每個人的回答')
    const overflowY = await hl.$eval('.people-scroll .ps-list', (e) => getComputedStyle(e).overflowY)
    ok(overflowY === 'auto' || overflowY === 'scroll', `⭐ 逐人清單可以滾動（overflow-y: ${overflowY}）`)
    ok((await hl.$$('.people-scroll .ps-row')).length >= 1, '逐人清單至少列出這位玩家')

    // 手機端：自己的答案被標對錯，並看到完整答案
    await pl.bringToFront()
    await pl.waitForSelector('.list-result', { timeout: 6000 })
    ok(!!(await pl.$('.list-result .list-chip.ok')), '⭐ 手機標出答對的（CLANNAD）')
    ok(!!(await pl.$('.list-result .list-chip.no')), '⭐ 手機標出答錯的（亂寫的答案）')
    ok((await pl.$$('.list-answers .list-chip')).length === 6, '⭐ 公布時列出完整答案（6 組）')
    await hl.screenshot({ path: path.join(SHOTS, '29-複數答案.png') })

    await hl.close()
    await pl.close()
  }

  /* ---------- 投影片拖曳排序 ---------- */
  step('編輯器：拖曳排投影片順序')
  {
    const ed = watch(await browser.newPage(), 'editor-drag')
    await ed.setViewport({ width: 1440, height: 900 })
    await ed.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ed.waitForSelector('.thumb', { timeout: 8000 })

    ok((await ed.$$('.thumb[draggable="true"]')).length > 0, '⭐ 投影片可以拖')
    const ups = await ed.$$eval('.thumb .tools button', (els) => els.map((e) => e.title))
    ok(!ups.includes('上移') && !ups.includes('下移'), `⭐ 上下箭頭拿掉了（剩：${[...new Set(ups)].join('、')}）`)

    const titles = () => ed.$$eval('.thumb .tt', (els) => els.map((e) => e.textContent.trim()))
    const before = await titles()

    /*
     * HTML5 拖放沒辦法用 mouse.move 模擬（瀏覽器不會發 drag 事件），
     * 所以直接派發 dragstart/dragover/drop —— 驗的是元件的處理邏輯對不對。
     */
    await ed.evaluate(() => {
      const rows = document.querySelectorAll('.thumb')
      const dt = new DataTransfer()
      rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      rows[3].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rows[3].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    })
    await sleep(400)
    const after = await titles()
    ok(after[3] === before[0], `⭐ 第 1 張拖到第 4 個位置（「${before[0]}」→ 第 ${after.indexOf(before[0]) + 1} 位）`)
    ok(after[0] === before[1], '其他張依序遞補上來')
    ok(after.length === before.length, '沒有弄丟或複製投影片')

    // 拖完之後選中的還是同一張（不是同一個位置）
    const curTitle = await ed.$eval('.thumb.on .tt', (e) => e.textContent.trim())
    ok(curTitle === before[0], `⭐ 拖完仍然選中被拖的那一張（${curTitle}）`)

    // 存檔後順序要真的變了
    await ed.waitForFunction(() => document.querySelector('.save-state')?.textContent.includes('已儲存'), { timeout: 8000, polling: 200 })
    const saved = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    ok(saved.slides[3].title.trim() === before[0], '⭐ 新順序有存回伺服器')

    // 拖回去，不要影響後面的步驟
    await ed.evaluate(() => {
      const rows = document.querySelectorAll('.thumb')
      const dt = new DataTransfer()
      rows[3].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await sleep(400)
    ok(JSON.stringify(await titles()) === JSON.stringify(before), '拖回原位，順序完全還原')
    await ed.waitForFunction(() => document.querySelector('.save-state')?.textContent.includes('已儲存'), { timeout: 8000, polling: 200 })
    await ed.close()
  }

  /* ---------- 整份簡報設定 ---------- */
  step('編輯器：拖曳排選項順序（正解跟著內容走）')
  {
    const eo = watch(await browser.newPage(), 'editor-opt-drag')
    await eo.setViewport({ width: 1440, height: 900 })

    const rq = (p, opts = {}) =>
      fetch(BASE + '/api' + p, {
        ...opts,
        headers: { Authorization: 'Bearer ' + token, ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      })

    // 做一份乾淨的：第一個選項是正解，而且每個選項都有自己的圖，才驗得出「整包搬走」
    const madeO = await (await rq('/presentations', { method: 'POST', body: JSON.stringify({ title: '選項拖曳測試' }) })).json()
    const put = async (buf, name) => {
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: 'image/png' }), name)
      return (await (await rq('/upload', { method: 'POST', body: fd })).json()).url
    }
    const [ia, ib] = await Promise.all([
      put(solidPngFile(20, 20, 250, 10, 10), 'oa.png'),
      put(solidPngFile(20, 20, 10, 250, 10), 'ob.png'),
    ])
    await rq(`/presentations/${madeO.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        slides: [
          {
            id: 'so1',
            type: 'single',
            title: '正解在第一個',
            options: [
              { id: 'oa', text: '甲（正解）', correct: true, image: ia },
              { id: 'ob', text: '乙', correct: false, image: ib },
              { id: 'oc', text: '丙', correct: false, image: null },
              { id: 'od', text: '丁', correct: false, image: null },
            ],
          },
        ],
      }),
    })

    await eo.goto(`${BASE}/editor?id=${madeO.id}`, { waitUntil: 'networkidle2' })
    await eo.waitForSelector('.opt-row', { timeout: 8000 })

    ok((await eo.$$('.opt-row .opt-grip[draggable="true"]')).length === 4, '⭐ 每個選項都有拖曳握把')

    const snap = () =>
      eo.$$eval('.opt-row', (els) =>
        els.map((e) => ({
          text: e.querySelector('input').value,
          correct: e.classList.contains('is-correct'),
          img: e.querySelector('.chip-btn img')?.getAttribute('src') || null,
        }))
      )
    const before = await snap()
    ok(before[0].text === '甲（正解）' && before[0].correct, '一開始正解是第一個')

    // 把第一個（正解）拖到第二個
    await eo.evaluate(() => {
      const rows = document.querySelectorAll('.opt-row')
      const dt = new DataTransfer()
      rows[0].querySelector('.opt-grip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      rows[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rows[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await sleep(300)

    const after = await snap()
    ok(after[0].text === '乙' && after[1].text === '甲（正解）', `⭐ 內容換到第二個了（${after.map((o) => o.text).join('、')}）`)
    ok(!after[0].correct && after[1].correct, '⭐ 正解跟著內容走：現在標在第二個')
    ok(after.filter((o) => o.correct).length === 1, '正解仍然只有一個（沒有變成兩個）')
    ok(after[1].img === before[0].img && after[0].img === before[1].img, '⭐ 圖片也跟著同一個選項走，沒有錯位')
    ok(
      after.map((o) => o.text).sort().join() === before.map((o) => o.text).sort().join(),
      '只是換位置，選項內容一個都沒少'
    )

    // 存回伺服器的也要是同一件事（不是只有畫面上看起來對）
    await eo.waitForFunction(() => document.querySelector('.save-state')?.textContent.includes('已儲存'), { timeout: 8000, polling: 200 })
    const savedO = await (await rq(`/presentations/${madeO.id}`)).json()
    const opts = savedO.slides[0].options
    ok(opts[1].text === '甲（正解）' && opts[1].correct === true, '⭐ 存進伺服器的順序與正解也對')
    ok(opts[0].correct === false, '原本的第一個已經不是正解了')
    ok(opts[1].id === 'oa', '⭐ 搬的是整個選項物件（id 跟著走），不是把文字抄來抄去')

    await rq(`/presentations/${madeO.id}`, { method: 'DELETE' })
    await eo.close()
  }

  step('編輯器：上下鍵切換投影片')
  {
    const ek = watch(await browser.newPage(), 'editor-keys')
    await ek.setViewport({ width: 1440, height: 900 })
    await ek.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await ek.waitForSelector('.thumb.on', { timeout: 8000 })

    const curIdx = () => ek.$$eval('.thumb', (els) => els.findIndex((e) => e.classList.contains('on')))
    ok((await curIdx()) === 0, '一開始停在第一張')

    await ek.keyboard.press('ArrowDown')
    await sleep(200)
    ok((await curIdx()) === 1, '⭐ 下鍵切到下一張')
    await ek.keyboard.press('ArrowDown')
    await sleep(200)
    ok((await curIdx()) === 2, '⭐ 再按一次再往下一張')
    await ek.keyboard.press('ArrowUp')
    await sleep(200)
    ok((await curIdx()) === 1, '⭐ 上鍵切回上一張')

    // 第一張再往上、最後一張再往下都不能爆掉
    await ek.keyboard.press('ArrowUp')
    await sleep(150)
    await ek.keyboard.press('ArrowUp')
    await sleep(150)
    ok((await curIdx()) === 0, '⭐ 到第一張就停住，不會跑到負的')

    // 正在打字的時候，上下鍵是移動游標，不能拿去切投影片
    const at = await curIdx()
    await ek.click('.title-edit')
    await ek.keyboard.press('ArrowDown')
    await sleep(200)
    ok((await curIdx()) === at, '⭐ 在輸入框打字時上下鍵不會切走（不然打到一半整頁被換掉）')

    // 彈窗開著時也不該偷偷換掉後面的投影片
    await ek.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('整份簡報')).click())
    await ek.waitForSelector('.gs-box', { timeout: 5000 })
    await ek.keyboard.press('ArrowDown')
    await sleep(200)
    ok((await curIdx()) === at, '⭐ 設定彈窗開著時上下鍵不會切投影片')
    await ek.keyboard.press('Escape')
    await sleep(200)

    await ek.close()
  }

  step('整份簡報設定（統一套用會覆蓋個別題目）')
  {
    const gs = watch(await browser.newPage(), 'global-settings')
    await gs.setViewport({ width: 1440, height: 900 })

    // 先幫兩題設「自己的」速度加分，等一下才驗得到覆蓋
    const fullG = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    fullG.slides.find((s) => s.type === 'single').speedBonus = 'off'
    fullG.slides.find((s) => s.type === 'multi').speedBonus = 'on'
    await fetch(`${BASE}/api/presentations/${demo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ slides: fullG.slides }),
    })

    await gs.goto(`${BASE}/editor?id=${demo.id}`, { waitUntil: 'networkidle2' })
    await gs.waitForSelector('.thumb', { timeout: 8000 })

    // 側欄只該剩下「這一頁」—— 整份簡報的設定跟你正在編的那一題無關，
    // 每點一張投影片都要再看一次是純粹的干擾
    const sideHeads = await gs.$$eval('.side h3', (els) => els.map((e) => e.textContent.trim()))
    ok(sideHeads.length === 1 && sideHeads[0] === '這一頁', `⭐ 側欄只剩「這一頁」（${sideHeads.join('、')}）`)

    // 第一頁是內容頁（本來就沒有作答時間），要點到真的題目才看得到個別設定
    const singleIdx = fullG.slides.findIndex((sl) => sl.type === 'single')
    await (await gs.$$('.thumb'))[singleIdx].click()
    await sleep(300)
    const perSlide = await gs.$$eval('.side .label', (els) => els.map((e) => e.textContent.trim()))
    ok(
      perSlide.includes('作答時間') && perSlide.includes('這一題要不要速度加分'),
      `⭐ 個別題目還是能自己設（時間／分數／速度加分）（${perSlide.join('、')}）`
    )

    await gs.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('整份簡報')).click())
    await gs.waitForSelector('.gs-box', { timeout: 5000 })
    const gsHeads = await gs.$$eval('.gs-body h3', (els) => els.map((e) => e.textContent.trim()))
    ok(gsHeads.includes('外觀') && gsHeads.includes('統一套用到所有題目'), `⭐ 整份簡報的設定都在彈窗裡（${gsHeads.join('、')}）`)
    ok(gsHeads.filter((h) => h === '速度加分').length === 1, '速度加分只出現一次（不要兩個開關）')
    await gs.screenshot({ path: path.join(SHOTS, '30-整份簡報設定.png') })

    const speedOf = async (type) => {
      const p = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
      return p.slides.find((s) => s.type === type).speedBonus
    }

    // 取消要真的什麼都不做 —— 這是「無法復原」的操作，按錯了不能全毀
    await gs.evaluate(() => [...document.querySelectorAll('.gs-body .btn')].find((b) => b.textContent.includes('跟隨預設')).click())
    await gs.waitForSelector('.mask .box', { timeout: 5000 })
    const warn = await gs.$eval('.mask .box', (e) => e.textContent)
    ok(/2 題/.test(warn), `⭐ 覆蓋前先講清楚會動到幾題（${warn.match(/把 \d+ 題[^？]*？/)?.[0]}）`)
    await gs.evaluate(() => [...document.querySelectorAll('.mask .box .btn')].find((b) => b.textContent.trim() === '取消').click())
    await sleep(900)
    ok((await speedOf('single')) === 'off' && (await speedOf('multi')) === 'on', '⭐ 按取消就真的什麼都沒改')

    // 確定之後才覆蓋
    await gs.evaluate(() => [...document.querySelectorAll('.gs-body .btn')].find((b) => b.textContent.includes('跟隨預設')).click())
    await gs.waitForSelector('.mask .box .btn-danger', { timeout: 5000 })
    await gs.evaluate(() => document.querySelector('.mask .box .btn-danger').click())
    await sleep(1200)
    ok((await speedOf('single')) === 'inherit' && (await speedOf('multi')) === 'inherit', '⭐ 確定之後個別設定被統一成「跟隨預設」')

    // 統一作答時間，但不能動到內容頁那種本來就沒有時間的
    await gs.evaluate(() => {
      const sel = document.querySelector('.gs-body .select')
      sel.value = '45'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(200)
    await gs.evaluate(() => document.querySelector('.gs-body .gs-row .btn').click())
    await gs.waitForSelector('.mask .box .btn-danger', { timeout: 5000 })
    await gs.evaluate(() => document.querySelector('.mask .box .btn-danger').click())
    await sleep(1200)
    const after = await (await fetch(`${BASE}/api/presentations/${demo.id}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    ok(
      after.slides.filter((s) => !['content', 'qa'].includes(s.type)).every((s) => s.timeLimit === 45),
      '⭐ 作答時間統一成 45 秒'
    )
    ok(
      after.slides.filter((s) => ['content', 'qa'].includes(s.type)).every((s) => s.timeLimit === 0),
      '⭐ 內容頁／提問頁本來就沒有時間，不會被亂套'
    )

    // 沒東西會變的時候不要多問一次
    await gs.evaluate(() => document.querySelector('.gs-body .gs-row .btn')?.click())
    await sleep(700)
    ok(!(await gs.$('.mask .box')), '⭐ 全部都已經是那個值了，就不用再問')
    await gs.close()
  }

  /* ---------- 全站說明 ---------- */
  step('說明（一顆按鈕講完全部）')
  {
    const hp = watch(await browser.newPage(), 'help')
    await hp.setViewport({ width: 1440, height: 900 })
    await hp.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
    await hp.waitForSelector('.pcard, .empty-box', { timeout: 8000 })

    await hp.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('說明')).click())
    await hp.waitForSelector('.help-box', { timeout: 5000 })
    ok(true, '⭐ 後台的說明打得開')

    const tabs = await hp.$$eval('.help-tabs button', (els) => els.map((e) => e.textContent.trim()))
    ok(tabs.length === 5, `⭐ 涵蓋全部功能，不只市集（${tabs.join('、')}）`)

    // 每一頁籤都要有內容
    for (let i = 0; i < tabs.length; i++) {
      await hp.evaluate((n) => document.querySelectorAll('.help-tabs button')[n].click(), i)
      await sleep(120)
      const len = (await hp.$eval('.help-body', (e) => e.innerText)).trim().length
      ok(len > 120, `「${tabs[i]}」有實際內容（${len} 字）`)
    }
    await hp.screenshot({ path: path.join(SHOTS, '29-說明.png') })

    await hp.keyboard.press('Escape')
    await sleep(250)
    ok(!(await hp.$('.help-box')), '⭐ Esc 關得掉')

    // 編輯器與市集也要有同一顆
    for (const [p, label] of [['/editor?id=' + demo.id, '編輯器'], ['/gallery', '市集']]) {
      await hp.goto(BASE + p, { waitUntil: 'networkidle2' })
      await sleep(500)
      const has = await hp.evaluate(() => !![...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('說明')))
      ok(has, `${label}也有說明按鈕`)
    }
    await hp.close()
  }

  step('一鍵匯入題目')
  {
    const ad = watch(await browser.newPage(), 'import')
    await ad.setViewport({ width: 1440, height: 900 })
    // 讓「複製出題指南」按鈕能寫入剪貼簿
    await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write'])
    await ad.goto(BASE + '/admin', { waitUntil: 'networkidle2' })
    await ad.waitForSelector('.pcard', { timeout: 8000 })
    // 用文字找，不要用「第一顆」—— appbar 之後又多了「題庫市集」，位置會跑掉
    await ad.bringToFront()
    await ad.evaluate(() => [...document.querySelectorAll('.appbar .btn')].find((b) => b.textContent.includes('匯入'))?.click())
    await ad.waitForSelector('.import-box', { timeout: 4000 })
    ok(true, '⭐ 匯入對話框打開')

    // 一鍵複製 AI 出題指南 —— 把整份指南塞進剪貼簿，使用者不用自己去翻檔案
    ok(!!(await ad.$('.ai-hint button')), '⭐ 匯入視窗裡有「複製出題指南」按鈕')
    await click(ad, '.ai-hint button')
    await ad.waitForFunction(() => document.querySelector('.ai-hint button')?.textContent.includes('已複製'), { timeout: 4000, polling: 100 })
    const clip = await ad.evaluate(() => navigator.clipboard.readText())
    ok(clip.includes('只輸出一個 JSON 物件') && clip.includes('題型一覽'), `⭐ 剪貼簿拿到的是完整出題指南（${clip.length} 字）`)
    ok(clip.includes('explain') && clip.includes('素材：怎麼指到圖片與音樂'), '⭐ 指南含解說與素材對應的說明')

    // 匯入視窗也要順帶說明「怎麼匯出搬到別台」
    ok((await ad.$eval('.modal-foot', (e) => e.textContent)).includes('匯出'), '⭐ 視窗裡有匯出／搬移的說明')
    await ad.screenshot({ path: path.join(SHOTS, '24-匯入對話框.png') })

    // 壞的 JSON 要即時擋下並說明原因
    await ad.type('.import-box', '{ not json')
    await ad.waitForSelector('.check.bad', { timeout: 3000 })
    ok((await ad.$eval('.check.bad', (e) => e.textContent)).includes('JSON'), '⭐ 貼錯格式會即時顯示錯誤')
    ok(await ad.$eval('.modal-acts .btn-primary', (e) => e.disabled), '格式錯誤時匯入鈕是停用的')

    // 題型不存在也要擋
    await ad.$eval('.import-box', (e) => (e.value = ''))
    await ad.type('.import-box', JSON.stringify({ title: 'x', slides: [{ type: 'nope', title: 'a' }] }))
    await ad.waitForFunction(() => document.querySelector('.check.bad')?.textContent.includes('type'), { timeout: 3000, polling: 100 })
    ok(true, '⭐ 題型不正確會被指出來')

    // 正確的 JSON 要顯示摘要
    const good = {
      title: '匯入測試題庫',
      slides: [
        { type: 'content', title: '開場', body: 'hi', timeLimit: 0, points: 'none' },
        { type: 'single', title: '1+1=?', timeLimit: 20, points: 'standard', options: [{ text: '2', correct: true }, { text: '3' }] },
        { type: 'number', title: '猜數字', timeLimit: 20, points: 'standard', answer: 42, tolerance: 5 },
      ],
    }
    await ad.$eval('.import-box', (e) => (e.value = ''))
    await ad.type('.import-box', JSON.stringify(good))
    await ad.waitForSelector('.check.ok', { timeout: 3000 })
    const summary = await ad.$eval('.check.ok', (e) => e.textContent)
    ok(summary.includes('3 題') && summary.includes('數字題'), `⭐ 匯入前先看到摘要：${summary.trim()}`)

    await click(ad, '.modal-acts .btn-primary')
    await ad.waitForFunction(() => location.pathname === '/editor', { timeout: 8000, polling: 200 })
    const importedId = new URL(ad.url()).searchParams.get('id')
    const imported = await (await fetch(`${BASE}/api/presentations/${importedId}`, { headers: { Authorization: 'Bearer ' + token } })).json()
    ok(imported.slides.length === 3 && imported.slides[2].answer === 42, '⭐ 匯入後題目內容正確，直接進入編輯器')
    await fetch(`${BASE}/api/presentations/${importedId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
    await ad.close()
  }

  /* ---------- 收尾 ---------- */
  step('清理與前端錯誤檢查')
  await fetch(`${BASE}/api/presentations/${newId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
  fs.unlinkSync(png)
  ok(errors.length === 0, errors.length ? `發現 ${errors.length} 個前端錯誤` : '全程沒有任何 console 錯誤')
  for (const e of errors) console.log('     ' + e)

  await browser.close()
  console.log('\n截圖輸出於：' + SHOTS)
}

main()
  .then(() => {
    console.log(`\n${'─'.repeat(52)}`)
    if (fail === 0) console.log(`\x1b[32m\x1b[1m ✓ 全部通過：${pass} 項檢查\x1b[0m\n`)
    else console.log(`\x1b[31m\x1b[1m ✗ ${fail} 項失敗 / ${pass + fail} 項\x1b[0m\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n\x1b[31m測試中斷：' + err.message + '\x1b[0m')
    process.exit(1)
  })
