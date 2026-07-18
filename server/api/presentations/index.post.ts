import { requireAuth } from '../../utils/auth'
import { createPresentation } from '../../utils/store'
import { createSlide } from '../../utils/quiz'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = (await readBody(event)) || {}
  const p = createPresentation({
    title: String(body.title || '未命名簡報').slice(0, 120),
    slides: [createSlide('content'), createSlide('single')],
  })
  setResponseStatus(event, 201)
  return p
})
