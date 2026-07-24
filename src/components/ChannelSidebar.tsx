import { Hash, MessageCircle, Search, X } from 'lucide-react'
import { useMemo, useState, type RefObject } from 'react'
import { COMMUNITY_CHANNELS, channelPath, type CommunityChannelId } from '../community/channels'
import { findActiveThreads, sortCommunityChannels, type ActiveThread, type ChannelActivityMap } from '../community/channel-navigation'
import type { RealtimeMessageRecord } from '../realtime/protocol'
import { isActivityUnread, type LocalReadState } from '../services/read-state'

interface ChannelSidebarProps {
  selectedChannelId: CommunityChannelId
  activity: ChannelActivityMap
  messages: RealtimeMessageRecord[]
  onSelectChannel: (channelId: CommunityChannelId) => void
  onOpenThread: (channelId: CommunityChannelId, parentId: string) => void
  onReadThread: (channelId: CommunityChannelId, parentId: string, activityAt: string) => void
  readState: LocalReadState
  autoFocusSearch?: boolean
  searchInputRef?: RefObject<HTMLInputElement | null>
}

function relativeTime(timestamp: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function threadMatches(thread: ActiveThread, query: string) {
  if (!query) return true
  const haystack = `${thread.title} ${thread.preview} ${thread.channelId}`.toLocaleLowerCase()
  return haystack.includes(query.toLocaleLowerCase())
}

export function ChannelSidebar({ selectedChannelId, activity, messages, onSelectChannel, onOpenThread, onReadThread, readState, autoFocusSearch, searchInputRef }: ChannelSidebarProps) {
  const [query, setQuery] = useState('')
  const channels = useMemo(() => sortCommunityChannels(activity).filter((channel) => {
    const haystack = `${channel.name} ${channel.description}`.toLocaleLowerCase()
    return haystack.includes(query.toLocaleLowerCase())
  }), [activity, query])
  const activeThreads = useMemo(() => findActiveThreads(messages, selectedChannelId).filter((thread) => threadMatches(thread, query)), [messages, query, selectedChannelId])
  const hasResults = channels.length > 0 || activeThreads.length > 0

  return <div className="channel-sidebar">
    <div className="channel-sidebar__heading"><span>CHANNELS</span><small>{COMMUNITY_CHANNELS.length} rooms</small></div>
    <label className="channel-sidebar__search">
      <Search size={14} aria-hidden="true" />
      <span className="sr-only">Search channels and active threads</span>
      <input ref={searchInputRef} autoFocus={autoFocusSearch} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels" />
      {query && <button type="button" aria-label="Clear channel search" onClick={() => setQuery('')}><X size={13} /></button>}
    </label>

    {channels.length > 0 && <nav className="channel-sidebar__list" aria-label="Channels">
      {channels.map((channel) => {
        const unread = isActivityUnread(activity[channel.id]?.latestActivity, readState.channels[channel.id])
        return <button key={channel.id} type="button" className={channel.id === selectedChannelId ? 'is-active' : ''} aria-current={channel.id === selectedChannelId ? 'page' : undefined} onClick={() => onSelectChannel(channel.id)}>
        <Hash size={14} aria-hidden="true" /><span><strong>{channel.name}</strong><small>{channel.description}</small></span>{unread && <i className="channel-sidebar__unread" aria-label={`${channel.name} has new activity`} />}
        </button> })}
    </nav>}

    {activeThreads.length > 0 && <section className="channel-sidebar__threads" aria-label="Active Threads">
      <div className="channel-sidebar__section-heading"><span>ACTIVE THREADS</span><small>{activeThreads.length}</small></div>
      {activeThreads.map((thread) => {
        const threadKey = `${thread.channelId}:${thread.parentId}`
        const unread = isActivityUnread(thread.latestActivity, readState.threads[threadKey])
        return <button key={threadKey} type="button" onClick={() => { onReadThread(thread.channelId, thread.parentId, thread.latestActivity); onOpenThread(thread.channelId, thread.parentId) }}>
        <MessageCircle size={14} aria-hidden="true" /><span><strong>{thread.title}</strong><small>#{thread.channelId} · {thread.replyCount} replies · {relativeTime(thread.latestActivity)}</small><em>{thread.preview}</em></span>{unread && <i className="channel-sidebar__unread" aria-label={`${thread.title} has new activity`} />}
        </button> })}
    </section>}

    {!hasResults && <div className="channel-sidebar__empty" role="status"><Search size={18} /><strong>No matches</strong><p>Try a channel name, description, or active thread.</p></div>}
    <a className="channel-sidebar__canonical" href={channelPath(selectedChannelId)}>#{selectedChannelId}</a>
  </div>
}
