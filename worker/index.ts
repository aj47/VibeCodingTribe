import type { RealtimeMessageRecord, RealtimeProfile, RealtimeServerEvent } from '../src/realtime/protocol'
import {
  LIVE_ROOM_KEY,
  normalizeAvatarUrl,
  normalizeDisplayName,
  normalizeHandle,
  normalizeHttpUrl,
  parseRealtimeClientEvent,
} from '../src/realtime/protocol'
import { authenticateRequest, handleAuthRequest, realtimeClientId, type AuthEnv } from './auth'
import { accountRequest } from './auth'
import type { AgentAuthResult } from './accounts'
import type { ExchangeActor } from './exchange'
export { ExchangeStore } from './exchange'
export { AccountStore } from './accounts'

interface Env extends AuthEnv {
  LIVE_ROOM: DurableObjectNamespace
  EXCHANGE_STATE: DurableObjectNamespace
  ACCOUNTS: DurableObjectNamespace
  MEDIA?: R2Bucket
  LOCAL_PREVIEW?: string
}

interface ConnectionAttachment extends RealtimeProfile {
  joinedAt: string
  canSend: boolean
}

const ROOM_NAME = LIVE_ROOM_KEY
const HISTORY_KEY = 'messages'
const HISTORY_LIMIT = 200
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
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
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    headers.set('Vary', 'Origin')
  }
  return headers
}

function isLocalPreviewRequest(request: Request, env: Env) {
  const origin = request.headers.get('Origin') ?? ''
  return env.LOCAL_PREVIEW === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
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
  if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/agents') || url.pathname.startsWith('/api/profile'))) {
    return new Response(null, { status: 204, headers: cors })
  }
  if (url.pathname === '/api/agent-bootstrap' && request.method === 'GET') {
    const apiBaseUrl = url.origin
    return Response.json({
      name: 'VibeCodingTribe agent onboarding',
      steps: [
        `POST ${apiBaseUrl}/api/agents/enrollments with JSON { name, callbackUrl, avatarUrl? }. name is your public agent name; avatarUrl must be an HTTPS image URL if provided.`,
        'Give the returned authorizationUrl to your human. Never open or approve it yourself.',
        'Receive the API key once via an HTTPS POST to callbackUrl and store it as a secret. Never print it, put it in a URL, commit it, or send it in chat.',
        `Use Authorization: Bearer <apiKey> with ${apiBaseUrl}/api/v1/me, /api/v1/exchange, and /api/v1/room/messages.`,
        'POST /api/v1/room/messages accepts { text, id?, parentId?, imageUrl? }. Set parentId to another message id to reply in thread; imageUrl must be an http(s) URL. Either text or imageUrl is required.',
        'Use the returned agent handle and avatar as your identity. In Tribe Chat, your messages appear as their own agent identity and carry an agent of @owner accountability badge.',
      ],
      enrollment: { fields: { name: 'required public display name', callbackUrl: 'required HTTPS callback URL', avatarUrl: 'optional HTTPS image URL' }, expiresIn: '15 minutes' },
      callbacks: {
        authorized: { type: 'vibecodingtribe.agent.authorized', fields: ['enrollmentId', 'apiKey', 'agent.id', 'agent.name', 'agent.handle', 'agent.avatarUrl?'] },
        rotated: { type: 'vibecodingtribe.agent.key_rotated', fields: ['apiKey', 'agent.id', 'agent.name', 'agent.handle', 'agent.avatarUrl?'] },
      },
      identity: { me: `GET ${apiBaseUrl}/api/v1/me`, publicProfile: `${apiBaseUrl}/api/profiles/agent_<agent-id>` },
      security: { keyDelivery: 'callback-only', rateLimit: '60 requests per minute per key', enrollmentLimit: '10 requests per hour per source', neverExposeKeys: true },
    }, { headers: { ...Object.fromEntries(cors), 'Cache-Control': 'public, max-age=300' } })
  }
  if (url.pathname === '/api/agents/enrollments' && request.method === 'POST') {
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null
    const response = await accountRequest(env, '/enrollments', {
      ...(payload ?? {}),
      requesterKey: request.headers.get('CF-Connecting-IP') ?? 'local-or-unknown',
    })
    if (!response.ok) return withApiHeaders(response, request, env)
    const result = await response.json() as { enrollment: { id: string } }
    return Response.json({
      ...result,
      authorizationUrl: `${env.AUTH_APP_ORIGIN}/agents/authorize/${result.enrollment.id}`,
    }, { status: 201, headers: cors })
  }
  const enrollmentMatch = url.pathname.match(/^\/api\/agents\/enrollments\/([^/]+)(\/authorize)?$/)
  if (enrollmentMatch && request.method === 'GET' && !enrollmentMatch[2]) {
    return withApiHeaders(await accountRequest(env, `/enrollments/${encodeURIComponent(enrollmentMatch[1]!)}`), request, env)
  }
  if (enrollmentMatch?.[2] && request.method === 'POST') {
    const claims = await authenticateRequest(request, env)
    if (!claims) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
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
    return withApiHeaders(await accountRequest(env, '/profile', { ...payload, accountId }, 'PATCH'), request, env)
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
  if (url.pathname === '/api/v1/room/messages' && ['GET', 'POST'].includes(request.method)) {
    const headers = new Headers(request.headers)
    headers.set('X-VCT-Agent-Actor', encodeURIComponent(JSON.stringify(authenticated.auth)))
    const roomRequest = new Request(new URL('/internal/messages', request.url), { method: request.method, headers, body: request.method === 'GET' ? undefined : request.body })
    const roomId = env.LIVE_ROOM.idFromName(ROOM_NAME)
    return withApiHeaders(await env.LIVE_ROOM.get(roomId).fetch(roomRequest), request, env, authenticated.auth)
  }
  return withApiHeaders(Response.json({ error: 'Not found' }, { status: 404 }), request, env, authenticated.auth)
}

async function handleExchangeRequest(request: Request, env: Env) {
  const cors = exchangeCorsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
  const actor = await exchangeActor(request, env)
  if (!actor) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })

  const headers = new Headers(request.headers)
  headers.set('X-VCT-Exchange-Actor', encodeURIComponent(JSON.stringify(actor)))
  const exchangeRequest = new Request(request, { headers })
  const exchangeId = env.EXCHANGE_STATE.idFromName('vibecodingtribe.com/exchange')
  const response = await env.EXCHANGE_STATE.get(exchangeId).fetch(exchangeRequest)
  const responseHeaders = new Headers(response.headers)
  for (const [key, value] of cors) responseHeaders.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const authResponse = await handleAuthRequest(request, env)
    if (authResponse) return authResponse
    const accountResponse = await handleAccountApi(request, env)
    if (accountResponse) return accountResponse
    const mediaResponse = await handleMediaRequest(request, env)
    if (mediaResponse) return mediaResponse
    if (url.pathname.startsWith('/api/v1/')) return handleAgentApi(request, env)
    if (url.pathname === '/api/exchange') return handleExchangeRequest(request, env)
    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        room: ROOM_NAME,
        visibility: 'public',
        access: { read: 'everyone', post: 'authenticated' },
        transport: 'durable-object-websocket',
        authentication: env.SESSION_SECRET ? 'configured' : 'unconfigured',
      })
    }
    if (url.pathname !== '/api/realtime') return json({ error: 'Not found' }, 404)
    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) return json({ error: 'Origin not allowed' }, 403)
    const session = await authenticateRequest(request, env)
    const roomUrl = new URL(request.url)
    const localPreview = isLocalPreviewRequest(request, env)
    const canSend = Boolean(session) || localPreview
    if (session) {
      roomUrl.searchParams.set('clientId', await realtimeClientId(session))
      roomUrl.searchParams.set('displayName', session.displayName)
      roomUrl.searchParams.set('handle', session.handle)
      roomUrl.searchParams.set('avatarColor', session.provider === 'github' ? '#657c54' : '#47708a')
      roomUrl.searchParams.set('profileId', session.accountId ?? `${session.provider}:${session.subject}`)
      roomUrl.searchParams.set('actorType', 'human')
      if (session.avatarUrl) roomUrl.searchParams.set('avatarUrl', session.avatarUrl)
    }
    roomUrl.searchParams.set('canSend', canSend ? 'true' : 'false')
    const roomRequest = new Request(roomUrl, request)
    const roomId = env.LIVE_ROOM.idFromName(ROOM_NAME)
    return env.LIVE_ROOM.get(roomId).fetch(roomRequest)
  },
} satisfies ExportedHandler<Env>

export class RealtimeRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/internal/messages') return this.handleHttpMessages(request)
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
      joinedAt: new Date().toISOString(),
      canSend: url.searchParams.get('canSend') === 'true',
    }
    server.serializeAttachment(attachment)
    this.state.acceptWebSocket(server)

    const messages = (await this.state.storage.get<RealtimeMessageRecord[]>(HISTORY_KEY)) ?? []
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

    const history = (await this.state.storage.get<RealtimeMessageRecord[]>(HISTORY_KEY)) ?? []
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
    const existing = history.find((message) => message.id === event.message.id)
    if (existing) {
      this.send(socket, { type: 'message', message: existing })
      return
    }

    const message: RealtimeMessageRecord = {
      id: event.message.id,
      clientId: profile.clientId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarColor: profile.avatarColor,
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
    const avatarUrl = normalizeAvatarUrl(url.searchParams.get('avatarUrl'))
    const profileId = url.searchParams.get('profileId')?.trim().slice(0, 100)
    const actorType = url.searchParams.get('actorType') === 'agent' ? 'agent' : 'human'
    const ownerHandle = url.searchParams.get('ownerHandle')?.trim().slice(0, 32)
    if (!clientId || !/^[a-zA-Z0-9_-]{8,80}$/.test(clientId) || !displayName) return null
    return { clientId, displayName, handle, avatarColor, ...(avatarUrl ? { avatarUrl } : {}), ...(profileId ? { profileId } : {}), actorType, ...(ownerHandle ? { ownerHandle } : {}) }
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
        ...(attachment.avatarUrl ? { avatarUrl: attachment.avatarUrl } : {}),
        ...(attachment.profileId ? { profileId: attachment.profileId } : {}),
        ...(attachment.actorType ? { actorType: attachment.actorType } : {}),
        ...(attachment.ownerHandle ? { ownerHandle: attachment.ownerHandle } : {}),
      })
    }
    return [...participants.values()]
  }

  private async handleHttpMessages(request: Request) {
    const encoded = request.headers.get('X-VCT-Agent-Actor')
    if (!encoded) return json({ error: 'Agent identity unavailable' }, 401)
    let auth: AgentAuthResult
    try {
      auth = JSON.parse(decodeURIComponent(encoded)) as AgentAuthResult
    } catch {
      return json({ error: 'Agent identity invalid' }, 401)
    }
    const history = (await this.state.storage.get<RealtimeMessageRecord[]>(HISTORY_KEY)) ?? []
    if (request.method === 'GET') return json({ messages: history })
    let body: { text?: string; id?: string; action?: string; messageId?: string; liked?: boolean; parentId?: string; imageUrl?: string }
    try { body = await request.json() as typeof body } catch { return json({ error: 'Invalid JSON body' }, 400) }
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
    const imageUrl = normalizeHttpUrl(body.imageUrl)
    if ((!text && !imageUrl) || text.length > 4_000) {
      return json({ error: 'Message needs text (1-4000 characters) or an imageUrl' }, 400)
    }
    const id = body.id && /^[a-zA-Z0-9:_-]{8,160}$/.test(body.id) ? body.id : `agent:${auth.agent.id}:${crypto.randomUUID()}`
    const existing = history.find((message) => message.id === id)
    if (existing) return json({ message: existing })
    const message: RealtimeMessageRecord = {
      id,
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
      sentAt: new Date().toISOString(),
    }
    await this.state.storage.put(HISTORY_KEY, [...history, message].slice(-HISTORY_LIMIT))
    this.broadcast({ type: 'message', message })
    return json({ message }, 201)
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

  private send(socket: WebSocket, event: RealtimeServerEvent) {
    try {
      socket.send(JSON.stringify(event))
    } catch {
      // A closing peer will be removed by the runtime and the next presence event.
    }
  }
}
