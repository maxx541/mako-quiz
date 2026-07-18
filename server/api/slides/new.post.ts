import { requireAuth } from '../../utils/auth'
import { SLIDE_TYPES, createSlide } from '../../utils/quiz'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const type = (await readBody(event))?.type || 'single'
  if (!SLIDE_TYPES[type]) throw createError({ statusCode: 400, data: { error: '不支援的題型' } })
  return createSlide(type)
})
