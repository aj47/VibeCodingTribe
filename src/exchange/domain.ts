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

export function systemBalance(state: ExchangeState, account: 'escrow' | 'platform' | 'reward_issuance') {
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
      name: input.productName.trim() || 'Untitled product',
      url: input.productUrl.trim(),
      description: input.productDescription.trim(),
      createdAt: now,
    }],
    missions: [...state.missions, {
      id: missionId,
      productId,
      requesterId,
      title: input.title.trim() || 'Open feedback request',
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
  if (!mission || !['open', 'claimed', 'in_review', 'accepted'].includes(mission.status)) throw new ExchangeCommandError('This mission is no longer available')
  const product = state.products.find((item) => item.id === mission.productId)
  if (!product) throw new ExchangeCommandError('The product could not be found')
  if (product.ownerId === testerId) throw new ExchangeCommandError('You cannot test your own product')
  if (state.claims.some((claim) => claim.missionId === missionId && claim.testerId === testerId && claim.status !== 'expired')) {
    throw new ExchangeCommandError('You already gave feedback for this mission')
  }
  const activeClaims = state.claims.filter((claim) => claim.testerId === testerId && ['active', 'submitted'].includes(claim.status))
  if (activeClaims.length >= EXCHANGE_DEFAULTS.activeClaimLimit) throw new ExchangeCommandError('Complete your active claim before taking another')
  const expiresAt = new Date(new Date(now).getTime() + EXCHANGE_DEFAULTS.claimHours * 60 * 60 * 1000).toISOString()
  return {
    ...state,
    sequence: state.sequence + 1,
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
  if (!mission || !['open', 'claimed', 'in_review', 'accepted'].includes(mission.status) || !claim) throw new ExchangeCommandError('You do not have an active claim for this mission')
  const feedback: Feedback = {
    id: nextId(state, 'feedback'),
    missionId,
    claimId: claim.id,
    testerId,
    note: input.note?.trim() || '',
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

function feedbackNote(feedback: Feedback) {
  return feedback.note?.trim()
    || [feedback.summary, feedback.stepsTaken, feedback.recommendation].filter(Boolean).join('\n\n').trim()
    || 'No written note was added.'
}

function feedbackTitle(feedback: Feedback) {
  const firstLine = feedbackNote(feedback).split(/\r?\n/).find(Boolean) || 'Feedback without a note'
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

export function acceptFeedback(
  state: ExchangeState,
  missionId: string,
  requesterId: UserId,
  feedbackIdOrNow?: string,
  now = new Date().toISOString(),
) {
  const mission = state.missions.find((item) => item.id === missionId)
  // Accept the first pending submission for older callers that only supplied a mission id and timestamp.
  const legacyTimestamp = feedbackIdOrNow?.match(/^\d{4}-\d{2}-\d{2}T/) ? feedbackIdOrNow : undefined
  const feedbackId = legacyTimestamp || !feedbackIdOrNow
    ? state.feedback.find((item) => item.missionId === missionId && item.status === 'submitted')?.id
    : feedbackIdOrNow
  const acceptedAt = legacyTimestamp ?? now
  const feedback = state.feedback.find((item) => item.id === feedbackId && item.missionId === missionId && item.status === 'submitted')
  const claim = feedback && state.claims.find((item) => item.id === feedback.claimId && item.status === 'submitted')
  if (!mission || mission.requesterId !== requesterId) throw new ExchangeCommandError('Only the requester can accept this feedback')
  if (mission.status !== 'in_review' || !feedback || !claim) throw new ExchangeCommandError('There is no submitted feedback to accept')
  const pendingFeedbackRemains = state.feedback.some((item) => item.missionId === missionId && item.status === 'submitted' && item.id !== feedback.id)
  const fundingAccount = systemBalance(state, 'escrow') >= EXCHANGE_DEFAULTS.missionCost ? 'system:escrow' : 'system:reward_issuance'
  const transaction: CreditTransaction = {
    id: `tx_${state.sequence + 1}`,
    type: 'mission_settled',
    referenceId: missionId,
    actorId: requesterId,
    createdAt: acceptedAt,
    postings: [
      { accountId: fundingAccount, amount: -EXCHANGE_DEFAULTS.missionCost, label: fundingAccount === 'system:escrow' ? 'Escrow released' : 'Additional feedback reward issued' },
      { accountId: `user:${claim.testerId}`, amount: EXCHANGE_DEFAULTS.testerReward, label: 'Accepted testing reward' },
      { accountId: 'system:platform', amount: EXCHANGE_DEFAULTS.platformSink, label: 'Platform credit sink' },
    ],
  }
  return {
    ...state,
    sequence: state.sequence + 1,
    missions: state.missions.map((item) => item.id === missionId ? {
      ...item,
      status: pendingFeedbackRemains ? 'in_review' as const : 'accepted' as const,
      acceptedAt,
    } : item),
    claims: state.claims.map((item) => item.id === claim.id ? { ...item, status: 'completed' as const } : item),
    feedback: state.feedback.map((item) => item.id === feedback.id ? { ...item, status: 'accepted' as const, acceptedAt } : item),
    transactions: appendTransaction(state, transaction),
  }
}

function serverPlanningAdapter(feedback: Feedback, runId: string): AgentRun {
  const note = feedbackNote(feedback)
  const tasks: DevelopmentTask[] = [
    {
      id: `${runId}_task_1`,
      feedbackId: feedback.id,
      title: `Review: ${feedbackTitle(feedback)}`,
      description: note,
      priority: 'P2',
      evidence: feedback.evidenceUrl || note,
      status: 'draft',
    },
    {
      id: `${runId}_task_2`,
      feedbackId: feedback.id,
      title: 'Decide what to change',
      description: 'Review the note with the product context and choose the smallest useful next step.',
      priority: 'P2',
      evidence: note,
      status: 'draft',
    },
    {
      id: `${runId}_task_3`,
      feedbackId: feedback.id,
      title: 'Add a regression check',
      description: 'If this feedback leads to a change, cover the path so the improvement is easy to keep.',
      priority: 'P2',
      evidence: feedback.evidenceUrl || note,
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

export function convertAcceptedFeedbackToTasks(state: ExchangeState, missionId: string, requesterId: UserId, feedbackId?: string) {
  const mission = state.missions.find((item) => item.id === missionId)
  const feedback = state.feedback.find((item) => item.missionId === missionId
    && item.status === 'accepted'
    && (!feedbackId || item.id === feedbackId)
    && !state.agentRuns.some((run) => run.feedbackId === item.id))
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
    const claims = state.claims.filter((item) => item.missionId === mission.id && item.testerId === userId && item.status === 'active')
    claims.forEach((claim) => actions.push({ id: `submit:${claim.id}`, kind: 'submit_feedback', missionId: mission.id, title: `Complete testing · ${mission.title}`, dueAt: claim.expiresAt }))
    if (mission.requesterId === userId) {
      state.feedback.filter((item) => item.missionId === mission.id && item.status === 'submitted')
        .forEach((feedback) => actions.push({ id: `review:${feedback.id}`, kind: 'review_feedback', missionId: mission.id, title: `Review feedback · ${mission.title}`, dueAt: feedback.submittedAt }))
      state.feedback.filter((item) => item.missionId === mission.id && item.status === 'accepted' && !state.agentRuns.some((run) => run.feedbackId === item.id))
        .forEach((feedback) => actions.push({ id: `tasks:${feedback.id}`, kind: 'create_tasks', missionId: mission.id, title: `Turn feedback into tasks · ${mission.title}`, dueAt: mission.acceptedAt! }))
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
