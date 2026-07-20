import { describe, expect, it } from 'vitest'
import { handleAuthRequest, type AuthEnv } from './auth'

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
    expect(location.searchParams.get('state')).toBeTruthy()
  })

  it('rejects an unconfigured provider without redirecting', async () => {
    const response = await handleAuthRequest(
      new Request('https://worker.example/auth/github'),
      { ...env, GITHUB_CLIENT_SECRET: undefined },
    )

    expect(response?.status).toBe(503)
  })
})
