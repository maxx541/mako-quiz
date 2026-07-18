import { requireAuth } from '../../../utils/auth'
import { findSession } from '../../../utils/session'

export default defineEventHandler((event) => {
  requireAuth(event)
  const s = findSession(getRouterParam(event, 'code'))
  if (!s) throw createError({ statusCode: 404, data: { error: '找不到場次' } })
  return s.report()
})
