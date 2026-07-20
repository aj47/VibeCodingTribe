import type { AgentCredentialSummary, AgentEnrollment, AuthProvider, AuthSession, PublicHumanProfile, PublicProfile } from '../auth/types'

const SESSION_TOKEN_KEY = 'vct-session-token-v1'
const PRODUCTION_ORIGIN = 'https://vibecodingtribe-realtime.techfren.workers.dev'

export function authOrigin() {
  const configured = import.meta.env.VITE_REALTIME_ORIGIN?.trim()
  const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  return configured || (isLocal ? 'http://localhost:8787' : PRODUCTION_ORIGIN)
}

export function consumeAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = hash.get('vct_session')
  if (!token) return getSessionToken()
  window.localStorage.setItem(SESSION_TOKEN_KEY, token)
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY)
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)
  return token
}

export function getSessionToken() {
  const persistentToken = window.localStorage.getItem(SESSION_TOKEN_KEY)
  if (persistentToken) return persistentToken
  const legacyToken = window.sessionStorage.getItem(SESSION_TOKEN_KEY)
  if (!legacyToken) return null
  window.localStorage.setItem(SESSION_TOKEN_KEY, legacyToken)
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY)
  return legacyToken
}

export function clearAuthSession() {
  window.localStorage.removeItem(SESSION_TOKEN_KEY)
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY)
}

export function beginOAuth(provider: AuthProvider, returnTo = '/exchange') {
  const url = new URL(`/auth/${provider}`, authOrigin())
  url.searchParams.set('returnTo', returnTo)
  window.location.assign(url.toString())
}

export async function beginLinkOAuth(provider: AuthProvider, returnTo = '/settings/profile') {
  const token = getSessionToken()
  if (!token) throw new Error('Sign in before linking another account')
  const url = new URL(`/auth/link/${provider}`, authOrigin())
  url.searchParams.set('returnTo', returnTo)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, mode: 'cors' })
  const result = await response.json() as { authorizationUrl?: string; error?: string }
  if (!response.ok || !result.authorizationUrl) throw new Error(result.error || 'Could not start account linking')
  window.location.assign(result.authorizationUrl)
}

async function authenticatedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken()
  if (!token) throw new Error('Authentication required')
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(new URL(path, authOrigin()), { ...init, headers, mode: 'cors' })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}

export async function loadOwnProfile() {
  return authenticatedJson<{ profile: PublicHumanProfile }>('/api/profile')
}

export async function updateOwnProfile(input: Pick<PublicHumanProfile, 'displayName'> & Partial<Pick<PublicHumanProfile, 'headline' | 'githubUrl' | 'linkedinUrl'>>) {
  return authenticatedJson<{ profile: PublicHumanProfile }>('/api/profile', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function loadPublicProfile(profileId: string) {
  const response = await fetch(new URL(`/api/profiles/${encodeURIComponent(profileId)}`, authOrigin()), { mode: 'cors' })
  const result = await response.json() as { profile?: PublicProfile; error?: string }
  if (!response.ok || !result.profile) throw new Error(result.error || 'Profile not found')
  return result.profile
}

export async function loadAgentEnrollment(id: string) {
  const response = await fetch(new URL(`/api/agents/enrollments/${encodeURIComponent(id)}`, authOrigin()), { mode: 'cors' })
  const result = await response.json() as { enrollment?: AgentEnrollment; error?: string }
  if (!response.ok || !result.enrollment) throw new Error(result.error || 'Agent request not found')
  return result.enrollment
}

export async function authorizeAgentEnrollment(id: string) {
  return authenticatedJson<{ enrollment: AgentEnrollment; credential: AgentCredentialSummary }>(`/api/agents/enrollments/${encodeURIComponent(id)}/authorize`, { method: 'POST' })
}

export async function loadAgentCredentials() {
  return authenticatedJson<{ credentials: AgentCredentialSummary[] }>('/api/agents')
}

export async function changeAgentCredential(id: string, action: 'rotate' | 'revoke') {
  return authenticatedJson<{ credential: AgentCredentialSummary }>(`/api/agents/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
}

export async function loadAuthSession(token = getSessionToken()): Promise<AuthSession | null> {
  if (!token) return null
  try {
    const response = await fetch(new URL('/auth/session', authOrigin()), {
      headers: { Authorization: `Bearer ${token}` },
      mode: 'cors',
    })
    if (!response.ok) return null
    const session = await response.json() as AuthSession
    if (session.sessionToken) window.localStorage.setItem(SESSION_TOKEN_KEY, session.sessionToken)
    return session
  } catch {
    return null
  }
}

export function authErrorFromLocation() {
  const url = new URL(window.location.href)
  const error = url.searchParams.get('auth_error')
  if (!error) return null
  url.searchParams.delete('auth_error')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return error
}
