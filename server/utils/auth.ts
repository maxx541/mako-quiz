import crypto from 'node:crypto'
import type { H3Event } from 'h3'

const tokens = new Map<string, number>()
const TOKEN_TTL = 1000 * 60 * 60 * 12

export function issueToken() {
  const t = crypto.randomBytes(24).toString('hex')
  tokens.set(t, Date.now() + TOKEN_TTL)
  return t
}

export function validToken(t: any) {
  const exp = tokens.get(String(t || ''))
  if (!exp) return false
  if (exp < Date.now()) {
    tokens.delete(t)
    return false
  }
  return true
}

export function bearer(event: H3Event) {
  return String(getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
}

/** 沒登入就直接丟 401 */
export function requireAuth(event: H3Event) {
  if (!validToken(bearer(event))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { error: '請先登入' } })
  }
}
