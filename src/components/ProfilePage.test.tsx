import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../auth/types'
import { updateOwnProfile } from '../services/auth'
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
  loadPublicProfile: vi.fn(),
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
    render(<ProfilePage session={session} onBack={vi.fn()} onSignIn={vi.fn()} />)

    const handle = await screen.findByRole('textbox', { name: 'Handle' })
    expect(handle).toHaveValue('ada')
    expect(screen.getByRole('textbox', { name: /LinkedIn profile/ })).toHaveValue('https://www.linkedin.com/in/ada-builder')

    fireEvent.change(handle, { target: { value: 'ada-builder' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')!)

    await waitFor(() => expect(updateOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ handle: 'ada-builder' })))
  })
})
