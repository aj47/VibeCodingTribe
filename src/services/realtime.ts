import type { HumanMessage, Participant } from '../domain/types'
import {
  LIVE_CONVERSATION_ID,
  normalizeDisplayName,
  normalizeHandle,
  parseRealtimeServerEvent,
  type RealtimeClientEvent,
  type RealtimeMessageRecord,
  type RealtimeProfile,
  type RealtimeServerEvent,
} from '../realtime/protocol'

export type RealtimeConnectionStatus = 'connected' | 'syncing' | 'offline'

interface RealtimeClientHandlers {
  onStatus: (status: RealtimeConnectionStatus) => void
  onEvent: (event: RealtimeServerEvent) => void
}

type SocketFactory = (url: string) => WebSocket

const PROFILE_KEY = 'vct-realtime-profile-v1'
const OUTBOX_KEY = 'vct-realtime-outbox-v1'
const PRODUCTION_ORIGIN = 'https://vibecodingtribe-realtime.techfren.workers.dev'
const AVATAR_COLORS = ['#657c54', '#4d7f73', '#75668c', '#8b684b', '#47708a']

function storage() {
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

function randomClientId() {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(36).slice(2)}`
  return `client_${value.slice(0, 24)}`
}

export function loadRealtimeProfile(): RealtimeProfile {
  try {
    const saved = storage()?.getItem(PROFILE_KEY)
    if (saved) {
      const value = JSON.parse(saved) as Partial<RealtimeProfile>
      if (value.clientId && value.displayName && value.handle && value.avatarColor) {
        return {
          clientId: value.clientId,
          displayName: normalizeDisplayName(value.displayName),
          handle: normalizeHandle(value.handle),
          avatarColor: value.avatarColor,
        }
      }
    }
  } catch {
    // A fresh local identity is safer than blocking the room on corrupt cache data.
  }
  const clientId = randomClientId()
  const suffix = clientId.slice(-4).toUpperCase()
  const profile: RealtimeProfile = {
    clientId,
    displayName: `Builder ${suffix}`,
    handle: `builder-${suffix.toLowerCase()}`,
    avatarColor: AVATAR_COLORS[Number.parseInt(suffix.replace(/[^0-9]/g, '').slice(-1) || '0', 10) % AVATAR_COLORS.length]!,
  }
  saveRealtimeProfile(profile)
  return profile
}

export function saveRealtimeProfile(profile: RealtimeProfile) {
  storage()?.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function realtimeProfileToParticipant(profile: RealtimeProfile): Participant {
  const initials = profile.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return {
    id: `realtime:${profile.clientId}`,
    kind: 'human',
    displayName: profile.displayName,
    handle: `@${profile.handle}`,
    avatarFallback: initials || 'RT',
    avatarColor: profile.avatarColor,
    presence: 'online',
    role: 'member',
  }
}

export function realtimeRecordToMessage(record: RealtimeMessageRecord): HumanMessage {
  return {
    id: record.id,
    conversationId: LIVE_CONVERSATION_ID,
    senderId: `realtime:${record.clientId}`,
    sentAt: record.sentAt,
    ...(record.threadId ? { threadId: record.threadId } : {}),
    deliveryState: 'sent',
    reactions: [],
    kind: 'human',
    content: { text: record.text, format: 'markdown' },
  }
}

let messageSequence = 0
export function createRealtimeMessageId(clientId: string) {
  messageSequence += 1
  return `rt_${clientId}_${Date.now()}_${messageSequence}`
}

export function realtimeWebSocketUrl(profile: RealtimeProfile) {
  const configured = import.meta.env.VITE_REALTIME_ORIGIN?.trim()
  const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const origin = configured || (isLocal ? 'http://localhost:8787' : PRODUCTION_ORIGIN)
  const url = new URL('/api/realtime', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('clientId', profile.clientId)
  url.searchParams.set('displayName', profile.displayName)
  url.searchParams.set('handle', profile.handle)
  url.searchParams.set('avatarColor', profile.avatarColor)
  return url.toString()
}

export class RealtimeRoomClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | undefined
  private reconnectAttempt = 0
  private stopped = true
  private outbox: RealtimeClientEvent['message'][] = this.loadOutbox()

  constructor(
    private readonly profile: RealtimeProfile,
    private readonly handlers: RealtimeClientHandlers,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url),
  ) {}

  connect() {
    this.stopped = false
    this.openSocket()
  }

  disconnect() {
    this.stopped = true
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
    this.socket?.close(1000, 'Client closed')
    this.socket = null
  }

  send(message: RealtimeClientEvent['message']) {
    if (!this.outbox.some((item) => item.id === message.id)) this.outbox.push(message)
    this.persistOutbox()
    this.flushOutbox()
  }

  private openSocket() {
    if (this.stopped) return
    if (typeof WebSocket === 'undefined') {
      this.handlers.onStatus('offline')
      return
    }
    this.handlers.onStatus(this.reconnectAttempt === 0 ? 'syncing' : 'offline')
    const socket = this.socketFactory(realtimeWebSocketUrl(this.profile))
    this.socket = socket
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return
      this.reconnectAttempt = 0
      this.handlers.onStatus('connected')
      this.flushOutbox()
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const parsed = parseRealtimeServerEvent(JSON.parse(event.data))
        if (!parsed) return
        if (parsed.type === 'message') {
          this.outbox = this.outbox.filter((item) => item.id !== parsed.message.id)
          this.persistOutbox()
        }
        this.handlers.onEvent(parsed)
      } catch {
        // Ignore malformed server events and retain the connection.
      }
    })
    socket.addEventListener('close', () => {
      if (socket !== this.socket || this.stopped) return
      this.socket = null
      this.handlers.onStatus('offline')
      const delay = Math.min(10_000, 750 * 2 ** this.reconnectAttempt)
      this.reconnectAttempt += 1
      this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay)
    })
    socket.addEventListener('error', () => socket.close())
  }

  private flushOutbox() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    for (const message of this.outbox) {
      this.socket.send(JSON.stringify({ type: 'send', message } satisfies RealtimeClientEvent))
    }
  }

  private loadOutbox() {
    try {
      const saved = storage()?.getItem(OUTBOX_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed.slice(-50) as RealtimeClientEvent['message'][] : []
    } catch {
      return []
    }
  }

  private persistOutbox() {
    storage()?.setItem(OUTBOX_KEY, JSON.stringify(this.outbox.slice(-50)))
  }
}
