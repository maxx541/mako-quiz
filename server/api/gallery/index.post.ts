import { requireAuth } from '../../utils/auth'
import { BundleError, MAX_BUNDLE, gallery } from '../../utils/gallery'

/**
 * 把自己的簡報發布到市集。
 *
 * 要主持人身分 —— 發布是「以這台機器的擁有者的名義」把東西放到公開的地方，
 * 不該讓任何連得到這個網址的人（例如活動中的參與者）都能做。
 *
 * 收的就是現有匯出功能產生的那個 zip：client 已經有整套打包邏輯而且測過了，
 * 這裡不重做一次，只負責驗和存。
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)

  const parts = await readMultipartFormData(event)
  const field = (n: string) => parts?.find((p) => p.name === n && !p.filename)?.data?.toString('utf8') || ''
  const file = parts?.find((p) => p.name === 'bundle' && p.filename)

  if (!file?.data?.length) throw createError({ statusCode: 400, data: { error: '沒有收到 bundle' } })
  if (file.data.length > MAX_BUNDLE) {
    throw createError({ statusCode: 413, data: { error: `檔案不能超過 ${MAX_BUNDLE / 1024 / 1024} MB` } })
  }

  try {
    const { item } = await gallery().publish({
      bundle: new Uint8Array(file.data),
      author: field('author'),
      description: field('description'),
    })
    setResponseStatus(event, 201)
    return { item }
  } catch (err: any) {
    if (err instanceof BundleError) throw createError({ statusCode: 400, data: { error: err.message } })
    throw err
  }
})
