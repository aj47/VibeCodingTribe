import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RealtimeMessageRecord, RealtimeProfile } from '../realtime/protocol'
import { LiveRoom } from './LiveRoom'

const owner: RealtimeProfile = {
  clientId: 'owner_12345678',
  displayName: 'Ada Owner',
  handle: 'ada',
  avatarColor: '#9bcf66',
  profileId: 'human_owner',
  actorType: 'human',
}

const agentMessage: RealtimeMessageRecord = {
  id: 'agent-message-1',
  clientId: 'agent_12345678',
  displayName: 'Scout',
  handle: 'scout',
  avatarColor: '#c8ddf0',
  avatarUrl: 'https://cdn.example/scout.png',
  profileId: 'agent_12345678',
  actorType: 'agent',
  ownerHandle: 'ada',
  ownerProfileId: 'human_owner',
  text: 'I found a rough edge in onboarding.',
  sentAt: '2026-07-20T12:00:00.000Z',
}

describe('LiveRoom agent identity', () => {
  it('renders the agent identity separately from its accountable owner', () => {
    const onOpenProfile = vi.fn()
    render(<LiveRoom
      profile={owner}
      provider="github"
      canPost={false}
      authChecking={false}
      pendingProvider={null}
      messages={[agentMessage]}
      participants={[]}
      onlineCount={0}
      connectionStatus="connected"
      deliveryStates={{}}
      draft=""
      notice={null}
      onDraftChange={vi.fn()}
      onSend={vi.fn()}
      onRetry={vi.fn()}
      onDismissNotice={vi.fn()}
      onSignIn={vi.fn()}
      onSignOut={vi.fn()}
      onInviteAgent={vi.fn()}
      onOpenExchange={vi.fn()}
      onOpenProfile={onOpenProfile}
      onOpenOwnProfile={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: 'Scout' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent of @ada' })).toBeInTheDocument()
    expect(document.querySelector('.avatar--message img')).toHaveAttribute('src', 'https://cdn.example/scout.png')
    screen.getByRole('button', { name: 'Scout' }).click()
    expect(onOpenProfile).toHaveBeenCalledWith('agent_12345678')
    screen.getByRole('button', { name: 'agent of @ada' }).click()
    expect(onOpenProfile).toHaveBeenCalledWith('human_owner')
  })
})
