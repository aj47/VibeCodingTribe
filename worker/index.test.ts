import { describe, expect, it, vi } from 'vitest'
import worker from './index'

describe('public room access', () => {
  it('keeps the one-time legacy migration operation narrowly authenticated', async () => {
    const idFromName = vi.fn((name: string) => name)
    const legacyMessages = [{ id: 'legacy_1', text: 'old history' }]
    const fetch = vi.fn((request: Request) => request.url.includes('/internal/export')
      ? Response.json({ messages: legacyMessages })
      : Response.json({ channelId: 'general', imported: 1, count: 1 }))
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      MIGRATION_SECRET: 'temporary-secret',
      LIVE_ROOM: { idFromName, get: vi.fn(() => ({ fetch })) },
    }

    const denied = await worker.fetch(new Request('https://worker.example/__ops/migrate-legacy', { method: 'POST' }), env as never)
    expect(denied.status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()

    const response = await worker.fetch(new Request('https://worker.example/__ops/migrate-legacy', {
      method: 'POST',
      headers: { Authorization: 'Bearer temporary-secret' },
    }), env as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'migrated', imported: 1, count: 1 })
    expect(idFromName).toHaveBeenNthCalledWith(1, 'vibecodingtribe.com/r/general')
    expect(idFromName).toHaveBeenNthCalledWith(2, 'vibecodingtribe.com/channel/general')
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
    const request = new Request('http://worker.example/api/exchange', {
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
    const response = await worker.fetch(new Request('http://worker.example/api/uploads/images', {
      method: 'POST',
      headers: { Origin: 'http://localhost:4173', 'Content-Type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71]),
    }), env as never)
    const result = await response.json() as { url: string }

    expect(response.status).toBe(201)
    expect(result.url).toMatch(/^http:\/\/worker\.example\/media\/[a-f0-9-]+\.png$/)
    expect(put).toHaveBeenCalledOnce()
    expect(put.mock.calls[0]?.[0]).toMatch(/\.png$/)
  })
})
