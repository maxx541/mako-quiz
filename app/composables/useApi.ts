export const auth = {
  get token() {
    return import.meta.client ? localStorage.getItem('ql_token') || '' : ''
  },
  set token(v: string) {
    if (!import.meta.client) return
    v ? localStorage.setItem('ql_token', v) : localStorage.removeItem('ql_token')
  },
  clear() {
    if (import.meta.client) localStorage.removeItem('ql_token')
  },
  gotoLogin() {
    if (import.meta.client) location.href = '/admin?next=' + encodeURIComponent(location.pathname + location.search)
  },
}

/**
 * 後端統一用 { error } 回錯誤訊息，這裡把它挖出來丟成 Error。
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: any; silent?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, silent = false } = opts
  try {
    return await $fetch<T>('/api' + path, {
      method: method as any,
      body,
      headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : undefined,
    })
  } catch (err: any) {
    const message = err?.data?.data?.error || err?.data?.error || err?.statusMessage || '操作失敗'
    // 401 代表登入過期，導回登入頁；
    // 但登入端點自己的 401 是「密碼錯誤」，要讓呼叫端顯示訊息而不是跳轉。
    if (err?.statusCode === 401 && path !== '/auth/login') {
      auth.clear()
      auth.gotoLogin()
      throw new Error('請先登入')
    }
    if (!silent) toast(message, 'bad')
    throw new Error(message)
  }
}
