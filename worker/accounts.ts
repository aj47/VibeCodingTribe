import type { AuthProvider, ProfileBadgeAward, PublicAgentProfile, PublicHumanProfile } from '../src/auth/types'
import { normalizeHandle } from '../src/realtime/protocol'

export interface AccountIdentity {
  provider: AuthProvider
  subject: string
  displayName: string
  handle: string
  avatarUrl?: string
  email?: string
  profileUrl?: string
}

export interface HumanAccount extends PublicHumanProfile {
  email?: string
  identities: AccountIdentity[]
  agentCredentialIds: string[]
  createdAt: string
  updatedAt: string
  badges?: ProfileBadgeAward[]
}

interface AgentEnrollmentRecord {
  id: string
  name: string
  callbackUrl: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'authorized' | 'delivered' | 'failed'
  avatarUrl?: string
  ownerAccountId?: string
  deliveryError?: string
}

interface AgentCredentialRecord {
  id: string
  accountId: string
  name: string
  handle: string
  avatarUrl?: string
  callbackUrl: string
  keyPrefix: string
  secretHash: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
  rateWindowStartedAt: number
  rateWindowCount: number
}

export interface AgentAuthResult {
  agent: { id: string; name: string; handle: string; avatarUrl?: string }
  owner: PublicHumanProfile
  rateLimit: { limit: number; remaining: number; resetAt: string }
}

const ACCOUNT_PREFIX = 'account:'
const IDENTITY_PREFIX = 'identity:'
const ENROLLMENT_PREFIX = 'enrollment:'
const CREDENTIAL_PREFIX = 'credential:'
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const ENROLLMENT_LIMIT = 10
const ENROLLMENT_WINDOW_MS = 60 * 60_000
const encoder = new TextEncoder()

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function base64UrlEncode(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(bytes = 24) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(value: string) {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

async function realtimeId(accountId: string) {
  return `human_${(await sha256(accountId)).slice(0, 32)}`
}

function publicProfile(account: HumanAccount): PublicHumanProfile {
  const linkedinUrl = account.linkedinUrl || identityProfileUrl(account, 'linkedin')
  return {
    id: account.id,
    displayName: account.displayName,
    handle: account.handle,
    realtimeClientId: account.realtimeClientId,
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
    ...(account.headline ? { headline: account.headline } : {}),
    ...(account.bio ? { bio: account.bio } : {}),
    ...(account.githubUrl ? { githubUrl: account.githubUrl } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    ...(account.websiteUrl ? { websiteUrl: account.websiteUrl } : {}),
    badges: account.badges ?? [{ id: 'early_builder', awardedAt: account.createdAt, source: 'automatic' }],
    linkedProviders: account.linkedProviders,
  }
}

function identityProfileUrl(account: HumanAccount, provider: AuthProvider) {
  const identity = [...account.identities].reverse().find((item) => item.provider === provider)
  return validProfileUrl(identity?.profileUrl, provider) ?? undefined
}

function credentialSummary(credential: AgentCredentialRecord) {
  const handle = credential.handle || agentHandle(credential.name, credential.id)
  return {
    id: credential.id,
    name: credential.name,
    handle,
    ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}),
    keyPrefix: credential.keyPrefix,
    createdAt: credential.createdAt,
    ...(credential.lastUsedAt ? { lastUsedAt: credential.lastUsedAt } : {}),
    ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
  }
}

function validCallback(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function validProfileUrl(value: unknown, provider: AuthProvider) {
  if (value === '' || value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    const allowed = provider === 'github' ? ['github.com', 'www.github.com'] : ['linkedin.com', 'www.linkedin.com']
    return url.protocol === 'https:' && allowed.includes(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

function validHumanHandle(value: unknown) {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^@/, '')
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(raw)) return null
  return normalizeHandle(raw).toLowerCase()
}

function validWebsiteUrl(value: unknown) {
  if (value === '' || value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function safeString(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function validAgentAvatarUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function agentHandle(name: string, id: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return normalized || `agent-${id.slice(0, 8)}`
}

export class AccountStore implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const body = request.method === 'POST' || request.method === 'PATCH'
      ? await request.json().catch(() => null) as Record<string, unknown> | null
      : null

    if (url.pathname === '/identity/resolve' && request.method === 'POST') return this.resolveIdentity(body)
    if (url.pathname === '/profile' && request.method === 'GET') return this.getProfile(url.searchParams.get('accountId'))
    if (url.pathname === '/profile/by-realtime' && request.method === 'GET') return this.getProfileByRealtime(url.searchParams.get('realtimeId'))
    if (url.pathname === '/agent-profile' && request.method === 'GET') return this.getAgentProfile(url.searchParams.get('agentId'))
    if (url.pathname === '/profile' && request.method === 'PATCH') return this.updateProfile(body)
    if (url.pathname === '/enrollments' && request.method === 'POST') return this.createEnrollment(body)
    if (url.pathname.startsWith('/enrollments/') && request.method === 'GET') return this.getEnrollment(url.pathname.split('/')[2] ?? '')
    if (url.pathname.match(/^\/enrollments\/[^/]+\/authorize$/) && request.method === 'POST') return this.authorizeEnrollment(url.pathname.split('/')[2] ?? '', body)
    if (url.pathname === '/credentials/authenticate' && request.method === 'POST') return this.authenticateCredential(body)
    if (url.pathname === '/credentials' && request.method === 'GET') return this.listCredentials(url.searchParams.get('accountId'))
    if (url.pathname.match(/^\/credentials\/[^/]+\/(revoke|rotate)$/) && request.method === 'POST') {
      const [, , credentialId, action] = url.pathname.split('/')
      return action === 'revoke' ? this.revokeCredential(credentialId!, body) : this.rotateCredential(credentialId!, body)
    }
    return json({ error: 'Not found' }, 404)
  }

  private async resolveIdentity(body: Record<string, unknown> | null) {
    const identity = body?.identity as AccountIdentity | undefined
    if (!identity || !['github', 'linkedin'].includes(identity.provider) || !identity.subject || !identity.displayName) return json({ error: 'Invalid identity' }, 400)
    const profileUrl = validProfileUrl(identity.profileUrl, identity.provider)
    const storedIdentity: AccountIdentity = { ...identity, ...(profileUrl ? { profileUrl } : {}) }
    if (!profileUrl) delete storedIdentity.profileUrl
    const identityKey = `${IDENTITY_PREFIX}${identity.provider}:${identity.subject}`
    const requestedAccountId = typeof body?.accountId === 'string' ? body.accountId : undefined
    const existingAccountId = await this.state.storage.get<string>(identityKey)
    if (existingAccountId && requestedAccountId && existingAccountId !== requestedAccountId) return json({ error: 'That identity is already linked to another account' }, 409)
    let accountId = existingAccountId ?? requestedAccountId
    let account = accountId ? await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`) : undefined
    const now = new Date().toISOString()
    if (!account) {
      accountId = `human_${randomToken(18)}`
      account = {
        id: accountId,
        displayName: identity.displayName,
        handle: identity.handle,
        realtimeClientId: await realtimeId(accountId),
        ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.provider === 'github' && profileUrl ? { githubUrl: profileUrl } : {}),
        ...(identity.provider === 'linkedin' && profileUrl ? { linkedinUrl: profileUrl } : {}),
        linkedProviders: [identity.provider],
        identities: [storedIdentity],
        agentCredentialIds: [],
        badges: [{ id: 'early_builder', awardedAt: now, source: 'automatic' }],
        createdAt: now,
        updatedAt: now,
      }
    } else {
      const identities = account.identities.filter((item) => !(item.provider === identity.provider && item.subject === identity.subject))
      identities.push(storedIdentity)
      account = {
        ...account,
        identities,
        linkedProviders: [...new Set(identities.map((item) => item.provider))],
        ...(!account.avatarUrl && identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        ...(!account.email && identity.email ? { email: identity.email } : {}),
        ...(!account.githubUrl && identity.provider === 'github' && profileUrl ? { githubUrl: profileUrl } : {}),
        ...(!account.linkedinUrl && identity.provider === 'linkedin' && profileUrl ? { linkedinUrl: profileUrl } : {}),
        updatedAt: now,
      }
    }
    await this.state.storage.put({
      [identityKey]: account.id,
      [`${ACCOUNT_PREFIX}${account.id}`]: account,
      [`realtime:${account.realtimeClientId}`]: account.id,
    })
    return json({ account, profile: publicProfile(account) })
  }

  private async getProfile(accountId: string | null) {
    if (!accountId) return json({ error: 'Profile not found' }, 404)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    return account ? json({ profile: publicProfile(account), account }) : json({ error: 'Profile not found' }, 404)
  }

  private async getProfileByRealtime(realtimeIdValue: string | null) {
    if (!realtimeIdValue) return json({ error: 'Profile not found' }, 404)
    const accountId = await this.state.storage.get<string>(`realtime:${realtimeIdValue}`)
    return this.getProfile(accountId ?? null)
  }

  private async getAgentProfile(agentId: string | null) {
    if (!agentId) return json({ error: 'Profile not found' }, 404)
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${agentId}`)
    if (!credential) return json({ error: 'Profile not found' }, 404)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${credential.accountId}`)
    if (!account) return json({ error: 'Profile not found' }, 404)
    const profile: PublicAgentProfile = {
      id: credential.id,
      displayName: credential.name,
      handle: credential.handle || agentHandle(credential.name, credential.id),
      ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}),
      avatarColor: '#c8ddf0',
      actorType: 'agent',
      ownerHandle: account.handle,
      owner: publicProfile(account),
    }
    return json({ profile })
  }

  private async updateProfile(body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account) return json({ error: 'Profile not found' }, 404)
    const githubUrl = validProfileUrl(body?.githubUrl, 'github')
    const linkedinUrl = validProfileUrl(body?.linkedinUrl, 'linkedin')
    const websiteUrl = validWebsiteUrl(body?.websiteUrl)
    if (githubUrl === null || linkedinUrl === null || websiteUrl === null) return json({ error: 'Profile links must use valid HTTP or HTTPS URLs' }, 400)
    const displayName = safeString(body?.displayName, 40)
    const headline = safeString(body?.headline, 120)
    const bio = safeString(body?.bio, 320)
    if (!displayName) return json({ error: 'Display name is required' }, 400)
    const handle = body?.handle === undefined ? account.handle : validHumanHandle(body.handle)
    if (!handle) return json({ error: 'Handle must be 2–32 letters, numbers, hyphens, or underscores.' }, 400)
    if (handle !== account.handle.toLowerCase()) {
      const accounts = await this.state.storage.list<HumanAccount>({ prefix: ACCOUNT_PREFIX })
      const unavailable = [...accounts.values()].some((candidate) => candidate.id !== account.id && candidate.handle.toLowerCase() === handle)
      if (unavailable) return json({ error: `@${handle} is already taken. Choose another handle.` }, 409)
    }
    const updated: HumanAccount = {
      ...account,
      displayName,
      handle,
      headline,
      bio,
      githubUrl,
      linkedinUrl,
      websiteUrl,
      updatedAt: new Date().toISOString(),
    }
    await this.state.storage.put(`${ACCOUNT_PREFIX}${accountId}`, updated)
    return json({ profile: publicProfile(updated) })
  }

  private async createEnrollment(body: Record<string, unknown> | null) {
    const name = safeString(body?.name, 64)
    const callbackUrl = validCallback(body?.callbackUrl)
    const avatarUrl = validAgentAvatarUrl(body?.avatarUrl)
    if (!name || !callbackUrl || avatarUrl === null) return json({ error: 'A name, public HTTPS callback URL, and optional HTTPS avatar URL are required' }, 400)
    const requesterKey = safeString(body?.requesterKey, 160) || 'unknown'
    const rateKey = `enrollment-rate:${await sha256(requesterKey)}`
    const previousRate = await this.state.storage.get<{ startedAt: number; count: number }>(rateKey)
    const rate = !previousRate || Date.now() - previousRate.startedAt >= ENROLLMENT_WINDOW_MS
      ? { startedAt: Date.now(), count: 0 }
      : previousRate
    if (rate.count >= ENROLLMENT_LIMIT) return json({ error: 'Too many enrollment requests. Try again later.' }, 429)
    rate.count += 1
    await this.state.storage.put(rateKey, rate)
    const now = new Date()
    const enrollment: AgentEnrollmentRecord = {
      id: randomToken(24),
      name,
      callbackUrl,
      ...(avatarUrl ? { avatarUrl } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      status: 'pending',
    }
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${enrollment.id}`, enrollment)
    return json({ enrollment }, 201)
  }

  private async getEnrollment(id: string) {
    const enrollment = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`)
    if (!enrollment) return json({ error: 'Enrollment not found' }, 404)
    return json({ enrollment: {
      id: enrollment.id,
      name: enrollment.name,
      callbackUrl: new URL(enrollment.callbackUrl).origin,
      ...(enrollment.avatarUrl ? { avatarUrl: enrollment.avatarUrl } : {}),
      createdAt: enrollment.createdAt,
      expiresAt: enrollment.expiresAt,
      status: enrollment.status,
    } })
  }

  private async authorizeEnrollment(id: string, body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const [enrollment, account] = await Promise.all([
      this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`),
      this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`),
    ])
    if (!enrollment || new Date(enrollment.expiresAt).getTime() <= Date.now()) return json({ error: 'This authorization request expired' }, 410)
    if (!account) return json({ error: 'Human account not found' }, 404)
    if (enrollment.status !== 'pending') return json({ error: 'This authorization request was already used' }, 409)
    const issued = await this.issueCredential(account, enrollment.name, enrollment.callbackUrl, enrollment.avatarUrl)
    const credential = issued.credential
    enrollment.ownerAccountId = account.id
    enrollment.status = 'authorized'
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${id}`, enrollment)
    try {
      const response = await fetch(enrollment.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'VibeCodingTribe-Agent-Authorization/1.0' },
        body: JSON.stringify({
          type: 'vibecodingtribe.agent.authorized',
          enrollmentId: enrollment.id,
          apiKey: issued.apiKey,
          agent: { id: credential.id, name: credential.name, handle: credential.handle || agentHandle(credential.name, credential.id), ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}) },
          owner: publicProfile(account),
        }),
      })
      if (!response.ok) throw new Error(`Callback returned ${response.status}`)
      enrollment.status = 'delivered'
      await this.state.storage.put(`${ENROLLMENT_PREFIX}${id}`, enrollment)
      return json({ enrollment: { id, name: enrollment.name, status: enrollment.status }, credential: credentialSummary(credential) })
    } catch (error) {
      enrollment.status = 'failed'
      enrollment.deliveryError = error instanceof Error ? error.message.slice(0, 160) : 'Callback delivery failed'
      credential.revokedAt = new Date().toISOString()
      await this.state.storage.put({
        [`${ENROLLMENT_PREFIX}${id}`]: enrollment,
        [`${CREDENTIAL_PREFIX}${credential.id}`]: credential,
      })
      return json({ error: 'The callback could not receive the API key. No active key was created.' }, 502)
    }
  }

  private async issueCredential(account: HumanAccount, name: string, callbackUrl: string, avatarUrl?: string) {
    const id = randomToken(12)
    const secret = randomToken(32)
    const apiKey = `vct_agent_${id}_${secret}`
    const credential: AgentCredentialRecord = {
      id,
      accountId: account.id,
      name,
      handle: agentHandle(name, id),
      ...(avatarUrl ? { avatarUrl } : {}),
      callbackUrl,
      keyPrefix: `vct_agent_${id.slice(0, 6)}…`,
      secretHash: await sha256(secret),
      createdAt: new Date().toISOString(),
      rateWindowStartedAt: Date.now(),
      rateWindowCount: 0,
    }
    account.agentCredentialIds = [...account.agentCredentialIds, id]
    account.updatedAt = new Date().toISOString()
    await this.state.storage.put({
      [`${CREDENTIAL_PREFIX}${id}`]: credential,
      [`${ACCOUNT_PREFIX}${account.id}`]: account,
    })
    return { credential, apiKey }
  }

  private async authenticateCredential(body: Record<string, unknown> | null) {
    const token = typeof body?.token === 'string' ? body.token : ''
    // Agent ids are 16 base64url characters. Keep the split deterministic because
    // the secret may also contain underscores.
    const match = token.match(/^vct_agent_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{32,80})$/)
    if (!match) return json({ error: 'Invalid API key' }, 401)
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${match[1]}`)
    if (!credential || credential.revokedAt || credential.secretHash !== await sha256(match[2]!)) return json({ error: 'Invalid or revoked API key' }, 401)
    const now = Date.now()
    if (now - credential.rateWindowStartedAt >= RATE_WINDOW_MS) {
      credential.rateWindowStartedAt = now
      credential.rateWindowCount = 0
    }
    if (credential.rateWindowCount >= RATE_LIMIT) {
      return json({ error: 'Rate limit exceeded', resetAt: new Date(credential.rateWindowStartedAt + RATE_WINDOW_MS).toISOString() }, 429)
    }
    credential.rateWindowCount += 1
    credential.lastUsedAt = new Date(now).toISOString()
    await this.state.storage.put(`${CREDENTIAL_PREFIX}${credential.id}`, credential)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${credential.accountId}`)
    if (!account) return json({ error: 'Owning human account no longer exists' }, 401)
    const result: AgentAuthResult = {
      agent: { id: credential.id, name: credential.name, handle: credential.handle || agentHandle(credential.name, credential.id), ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}) },
      owner: publicProfile(account),
      rateLimit: {
        limit: RATE_LIMIT,
        remaining: RATE_LIMIT - credential.rateWindowCount,
        resetAt: new Date(credential.rateWindowStartedAt + RATE_WINDOW_MS).toISOString(),
      },
    }
    return json(result)
  }

  private async listCredentials(accountId: string | null) {
    if (!accountId) return json({ error: 'Account not found' }, 404)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account) return json({ error: 'Account not found' }, 404)
    const credentials = (await Promise.all(account.agentCredentialIds.map((id) => this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${id}`))))
      .filter((item): item is AgentCredentialRecord => Boolean(item))
      .map(credentialSummary)
    return json({ credentials })
  }

  private async revokeCredential(id: string, body: Record<string, unknown> | null) {
    const credential = await this.ownedCredential(id, body)
    if (credential instanceof Response) return credential
    if (!credential.revokedAt) credential.revokedAt = new Date().toISOString()
    await this.state.storage.put(`${CREDENTIAL_PREFIX}${id}`, credential)
    return json({ credential: credentialSummary(credential) })
  }

  private async rotateCredential(id: string, body: Record<string, unknown> | null) {
    const credential = await this.ownedCredential(id, body)
    if (credential instanceof Response) return credential
    if (credential.revokedAt) return json({ error: 'Revoked keys cannot be rotated' }, 409)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${credential.accountId}`)
    if (!account) return json({ error: 'Account not found' }, 404)
    const issued = await this.issueCredential(account, credential.name, credential.callbackUrl, credential.avatarUrl)
    try {
      const response = await fetch(credential.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'VibeCodingTribe-Agent-Rotation/1.0' },
        body: JSON.stringify({ type: 'vibecodingtribe.agent.key_rotated', apiKey: issued.apiKey, agent: { id: issued.credential.id, name: issued.credential.name, handle: issued.credential.handle || agentHandle(issued.credential.name, issued.credential.id), ...(issued.credential.avatarUrl ? { avatarUrl: issued.credential.avatarUrl } : {}) } }),
      })
      if (!response.ok) throw new Error('Callback rejected the rotated key')
      credential.revokedAt = new Date().toISOString()
      await this.state.storage.put(`${CREDENTIAL_PREFIX}${credential.id}`, credential)
      return json({ credential: credentialSummary(issued.credential), replacedCredentialId: credential.id })
    } catch {
      issued.credential.revokedAt = new Date().toISOString()
      await this.state.storage.put(`${CREDENTIAL_PREFIX}${issued.credential.id}`, issued.credential)
      return json({ error: 'The callback could not receive the rotated key. The current key remains active.' }, 502)
    }
  }

  private async ownedCredential(id: string, body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${id}`)
    if (!credential || credential.accountId !== accountId) return json({ error: 'Credential not found' }, 404)
    return credential
  }
}
