import { describe, expect, it, vi } from 'vitest'
import { migrateLegacyHistory, RealtimeRoom } from './index'

function createState(initial: unknown = []) {
  const values = new Map<string, unknown>([['messages', initial]])
  return {
    storage: {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
    },
    getWebSockets: () => [],
  }
}

function socket(channelId: 'general' | 'showcases' | 'feedback') {
  return {
    deserializeAttachment: () => ({
      channelId,
      clientId: 'client_builder_1234',
      displayName: 'Builder',
      handle: 'builder',
      avatarColor: '#657c54',
      canSend: true,
    }),
    send: vi.fn(),
  }
}

function agentHeaders() {
  return { 'X-VCT-Agent-Actor': encodeURIComponent(JSON.stringify({ agent: { id: 'agent_1234567890123456' } })) }
}

describe('RealtimeRoom channel isolation', () => {
  it('migrates the legacy room into general without changing ids or thread parents', async () => {
    const legacyState = createState([{
      id: 'legacy_parent_1',
      clientId: 'client_12345678',
      displayName: 'Legacy',
      handle: 'legacy',
      avatarColor: '#657c54',
      text: 'parent',
      sentAt: '2026-07-18T20:00:00.000Z',
    }, {
      id: 'legacy_reply_1',
      clientId: 'client_12345678',
      displayName: 'Legacy',
      handle: 'legacy',
      avatarColor: '#657c54',
      text: 'reply',
      parentId: 'legacy_parent_1',
      sentAt: '2026-07-18T20:01:00.000Z',
    }])
    const generalState = createState()
    const legacyRoom = new RealtimeRoom(legacyState as never)
    const generalRoom = new RealtimeRoom(generalState as never)
    const env = {
      LIVE_ROOM: {
        idFromName: (name: string) => name,
        get: (id: string) => ({ fetch: (request: Request) => id.includes('/channel/') ? generalRoom.fetch(request) : legacyRoom.fetch(request) }),
      },
    }

    await migrateLegacyHistory(env as never)
    const result = await generalRoom.fetch(new Request('https://internal/internal/export?channelId=general'))
    const messages = (await result.json() as { messages: Array<{ id: string; channelId: string; parentId?: string }> }).messages

    expect(messages).toEqual([
      expect.objectContaining({ id: 'legacy_parent_1', channelId: 'general' }),
      expect.objectContaining({ id: 'legacy_reply_1', channelId: 'general', parentId: 'legacy_parent_1' }),
    ])
  })

  it('moves legacy showcases and feedback into their channel rooms', async () => {
    const legacyState = createState([
      { id: 'legacy_general_1', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'chat', sentAt: '2026-07-18T20:00:00.000Z' },
      { id: 'legacy_showcase_1', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'shipped', intent: 'showcase', sentAt: '2026-07-18T20:01:00.000Z' },
      { id: 'legacy_feedback_1', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'need eyes', intent: 'needs_feedback', sentAt: '2026-07-18T20:02:00.000Z' },
      { id: 'legacy_feedback_reply_1', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'looks good', parentId: 'legacy_feedback_1', sentAt: '2026-07-18T20:03:00.000Z' },
    ])
    const rooms = new Map<string, RealtimeRoom>([
      ['vibecodingtribe.com/r/general', new RealtimeRoom(legacyState as never)],
      ['vibecodingtribe.com/channel/general', new RealtimeRoom(createState() as never)],
      ['vibecodingtribe.com/channel/showcases', new RealtimeRoom(createState() as never)],
      ['vibecodingtribe.com/channel/feedback', new RealtimeRoom(createState() as never)],
    ])
    const env = { LIVE_ROOM: { idFromName: (name: string) => name, get: (id: string) => ({ fetch: (request: Request) => rooms.get(id)!.fetch(request) }) } }

    await migrateLegacyHistory(env as never)
    const read = async (channelId: 'general' | 'showcases' | 'feedback') => {
      const result = await rooms.get(`vibecodingtribe.com/channel/${channelId}`)!.fetch(new Request(`https://internal/internal/export?channelId=${channelId}`))
      return (await result.json() as { messages: Array<{ id: string; channelId: string; parentId?: string }> }).messages
    }

    expect(await read('general')).toEqual([expect.objectContaining({ id: 'legacy_general_1', channelId: 'general' })])
    expect(await read('showcases')).toEqual([expect.objectContaining({ id: 'legacy_showcase_1', channelId: 'showcases' })])
    expect(await read('feedback')).toEqual([
      expect.objectContaining({ id: 'legacy_feedback_1', channelId: 'feedback' }),
      expect.objectContaining({ id: 'legacy_feedback_reply_1', channelId: 'feedback', parentId: 'legacy_feedback_1' }),
    ])
  })

  it('backfills legacy records to general and does not import another channel', async () => {
    const state = createState()
    const room = new RealtimeRoom(state as never)
    const response = await room.fetch(new Request('https://internal/internal/import?channelId=general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'general',
        messages: [
          { id: 'legacy_message_1', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'old room', sentAt: '2026-07-18T20:00:00.000Z' },
          { id: 'feedback_message_1', channelId: 'feedback', clientId: 'client_12345678', displayName: 'Legacy', handle: 'legacy', avatarColor: '#657c54', text: 'wrong room', sentAt: '2026-07-18T20:01:00.000Z' },
        ],
      }),
    }))
    const result = await room.fetch(new Request('https://internal/internal/export?channelId=general'))

    expect(response.status).toBe(200)
    expect((await result.json() as { messages: Array<{ id: string; channelId: string }> }).messages).toEqual([
      expect.objectContaining({ id: 'legacy_message_1', channelId: 'general' }),
    ])
  })

  it('rewrites historical human author snapshots after a profile handle update', async () => {
    const state = createState([{
      id: 'old-handle-post',
      channelId: 'feedback',
      clientId: 'human_realtime_1234',
      profileId: 'human_ada',
      displayName: 'Ada Builder',
      handle: 'ada-old',
      avatarColor: '#657c54',
      text: 'Need a second pair of eyes',
      sentAt: '2026-07-19T20:00:00.000Z',
    }])
    const room = new RealtimeRoom(state as never)

    const response = await room.fetch(new Request('https://internal/internal/profile-update?channelId=feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: 'human_ada',
        realtimeClientId: 'human_realtime_1234',
        displayName: 'Ada Builder',
        handle: 'ada-new',
      }),
    }))
    const exported = await room.fetch(new Request('https://internal/internal/export?channelId=feedback'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ channelId: 'feedback', updated: 1 })
    expect((await exported.json() as { messages: Array<{ displayName: string; handle: string }> }).messages[0]).toMatchObject({
      displayName: 'Ada Builder',
      handle: 'ada-new',
    })
  })

  it('rejects cross-channel replies and persists same-channel likes', async () => {
    const state = createState()
    const room = new RealtimeRoom(state as never)
    const client = socket('feedback')
    await room.webSocketMessage(client as never, JSON.stringify({ type: 'send', message: { id: 'feedback_parent_1', channelId: 'feedback', text: 'Need eyes' } }))
    await room.webSocketMessage(client as never, JSON.stringify({ type: 'send', message: { id: 'general_reply_1', channelId: 'general', parentId: 'feedback_parent_1', text: 'Wrong room' } }))

    expect(JSON.parse(client.send.mock.calls.at(-1)?.[0] as string)).toMatchObject({ clientMessageId: 'general_reply_1', message: expect.stringMatching(/channel/) })

    await room.webSocketMessage(client as never, JSON.stringify({ type: 'set_like', channelId: 'feedback', messageId: 'feedback_parent_1', liked: true }))
    const exported = await room.fetch(new Request('https://internal/internal/export?channelId=feedback'))
    const messages = (await exported.json() as { messages: Array<{ id: string; channelId: string; likedByClientIds?: string[] }> }).messages

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: 'feedback_parent_1', channelId: 'feedback', likedByClientIds: ['client_builder_1234'] })
  })

  it('filters agent reads by message id or timestamp and returns the next cursor', async () => {
    const room = new RealtimeRoom(createState([
      { id: 'agent_read_1', channelId: 'general', clientId: 'client_12345678', displayName: 'Builder', handle: 'builder', avatarColor: '#657c54', text: 'first', sentAt: '2026-08-03T10:00:00.000Z' },
      { id: 'agent_read_2', channelId: 'general', clientId: 'client_12345678', displayName: 'Builder', handle: 'builder', avatarColor: '#657c54', text: 'second', sentAt: '2026-08-03T10:01:00.000Z' },
      { id: 'agent_read_3', channelId: 'general', clientId: 'client_12345678', displayName: 'Builder', handle: 'builder', avatarColor: '#657c54', text: 'third', sentAt: '2026-08-03T10:02:00.000Z' },
    ]) as never)

    const byId = await room.fetch(new Request('https://internal/internal/messages?channelId=general&since=agent_read_1', { headers: agentHeaders() }))
    expect(await byId.json()).toMatchObject({ channelId: 'general', nextSince: 'agent_read_3', messages: [{ id: 'agent_read_2' }, { id: 'agent_read_3' }] })

    const byTimestamp = await room.fetch(new Request('https://internal/internal/messages?channelId=general&since=2026-08-03T10:00:30.000Z', { headers: agentHeaders() }))
    expect(await byTimestamp.json()).toMatchObject({ nextSince: 'agent_read_3', messages: [{ id: 'agent_read_2' }, { id: 'agent_read_3' }] })

    const caughtUp = await room.fetch(new Request('https://internal/internal/messages?channelId=general&since=agent_read_3', { headers: agentHeaders() }))
    expect(await caughtUp.json()).toEqual({ channelId: 'general', messages: [], nextSince: 'agent_read_3' })
  })
})
