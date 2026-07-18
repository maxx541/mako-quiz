import { io, type Socket } from 'socket.io-client'

/**
 * 建立一條 Socket.IO 連線，並在元件卸載時關掉。
 * 交給 socket.io 自己決定 transport：能升級到 WebSocket 就升級，
 * 環境不允許（某些 proxy）時會退回 long-polling，兩種都可用。
 */
export function useSocket() {
  const socket: Socket = io({ path: '/socket.io/' })
  onScopeDispose(() => socket.close())
  return socket
}

/** 把 socket.emit 的 callback 包成 Promise，並把 { error } 轉成拋出 */
export function emitAsync<T = any>(socket: Socket, event: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('伺服器沒有回應')), 10000)
    socket.emit(event, payload, (res: any) => {
      clearTimeout(t)
      if (res?.error) reject(new Error(res.error))
      else resolve(res)
    })
  })
}
