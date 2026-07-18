import { requireAuth } from '../../utils/auth'
import { updatePresentation } from '../../utils/store'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const { title, description, theme, background, cover, lobbyMusic, quizMusic, quizMusicVolume, reactions, settings, slides } =
    (await readBody(event)) || {}
  const patch: any = {}
  if (title !== undefined) patch.title = String(title).slice(0, 120)
  if (description !== undefined) patch.description = String(description).slice(0, 500)
  if (theme !== undefined) patch.theme = theme
  if (cover !== undefined) patch.cover = cover ? String(cover).slice(0, 300) : null
  if (lobbyMusic !== undefined) patch.lobbyMusic = lobbyMusic ? String(lobbyMusic).slice(0, 300) : null
  if (quizMusic !== undefined) patch.quizMusic = quizMusic ? String(quizMusic).slice(0, 300) : null
  if (quizMusicVolume !== undefined) {
    const v = Number(quizMusicVolume)
    patch.quizMusicVolume = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 35
  }
  if (reactions !== undefined) {
    if (!Array.isArray(reactions)) throw createError({ statusCode: 400, data: { error: 'reactions 必須是陣列' } })
    patch.reactions = reactions.slice(0, 12).map((r: any) => ({
      id: String(r?.id || '').slice(0, 40),
      url: String(r?.url || '').slice(0, 300),
      label: String(r?.label || '').slice(0, 20),
    }))
  }
  if (background !== undefined) {
    patch.background = {
      image: background?.image ?? null,
      dim: Math.min(90, Math.max(0, Number(background?.dim) || 0)),
      blur: Math.min(20, Math.max(0, Number(background?.blur) || 0)),
      auto: background?.auto !== false,
    }
  }
  if (settings !== undefined) patch.settings = settings
  if (slides !== undefined) {
    if (!Array.isArray(slides)) throw createError({ statusCode: 400, data: { error: 'slides 必須是陣列' } })
    patch.slides = slides
  }
  const p = updatePresentation(getRouterParam(event, 'id')!, patch)
  if (!p) throw createError({ statusCode: 404, data: { error: '找不到簡報' } })
  return { ok: true, updatedAt: p.updatedAt }
})
