import { requireAuth } from '../utils/auth'
import { importPresentation } from '../utils/store'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  try {
    const p = importPresentation(await readBody(event))
    setResponseStatus(event, 201)
    return p
  } catch (err: any) {
    throw createError({ statusCode: 400, data: { error: err.message } })
  }
})
