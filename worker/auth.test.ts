import { describe, expect, it, vi } from 'vitest'
import { activityDigestOptOutUrl, handleAuthRequest, linkedinProfileUrlFromClaims, type AuthEnv } from './auth'

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

  it('uses a signed, expiring recipient link to disable only daily activity digests', async () => {
    const accountFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/notification-preferences')
      expect(request.method).toBe('PATCH')
      expect(await request.json()).toEqual({ accountId: 'human_ada', activityDigest: false })
      return Response.json({ preferences: { activityDigest: false } })
    })
    const unsubscribeEnv: AuthEnv = {
      ...env,
      EMAIL_UNSUBSCRIBE_ORIGIN: 'https://worker.example',
      ACCOUNTS: { idFromName: () => 'accounts', get: () => ({ fetch: accountFetch }) } as unknown as DurableObjectNamespace,
    }
    const url = await activityDigestOptOutUrl(unsubscribeEnv, 'human_ada')
    const preview = await handleAuthRequest(new Request(url), unsubscribeEnv)
    expect(preview?.status).toBe(200)
    expect(await preview?.text()).toContain('Stop daily activity digests?')

    const confirmed = await handleAuthRequest(new Request(url, { method: 'POST' }), unsubscribeEnv)
    expect(confirmed?.status).toBe(200)
    expect(await confirmed?.text()).toContain('Daily activity digests are off')
    expect(accountFetch).toHaveBeenCalledOnce()

    const expired = await activityDigestOptOutUrl(unsubscribeEnv, 'human_ada', 0)
    expect((await handleAuthRequest(new Request(expired), unsubscribeEnv))?.status).toBe(400)
    const tampered = new URL(url)
    tampered.searchParams.set('token', `${tampered.searchParams.get('token')}x`)
    expect((await handleAuthRequest(new Request(tampered), unsubscribeEnv))?.status).toBe(400)
  })
})
