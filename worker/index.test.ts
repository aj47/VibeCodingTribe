import { describe, expect, it, vi } from 'vitest'
import worker from './index'

describe('public room access', () => {
  it('forwards anonymous viewers to the room as read-only connections', async () => {
    const roomFetch = vi.fn((request: Request) => Response.json({ url: request.url }))
    const env = {
      ALLOWED_ORIGINS: 'https://vibecodingtribe.com',
      AUTH_APP_ORIGIN: 'https://vibecodingtribe.com',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      LIVE_ROOM: {
        idFromName: vi.fn(() => 'room-id'),
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
    expect(roomFetch).toHaveBeenCalledOnce()
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
})
