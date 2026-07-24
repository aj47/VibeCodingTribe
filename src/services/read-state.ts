import type { CommunityChannelId } from '../community/channels'

export interface LocalReadState {
  channels: Partial<Record<CommunityChannelId, string>>
  threads: Record<string, string>
}

const READ_STATE_KEY = 'vct-local-read-state-v1'
const ACTIVITY_KEY = 'vct-local-channel-activity-v1'

function storage() {
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

function scopedKey(prefix: string, clientId: string) {
  return `${prefix}:${clientId}`
}

function safeState(value: unknown): LocalReadState {
  if (typeof value !== 'object' || value === null) return { channels: {}, threads: {} }
  const candidate = value as Partial<LocalReadState>
  return {
    channels: candidate.channels && typeof candidate.channels === 'object' ? candidate.channels : {},
    threads: candidate.threads && typeof candidate.threads === 'object' ? candidate.threads : {},
  }
}

export function loadLocalReadState(clientId: string): LocalReadState {
  try {
    const value = storage()?.getItem(scopedKey(READ_STATE_KEY, clientId))
    return safeState(value ? JSON.parse(value) : undefined)
  } catch {
    return { channels: {}, threads: {} }
  }
}

export function saveLocalReadState(clientId: string, state: LocalReadState) {
  storage()?.setItem(scopedKey(READ_STATE_KEY, clientId), JSON.stringify(state))
}

export function markChannelRead(state: LocalReadState, channelId: CommunityChannelId, activityAt?: string): LocalReadState {
  if (!activityAt) return state
  return { ...state, channels: { ...state.channels, [channelId]: activityAt } }
}

export function markThreadRead(state: LocalReadState, channelId: CommunityChannelId, parentId: string, activityAt?: string): LocalReadState {
  if (!activityAt) return state
  return { ...state, threads: { ...state.threads, [`${channelId}:${parentId}`]: activityAt } }
}

export function isActivityUnread(activityAt: string | undefined, readAt: string | undefined) {
  return Boolean(activityAt && (!readAt || activityAt > readAt))
}

export function loadLocalChannelActivity(clientId: string): Partial<Record<CommunityChannelId, string>> {
  try {
    const value = storage()?.getItem(scopedKey(ACTIVITY_KEY, clientId))
    const parsed = value ? JSON.parse(value) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveLocalChannelActivity(clientId: string, activity: Partial<Record<CommunityChannelId, string>>) {
  storage()?.setItem(scopedKey(ACTIVITY_KEY, clientId), JSON.stringify(activity))
}
