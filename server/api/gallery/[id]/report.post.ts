import { gallery } from '../../../utils/gallery'

export default defineEventHandler(async (event) => {
  const { reason } = (await readBody(event)) || {}
  await gallery().report(getRouterParam(event, 'id')!, String(reason || ''))
  // 檢舉一律回 ok，不告訴對方這份存不存在、也不透露累積幾次
  return { ok: true }
})
