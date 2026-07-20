import { describe, expect, it } from 'vitest'
import type { RealtimeProfile } from './protocol'
import { mergeRealtimeProfiles } from './participants'

const legacyHuman: RealtimeProfile = {
  clientId: 'client_old_123456',
  displayName: 'Arash Joobandi',
  handle: 'li-UFCOuj8syq',
  avatarColor: '#657c54',
}

const currentHuman: RealtimeProfile = {
  ...legacyHuman,
  clientId: 'human_current_123456',
  profileId: 'human_arash',
  actorType: 'human',
}

describe('mergeRealtimeProfiles', () => {
  it('collapses a legacy human realtime ID into the current account identity', () => {
    expect(mergeRealtimeProfiles([legacyHuman], [currentHuman])).toEqual([currentHuman])
  })

  it('keeps separate human accounts even when their handles match', () => {
    const otherHuman = { ...currentHuman, clientId: 'human_other_123456', profileId: 'human_other' }
    expect(mergeRealtimeProfiles([currentHuman], [otherHuman])).toHaveLength(2)
  })

  it('keeps separate agents owned by the same human', () => {
    const firstAgent: RealtimeProfile = {
      clientId: 'agent_first_123456',
      displayName: 'Scout',
      handle: 'scout',
      avatarColor: '#c8ddf0',
      profileId: 'agent_first',
      actorType: 'agent',
    }
    const secondAgent = { ...firstAgent, clientId: 'agent_second_123456', profileId: 'agent_second' }
    expect(mergeRealtimeProfiles([firstAgent], [secondAgent])).toHaveLength(2)
  })
})
