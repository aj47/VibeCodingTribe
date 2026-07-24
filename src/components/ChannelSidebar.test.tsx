import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { findActiveThreads, sortCommunityChannels } from '../community/channel-navigation'
import type { RealtimeMessageRecord } from '../realtime/protocol'
import { ChannelSidebar } from './ChannelSidebar'

const base = { clientId: 'client_12345678', displayName: 'Builder', handle: 'builder', avatarColor: '#657c54' }
const messages: RealtimeMessageRecord[] = [
  { ...base, id: 'general_parent_1', channelId: 'general', text: 'General onboarding conversation', sentAt: '2026-07-24T10:00:00.000Z' },
  { ...base, id: 'general_reply_1', channelId: 'general', parentId: 'general_parent_1', text: 'one', sentAt: '2026-07-24T10:01:00.000Z' },
  { ...base, id: 'general_reply_2', channelId: 'general', parentId: 'general_parent_1', text: 'two', sentAt: '2026-07-24T10:02:00.000Z' },
  { ...base, id: 'general_reply_3', channelId: 'general', parentId: 'general_parent_1', text: 'three', sentAt: '2026-07-24T10:03:00.000Z' },
  { ...base, id: 'general_parent_2', channelId: 'general', text: 'Later launch conversation', sentAt: '2026-07-24T10:04:00.000Z' },
  { ...base, id: 'general_reply_4', channelId: 'general', parentId: 'general_parent_2', text: 'one', sentAt: '2026-07-24T10:08:00.000Z' },
  { ...base, id: 'general_reply_5', channelId: 'general', parentId: 'general_parent_2', text: 'two', sentAt: '2026-07-24T10:09:00.000Z' },
  { ...base, id: 'general_reply_6', channelId: 'general', parentId: 'general_parent_2', text: 'three', sentAt: '2026-07-24T10:10:00.000Z' },
  { ...base, id: 'feedback_parent_1', channelId: 'feedback', text: 'Feedback-only conversation', sentAt: '2026-07-24T11:00:00.000Z' },
  { ...base, id: 'feedback_reply_1', channelId: 'feedback', parentId: 'feedback_parent_1', text: 'one', sentAt: '2026-07-24T11:01:00.000Z' },
  { ...base, id: 'feedback_reply_2', channelId: 'feedback', parentId: 'feedback_parent_1', text: 'two', sentAt: '2026-07-24T11:02:00.000Z' },
  { ...base, id: 'feedback_reply_3', channelId: 'feedback', parentId: 'feedback_parent_1', text: 'three', sentAt: '2026-07-24T11:03:00.000Z' },
]

describe('ChannelSidebar', () => {
  it('surfaces only threads at the three-reply threshold and orders newest first', () => {
    const fourReplyMessages = [...messages, { ...base, id: 'general_reply_7', channelId: 'general' as const, parentId: 'general_parent_1', text: 'four', sentAt: '2026-07-24T10:11:00.000Z' }]
    expect(findActiveThreads(fourReplyMessages, 'general')).toEqual(expect.arrayContaining([expect.objectContaining({ parentId: 'general_parent_1', replyCount: 4 })]))
    expect(findActiveThreads(messages, 'general').map((thread) => thread.parentId)).toEqual(['general_parent_2', 'general_parent_1'])
    expect(findActiveThreads(messages, 'feedback')).toHaveLength(1)
  })

  it('uses newest activity first with deterministic alphabetical fallback', () => {
    expect(sortCommunityChannels({ general: { latestActivity: '2026-07-24T10:00:00.000Z' }, feedback: { latestActivity: '2026-07-24T12:00:00.000Z' } }).map((channel) => channel.id)).toEqual(['feedback', 'general', 'showcases'])
    expect(sortCommunityChannels().map((channel) => channel.id)).toEqual(['feedback', 'general', 'showcases'])
  })

  it('supports keyboard-friendly search, thread navigation, and honest unread markers', () => {
    const onOpenThread = vi.fn()
    render(<ChannelSidebar selectedChannelId="general" activity={{ general: { latestActivity: '2026-07-24T10:03:00.000Z' } }} messages={messages} readState={{ channels: {}, threads: {} }} onSelectChannel={vi.fn()} onOpenThread={onOpenThread} onReadThread={vi.fn()} />)

    expect(screen.getByLabelText('General has new activity')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search channels and active threads' }), { target: { value: 'onboarding' } })
    expect(screen.getAllByText('General onboarding conversation').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('General onboarding conversation')[0]!)
    expect(onOpenThread).toHaveBeenCalledWith('general', 'general_parent_1')
  })

  it('does not leak a different channel thread into the current sidebar', () => {
    render(<ChannelSidebar selectedChannelId="general" activity={{}} messages={messages} readState={{ channels: {}, threads: {} }} onSelectChannel={vi.fn()} onOpenThread={vi.fn()} onReadThread={vi.fn()} />)
    expect(screen.getAllByText('General onboarding conversation').length).toBeGreaterThan(0)
    expect(screen.queryByText('Feedback-only conversation')).not.toBeInTheDocument()
  })
})
