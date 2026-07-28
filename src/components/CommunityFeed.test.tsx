import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeMessageRecord, RealtimeProfile } from '../realtime/protocol'
import { CommunityFeed } from './CommunityFeed'

const profile: RealtimeProfile = {
  clientId: 'builder_12345678',
  displayName: 'Ada Builder',
  handle: 'ada',
  avatarColor: '#b9d6bd',
  profileId: 'human_ada',
}

const messages: RealtimeMessageRecord[] = [
  { ...profile, id: 'chat_12345678', channelId: 'general', text: 'Anyone building tonight?', sentAt: '2026-07-21T18:00:00.000Z', intent: 'chat' },
  { ...profile, id: 'showcase_12345678', channelId: 'general', text: 'I shipped the new onboarding.', sentAt: '2026-07-21T18:01:00.000Z', intent: 'showcase', buildName: 'Launchpad' },
  { ...profile, id: 'feedback_12345678', channelId: 'general', text: 'Does this value proposition make sense?', sentAt: '2026-07-21T18:02:00.000Z', intent: 'needs_feedback' },
  { ...profile, id: 'reply_12345678', channelId: 'general', text: 'The second line is very clear.', sentAt: '2026-07-21T18:03:00.000Z', parentId: 'feedback_12345678', commentKind: 'feedback' },
]

const noop = vi.fn()

describe('CommunityFeed post hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:pasted-image'),
      revokeObjectURL: vi.fn(),
    }))
  })

  it('separates chat, showcases, feedback requests, replies, and feedback', () => {
    const onOpenChannel = vi.fn()
    const { container } = render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={messages}
      participants={[{ ...profile, online: true }]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{ general: { latestActivity: '2026-07-21T18:03:00.000Z' } }}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={onOpenChannel}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    expect(screen.queryByRole('group', { name: 'Choose post type' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.community-post--chat')).toHaveLength(1)
    expect(container.querySelectorAll('.community-post--showcase')).toHaveLength(1)
    expect(container.querySelectorAll('.community-post--feedback')).toHaveLength(1)
    const feedbackPost = screen.getByText('Does this value proposition make sense?', { selector: 'article > p' }).closest('article')
    expect(feedbackPost).not.toBeNull()
    expect(within(feedbackPost as HTMLElement).getByText('Feedback request')).toBeInTheDocument()
    expect(within(feedbackPost as HTMLElement).getByText('Feedback', { selector: 'em' })).toBeInTheDocument()
    expect(within(feedbackPost as HTMLElement).getByRole('button', { name: /1 response/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /ShowcasesProgress, launches, and builds in public/ }))
    expect(onOpenChannel).toHaveBeenCalledWith('showcases')
  })

  it('renders a link preview image and metadata for shared URLs', () => {
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[{ ...messages[0], id: 'link_12345678', text: 'Review this build', linkPreview: {
        url: 'https://nativdocs.co/example',
        title: 'Native documents for builders',
        description: 'Share HTML and Markdown files with comments.',
        imageUrl: 'https://nativdocs.co/og.png',
        siteName: 'NativDocs',
      }}]}
      participants={[]}
      onlineCount={0}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    const preview = screen.getByRole('link', { name: 'Open link preview for Native documents for builders' })
    expect(preview).toHaveAttribute('href', 'https://nativdocs.co/example')
    expect(preview.querySelector('img')).toHaveAttribute('src', 'https://nativdocs.co/og.png')
    expect(within(preview).getByText('Share HTML and Markdown files with comments.')).toBeInTheDocument()
  })

  it('renders safe inline previews for supported video links and keeps the original URLs', () => {
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[
        { ...messages[0], id: 'youtube_12345678', text: 'Walkthrough https://youtu.be/dQw4w9WgXcQ' },
        { ...messages[0], id: 'vimeo_12345678', text: 'Demo https://vimeo.com/76979871', sentAt: '2026-07-21T18:04:00.000Z' },
        { ...messages[0], id: 'loom_12345678', text: 'Notes https://www.loom.com/share/abc123xyz', sentAt: '2026-07-21T18:05:00.000Z' },
      ]}
      participants={[]}
      onlineCount={0}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    expect(screen.getByTitle('YouTube video preview')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0')
    expect(screen.getByTitle('Vimeo video preview')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871')
    expect(screen.getByTitle('Loom video preview')).toHaveAttribute('src', 'https://www.loom.com/embed/abc123xyz')
    expect(screen.getByRole('link', { name: /YouTube video/ })).toHaveAttribute('href', 'https://youtu.be/dQw4w9WgXcQ')
    expect(screen.getByRole('link', { name: /Vimeo video/ })).toHaveAttribute('href', 'https://vimeo.com/76979871')
  })

  it('scrolls to and focuses a thread opened from active threads', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={messages}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      threadId="feedback_12345678"
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    const replyField = await screen.findByRole('textbox', { name: 'Reply to Ada Builder' })
    await waitFor(() => expect(replyField).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('renders at most three replies and collapses the middle replies', () => {
    const extraReplies: RealtimeMessageRecord[] = Array.from({ length: 4 }, (_, index) => ({
      ...profile,
      id: `extra_reply_${index}`,
      channelId: 'general',
      text: `Extra reply ${index}`,
      sentAt: `2026-07-21T18:0${4 + index}:00.000Z`,
      parentId: 'feedback_12345678',
      commentKind: 'reply',
    }))
    const { container } = render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[...messages, ...extraReplies]}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    expect(container.querySelectorAll('.community-reply')).toHaveLength(3)
    expect(screen.getByText('… 2 middle replies hidden …')).toBeInTheDocument()
  })

  it('accepts an image pasted into the composer and publishes an image-only post', async () => {
    const onSend = vi.fn()
    const onUploadImage = vi.fn(async () => 'https://media.example/pasted.png')
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[]}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      onSend={onSend}
      onToggleLike={noop}
      onUploadImage={onUploadImage}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)
    const file = new File(['image-bytes'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: 'Share what you are building' }), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
        getData: () => '',
      },
    })

    expect(screen.getByRole('img', { name: 'Pasted image preview' })).toHaveAttribute('src', 'blob:pasted-image')
    expect(screen.getByRole('button', { name: 'Remove pasted image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledWith(file))
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: '', imageUrl: 'https://media.example/pasted.png', intent: 'chat' }))
  })

  it('likes and unlikes posts and replies with accessible pressed states', () => {
    const onToggleLike = vi.fn()
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={messages.map((message) => message.id === 'chat_12345678'
        ? { ...message, likedByClientIds: ['builder_other'] }
        : message.id === 'reply_12345678' ? { ...message, likedByClientIds: [profile.clientId] } : message)}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{ general: { latestActivity: '2026-07-21T18:03:00.000Z' } }}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={onToggleLike}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    const chatPost = screen.getByText('Anyone building tonight?').closest('article')
    expect(chatPost).not.toBeNull()
    const likePost = within(chatPost as HTMLElement).getByRole('button', { name: 'Like post by Ada Builder' })
    expect(likePost).toHaveAttribute('aria-pressed', 'false')
    expect(likePost).toHaveTextContent('1')
    fireEvent.click(likePost)
    expect(onToggleLike).toHaveBeenCalledWith('chat_12345678', true)

    const unlikeReply = screen.getByRole('button', { name: 'Unlike response by Ada Builder' })
    expect(unlikeReply).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(unlikeReply)
    expect(onToggleLike).toHaveBeenCalledWith('reply_12345678', false)
  })

  it('falls back to initials when a profile image cannot load', () => {
    const brokenAvatarMessage = { ...messages[0], avatarUrl: 'https://cdn.example/broken.png' }
    const { container } = render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[brokenAvatarMessage]}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      channelId="general"
      channelActivity={{}}
      readState={{ channels: {}, threads: {} }}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenChannel={noop}
      onOpenThread={noop}
      onReadThread={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onOpenBadges={noop}
      onInviteAgent={noop}
    />)

    const avatar = container.querySelector('.community-post .community-avatar') as HTMLElement
    const image = avatar.querySelector('img') as HTMLImageElement
    fireEvent.error(image)
    expect(avatar.querySelector('span')).toHaveTextContent('AB')
    expect(image.style.display).toBe('none')
  })
})
