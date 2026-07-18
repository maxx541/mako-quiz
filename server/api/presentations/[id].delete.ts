import { requireAuth } from '../../utils/auth'
import { deletePresentation } from '../../utils/store'

export default defineEventHandler((event) => {
  requireAuth(event)
  return { ok: deletePresentation(getRouterParam(event, 'id')!) }
})
