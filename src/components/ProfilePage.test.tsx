import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../auth/types'
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
      linkedProviders: ['github'],
      badges: [],
    },
  })),
  loadPublicProfile: vi.fn(),
  updateOwnProfile: vi.fn(),
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
})
