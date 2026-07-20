export const LIVE_ROOM_KEY = 'vibecodingtribe.com/r/general'
export const MAX_REALTIME_MESSAGE_LENGTH = 4_000

export interface RealtimeProfile {
  clientId: string
  displayName: string
  handle: string
  avatarColor: string
  avatarUrl?: string
  profileId?: string
  actorType?: 'human' | 'agent'
  ownerHandle?: string
  ownerProfileId?: string
}

export interface RealtimeMessageRecord {
  id: string
  clientId: string
  displayName: string
  handle: string
  avatarColor: string
  avatarUrl?: string
  profileId?: string
  actorType?: 'human' | 'agent'
  ownerHandle?: string
  ownerProfileId?: string
  text: string
  sentAt: string
}

export interface RealtimeSendEvent {
  type: 'send'
  message: {
    id: string
    text: string
  }
}

export type RealtimeClientEvent = RealtimeSendEvent

export type RealtimeServerEvent =
  | {
      type: 'snapshot'
      messages: RealtimeMessageRecord[]
      participants: RealtimeProfile[]
      onlineCount: number
    }
  | { type: 'message'; message: RealtimeMessageRecord }
  | { type: 'presence'; participants: RealtimeProfile[]; onlineCount: number }
  | { type: 'error'; message: string; clientMessageId?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40)
}

export function normalizeHandle(value: string) {
  const normalized = value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  return normalized || 'builder'
}

export function normalizeAvatarUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function parseRealtimeClientEvent(value: unknown): RealtimeClientEvent | null {
  if (!isRecord(value) || value.type !== 'send' || !isRecord(value.message)) return null
  const { id, text } = value.message
  if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(id)) return null
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_REALTIME_MESSAGE_LENGTH) return null
  return {
    type: 'send',
    message: {
      id,
      text: trimmed,
    },
  }
}

export function parseRealtimeServerEvent(value: unknown): RealtimeServerEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'message' && isRecord(value.message)) {
    return isRealtimeMessageRecord(value.message) ? { type: 'message', message: value.message } : null
  }
  if (value.type === 'snapshot') {
    if (!Array.isArray(value.messages) || !value.messages.every(isRealtimeMessageRecord)) return null
    if (!Array.isArray(value.participants) || !value.participants.every(isRealtimeProfile)) return null
    if (typeof value.onlineCount !== 'number') return null
    return {
      type: 'snapshot',
      messages: value.messages,
      participants: value.participants,
      onlineCount: value.onlineCount,
    }
  }
  if (value.type === 'presence') {
    if (!Array.isArray(value.participants) || !value.participants.every(isRealtimeProfile)) return null
    if (typeof value.onlineCount !== 'number') return null
    return { type: 'presence', participants: value.participants, onlineCount: value.onlineCount }
  }
  if (value.type === 'error' && typeof value.message === 'string') {
    return {
      type: 'error',
      message: value.message,
      ...(typeof value.clientMessageId === 'string' ? { clientMessageId: value.clientMessageId } : {}),
    }
  }
  return null
}

export function isRealtimeProfile(value: unknown): value is RealtimeProfile {
  return isRecord(value)
    && typeof value.clientId === 'string'
    && typeof value.displayName === 'string'
    && typeof value.handle === 'string'
    && typeof value.avatarColor === 'string'
    && (value.avatarUrl === undefined || normalizeAvatarUrl(value.avatarUrl) !== undefined)
    && (value.profileId === undefined || typeof value.profileId === 'string')
    && (value.actorType === undefined || ['human', 'agent'].includes(String(value.actorType)))
    && (value.ownerHandle === undefined || typeof value.ownerHandle === 'string')
    && (value.ownerProfileId === undefined || typeof value.ownerProfileId === 'string')
}

export function isRealtimeMessageRecord(value: unknown): value is RealtimeMessageRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.clientId === 'string'
    && typeof value.displayName === 'string'
    && typeof value.handle === 'string'
    && typeof value.avatarColor === 'string'
    && (value.avatarUrl === undefined || normalizeAvatarUrl(value.avatarUrl) !== undefined)
    && (value.profileId === undefined || typeof value.profileId === 'string')
    && (value.actorType === undefined || ['human', 'agent'].includes(String(value.actorType)))
    && (value.ownerHandle === undefined || typeof value.ownerHandle === 'string')
    && (value.ownerProfileId === undefined || typeof value.ownerProfileId === 'string')
    && typeof value.text === 'string'
    && typeof value.sentAt === 'string'
}
