import { requireAuth } from '../../utils/auth'
import { listPresentations } from '../../utils/store'

export default defineEventHandler((event) => {
  requireAuth(event)
  return listPresentations()
})
