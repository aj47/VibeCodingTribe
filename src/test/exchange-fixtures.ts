import { createEmptyExchangeState, ensureExchangeUser } from '../exchange/domain'
import type { ExchangeState, ExchangeUser } from '../exchange/types'

export const requesterFixture: ExchangeUser = {
  id: 'user_a', displayName: 'Requester One', handle: 'requester-one', provider: 'linkedin',
  headline: 'Product builder', skills: ['Product testing'], devices: ['Desktop browser'], avatarColor: '#d8a64b',
}

export const testerFixture: ExchangeUser = {
  id: 'user_b', displayName: 'Tester Two', handle: 'tester-two', provider: 'github',
  headline: 'Software tester', skills: ['Accessibility'], devices: ['Mobile and desktop'], avatarColor: '#4b8b7b',
}

export function createTestExchangeState(now = '2026-07-20T16:00:00.000Z'): ExchangeState {
  const requesterState = ensureExchangeUser(createEmptyExchangeState(), requesterFixture, now)
  return ensureExchangeUser(requesterState, testerFixture, now)
}
