import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeServerEvent } from '../realtime/protocol'
import {
  createRealtimeMessageId,
  loadRealtimeProfile,
  RealtimeRoomClient,
  saveRealtimeProfile,
} from './realtime'

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 0
  sent: string[] = []

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(value: RealtimeServerEvent) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}

describe('RealtimeRoomClient', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists the browser identity used for realtime connections', () => {
    const profile = loadRealtimeProfile()
    saveRealtimeProfile({ ...profile, displayName: 'AJ', handle: 'aj47', avatarUrl: 'https://avatars.example/aj.png' })
    const restored = loadRealtimeProfile()

    expect(restored.displayName).toBe('AJ')
    expect(restored.clientId).toBe(profile.clientId)
    expect(restored.handle).toBe('aj47')
    expect(restored.avatarUrl).toBe('https://avatars.example/aj.png')
  })

  it('queues a message until connected and clears it after server confirmation', () => {
    const profile = loadRealtimeProfile()
    const events: RealtimeServerEvent[] = []
    const statuses: string[] = []
    const socket = new FakeWebSocket()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new RealtimeRoomClient(
      profile,
      { onEvent: (event) => events.push(event), onStatus: (status) => statuses.push(status) },
      () => socket as unknown as WebSocket,
    )
    const id = createRealtimeMessageId(profile.clientId)

    client.send({ id, text: 'hello live room' })
    client.connect()
    expect(socket.sent).toHaveLength(0)
    socket.open()
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'send', message: { id, text: 'hello live room' } })

    const record = {
      id,
      clientId: profile.clientId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarColor: profile.avatarColor,
      text: 'hello live room',
      sentAt: '2026-07-18T20:00:00.000Z',
    }
    socket.receive({ type: 'message', message: record })
    expect(events).toHaveLength(1)
    expect(statuses).toContain('connected')
    client.disconnect()
    vi.unstubAllGlobals()
  })

  it('sends an authenticated session through the WebSocket subprotocol', () => {
    const profile = loadRealtimeProfile()
    const socket = new FakeWebSocket()
    const socketFactory = vi.fn(() => socket as unknown as WebSocket)
    const client = new RealtimeRoomClient(
      profile,
      { onEvent: () => undefined, onStatus: () => undefined },
      socketFactory,
      'signed.session-token',
    )

    client.connect()

    expect(socketFactory).toHaveBeenCalledWith(expect.any(String), [
      'vct-realtime',
      'vct.auth.signed.session-token',
    ])
    client.disconnect()
  })

  it('queues an idempotent like state until connected', () => {
    const profile = loadRealtimeProfile()
    const socket = new FakeWebSocket()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new RealtimeRoomClient(
      profile,
      { onEvent: () => undefined, onStatus: () => undefined },
      () => socket as unknown as WebSocket,
    )

    client.setLike('rt_message_12345678', true)
    client.connect()
    socket.open()

    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'set_like', messageId: 'rt_message_12345678', liked: true })
    client.disconnect()
    vi.unstubAllGlobals()
  })

  it('keeps public viewer sockets read-only', () => {
    const profile = loadRealtimeProfile()
    const socket = new FakeWebSocket()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new RealtimeRoomClient(
      profile,
      { onEvent: () => undefined, onStatus: () => undefined },
      () => socket as unknown as WebSocket,
      undefined,
      false,
    )

    client.send({ id: createRealtimeMessageId(profile.clientId), text: 'should not send' })
    client.connect()
    socket.open()

    expect(socket.sent).toHaveLength(0)
    client.disconnect()
    vi.unstubAllGlobals()
  })
})
