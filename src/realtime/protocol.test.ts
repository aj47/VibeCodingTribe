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
      message: { id: 'rt_client_12345678_1', text: '  hello room  ' },
    })).toEqual({
      type: 'send',
      message: { id: 'rt_client_12345678_1', text: 'hello room' },
    })
  })

  it('rejects malformed and oversized outbound messages', () => {
    expect(parseRealtimeClientEvent({ type: 'send', message: { id: 'short', text: 'hello' } })).toBeNull()
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: { id: 'rt_client_12345678_2', text: 'x'.repeat(MAX_REALTIME_MESSAGE_LENGTH + 1) },
    })).toBeNull()
  })

  it('accepts idempotent like state changes and rejects malformed targets', () => {
    expect(parseRealtimeClientEvent({ type: 'set_like', messageId: 'rt_message_12345678', liked: true })).toEqual({
      type: 'set_like',
      messageId: 'rt_message_12345678',
      liked: true,
    })
    expect(parseRealtimeClientEvent({ type: 'set_like', messageId: 'short', liked: true })).toBeNull()
    expect(parseRealtimeClientEvent({ type: 'set_like', messageId: 'rt_message_12345678', liked: 'yes' })).toBeNull()
  })

  it('carries structured feed context on the same realtime message', () => {
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: {
        id: 'rt_client_12345678_post',
        text: 'The onboarding is ready for another pair of eyes.',
        intent: 'needs_feedback',
        buildName: 'Launchpad',
        buildUrl: 'https://launchpad.example/demo',
      },
    })).toEqual({
      type: 'send',
      message: {
        id: 'rt_client_12345678_post',
        text: 'The onboarding is ready for another pair of eyes.',
        intent: 'needs_feedback',
        buildName: 'Launchpad',
        buildUrl: 'https://launchpad.example/demo',
      },
    })
  })

  it('preserves chat and showcase feed types', () => {
    for (const intent of ['chat', 'showcase'] as const) {
      const event = parseRealtimeClientEvent({
        type: 'send',
        message: { id: `rt_client_12345678_${intent}`, text: `A ${intent} post`, intent },
      })
      expect(event?.type === 'send' ? event.message.intent : undefined).toBe(intent)
    }
  })

  it('accepts an image-only realtime post and rejects an invalid image URL', () => {
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: { id: 'rt_client_12345678_image', text: '', imageUrl: 'https://media.example/pasted.png' },
    })).toEqual({ type: 'send', message: { id: 'rt_client_12345678_image', text: '', imageUrl: 'https://media.example/pasted.png' } })
    expect(parseRealtimeClientEvent({
      type: 'send',
      message: { id: 'rt_client_12345678_badimage', text: '', imageUrl: 'javascript:alert(1)' },
    })).toBeNull()
  })

  it('accepts a complete server snapshot', () => {
    const message = {
      id: 'rt_client_12345678_3',
      clientId: 'client_12345678',
      displayName: 'Local Builder',
      handle: 'local-builder',
      avatarColor: '#657c54',
      avatarUrl: 'https://avatars.example/builder.png',
      text: 'live now',
      sentAt: '2026-07-18T20:00:00.000Z',
      likedByClientIds: ['client_12345678'],
    }
    expect(parseRealtimeServerEvent({
      type: 'snapshot',
      messages: [message],
      participants: [{ clientId: 'client_12345678', displayName: 'Local Builder', handle: 'local-builder', avatarColor: '#657c54', avatarUrl: 'https://avatars.example/builder.png' }],
      onlineCount: 1,
    })?.type).toBe('snapshot')
  })

  it('keeps identity labels compact and safe', () => {
    expect(normalizeDisplayName('  Local   Builder  ')).toBe('Local Builder')
    expect(normalizeHandle('@local builder!')).toBe('localbuilder')
  })
})
