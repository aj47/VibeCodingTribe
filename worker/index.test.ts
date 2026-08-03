import { describe, expect, it, vi } from 'vitest'
import worker, { cleanupExpiredMedia, runDailyActivityDigest } from './index'
import type { TransactionalEmail } from './email'

describe('public room access', () => {
  it('redirects public Worker HTTP requests to HTTPS', async () => {
    const response = await worker.fetch(new Request('http://worker.example/health'), {} as never)
    expect(response.status).toBe(308)
    expect(response.headers.get('Location')).toBe('https://worker.example/health')
  })

  it('forwards anonymous viewers to the room as read-only connections', async () => {
    const roomFetch = vi.fn((request: Request) => Response.json({ url: request.url }))
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      LIVE_ROOM: {
      idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: roomFetch })),
      },
    }
    const request = new Request('https://worker.example/api/realtime?clientId=viewer_12345678&displayName=Viewer&handle=viewer&avatarColor=%23657c54&canSend=true', {
      headers: { Origin: 'https://vibecodingtribe.com' },
    })

    const response = await worker.fetch(request, env as never)
    const forwardedUrl = new URL((await response.json() as { url: string }).url)

    expect(response.status).toBe(200)
    expect(forwardedUrl.searchParams.get('canSend')).toBe('false')
    expect(env.LIVE_ROOM.idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/general')
    expect(roomFetch).toHaveBeenCalledOnce()
  })

  it('routes each public connection to its isolated channel room', async () => {
    const roomFetch = vi.fn((request: Request) => Response.json({ url: request.url }))
    const idFromName = vi.fn((name: string) => name)
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: { idFromName, get: vi.fn(() => ({ fetch: roomFetch })) },
    }

    const response = await worker.fetch(new Request('https://worker.example/api/realtime?channelId=feedback&clientId=viewer_12345678&displayName=Viewer&handle=viewer&avatarColor=%23657c54'), env as never)
    const forwardedUrl = new URL((await response.json() as { url: string }).url)

    expect(response.status).toBe(200)
    expect(idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/feedback')
    expect(forwardedUrl.searchParams.get('channelId')).toBe('feedback')
  })

  it('serves a public post preview across the channel rooms', async () => {
    const post = { id: 'rt_human_12345678', displayName: 'Ada Builder', handle: 'ada', text: 'A shared build', sentAt: '2026-07-24T00:00:00.000Z' }
    const idFromName = vi.fn((name: string) => name)
    const roomFetch = vi.fn(() => Response.json({ post }))
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: { idFromName, get: vi.fn(() => ({ fetch: roomFetch })) },
    }

    const response = await worker.fetch(new Request('https://worker.example/api/preview/post?id=rt_human_12345678'), env as never)
    const result = await response.json() as { post: { id: string } }

    expect(response.status).toBe(200)
    expect(result.post.id).toBe('rt_human_12345678')
    expect(idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/general')
    expect(idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/showcases')
    expect(idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/feedback')
  })

  it('rejects unknown channel ids before opening a room', async () => {
    const idFromName = vi.fn()
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: { idFromName, get: vi.fn() },
    }

    const response = await worker.fetch(new Request('https://worker.example/api/realtime?channelId=secret'), env as never)

    expect(response.status).toBe(400)
    expect(idFromName).not.toHaveBeenCalled()
  })

  it('rejects forged local demo identities', async () => {
    const env = {
      ALLOWED_ORIGINS: 'http://localhost:4173',
      AUTH_APP_ORIGIN: 'http://localhost:4173',
      LIVE_ROOM: {},
      EXCHANGE_STATE: {},
    }
    const request = new Request('https://worker.example/api/exchange', {
      headers: { Origin: 'http://localhost:4173', 'X-VCT-Demo-User': 'user_a' },
    })

    const response = await worker.fetch(request, env as never)
    expect(response.status).toBe(401)
  })

  it('rejects unauthenticated production exchange requests', async () => {
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: {},
      EXCHANGE_STATE: {},
    }
    const response = await worker.fetch(new Request('https://worker.example/api/exchange', {
      headers: { Origin: 'https://vibecodingtribe.com' },
    }), env as never)
    expect(response.status).toBe(401)
  })

  it('stores a pasted image outside realtime message history in local preview', async () => {
    const put = vi.fn(async (...args: [string, unknown, unknown?]) => { void args })
    const env = {
      ALLOWED_ORIGINS: 'http://localhost:4173',
      AUTH_APP_ORIGIN: 'http://localhost:4173',
      LOCAL_PREVIEW: 'true',
      MEDIA: { put },
      LIVE_ROOM: {},
      EXCHANGE_STATE: {},
      ACCOUNTS: {},
    }
    const response = await worker.fetch(new Request('http://localhost:8787/api/uploads/images', {
      method: 'POST',
      headers: { Origin: 'http://localhost:4173', 'Content-Type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71]),
    }), env as never)
    const result = await response.json() as { url: string }

    expect(response.status).toBe(201)
    expect(result.url).toMatch(/^http:\/\/localhost:8787\/media\/[a-f0-9-]+\.png$/)
    expect(put).toHaveBeenCalledOnce()
    expect(put.mock.calls[0]?.[0]).toMatch(/\.png$/)
  })

  it('deletes uploaded media after the bounded retention period', async () => {
    const remove = vi.fn(async (...args: [string[]]) => { void args })
    const now = Date.parse('2026-08-03T00:00:00.000Z')
    const env = {
      MEDIA: {
        list: vi.fn(async () => ({
          objects: [
            { key: 'expired.png', uploaded: new Date('2026-04-01T00:00:00.000Z') },
            { key: 'recent.png', uploaded: new Date('2026-08-01T00:00:00.000Z') },
          ],
          truncated: false,
        })),
        delete: remove,
      },
    }

    await expect(cleanupExpiredMedia(env as never, now)).resolves.toEqual({ scanned: 2, deleted: 1 })
    expect(remove).toHaveBeenCalledWith(['expired.png'])
  })

  it('creates hosted agent delivery URLs when no callback server is supplied', async () => {
    const accountFetch = vi.fn(async (incoming: Request) => {
      const body = await incoming.json() as { hostedCallbackOrigin?: string }
      expect(body.hostedCallbackOrigin).toBe('https://worker.example')
      return Response.json({ enrollment: { id: 'enrollment_12345678', callbackMode: 'hosted' }, deliveryToken: 'vct_delivery_test' }, { status: 201 })
    })
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: {},
      EXCHANGE_STATE: {},
      ACCOUNTS: {
        idFromName: vi.fn(() => 'accounts'),
        get: vi.fn(() => ({ fetch: accountFetch })),
      },
    }

    const response = await worker.fetch(new Request('https://worker.example/api/agents/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hosted Scout' }),
    }), env as never)
    const result = await response.json() as { deliveryToken: string; deliveryUrl: string; authorizationUrl: string }

    expect(response.status).toBe(201)
    expect(result.deliveryToken).toBe('vct_delivery_test')
    expect(result.deliveryUrl).toBe('https://worker.example/api/agents/enrollments/enrollment_12345678/credential')
    expect(result.authorizationUrl).toBe('https://vibecodingtribe.com/agents/authorize/enrollment_12345678')
  })

  it('publishes a concrete credential storage and verification contract', async () => {
    const response = await worker.fetch(new Request('https://worker.example/api/agent-bootstrap'), {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
    } as never)
    const result = await response.json() as {
      steps: string[]
      credentialStore: { path: string; directoryMode: string; fileMode: string; requiredFields: string[] }
      security: { keyDelivery: string; verificationWindow: string }
    }

    expect(response.status).toBe(200)
    expect(result.credentialStore).toMatchObject({
      path: '~/.config/vibecodingtribe/auth.json',
      directoryMode: '0700',
      fileMode: '0600',
    })
    expect(result.credentialStore.requiredFields).toEqual(expect.arrayContaining(['apiKey', 'deliveryToken', 'deliveryUrl']))
    expect(result.security).toMatchObject({ keyDelivery: 'retryable-until-verified', verificationWindow: '15 minutes after first claim' })
    expect(result.steps.join(' ')).toContain('successful authenticated API request')
  })

  it('preserves the since cursor when forwarding agent room reads', async () => {
    const roomFetch = vi.fn((incoming: Request) => Response.json({ forwardedUrl: incoming.url }))
    const accountFetch = vi.fn(async () => Response.json({
      agent: { id: 'agent_1234567890123456', name: 'Scout', handle: 'scout' },
      owner: { id: 'human_owner', displayName: 'Owner', handle: 'owner', linkedProviders: ['github'] },
      rateLimit: { limit: 60, remaining: 59, resetAt: '2026-08-03T11:00:00.000Z' },
    }))
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      LIVE_ROOM: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: roomFetch })),
      },
      EXCHANGE_STATE: {},
      ACCOUNTS: {
        idFromName: vi.fn(() => 'accounts'),
        get: vi.fn(() => ({ fetch: accountFetch })),
      },
    }

    const response = await worker.fetch(new Request('https://worker.example/api/v1/room/messages?channelId=feedback&since=agent_read_1', {
      headers: { Authorization: 'Bearer vct_agent_test' },
    }), env as never)
    const result = await response.json() as { forwardedUrl: string }

    expect(response.status).toBe(200)
    expect(new URL(result.forwardedUrl).searchParams.get('since')).toBe('agent_read_1')
    expect(env.LIVE_ROOM.idFromName).toHaveBeenCalledWith('vibecodingtribe.com/channel/feedback')
  })

})

describe('daily activity digest job', () => {
  function environment() {
    let completed = false
    const post = {
      id: 'post_12345678', channelId: 'showcases', clientId: 'human_ada_realtime', profileId: 'human_ada',
      displayName: 'Ada', handle: 'ada', avatarColor: '#657c54', text: 'My launch', sentAt: '2026-08-01T09:00:00.000Z', intent: 'showcase',
    }
    const reply = {
      id: 'reply_12345678', channelId: 'showcases', clientId: 'human_grace_realtime', profileId: 'human_grace',
      displayName: 'Grace', handle: 'grace', avatarColor: '#657c54', text: 'Looks great', sentAt: '2026-08-01T10:00:00.000Z', parentId: post.id, commentKind: 'reply',
    }
    const accountFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname === '/internal/notification-recipients') {
        return Response.json({ recipients: [{ accountId: 'human_ada', realtimeClientId: 'human_ada_realtime', displayName: 'Ada', email: 'ada@example.com', preferences: { activityDigest: true } }] })
      }
      if (url.pathname === '/internal/activity-digest/prepare') {
        const body = await request.json() as { events?: unknown[] }
        return Response.json(completed ? { send: false, reason: 'already-sent' } : {
          send: true, accountId: 'human_ada', email: 'ada@example.com', displayName: 'Ada', idempotencyKey: 'activity-digest:human_ada:2026-08-01', events: body.events ?? [],
        })
      }
      if (url.pathname === '/internal/activity-digest/complete') {
        completed = true
        return Response.json({ delivered: true, eventCount: 1 })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    })
    const rooms = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
    for (const channelId of ['general', 'showcases', 'feedback']) {
      rooms.set(`vibecodingtribe.com/channel/${channelId}`, { fetch: async () => Response.json({ messages: channelId === 'showcases' ? [post, reply] : [] }) })
    }
    return {
      env: {
        AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
        EMAIL_UNSUBSCRIBE_ORIGIN: 'https://worker.example',
        SESSION_SECRET: 'test-session-secret-that-is-long-enough',
        ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
        LIVE_ROOM: {
          idFromName: (name: string) => name,
          get: (id: string) => rooms.get(id)!,
        },
        ACCOUNTS: { idFromName: (name: string) => name, get: () => ({ fetch: accountFetch }) },
        EXCHANGE_STATE: {},
      },
      accountFetch,
    }
  }

  it('sends one non-empty digest and completes delivery only after provider success', async () => {
    const { env, accountFetch } = environment()
    const send = vi.fn<(email: TransactionalEmail) => Promise<void>>(async () => undefined)
    const result = await runDailyActivityDigest(env as never, new Date('2026-08-01T08:00:00.000Z'), { send })

    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: 'ada@example.com', idempotencyKey: 'activity-digest:human_ada:2026-08-01' })
    expect(accountFetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://accounts.internal/internal/activity-digest/complete' }))
  })

  it('leaves completion untouched when the provider fails', async () => {
    const { env, accountFetch } = environment()
    const send = vi.fn<(email: TransactionalEmail) => Promise<void>>(async () => { throw new Error('provider down') })
    const result = await runDailyActivityDigest(env as never, new Date('2026-08-01T08:00:00.000Z'), { send })

    expect(result).toEqual({ sent: 0, failed: 1 })
    expect(accountFetch).not.toHaveBeenCalledWith(expect.objectContaining({ url: 'https://accounts.internal/internal/activity-digest/complete' }))
  })
})
