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
  { ...profile, id: 'chat_12345678', text: 'Anyone building tonight?', sentAt: '2026-07-21T18:00:00.000Z', intent: 'chat' },
  { ...profile, id: 'showcase_12345678', text: 'I shipped the new onboarding.', sentAt: '2026-07-21T18:01:00.000Z', intent: 'showcase', buildName: 'Launchpad' },
  { ...profile, id: 'feedback_12345678', text: 'Does this value proposition make sense?', sentAt: '2026-07-21T18:02:00.000Z', intent: 'needs_feedback' },
  { ...profile, id: 'reply_12345678', text: 'The second line is very clear.', sentAt: '2026-07-21T18:03:00.000Z', parentId: 'feedback_12345678', commentKind: 'feedback' },
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
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onInviteAgent={noop}
    />)

    expect(screen.getByRole('button', { name: /Chat.*A quick thought or conversation/i })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('.community-post--chat')).toHaveLength(1)
    expect(container.querySelectorAll('.community-post--showcase')).toHaveLength(1)
    expect(container.querySelectorAll('.community-post--feedback')).toHaveLength(1)
    const feedbackPost = screen.getByText('Does this value proposition make sense?', { selector: 'article > p' }).closest('article')
    expect(feedbackPost).not.toBeNull()
    expect(within(feedbackPost as HTMLElement).getByText('Feedback request')).toBeInTheDocument()
    expect(within(feedbackPost as HTMLElement).getByText('Feedback', { selector: 'em' })).toBeInTheDocument()
    expect(within(feedbackPost as HTMLElement).getByRole('button', { name: /1 response/i })).toBeInTheDocument()
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
      onSend={onSend}
      onToggleLike={noop}
      onUploadImage={onUploadImage}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
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

  it('falls back to initials when a profile avatar cannot load', () => {
    const avatarProfile = { ...profile, avatarUrl: 'https://avatars.example/ada.png' }
    const { container } = render(<CommunityFeed
      profile={avatarProfile}
      provider="github"
      canPost
      authChecking={false}
      messages={[]}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      onSend={noop}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onInviteAgent={noop}
    />)

    const avatar = container.querySelector('.community-avatar') as HTMLElement
    const image = avatar.querySelector('img') as HTMLImageElement
    fireEvent.error(image)

    expect(avatar.querySelector('img')).not.toBeInTheDocument()
    expect(avatar).toHaveTextContent('AB')
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
      onSend={noop}
      onToggleLike={onToggleLike}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
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

  it('lets a user reply directly to a reply and renders nested responses', () => {
    const onSend = vi.fn()
    const nestedReply = { ...profile, id: 'nested_12345678', text: 'And test it on mobile.', sentAt: '2026-07-21T18:04:00.000Z', parentId: 'reply_12345678', commentKind: 'reply' as const }
    render(<CommunityFeed
      profile={profile}
      provider="github"
      canPost
      authChecking={false}
      messages={[...messages, nestedReply]}
      participants={[]}
      onlineCount={1}
      connectionStatus="connected"
      missionsOnly={false}
      onSend={onSend}
      onToggleLike={noop}
      onUploadImage={vi.fn(async () => 'https://media.example/image.png')}
      onSignIn={noop}
      onSignOut={noop}
      onOpenFeed={noop}
      onOpenMissions={noop}
      onOpenProfile={noop}
      onOpenOwnProfile={noop}
      onInviteAgent={noop}
    />)

    expect(screen.getByText('And test it on mobile.')).toBeInTheDocument()
    const replyButtons = screen.getAllByRole('button', { name: 'Reply to Ada Builder' })
    expect(replyButtons).toHaveLength(2)
    fireEvent.click(replyButtons[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to Ada Builder' }), { target: { value: 'I agree.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'I agree.', parentId: 'reply_12345678', commentKind: 'reply' }))
  })
})
