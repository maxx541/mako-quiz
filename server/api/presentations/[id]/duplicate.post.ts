import { requireAuth } from '../../../utils/auth'
import { duplicatePresentation } from '../../../utils/store'

export default defineEventHandler((event) => {
  requireAuth(event)
  const p = duplicatePresentation(getRouterParam(event, 'id')!)
  if (!p) throw createError({ statusCode: 404, data: { error: '找不到簡報' } })
  setResponseStatus(event, 201)
  return p
})
