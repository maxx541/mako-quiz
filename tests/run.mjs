/**
 * 測試用的啟動器：在一個「拋棄式的資料目錄」裡開伺服器，跑完測試再收掉。
 *
 * 為什麼要這樣：測試會改動示範簡報的表符、背景與題目設定，
 * 如果直接跑在 data/ 上，就會動到使用者真正的簡報。
 *
 * 用法：
 *   node tests/run.mjs e2e
 *   node tests/run.mjs browser
 *   node tests/run.mjs all
 *   BROWSER=edge node tests/run.mjs browser
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || '3123'
const BASE = `http://localhost:${PORT}`
const which = process.argv[2] || 'all'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makoquiz-test-'))
const entry = path.join(ROOT, '.output', 'server', 'index.mjs')
if (!fs.existsSync(entry)) {
  console.error('找不到 .output —— 請先執行 npm run build')
  process.exit(1)
}

console.log(`測試資料目錄：${dataDir}（跑完會刪掉，不會碰到 data/）\n`)

const server = spawn(process.execPath, [entry], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT,
    MAKOQUIZ_DATA_DIR: dataDir,
    NITRO_PORT: PORT,
    /*
     * 測試一律用本機市集，絕對不能連到真的雲端。
     * 市集那節會上架、隱藏、刪除東西 —— 萬一在有設 Supabase 金鑰的環境跑，
     * 那些操作就會直接打在真的題庫市集上。這裡強制清空，跟 MAKOQUIZ_DATA_DIR
     * 保護 data/ 是同一個道理。
     */
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SECRET_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(String(d)))
server.stderr.on('data', (d) => serverLog.push(String(d)))

const cleanup = () => {
  server.kill()
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

/** 等伺服器真的起來，不要盲目 sleep */
async function waitUp(timeoutMs = 40000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const r = await fetch(BASE + '/api/slide-types')
      if (r.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  console.error('伺服器起不來：\n' + serverLog.join(''))
  return false
}

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tests', file)], {
      cwd: ROOT,
      // 測試檔也要知道資料目錄：按鈕音效那節要把檔案丟進 sounds/ 驗「放進去就讀得到」
      env: { ...process.env, BASE, MAKOQUIZ_DATA_DIR: dataDir },
      stdio: 'inherit',
    })
    p.on('exit', (code) => resolve(code ?? 1))
  })
}

if (!(await waitUp())) {
  cleanup()
  process.exit(1)
}

let failed = 0
if (which === 'e2e' || which === 'all') failed += (await run('e2e.mjs')) ? 1 : 0
if (which === 'browser' || which === 'all') failed += (await run('browser.mjs')) ? 1 : 0

cleanup()
process.exit(failed ? 1 : 0)
