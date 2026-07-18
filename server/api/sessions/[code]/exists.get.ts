import { findSession } from '../../../utils/session'

export default defineEventHandler((event) => {
  const s = findSession(getRouterParam(event, 'code'))
  if (!s) throw createError({ statusCode: 404, data: { error: '找不到這個房間代碼' } })
  if (s.state === 'ended') throw createError({ statusCode: 410, data: { error: '這場活動已經結束了' } })
  return { ok: true, title: s.presentation.title, state: s.state, players: s.players.size }
})
