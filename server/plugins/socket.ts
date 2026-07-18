import { Server as Engine } from 'engine.io'
import { Server } from 'socket.io'
import { defineEventHandler } from 'h3'
import QRCode from 'qrcode'
import os from 'node:os'

import { getPresentation, isEmpty } from '../utils/store'
import { createSession, findSession, startSweeper } from '../utils/session'
import { seedDemo } from '../utils/seed'
import { validToken } from '../utils/auth'

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address
    }
  }
  return null
}

/**
 * 主持人如果用 localhost 開簡報，QR 掃出來手機連不上；
 * 這裡自動換成同網段的區域網路 IP。
 */
function buildJoinUrl(origin: string, code: string) {
  const configured = useRuntimeConfig().publicUrl
  if (configured) return `${String(configured).replace(/\/$/, '')}/?c=${code}`
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    url = new URL('http://localhost:3000')
  }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    const lan = lanAddress()
    if (lan) url.hostname = lan
  }
  return `${url.origin}/?c=${code}`
}

export default defineNitroPlugin((nitroApp: any) => {
  if (isEmpty()) {
    seedDemo()
    console.log('[seed] 已建立示範簡報')
  }

  const engine = new Engine()
  const io = new Server()
  io.bind(engine as any)
  startSweeper()

  io.on('connection', (socket) => {
    const ctx: { role: string | null; code: string | null; playerId: string | null } = {
      role: null,
      code: null,
      playerId: null,
    }
    const ack = (cb: any, payload: any) => typeof cb === 'function' && cb(payload)
    const mySession = () => (ctx.code ? findSession(ctx.code) : null)

    /* ---- 主持端 ---- */

    socket.on('host:open', async ({ presentationId, token, origin }: any = {}, cb: any) => {
      if (!validToken(token)) return ack(cb, { error: '未授權，請重新登入' })
      const p = getPresentation(presentationId)
      if (!p) return ack(cb, { error: '找不到簡報' })
      if (!p.slides.length) return ack(cb, { error: '這份簡報還沒有任何投影片' })

      const s = createSession(p, io)
      s.joinUrl = buildJoinUrl(origin, s.code)
      try {
        s.qrDataUrl = await QRCode.toDataURL(s.joinUrl, { margin: 1, width: 360, color: { dark: '#0f172a', light: '#ffffff' } })
      } catch {
        s.qrDataUrl = ''
      }
      s.hostSockets.add(socket.id)
      socket.join(s.room())
      ctx.role = 'host'
      ctx.code = s.code
      ack(cb, { ok: true, code: s.code, qr: s.qrDataUrl, joinUrl: s.joinUrl, view: s.hostView() })
    })

    /**
     * 接回進行中的場次（主持人不小心重新整理時用）。
     *
     * 已經結束的場次一律不給接 —— 否則主持人回到後台再按一次「播放」，
     * 分頁裡還留著上一場的代碼，就會被接回那個已經結束的房間而不是開新的。
     */
    socket.on('host:resume', ({ code, token }: any = {}, cb: any) => {
      if (!validToken(token)) return ack(cb, { error: '未授權，請重新登入' })
      const s = findSession(code)
      if (!s) return ack(cb, { error: '場次不存在或已過期' })
      if (s.state === 'ended') return ack(cb, { error: '這場已經結束了' })
      s.hostSockets.add(socket.id)
      socket.join(s.room())
      ctx.role = 'host'
      ctx.code = s.code
      ack(cb, { ok: true, code: s.code, qr: s.qrDataUrl, joinUrl: s.joinUrl, view: s.hostView() })
    })

    socket.on('host:action', ({ action, payload }: any = {}, cb: any) => {
      const s = mySession()
      if (!s || ctx.role !== 'host') return ack(cb, { error: '未授權' })
      switch (action) {
        case 'start': s.start(); break
        case 'advance': s.advance(); break
        case 'back': s.back(); break
        case 'next': s.next(); break
        case 'prev': s.prev(); break
        case 'goto': s.goto(Number(payload?.index) || 0); break
        case 'reveal': s.reveal(); break
        case 'nextStage': s.nextStage(); break
        case 'lock': s.lock(); break
        case 'leaderboard': s.showLeaderboard(); break
        case 'addTime': s.addTime(Number(payload?.seconds) || 15); break
        case 'end': s.end(); break
        case 'kick': s.kick(payload?.playerId); break
        case 'qa:update': s.qaUpdate(payload?.id, payload?.patch || {}); break
        case 'qa:delete': s.qaDelete(payload?.id); break
        case 'settings':
          s.presentation.settings = { ...s.presentation.settings, ...(payload || {}) }
          s.syncAll()
          break
        default:
          return ack(cb, { error: '未知的操作：' + action })
      }
      ack(cb, { ok: true })
    })

    /* ---- 參與端 ---- */

    socket.on('player:join', ({ code, name, token }: any = {}, cb: any) => {
      const s = findSession(code)
      if (!s) return ack(cb, { error: '找不到這個房間代碼' })
      if (s.state === 'ended') return ack(cb, { error: '這場活動已經結束了' })

      let player = token ? s.resumePlayer(token, socket) : null
      const resumed = !!player
      if (!player) {
        if (s.state !== 'lobby' && s.settings.allowLateJoin === false) {
          return ack(cb, { error: '活動已開始，主持人未開放中途加入' })
        }
        if (s.players.size >= 500) return ack(cb, { error: '房間人數已滿' })
        player = s.addPlayer(name, socket)
      }
      ctx.role = 'player'
      ctx.code = s.code
      ctx.playerId = player.id
      ack(cb, { ok: true, token: player.token, resumed, name: player.name, view: s.playerView(player) })
    })

    socket.on('player:answer', ({ slideId, value }: any = {}, cb: any) => {
      const s = mySession()
      if (!s || !ctx.playerId) return ack(cb, { error: '尚未加入房間' })
      ack(cb, s.submit(ctx.playerId, slideId, value))
    })

    socket.on('player:qa:ask', ({ text }: any = {}, cb: any) => {
      const s = mySession()
      if (!s || !ctx.playerId) return ack(cb, { error: '尚未加入房間' })
      ack(cb, s.qaAsk(ctx.playerId, text))
    })

    socket.on('player:reaction', ({ id }: any = {}, cb: any) => {
      const s = mySession()
      if (!s || !ctx.playerId) return ack(cb, { error: '尚未加入房間' })
      ack(cb, s.react(ctx.playerId, id))
    })

    socket.on('player:qa:vote', ({ id }: any = {}, cb: any) => {
      const s = mySession()
      if (!s || !ctx.playerId) return ack(cb, { error: '尚未加入房間' })
      if (s.settings.qaUpvote === false) return ack(cb, { error: '主持人已關閉按讚' })
      ack(cb, s.qaVote(ctx.playerId, id))
    })

    socket.on('disconnect', () => {
      mySession()?.detachSocket(socket.id)
    })
  })

  /**
   * 把 engine.io 掛到 Nitro 的 router 上。
   * HTTP long-polling 走 handler，WebSocket 升級走 websocket hooks
   * （需要 nitro.experimental.websocket = true）。
   */
  nitroApp.router.use(
    '/socket.io/',
    defineEventHandler({
      // HTTP long-polling 走這裡
      handler(event: any) {
        engine.handleRequest(event.node.req, event.node.res)
        event._handled = true
      },
      // WebSocket 升級走這裡。注意 hooks 是直接放在 websocket 底下，
      // 不能再包一層 { hooks: ... } —— crossws 會找不到而靜靜地不呼叫。
      websocket: {
        message: () => {},
        open(peer: any) {
          // crossws 已經完成 HTTP 升級，這裡把底層的 socket 交給 engine.io 接手
          const { nodeReq, ws } = peer._internal
          engine.prepare(nodeReq)
          engine.onWebSocket(nodeReq, nodeReq.socket, ws)
        },
      },
    } as any)
  )
})
