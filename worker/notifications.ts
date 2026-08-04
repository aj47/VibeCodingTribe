import type { CommunityChannelId } from '../src/community/channels'
import type { RealtimeMessageRecord } from '../src/realtime/protocol'

export type ActivityDigestEventKind = 'reply' | 'feedback'

export interface NotificationPreferences {
  activityDigest: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  activityDigest: false,
}

export interface DigestRecipient {
  accountId: string
  realtimeClientId: string
  displayName: string
  email?: string
  preferences: NotificationPreferences
}

export interface ActivityDigestEvent {
  id: string
  kind: ActivityDigestEventKind
  channelId: CommunityChannelId
  parentId: string
  createdAt: string
  actorDisplayName: string
  parentTitle: string
  preview: string
  deepLink: string
}

export type ActivityDigestCandidate = ActivityDigestEvent

const CHANNEL_LABELS: Record<CommunityChannelId, string> = {
  general: 'General conversation',
  showcases: 'Showcase',
  feedback: 'Feedback request',
}

function compact(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
}

function ownsMessage(message: RealtimeMessageRecord, recipient: DigestRecipient) {
  return message.profileId === recipient.accountId
    || message.clientId === recipient.realtimeClientId
    || message.ownerProfileId === recipient.accountId
}

function eventDeepLink(appOrigin: string, channelId: CommunityChannelId, parentId: string) {
  const path = channelId === 'general' ? '/' : `/c/${channelId}`
  const url = new URL(path, appOrigin)
  url.searchParams.set('thread', parentId)
  return url.toString()
}

export function isDigestActivity(message: RealtimeMessageRecord, parent: RealtimeMessageRecord) {
  if (!message.parentId || message.id === parent.id || message.deletedAt || parent.deletedAt) return false
  if (message.commentKind === 'feedback') {
    return ['showcase', 'update', 'needs_feedback'].includes(parent.intent ?? '')
  }
  return true
}

export function collectActivityDigestEvents(
  messages: RealtimeMessageRecord[],
  recipient: DigestRecipient,
  appOrigin: string,
): ActivityDigestEvent[] {
  const byId = new Map(messages.map((message) => [message.id, message]))
  return messages
    .filter((message) => message.parentId)
    .flatMap((message) => {
      const parent = byId.get(message.parentId!)
      if (!parent || !ownsMessage(parent, recipient) || ownsMessage(message, recipient) || !isDigestActivity(message, parent)) return []
      const kind: ActivityDigestEventKind = message.commentKind === 'feedback' ? 'feedback' : 'reply'
      const parentTitle = compact(parent.buildName || firstLine(parent.text) || CHANNEL_LABELS[parent.channelId], 120)
      const preview = compact(message.text || 'Shared an image in this conversation.', 240)
      return [{
        id: `activity:${kind}:${message.channelId}:${message.id}`,
        kind,
        channelId: message.channelId,
        parentId: parent.id,
        createdAt: message.sentAt,
        actorDisplayName: compact(message.displayName, 80),
        parentTitle,
        preview,
        deepLink: eventDeepLink(appOrigin, message.channelId, parent.id),
      }]
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}

export function digestDay(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function uniqueDigestEvents(events: ActivityDigestCandidate[]) {
  return [...new Map(events.map((event) => [event.id, event])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
