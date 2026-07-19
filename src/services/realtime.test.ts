import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeServerEvent } from '../realtime/protocol'
import {
  createRealtimeMessageId,
  loadRealtimeProfile,
  realtimeProfileToParticipant,
  realtimeRecordToMessage,
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

  it('persists browser identity and maps it to a room participant', () => {
    const profile = loadRealtimeProfile()
    saveRealtimeProfile({ ...profile, displayName: 'AJ', handle: 'aj47' })
    const restored = loadRealtimeProfile()
    const participant = realtimeProfileToParticipant(restored)

    expect(restored.displayName).toBe('AJ')
    expect(participant.id).toBe(`realtime:${profile.clientId}`)
    expect(participant.handle).toBe('@aj47')
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
    expect(realtimeRecordToMessage(record).deliveryState).toBe('sent')
    client.disconnect()
    vi.unstubAllGlobals()
  })
})
