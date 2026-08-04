import type { AuthProvider, ProfileBadgeAward, PublicAgentProfile, PublicHumanProfile } from '../src/auth/types'
import type { RealtimeMessageRecord } from '../src/realtime/protocol'
import { normalizeHandle } from '../src/realtime/protocol'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ActivityDigestCandidate,
  type DigestRecipient,
  type NotificationPreferences,
} from './notifications'

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
  pointsBackfillVersion?: number
  pointAwardDay?: string
  pointAwardCount?: number
  notificationPreferences?: NotificationPreferences
}

interface ActivityDigestRecord {
  accountId: string
  day: string
  idempotencyKey: string
  events: ActivityDigestCandidate[]
  status: 'pending' | 'sent'
  preparedAt: string
  deliveredAt?: string
}

interface AgentEnrollmentRecord {
  id: string
  name: string
  callbackUrl: string
  callbackMode?: 'hosted' | 'external'
  createdAt: string
  expiresAt: string
  status: 'pending' | 'authorized' | 'delivered' | 'failed'
  avatarUrl?: string
  ownerAccountId?: string
  activeCredentialId?: string
  deliveryTokenHash?: string
  pendingDelivery?: HostedDeliveryRecord
  deliveryDisabledAt?: string
  deliveryError?: string
}

interface AgentCredentialRecord {
  id: string
  accountId: string
  name: string
  handle: string
  avatarUrl?: string
  callbackUrl: string
  enrollmentId?: string
  keyPrefix: string
  secretHash: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
  rateWindowStartedAt: number
  rateWindowCount: number
}

interface AccountStoreEnv {
  LIVE_ROOM?: DurableObjectNamespace
  SESSION_SECRET?: string
  AGENT_DELIVERY_SECRET?: string
}

interface HostedDeliveryRecord {
  credentialId: string
  ciphertext: string
  deliveredAt: string
}

type AgentDeliveryType = 'vibecodingtribe.agent.authorized' | 'vibecodingtribe.agent.key_rotated'

interface PointRecipient {
  profileId?: string
  realtimeClientId?: string
  handle?: string
  displayName?: string
}

interface PointMessageInput {
  channelId: string
  messageId: string
  author: PointRecipient
  parent?: PointRecipient
}

interface PointLookupReference extends PointRecipient {
  key: string
}

interface PointAward {
  accountId: string
  points: number
}

interface PointUpdate {
  profileId: string
  points: number
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
const DIGEST_PREFIX = 'activity-digest:'
const DELIVERED_PREFIX = 'activity-delivered:'
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const ENROLLMENT_LIMIT = 10
const ENROLLMENT_WINDOW_MS = 60 * 60_000
const MAX_POINTS_PER_DAY = 20
const POINTS_BACKFILL_KEY = 'points:backfill:v1'
const POINTS_BACKFILL_VERSION = 1
const POINTS_EVENT_PREFIX = 'points:event:v1:'
const POINTS_CHANNELS = ['general', 'showcases', 'feedback'] as const
const encoder = new TextEncoder()

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function storedPoints(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizePointRecipient(value: unknown): PointRecipient | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const profileId = typeof candidate.profileId === 'string' ? candidate.profileId.trim().slice(0, 120) : undefined
  const realtimeClientId = typeof candidate.realtimeClientId === 'string' ? candidate.realtimeClientId.trim().slice(0, 120) : undefined
  const handle = typeof candidate.handle === 'string' ? normalizeHandle(candidate.handle) : undefined
  const displayName = typeof candidate.displayName === 'string' ? candidate.displayName.trim().replace(/\s+/g, ' ').slice(0, 80) : undefined
  if (!profileId && !realtimeClientId && !handle && !displayName) return null
  return {
    ...(profileId ? { profileId } : {}),
    ...(realtimeClientId ? { realtimeClientId } : {}),
    ...(handle ? { handle } : {}),
    ...(displayName ? { displayName } : {}),
  }
}

function pointRecipientForMessage(message: RealtimeMessageRecord): PointRecipient {
  const isAgent = message.actorType === 'agent'
  return {
    ...(isAgent ? (message.ownerProfileId ? { profileId: message.ownerProfileId } : {}) : (message.profileId ? { profileId: message.profileId } : {})),
    ...(!isAgent && message.clientId ? { realtimeClientId: message.clientId } : {}),
    ...(isAgent ? (message.ownerHandle ? { handle: message.ownerHandle } : {}) : (message.handle ? { handle: message.handle } : {})),
    ...(message.displayName ? { displayName: message.displayName } : {}),
  }
}

function pointEventKey(input: Pick<PointMessageInput, 'channelId' | 'messageId'>, accountId: string) {
  return `${POINTS_EVENT_PREFIX}${encodeURIComponent(input.channelId)}:${encodeURIComponent(input.messageId)}:${encodeURIComponent(accountId)}`
}

function historyPointEventKey(message: Pick<RealtimeMessageRecord, 'channelId' | 'id'>) {
  return `${encodeURIComponent(message.channelId)}:${encodeURIComponent(message.id)}`
}

function samePointRecipient(left: PointRecipient, right: PointRecipient) {
  if (left.profileId && right.profileId) return left.profileId === right.profileId
  if (left.realtimeClientId && right.realtimeClientId) return left.realtimeClientId === right.realtimeClientId
  if (left.handle && right.handle) return left.handle.toLowerCase() === right.handle.toLowerCase()
  return Boolean(left.displayName && right.displayName && left.displayName.toLowerCase() === right.displayName.toLowerCase())
}

function resolveAccountFromList(accounts: HumanAccount[], recipient: PointRecipient) {
  if (recipient.profileId) {
    const exact = accounts.find((account) => account.id === recipient.profileId)
    if (exact) return exact
  }
  if (recipient.realtimeClientId) {
    const exact = accounts.find((account) => account.realtimeClientId === recipient.realtimeClientId)
    if (exact) return exact
  }
  if (recipient.handle) {
    const matches = accounts.filter((account) => account.handle.toLowerCase() === recipient.handle!.toLowerCase())
    if (matches.length === 1) return matches[0]
  }
  if (recipient.displayName) {
    const matches = accounts.filter((account) => account.displayName.toLowerCase() === recipient.displayName!.toLowerCase())
    if (matches.length === 1) return matches[0]
  }
  return undefined
}

function base64UrlEncode(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomToken(bytes = 24) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(value: string) {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

function deliveryEncryptionSecret(env?: AccountStoreEnv) {
  return env?.AGENT_DELIVERY_SECRET || env?.SESSION_SECRET || 'vct-local-agent-delivery-secret'
}

async function encryptHostedDelivery(value: unknown, env?: AccountStoreEnv) {
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(deliveryEncryptionSecret(env)))
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))))
  return `${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`
}

async function decryptHostedDelivery<T>(ciphertext: string, env?: AccountStoreEnv): Promise<T | null> {
  const [ivValue, ciphertextValue, ...rest] = ciphertext.split('.')
  if (!ivValue || !ciphertextValue || rest.length) return null
  try {
    const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(deliveryEncryptionSecret(env)))
    const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(ivValue) }, key, base64UrlDecode(ciphertextValue))
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    return null
  }
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
    points: storedPoints(account.points),
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

function validHostedCallbackOrigin(value: unknown) {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const local = hostname === 'localhost' || hostname === '127.0.0.1'
    if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))) return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
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

function validEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
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
  constructor(private readonly state: DurableObjectState, private readonly env?: AccountStoreEnv) {}

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
    if (url.pathname === '/points/backfill' && request.method === 'POST') return this.backfillPoints()
    if (url.pathname === '/points/award' && request.method === 'POST') return this.awardPoints(body)
    if (url.pathname === '/points/lookup' && request.method === 'POST') return this.lookupPoints(body)
    if (url.pathname === '/notification-preferences' && ['GET', 'PATCH'].includes(request.method)) return request.method === 'GET'
      ? this.getNotificationPreferences(url.searchParams.get('accountId'))
      : this.updateNotificationPreferences(body)
    if (url.pathname === '/internal/notification-recipients' && request.method === 'GET') return this.listNotificationRecipients()
    if (url.pathname === '/internal/activity-digest/prepare' && request.method === 'POST') return this.prepareActivityDigest(body)
    if (url.pathname === '/internal/activity-digest/complete' && request.method === 'POST') return this.completeActivityDigest(body)
    if (url.pathname === '/enrollments' && request.method === 'POST') return this.createEnrollment(body)
    if (url.pathname.match(/^\/enrollments\/[^/]+\/callback$/) && request.method === 'POST') return this.receiveHostedDelivery(url.pathname.split('/')[2] ?? '', body)
    if (url.pathname.match(/^\/enrollments\/[^/]+\/credential$/) && request.method === 'POST') return this.claimHostedDelivery(url.pathname.split('/')[2] ?? '', body)
    if (url.pathname.startsWith('/enrollments/') && request.method === 'GET') return this.getEnrollment(url.pathname.split('/')[2] ?? '')
    if (url.pathname.match(/^\/enrollments\/[^/]+\/authorize$/) && request.method === 'POST') return this.authorizeEnrollment(url.pathname.split('/')[2] ?? '', body)
    if (url.pathname === '/credentials/authenticate' && request.method === 'POST') return this.authenticateCredential(body)
    if (url.pathname === '/limits/consume' && request.method === 'POST') return this.consumeLimit(body)
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
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
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
    await this.ensureAccountPoints(account.id)
    const refreshed = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${account.id}`) ?? account
    return json({ account: refreshed, profile: publicProfile(refreshed) })
  }

  private async getProfile(accountId: string | null) {
    if (!accountId) return json({ error: 'Profile not found' }, 404)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account) return json({ error: 'Profile not found' }, 404)
    await this.ensureAccountPoints(account.id)
    const refreshed = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${account.id}`) ?? account
    return json({ profile: publicProfile(refreshed), account: refreshed })
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
    await this.ensureAccountPoints(account.id)
    const refreshedAccount = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${account.id}`) ?? account
    const profile: PublicAgentProfile = {
      id: credential.id,
      displayName: credential.name,
      handle: credential.handle || agentHandle(credential.name, credential.id),
      ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}),
      avatarColor: '#c8ddf0',
      actorType: 'agent',
      ownerHandle: refreshedAccount.handle,
      owner: publicProfile(refreshedAccount),
    }
    return json({ profile })
  }

  private async accounts() {
    const stored = await this.state.storage.list<HumanAccount>({ prefix: ACCOUNT_PREFIX })
    return [...stored.values()]
  }

  private async findAccount(recipient: PointRecipient, accounts?: HumanAccount[]) {
    if (recipient.profileId) {
      const direct = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${recipient.profileId}`)
      if (direct) return direct
    }
    if (recipient.realtimeClientId) {
      const accountId = await this.state.storage.get<string>(`realtime:${recipient.realtimeClientId}`)
      if (accountId) {
        const direct = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
        if (direct) return direct
      }
    }
    return resolveAccountFromList(accounts ?? await this.accounts(), recipient)
  }

  private async roomHistory() {
    if (!this.env?.LIVE_ROOM) return []
    const responses = await Promise.all(POINTS_CHANNELS.map(async (channelId) => {
      const roomId = this.env!.LIVE_ROOM!.idFromName(`vibecodingtribe.com/channel/${channelId}`)
      const response = await this.env!.LIVE_ROOM!.get(roomId).fetch(new Request(`https://internal/internal/export?channelId=${channelId}`))
      if (!response.ok) throw new Error(`Could not export ${channelId} history (${response.status})`)
      const result = await response.json() as { messages?: unknown[] }
      return (result.messages ?? []).flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const message = value as RealtimeMessageRecord
        return typeof message.id === 'string' && typeof message.channelId === 'string' ? [message] : []
      })
    }))
    return responses.flat()
  }

  private pointAwardsForHistory(messages: RealtimeMessageRecord[], accounts: HumanAccount[]) {
    const parents = new Map(messages.map((message) => [`${message.channelId}:${message.id}`, message]))
    const eventAwards = new Map<string, Map<string, number>>()
    const expected = new Map<string, number>()
    const add = (message: RealtimeMessageRecord, account: HumanAccount | undefined, points: number) => {
      if (!account) return
      const eventKey = historyPointEventKey(message)
      const awards = eventAwards.get(eventKey) ?? new Map<string, number>()
      awards.set(account.id, (awards.get(account.id) ?? 0) + points)
      eventAwards.set(eventKey, awards)
      expected.set(account.id, (expected.get(account.id) ?? 0) + points)
    }

    for (const message of messages) {
      const authorRef = pointRecipientForMessage(message)
      const author = resolveAccountFromList(accounts, authorRef)
      if (!message.parentId) {
        add(message, author, 1)
        continue
      }
      const parent = parents.get(`${message.channelId}:${message.parentId}`)
      if (!parent) continue
      const parentRef = pointRecipientForMessage(parent)
      const parentAccount = resolveAccountFromList(accounts, parentRef)
      const sameAuthor = samePointRecipient(authorRef, parentRef) || Boolean(author && parentAccount && author.id === parentAccount.id)
      if (sameAuthor) continue
      add(message, parentAccount, 1)
      add(message, author, 2)
    }
    return { eventAwards, expected }
  }

  private async reconcilePoints(messages: RealtimeMessageRecord[], accountIds?: Set<string>) {
    const accounts = await this.accounts()
    const targets = accountIds ? accounts.filter((account) => accountIds.has(account.id)) : accounts
    const { eventAwards, expected } = this.pointAwardsForHistory(messages, accounts)
    const writes: Record<string, unknown> = {}
    const updates: PointUpdate[] = []

    for (const account of targets) {
      const current = storedPoints(account.points)
      const next = Math.max(current, expected.get(account.id) ?? 0)
      if (current !== next) updates.push({ profileId: account.id, points: next })
      if (current !== next || account.pointsBackfillVersion !== POINTS_BACKFILL_VERSION) {
        writes[`${ACCOUNT_PREFIX}${account.id}`] = {
          ...account,
          points: next,
          pointsBackfillVersion: POINTS_BACKFILL_VERSION,
        } satisfies HumanAccount
      }
    }

    const targetIds = new Set(targets.map((account) => account.id))
    for (const [eventKey, awards] of eventAwards) {
      for (const [accountId, points] of awards) {
        if (!targetIds.has(accountId)) continue
        const separator = eventKey.indexOf(':')
        if (separator === -1) continue
        const channelId = decodeURIComponent(eventKey.slice(0, separator))
        const messageId = decodeURIComponent(eventKey.slice(separator + 1))
        if (!channelId || !messageId) continue
        const ledgerKey = pointEventKey({ channelId, messageId }, accountId)
        if (await this.state.storage.get(ledgerKey) === undefined) {
          writes[ledgerKey] = { accountId, points, version: POINTS_BACKFILL_VERSION }
        }
      }
    }

    if (Object.keys(writes).length) await this.state.storage.put(writes)
    await this.notifyPointUpdates(updates)
    return { accounts: targets.length, updates, events: eventAwards.size }
  }

  private async backfillPoints() {
    if (!this.env?.LIVE_ROOM) return json({ status: 'skipped', reason: 'Realtime storage is unavailable' })
    const existing = await this.state.storage.get<{ version?: number; count?: number }>(POINTS_BACKFILL_KEY)
    const messages = await this.roomHistory()
    if (existing?.version === POINTS_BACKFILL_VERSION && existing.count === messages.length) {
      return json({ status: 'already_backfilled', version: POINTS_BACKFILL_VERSION, count: messages.length })
    }
    const result = await this.reconcilePoints(messages)
    await this.state.storage.put(POINTS_BACKFILL_KEY, { version: POINTS_BACKFILL_VERSION, completedAt: new Date().toISOString(), count: messages.length })
    return json({ status: 'backfilled', version: POINTS_BACKFILL_VERSION, ...result })
  }

  private async ensureAccountPoints(accountId: string) {
    if (!this.env?.LIVE_ROOM) return
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account || account.pointsBackfillVersion === POINTS_BACKFILL_VERSION) return
    const existing = await this.state.storage.get<{ version?: number }>(POINTS_BACKFILL_KEY)
    if (existing?.version !== POINTS_BACKFILL_VERSION) {
      await this.backfillPoints()
      return
    }
    await this.reconcilePoints(await this.roomHistory(), new Set([accountId]))
  }

  private async awardPoints(body: Record<string, unknown> | null) {
    const channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : ''
    const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : ''
    const author = normalizePointRecipient(body?.author)
    const parent = body?.parent === undefined ? undefined : normalizePointRecipient(body.parent)
    if (!channelId || !messageId || !author || (body?.parent !== undefined && !parent)) return json({ error: 'Point event identity was invalid' }, 400)

    const input: PointMessageInput = { channelId, messageId, author, ...(parent ? { parent } : {}) }
    const accounts = await this.accounts()
    const authorAccount = await this.findAccount(author, accounts)
    const parentAccount = parent ? await this.findAccount(parent, accounts) : undefined
    const awards = new Map<string, PointAward>()
    const awardCounts = new Map<string, number>()
    const today = new Date().toISOString().slice(0, 10)
    const add = (account: HumanAccount | undefined, points: number) => {
      if (!account) return
      const earnedToday = account.pointAwardDay === today ? account.pointAwardCount ?? 0 : 0
      const alreadyQueued = awardCounts.get(account.id) ?? 0
      const granted = Math.min(points, Math.max(0, MAX_POINTS_PER_DAY - earnedToday - alreadyQueued))
      if (granted <= 0) return
      const previous = awards.get(account.id)
      awards.set(account.id, { accountId: account.id, points: (previous?.points ?? 0) + granted })
      awardCounts.set(account.id, alreadyQueued + granted)
    }

    if (!parent) add(authorAccount, 1)
    else if (!samePointRecipient(author, parent) && (!authorAccount || !parentAccount || authorAccount.id !== parentAccount.id)) {
      add(parentAccount, 1)
      add(authorAccount, 2)
    }

    const updates: PointUpdate[] = []
    const writes: Record<string, unknown> = {}
    for (const award of awards.values()) {
      const account = accounts.find((candidate) => candidate.id === award.accountId)
      if (!account) continue
      const ledgerKey = pointEventKey(input, account.id)
      if (await this.state.storage.get(ledgerKey) !== undefined) continue
      const nextPoints = storedPoints(account.points) + award.points
      writes[`${ACCOUNT_PREFIX}${account.id}`] = {
        ...account,
        points: nextPoints,
        pointAwardDay: today,
        pointAwardCount: (account.pointAwardDay === today ? account.pointAwardCount ?? 0 : 0) + award.points,
        updatedAt: new Date().toISOString(),
      } satisfies HumanAccount
      writes[ledgerKey] = { accountId: account.id, points: award.points, version: POINTS_BACKFILL_VERSION }
      updates.push({ profileId: account.id, points: nextPoints })
    }
    if (Object.keys(writes).length) await this.state.storage.put(writes)
    await this.notifyPointUpdates(updates)
    return json({ channelId, messageId, updates })
  }

  private async lookupPoints(body: Record<string, unknown> | null) {
    if (!Array.isArray(body?.refs)) return json({ error: 'Point references are required' }, 400)
    const refs = body.refs.slice(0, 500).flatMap((value): PointLookupReference[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const candidate = value as Record<string, unknown>
      const key = typeof candidate.key === 'string' ? candidate.key.trim().slice(0, 160) : ''
      const recipient = normalizePointRecipient(candidate)
      return key && recipient ? [{ key, ...recipient }] : []
    })
    const accounts = await this.accounts()
    const points: Record<string, number> = {}
    for (const ref of refs) {
      const account = await this.findAccount(ref, accounts)
      if (account) points[ref.key] = storedPoints(account.points)
    }
    return json({ points })
  }

  private async notifyPointUpdates(updates: PointUpdate[]) {
    if (!this.env?.LIVE_ROOM || updates.length === 0) return
    await Promise.allSettled(POINTS_CHANNELS.map(async (channelId) => {
      const roomId = this.env!.LIVE_ROOM!.idFromName(`vibecodingtribe.com/channel/${channelId}`)
      const response = await this.env!.LIVE_ROOM!.get(roomId).fetch(new Request(`https://internal/internal/points-update?channelId=${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      }))
      if (!response.ok) throw new Error(`Point propagation failed for ${channelId} (${response.status})`)
    }))
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

  private notificationPreferences(account: HumanAccount): NotificationPreferences {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(account.notificationPreferences ?? {}) }
  }

  private async getNotificationPreferences(accountId: string | null) {
    if (!accountId) return json({ error: 'Account not found' }, 404)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    return account ? json({ preferences: this.notificationPreferences(account), ...(account.email ? { email: account.email } : {}) }) : json({ error: 'Account not found' }, 404)
  }

  private async updateNotificationPreferences(body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account) return json({ error: 'Account not found' }, 404)
    if (typeof body?.activityDigest !== 'boolean') return json({ error: 'activityDigest must be a boolean' }, 400)
    const providedEmail = body?.email === undefined
      ? account.email
      : typeof body.email === 'string' && !body.email.trim()
        ? undefined
        : validEmail(body.email)
    if (providedEmail === null) return json({ error: 'Enter a valid email address for activity digests.' }, 400)
    if (body.activityDigest && !providedEmail) return json({ error: 'Add an email address before turning on activity digests.' }, 400)
    account.email = providedEmail || undefined
    account.notificationPreferences = { ...this.notificationPreferences(account), activityDigest: body.activityDigest }
    account.updatedAt = new Date().toISOString()
    await this.state.storage.put(`${ACCOUNT_PREFIX}${account.id}`, account)
    return json({ preferences: account.notificationPreferences, ...(account.email ? { email: account.email } : {}) })
  }

  private async listNotificationRecipients() {
    const accounts = await this.state.storage.list<HumanAccount>({ prefix: ACCOUNT_PREFIX })
    const recipients: DigestRecipient[] = [...accounts.values()].map((account) => ({
      accountId: account.id,
      realtimeClientId: account.realtimeClientId,
      displayName: account.displayName,
      ...(account.email ? { email: account.email } : {}),
      preferences: this.notificationPreferences(account),
    }))
    return json({ recipients })
  }

  private async prepareActivityDigest(body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const day = typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : ''
    const events = Array.isArray(body?.events) ? body.events as ActivityDigestCandidate[] : []
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${accountId}`)
    if (!account || !day) return json({ error: 'Invalid digest recipient or day' }, 400)
    if (!account.email || !this.notificationPreferences(account).activityDigest) return json({ send: false, reason: 'not-eligible' })
    const key = `${DIGEST_PREFIX}${account.id}:${day}`
    const existing = await this.state.storage.get<ActivityDigestRecord>(key)
    if (existing) {
      if (existing.status === 'sent') return json({ send: false, reason: 'already-sent' })
      return json({ send: true, accountId: account.id, email: account.email, displayName: account.displayName, idempotencyKey: existing.idempotencyKey, events: existing.events })
    }
    const delivered = await Promise.all(events.map(async (event) => ({
      event,
      delivered: Boolean(await this.state.storage.get(`${DELIVERED_PREFIX}${account.id}:${event.id}`)),
    })))
    const pendingEvents = [...new Map(delivered.filter((item) => !item.delivered).map((item) => [item.event.id, item.event])).values()]
    if (!pendingEvents.length) return json({ send: false, reason: 'empty' })
    const record: ActivityDigestRecord = {
      accountId: account.id,
      day,
      idempotencyKey: `activity-digest:${account.id}:${day}`,
      events: pendingEvents,
      status: 'pending',
      preparedAt: new Date().toISOString(),
    }
    await this.state.storage.put(key, record)
    return json({ send: true, accountId: account.id, email: account.email, displayName: account.displayName, idempotencyKey: record.idempotencyKey, events: record.events })
  }

  private async completeActivityDigest(body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const day = typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : ''
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : ''
    if (!accountId || !day || !idempotencyKey) return json({ error: 'Digest completion fields are required' }, 400)
    const key = `${DIGEST_PREFIX}${accountId}:${day}`
    const record = await this.state.storage.get<ActivityDigestRecord>(key)
    if (!record || record.idempotencyKey !== idempotencyKey) return json({ error: 'Digest was not prepared' }, 409)
    if (record.status === 'sent') return json({ delivered: true, alreadyDelivered: true })
    const deliveredAt = new Date().toISOString()
    record.status = 'sent'
    record.deliveredAt = deliveredAt
    await this.state.storage.put({
      [key]: record,
      ...Object.fromEntries(record.events.map((event) => [`${DELIVERED_PREFIX}${accountId}:${event.id}`, { deliveredAt }])),
    })
    return json({ delivered: true, eventCount: record.events.length })
  }

  private async createEnrollment(body: Record<string, unknown> | null) {
    const name = safeString(body?.name, 64)
    const requestedCallbackUrl = typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : ''
    const hostedCallbackOrigin = validHostedCallbackOrigin(body?.hostedCallbackOrigin)
    if (requestedCallbackUrl) return json({ error: 'External agent callbacks are temporarily disabled. Create a hosted delivery enrollment instead.' }, 403)
    const hosted = true
    const callbackUrl = hostedCallbackOrigin
    const avatarUrl = validAgentAvatarUrl(body?.avatarUrl)
    if (!name || !callbackUrl || avatarUrl === null) return json({ error: 'A name and valid VibeCodingTribe callback origin are required' }, 400)
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
    const id = randomToken(24)
    const deliveryToken = hosted ? `vct_delivery_${randomToken(32)}` : undefined
    const enrollment: AgentEnrollmentRecord = {
      id,
      name,
      callbackUrl: hosted ? new URL(`/api/agents/callback/${id}`, callbackUrl).toString() : callbackUrl,
      callbackMode: hosted ? 'hosted' : 'external',
      ...(avatarUrl ? { avatarUrl } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      status: 'pending',
      ...(deliveryToken ? { deliveryTokenHash: await sha256(deliveryToken) } : {}),
    }
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${enrollment.id}`, enrollment)
    return json({ enrollment, ...(deliveryToken ? { deliveryToken } : {}) }, 201)
  }

  private async getEnrollment(id: string) {
    const enrollment = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`)
    if (!enrollment) return json({ error: 'Enrollment not found' }, 404)
    const callbackMode = enrollment.callbackMode ?? 'external'
    return json({ enrollment: {
      id: enrollment.id,
      name: enrollment.name,
      callbackUrl: callbackMode === 'hosted' ? 'VibeCodingTribe hosted callback' : new URL(enrollment.callbackUrl).origin,
      callbackMode,
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
    const hosted = enrollment.callbackMode === 'hosted'
    if (!hosted) return json({ error: 'External agent callbacks are temporarily disabled. Create a new hosted delivery enrollment.' }, 409)
    const issued = await this.issueCredential(account, enrollment.name, enrollment.callbackUrl, enrollment.avatarUrl, hosted ? enrollment.id : undefined)
    const credential = issued.credential
    enrollment.ownerAccountId = account.id
    enrollment.activeCredentialId = credential.id
    enrollment.status = 'authorized'
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${id}`, enrollment)
    const payload = {
      type: 'vibecodingtribe.agent.authorized',
      enrollmentId: enrollment.id,
      apiKey: issued.apiKey,
      agent: { id: credential.id, name: credential.name, handle: credential.handle || agentHandle(credential.name, credential.id), ...(credential.avatarUrl ? { avatarUrl: credential.avatarUrl } : {}) },
      owner: publicProfile(account),
    }
    const received = await this.receiveHostedDelivery(id, payload)
    if (!received.ok) {
      credential.revokedAt = new Date().toISOString()
      await this.state.storage.put(`${CREDENTIAL_PREFIX}${credential.id}`, credential)
      return json({ error: 'The hosted delivery could not be prepared. No active key was created.' }, 502)
    }
    const delivered = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`)
    return json({ enrollment: { id, name: enrollment.name, status: delivered?.status ?? 'delivered' }, credential: credentialSummary(credential) })
  }

  private async issueCredential(account: HumanAccount, name: string, callbackUrl: string, avatarUrl?: string, enrollmentId?: string) {
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
      ...(enrollmentId ? { enrollmentId } : {}),
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
    const parsed = parseAgentApiKey(token)
    if (!parsed) return json({ error: 'Invalid API key' }, 401)
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${parsed.id}`)
    if (!credential || credential.revokedAt || credential.secretHash !== await sha256(parsed.secret)) return json({ error: 'Invalid or revoked API key' }, 401)
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

  /**
   * Internal Worker-only fixed-window limiter. Each subject keeps one small
   * record per scope, rather than an unbounded record per request.
   */
  private async consumeLimit(body: Record<string, unknown> | null) {
    const scope = safeString(body?.scope, 80)
    const subject = safeString(body?.subject, 240)
    const limit = typeof body?.limit === 'number' && Number.isSafeInteger(body.limit) ? body.limit : 0
    const windowMs = typeof body?.windowMs === 'number' && Number.isSafeInteger(body.windowMs) ? body.windowMs : 0
    if (!scope || !subject || limit < 1 || limit > 10_000 || windowMs < 1_000 || windowMs > 86_400_000) return json({ error: 'Rate limit request was invalid' }, 400)
    const key = `limit:${scope}:${await sha256(subject)}`
    const now = Date.now()
    const previous = await this.state.storage.get<{ startedAt: number; count: number }>(key)
    const record = !previous || now - previous.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : previous
    if (record.count >= limit) {
      return json({ allowed: false, remaining: 0, resetAt: new Date(record.startedAt + windowMs).toISOString() }, 429)
    }
    record.count += 1
    await this.state.storage.put(key, record)
    return json({ allowed: true, remaining: limit - record.count, resetAt: new Date(record.startedAt + windowMs).toISOString() })
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
    if (credential.enrollmentId) {
      const enrollment = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${credential.enrollmentId}`)
      if (enrollment?.activeCredentialId === credential.id) {
        delete enrollment.deliveryTokenHash
        delete enrollment.pendingDelivery
        enrollment.deliveryDisabledAt = new Date().toISOString()
        await this.state.storage.put(`${ENROLLMENT_PREFIX}${credential.enrollmentId}`, enrollment)
      }
    }
    return json({ credential: credentialSummary(credential) })
  }

  private async rotateCredential(id: string, body: Record<string, unknown> | null) {
    const credential = await this.ownedCredential(id, body)
    if (credential instanceof Response) return credential
    if (credential.revokedAt) return json({ error: 'Revoked keys cannot be rotated' }, 409)
    const account = await this.state.storage.get<HumanAccount>(`${ACCOUNT_PREFIX}${credential.accountId}`)
    if (!account) return json({ error: 'Account not found' }, 404)
    if (!credential.enrollmentId) return json({ error: 'External agent callbacks are temporarily disabled. Re-enroll this agent with hosted delivery.' }, 409)
    const issued = await this.issueCredential(account, credential.name, credential.callbackUrl, credential.avatarUrl, credential.enrollmentId)
    const received = await this.receiveHostedDelivery(credential.enrollmentId, {
      type: 'vibecodingtribe.agent.key_rotated',
      enrollmentId: credential.enrollmentId,
      apiKey: issued.apiKey,
      agent: { id: issued.credential.id, name: issued.credential.name, handle: issued.credential.handle || agentHandle(issued.credential.name, issued.credential.id), ...(issued.credential.avatarUrl ? { avatarUrl: issued.credential.avatarUrl } : {}) },
    })
    if (received.ok) {
      credential.revokedAt = new Date().toISOString()
      await this.state.storage.put(`${CREDENTIAL_PREFIX}${credential.id}`, credential)
      return json({ credential: credentialSummary(issued.credential), replacedCredentialId: credential.id })
    }
    issued.credential.revokedAt = new Date().toISOString()
    await this.state.storage.put(`${CREDENTIAL_PREFIX}${issued.credential.id}`, issued.credential)
    return json({ error: 'The hosted delivery could not be prepared. The current key remains active.' }, 502)
  }

  private async receiveHostedDelivery(id: string, body: Record<string, unknown> | null) {
    const enrollment = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`)
    if (!enrollment || enrollment.callbackMode !== 'hosted' || !enrollment.deliveryTokenHash) return json({ error: 'Hosted callback not found' }, 404)
    if (!body || !['vibecodingtribe.agent.authorized', 'vibecodingtribe.agent.key_rotated'].includes(body.type as string)) return json({ error: 'Invalid callback payload' }, 400)
    if (typeof body.apiKey !== 'string' || typeof body.enrollmentId !== 'string' || body.enrollmentId !== id) return json({ error: 'Invalid callback payload' }, 400)
    const agent = body.agent
    if (!agent || typeof agent !== 'object' || Array.isArray(agent) || typeof (agent as Record<string, unknown>).id !== 'string') return json({ error: 'Invalid callback payload' }, 400)
    const parsed = parseAgentApiKey(body.apiKey)
    if (!parsed) return json({ error: 'Invalid callback payload' }, 400)
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${parsed.id}`)
    if (!credential || credential.revokedAt || credential.accountId !== enrollment.ownerAccountId || credential.callbackUrl !== enrollment.callbackUrl || credential.secretHash !== await sha256(parsed.secret)) return json({ error: 'Invalid callback payload' }, 401)
    if ((agent as Record<string, unknown>).id !== credential.id) return json({ error: 'Invalid callback payload' }, 401)
    if (body.type === 'vibecodingtribe.agent.authorized' && enrollment.activeCredentialId !== credential.id) return json({ error: 'Invalid callback payload' }, 401)
    if (body.type === 'vibecodingtribe.agent.key_rotated' && enrollment.status !== 'delivered') return json({ error: 'Invalid callback state' }, 409)
    if (enrollment.pendingDelivery) return json({ error: 'A key is already waiting for this agent' }, 409)
    const payload = {
      type: body.type as AgentDeliveryType,
      enrollmentId: id,
      apiKey: body.apiKey,
      agent,
      ...(body.owner ? { owner: body.owner } : {}),
    }
    enrollment.pendingDelivery = {
      credentialId: credential.id,
      ciphertext: await encryptHostedDelivery(payload, this.env),
      deliveredAt: new Date().toISOString(),
    }
    enrollment.activeCredentialId = credential.id
    enrollment.status = 'delivered'
    delete enrollment.deliveryError
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${id}`, enrollment)
    return json({ accepted: true, status: enrollment.status }, 202)
  }

  private async claimHostedDelivery(id: string, body: Record<string, unknown> | null) {
    const token = typeof body?.deliveryToken === 'string' ? body.deliveryToken : ''
    const enrollment = await this.state.storage.get<AgentEnrollmentRecord>(`${ENROLLMENT_PREFIX}${id}`)
    if (!enrollment || !enrollment.deliveryTokenHash || enrollment.deliveryDisabledAt || enrollment.deliveryTokenHash !== await sha256(token)) return json({ error: 'Invalid or expired delivery token' }, 401)
    if (!enrollment.pendingDelivery) {
      if (enrollment.status === 'failed') return json({ error: 'Key delivery failed' }, 502)
      if (enrollment.status === 'pending' && new Date(enrollment.expiresAt).getTime() <= Date.now()) return json({ error: 'This authorization request expired' }, 410)
      return json({ status: enrollment.status === 'pending' ? 'pending' : 'waiting', enrollmentId: id, retryAfterSeconds: 2 }, 202)
    }
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${enrollment.pendingDelivery.credentialId}`)
    if (!credential || credential.revokedAt || enrollment.activeCredentialId !== credential.id) return json({ error: 'This agent credential is no longer active' }, 410)
    const payload = await decryptHostedDelivery<Record<string, unknown>>(enrollment.pendingDelivery.ciphertext, this.env)
    if (!payload) return json({ error: 'The hosted delivery could not be opened' }, 500)
    delete enrollment.pendingDelivery
    await this.state.storage.put(`${ENROLLMENT_PREFIX}${id}`, enrollment)
    return json(payload)
  }

  private async ownedCredential(id: string, body: Record<string, unknown> | null) {
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    const credential = await this.state.storage.get<AgentCredentialRecord>(`${CREDENTIAL_PREFIX}${id}`)
    if (!credential || credential.accountId !== accountId) return json({ error: 'Credential not found' }, 404)
    return credential
  }
}

function parseAgentApiKey(token: string) {
  // Agent ids are 16 base64url characters. Keep the split deterministic because
  // the secret may also contain underscores.
  const match = token.match(/^vct_agent_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{32,80})$/)
  return match ? { id: match[1]!, secret: match[2]! } : null
}
