import { describe, expect, it } from 'vitest'
import {
  acceptFeedback,
  claimMission,
  convertAcceptedFeedbackToTasks,
  createMission,
  creditBalance,
  needsYouActions,
  submitFeedback,
  systemBalance,
} from './domain'
import type { CreateMissionInput, SubmitFeedbackInput } from './types'
import { createTestExchangeState } from '../test/exchange-fixtures'

const missionInput: CreateMissionInput = {
  productName: 'Example Product',
  productUrl: 'https://example.com',
  productDescription: 'Example product description',
  title: 'Test onboarding',
  scenario: 'Create a workspace and invite a teammate',
  successCriteria: 'Finish in under five minutes',
  deviceRequirement: 'Desktop browser',
}

const feedbackInput: SubmitFeedbackInput = {
  note: 'The invite confirmation is easy to miss. I would keep the success state visible a little longer.',
  evidenceUrl: 'https://example.com/evidence.png',
}

describe('testing exchange domain', () => {
  it('completes the funded mission, settlement, and read-only planning flow', () => {
    const initial = createTestExchangeState()
    expect(creditBalance(initial, 'user_a')).toBe(10)
    expect(creditBalance(initial, 'user_b')).toBe(10)

    const funded = createMission(initial, 'user_a', missionInput, '2026-07-20T17:00:00.000Z')
    const missionId = funded.missions[0]!.id
    expect(initial.missions).toHaveLength(0)
    expect(creditBalance(funded, 'user_a')).toBe(0)
    expect(systemBalance(funded, 'escrow')).toBe(10)

    const claimed = claimMission(funded, missionId, 'user_b', '2026-07-20T18:00:00.000Z')
    expect(needsYouActions(claimed, 'user_b')[0]?.kind).toBe('submit_feedback')

    const submitted = submitFeedback(claimed, missionId, 'user_b', feedbackInput, '2026-07-20T19:00:00.000Z')
    expect(needsYouActions(submitted, 'user_a')[0]?.kind).toBe('review_feedback')
    expect(() => convertAcceptedFeedbackToTasks(submitted, missionId, 'user_a')).toThrow(/accepted feedback/i)

    const accepted = acceptFeedback(submitted, missionId, 'user_a', submitted.feedback[0]!.id, '2026-07-20T20:00:00.000Z')
    expect(creditBalance(accepted, 'user_a')).toBe(0)
    expect(creditBalance(accepted, 'user_b')).toBe(18)
    expect(systemBalance(accepted, 'escrow')).toBe(0)
    expect(systemBalance(accepted, 'platform')).toBe(2)
    expect(accepted.transactions.every((transaction) => transaction.postings.reduce((sum, posting) => sum + posting.amount, 0) === 0)).toBe(true)

    const planned = convertAcceptedFeedbackToTasks(accepted, missionId, 'user_a')
    expect(planned.agentRuns[0]?.provider).toBe('server-planning-adapter')
    expect(planned.agentRuns[0]?.tasks).toHaveLength(3)
    expect(needsYouActions(planned, 'user_a')).toHaveLength(0)
  })

  it('prevents a builder from claiming their own product', () => {
    const funded = createMission(createTestExchangeState(), 'user_a', missionInput)
    expect(() => claimMission(funded, funded.missions[0]!.id, 'user_a')).toThrow(/own product/i)
  })

  it('accepts a feedback submission with no written fields', () => {
    const funded = createMission(createTestExchangeState(), 'user_a', missionInput)
    const missionId = funded.missions[0]!.id
    const claimed = claimMission(funded, missionId, 'user_b')
    const submitted = submitFeedback(claimed, missionId, 'user_b', {})

    expect(submitted.feedback[0]?.note).toBe('')
    expect(submitted.claims[0]?.status).toBe('submitted')
  })

  it('allows multiple testers to submit and settle feedback for one mission', () => {
    const initial = createTestExchangeState()
    const thirdTester = { ...initial.users[1]!, id: 'user_c', displayName: 'Tester Three' }
    const withThirdTester = { ...initial, users: [...initial.users, thirdTester] }
    const funded = createMission(withThirdTester, 'user_a', missionInput)
    const missionId = funded.missions[0]!.id
    const firstClaim = claimMission(funded, missionId, 'user_b')
    const secondClaim = claimMission(firstClaim, missionId, 'user_c')
    expect(secondClaim.claims.filter((claim) => claim.missionId === missionId && claim.status === 'active')).toHaveLength(2)

    const firstSubmitted = submitFeedback(secondClaim, missionId, 'user_b', feedbackInput)
    const secondSubmitted = submitFeedback(firstSubmitted, missionId, 'user_c', { ...feedbackInput, note: 'Keyboard navigation needs a clearer focus state' })
    expect(secondSubmitted.feedback.filter((item) => item.status === 'submitted')).toHaveLength(2)

    const firstAccepted = acceptFeedback(secondSubmitted, missionId, 'user_a', secondSubmitted.feedback[0]!.id)
    expect(firstAccepted.missions[0]!.status).toBe('in_review')
    expect(creditBalance(firstAccepted, 'user_b')).toBe(18)
    expect(systemBalance(firstAccepted, 'escrow')).toBe(0)

    const secondAccepted = acceptFeedback(firstAccepted, missionId, 'user_a', secondSubmitted.feedback[1]!.id)
    expect(secondAccepted.missions[0]!.status).toBe('accepted')
    expect(creditBalance(secondAccepted, 'user_c')).toBe(8)
    expect(secondAccepted.feedback.filter((item) => item.status === 'accepted')).toHaveLength(2)
    expect(systemBalance(secondAccepted, 'reward_issuance')).toBe(-10)
    expect(secondAccepted.transactions.every((transaction) => transaction.postings.reduce((sum, posting) => sum + posting.amount, 0) === 0)).toBe(true)
  })
})
