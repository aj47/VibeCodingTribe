import type {
  AgentRun,
  CreateMissionInput,
  CreditTransaction,
  DevelopmentTask,
  ExchangeState,
  Feedback,
  NeedsYouAction,
  SubmitFeedbackInput,
  UserId,
} from './types'

export const EXCHANGE_DEFAULTS = {
  starterGrant: 10,
  missionCost: 10,
  testerReward: 8,
  platformSink: 2,
  activeClaimLimit: 1,
  claimHours: 48,
} as const

export class ExchangeCommandError extends Error {}

function nextId(state: ExchangeState, prefix: string) {
  return `${prefix}_${state.sequence + 1}`
}

function validateTransaction(transaction: CreditTransaction) {
  const total = transaction.postings.reduce((sum, posting) => sum + posting.amount, 0)
  if (total !== 0) throw new ExchangeCommandError('Credit postings must balance to zero')
}

function appendTransaction(state: ExchangeState, transaction: CreditTransaction) {
  validateTransaction(transaction)
  return [...state.transactions, transaction]
}

export function createEmptyExchangeState(): ExchangeState {
  return {
    version: 1,
    sequence: 0,
    users: [],
    products: [],
    missions: [],
    claims: [],
    feedback: [],
    transactions: [],
    agentRuns: [],
  }
}

export function ensureExchangeUser(state: ExchangeState, user: ExchangeState['users'][number], now = new Date().toISOString()) {
  if (state.users.some((item) => item.id === user.id)) return state
  const transaction: CreditTransaction = {
    id: `tx_${state.sequence + 1}`,
    type: 'starter_grant',
    referenceId: `starter-grant:${user.id}`,
    actorId: 'system',
    createdAt: now,
    postings: [
      { accountId: 'system:grants', amount: -EXCHANGE_DEFAULTS.starterGrant, label: 'Starter credit pool' },
      { accountId: `user:${user.id}`, amount: EXCHANGE_DEFAULTS.starterGrant, label: 'New-user grant' },
    ],
  }
  return {
    ...state,
    sequence: state.sequence + 1,
    users: [...state.users, user],
    transactions: appendTransaction(state, transaction),
  }
}

export function expireAbandonedClaims(state: ExchangeState, now = new Date().toISOString()) {
  const expiredMissionIds = new Set(state.claims
    .filter((claim) => claim.status === 'active' && claim.expiresAt <= now)
    .map((claim) => claim.missionId))
  if (!expiredMissionIds.size) return state
  return {
    ...state,
    missions: state.missions.map((mission) => expiredMissionIds.has(mission.id) && mission.status === 'claimed'
      ? { ...mission, status: 'open' as const }
      : mission),
    claims: state.claims.map((claim) => expiredMissionIds.has(claim.missionId) && claim.status === 'active'
      ? { ...claim, status: 'expired' as const }
      : claim),
  }
}

export function creditBalance(state: ExchangeState, userId: UserId) {
  return state.transactions.flatMap((transaction) => transaction.postings)
    .filter((posting) => posting.accountId === `user:${userId}`)
    .reduce((sum, posting) => sum + posting.amount, 0)
}

export function systemBalance(state: ExchangeState, account: 'escrow' | 'platform') {
  return state.transactions.flatMap((transaction) => transaction.postings)
    .filter((posting) => posting.accountId === `system:${account}`)
    .reduce((sum, posting) => sum + posting.amount, 0)
}

export function createMission(
  state: ExchangeState,
  requesterId: UserId,
  input: CreateMissionInput,
  now = new Date().toISOString(),
): ExchangeState {
  if (creditBalance(state, requesterId) < EXCHANGE_DEFAULTS.missionCost) {
    throw new ExchangeCommandError('You need 10 credits to publish this mission')
  }
  if (!input.productName.trim() || !input.title.trim() || !input.scenario.trim() || !input.successCriteria.trim()) {
    throw new ExchangeCommandError('Complete the product, mission, scenario, and success criteria fields')
  }

  const productId = nextId(state, 'product')
  const missionId = `mission_${state.sequence + 2}`
  const transactionId = `tx_${state.sequence + 3}`
  const transaction: CreditTransaction = {
    id: transactionId,
    type: 'mission_funded',
    referenceId: missionId,
    actorId: requesterId,
    createdAt: now,
    postings: [
      { accountId: `user:${requesterId}`, amount: -EXCHANGE_DEFAULTS.missionCost, label: 'Mission funded' },
      { accountId: 'system:escrow', amount: EXCHANGE_DEFAULTS.missionCost, label: 'Mission escrow' },
    ],
  }

  return {
    ...state,
    sequence: state.sequence + 3,
    products: [...state.products, {
      id: productId,
      ownerId: requesterId,
      name: input.productName.trim(),
      url: input.productUrl.trim(),
      description: input.productDescription.trim(),
      createdAt: now,
    }],
    missions: [...state.missions, {
      id: missionId,
      productId,
      requesterId,
      title: input.title.trim(),
      scenario: input.scenario.trim(),
      successCriteria: input.successCriteria.trim(),
      deviceRequirement: input.deviceRequirement.trim() || 'Any desktop browser',
      rewardCredits: EXCHANGE_DEFAULTS.testerReward,
      platformCredits: EXCHANGE_DEFAULTS.platformSink,
      status: 'open',
      createdAt: now,
    }],
    transactions: appendTransaction(state, transaction),
  }
}

export function claimMission(state: ExchangeState, missionId: string, testerId: UserId, now = new Date().toISOString()) {
  const mission = state.missions.find((item) => item.id === missionId)
  if (!mission || mission.status !== 'open') throw new ExchangeCommandError('This mission is no longer available')
  const product = state.products.find((item) => item.id === mission.productId)
  if (!product) throw new ExchangeCommandError('The product could not be found')
  if (product.ownerId === testerId) throw new ExchangeCommandError('You cannot test your own product')
  const activeClaims = state.claims.filter((claim) => claim.testerId === testerId && ['active', 'submitted'].includes(claim.status))
  if (activeClaims.length >= EXCHANGE_DEFAULTS.activeClaimLimit) throw new ExchangeCommandError('Complete your active claim before taking another')
  const expiresAt = new Date(new Date(now).getTime() + EXCHANGE_DEFAULTS.claimHours * 60 * 60 * 1000).toISOString()
  return {
    ...state,
    sequence: state.sequence + 1,
    missions: state.missions.map((item) => item.id === missionId ? { ...item, status: 'claimed' as const } : item),
    claims: [...state.claims, {
      id: nextId(state, 'claim'),
      missionId,
      testerId,
      status: 'active' as const,
      claimedAt: now,
      expiresAt,
    }],
  }
}

export function submitFeedback(
  state: ExchangeState,
  missionId: string,
  testerId: UserId,
  input: SubmitFeedbackInput,
  now = new Date().toISOString(),
) {
  const mission = state.missions.find((item) => item.id === missionId)
  const claim = state.claims.find((item) => item.missionId === missionId && item.testerId === testerId && item.status === 'active')
  if (!mission || mission.status !== 'claimed' || !claim) throw new ExchangeCommandError('You do not have an active claim for this mission')
  if ([input.summary, input.stepsTaken, input.expectedResult, input.actualResult, input.recommendation].some((value) => !value.trim())) {
    throw new ExchangeCommandError('Complete every feedback field before submitting')
  }
  const feedback: Feedback = {
    id: nextId(state, 'feedback'),
    missionId,
    claimId: claim.id,
    testerId,
    summary: input.summary.trim(),
    stepsTaken: input.stepsTaken.trim(),
    expectedResult: input.expectedResult.trim(),
    actualResult: input.actualResult.trim(),
    severity: input.severity,
    recommendation: input.recommendation.trim(),
    ...(input.evidenceUrl?.trim() ? { evidenceUrl: input.evidenceUrl.trim() } : {}),
    status: 'submitted',
    submittedAt: now,
  }
  return {
    ...state,
    sequence: state.sequence + 1,
    missions: state.missions.map((item) => item.id === missionId ? { ...item, status: 'in_review' as const } : item),
    claims: state.claims.map((item) => item.id === claim.id ? { ...item, status: 'submitted' as const, submittedAt: now } : item),
    feedback: [...state.feedback, feedback],
  }
}

export function acceptFeedback(state: ExchangeState, missionId: string, requesterId: UserId, now = new Date().toISOString()) {
  const mission = state.missions.find((item) => item.id === missionId)
  const feedback = state.feedback.find((item) => item.missionId === missionId && item.status === 'submitted')
  const claim = state.claims.find((item) => item.missionId === missionId && item.status === 'submitted')
  if (!mission || mission.requesterId !== requesterId) throw new ExchangeCommandError('Only the requester can accept this feedback')
  if (mission.status !== 'in_review' || !feedback || !claim) throw new ExchangeCommandError('There is no submitted feedback to accept')
  if (state.transactions.some((transaction) => transaction.type === 'mission_settled' && transaction.referenceId === missionId)) {
    throw new ExchangeCommandError('This mission has already been settled')
  }
  const transaction: CreditTransaction = {
    id: `tx_${state.sequence + 1}`,
    type: 'mission_settled',
    referenceId: missionId,
    actorId: requesterId,
    createdAt: now,
    postings: [
      { accountId: 'system:escrow', amount: -EXCHANGE_DEFAULTS.missionCost, label: 'Escrow released' },
      { accountId: `user:${claim.testerId}`, amount: EXCHANGE_DEFAULTS.testerReward, label: 'Accepted testing reward' },
      { accountId: 'system:platform', amount: EXCHANGE_DEFAULTS.platformSink, label: 'Platform credit sink' },
    ],
  }
  return {
    ...state,
    sequence: state.sequence + 1,
    missions: state.missions.map((item) => item.id === missionId ? { ...item, status: 'accepted' as const, acceptedAt: now } : item),
    claims: state.claims.map((item) => item.id === claim.id ? { ...item, status: 'completed' as const } : item),
    feedback: state.feedback.map((item) => item.id === feedback.id ? { ...item, status: 'accepted' as const, acceptedAt: now } : item),
    transactions: appendTransaction(state, transaction),
  }
}

function serverPlanningAdapter(feedback: Feedback, runId: string): AgentRun {
  const severityPriority = feedback.severity === 'high' ? 'P0' : feedback.severity === 'medium' ? 'P1' : 'P2'
  const tasks: DevelopmentTask[] = [
    {
      id: `${runId}_task_1`,
      feedbackId: feedback.id,
      title: `Reproduce: ${feedback.summary}`,
      description: `Follow the tester path: ${feedback.stepsTaken}`,
      priority: severityPriority,
      evidence: feedback.actualResult,
      status: 'draft',
    },
    {
      id: `${runId}_task_2`,
      feedbackId: feedback.id,
      title: `Restore the expected experience`,
      description: `Target outcome: ${feedback.expectedResult}`,
      priority: severityPriority === 'P0' ? 'P1' : severityPriority,
      evidence: feedback.recommendation,
      status: 'draft',
    },
    {
      id: `${runId}_task_3`,
      feedbackId: feedback.id,
      title: 'Add a regression check',
      description: 'Cover the accepted feedback path and preserve the expected result in future releases.',
      priority: 'P2',
      evidence: feedback.evidenceUrl || 'Structured feedback record',
      status: 'draft',
    },
  ]
  return {
    id: runId,
    feedbackId: feedback.id,
    provider: 'server-planning-adapter',
    capability: 'feedback_to_tasks',
    policyVersion: '1',
    createdAt: feedback.acceptedAt!,
    tasks,
  }
}

export function convertAcceptedFeedbackToTasks(state: ExchangeState, missionId: string, requesterId: UserId) {
  const mission = state.missions.find((item) => item.id === missionId)
  const feedback = state.feedback.find((item) => item.missionId === missionId && item.status === 'accepted')
  if (!mission || mission.requesterId !== requesterId) throw new ExchangeCommandError('Only the requester can create tasks')
  if (!feedback) throw new ExchangeCommandError('Only accepted feedback can be converted into tasks')
  if (state.agentRuns.some((run) => run.feedbackId === feedback.id)) return state
  const runId = nextId(state, 'agent_run')
  return {
    ...state,
    sequence: state.sequence + 1,
    agentRuns: [...state.agentRuns, serverPlanningAdapter(feedback, runId)],
  }
}

export function needsYouActions(state: ExchangeState, userId: UserId): NeedsYouAction[] {
  const actions: NeedsYouAction[] = []
  for (const mission of state.missions) {
    const claim = state.claims.find((item) => item.missionId === mission.id)
    const feedback = state.feedback.find((item) => item.missionId === mission.id)
    if (mission.status === 'claimed' && claim?.testerId === userId) {
      actions.push({ id: `submit:${mission.id}`, kind: 'submit_feedback', missionId: mission.id, title: `Complete testing · ${mission.title}`, dueAt: claim.expiresAt })
    }
    if (mission.status === 'in_review' && mission.requesterId === userId && feedback) {
      actions.push({ id: `review:${mission.id}`, kind: 'review_feedback', missionId: mission.id, title: `Review feedback · ${mission.title}`, dueAt: feedback.submittedAt })
    }
    if (mission.status === 'accepted' && mission.requesterId === userId && feedback && !state.agentRuns.some((run) => run.feedbackId === feedback.id)) {
      actions.push({ id: `tasks:${mission.id}`, kind: 'create_tasks', missionId: mission.id, title: `Turn feedback into tasks · ${mission.title}`, dueAt: mission.acceptedAt! })
    }
  }
  return actions
}

export function reputationFor(state: ExchangeState, userId: UserId) {
  const tested = state.claims.filter((claim) => claim.testerId === userId)
  const accepted = state.feedback.filter((item) => item.testerId === userId && item.status === 'accepted')
  const requested = state.missions.filter((mission) => mission.requesterId === userId)
  return {
    testerAccepted: accepted.length,
    testerCompleted: tested.filter((claim) => claim.status === 'completed').length,
    requesterCompleted: requested.filter((mission) => mission.status === 'accepted').length,
  }
}
