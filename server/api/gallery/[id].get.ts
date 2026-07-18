import { gallery } from '../../utils/gallery'

export default defineEventHandler(async (event) => {
  const item = await gallery().get(getRouterParam(event, 'id')!)
  if (!item) throw createError({ statusCode: 404, data: { error: '找不到這份題庫' } })
  return item
})
