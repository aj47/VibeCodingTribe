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
})
