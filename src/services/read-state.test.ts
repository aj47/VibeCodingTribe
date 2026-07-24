import { beforeEach, describe, expect, it } from 'vitest'
import { isActivityUnread, loadLocalReadState, markChannelRead, markThreadRead, saveLocalReadState } from './read-state'

describe('local read state', () => {
  beforeEach(() => window.localStorage.clear())

  it('persists read state per client and keeps later activity unread', () => {
    const initial = loadLocalReadState('client_a')
    const afterChannel = markChannelRead(initial, 'general', '2026-07-24T10:00:00.000Z')
    const afterThread = markThreadRead(afterChannel, 'general', 'parent_12345678', '2026-07-24T10:01:00.000Z')
    saveLocalReadState('client_a', afterThread)

    expect(loadLocalReadState('client_a')).toEqual(afterThread)
    expect(loadLocalReadState('client_b')).toEqual({ channels: {}, threads: {} })
    expect(isActivityUnread('2026-07-24T10:00:00.000Z', afterThread.channels.general)).toBe(false)
    expect(isActivityUnread('2026-07-24T10:00:01.000Z', afterThread.channels.general)).toBe(true)
    expect(isActivityUnread('2026-07-24T10:01:00.000Z', afterThread.threads['general:parent_12345678'])).toBe(false)
  })
})
