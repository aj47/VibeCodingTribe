export const DEFAULT_CHANNEL_ID = 'general'

export const COMMUNITY_CHANNELS = [
  { id: 'general', name: 'General', description: 'The open workshop conversation.', legacyPaths: ['/', '/r/general'] },
  { id: 'showcases', name: 'Showcases', description: 'Progress, launches, and builds in public.', legacyPaths: [] },
  { id: 'feedback', name: 'Feedback', description: 'Specific asks for another builder’s eyes.', legacyPaths: ['/missions', '/exchange'] },
] as const

export type CommunityChannelId = typeof COMMUNITY_CHANNELS[number]['id']

export function isCommunityChannelId(value: unknown): value is CommunityChannelId {
  return COMMUNITY_CHANNELS.some((channel) => channel.id === value)
}

export function normalizeCommunityChannelId(value: unknown): CommunityChannelId {
  return isCommunityChannelId(value) ? value : DEFAULT_CHANNEL_ID
}

export function channelRoomName(channelId: CommunityChannelId) {
  return `vibecodingtribe.com/channel/${channelId}`
}

export function channelPath(channelId: CommunityChannelId) {
  return `/c/${channelId}`
}

export function channelFromPath(pathname: string): CommunityChannelId {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath === '/missions' || normalizedPath === '/exchange') return 'general'
  if (normalizedPath === '/r/general' || normalizedPath === '/') return 'general'
  const channel = normalizedPath.match(/^\/c\/([^/]+)$/)?.[1]
  if (isCommunityChannelId(channel)) return channel
  return DEFAULT_CHANNEL_ID
}
