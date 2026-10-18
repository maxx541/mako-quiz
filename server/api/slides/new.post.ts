import { requireAuth } from '../../utils/auth'
import { createSlide, isSlideType } from '../../utils/quiz'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const type = String((await readBody(event))?.type || 'single')
  if (!isSlideType(type)) throw createError({ statusCode: 400, data: { error: '不支援的題型' } })
  return createSlide(type)
})
