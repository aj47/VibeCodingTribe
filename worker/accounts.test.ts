import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountStore } from './accounts'

function createStore(env?: unknown) {
  const values = new Map<string, unknown>()
  const storage = {
    get: async (key: string) => values.get(key),
    list: async <T,>({ prefix }: { prefix?: string }) => new Map(
      [...values.entries()].filter(([key]) => !prefix || key.startsWith(prefix)),
    ) as Map<string, T>,
    put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrEntries === 'string') values.set(keyOrEntries, value)
      else for (const [key, entry] of Object.entries(keyOrEntries)) values.set(key, entry)
    },
  }
  return new AccountStore({ storage } as unknown as DurableObjectState, env as never)
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
      provider: 'linkedin', subject: 'li-1', displayName: 'Ada Builder', handle: 'ada-li', profileUrl: 'https://www.linkedin.com/in/ada-builder',
    } }))
    const result = await linkedin.json() as { profile: { id: string; linkedProviders: string[]; githubUrl?: string; linkedinUrl?: string } }

    expect(result.profile.id).toBe(account.id)
    expect(result.profile.linkedProviders).toEqual(['github', 'linkedin'])
    expect(result.profile.githubUrl).toBe('https://github.com/ada')
    expect(result.profile.linkedinUrl).toBe('https://www.linkedin.com/in/ada-builder')
  })

  it('delivers a key once, rate limits it, and revokes it', async () => {
    const store = createStore()
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-owner', displayName: 'Owner', handle: 'owner',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const enrollmentResponse = await store.fetch(request('/enrollments', { name: 'Scout', hostedCallbackOrigin: 'https://worker.example' }))
    const { enrollment, deliveryToken } = await enrollmentResponse.json() as { enrollment: { id: string }; deliveryToken: string }

    const authorized = await store.fetch(request(`/enrollments/${enrollment.id}/authorize`, { accountId: account.id }))
    const authorization = await authorized.json() as { credential: { id: string }; enrollment: { status: string } }
    expect(authorization.enrollment.status).toBe('delivered')
    const delivered = await store.fetch(request(`/enrollments/${enrollment.id}/credential`, { deliveryToken }))
    const { apiKey: deliveredKey } = await delivered.json() as { apiKey: string }
    expect(deliveredKey).toMatch(/^vct_agent_/)

    for (let index = 0; index < 60; index += 1) {
      expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(200)
    }
    expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(429)

    const revoked = await store.fetch(request(`/credentials/${authorization.credential.id}/revoke`, { accountId: account.id }))
    expect(revoked.status).toBe(200)
    expect((await store.fetch(request('/credentials/authenticate', { token: deliveredKey }))).status).toBe(401)
  })

  it('hosts the callback inbox and lets an agent claim the key without an inbound server', async () => {
    const store = createStore({ SESSION_SECRET: 'test-session-secret-that-is-long-enough' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const callbackId = new URL(url).pathname.split('/').at(-1)
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      return store.fetch(request(`/enrollments/${callbackId}/callback`, payload))
    }))
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-hosted-agent-owner', displayName: 'Hosted Owner', handle: 'hosted-owner',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const enrollmentResponse = await store.fetch(request('/enrollments', { name: 'Inbox Scout', hostedCallbackOrigin: 'https://worker.example' }))
    const created = await enrollmentResponse.json() as { enrollment: { id: string; callbackMode?: string }; deliveryToken: string }

    expect(created.enrollment.callbackMode).toBe('hosted')
    expect(created.enrollment.id).toBeTruthy()
    expect((await store.fetch(request(`/enrollments/${created.enrollment.id}/credential`, { deliveryToken: created.deliveryToken }))).status).toBe(202)

    const authorized = await store.fetch(request(`/enrollments/${created.enrollment.id}/authorize`, { accountId: account.id }))
    const authorization = await authorized.json() as { credential: { id: string }; enrollment: { status: string } }
    expect(authorization.enrollment.status).toBe('delivered')

    const claimed = await store.fetch(request(`/enrollments/${created.enrollment.id}/credential`, { deliveryToken: created.deliveryToken }))
    const payload = await claimed.json() as { apiKey: string; type: string; agent: { name: string } }
    expect(claimed.status).toBe(200)
    expect(payload).toMatchObject({ type: 'vibecodingtribe.agent.authorized', agent: { name: 'Inbox Scout' } })
    expect(payload.apiKey).toMatch(/^vct_agent_/)
    expect((await store.fetch(request(`/enrollments/${created.enrollment.id}/credential`, { deliveryToken: created.deliveryToken }))).status).toBe(202)
  })

  it('rejects unsafe callbacks and cross-account identity linking', async () => {
    const store = createStore()
    const unsafe = await store.fetch(request('/enrollments', { name: 'External agent', callbackUrl: 'https://agent.example/callback' }))
    expect(unsafe.status).toBe(403)

    const first = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'shared', displayName: 'One', handle: 'one' } }))
    const { account: firstAccount } = await first.json() as { account: { id: string } }
    const second = await store.fetch(request('/identity/resolve', { identity: { provider: 'linkedin', subject: 'other', displayName: 'Two', handle: 'two' } }))
    const { account: secondAccount } = await second.json() as { account: { id: string } }
    const conflict = await store.fetch(request('/identity/resolve', { accountId: secondAccount.id, identity: { provider: 'github', subject: 'shared', displayName: 'One', handle: 'one' } }))
    expect(firstAccount.id).not.toBe(secondAccount.id)
    expect(conflict.status).toBe(409)
  })

  it('enforces fixed-window limits without storing one record per request', async () => {
    const store = createStore()
    const input = { scope: 'upload-account', subject: 'human_123', limit: 2, windowMs: 60_000 }
    expect((await store.fetch(request('/limits/consume', input))).status).toBe(200)
    expect((await store.fetch(request('/limits/consume', input))).status).toBe(200)
    expect((await store.fetch(request('/limits/consume', input))).status).toBe(429)
  })

  it('keeps an agent avatar and standalone identity separate from its owner', async () => {
    const store = createStore()
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-agent-owner', displayName: 'Owner', handle: 'owner',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const enrollmentResponse = await store.fetch(request('/enrollments', {
      name: 'Scout', hostedCallbackOrigin: 'https://worker.example', avatarUrl: 'https://cdn.example/scout.png',
    }))
    const { enrollment } = await enrollmentResponse.json() as { enrollment: { id: string } }

    const authorized = await store.fetch(request(`/enrollments/${enrollment.id}/authorize`, { accountId: account.id }))
    const authorization = await authorized.json() as { credential: { id: string; handle: string; avatarUrl?: string } }
    const profileResponse = await store.fetch(request(`/agent-profile?agentId=${authorization.credential.id}`))
    const profileResult = await profileResponse.json() as { profile: { displayName: string; handle: string; avatarUrl?: string; ownerHandle: string; actorType: string } }

    expect(authorization.credential.avatarUrl).toBe('https://cdn.example/scout.png')
    expect(authorization.credential.handle).toBe('scout')
    expect(profileResult.profile).toMatchObject({ displayName: 'Scout', handle: 'scout', avatarUrl: 'https://cdn.example/scout.png', ownerHandle: 'owner', actorType: 'agent' })
  })

  it('publishes external work links and the early-builder badge on profiles', async () => {
    const store = createStore()
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-public-builder', displayName: 'Public Builder', handle: 'public-builder',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    const updated = await store.fetch(request('/profile', {
      accountId: account.id,
      displayName: 'Public Builder',
      headline: 'Shipping useful tools',
      bio: 'Building a calmer way to review releases.',
      githubUrl: 'https://github.com/public-builder',
      linkedinUrl: '',
      websiteUrl: 'https://builder.example',
    }, 'PATCH'))
    const result = await updated.json() as { profile: { bio?: string; websiteUrl?: string; badges?: Array<{ id: string }> } }

    expect(result.profile).toMatchObject({
      bio: 'Building a calmer way to review releases.',
      websiteUrl: 'https://builder.example/',
      badges: [{ id: 'early_builder' }],
    })
  })

  it('validates handles and rejects duplicates while allowing a unique update', async () => {
    const store = createStore()
    const firstResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-first', displayName: 'First Builder', handle: 'first-builder',
    } }))
    const { account: first } = await firstResponse.json() as { account: { id: string } }
    const secondResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-second', displayName: 'Second Builder', handle: 'second-builder',
    } }))
    const { account: second } = await secondResponse.json() as { account: { id: string } }

    const duplicate = await store.fetch(request('/profile', {
      accountId: second.id, displayName: 'Second Builder', handle: '@first-builder',
    }, 'PATCH'))
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: '@first-builder is already taken. Choose another handle.' })

    const updated = await store.fetch(request('/profile', {
      accountId: second.id, displayName: 'Second Builder', handle: 'second-builder-v2',
    }, 'PATCH'))
    expect(updated.status).toBe(200)
    expect((await updated.json() as { profile: { handle: string } }).profile.handle).toBe('second-builder-v2')
    expect(first.id).not.toBe(second.id)
  })

  it('awards post and reply points idempotently without rewarding self-replies', async () => {
    const store = createStore()
    const firstResponse = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'points-first', displayName: 'First Builder', handle: 'first-builder' } }))
    const secondResponse = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'points-second', displayName: 'Second Builder', handle: 'second-builder' } }))
    const { account: first } = await firstResponse.json() as { account: { id: string } }
    const { account: second } = await secondResponse.json() as { account: { id: string } }

    expect((await store.fetch(request('/points/award', {
      channelId: 'general', messageId: 'points-parent-12345678', author: { profileId: first.id },
    }))).status).toBe(200)
    const reply = { channelId: 'general', messageId: 'points-reply-12345678', author: { profileId: second.id }, parent: { profileId: first.id } }
    await store.fetch(request('/points/award', reply))
    await store.fetch(request('/points/award', reply))
    await store.fetch(request('/points/award', { channelId: 'general', messageId: 'points-self-12345678', author: { profileId: first.id }, parent: { profileId: first.id } }))

    const firstProfile = await store.fetch(request(`/profile?accountId=${encodeURIComponent(first.id)}`))
    const secondProfile = await store.fetch(request(`/profile?accountId=${encodeURIComponent(second.id)}`))
    expect((await firstProfile.json() as { profile: { points: number } }).profile.points).toBe(2)
    expect((await secondProfile.json() as { profile: { points: number } }).profile.points).toBe(2)
  })

  it('backfills historical points additively and is safe to rerun', async () => {
    const history = new Map<string, unknown[]>([['general', []], ['showcases', []], ['feedback', []]])
    const env = {
      LIVE_ROOM: {
        idFromName: (name: string) => name,
        get: (name: string) => ({ fetch: async (incoming: Request) => Response.json({ messages: history.get(new URL(incoming.url).searchParams.get('channelId') ?? name.split('/').at(-1) ?? 'general') ?? [] }) }),
      },
    }
    const store = createStore(env)
    const firstResponse = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'backfill-first', displayName: 'Backfill First', handle: 'backfill-first' } }))
    const secondResponse = await store.fetch(request('/identity/resolve', { identity: { provider: 'github', subject: 'backfill-second', displayName: 'Backfill Second', handle: 'backfill-second' } }))
    const { account: first } = await firstResponse.json() as { account: { id: string } }
    const { account: second } = await secondResponse.json() as { account: { id: string } }

    for (let index = 0; index < 10; index += 1) {
      await store.fetch(request('/points/award', { channelId: 'general', messageId: `prior-points-${index}-12345678`, author: { profileId: first.id } }))
    }
    history.set('general', [
      { id: 'backfill-post-12345678', channelId: 'general', profileId: first.id, actorType: 'human', clientId: 'first-client', displayName: 'Backfill First', handle: 'backfill-first', avatarColor: '#657c54', text: 'post', sentAt: '2026-08-01T00:00:00.000Z' },
      { id: 'backfill-reply-12345678', channelId: 'general', profileId: second.id, actorType: 'human', clientId: 'second-client', displayName: 'Backfill Second', handle: 'backfill-second', avatarColor: '#657c54', text: 'reply', parentId: 'backfill-post-12345678', sentAt: '2026-08-01T00:01:00.000Z' },
      { id: 'backfill-second-post-12345678', channelId: 'general', profileId: second.id, actorType: 'human', clientId: 'second-client', displayName: 'Backfill Second', handle: 'backfill-second', avatarColor: '#657c54', text: 'another post', sentAt: '2026-08-01T00:02:00.000Z' },
    ])

    const firstBackfill = await store.fetch(request('/points/backfill', {}))
    const secondBackfill = await store.fetch(request('/points/backfill', {}))
    expect(firstBackfill.status).toBe(200)
    expect(secondBackfill.status).toBe(200)

    const firstProfile = await store.fetch(request(`/profile?accountId=${encodeURIComponent(first.id)}`))
    const secondProfile = await store.fetch(request(`/profile?accountId=${encodeURIComponent(second.id)}`))
    expect((await firstProfile.json() as { profile: { points: number } }).profile.points).toBe(10)
    expect((await secondProfile.json() as { profile: { points: number } }).profile.points).toBe(3)
  })

  it('keeps digest preparation idempotent and marks event delivery only on completion', async () => {
    const store = createStore()
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-digest', displayName: 'Digest Builder', handle: 'digest-builder', email: 'digest@example.com',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    await store.fetch(request('/notification-preferences', { accountId: account.id, email: 'digest@example.com', activityDigest: true }, 'PATCH'))
    const event = {
      id: 'activity:reply:general:reply-1', kind: 'reply', channelId: 'general', parentId: 'post-1',
      createdAt: '2026-08-01T10:00:00.000Z', actorDisplayName: 'Someone', parentTitle: 'Post', preview: 'A reply', deepLink: 'https://vibecodingtribe.com/?thread=post-1',
    }

    const prepared = await store.fetch(request('/internal/activity-digest/prepare', { accountId: account.id, day: '2026-08-01', events: [event] }))
    const first = await prepared.json() as { send: boolean; idempotencyKey: string; events: unknown[] }
    expect(first).toMatchObject({ send: true, idempotencyKey: `activity-digest:${account.id}:2026-08-01`, events: [event] })

    const replayed = await store.fetch(request('/internal/activity-digest/prepare', { accountId: account.id, day: '2026-08-01', events: [event] }))
    expect(await replayed.json()).toEqual(expect.objectContaining({ send: true, idempotencyKey: first.idempotencyKey, events: [event] }))

    const completed = await store.fetch(request('/internal/activity-digest/complete', { accountId: account.id, day: '2026-08-01', idempotencyKey: first.idempotencyKey }))
    expect(await completed.json()).toEqual({ delivered: true, eventCount: 1 })
    const alreadyDelivered = await store.fetch(request('/internal/activity-digest/prepare', { accountId: account.id, day: '2026-08-02', events: [event] }))
    expect(await alreadyDelivered.json()).toEqual({ send: false, reason: 'empty' })
  })

  it('persists the activity digest preference with a safe default', async () => {
    const store = createStore()
    const identityResponse = await store.fetch(request('/identity/resolve', { identity: {
      provider: 'github', subject: 'gh-preference', displayName: 'Preference Builder', handle: 'preference-builder',
    } }))
    const { account } = await identityResponse.json() as { account: { id: string } }
    expect(await (await store.fetch(request(`/notification-preferences?accountId=${account.id}`))).json()).toEqual({ preferences: { activityDigest: false } })
    const rejected = await store.fetch(request('/notification-preferences', { accountId: account.id, activityDigest: true }, 'PATCH'))
    expect(rejected.status).toBe(400)
    const updated = await store.fetch(request('/notification-preferences', { accountId: account.id, email: 'preference@example.com', activityDigest: true }, 'PATCH'))
    expect(await updated.json()).toEqual({ preferences: { activityDigest: true }, email: 'preference@example.com' })
    const disabled = await store.fetch(request('/notification-preferences', { accountId: account.id, activityDigest: false }, 'PATCH'))
    expect(await disabled.json()).toEqual({ preferences: { activityDigest: false }, email: 'preference@example.com' })
  })
})
