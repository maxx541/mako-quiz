import { issueToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { password } = await readBody(event) || {}
  if (String(password || '') !== useRuntimeConfig().hostPassword) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { error: '密碼錯誤' } })
  }
  return { token: issueToken() }
})
