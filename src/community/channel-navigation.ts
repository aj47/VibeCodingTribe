import { COMMUNITY_CHANNELS, type CommunityChannelId } from './channels'
import type { RealtimeMessageRecord } from '../realtime/protocol'

export interface ChannelActivity {
  latestActivity?: string
}

export interface ActiveThread {
  channelId: CommunityChannelId
  parentId: string
  title: string
  preview: string
  replyCount: number
  latestActivity: string
}

export type ChannelActivityMap = Partial<Record<CommunityChannelId, ChannelActivity>>

function compareText(a: string, b: string) {
  return a.localeCompare(b, 'en', { sensitivity: 'base' })
}

export function sortCommunityChannels(activity: ChannelActivityMap = {}) {
  return [...COMMUNITY_CHANNELS].sort((a, b) => {
    const aTime = activity[a.id]?.latestActivity ?? ''
    const bTime = activity[b.id]?.latestActivity ?? ''
    if (aTime !== bTime) {
      if (!aTime) return 1
      if (!bTime) return -1
      const timeOrder = bTime.localeCompare(aTime)
      if (timeOrder !== 0) return timeOrder
    }
    return compareText(a.name, b.name)
  })
}

export function findActiveThreads(messages: RealtimeMessageRecord[], channelId: CommunityChannelId): ActiveThread[] {
  const channelMessages = messages.filter((message) => message.channelId === channelId)
  const parents = new Map(channelMessages.filter((message) => !message.parentId).map((message) => [message.id, message]))
  const replies = new Map<string, RealtimeMessageRecord[]>()
  for (const message of channelMessages) {
    if (!message.parentId || !parents.has(message.parentId)) continue
    replies.set(message.parentId, [...(replies.get(message.parentId) ?? []), message])
  }
  return [...replies.entries()]
    .filter(([, threadReplies]) => threadReplies.length >= 3)
    .map(([parentId, threadReplies]) => {
      const parent = parents.get(parentId)!
      const latestReply = [...threadReplies].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]!
      const title = parent.buildName?.trim() || parent.text.trim().split(/\s+/).slice(0, 8).join(' ') || 'Untitled conversation'
      const preview = parent.text.trim() || 'Image or build shared in this conversation.'
      return {
        channelId,
        parentId,
        title,
        preview,
        replyCount: threadReplies.length,
        latestActivity: latestReply.sentAt,
      }
    })
    .sort((a, b) => b.latestActivity.localeCompare(a.latestActivity) || compareText(a.title, b.title))
}
