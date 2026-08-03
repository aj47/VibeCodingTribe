import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../auth/types'
import { updateActivityDigestPreferences, updateOwnProfile } from '../services/auth'
import { ProfilePage } from './ProfilePage'

vi.mock('../services/auth', () => ({
  beginLinkOAuth: vi.fn(),
  loadOwnProfile: vi.fn(async () => ({
    profile: {
      id: 'human_ada',
      displayName: 'Ada Builder',
      handle: 'ada',
      realtimeClientId: 'human_ada_client',
      avatarUrl: 'https://cdn.example/ada.png',
      headline: 'Building in public',
      linkedinUrl: 'https://www.linkedin.com/in/ada-builder',
      linkedProviders: ['github', 'linkedin'],
      badges: [],
    },
  })),
  loadActivityDigestPreferences: vi.fn(async () => ({ preferences: { activityDigest: false } })),
  loadPublicProfile: vi.fn(async (profileId: string) => profileId === 'agent_unresolved' ? {
    id: 'agent_unresolved',
    displayName: 'Unresolved Scout',
    handle: 'unresolved-scout',
    avatarUrl: 'https://cdn.example/scout.png',
    actorType: 'agent' as const,
    ownerHandle: 'missing-owner',
    owner: undefined,
  } : {
    id: 'agent_scout',
    displayName: 'Scout',
    handle: 'scout',
    avatarUrl: 'https://cdn.example/scout.png',
    actorType: 'agent' as const,
    ownerHandle: 'ada',
    owner: {
      id: 'human_ada',
      displayName: 'Ada Builder',
      handle: 'ada',
      realtimeClientId: 'human_ada_client',
      linkedProviders: ['github'],
    },
  }),
  updateOwnProfile: vi.fn(async (input: Record<string, string>) => ({
    profile: {
      id: 'human_ada',
      displayName: input.displayName,
      handle: input.handle,
      realtimeClientId: 'human_ada_client',
      linkedProviders: ['github', 'linkedin'],
      ...input,
    },
  })),
  updateActivityDigestPreferences: vi.fn(async (input: { email?: string; activityDigest: boolean }) => ({ preferences: { activityDigest: input.activityDigest }, ...(input.email ? { email: input.email } : {}) })),
}))

const session: AuthSession = {
  user: {
    id: 'human_ada',
    provider: 'github',
    displayName: 'Ada Builder',
    handle: 'ada',
    realtimeClientId: 'human_ada_client',
  },
  expiresAt: '2026-08-01T00:00:00.000Z',
}

describe('ProfilePage focused routes', () => {
  it('renders the badges route as focused badge content instead of the profile editor', async () => {
    const { container } = render(<ProfilePage session={session} badgesOnly onBack={vi.fn()} onSignIn={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Builder badges' })).toBeInTheDocument())
    expect(screen.queryByRole('textbox', { name: 'Display name' })).not.toBeInTheDocument()
    expect(container.querySelector('.profile-sheet__avatar')).toHaveClass('profile-sheet__avatar')
    expect(container.querySelector('.profile-sheet__avatar img')).toHaveAttribute('src', 'https://cdn.example/ada.png')
  })

  it('restores the editable handle and keeps the LinkedIn profile prefilled', async () => {
    const onProfileUpdated = vi.fn()
    render(<ProfilePage session={session} onBack={vi.fn()} onSignIn={vi.fn()} onProfileUpdated={onProfileUpdated} />)

    const handle = await screen.findByRole('textbox', { name: 'Handle' })
    expect(handle).toHaveValue('ada')
    expect(screen.getByRole('textbox', { name: /LinkedIn profile/ })).toHaveValue('https://www.linkedin.com/in/ada-builder')

    fireEvent.change(handle, { target: { value: 'ada-builder' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')!)

    await waitFor(() => expect(updateOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ handle: 'ada-builder' })))
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ handle: 'ada-builder' }))
  })

  it('requires a member-confirmed address and opt-in for daily activity digests', async () => {
    render(<ProfilePage session={session} onBack={vi.fn()} onSignIn={vi.fn()} />)
    const email = await screen.findByRole('textbox', { name: 'Email address' })
    const enabled = screen.getByRole('checkbox', { name: 'Send me daily activity digests' })
    expect(enabled).not.toBeChecked()
    fireEvent.change(email, { target: { value: 'ada@example.com' } })
    fireEvent.click(enabled)
    fireEvent.click(screen.getByRole('button', { name: 'Save digest settings' }))
    await waitFor(() => expect(updateActivityDigestPreferences).toHaveBeenCalledWith({ email: 'ada@example.com', activityDigest: true }))
  })

  it('links a resolved agent owner to the stable human profile route', async () => {
    render(<ProfilePage session={session} profileId="agent_scout" onBack={vi.fn()} onSignIn={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Scout' })).toBeInTheDocument())
    const ownerLinks = screen.getAllByRole('link', { name: 'Ada Builder · @ada' })
    expect(ownerLinks).toHaveLength(1)
    expect(ownerLinks[0]).toHaveAttribute('href', '/p/human_ada')
    expect(screen.getByRole('link', { name: '@ada' })).toHaveAttribute('href', '/p/human_ada')
  })

  it('keeps unresolved agent owners as plain text without a dead link', async () => {
    render(<ProfilePage session={session} profileId="agent_unresolved" onBack={vi.fn()} onSignIn={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unresolved Scout' })).toBeInTheDocument())
    expect(screen.getAllByText('@missing-owner')).toHaveLength(2)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
