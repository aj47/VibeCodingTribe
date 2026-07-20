import { describe, expect, it } from 'vitest'
import { creditBalance, systemBalance } from '../src/exchange/domain'
import type { ExchangeState, ExchangeUser } from '../src/exchange/types'
import { ExchangeStore, type ExchangeActor } from './exchange'

interface FakeTransaction {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}

function createStore() {
  const values = new Map<string, unknown>()
  const storage = {
    transaction: async (callback: (transaction: FakeTransaction) => Promise<void>) => callback({
      get: async <T,>(key: string) => values.get(key) as T | undefined,
      put: async (key: string, value: unknown) => { values.set(key, value) },
    }),
  }
  return new ExchangeStore({ storage } as never)
}

const maya: ExchangeUser = {
  id: 'user_a', displayName: 'Maya Chen', handle: 'mayabuilds', provider: 'linkedin',
  headline: 'Builder', skills: ['React'], devices: ['MacBook'], avatarColor: '#d8a64b',
}
const theo: ExchangeUser = {
  id: 'user_b', displayName: 'Theo Grant', handle: 'theotests', provider: 'github',
  headline: 'Tester', skills: ['Accessibility'], devices: ['Windows'], avatarColor: '#4b8b7b',
}

function request(actor: ExchangeActor, body?: unknown, idempotencyKey?: string) {
  const headers = new Headers({ 'X-VCT-Exchange-Actor': encodeURIComponent(JSON.stringify(actor)) })
  if (body) headers.set('Content-Type', 'application/json')
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
  return new Request('https://worker.example/api/exchange', {
    method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function stateFrom(response: Response) {
  const body = await response.json() as { state: ExchangeState }
  return body.state
}

describe('ExchangeStore', () => {
  it('persists and authorizes the complete credit settlement flow', async () => {
    const store = createStore()
    const mayaActor = { user: maya }
    const theoActor = { user: theo }
    let state = await stateFrom(await store.fetch(request(mayaActor)))
    expect(creditBalance(state, maya.id)).toBe(10)

    state = await stateFrom(await store.fetch(request(mayaActor, { type: 'create_mission', input: {
      productName: 'Relay Notes', productUrl: 'https://example.com', productDescription: 'Handoffs',
      title: 'Test onboarding', scenario: 'Create a workspace', successCriteria: 'Finish the flow', deviceRequirement: 'Desktop',
    } }, 'command_create_123')))
    const missionId = state.missions[0]!.id
    expect(creditBalance(state, maya.id)).toBe(0)
    expect(systemBalance(state, 'escrow')).toBe(10)

    state = await stateFrom(await store.fetch(request(theoActor, { type: 'claim_mission', input: { missionId } }, 'command_claim_123')))
    state = await stateFrom(await store.fetch(request(theoActor, { type: 'submit_feedback', input: { missionId, feedback: {
      summary: 'Confirmation disappears', stepsTaken: 'Invited a teammate', expectedResult: 'Persistent state',
      actualResult: 'Short toast', severity: 'medium', recommendation: 'Show a pending row',
    } } }, 'command_feedback_123')))
    state = await stateFrom(await store.fetch(request(mayaActor, { type: 'accept_feedback', input: { missionId } }, 'command_accept_123')))
    expect(systemBalance(state, 'escrow')).toBe(0)
    expect(systemBalance(state, 'platform')).toBe(2)

    const theoState = await stateFrom(await store.fetch(request(theoActor)))
    expect(creditBalance(theoState, theo.id)).toBe(18)

    const replayed = await stateFrom(await store.fetch(request(mayaActor, { type: 'accept_feedback', input: { missionId } }, 'command_accept_123')))
    expect(replayed.transactions).toHaveLength(state.transactions.length)

    state = await stateFrom(await store.fetch(request(mayaActor, { type: 'convert_feedback_to_tasks', input: { missionId } }, 'command_tasks_123')))
    expect(state.agentRuns[0]?.provider).toBe('server-planning-adapter')
    expect(state.agentRuns[0]?.tasks).toHaveLength(3)
  })

  it('requires authentication and idempotency keys', async () => {
    const store = createStore()
    expect((await store.fetch(new Request('https://worker.example/api/exchange'))).status).toBe(401)
    expect((await store.fetch(request({ user: maya }, { type: 'claim_mission', input: { missionId: 'missing' } }))).status).toBe(400)
  })

  it('rejects malformed inputs and idempotency-key reuse for another command', async () => {
    const store = createStore()
    const actor = { user: maya }
    const malformed = await store.fetch(request(actor, { type: 'create_mission', input: {
      productName: ['not a string'], productUrl: 'javascript:alert(1)', title: 'Mission',
      scenario: 'Try it', successCriteria: 'It works', productDescription: '', deviceRequirement: '',
    } }, 'command_invalid_123'))
    expect(malformed.status).toBe(400)

    const created = await store.fetch(request(actor, { type: 'create_mission', input: {
      productName: 'Relay Notes', productUrl: 'https://example.com', productDescription: '',
      title: 'Test onboarding', scenario: 'Create a workspace', successCriteria: 'Finish the flow', deviceRequirement: '',
    } }, 'command_reused_123'))
    expect(created.status).toBe(200)

    const conflicting = await store.fetch(request(actor, {
      type: 'claim_mission', input: { missionId: 'mission_4' },
    }, 'command_reused_123'))
    expect(conflicting.status).toBe(409)
    expect(await conflicting.json()).toEqual({ error: 'This idempotency key was already used for a different command' })
  })
})
