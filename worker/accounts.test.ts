import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountStore } from './accounts'

function createStore() {
  const values = new Map<string, unknown>()
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrEntries === 'string') values.set(keyOrEntries, value)
      else for (const [key, entry] of Object.entries(keyOrEntries)) values.set(key, entry)
    },
  }
  return new AccountStore({ storage } as unknown as DurableObjectState)
}

function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return new Request(`https://accounts.internal${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('AccountStore', () => {
  it('links provider identities into one human profile', async () => {
    const store = createStore()
    const github = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-1', displayName: 'Ada Builder', handle: 'ada', profileUrl: 'https://github.com/ada',
    } }))
    const { account } = await github.json() as { account: { id: string } }

    const linkedin = await store.fetch(request('/identity/resolve', { accountId: account.id, identity: {
      provider: 'linkedin', subject: 'li-1', displayName: 'Ada Builder', handle: 'ada-li',
    } }))
    const result = await linkedin.json() as { profile: { id: string; linkedProviders: string[]; githubUrl?: string } }

    expect(result.profile.id).toBe(account.id)
    expect(result.profile.linkedProviders).toEqual(['github', 'linkedin'])
    expect(result.profile.githubUrl).toBe('https://github.com/ada')
  })

  it('delivers a key once, rate limits it, and revokes it', async () => {
    const store = createStore()
    let deliveredKey = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      deliveredKey = (JSON.parse(String(init?.body)) as { apiKey: string }).apiKey
      return new Response(null, { status: 204 })
    }))
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-owner', displayName: 'Owner', handle: 'owner',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const enrollmentResponse = await store.fetch(request('/enrollments', { name: 'Scout', callbackUrl: 'https://agent.example/callback' }))
    const { enrollment } = await enrollmentResponse.json() as { enrollment: { id: string } }

    const authorized = await store.fetch(request(`/enrollments/${enrollment.id}/authorize`, { accountId: account.id }))
    const authorization = await authorized.json() as { credential: { id: string }; enrollment: { status: string } }
    expect(authorization.enrollment.status).toBe('delivered')
    expect(deliveredKey).toMatch(/^vct_agent_/)

    for (let index = 0; index < 60; index += 1) {
      expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(200)
    }
    expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(429)

    const revoked = await store.fetch(request(`/credentials/${authorization.credential.id}/revoke`, { accountId: account.id }))
    expect(revoked.status).toBe(200)
    expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(401)
  })

  it('rejects unsafe callbacks and cross-account identity linking', async () => {
    const store = createStore()
    const unsafe = await store.fetch(request('/enrollments', { name: 'Local agent', callbackUrl: 'http://127.0.0.1:3000/callback' }))
    expect(unsafe.status).toBe(400)

    const first = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'shared', displayName: 'One', handle: 'one' } }))
    const { account: firstAccount } = await first.json() as { account: { id: string } }
    const second = await store.fetch(request('/identity/resolve', { identity: { provider: 'linkedin', subject: 'other', displayName: 'Two', handle: 'two' } }))
    const { account: secondAccount } = await second.json() as { account: { id: string } }
    const conflict = await store.fetch(request('/identity/resolve', { accountId: secondAccount.id, identity: { provider: 'github', subject: 'shared', displayName: 'One', handle: 'one' } }))
    expect(firstAccount.id).not.toBe(secondAccount.id)
    expect(conflict.status).toBe(409)
  })

  it('keeps an agent avatar and standalone identity separate from its owner', async () => {
    const store = createStore()
    let delivered: { agent?: { name: string; handle: string; avatarUrl?: string } } = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      delivered = JSON.parse(String(init?.body)) as typeof delivered
      return new Response(null, { status: 204 })
    }))
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-agent-owner', displayName: 'Owner', handle: 'owner',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const enrollmentResponse = await store.fetch(request('/enrollments', {
      name: 'Scout', callbackUrl: 'https://agent.example/callback', avatarUrl: 'https://cdn.example/scout.png',
    }))
    const { enrollment } = await enrollmentResponse.json() as { enrollment: { id: string } }

    const authorized = await store.fetch(request(`/enrollments/${enrollment.id}/authorize`, { accountId: account.id }))
    const authorization = await authorized.json() as { credential: { id: string; handle: string; avatarUrl?: string } }
    const profileResponse = await store.fetch(request(`/agent-profile?agentId=${authorization.credential.id}`))
    const profileResult = await profileResponse.json() as { profile: { displayName: string; handle: string; avatarUrl?: string; ownerHandle: string; actorType: string } }

    expect(authorization.credential.avatarUrl).toBe('https://cdn.example/scout.png')
    expect(authorization.credential.handle).toBe('scout')
    expect(delivered.agent).toEqual({ id: expect.any(String), name: 'Scout', handle: 'scout', avatarUrl: 'https://cdn.example/scout.png' })
    expect(profileResult.profile).toMatchObject({ displayName: 'Scout', handle: 'scout', avatarUrl: 'https://cdn.example/scout.png', ownerHandle: 'owner', actorType: 'agent' })
  })
})
