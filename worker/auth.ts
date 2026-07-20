import type { AuthProvider, AuthSession, AuthUser } from '../src/auth/types'
import { normalizeDisplayName, normalizeHandle } from '../src/realtime/protocol'

export interface AuthEnv {
  ALLOWED_ORIGINS: string
  AUTH_APP_ORIGIN: string
  SESSION_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  LINKEDIN_CLIENT_ID?: string
  LINKEDIN_CLIENT_SECRET?: string
}

export interface SessionClaims {
  version: 1
  subject: string
  provider: AuthProvider
  displayName: string
  handle: string
  avatarUrl?: string
  email?: string
  issuedAt: number
  expiresAt: number
}

interface OAuthAttempt {
  provider: AuthProvider
  state: string
  returnTo: string
  expiresAt: number
  codeVerifier?: string
}

const OAUTH_COOKIE = '__Host-vct_oauth'
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30
const encoder = new TextEncoder()

function base64UrlEncode(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomToken(byteLength = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

async function signValue(value: unknown, secret: string) {
  const body = base64UrlEncode(JSON.stringify(value))
  return `${body}.${base64UrlEncode(await hmac(secret, body))}`
}

async function verifyValue<T>(token: string, secret: string): Promise<T | null> {
  const [body, signature, ...rest] = token.split('.')
  if (!body || !signature || rest.length) return null
  try {
    const expected = await hmac(secret, body)
    const actual = base64UrlDecode(signature)
    if (expected.byteLength !== actual.byteLength) return null
    let difference = 0
    for (let index = 0; index < expected.byteLength; index += 1) difference |= expected[index]! ^ actual[index]!
    if (difference !== 0) return null
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as T
  } catch {
    return null
  }
}

function allowedOrigins(env: AuthEnv) {
  return env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
}

function isAllowedOrigin(origin: string | null, env: AuthEnv) {
  if (!origin) return false
  try {
    const hostname = new URL(origin).hostname
    return hostname === 'vibecodingtribe.pages.dev'
      || hostname.endsWith('.vibecodingtribe.pages.dev')
      || allowedOrigins(env).includes(origin)
  } catch {
    return false
  }
}

function corsHeaders(request: Request, env: AuthEnv) {
  const headers = new Headers()
  const origin = request.headers.get('Origin')
  if (!isAllowedOrigin(origin, env)) return headers
  headers.set('Access-Control-Allow-Origin', origin!)
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
  return headers
}

function authJson(request: Request, env: AuthEnv, value: unknown, status = 200) {
  const headers = corsHeaders(request, env)
  headers.set('Cache-Control', 'no-store')
  return Response.json(value, {
    status,
    headers,
  })
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get('Cookie')?.split(';') ?? []
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=')
    if (key === name) return parts.join('=')
  }
  return null
}

function oauthCookie(value: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${OAUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/exchange'
  return value === '/exchange' || value.startsWith('/r/') ? value.slice(0, 240) : '/exchange'
}

function providerCredentials(provider: AuthProvider, env: AuthEnv) {
  return provider === 'github'
    ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
    : { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET }
}

function callbackUrl(request: Request, provider: AuthProvider) {
  return `${new URL(request.url).origin}/auth/${provider}/callback`
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function startOAuth(request: Request, env: AuthEnv, provider: AuthProvider) {
  if (!env.SESSION_SECRET) return authJson(request, env, { error: 'Authentication is not configured' }, 503)
  const credentials = providerCredentials(provider, env)
  if (!credentials.clientId || !credentials.clientSecret) {
    return authJson(request, env, { error: `${provider} authentication is not configured` }, 503)
  }

  const requestUrl = new URL(request.url)
  const state = randomToken()
  const codeVerifier = provider === 'github' ? randomToken(48) : undefined
  const attempt: OAuthAttempt = {
    provider,
    state,
    returnTo: safeReturnTo(requestUrl.searchParams.get('returnTo')),
    expiresAt: Date.now() + 10 * 60 * 1000,
    ...(codeVerifier ? { codeVerifier } : {}),
  }
  const cookie = await signValue(attempt, env.SESSION_SECRET)
  const authorizationUrl = provider === 'github'
    ? new URL('https://github.com/login/oauth/authorize')
    : new URL('https://www.linkedin.com/oauth/v2/authorization')
  authorizationUrl.searchParams.set('client_id', credentials.clientId)
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl(request, provider))
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('state', state)
  if (provider === 'github' && codeVerifier) {
    authorizationUrl.searchParams.set('scope', 'read:user')
    authorizationUrl.searchParams.set('code_challenge', base64UrlEncode(await sha256(codeVerifier)))
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  } else {
    authorizationUrl.searchParams.set('scope', 'openid profile')
  }
  return new Response(null, {
    status: 302,
    headers: { Location: authorizationUrl.toString(), 'Set-Cookie': oauthCookie(cookie, request, 600), 'Cache-Control': 'no-store' },
  })
}

interface ProviderIdentity {
  subject: string
  displayName: string
  handle: string
  avatarUrl?: string
  email?: string
}

async function githubIdentity(code: string, attempt: OAuthAttempt, request: Request, env: AuthEnv): Promise<ProviderIdentity> {
  const credentials = providerCredentials('github', env)
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId!,
      client_secret: credentials.clientSecret!,
      code,
      redirect_uri: callbackUrl(request, 'github'),
      ...(attempt.codeVerifier ? { code_verifier: attempt.codeVerifier } : {}),
    }),
  })
  const token = await tokenResponse.json() as { access_token?: string; error?: string }
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error || 'GitHub token exchange failed')
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': 'VibeCodingTribe',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const user = await userResponse.json() as { id?: number; login?: string; name?: string; avatar_url?: string }
  if (!userResponse.ok || !user.id || !user.login) throw new Error('GitHub profile lookup failed')
  return {
    subject: String(user.id),
    displayName: normalizeDisplayName(user.name || user.login),
    handle: normalizeHandle(user.login),
    ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
  }
}

async function linkedInIdentity(code: string, request: Request, env: AuthEnv): Promise<ProviderIdentity> {
  const credentials = providerCredentials('linkedin', env)
  const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: credentials.clientId!,
      client_secret: credentials.clientSecret!,
      redirect_uri: callbackUrl(request, 'linkedin'),
    }),
  })
  const token = await tokenResponse.json() as { access_token?: string; error?: string }
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error || 'LinkedIn token exchange failed')
  const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const user = await userResponse.json() as { sub?: string; name?: string; picture?: string; email?: string }
  if (!userResponse.ok || !user.sub || !user.name) throw new Error('LinkedIn profile lookup failed')
  return {
    subject: user.sub,
    displayName: normalizeDisplayName(user.name),
    handle: normalizeHandle(`li-${user.sub.slice(-18)}`),
    ...(user.picture ? { avatarUrl: user.picture } : {}),
    ...(user.email ? { email: user.email } : {}),
  }
}

function errorRedirect(env: AuthEnv, returnTo: string, message: string) {
  const target = new URL(returnTo, env.AUTH_APP_ORIGIN)
  target.searchParams.set('auth_error', message.slice(0, 120))
  return target.toString()
}

async function finishOAuth(request: Request, env: AuthEnv, provider: AuthProvider) {
  if (!env.SESSION_SECRET) return authJson(request, env, { error: 'Authentication is not configured' }, 503)
  const signedAttempt = cookieValue(request, OAUTH_COOKIE)
  const attempt = signedAttempt ? await verifyValue<OAuthAttempt>(signedAttempt, env.SESSION_SECRET) : null
  const url = new URL(request.url)
  const fallbackReturnTo = '/exchange'
  if (!attempt || attempt.provider !== provider || attempt.expiresAt < Date.now() || attempt.state !== url.searchParams.get('state')) {
    return Response.redirect(errorRedirect(env, fallbackReturnTo, 'The sign-in attempt expired. Please try again.'), 302)
  }
  const code = url.searchParams.get('code')
  if (!code || url.searchParams.has('error')) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: errorRedirect(env, attempt.returnTo, 'Sign-in was cancelled.'),
        'Set-Cookie': oauthCookie('', request, 0),
      },
    })
  }

  try {
    const identity = provider === 'github'
      ? await githubIdentity(code, attempt, request, env)
      : await linkedInIdentity(code, request, env)
    const now = Math.floor(Date.now() / 1000)
    const claims: SessionClaims = {
      version: 1,
      subject: identity.subject,
      provider,
      displayName: identity.displayName,
      handle: identity.handle,
      ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
      ...(identity.email ? { email: identity.email } : {}),
      issuedAt: now,
      expiresAt: now + SESSION_LIFETIME_SECONDS,
    }
    const sessionToken = await signValue(claims, env.SESSION_SECRET)
    const target = new URL(attempt.returnTo, env.AUTH_APP_ORIGIN)
    target.hash = `vct_session=${sessionToken}`
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        'Set-Cookie': oauthCookie('', request, 0),
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        Location: errorRedirect(env, attempt.returnTo, `Could not complete ${provider} sign-in. Please try again.`),
        'Set-Cookie': oauthCookie('', request, 0),
      },
    })
  }
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get('Authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim()
  const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map((value) => value.trim()) ?? []
  const authProtocol = protocols.find((protocol) => protocol.startsWith('vct.auth.'))
  return authProtocol?.slice('vct.auth.'.length) ?? null
}

export async function authenticateRequest(request: Request, env: AuthEnv): Promise<SessionClaims | null> {
  if (!env.SESSION_SECRET) return null
  const token = tokenFromRequest(request)
  if (!token) return null
  const claims = await verifyValue<SessionClaims>(token, env.SESSION_SECRET)
  if (!claims || claims.version !== 1 || claims.expiresAt <= Math.floor(Date.now() / 1000)) return null
  if (!['github', 'linkedin'].includes(claims.provider) || !claims.subject || !claims.displayName) return null
  return claims
}

export async function realtimeClientId(claims: SessionClaims) {
  const digest = base64UrlEncode(await sha256(`${claims.provider}:${claims.subject}`)).slice(0, 32)
  return `${claims.provider}_${digest}`
}

async function publicUser(claims: SessionClaims): Promise<AuthUser> {
  return {
    id: `${claims.provider}:${claims.subject}`,
    provider: claims.provider,
    displayName: claims.displayName,
    handle: claims.handle,
    realtimeClientId: await realtimeClientId(claims),
    ...(claims.avatarUrl ? { avatarUrl: claims.avatarUrl } : {}),
    ...(claims.email ? { email: claims.email } : {}),
  }
}

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/auth/')) {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  const match = url.pathname.match(/^\/auth\/(github|linkedin)(\/callback)?$/)
  if (match && request.method === 'GET') {
    const provider = match[1] as AuthProvider
    return match[2] ? finishOAuth(request, env, provider) : startOAuth(request, env, provider)
  }
  if (url.pathname === '/auth/session' && request.method === 'GET') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return authJson(request, env, { error: 'Authentication required' }, 401)
    const now = Math.floor(Date.now() / 1000)
    const refreshedClaims: SessionClaims = {
      ...claims,
      issuedAt: now,
      expiresAt: now + SESSION_LIFETIME_SECONDS,
    }
    const session: AuthSession = {
      user: await publicUser(claims),
      expiresAt: new Date(refreshedClaims.expiresAt * 1000).toISOString(),
      sessionToken: await signValue(refreshedClaims, env.SESSION_SECRET!),
    }
    return authJson(request, env, session)
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  return null
}
