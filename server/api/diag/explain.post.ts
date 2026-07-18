import { requireAuth } from '../../utils/auth'
import { explainSupabase } from '../../utils/supabase'

/**
 * 只給測試用：把 Supabase 的原始錯誤丟進來，看會翻成什麼句子。
 *
 * 「容量不足」那條沒辦法用真的 Supabase 觸發（要把免費版的 1 GB 塞滿），
 * 所以只能拿它真實回傳的格式在這裡驗。要主持人身分，不會外流任何東西。
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const { status, body } = (await readBody(event)) || {}
  return { message: explainSupabase(Number(status) || 400, String(body ?? '')) }
})
