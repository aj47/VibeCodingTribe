import {
  normalizeAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  normalizePoints,
  parseRealtimeServerEvent,
  type RealtimeClientEvent,
  type RealtimeSendEvent,
  type RealtimeProfile,
  type RealtimeServerEvent,
} from '../realtime/protocol'
import { DEFAULT_CHANNEL_ID, normalizeCommunityChannelId, type CommunityChannelId } from '../community/channels'

export type RealtimeConnectionStatus = 'connected' | 'syncing' | 'offline'

interface RealtimeClientHandlers {
  onStatus: (status: RealtimeConnectionStatus) => void
  onEvent: (event: RealtimeServerEvent) => void
}

type SocketFactory = (url: string, protocols?: string[]) => WebSocket

const PROFILE_KEY = 'vct-general-profile-v2'
const OUTBOX_KEY = 'vct-general-outbox-v2'
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
          ...(normalizePoints(value.points) !== undefined ? { points: normalizePoints(value.points) } : {}),
          ...(normalizeAvatarUrl(value.avatarUrl) ? { avatarUrl: normalizeAvatarUrl(value.avatarUrl) } : {}),
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

let messageSequence = 0
export function createRealtimeMessageId(clientId: string) {
  messageSequence += 1
  return `rt_${clientId}_${Date.now()}_${messageSequence}`
}

export function realtimeWebSocketUrl(profile: RealtimeProfile, channelId: CommunityChannelId = DEFAULT_CHANNEL_ID) {
  const configured = import.meta.env.VITE_REALTIME_ORIGIN?.trim()
  const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const origin = configured || (isLocal ? 'http://localhost:8787' : PRODUCTION_ORIGIN)
  const url = new URL('/api/realtime', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('clientId', profile.clientId)
  url.searchParams.set('displayName', profile.displayName)
  url.searchParams.set('handle', profile.handle)
  url.searchParams.set('channelId', channelId)
  url.searchParams.set('avatarColor', profile.avatarColor)
  if (profile.points !== undefined) url.searchParams.set('points', String(profile.points))
  if (profile.avatarUrl) url.searchParams.set('avatarUrl', profile.avatarUrl)
  return url.toString()
}

export class RealtimeRoomClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | undefined
  private reconnectAttempt = 0
  private stopped = true
  private outbox: RealtimeSendEvent['message'][]
  private pendingLikes = new Map<string, boolean>()
  private pendingMutations = new Map<string, Extract<RealtimeClientEvent, { type: 'edit_message' | 'delete_message' }>>()

  constructor(
    private readonly profile: RealtimeProfile,
    private readonly handlers: RealtimeClientHandlers,
    private readonly socketFactory: SocketFactory = (url, protocols) => new WebSocket(url, protocols),
    private readonly sessionToken?: string,
    private readonly canSend = true,
    private readonly channelId: CommunityChannelId = DEFAULT_CHANNEL_ID,
  ) {
    this.outbox = this.loadOutbox()
  }

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

  send(message: RealtimeSendEvent['message']) {
    if (!this.canSend) return
    const channelMessage = { ...message, channelId: normalizeCommunityChannelId(message.channelId || this.channelId) }
    if (!this.outbox.some((item) => item.id === channelMessage.id)) this.outbox.push(channelMessage)
    this.persistOutbox()
    this.flushOutbox()
  }

  setLike(messageId: string, liked: boolean) {
    if (!this.canSend) return
    this.pendingLikes.set(messageId, liked)
    this.flushOutbox()
  }

  editMessage(messageId: string, text: string) {
    if (!this.canSend) return
    this.pendingMutations.set(messageId, { type: 'edit_message', channelId: this.channelId, messageId, text })
    this.flushOutbox()
  }

  deleteMessage(messageId: string) {
    if (!this.canSend) return
    this.pendingMutations.set(messageId, { type: 'delete_message', channelId: this.channelId, messageId })
    this.flushOutbox()
  }

  private openSocket() {
    if (this.stopped) return
    if (typeof WebSocket === 'undefined') {
      this.handlers.onStatus('offline')
      return
    }
    this.handlers.onStatus(this.reconnectAttempt === 0 ? 'syncing' : 'offline')
    const protocols = this.sessionToken ? ['vct-realtime', `vct.auth.${this.sessionToken}`] : undefined
    const socket = this.socketFactory(realtimeWebSocketUrl(this.profile, this.channelId), protocols)
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
          if (parsed.message.channelId !== this.channelId) return
          this.outbox = this.outbox.filter((item) => item.id !== parsed.message.id)
          const pendingLike = this.pendingLikes.get(parsed.message.id)
          if (pendingLike === parsed.message.likedByClientIds?.includes(this.profile.clientId)) {
            this.pendingLikes.delete(parsed.message.id)
          }
          const pendingMutation = this.pendingMutations.get(parsed.message.id)
          if (pendingMutation?.type === 'delete_message' && parsed.message.deletedAt) this.pendingMutations.delete(parsed.message.id)
          if (pendingMutation?.type === 'edit_message' && parsed.message.editedAt && parsed.message.text === pendingMutation.text.trim()) this.pendingMutations.delete(parsed.message.id)
          this.persistOutbox()
        }
        if (parsed.type === 'snapshot' && parsed.messages.some((message) => message.channelId !== this.channelId)) return
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
    if (!this.canSend) return
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    for (const message of this.outbox) {
      this.socket.send(JSON.stringify({ type: 'send', message } satisfies RealtimeClientEvent))
    }
    for (const [messageId, liked] of this.pendingLikes) {
      this.socket.send(JSON.stringify({ type: 'set_like', channelId: this.channelId, messageId, liked } satisfies RealtimeClientEvent))
    }
    for (const mutation of this.pendingMutations.values()) this.socket.send(JSON.stringify(mutation))
  }

  private loadOutbox() {
    try {
      const saved = storage()?.getItem(`${OUTBOX_KEY}:${this.channelId}`)
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed.slice(-50) as RealtimeSendEvent['message'][] : []
    } catch {
      return []
    }
  }

  private persistOutbox() {
    storage()?.setItem(`${OUTBOX_KEY}:${this.channelId}`, JSON.stringify(this.outbox.slice(-50)))
  }
}
