import { listSounds } from '../utils/store'

/**
 * 主持人控制列有哪些按鈕音效可以用。
 *
 * 回傳「實際存在的檔案」而不是固定清單：沒放的就不會出現在這裡，
 * 前端也就不會去要一個不存在的檔案（那會在 console 印一排 404）。
 */
export default defineEventHandler(() => {
  const found = listSounds()
  const sounds: Record<string, string> = {}
  for (const [action, file] of Object.entries(found)) sounds[action] = `/sounds/${file}`
  return { sounds }
})
