import { DEFAULT_CHANNEL_ID, isCommunityChannelId, normalizeCommunityChannelId, type CommunityChannelId } from '../community/channels'

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
  channelId: CommunityChannelId
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
  intent?: 'chat' | 'showcase' | 'needs_feedback' | 'update' | 'question'
  parentId?: string
  commentKind?: 'reply' | 'feedback'
  buildName?: string
  buildUrl?: string
  imageUrl?: string
  likedByClientIds?: string[]
}

export interface RealtimeSendEvent {
  type: 'send'
  message: {
    id: string
    channelId: CommunityChannelId
    text: string
    intent?: 'chat' | 'showcase' | 'needs_feedback' | 'update' | 'question'
    parentId?: string
    commentKind?: 'reply' | 'feedback'
    buildName?: string
    buildUrl?: string
    imageUrl?: string
  }
}

export interface RealtimeSetLikeEvent {
  type: 'set_like'
  channelId: CommunityChannelId
  messageId: string
  liked: boolean
}

export type RealtimeClientEvent = RealtimeSendEvent | RealtimeSetLikeEvent

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

function parseChannelId(value: unknown): CommunityChannelId | null {
  if (value === undefined) return DEFAULT_CHANNEL_ID
  return isCommunityChannelId(value) ? value : null
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
  if (!isRecord(value)) return null
  if (value.type === 'set_like') {
    if (typeof value.messageId !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(value.messageId)) return null
    if (typeof value.liked !== 'boolean') return null
    const channelId = parseChannelId(value.channelId)
    return channelId ? { type: 'set_like', channelId, messageId: value.messageId, liked: value.liked } : null
  }
  if (value.type !== 'send' || !isRecord(value.message)) return null
  const { id, text } = value.message
  if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(id)) return null
  if (typeof text !== 'string') return null
  const channelId = parseChannelId(value.message.channelId)
  if (!channelId) return null
  const trimmed = text.trim()
  const imageUrl = normalizeHttpUrl(value.message.imageUrl)
  if ((!trimmed && !imageUrl) || trimmed.length > MAX_REALTIME_MESSAGE_LENGTH) return null
  const intent = ['chat', 'showcase', 'needs_feedback', 'update', 'question'].includes(String(value.message.intent))
    ? value.message.intent as 'chat' | 'showcase' | 'needs_feedback' | 'update' | 'question'
    : undefined
  const parentId = typeof value.message.parentId === 'string' && /^[a-zA-Z0-9:_-]{8,160}$/.test(value.message.parentId)
    ? value.message.parentId
    : undefined
  const buildName = typeof value.message.buildName === 'string' ? value.message.buildName.trim().slice(0, 80) : undefined
  const buildUrl = normalizeHttpUrl(value.message.buildUrl)
  const commentKind = ['reply', 'feedback'].includes(String(value.message.commentKind))
    ? value.message.commentKind as 'reply' | 'feedback'
    : undefined
  return {
    type: 'send',
    message: {
      id,
      channelId,
      text: trimmed,
      ...(intent ? { intent } : {}),
      ...(parentId ? { parentId } : {}),
      ...(commentKind ? { commentKind } : {}),
      ...(buildName ? { buildName } : {}),
      ...(buildUrl ? { buildUrl } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    },
  }
}

export function normalizeHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function parseRealtimeServerEvent(value: unknown): RealtimeServerEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'message' && isRecord(value.message)) {
    const message = normalizeRealtimeMessageRecord(value.message)
    return message ? { type: 'message', message } : null
  }
  if (value.type === 'snapshot') {
    if (!Array.isArray(value.messages)) return null
    const messages = value.messages.map((message) => normalizeRealtimeMessageRecord(message)).filter((message): message is RealtimeMessageRecord => Boolean(message))
    if (messages.length !== value.messages.length) return null
    if (!Array.isArray(value.participants) || !value.participants.every(isRealtimeProfile)) return null
    if (typeof value.onlineCount !== 'number') return null
    return {
      type: 'snapshot',
      messages,
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

export function normalizeRealtimeMessageRecord(value: unknown): RealtimeMessageRecord | null {
  if (!isRecord(value)) return null
  const avatarUrl = normalizeAvatarUrl(value.avatarUrl)
  const normalized = {
    ...value,
    channelId: normalizeCommunityChannelId(value.channelId),
    ...(avatarUrl ? { avatarUrl } : { avatarUrl: undefined }),
  }
  return isRealtimeMessageRecord(normalized) ? normalized : null
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
    && typeof value.channelId === 'string'
    && normalizeCommunityChannelId(value.channelId) === value.channelId
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
    && (value.intent === undefined || ['chat', 'showcase', 'needs_feedback', 'update', 'question'].includes(String(value.intent)))
    && (value.parentId === undefined || typeof value.parentId === 'string')
    && (value.commentKind === undefined || ['reply', 'feedback'].includes(String(value.commentKind)))
    && (value.buildName === undefined || typeof value.buildName === 'string')
    && (value.buildUrl === undefined || normalizeHttpUrl(value.buildUrl) !== undefined)
    && (value.imageUrl === undefined || normalizeHttpUrl(value.imageUrl) !== undefined)
    && (value.likedByClientIds === undefined || (
      Array.isArray(value.likedByClientIds)
      && value.likedByClientIds.length <= 10_000
      && value.likedByClientIds.every((clientId) => typeof clientId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(clientId))
    ))
}
