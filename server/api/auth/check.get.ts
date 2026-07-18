import { bearer, validToken } from '../../utils/auth'

export default defineEventHandler((event) => ({ ok: validToken(bearer(event)) }))
