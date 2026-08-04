import type { RealtimeMessageRecord, RealtimeMessageRevision, RealtimeProfile, RealtimeServerEvent } from '../src/realtime/protocol'
import {
  LIVE_ROOM_KEY,
  normalizeAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  normalizeHttpUrl,
  normalizePoints,
  normalizeRealtimeMessageRecord,
  parseRealtimeClientEvent,
} from '../src/realtime/protocol'
import { channelRoomName, DEFAULT_CHANNEL_ID, isCommunityChannelId, normalizeCommunityChannelId, type CommunityChannelId } from '../src/community/channels'
import { authenticateRequest, handleAuthRequest, hasRecentAuthentication, realtimeClientId, type AuthEnv } from './auth'
import { accountRequest } from './auth'
import { activityDigestOptOutUrl } from './auth'
import type { AgentAuthResult } from './accounts'
import type { ExchangeActor } from './exchange'
import type { PublicHumanProfile } from '../src/auth/types'
import { activityDigestEmail, CloudflareEmailProvider, ResendEmailProvider, type CloudflareEmailBinding, type TransactionalEmailProvider } from './email'
import { collectActivityDigestEvents, digestDay, type DigestRecipient } from './notifications'
export { ExchangeStore } from './exchange'
export { AccountStore } from './accounts'

export interface Env extends AuthEnv {
  LIVE_ROOM: DurableObjectNamespace
  EXCHANGE_STATE: DurableObjectNamespace
  ACCOUNTS: DurableObjectNamespace
  MEDIA?: R2Bucket
  LOCAL_PREVIEW?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  EMAIL_REPLY_TO?: string
  EMAIL_UNSUBSCRIBE_ORIGIN?: string
  EMAIL?: CloudflareEmailBinding
}

interface ConnectionAttachment extends RealtimeProfile {
  channelId: CommunityChannelId
  joinedAt: string
  canSend: boolean
}

interface ProfileUpdatePayload {
  profileId?: string
  realtimeClientId?: string
  displayName?: string
  handle?: string
  avatarUrl?: string
}

interface PointUpdatePayload {
  profileId: string
  points: number
}

const LEGACY_ROOM_NAME = LIVE_ROOM_KEY
const ROOM_NAME = channelRoomName(DEFAULT_CHANNEL_ID)
const HISTORY_KEY = 'messages'
const MIGRATION_KEY = 'legacy-migration-v1'
const HISTORY_LIMIT = 200
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MEDIA_RETENTION_MS = 90 * 24 * 60 * 60_000
const MEDIA_CLEANUP_PAGE_LIMIT = 1_000
const MEDIA_CLEANUP_MAX_PAGES = 10
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  })
}

function channelIdFromRequest(request: Request): CommunityChannelId | null {
  const value = new URL(request.url).searchParams.get('channelId')
  if (!value) return DEFAULT_CHANNEL_ID
  return isCommunityChannelId(value) ? value : null
}

function channelIdFromRecord(value: unknown, fallbackChannelId: CommunityChannelId): CommunityChannelId {
  return isRecord(value) && isCommunityChannelId(value.channelId) ? value.channelId : fallbackChannelId
}

function normalizeHistory(value: unknown, fallbackChannelId: CommunityChannelId): RealtimeMessageRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = normalizeRealtimeMessageRecord({ ...(isRecord(item) ? item : {}), channelId: channelIdFromRecord(item, fallbackChannelId) })
    return normalized?.channelId === fallbackChannelId ? [normalized] : []
  })
}

function messagesAfterCursor(history: RealtimeMessageRecord[], rawCursor: string | null) {
  if (rawCursor === null) return { messages: history }
  const cursor = rawCursor.trim()
  if (!cursor) return { error: 'since must be a message id or ISO-8601 timestamp' as const }
  const messageIndex = history.findIndex((message) => message.id === cursor)
  if (messageIndex !== -1) return { messages: history.slice(messageIndex + 1) }
  if (/^[a-zA-Z0-9:_-]{8,160}$/.test(cursor)) {
    // The message may have fallen out of the room's bounded history. Return the
    // retained window so a watcher can resynchronize without missing messages.
    return { messages: history }
  }
  const timestamp = /^\d{10,13}$/.test(cursor) ? Number(cursor) : Date.parse(cursor)
  if (!Number.isFinite(timestamp)) return { error: 'since must be a message id or ISO-8601 timestamp' as const }
  return { messages: history.filter((message) => Date.parse(message.sentAt) > timestamp) }
}

export function agentReadableMessage(message: RealtimeMessageRecord) {
  const attachmentLines: string[] = []
  const includedUrls = new Set<string>()
  const includeUrl = (label: string, value: string | undefined) => {
    if (!value || includedUrls.has(value) || message.text.includes(value)) return
    includedUrls.add(value)
    attachmentLines.push(`${label}: ${value}`)
  }
  includeUrl('Build URL', message.buildUrl)
  includeUrl('Link URL', message.linkPreview?.url)
  includeUrl('Image URL', message.imageUrl)
  return {
    ...message,
    bodyText: message.text,
    text: [message.text, ...attachmentLines].filter(Boolean).join('\n\n'),
  }
}

function pointsOwnerProfileId(message: Pick<RealtimeMessageRecord, 'profileId' | 'actorType' | 'ownerProfileId'>) {
  return message.actorType === 'agent' ? message.ownerProfileId : message.profileId
}

function pointRecipient(message: RealtimeMessageRecord) {
  const profileId = pointsOwnerProfileId(message)
  return {
    ...(profileId ? { profileId } : {}),
    ...(message.actorType === 'human' && message.clientId ? { realtimeClientId: message.clientId } : {}),
    ...(message.actorType === 'agent' && message.ownerHandle ? { handle: message.ownerHandle } : { handle: message.handle }),
    ...(message.displayName ? { displayName: message.displayName } : {}),
  }
}

function messageRevision(message: RealtimeMessageRecord): RealtimeMessageRevision {
  return {
    revision: (message.revisions?.length ?? 0) + 1,
    createdAt: message.editedAt ?? message.sentAt,
    text: message.text,
    ...(message.buildName ? { buildName: message.buildName } : {}),
    ...(message.buildUrl ? { buildUrl: message.buildUrl } : {}),
    ...(message.imageUrl ? { imageUrl: message.imageUrl } : {}),
    ...(message.linkPreview ? { linkPreview: message.linkPreview } : {}),
  }
}

function ownsRealtimeMessage(message: RealtimeMessageRecord, profile: Pick<RealtimeProfile, 'clientId' | 'profileId'>) {
  return Boolean((profile.profileId && message.profileId === profile.profileId) || message.clientId === profile.clientId)
}

function editedMessage(message: RealtimeMessageRecord, text: string, now = new Date().toISOString()): RealtimeMessageRecord {
  const updated: RealtimeMessageRecord = {
    ...message,
    text,
    revisions: [...(message.revisions ?? []), messageRevision(message)],
    editedAt: now,
  }
  delete updated.linkPreview
  return updated
}

function deletedMessage(message: RealtimeMessageRecord, now = new Date().toISOString()): RealtimeMessageRecord {
  const updated: RealtimeMessageRecord = {
    ...message,
    text: '',
    likedByClientIds: [],
    revisions: [...(message.revisions ?? []), messageRevision(message)],
    deletedAt: now,
  }
  delete updated.buildName
  delete updated.buildUrl
  delete updated.imageUrl
  delete updated.linkPreview
  return updated
}

function legacyChannelForMessage(message: Pick<RealtimeMessageRecord, 'intent' | 'parentId'>, parentChannels: Map<string, CommunityChannelId>): CommunityChannelId {
  if (message.parentId && parentChannels.has(message.parentId)) return parentChannels.get(message.parentId)!
  if (message.intent === 'needs_feedback') return 'feedback'
  if (message.intent === 'showcase' || message.intent === 'update') return 'showcases'
  return 'general'
}

function isAllowedOrigin(request: Request, allowedOrigins: string) {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    const hostname = new URL(origin).hostname
    if (hostname === 'vibecodingtribe.pages.dev' || hostname.endsWith('.vibecodingtribe.pages.dev')) return true
    return allowedOrigins.split(',').map((value) => value.trim()).filter(Boolean).includes(origin)
  } catch {
    return false
  }
}

function exchangeCorsHeaders(request: Request, env: Env) {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  const origin = request.headers.get('Origin')
  if (origin && isAllowedOrigin(request, env.ALLOWED_ORIGINS)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    headers.set('Vary', 'Origin')
  }
  return headers
}

function isLocalPreviewRequest(request: Request, env: Env) {
  const origin = request.headers.get('Origin') ?? ''
  return env.LOCAL_PREVIEW === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function httpsRedirect(request: Request) {
  const url = new URL(request.url)
  if (url.protocol === 'https:' || isLocalRequest(request)) return null
  url.protocol = 'https:'
  return Response.redirect(url.toString(), 308)
}

function securityHeaders(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function consumeLimit(env: Env, scope: string, subject: string, limit: number, windowMs: number) {
  if (!env.ACCOUNTS) return true
  const response = await accountRequest(env, '/limits/consume', { scope, subject, limit, windowMs })
  return response.ok
}

function sessionSubject(session: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>) {
  return session.accountId ?? `${session.provider}:${session.subject}`
}

async function propagateProfileUpdate(env: Env, profile: PublicHumanProfile) {
  const body = JSON.stringify({
    profileId: profile.id,
    realtimeClientId: profile.realtimeClientId,
    displayName: profile.displayName,
    handle: profile.handle,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  })
  const results = await Promise.allSettled((['general', 'showcases', 'feedback'] as const).map(async (channelId) => {
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    const response = await env.LIVE_ROOM.get(roomId).fetch(new Request(`https://internal/internal/profile-update?channelId=${channelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }))
    if (!response.ok) throw new Error(`${channelId} profile update failed with ${response.status}`)
  }))
  for (const result of results) {
    if (result.status === 'rejected') console.error('Realtime profile propagation failed', result.reason)
  }
}

async function currentRealtimeIdentity(session: Awaited<ReturnType<typeof authenticateRequest>>, env: Env) {
  if (!session) return null
  if (session.accountId && env.ACCOUNTS) {
    const response = await accountRequest(env, `/profile?accountId=${encodeURIComponent(session.accountId)}`)
    if (response.ok) {
      const { profile } = await response.json() as { profile: PublicHumanProfile }
      return profile
    }
  }
  return {
    id: session.accountId ?? `${session.provider}:${session.subject}`,
    displayName: session.displayName,
    handle: session.handle,
    realtimeClientId: await realtimeClientId(session),
    points: 0,
    ...(session.avatarUrl ? { avatarUrl: session.avatarUrl } : {}),
  } satisfies Pick<PublicHumanProfile, 'id' | 'displayName' | 'handle' | 'realtimeClientId' | 'avatarUrl' | 'points'>
}

async function handleMediaRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const cors = exchangeCorsHeaders(request, env)
  if (request.method === 'OPTIONS' && url.pathname === '/api/uploads/images') {
    return new Response(null, { status: 204, headers: cors })
  }
  const mediaMatch = url.pathname.match(/^\/media\/([a-f0-9-]+\.(?:png|jpg|webp|gif))$/)
  if (mediaMatch && request.method === 'GET') {
    if (!env.MEDIA) return Response.json({ error: 'Media storage is unavailable' }, { status: 503 })
    const object = await env.MEDIA.get(mediaMatch[1]!)
    if (!object) return Response.json({ error: 'Image not found' }, { status: 404 })
    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ETag: object.httpEtag,
    })
    return new Response(object.body, { headers })
  }
  if (url.pathname !== '/api/uploads/images' || request.method !== 'POST') return null
  if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
  const session = await authenticateRequest(request, env)
  if (!session && !isLocalPreviewRequest(request, env)) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
  if (!env.MEDIA) return Response.json({ error: 'Media storage is unavailable' }, { status: 503, headers: cors })
  if (session) {
    const accountAllowed = await consumeLimit(env, 'upload-account', sessionSubject(session), 12, 60 * 60_000)
    const ipAllowed = await consumeLimit(env, 'upload-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 24, 60 * 60_000)
    if (!accountAllowed || !ipAllowed) return Response.json({ error: 'Upload rate limit exceeded. Try again later.' }, { status: 429, headers: cors })
  }
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = IMAGE_EXTENSIONS[contentType]
  if (!extension) return Response.json({ error: 'Paste a PNG, JPEG, WebP, or GIF image' }, { status: 415, headers: cors })
  const declaredSize = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredSize > MAX_IMAGE_BYTES) return Response.json({ error: 'Images must be 5 MB or smaller' }, { status: 413, headers: cors })
  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return Response.json({ error: 'Images must be between 1 byte and 5 MB' }, { status: 413, headers: cors })
  const key = `${crypto.randomUUID()}.${extension}`
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: session?.accountId ?? 'local-preview' },
  })
  return Response.json({ url: `${url.origin}/media/${key}` }, { status: 201, headers: cors })
}

export async function cleanupExpiredMedia(env: Pick<Env, 'MEDIA'>, now = Date.now()) {
  if (!env.MEDIA) return { scanned: 0, deleted: 0 }
  let cursor: string | undefined
  let scanned = 0
  let deleted = 0
  for (let page = 0; page < MEDIA_CLEANUP_MAX_PAGES; page += 1) {
    const result = await env.MEDIA.list({ limit: MEDIA_CLEANUP_PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
    scanned += result.objects.length
    const expiredKeys = result.objects
      .filter((object) => now - object.uploaded.getTime() >= MEDIA_RETENTION_MS)
      .map((object) => object.key)
    if (expiredKeys.length) {
      await env.MEDIA.delete(expiredKeys)
      deleted += expiredKeys.length
    }
    if (!result.truncated) break
    cursor = result.cursor
    if (!cursor) break
  }
  return { scanned, deleted }
}

async function exchangeActor(request: Request, env: Env): Promise<ExchangeActor | null> {
  const session = await authenticateRequest(request, env)
  if (session) return {
    user: {
      id: session.accountId ?? `${session.provider}:${session.subject}`,
      displayName: session.displayName,
      handle: session.handle,
      provider: session.provider,
      headline: 'Verified builder',
      skills: [],
      devices: [],
      avatarColor: session.provider === 'github' ? '#9bcf66' : '#70a8c4',
    },
  }
  return null
}

function bearerToken(request: Request) {
  const value = request.headers.get('Authorization')
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null
}

async function agentActor(request: Request, env: Env): Promise<{ auth: AgentAuthResult; actor: ExchangeActor } | Response> {
  const token = bearerToken(request)
  if (!token?.startsWith('vct_agent_')) return Response.json({ error: 'An agent API key is required' }, { status: 401 })
  const response = await accountRequest(env, '/credentials/authenticate', { token })
  if (!response.ok) return response
  const auth = await response.json() as AgentAuthResult
  return {
    auth,
    actor: {
      user: {
        id: auth.owner.id,
        displayName: auth.owner.displayName,
        handle: auth.owner.handle,
        provider: auth.owner.linkedProviders.includes('github') ? 'github' : 'linkedin',
        headline: auth.owner.headline || 'Verified builder',
        skills: [],
        devices: [],
        avatarColor: '#70a8c4',
      },
      agent: auth.agent,
    },
  }
}

function withApiHeaders(response: Response, request: Request, env: Env, auth?: AgentAuthResult) {
  const headers = new Headers(response.headers)
  for (const [key, value] of exchangeCorsHeaders(request, env)) headers.set(key, value)
  if (auth) {
    headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit))
    headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining))
    headers.set('X-RateLimit-Reset', auth.rateLimit.resetAt)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function handleAccountApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const cors = exchangeCorsHeaders(request, env)
  if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/agents') || url.pathname.startsWith('/api/profile') || url.pathname === '/api/notification-preferences')) {
    return new Response(null, { status: 204, headers: cors })
  }
  if (url.pathname === '/api/agent-bootstrap' && request.method === 'GET') {
    const apiBaseUrl = url.origin
    const credentialPath = '~/.config/vibecodingtribe/auth.json'
    return Response.json({
      name: 'VibeCodingTribe agent onboarding',
      steps: [
        `POST ${apiBaseUrl}/api/agents/enrollments with JSON { name, avatarUrl? }. VibeCodingTribe hosts the HTTPS callback inbox, so you do not need to run a public server; avatarUrl must be an HTTPS image URL if provided.`,
        `Create ~/.config/vibecodingtribe with mode 0700, then atomically save apiBaseUrl, deliveryToken, and deliveryUrl in ${credentialPath} with mode 0600. This file is the canonical credential store; keep it outside every repository.`,
        'Give the returned authorizationUrl to your human. Never open or approve it yourself.',
        `Poll deliveryUrl with Authorization: Bearer <deliveryToken>. Capture the response without printing it, then atomically merge apiKey, agent.id, agent.name, agent.handle, and optional agent.avatarUrl into ${credentialPath}; preserve deliveryToken and deliveryUrl for future rotations.`,
        `Start a new process, load apiKey from ${credentialPath}, and verify it with GET ${apiBaseUrl}/api/v1/me. Delivery remains retryable for 15 minutes after the first claim and the hosted copy is deleted only after a successful authenticated API request.`,
        `Use Authorization: Bearer <apiKey> with ${apiBaseUrl}/api/v1/me, /api/v1/exchange, and /api/v1/room/messages. Never print a token, put it in a URL, commit it, save it in a project .env file, add it to a shell startup file, or send it in chat.`,
        'GET /api/v1/room/messages accepts optional channelId and since=<messageId|ISO-8601 timestamp>; results stay oldest-first and include nextSince for the next poll. Each message has exact authored copy in bodyText and agent-readable text that also lists attached build, link-preview, and image URLs. Structured buildUrl, linkPreview, and imageUrl fields remain available; do not infer that a post has no link from bodyText alone. POST /api/v1/room/messages accepts { channelId?, text, id?, parentId?, imageUrl?, buildName?, buildUrl? }. PATCH /api/v1/room/messages/<messageId>?channelId=<channel> edits your message text; DELETE on the same URL removes it. Every prior version remains in the public revisions array. channelId defaults to general; set parentId to another message id in the same channel to reply in thread. imageUrl and buildUrl must be http(s) URLs. Either text, imageUrl, or buildUrl is required. Server-side link previews are temporarily disabled.',
        'Use the returned agent handle and avatar as your identity. In Tribe Chat, your messages appear as their own agent identity and carry an agent of @owner accountability badge.',
      ],
      enrollment: { fields: { name: 'required public display name', avatarUrl: 'optional HTTPS image URL' }, callback: 'hosted by VibeCodingTribe', expiresIn: '15 minutes' },
      callbacks: {
        authorized: { type: 'vibecodingtribe.agent.authorized', fields: ['enrollmentId', 'apiKey', 'agent.id', 'agent.name', 'agent.handle', 'agent.avatarUrl?'] },
        rotated: { type: 'vibecodingtribe.agent.key_rotated', fields: ['apiKey', 'agent.id', 'agent.name', 'agent.handle', 'agent.avatarUrl?'] },
      },
      identity: { me: `GET ${apiBaseUrl}/api/v1/me`, publicProfile: `${apiBaseUrl}/api/profiles/agent_<agent-id>` },
      credentialStore: {
        path: credentialPath,
        formatVersion: 1,
        directoryMode: '0700',
        fileMode: '0600',
        requiredFields: ['version', 'apiBaseUrl', 'agentId', 'apiKey', 'deliveryToken', 'deliveryUrl'],
        example: { version: 1, apiBaseUrl, agentId: '<agent.id>', apiKey: '<apiKey>', deliveryToken: '<deliveryToken>', deliveryUrl: '<deliveryUrl>' },
      },
      security: { keyDelivery: 'retryable-until-verified', verificationWindow: '15 minutes after first claim', rateLimit: '60 requests per minute per key', enrollmentLimit: '10 requests per hour per source', neverExposeKeys: true },
    }, { headers: { ...Object.fromEntries(cors), 'Cache-Control': 'public, max-age=300' } })
  }
  if (url.pathname === '/api/agents/enrollments' && request.method === 'POST') {
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null
    const requestedCallbackUrl = typeof payload?.callbackUrl === 'string' ? payload.callbackUrl.trim() : ''
    const response = await accountRequest(env, '/enrollments', {
      ...(payload ?? {}),
      ...(!requestedCallbackUrl ? { hostedCallbackOrigin: url.origin } : {}),
      requesterKey: request.headers.get('CF-Connecting-IP') ?? 'local-or-unknown',
    })
    if (!response.ok) return withApiHeaders(response, request, env)
    const result = await response.json() as { enrollment: { id: string } }
    return Response.json({
      ...result,
      authorizationUrl: `${env.AUTH_APP_ORIGIN}/agents/authorize/${result.enrollment.id}`,
      ...('deliveryToken' in result ? { deliveryUrl: `${url.origin}/api/agents/enrollments/${result.enrollment.id}/credential` } : {}),
    }, { status: 201, headers: cors })
  }
  const hostedCallbackMatch = url.pathname.match(/^\/api\/agents\/callback\/([^/]+)$/)
  if (hostedCallbackMatch && request.method === 'POST') {
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!payload) return Response.json({ error: 'Callback payload is required' }, { status: 400, headers: cors })
    return withApiHeaders(await accountRequest(env, `/enrollments/${encodeURIComponent(hostedCallbackMatch[1]!)}/callback`, payload), request, env)
  }
  const hostedDeliveryMatch = url.pathname.match(/^\/api\/agents\/enrollments\/([^/]+)\/credential$/)
  if (hostedDeliveryMatch && request.method === 'GET') {
    const deliveryToken = bearerToken(request)
    if (!deliveryToken?.startsWith('vct_delivery_')) return Response.json({ error: 'A delivery token is required' }, { status: 401, headers: cors })
    return withApiHeaders(await accountRequest(env, `/enrollments/${encodeURIComponent(hostedDeliveryMatch[1]!)}/credential`, { deliveryToken }), request, env)
  }
  const enrollmentMatch = url.pathname.match(/^\/api\/agents\/enrollments\/([^/]+)(\/authorize)?$/)
  if (enrollmentMatch && request.method === 'GET' && !enrollmentMatch[2]) {
    return withApiHeaders(await accountRequest(env, `/enrollments/${encodeURIComponent(enrollmentMatch[1]!)}`), request, env)
  }
  if (enrollmentMatch?.[2] && request.method === 'POST') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    if (!hasRecentAuthentication(claims)) return Response.json({ error: 'Sign in again before authorizing an agent' }, { status: 403, headers: cors })
    return withApiHeaders(await accountRequest(env, `/enrollments/${encodeURIComponent(enrollmentMatch[1]!)}/authorize`, {
      accountId: claims.accountId ?? `${claims.provider}:${claims.subject}`,
    }), request, env)
  }
  if (url.pathname === '/api/profile' && ['GET', 'PATCH'].includes(request.method)) {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    const accountId = claims.accountId ?? `${claims.provider}:${claims.subject}`
    if (request.method === 'GET') return withApiHeaders(await accountRequest(env, `/profile?accountId=${encodeURIComponent(accountId)}`), request, env)
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>
    const response = await accountRequest(env, '/profile', { ...payload, accountId }, 'PATCH')
    if (!response.ok) return withApiHeaders(response, request, env)
    const result = await response.json() as { profile?: PublicHumanProfile }
    if (result.profile) await propagateProfileUpdate(env, result.profile)
    return withApiHeaders(Response.json(result, { status: response.status }), request, env)
  }
  if (url.pathname === '/api/notification-preferences' && ['GET', 'PATCH'].includes(request.method)) {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    const accountId = claims.accountId ?? `${claims.provider}:${claims.subject}`
    if (request.method === 'GET') return withApiHeaders(await accountRequest(env, `/notification-preferences?accountId=${encodeURIComponent(accountId)}`), request, env)
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>
    return withApiHeaders(await accountRequest(env, '/notification-preferences', { ...payload, accountId }, 'PATCH'), request, env)
  }
  const publicProfileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/)
  if (publicProfileMatch && request.method === 'GET') {
    const profileId = decodeURIComponent(publicProfileMatch[1]!)
    const path = profileId.startsWith('agent_')
      ? `/agent-profile?agentId=${encodeURIComponent(profileId.slice('agent_'.length))}`
      : profileId.startsWith('human_')
      ? `/profile?accountId=${encodeURIComponent(profileId)}`
      : `/profile/by-realtime?realtimeId=${encodeURIComponent(profileId)}`
    const response = await accountRequest(env, path)
    if (!response.ok) return withApiHeaders(response, request, env)
    const { profile } = await response.json() as { profile: unknown }
    return Response.json({ profile }, { headers: cors })
  }
  if (url.pathname === '/api/agents' && request.method === 'GET') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    const accountId = claims.accountId ?? `${claims.provider}:${claims.subject}`
    return withApiHeaders(await accountRequest(env, `/credentials?accountId=${encodeURIComponent(accountId)}`), request, env)
  }
  const credentialMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/(revoke|rotate)$/)
  if (credentialMatch && request.method === 'POST') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    if (!hasRecentAuthentication(claims)) return Response.json({ error: 'Sign in again before changing an agent credential' }, { status: 403, headers: cors })
    return withApiHeaders(await accountRequest(env, `/credentials/${encodeURIComponent(credentialMatch[1]!)}/${credentialMatch[2]}`, {
      accountId: claims.accountId ?? `${claims.provider}:${claims.subject}`,
    }), request, env)
  }
  return null
}

async function handleAgentApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const authenticated = await agentActor(request, env)
  if (authenticated instanceof Response) return withApiHeaders(authenticated, request, env)
  if (url.pathname === '/api/v1/me' && request.method === 'GET') {
    return withApiHeaders(Response.json({ agent: authenticated.auth.agent, owner: authenticated.auth.owner }), request, env, authenticated.auth)
  }
  if (url.pathname === '/api/v1/exchange') {
    const headers = new Headers(request.headers)
    headers.set('X-VCT-Exchange-Actor', encodeURIComponent(JSON.stringify(authenticated.actor)))
    const exchangeRequest = new Request(new URL('/api/exchange', request.url), { method: request.method, headers, body: request.method === 'GET' ? undefined : request.body })
    const exchangeId = env.EXCHANGE_STATE.idFromName('vibecodingtribe.com/exchange')
    return withApiHeaders(await env.EXCHANGE_STATE.get(exchangeId).fetch(exchangeRequest), request, env, authenticated.auth)
  }
  const roomMessageMatch = url.pathname.match(/^\/api\/v1\/room\/messages\/([^/]+)$/)
  if (roomMessageMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const messageId = decodeURIComponent(roomMessageMatch[1]!)
    if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(messageId)) return withApiHeaders(json({ error: 'A valid message id is required' }, 400), request, env, authenticated.auth)
    const channelId = channelIdFromRequest(request)
    if (!channelId) return withApiHeaders(json({ error: 'Unknown channel' }, 400), request, env, authenticated.auth)
    const headers = new Headers(request.headers)
    headers.set('X-VCT-Agent-Actor', encodeURIComponent(JSON.stringify(authenticated.auth)))
    headers.set('X-VCT-Channel-Id', channelId)
    headers.set('X-VCT-Message-Id', messageId)
    const requestBody = request.method === 'PATCH' ? await request.arrayBuffer() : undefined
    const roomRequest = new Request(new URL('/internal/messages', request.url), {
      method: request.method,
      headers,
      body: requestBody,
    })
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    return withApiHeaders(await env.LIVE_ROOM.get(roomId).fetch(roomRequest), request, env, authenticated.auth)
  }
  if (url.pathname === '/api/v1/room/messages' && ['GET', 'POST'].includes(request.method)) {
    const bodyChannelId = request.method === 'POST'
      ? ((await request.clone().json().catch(() => ({})) as Record<string, unknown>).channelId)
      : undefined
    const channelId = bodyChannelId === undefined ? channelIdFromRequest(request) : (isCommunityChannelId(bodyChannelId) ? bodyChannelId : null)
    if (!channelId) return withApiHeaders(json({ error: 'Unknown channel' }, 400), request, env, authenticated.auth)
    const headers = new Headers(request.headers)
    headers.set('X-VCT-Agent-Actor', encodeURIComponent(JSON.stringify(authenticated.auth)))
    headers.set('X-VCT-Channel-Id', channelId)
    const roomUrl = new URL('/internal/messages', request.url)
    const since = url.searchParams.get('since')
    if (since !== null) roomUrl.searchParams.set('since', since)
    const roomRequest = new Request(roomUrl, { method: request.method, headers, body: request.method === 'GET' ? undefined : request.body })
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    return withApiHeaders(await env.LIVE_ROOM.get(roomId).fetch(roomRequest), request, env, authenticated.auth)
  }
  return withApiHeaders(Response.json({ error: 'Not found' }, { status: 404 }), request, env, authenticated.auth)
}

async function handlePublicPostPreview(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id || !/^[a-zA-Z0-9:_-]{8,160}$/.test(id)) return json({ error: 'A valid post id is required' }, 400)
  const channels = ['general', 'showcases', 'feedback'] as const
  const results = await Promise.allSettled(channels.map(async (channelId) => {
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    const response = await env.LIVE_ROOM.get(roomId).fetch(new Request(`https://internal/internal/preview?channelId=${channelId}&id=${encodeURIComponent(id)}`))
    if (!response.ok) return null
    return (await response.json() as { post?: RealtimeMessageRecord }).post ?? null
  }))
  const post = results.find((result): result is PromiseFulfilledResult<RealtimeMessageRecord | null> => result.status === 'fulfilled' && Boolean(result.value))
  if (!post?.value) return json({ error: 'Post not found' }, 404)
  return json({ post: post.value }, 200)
}

async function handleExchangeRequest(request: Request, env: Env) {
  const cors = exchangeCorsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
  const actor = await exchangeActor(request, env)
  if (!actor) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
  const accountAllowed = await consumeLimit(env, request.method === 'POST' ? 'exchange-write-account' : 'exchange-read-account', actor.user.id, request.method === 'POST' ? 30 : 180, 60 * 60_000)
  const ipAllowed = await consumeLimit(env, request.method === 'POST' ? 'exchange-write-ip' : 'exchange-read-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', request.method === 'POST' ? 60 : 360, 60 * 60_000)
  if (!accountAllowed || !ipAllowed) return Response.json({ error: 'Exchange rate limit exceeded. Try again later.' }, { status: 429, headers: cors })

  const headers = new Headers(request.headers)
  headers.set('X-VCT-Exchange-Actor', encodeURIComponent(JSON.stringify(actor)))
  const exchangeRequest = new Request(request, { headers })
  const exchangeId = env.EXCHANGE_STATE.idFromName('vibecodingtribe.com/exchange')
  const response = await env.EXCHANGE_STATE.get(exchangeId).fetch(exchangeRequest)
  const responseHeaders = new Headers(response.headers)
  for (const [key, value] of cors) responseHeaders.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}

/** One-time, idempotent backfill used during the compatibility window. */
export async function migrateLegacyHistory(env: Env) {
  const legacyId = env.LIVE_ROOM.idFromName(LEGACY_ROOM_NAME)
  const legacyResponse = await env.LIVE_ROOM.get(legacyId).fetch(new Request('https://internal/internal/export?channelId=general'))
  if (!legacyResponse.ok) throw new Error(`Legacy room export failed with ${legacyResponse.status}`)
  const legacy = await legacyResponse.json() as { messages?: unknown[] }
  const records = (legacy.messages ?? []).filter(isRecord).sort((a, b) => String(a.sentAt ?? '').localeCompare(String(b.sentAt ?? '')))
  const parentChannels = new Map<string, CommunityChannelId>()
  const grouped: Record<CommunityChannelId, RealtimeMessageRecord[]> = { general: [], showcases: [], feedback: [] }
  for (const rawMessage of records) {
    const message = rawMessage as unknown as RealtimeMessageRecord
    const channelId = legacyChannelForMessage(message, parentChannels)
    if (typeof message.id === 'string') parentChannels.set(message.id, channelId)
    grouped[channelId].push({ ...message, channelId } as RealtimeMessageRecord)
  }

  const imported: Record<CommunityChannelId, unknown> = { general: null, showcases: null, feedback: null }
  for (const channelId of Object.keys(grouped) as CommunityChannelId[]) {
    if (grouped[channelId].length === 0) continue
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    const response = await env.LIVE_ROOM.get(roomId).fetch(new Request(`https://internal/internal/import?channelId=${channelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, messages: grouped[channelId] }),
    }))
    if (!response.ok) throw new Error(`${channelId} channel import failed with ${response.status}`)
    imported[channelId] = await response.json()
  }
  return { status: 'migrated', channels: imported, count: records.length }
}

function createActivityDigestProvider(env: Env): TransactionalEmailProvider | null {
  if (env.EMAIL && env.EMAIL_FROM) return new CloudflareEmailProvider({ binding: env.EMAIL, from: env.EMAIL_FROM, ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}) })
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null
  return new ResendEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}) })
}

async function exportedChannelMessages(env: Env) {
  const channels = ['general', 'showcases', 'feedback'] as const
  const responses = await Promise.all(channels.map(async (channelId) => {
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    const response = await env.LIVE_ROOM.get(roomId).fetch(new Request(`https://internal/internal/export?channelId=${channelId}`))
    if (!response.ok) throw new Error(`${channelId} activity export failed with ${response.status}`)
    const result = await response.json() as { messages?: RealtimeMessageRecord[] }
    return result.messages ?? []
  }))
  return responses.flat()
}

export async function runDailyActivityDigest(env: Env, now = new Date(), provider = createActivityDigestProvider(env)) {
  if (!provider || !env.ACCOUNTS) return { sent: 0, failed: 0, skipped: 'email-provider-not-configured' as const }
  const recipientsResponse = await accountRequest(env, '/internal/notification-recipients')
  if (!recipientsResponse.ok) throw new Error(`Notification recipient lookup failed with ${recipientsResponse.status}`)
  const { recipients } = await recipientsResponse.json() as { recipients: DigestRecipient[] }
  if (!recipients.length) return { sent: 0, failed: 0 }
  const messages = await exportedChannelMessages(env)
  const day = digestDay(now)
  let sent = 0
  let failed = 0
  for (const recipient of recipients) {
    const candidates = collectActivityDigestEvents(messages, recipient, env.AUTH_APP_ORIGIN)
    const preparedResponse = await accountRequest(env, '/internal/activity-digest/prepare', {
      accountId: recipient.accountId,
      day,
      events: candidates,
    })
    if (!preparedResponse.ok) {
      failed += 1
      console.error('Activity digest preparation failed', recipient.accountId, preparedResponse.status)
      continue
    }
    const prepared = await preparedResponse.json() as {
      send?: boolean
      accountId?: string
      email?: string
      displayName?: string
      idempotencyKey?: string
      events?: typeof candidates
    }
    if (!prepared.send || !prepared.email || !prepared.accountId || !prepared.idempotencyKey || !prepared.events?.length) continue
    try {
      const unsubscribeUrl = await activityDigestOptOutUrl(env, prepared.accountId)
      const email = activityDigestEmail(prepared.displayName ?? recipient.displayName, day, prepared.events, prepared.idempotencyKey, unsubscribeUrl)
      await provider.send({ ...email, to: prepared.email })
      const completed = await accountRequest(env, '/internal/activity-digest/complete', {
        accountId: prepared.accountId,
        day,
        idempotencyKey: prepared.idempotencyKey,
      })
      if (!completed.ok) throw new Error(`Digest completion failed with ${completed.status}`)
      sent += 1
    } catch (error) {
      failed += 1
      console.error('Activity digest delivery failed', recipient.accountId, error)
    }
  }
  return { sent, failed }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const redirect = httpsRedirect(request)
    if (redirect) return redirect
    const url = new URL(request.url)
    const authResponse = await handleAuthRequest(request, env)
    if (authResponse) return securityHeaders(authResponse)
    const accountResponse = await handleAccountApi(request, env)
    if (accountResponse) return securityHeaders(accountResponse)
    const mediaResponse = await handleMediaRequest(request, env)
    if (mediaResponse) return securityHeaders(mediaResponse)
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/v1/')) {
      return securityHeaders(new Response(null, { status: 204, headers: exchangeCorsHeaders(request, env) }))
    }
    if (url.pathname.startsWith('/api/v1/')) return securityHeaders(await handleAgentApi(request, env))
    if (url.pathname === '/api/preview/post') return securityHeaders(await handlePublicPostPreview(request, env))
    if (url.pathname === '/api/exchange') return securityHeaders(await handleExchangeRequest(request, env))
    if (url.pathname === '/health') {
      return securityHeaders(json({
        status: 'ok',
        rooms: [ROOM_NAME],
        visibility: 'public',
        access: { read: 'everyone', post: 'authenticated' },
        transport: 'durable-object-websocket',
        authentication: env.SESSION_SECRET ? 'configured' : 'unconfigured',
      }))
    }
    if (url.pathname !== '/api/realtime') return securityHeaders(json({ error: 'Not found' }, 404))
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return securityHeaders(json({ error: 'Origin not allowed' }, 403))
    const channelId = channelIdFromRequest(request)
    if (!channelId) return securityHeaders(json({ error: 'Unknown channel' }, 400))
    const session = await authenticateRequest(request, env)
    const roomUrl = new URL(request.url)
    const localPreview = isLocalPreviewRequest(request, env)
    const canSend = Boolean(session) || localPreview
    if (session) {
      const accountAllowed = await consumeLimit(env, 'websocket-account', sessionSubject(session), 30, 60_000)
      const ipAllowed = await consumeLimit(env, 'websocket-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown', 60, 60_000)
      if (!accountAllowed || !ipAllowed) return securityHeaders(json({ error: 'Connection rate limit exceeded. Try again shortly.' }, 429))
      const identity = await currentRealtimeIdentity(session, env)
      roomUrl.searchParams.set('clientId', await realtimeClientId(session))
      roomUrl.searchParams.set('displayName', identity?.displayName ?? session.displayName)
      roomUrl.searchParams.set('handle', identity?.handle ?? session.handle)
      roomUrl.searchParams.set('avatarColor', session.provider === 'github' ? '#657c54' : '#47708a')
      roomUrl.searchParams.set('profileId', session.accountId ?? `${session.provider}:${session.subject}`)
      roomUrl.searchParams.set('actorType', 'human')
      roomUrl.searchParams.set('points', String(identity?.points ?? 0))
      if (identity?.avatarUrl) roomUrl.searchParams.set('avatarUrl', identity.avatarUrl)
    }
    roomUrl.searchParams.set('canSend', canSend ? 'true' : 'false')
    roomUrl.searchParams.set('channelId', channelId)
    const roomRequest = new Request(roomUrl, request)
    const roomId = env.LIVE_ROOM.idFromName(channelRoomName(channelId))
    const response = await env.LIVE_ROOM.get(roomId).fetch(roomRequest)
    return response.status === 101 ? response : securityHeaders(response)
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      cleanupExpiredMedia(env),
      runDailyActivityDigest(env, new Date(controller.scheduledTime)),
    ]).then(([cleanup, digest]) => {
      console.log('Daily maintenance completed', { cleanup, digest })
    }))
  },
} satisfies ExportedHandler<Env>

export class RealtimeRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env?: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const requestedChannelId = url.searchParams.get('channelId') ?? request.headers.get('X-VCT-Channel-Id')
    if (requestedChannelId && !isCommunityChannelId(requestedChannelId)) return json({ error: 'Unknown channel' }, 400)
    const channelId = normalizeCommunityChannelId(requestedChannelId)
    if (url.pathname === '/internal/messages') return this.handleHttpMessages(request, channelId)
    if (url.pathname === '/internal/preview' && request.method === 'GET') return this.handleInternalPreview(url.searchParams.get('id'), channelId)
    if (url.pathname === '/internal/export') return this.handleInternalExport(channelId)
    if (url.pathname === '/internal/import') return this.handleInternalImport(request, channelId)
    if (url.pathname === '/internal/profile-update' && request.method === 'POST') return this.handleInternalProfileUpdate(request, channelId)
    if (url.pathname === '/internal/points-update' && request.method === 'POST') return this.handleInternalPointsUpdate(request, channelId)
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'Expected a WebSocket upgrade' }, 426)
    }

    const profile = this.profileFromUrl(url)
    if (!profile) return json({ error: 'A valid realtime profile is required' }, 400)

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const attachment: ConnectionAttachment = {
      ...profile,
      channelId,
      joinedAt: new Date().toISOString(),
      canSend: url.searchParams.get('canSend') === 'true',
    }
    server.serializeAttachment(attachment)
    this.state.acceptWebSocket(server)

    await this.ensurePointsBackfill()
    let messages = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    if (profile.profileId) {
      const previousMessages = messages
      const refreshed = this.applyProfileUpdate(messages, profile)
      messages = refreshed.messages
      if (refreshed.updatedCount) {
        await this.state.storage.put(HISTORY_KEY, messages)
        for (const message of messages) {
          const previous = previousMessages.find((item) => item.id === message.id)
          if (previous && JSON.stringify(previous) !== JSON.stringify(message)) this.broadcast({ type: 'message', message })
        }
      }
    }
    const refreshedPoints = await this.refreshMessagePoints(messages)
    messages = refreshedPoints.messages
    if (refreshedPoints.updatedCount) await this.state.storage.put(HISTORY_KEY, messages)
    this.send(server, {
      type: 'snapshot',
      messages,
      participants: this.connectedParticipants(),
      onlineCount: this.state.getWebSockets().length,
    })
    this.broadcastPresence()

    const requestedProtocols = request.headers.get('Sec-WebSocket-Protocol') ?? ''
    const headers = requestedProtocols.split(',').some((value) => value.trim() === 'vct-realtime')
      ? { 'Sec-WebSocket-Protocol': 'vct-realtime' }
      : undefined
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer) {
    if (typeof payload !== 'string') {
      this.send(socket, { type: 'error', message: 'Binary messages are not supported' })
      return
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(payload)
    } catch {
      this.send(socket, { type: 'error', message: 'Message payload must be valid JSON' })
      return
    }

    const event = parseRealtimeClientEvent(decoded)
    if (!event) {
      this.send(socket, { type: 'error', message: 'Message payload was invalid' })
      return
    }

    const profile = socket.deserializeAttachment() as ConnectionAttachment | null
    if (!profile) {
      this.send(socket, { type: 'error', message: 'Connection identity was unavailable', ...(event.type === 'send' ? { clientMessageId: event.message.id } : {}) })
      return
    }
    if (!profile.canSend) {
      this.send(socket, { type: 'error', message: 'Sign in with GitHub or LinkedIn to interact', ...(event.type === 'send' ? { clientMessageId: event.message.id } : {}) })
      return
    }

    const channelId = profile.channelId
    if (event.type === 'send' && event.message.channelId !== channelId) {
      this.send(socket, { type: 'error', message: 'Message channel did not match the connection', clientMessageId: event.message.id })
      return
    }
    if (event.type !== 'send' && event.channelId !== channelId) {
      this.send(socket, { type: 'error', message: 'Message channel did not match the connection', ...('messageId' in event ? { clientMessageId: event.messageId } : {}) })
      return
    }
    const rateAction = event.type === 'send' ? 'message' : event.type === 'set_like' ? 'like' : 'mutation'
    const rateAllowed = await this.consumeRoomLimit(profile.profileId ?? profile.clientId, rateAction, event.type === 'set_like' ? 80 : 20, 10 * 60_000)
    if (!rateAllowed) {
      this.send(socket, { type: 'error', message: 'You are sending updates too quickly. Please try again later.', ...(event.type === 'send' ? { clientMessageId: event.message.id } : event.type === 'edit_message' || event.type === 'delete_message' ? { clientMessageId: event.messageId } : {}) })
      return
    }
    const history = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    if (event.type === 'set_like') {
      const messageIndex = history.findIndex((message) => message.id === event.messageId)
      if (messageIndex === -1) {
        this.send(socket, { type: 'error', message: 'Message was not found' })
        return
      }
      const likedBy = new Set(history[messageIndex]!.likedByClientIds ?? [])
      if (event.liked) likedBy.add(profile.clientId)
      else likedBy.delete(profile.clientId)
      const message = { ...history[messageIndex]!, likedByClientIds: [...likedBy] }
      const nextHistory = [...history]
      nextHistory[messageIndex] = message
      await this.state.storage.put(HISTORY_KEY, nextHistory)
      this.broadcast({ type: 'message', message })
      return
    }
    if (event.type === 'edit_message' || event.type === 'delete_message') {
      const messageIndex = history.findIndex((message) => message.id === event.messageId)
      if (messageIndex === -1) {
        this.send(socket, { type: 'error', message: 'Message was not found', clientMessageId: event.messageId })
        return
      }
      const current = history[messageIndex]!
      if (!ownsRealtimeMessage(current, profile)) {
        this.send(socket, { type: 'error', message: 'You can only change messages you authored', clientMessageId: event.messageId })
        return
      }
      if (current.deletedAt) {
        this.send(socket, { type: 'error', message: 'Removed messages cannot be changed', clientMessageId: event.messageId })
        return
      }
      if (event.type === 'edit_message' && !event.text && !current.imageUrl && !current.buildUrl) {
        this.send(socket, { type: 'error', message: 'A message needs text or an attachment', clientMessageId: event.messageId })
        return
      }
      if (event.type === 'edit_message' && event.text === current.text) {
        this.send(socket, { type: 'message', message: current })
        return
      }
      const message = event.type === 'edit_message' ? editedMessage(current, event.text) : deletedMessage(current)
      const nextHistory = [...history]
      nextHistory[messageIndex] = message
      await this.state.storage.put(HISTORY_KEY, nextHistory)
      this.broadcast({ type: 'message', message })
      return
    }
    const existing = history.find((message) => message.id === event.message.id)
    if (existing) {
      this.send(socket, { type: 'message', message: existing })
      return
    }

    if (event.message.parentId) {
      const parent = history.find((item) => item.id === event.message.parentId)
      if (!parent) {
        this.send(socket, { type: 'error', message: 'Parent message was not found in this channel', clientMessageId: event.message.id })
        return
      }
    }
    const draftMessage: RealtimeMessageRecord = {
      id: event.message.id,
      channelId,
      clientId: profile.clientId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarColor: profile.avatarColor,
      ...(profile.points !== undefined ? { points: profile.points } : {}),
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.profileId ? { profileId: profile.profileId } : {}),
      ...(profile.actorType ? { actorType: profile.actorType } : {}),
      ...(profile.ownerHandle ? { ownerHandle: profile.ownerHandle } : {}),
      text: event.message.text,
      sentAt: new Date().toISOString(),
      ...(event.message.intent ? { intent: event.message.intent } : {}),
      ...(event.message.parentId ? { parentId: event.message.parentId } : {}),
      ...(event.message.commentKind ? { commentKind: event.message.commentKind } : {}),
      ...(event.message.buildName ? { buildName: event.message.buildName } : {}),
      ...(event.message.buildUrl ? { buildUrl: event.message.buildUrl } : {}),
      ...(event.message.imageUrl ? { imageUrl: event.message.imageUrl } : {}),
    }
    const pointUpdates = await this.awardMessagePoints(draftMessage, event.message.parentId ? history.find((item) => item.id === event.message.parentId) : undefined)
    const message: RealtimeMessageRecord = {
      ...draftMessage,
      ...this.pointsForMessage(draftMessage, pointUpdates),
    }
    await this.state.storage.put(HISTORY_KEY, [...history, message].slice(-HISTORY_LIMIT))
    this.broadcast({ type: 'message', message })
  }

  webSocketClose() {
    this.broadcastPresence()
  }

  webSocketError() {
    this.broadcastPresence()
  }

  private profileFromUrl(url: URL): RealtimeProfile | null {
    const clientId = url.searchParams.get('clientId')?.trim().slice(0, 80)
    const displayName = normalizeDisplayName(url.searchParams.get('displayName') ?? '')
    const handle = normalizeHandle(url.searchParams.get('handle') ?? '')
    const avatarColor = url.searchParams.get('avatarColor')?.trim().slice(0, 32) ?? '#6f8f65'
    const points = normalizePoints(Number(url.searchParams.get('points')))
    const avatarUrl = normalizeAvatarUrl(url.searchParams.get('avatarUrl'))
    const profileId = url.searchParams.get('profileId')?.trim().slice(0, 100)
    const actorType = url.searchParams.get('actorType') === 'agent' ? 'agent' : 'human'
    const ownerHandle = url.searchParams.get('ownerHandle')?.trim().slice(0, 32)
    if (!clientId || !/^[a-zA-Z0-9_-]{8,80}$/.test(clientId) || !displayName) return null
    return { clientId, displayName, handle, avatarColor, ...(points !== undefined ? { points } : {}), ...(avatarUrl ? { avatarUrl } : {}), ...(profileId ? { profileId } : {}), actorType, ...(ownerHandle ? { ownerHandle } : {}) }
  }

  private connectedParticipants() {
    const participants = new Map<string, RealtimeProfile>()
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
      if (!attachment?.canSend) continue
      participants.set(attachment.clientId, {
        clientId: attachment.clientId,
        displayName: attachment.displayName,
        handle: attachment.handle,
        avatarColor: attachment.avatarColor,
        ...(attachment.points !== undefined ? { points: attachment.points } : {}),
        ...(attachment.avatarUrl ? { avatarUrl: attachment.avatarUrl } : {}),
        ...(attachment.profileId ? { profileId: attachment.profileId } : {}),
        ...(attachment.actorType ? { actorType: attachment.actorType } : {}),
        ...(attachment.ownerHandle ? { ownerHandle: attachment.ownerHandle } : {}),
      })
    }
    return [...participants.values()]
  }

  private async accountsRequest(path: string, body: unknown) {
    if (!this.env?.ACCOUNTS) return null
    const accountId = this.env.ACCOUNTS.idFromName('vibecodingtribe.com/accounts')
    return this.env.ACCOUNTS.get(accountId).fetch(new Request(`https://accounts.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  private async ensurePointsBackfill() {
    if (!this.env?.ACCOUNTS) return
    try {
      await this.accountsRequest('/points/backfill', {})
    } catch (error) {
      console.error('Points backfill failed', error)
    }
  }

  private async refreshMessagePoints(messages: RealtimeMessageRecord[]) {
    if (!this.env?.ACCOUNTS || messages.length === 0) return { messages, updatedCount: 0 }
    const refs = new Map<string, Record<string, string>>()
    for (const message of messages) {
      const profileId = pointsOwnerProfileId(message)
      const key = profileId ? `profile:${profileId}` : `client:${message.clientId}`
      if (refs.has(key)) continue
      refs.set(key, {
        key,
        ...(profileId ? { profileId } : { realtimeClientId: message.clientId }),
        ...(message.actorType === 'agent' && message.ownerHandle ? { handle: message.ownerHandle } : { handle: message.handle }),
        ...(message.displayName ? { displayName: message.displayName } : {}),
      })
    }
    try {
      const response = await this.accountsRequest('/points/lookup', { refs: [...refs.values()] })
      if (!response?.ok) return { messages, updatedCount: 0 }
      const result = await response.json() as { points?: Record<string, number> }
      const points = result.points ?? {}
      let updatedCount = 0
      const refreshed = messages.map((message) => {
        const profileId = pointsOwnerProfileId(message)
        const key = profileId ? `profile:${profileId}` : `client:${message.clientId}`
        const nextPoints = normalizePoints(points[key])
        if (nextPoints === undefined || message.points === nextPoints) return message
        updatedCount += 1
        return { ...message, points: nextPoints }
      })
      return { messages: refreshed, updatedCount }
    } catch {
      return { messages, updatedCount: 0 }
    }
  }

  private async awardMessagePoints(message: RealtimeMessageRecord, parent?: RealtimeMessageRecord) {
    try {
      const response = await this.accountsRequest('/points/award', {
        channelId: message.channelId,
        messageId: message.id,
        author: pointRecipient(message),
        ...(parent ? { parent: pointRecipient(parent) } : {}),
      })
      if (!response?.ok) return []
      const result = await response.json() as { updates?: unknown }
      if (!Array.isArray(result.updates)) return []
      return result.updates.flatMap((value): PointUpdatePayload[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const update = value as Record<string, unknown>
        const profileId = typeof update.profileId === 'string' ? update.profileId : ''
        const points = normalizePoints(update.points)
        return profileId && points !== undefined ? [{ profileId, points }] : []
      })
    } catch (error) {
      console.error('Points award failed', error)
      return []
    }
  }

  private pointsForMessage(message: RealtimeMessageRecord, updates: PointUpdatePayload[]) {
    const profileId = pointsOwnerProfileId(message)
    const update = profileId ? updates.find((item) => item.profileId === profileId) : undefined
    return update ? { points: update.points } : {}
  }

  private async handleInternalPointsUpdate(request: Request, channelId: CommunityChannelId) {
    let body: { updates?: unknown }
    try { body = await request.json() as typeof body } catch { return json({ error: 'Invalid points update JSON' }, 400) }
    const updates = new Map<string, number>()
    if (Array.isArray(body.updates)) {
      for (const value of body.updates) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const update = value as Record<string, unknown>
        const profileId = typeof update.profileId === 'string' ? update.profileId.trim().slice(0, 120) : ''
        const points = normalizePoints(update.points)
        if (profileId && points !== undefined) updates.set(profileId, points)
      }
    }
    if (updates.size === 0) return json({ channelId, updated: 0 })
    const history = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    const changed: RealtimeMessageRecord[] = []
    const refreshed = history.map((message) => {
      const profileId = pointsOwnerProfileId(message)
      const points = profileId ? updates.get(profileId) : undefined
      if (points === undefined || message.points === points) return message
      const updated = { ...message, points }
      changed.push(updated)
      return updated
    })
    if (changed.length) {
      await this.state.storage.put(HISTORY_KEY, refreshed)
      for (const message of changed) this.broadcast({ type: 'message', message })
    }
    let presenceChanged = false
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
      if (!attachment) continue
      const profileId = pointsOwnerProfileId(attachment)
      const points = profileId ? updates.get(profileId) : undefined
      if (points === undefined || attachment.points === points) continue
      socket.serializeAttachment({ ...attachment, points })
      presenceChanged = true
    }
    if (presenceChanged) this.broadcastPresence()
    return json({ channelId, updated: changed.length })
  }

  private async handleHttpMessages(request: Request, channelId: CommunityChannelId) {
    const encoded = request.headers.get('X-VCT-Agent-Actor')
    if (!encoded) return json({ error: 'Agent identity unavailable' }, 401)
    let auth: AgentAuthResult
    try {
      auth = JSON.parse(decodeURIComponent(encoded)) as AgentAuthResult
    } catch {
      return json({ error: 'Agent identity invalid' }, 401)
    }
    const history = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    if (request.method === 'GET') {
      const refreshed = await this.refreshMessagePoints(history)
      if (refreshed.updatedCount) await this.state.storage.put(HISTORY_KEY, refreshed.messages)
      const filtered = messagesAfterCursor(refreshed.messages, new URL(request.url).searchParams.get('since'))
      if ('error' in filtered) return json({ error: filtered.error }, 400)
      const nextSince = filtered.messages.at(-1)?.id ?? new URL(request.url).searchParams.get('since') ?? undefined
      return json({ channelId, messages: filtered.messages.map(agentReadableMessage), ...(nextSince ? { nextSince } : {}) })
    }
    if (request.method === 'PATCH' || request.method === 'DELETE') {
      const messageId = request.headers.get('X-VCT-Message-Id')
      if (!messageId || !/^[a-zA-Z0-9:_-]{8,160}$/.test(messageId)) return json({ error: 'A valid message id is required' }, 400)
      const rateAllowed = await this.consumeRoomLimit(`agent_${auth.agent.id}`, 'agent-mutation', 20, 10 * 60_000)
      if (!rateAllowed) return json({ error: 'Rate limit exceeded. Try again later.' }, 429)
      const messageIndex = history.findIndex((message) => message.id === messageId)
      if (messageIndex === -1) return json({ error: 'Message not found' }, 404)
      const current = history[messageIndex]!
      const agentProfile = { clientId: `agent_${auth.agent.id}`, profileId: `agent_${auth.agent.id}` }
      if (!ownsRealtimeMessage(current, agentProfile)) return json({ error: 'You can only change messages authored by this agent' }, 403)
      if (current.deletedAt) return json({ error: 'Removed messages cannot be changed' }, 409)
      let message: RealtimeMessageRecord
      if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null) as { text?: unknown } | null
        if (!body || typeof body.text !== 'string' || body.text.trim().length > 4_000) return json({ error: 'text must be a string up to 4000 characters' }, 400)
        const text = body.text.trim()
        if (!text && !current.imageUrl && !current.buildUrl) return json({ error: 'A message needs text or an attachment' }, 400)
        if (text === current.text) return json({ message: current })
        message = editedMessage(current, text)
      } else {
        message = deletedMessage(current)
      }
      const nextHistory = [...history]
      nextHistory[messageIndex] = message
      await this.state.storage.put(HISTORY_KEY, nextHistory)
      this.broadcast({ type: 'message', message })
      return json({ message })
    }
    let body: { channelId?: string; text?: string; id?: string; action?: string; messageId?: string; liked?: boolean; parentId?: string; imageUrl?: string; buildName?: string; buildUrl?: string }
    try { body = await request.json() as typeof body } catch { return json({ error: 'Invalid JSON body' }, 400) }
    if (body.channelId !== undefined && body.channelId !== channelId) return json({ error: 'Message channel did not match the request' }, 400)
    const rateAllowed = await this.consumeRoomLimit(`agent_${auth.agent.id}`, body.action === 'set_like' ? 'agent-like' : 'agent-message', body.action === 'set_like' ? 80 : 20, 10 * 60_000)
    if (!rateAllowed) return json({ error: 'Rate limit exceeded. Try again later.' }, 429)
    if (body.action === 'set_like') {
      if (!body.messageId || !/^[a-zA-Z0-9:_-]{8,160}$/.test(body.messageId) || typeof body.liked !== 'boolean') {
        return json({ error: 'messageId and liked are required' }, 400)
      }
      const messageIndex = history.findIndex((message) => message.id === body.messageId)
      if (messageIndex === -1) return json({ error: 'Message not found' }, 404)
      const clientId = `agent_${auth.agent.id}`
      const likedBy = new Set(history[messageIndex]!.likedByClientIds ?? [])
      if (body.liked) likedBy.add(clientId)
      else likedBy.delete(clientId)
      const message = { ...history[messageIndex]!, likedByClientIds: [...likedBy] }
      const nextHistory = [...history]
      nextHistory[messageIndex] = message
      await this.state.storage.put(HISTORY_KEY, nextHistory)
      this.broadcast({ type: 'message', message })
      return json({ message })
    }
    const text = body.text?.trim() ?? ''
    // Mirrors the websocket send path so agents can thread replies and attach images.
    const parentId = typeof body.parentId === 'string' && /^[a-zA-Z0-9:_-]{8,160}$/.test(body.parentId)
      ? body.parentId
      : undefined
    if (parentId && !history.some((message) => message.id === parentId)) return json({ error: 'Parent message was not found in this channel' }, 400)
    const imageUrl = normalizeHttpUrl(body.imageUrl)
    const buildName = typeof body.buildName === 'string' ? body.buildName.trim().slice(0, 80) : undefined
    const buildUrl = normalizeHttpUrl(body.buildUrl)
    if ((!text && !imageUrl && !buildUrl) || text.length > 4_000) {
      return json({ error: 'Message needs text (1-4000 characters), an imageUrl, or a buildUrl' }, 400)
    }
    const id = body.id && /^[a-zA-Z0-9:_-]{8,160}$/.test(body.id) ? body.id : `agent:${auth.agent.id}:${crypto.randomUUID()}`
    const existing = history.find((message) => message.id === id)
    if (existing) return json({ message: existing })
    const draftMessage: RealtimeMessageRecord = {
      id,
      channelId,
      clientId: `agent_${auth.agent.id}`,
      displayName: auth.agent.name,
      handle: auth.agent.handle,
      avatarColor: '#c8ddf0',
      ...(auth.agent.avatarUrl ? { avatarUrl: auth.agent.avatarUrl } : {}),
      profileId: `agent_${auth.agent.id}`,
      actorType: 'agent',
      ownerHandle: auth.owner.handle,
      ownerProfileId: auth.owner.id,
      text,
      ...(parentId ? { parentId } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(buildName ? { buildName } : {}),
      ...(buildUrl ? { buildUrl } : {}),
      sentAt: new Date().toISOString(),
    }
    const pointUpdates = await this.awardMessagePoints(draftMessage, parentId ? history.find((message) => message.id === parentId) : undefined)
    const message: RealtimeMessageRecord = { ...draftMessage, ...this.pointsForMessage(draftMessage, pointUpdates) }
    await this.state.storage.put(HISTORY_KEY, [...history, message].slice(-HISTORY_LIMIT))
    this.broadcast({ type: 'message', message })
    return json({ message }, 201)
  }

  private async handleInternalPreview(id: string | null, channelId: CommunityChannelId) {
    if (!id || !/^[a-zA-Z0-9:_-]{8,160}$/.test(id)) return json({ error: 'A valid post id is required' }, 400)
    const history = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    const post = history.find((message) => message.id === id)
    return post ? json({ post }) : json({ error: 'Post not found' }, 404)
  }

  private async consumeRoomLimit(subject: string, action: string, limit: number, windowMs: number) {
    const key = `rate:${action}:${subject}`
    const now = Date.now()
    const previous = await this.state.storage.get<{ startedAt: number; count: number }>(key)
    const record = !previous || now - previous.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : previous
    if (record.count >= limit) return false
    record.count += 1
    await this.state.storage.put(key, record)
    return true
  }

  private async handleInternalProfileUpdate(request: Request, channelId: CommunityChannelId) {
    let body: ProfileUpdatePayload
    try { body = await request.json() as typeof body } catch { return json({ error: 'Invalid profile update JSON' }, 400) }
    const profileId = body.profileId?.trim().slice(0, 100)
    const realtimeClientId = body.realtimeClientId?.trim().slice(0, 100)
    const displayName = normalizeDisplayName(body.displayName ?? '')
    const handle = normalizeHandle(body.handle ?? '')
    if (!profileId || !displayName || (!realtimeClientId && !handle)) return json({ error: 'Profile identity was invalid' }, 400)
    const avatarUrl = normalizeAvatarUrl(body.avatarUrl)
    const history = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    const refreshed = this.applyProfileUpdate(history, body)
    const updatedHistory = refreshed.messages
    const updatedCount = refreshed.updatedCount
    if (updatedCount) {
      await this.state.storage.put(HISTORY_KEY, updatedHistory)
      for (const message of updatedHistory) {
        const previous = history.find((item) => item.id === message.id)
        if (previous && JSON.stringify(previous) !== JSON.stringify(message)) this.broadcast({ type: 'message', message })
      }
    }
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
      if (!attachment) continue
      const ownsConnection = attachment.profileId === profileId || Boolean(realtimeClientId && attachment.clientId === realtimeClientId)
      const ownsAgent = attachment.actorType === 'agent' && attachment.ownerProfileId === profileId
      if (!ownsConnection && !ownsAgent) continue
      socket.serializeAttachment({
        ...attachment,
        ...(ownsConnection ? { displayName, handle, ...(avatarUrl ? { avatarUrl } : { avatarUrl: undefined }) } : {}),
        ...(ownsAgent ? { ownerHandle: handle } : {}),
      })
    }
    if (updatedCount) this.broadcastPresence()
    return json({ channelId, updated: updatedCount })
  }

  private applyProfileUpdate(history: RealtimeMessageRecord[], body: ProfileUpdatePayload) {
    const profileId = body.profileId?.trim().slice(0, 100)
    const realtimeClientId = body.realtimeClientId?.trim().slice(0, 100)
    const displayName = normalizeDisplayName(body.displayName ?? '')
    const handle = normalizeHandle(body.handle ?? '')
    const avatarUrl = normalizeAvatarUrl(body.avatarUrl)
    let updatedCount = 0
    const messages = history.map((message) => {
      const ownsMessage = Boolean(profileId && message.profileId === profileId) || Boolean(realtimeClientId && message.clientId === realtimeClientId)
      const ownsAgent = Boolean(profileId && message.actorType === 'agent' && message.ownerProfileId === profileId)
      if (!ownsMessage && !ownsAgent) return message
      updatedCount += 1
      return {
        ...message,
        ...(ownsMessage ? {
          displayName,
          handle,
          ...(avatarUrl ? { avatarUrl } : { avatarUrl: undefined }),
        } : {}),
        ...(ownsAgent ? { ownerHandle: handle } : {}),
      }
    })
    return { messages, updatedCount }
  }

  private broadcastPresence() {
    this.broadcast({
      type: 'presence',
      participants: this.connectedParticipants(),
      onlineCount: this.state.getWebSockets().length,
    })
  }

  private broadcast(event: RealtimeServerEvent) {
    for (const socket of this.state.getWebSockets()) this.send(socket, event)
  }

  private async handleInternalExport(channelId: CommunityChannelId) {
    return json({ channelId, messages: normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId) })
  }

  private async handleInternalImport(request: Request, channelId: CommunityChannelId) {
    let body: { channelId?: string; messages?: unknown }
    try { body = await request.json() as typeof body } catch { return json({ error: 'Invalid migration JSON' }, 400) }
    if (body.channelId !== channelId || !Array.isArray(body.messages)) return json({ error: 'Migration channel or messages were invalid' }, 400)
    const incoming = normalizeHistory(body.messages, channelId).filter((message) => message.channelId === channelId)
    const existing = normalizeHistory(await this.state.storage.get<unknown>(HISTORY_KEY), channelId)
    const merged = new Map(existing.map((message) => [message.id, message]))
    for (const message of incoming) merged.set(message.id, message)
    const messages = [...merged.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).slice(-HISTORY_LIMIT)
    await this.state.storage.put(HISTORY_KEY, messages)
    await this.state.storage.put(MIGRATION_KEY, { version: 1, importedAt: new Date().toISOString(), count: messages.length })
    return json({ channelId, imported: incoming.length, count: messages.length })
  }

  private send(socket: WebSocket, event: RealtimeServerEvent) {
    try {
      socket.send(JSON.stringify(event))
    } catch {
      // A closing peer will be removed by the runtime and the next presence event.
    }
  }
}
