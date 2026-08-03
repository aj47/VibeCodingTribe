import { describe, expect, it } from 'vitest'
import { handleAuthRequest, hasRecentAuthentication, linkedinProfileUrlFromClaims, type AuthEnv, type SessionClaims } from './auth'

const env: AuthEnv = {
  ALLOWED_ORIGINS: 'http://localhost:4173,https://vibecodingtribe.com',
  AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  LINKEDIN_CLIENT_ID: 'linkedin-client-id',
  LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
}

describe('OAuth routes', () => {
  it('turns available LinkedIn profile claims into a valid editable URL', () => {
    expect(linkedinProfileUrlFromClaims({ vanityName: 'ada-builder' })).toBe('https://www.linkedin.com/in/ada-builder')
    expect(linkedinProfileUrlFromClaims({ profile_url: 'https://www.linkedin.com/in/ada-builder' })).toBe('https://www.linkedin.com/in/ada-builder')
    expect(linkedinProfileUrlFromClaims({ profile_url: 'https://example.com/not-linkedin' })).toBeUndefined()
  })

  it('starts GitHub sign-in with state, PKCE, and identity-only scope', async () => {
    const response = await handleAuthRequest(
      new Request('https://worker.example/auth/github?returnTo=/r/general'),
      env,
    )

    expect(response?.status).toBe(302)
    const location = new URL(response!.headers.get('Location')!)
    expect(location.origin).toBe('https://github.com')
    expect(location.searchParams.get('scope')).toBe('read:user')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(response!.headers.get('Set-Cookie')).toContain('HttpOnly')
  })

  it('starts LinkedIn OIDC with basic profile scopes', async () => {
    const response = await handleAuthRequest(
      new Request('https://worker.example/auth/linkedin?returnTo=/r/general'),
      env,
    )

    expect(response?.status).toBe(302)
    const location = new URL(response!.headers.get('Location')!)
    expect(location.origin).toBe('https://www.linkedin.com')
    expect(location.searchParams.get('scope')).toBe('openid profile')
    expect(location.searchParams.get('enable_extended_login')).toBe('true')
    expect(location.searchParams.get('state')).toBeTruthy()
  })

  it('rejects an unconfigured provider without redirecting', async () => {
    const response = await handleAuthRequest(
      new Request('https://worker.example/auth/github'),
      { ...env, GITHUB_CLIENT_SECRET: undefined },
    )

    expect(response?.status).toBe(503)
  })

  it('requires a genuinely recent interactive sign-in for sensitive actions', () => {
    const claims: SessionClaims = {
      version: 2,
      accountId: 'human_123',
      provider: 'github',
      subject: '123',
      displayName: 'AJ',
      handle: 'aj',
      issuedAt: 1_000,
      authenticatedAt: 1_000,
      expiresAt: 100_000,
    }
    expect(hasRecentAuthentication(claims, 1_599)).toBe(true)
    expect(hasRecentAuthentication(claims, 1_601)).toBe(false)
  })
})
