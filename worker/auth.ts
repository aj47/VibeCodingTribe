import type { AuthProvider, AuthSession, AuthUser } from '../src/auth/types'
import { normalizeDisplayName, normalizeHandle } from '../src/realtime/protocol'
import type { AccountIdentity, HumanAccount } from './accounts'

export interface AuthEnv {
  ALLOWED_ORIGINS: string
  AUTH_APP_ORIGIN: string
  SESSION_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  LINKEDIN_CLIENT_ID?: string
  LINKEDIN_CLIENT_SECRET?: string
  ACCOUNTS?: DurableObjectNamespace
  EMAIL_UNSUBSCRIBE_ORIGIN?: string
}

interface ActivityDigestOptOutClaims {
  version: 1
  accountId: string
  preference: 'activityDigest'
  issuedAt: number
  expiresAt: number
}

export interface SessionClaims {
  version: 1 | 2
  accountId?: string
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
  linkAccountId?: string
}

const OAUTH_COOKIE = '__Host-vct_oauth'
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30
const ACTIVITY_DIGEST_OPT_OUT_LIFETIME_SECONDS = 60 * 60 * 24 * 30
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export async function activityDigestOptOutUrl(env: AuthEnv, accountId: string, now = Math.floor(Date.now() / 1000)) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is required for activity digest opt-out links')
  const token = await signValue({
    version: 1,
    accountId,
    preference: 'activityDigest',
    issuedAt: now,
    expiresAt: now + ACTIVITY_DIGEST_OPT_OUT_LIFETIME_SECONDS,
  } satisfies ActivityDigestOptOutClaims, env.SESSION_SECRET)
  const origin = env.EMAIL_UNSUBSCRIBE_ORIGIN ?? env.AUTH_APP_ORIGIN
  const url = new URL('/notifications/activity-digest/unsubscribe', origin)
  url.searchParams.set('token', token)
  return url.toString()
}

async function activityDigestOptOutClaims(request: Request, env: AuthEnv) {
  if (!env.SESSION_SECRET) return null
  const token = new URL(request.url).searchParams.get('token')
  if (!token) return null
  const claims = await verifyValue<ActivityDigestOptOutClaims>(token, env.SESSION_SECRET)
  return claims && claims.version === 1 && claims.preference === 'activityDigest' && claims.accountId && claims.expiresAt > Math.floor(Date.now() / 1000)
    ? { claims, token }
    : null
}

function activityDigestOptOutPage(token: string, confirmed = false) {
  const safeToken = escapeHtml(token)
  const heading = confirmed ? 'Daily activity digests are off' : 'Stop daily activity digests?'
  const copy = confirmed
    ? 'You will no longer receive Vibe Coding Tribe daily activity digests. Your account and essential service emails are unchanged.'
    : 'This stops only daily activity digests. Your account and essential service emails are unchanged.'
  return new Response(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head><body style="margin:0;background:#f4f7f4;color:#17251d;font-family:Arial,sans-serif"><main style="max-width:540px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #d7e1d7;border-radius:12px"><p style="font-size:12px;letter-spacing:.12em;color:#66806c">VIBE CODING TRIBE</p><h1>${heading}</h1><p style="line-height:1.55">${copy}</p>${confirmed ? '<p>You can turn them back on anytime from your signed-in profile.</p>' : `<form method="post"><input type="hidden" name="token" value="${safeToken}"><button type="submit" style="padding:10px 14px;border:0;border-radius:6px;background:#2e6d4f;color:#fff;font-weight:700;cursor:pointer">Stop daily activity digests</button></form>`}</main></body></html>`, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' },
  })
}

async function handleActivityDigestOptOut(request: Request, env: AuthEnv) {
  const verified = await activityDigestOptOutClaims(request, env)
  if (!verified) return new Response('This activity-digest link is invalid or has expired.', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  if (request.method === 'GET') return activityDigestOptOutPage(verified.token)
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const response = await accountRequest(env, '/notification-preferences', { accountId: verified.claims.accountId, activityDigest: false }, 'PATCH')
  if (!response.ok) return new Response('We could not update your activity-digest preference. Please try again.', { status: 500, headers: { 'Cache-Control': 'no-store' } })
  return activityDigestOptOutPage(verified.token, true)
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
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
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
  return value === '/exchange'
    || value === '/invite-agent'
    || value === '/settings/profile'
    || value.startsWith('/r/')
    || value.startsWith('/agents/authorize/')
    ? value.slice(0, 240)
    : '/exchange'
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

async function startOAuth(request: Request, env: AuthEnv, provider: AuthProvider, linkAccountId?: string) {
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
    ...(linkAccountId ? { linkAccountId } : {}),
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
    authorizationUrl.searchParams.set('enable_extended_login', 'true')
  }
  if (linkAccountId) {
    const signedAttempt = await signValue({ ...attempt, state: 'signed-link' }, env.SESSION_SECRET)
    authorizationUrl.searchParams.set('state', signedAttempt)
    return authJson(request, env, { authorizationUrl: authorizationUrl.toString() })
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
  profileUrl?: string
}

export function linkedinProfileUrlFromClaims(value: { profile?: unknown; profile_url?: unknown; vanityName?: unknown; vanity_name?: unknown }) {
  const direct = [value.profile, value.profile_url].find((candidate): candidate is string => typeof candidate === 'string')
  if (direct) {
    try {
      const url = new URL(direct)
      if (url.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(url.hostname)) return url.toString()
    } catch {
      // Fall through to a vanity name when the provider claim is not a URL.
    }
  }
  const vanity = [value.vanityName, value.vanity_name].find((candidate): candidate is string => typeof candidate === 'string')?.trim()
  return vanity && /^[a-zA-Z0-9-]{1,100}$/.test(vanity) ? `https://www.linkedin.com/in/${vanity}` : undefined
}

async function linkedinProfileUrl(accessToken: string, user: { profile?: unknown; profile_url?: unknown; vanityName?: unknown; vanity_name?: unknown }) {
  const fromUserInfo = linkedinProfileUrlFromClaims(user)
  if (fromUserInfo) return fromUserInfo
  try {
    const response = await fetch('https://api.linkedin.com/v2/me?projection=(vanityName)', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return undefined
    const profile = await response.json() as { vanityName?: unknown; vanity_name?: unknown }
    return linkedinProfileUrlFromClaims(profile)
  } catch {
    return undefined
  }
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
  const user = await userResponse.json() as { id?: number; login?: string; name?: string; avatar_url?: string; html_url?: string }
  if (!userResponse.ok || !user.id || !user.login) throw new Error('GitHub profile lookup failed')
  return {
    subject: String(user.id),
    displayName: normalizeDisplayName(user.name || user.login),
    handle: normalizeHandle(user.login),
    ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
    ...(user.html_url ? { profileUrl: user.html_url } : {}),
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
  const user = await userResponse.json() as { sub?: string; name?: string; picture?: string; email?: string; profile?: unknown; profile_url?: unknown; vanityName?: unknown; vanity_name?: unknown }
  if (!userResponse.ok || !user.sub || !user.name) throw new Error('LinkedIn profile lookup failed')
  const profileUrl = await linkedinProfileUrl(token.access_token, user)
  return {
    subject: user.sub,
    displayName: normalizeDisplayName(user.name),
    handle: normalizeHandle(`li-${user.sub.slice(-18)}`),
    ...(user.picture ? { avatarUrl: user.picture } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(profileUrl ? { profileUrl } : {}),
  }
}

function errorRedirect(env: AuthEnv, returnTo: string, message: string) {
  const target = new URL(returnTo, env.AUTH_APP_ORIGIN)
  target.searchParams.set('auth_error', message.slice(0, 120))
  return target.toString()
}

async function finishOAuth(request: Request, env: AuthEnv, provider: AuthProvider) {
  if (!env.SESSION_SECRET) return authJson(request, env, { error: 'Authentication is not configured' }, 503)
  const url = new URL(request.url)
  const stateValue = url.searchParams.get('state')
  const cookieAttemptToken = cookieValue(request, OAUTH_COOKIE)
  const [stateAttempt, cookieAttempt] = await Promise.all([
    stateValue ? verifyValue<OAuthAttempt>(stateValue, env.SESSION_SECRET) : null,
    cookieAttemptToken ? verifyValue<OAuthAttempt>(cookieAttemptToken, env.SESSION_SECRET) : null,
  ])
  const attempt = stateAttempt?.state === 'signed-link' ? stateAttempt : cookieAttempt
  const fallbackReturnTo = '/exchange'
  const validState = attempt?.state === 'signed-link' ? Boolean(stateAttempt) : attempt?.state === stateValue
  if (!attempt || attempt.provider !== provider || attempt.expiresAt < Date.now() || !validState) {
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

  let stage = 'provider identity'
  try {
    const identity = provider === 'github'
      ? await githubIdentity(code, attempt, request, env)
      : await linkedInIdentity(code, request, env)
    let accountId = `${provider}:${identity.subject}`
    let account: HumanAccount | undefined
    if (env.ACCOUNTS) {
      stage = 'account resolution'
      const accountResponse = await accountRequest(env, '/identity/resolve', {
        identity: { provider, ...identity } satisfies AccountIdentity,
        ...(attempt.linkAccountId ? { accountId: attempt.linkAccountId } : {}),
      })
      if (!accountResponse.ok) {
        const detail = await accountResponse.json().catch(() => ({})) as { error?: string }
        throw new Error(detail.error || 'Account linking failed')
      }
      const resolved = await accountResponse.json() as { account: HumanAccount }
      account = resolved.account
      accountId = account.id
    }
    stage = 'session issuance'
    const now = Math.floor(Date.now() / 1000)
    const claims: SessionClaims = {
      version: env.ACCOUNTS ? 2 : 1,
      ...(env.ACCOUNTS ? { accountId } : {}),
      subject: identity.subject,
      provider,
      displayName: account?.displayName ?? identity.displayName,
      handle: account?.handle ?? identity.handle,
      ...(account?.avatarUrl || identity.avatarUrl ? { avatarUrl: account?.avatarUrl ?? identity.avatarUrl } : {}),
      ...(account?.email || identity.email ? { email: account?.email ?? identity.email } : {}),
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
  } catch (error) {
    console.error('OAuth callback failed', {
      provider,
      stage,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
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
  if (!claims || ![1, 2].includes(claims.version) || claims.expiresAt <= Math.floor(Date.now() / 1000)) return null
  if (!['github', 'linkedin'].includes(claims.provider) || !claims.subject || !claims.displayName) return null
  return claims
}

export async function realtimeClientId(claims: SessionClaims) {
  const identity = claims.accountId ?? `${claims.provider}:${claims.subject}`
  const digest = base64UrlEncode(await sha256(identity)).slice(0, 32)
  return `human_${digest}`
}

function accountStub(env: AuthEnv) {
  if (!env.ACCOUNTS) return null
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('vibecodingtribe.com/accounts'))
}

export function accountRequest(env: AuthEnv, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const stub = accountStub(env)
  if (!stub) return Promise.resolve(Response.json({ error: 'Account storage is not configured' }, { status: 503 }))
  return stub.fetch(new Request(`https://accounts.internal${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }))
}

async function publicUser(claims: SessionClaims, env: AuthEnv): Promise<AuthUser> {
  if (claims.accountId && env.ACCOUNTS) {
    const response = await accountRequest(env, `/profile?accountId=${encodeURIComponent(claims.accountId)}`)
    if (response.ok) {
      const { account } = await response.json() as { account: HumanAccount }
      return {
        id: account.id,
        provider: claims.provider,
        displayName: account.displayName,
        handle: account.handle,
        realtimeClientId: account.realtimeClientId,
        ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
        ...(account.email ? { email: account.email } : {}),
        ...(account.headline ? { headline: account.headline } : {}),
        ...(account.githubUrl ? { githubUrl: account.githubUrl } : {}),
        ...(account.linkedinUrl ? { linkedinUrl: account.linkedinUrl } : {}),
        linkedProviders: account.linkedProviders,
      }
    }
  }
  return {
    id: claims.accountId ?? `${claims.provider}:${claims.subject}`,
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
  if (url.pathname === '/notifications/activity-digest/unsubscribe') return handleActivityDigestOptOut(request, env)
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/auth/')) {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }
  const match = url.pathname.match(/^\/auth\/(github|linkedin)(\/callback)?$/)
  if (match && request.method === 'GET') {
    const provider = match[1] as AuthProvider
    return match[2] ? finishOAuth(request, env, provider) : startOAuth(request, env, provider)
  }
  const linkMatch = url.pathname.match(/^\/auth\/link\/(github|linkedin)$/)
  if (linkMatch && request.method === 'GET') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return authJson(request, env, { error: 'Authentication required' }, 401)
    return startOAuth(request, env, linkMatch[1] as AuthProvider, claims.accountId ?? `${claims.provider}:${claims.subject}`)
  }
  if (url.pathname === '/auth/session' && request.method === 'GET') {
    let claims = await authenticateRequest(request, env)
    if (!claims) return authJson(request, env, { error: 'Authentication required' }, 401)
    if (!claims.accountId && env.ACCOUNTS) {
      const migrated = await accountRequest(env, '/identity/resolve', {
        identity: {
          provider: claims.provider,
          subject: claims.subject,
          displayName: claims.displayName,
          handle: claims.handle,
          ...(claims.avatarUrl ? { avatarUrl: claims.avatarUrl } : {}),
          ...(claims.email ? { email: claims.email } : {}),
        } satisfies AccountIdentity,
      })
      if (migrated.ok) {
        const { account } = await migrated.json() as { account: HumanAccount }
        claims = { ...claims, version: 2, accountId: account.id }
      }
    }
    const now = Math.floor(Date.now() / 1000)
    const refreshedClaims: SessionClaims = {
      ...claims,
      issuedAt: now,
      expiresAt: now + SESSION_LIFETIME_SECONDS,
    }
    const session: AuthSession = {
      user: await publicUser(claims, env),
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
