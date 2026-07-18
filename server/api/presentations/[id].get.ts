import { requireAuth } from '../../utils/auth'
import { getPresentation } from '../../utils/store'

export default defineEventHandler((event) => {
  requireAuth(event)
  const p = getPresentation(getRouterParam(event, 'id')!)
  if (!p) throw createError({ statusCode: 404, data: { error: '找不到簡報' } })
  return p
})
