import type { RealtimeMessageRecord, RealtimeProfile, RealtimeServerEvent } from '../src/realtime/protocol'
import {
  LIVE_CHANNEL,
  LIVE_REPOSITORY,
  normalizeDisplayName,
  normalizeHandle,
  parseRealtimeClientEvent,
} from '../src/realtime/protocol'

interface Env {
  LIVE_ROOM: DurableObjectNamespace
  ALLOWED_ORIGINS: string
}

interface ConnectionAttachment extends RealtimeProfile {
  joinedAt: string
}

const ROOM_NAME = `${LIVE_REPOSITORY}#${LIVE_CHANNEL}`
const HISTORY_KEY = 'messages'
const HISTORY_LIMIT = 200

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  })
}

function isAllowedOrigin(request: Request, allowedOrigins: string) {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    const hostname = new URL(origin).hostname
    if (hostname === 'vibecodingtribe.pages.dev' || hostname.endsWith('.vibecodingtribe.pages.dev')) return true
    return allowedOrigins.split(',').map((value) => value.trim()).filter(Boolean).includes(origin)
  } catch {
    return false
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return json({ status: 'ok', room: ROOM_NAME, transport: 'durable-object-websocket' })
    }
    if (url.pathname !== '/api/realtime') return json({ error: 'Not found' }, 404)
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return json({ error: 'Origin not allowed' }, 403)
    const roomId = env.LIVE_ROOM.idFromName(ROOM_NAME)
    return env.LIVE_ROOM.get(roomId).fetch(request)
  },
} satisfies ExportedHandler<Env>

export class RealtimeRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'Expected a WebSocket upgrade' }, 426)
    }

    const url = new URL(request.url)
    const profile = this.profileFromUrl(url)
    if (!profile) return json({ error: 'A valid realtime profile is required' }, 400)

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const attachment: ConnectionAttachment = { ...profile, joinedAt: new Date().toISOString() }
    server.serializeAttachment(attachment)
    this.state.acceptWebSocket(server)

    const messages = (await this.state.storage.get<RealtimeMessageRecord[]>(HISTORY_KEY)) ?? []
    this.send(server, {
      type: 'snapshot',
      messages,
      participants: this.connectedParticipants(),
      onlineCount: this.state.getWebSockets().length,
    })
    this.broadcastPresence()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer) {
    if (typeof payload !== 'string') {
      this.send(socket, { type: 'error', message: 'Binary messages are not supported' })
      return
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(payload)
    } catch {
      this.send(socket, { type: 'error', message: 'Message payload must be valid JSON' })
      return
    }

    const event = parseRealtimeClientEvent(decoded)
    if (!event) {
      this.send(socket, { type: 'error', message: 'Message payload was invalid' })
      return
    }

    const profile = socket.deserializeAttachment() as ConnectionAttachment | null
    if (!profile) {
      this.send(socket, { type: 'error', message: 'Connection identity was unavailable', clientMessageId: event.message.id })
      return
    }

    const history = (await this.state.storage.get<RealtimeMessageRecord[]>(HISTORY_KEY)) ?? []
    const existing = history.find((message) => message.id === event.message.id)
    if (existing) {
      this.send(socket, { type: 'message', message: existing })
      return
    }

    const message: RealtimeMessageRecord = {
      id: event.message.id,
      clientId: profile.clientId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarColor: profile.avatarColor,
      text: event.message.text,
      sentAt: new Date().toISOString(),
      ...(event.message.threadId ? { threadId: event.message.threadId } : {}),
    }
    await this.state.storage.put(HISTORY_KEY, [...history, message].slice(-HISTORY_LIMIT))
    this.broadcast({ type: 'message', message })
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason)
    this.broadcastPresence()
  }

  webSocketError() {
    this.broadcastPresence()
  }

  private profileFromUrl(url: URL): RealtimeProfile | null {
    const clientId = url.searchParams.get('clientId')?.trim().slice(0, 80)
    const displayName = normalizeDisplayName(url.searchParams.get('displayName') ?? '')
    const handle = normalizeHandle(url.searchParams.get('handle') ?? '')
    const avatarColor = url.searchParams.get('avatarColor')?.trim().slice(0, 32) ?? '#6f8f65'
    if (!clientId || !/^[a-zA-Z0-9_-]{8,80}$/.test(clientId) || !displayName) return null
    return { clientId, displayName, handle, avatarColor }
  }

  private connectedParticipants() {
    const participants = new Map<string, RealtimeProfile>()
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
      if (!attachment) continue
      participants.set(attachment.clientId, {
        clientId: attachment.clientId,
        displayName: attachment.displayName,
        handle: attachment.handle,
        avatarColor: attachment.avatarColor,
      })
    }
    return [...participants.values()]
  }

  private broadcastPresence() {
    this.broadcast({
      type: 'presence',
      participants: this.connectedParticipants(),
      onlineCount: this.state.getWebSockets().length,
    })
  }

  private broadcast(event: RealtimeServerEvent) {
    for (const socket of this.state.getWebSockets()) this.send(socket, event)
  }

  private send(socket: WebSocket, event: RealtimeServerEvent) {
    try {
      socket.send(JSON.stringify(event))
    } catch {
      // A closing peer will be removed by the runtime and the next presence event.
    }
  }
}
