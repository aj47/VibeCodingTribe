import { describe, expect, it } from 'vitest'
import {
  MAX_REALTIME_MESSAGE_LENGTH,
  normalizeDisplayName,
  normalizeHandle,
  parseRealtimeClientEvent,
  parseRealtimeServerEvent,
} from './protocol'

describe('realtime protocol', () => {
  it('normalizes a valid outbound message', () => {
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: { id: 'rt_client_12345678_1', text: '  hello room  ', threadId: 'thread-1' },
    })).toEqual({
      type: 'send',
      message: { id: 'rt_client_12345678_1', text: 'hello room', threadId: 'thread-1' },
    })
  })

  it('rejects malformed and oversized outbound messages', () => {
    expect(parseRealtimeClientEvent({ type: 'send', message: { id: 'short', text: 'hello' } })).toBeNull()
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: { id: 'rt_client_12345678_2', text: 'x'.repeat(MAX_REALTIME_MESSAGE_LENGTH + 1) },
    })).toBeNull()
  })

  it('accepts a complete server snapshot', () => {
    const message = {
      id: 'rt_client_12345678_3',
      clientId: 'client_12345678',
      displayName: 'Maya',
      handle: 'maya',
      avatarColor: '#657c54',
      text: 'live now',
      sentAt: '2026-07-18T20:00:00.000Z',
    }
    expect(parseRealtimeServerEvent({
      type: 'snapshot',
      messages: [message],
      participants: [{ clientId: 'client_12345678', displayName: 'Maya', handle: 'maya', avatarColor: '#657c54' }],
      onlineCount: 1,
    })?.type).toBe('snapshot')
  })

  it('keeps identity labels compact and safe', () => {
    expect(normalizeDisplayName('  Maya   Chen  ')).toBe('Maya Chen')
    expect(normalizeHandle('@maya chen!')).toBe('mayachen')
  })
})
