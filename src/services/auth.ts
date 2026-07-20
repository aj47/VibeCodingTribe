import type { AuthProvider, AuthSession } from '../auth/types'

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
