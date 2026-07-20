import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthSession, consumeAuthCallback, getSessionToken, loadAuthSession } from './auth'

const SESSION_TOKEN_KEY = 'vct-session-token-v1'

describe('persistent authentication', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
  })

  it('stores an OAuth callback session beyond the current tab session', () => {
    window.history.replaceState({}, '', '/r/general#vct_session=signed.session-token')

    expect(consumeAuthCallback()).toBe('signed.session-token')
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe('signed.session-token')
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('migrates the previous tab-only session into persistent storage', () => {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, 'legacy.session-token')

    expect(getSessionToken()).toBe('legacy.session-token')
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe('legacy.session-token')
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  it('removes persistent and legacy sessions on sign out', () => {
    window.localStorage.setItem(SESSION_TOKEN_KEY, 'persistent.session-token')
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, 'legacy.session-token')

    clearAuthSession()

    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  it('persists a refreshed session returned during validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      user: {
        id: 'github:47',
        provider: 'github',
        displayName: 'AJ',
        handle: 'aj47',
        realtimeClientId: 'github_client_12345678',
      },
      expiresAt: '2026-08-18T00:00:00.000Z',
      sessionToken: 'refreshed.thirty-day-token',
    })))

    const session = await loadAuthSession('existing.short-session')

    expect(session?.user.handle).toBe('aj47')
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe('refreshed.thirty-day-token')
  })
})
