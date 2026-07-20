import {
  acceptFeedback,
  claimMission,
  convertAcceptedFeedbackToTasks,
  createEmptyExchangeState,
  createMission,
  ensureExchangeUser,
  ExchangeCommandError,
  expireAbandonedClaims,
  submitFeedback,
} from '../src/exchange/domain'
import type {
  CreateMissionInput,
  ExchangeState,
  ExchangeUser,
  SubmitFeedbackInput,
} from '../src/exchange/types'

const LEGACY_STATE_KEY = 'exchange-state-v1'
const STATE_KEY = 'exchange-state-v2'
const COMMAND_PREFIX = 'exchange-command-v2:'
const MAX_COMMAND_BYTES = 64 * 1024

interface ProcessedCommand {
  fingerprint: string
}

export interface ExchangeActor {
  user: ExchangeUser
}

type ExchangeCommand =
  | { type: 'create_mission'; input: CreateMissionInput }
  | { type: 'claim_mission'; input: { missionId: string } }
  | { type: 'submit_feedback'; input: { missionId: string; feedback: SubmitFeedbackInput } }
  | { type: 'accept_feedback'; input: { missionId: string } }
  | { type: 'convert_feedback_to_tasks'; input: { missionId: string } }

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function actorFromRequest(request: Request): ExchangeActor | null {
  const encoded = request.headers.get('X-VCT-Exchange-Actor')
  if (!encoded) return null
  try {
    const actor = JSON.parse(decodeURIComponent(encoded)) as ExchangeActor
    if (!actor.user?.id || !actor.user.displayName || !['github', 'linkedin'].includes(actor.user.provider)) return null
    return actor
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number, required = true) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > maxLength) return null
  return normalized
}

function httpUrl(value: unknown, required = true) {
  const normalized = boundedString(value, 2048, required)
  if (normalized === null) return null
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return ['http:', 'https:'].includes(url.protocol) ? normalized : null
  } catch {
    return null
  }
}

function parseCreateMissionInput(input: Record<string, unknown>): CreateMissionInput | null {
  const productName = boundedString(input.productName, 100)
  const productUrl = httpUrl(input.productUrl)
  const productDescription = boundedString(input.productDescription, 1000, false)
  const title = boundedString(input.title, 160)
  const scenario = boundedString(input.scenario, 3000)
  const successCriteria = boundedString(input.successCriteria, 3000)
  const deviceRequirement = boundedString(input.deviceRequirement, 240, false)
  if ([productName, productUrl, productDescription, title, scenario, successCriteria, deviceRequirement].some((value) => value === null)) return null
  return { productName: productName!, productUrl: productUrl!, productDescription: productDescription!, title: title!, scenario: scenario!, successCriteria: successCriteria!, deviceRequirement: deviceRequirement! }
}

function parseFeedbackInput(input: Record<string, unknown>): SubmitFeedbackInput | null {
  const summary = boundedString(input.summary, 300)
  const stepsTaken = boundedString(input.stepsTaken, 4000)
  const expectedResult = boundedString(input.expectedResult, 3000)
  const actualResult = boundedString(input.actualResult, 3000)
  const recommendation = boundedString(input.recommendation, 3000)
  const evidenceUrl = input.evidenceUrl === undefined || input.evidenceUrl === '' ? '' : httpUrl(input.evidenceUrl)
  const severity = input.severity
  if ([summary, stepsTaken, expectedResult, actualResult, recommendation, evidenceUrl].some((value) => value === null)
    || !['low', 'medium', 'high'].includes(String(severity))) return null
  return {
    summary: summary!, stepsTaken: stepsTaken!, expectedResult: expectedResult!, actualResult: actualResult!,
    severity: severity as SubmitFeedbackInput['severity'], recommendation: recommendation!,
    ...(evidenceUrl ? { evidenceUrl } : {}),
  }
}

function parseCommand(value: unknown): ExchangeCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.input ?? {})) return null
  const input = value.input as Record<string, unknown>
  const missionId = boundedString(input.missionId, 160)
  if (value.type === 'create_mission') {
    const mission = parseCreateMissionInput(input)
    return mission ? { type: value.type, input: mission } : null
  }
  if (value.type === 'claim_mission' && missionId) return { type: value.type, input: { missionId } }
  if (value.type === 'submit_feedback' && typeof input.missionId === 'string' && isRecord(input.feedback)) {
    const feedback = parseFeedbackInput(input.feedback)
    return missionId && feedback ? { type: value.type, input: { missionId, feedback } } : null
  }
  if (['accept_feedback', 'convert_feedback_to_tasks'].includes(value.type) && missionId) {
    return { type: value.type as 'accept_feedback' | 'convert_feedback_to_tasks', input: { missionId } }
  }
  return null
}

function applyCommand(state: ExchangeState, actor: ExchangeActor, command: ExchangeCommand, now: string) {
  switch (command.type) {
    case 'create_mission': return createMission(state, actor.user.id, command.input, now)
    case 'claim_mission': return claimMission(state, command.input.missionId, actor.user.id, now)
    case 'submit_feedback': return submitFeedback(state, command.input.missionId, actor.user.id, command.input.feedback, now)
    case 'accept_feedback': return acceptFeedback(state, command.input.missionId, actor.user.id, now)
    case 'convert_feedback_to_tasks': return convertAcceptedFeedbackToTasks(state, command.input.missionId, actor.user.id)
  }
}

function projectStateForActor(state: ExchangeState, actorId: string): ExchangeState {
  const involvedMissionIds = new Set(state.missions
    .filter((mission) => mission.status === 'open'
      || mission.requesterId === actorId
      || state.claims.some((claim) => claim.missionId === mission.id && claim.testerId === actorId))
    .map((mission) => mission.id))
  const missions = state.missions.filter((mission) => involvedMissionIds.has(mission.id))
  const productIds = new Set(missions.map((mission) => mission.productId))
  const claims = state.claims.filter((claim) => involvedMissionIds.has(claim.missionId)
    && (claim.testerId === actorId || missions.some((mission) => mission.id === claim.missionId && mission.requesterId === actorId)))
  const feedback = state.feedback.filter((item) => involvedMissionIds.has(item.missionId)
    && (item.testerId === actorId || missions.some((mission) => mission.id === item.missionId && mission.requesterId === actorId)))
  const feedbackIds = new Set(feedback.map((item) => item.id))
  const transactions = state.transactions.filter((transaction) => transaction.actorId === actorId
    || transaction.postings.some((posting) => posting.accountId === `user:${actorId}`))
  return {
    ...state,
    products: state.products.filter((product) => product.ownerId === actorId || productIds.has(product.id)),
    missions,
    claims,
    feedback,
    transactions,
    agentRuns: state.agentRuns.filter((run) => feedbackIds.has(run.feedbackId)),
  }
}

export class ExchangeStore implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const actor = actorFromRequest(request)
    if (!actor) return json({ error: 'Authentication required' }, 401)
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)

    let command: ExchangeCommand | null = null
    let idempotencyKey: string | null = null
    if (request.method === 'POST') {
      try {
        const body = await request.text()
        if (body.length > MAX_COMMAND_BYTES) return json({ error: 'Exchange command payload is too large' }, 413)
        command = parseCommand(JSON.parse(body))
      } catch {
        command = null
      }
      if (!command) return json({ error: 'Invalid exchange command' }, 400)
      idempotencyKey = request.headers.get('Idempotency-Key')
      if (!idempotencyKey || !/^[a-zA-Z0-9:_-]{12,160}$/.test(idempotencyKey)) {
        return json({ error: 'A valid Idempotency-Key is required' }, 400)
      }
    }

    const now = new Date().toISOString()
    let snapshot: ExchangeState | null = null
    let commandErrorMessage = ''
    await this.state.storage.transaction(async (transaction) => {
      let current = await transaction.get<ExchangeState>(STATE_KEY)
      if (!current) {
        current = createEmptyExchangeState()
        await transaction.delete(LEGACY_STATE_KEY)
      }
      current = ensureExchangeUser(current, actor.user, now)
      current = expireAbandonedClaims(current, now)

      if (command && idempotencyKey) {
        const commandKey = `${COMMAND_PREFIX}${actor.user.id}:${idempotencyKey}`
        const processed = await transaction.get<ProcessedCommand | true>(commandKey)
        const fingerprint = JSON.stringify(command)
        if (processed && processed !== true && processed.fingerprint !== fingerprint) {
          commandErrorMessage = 'This idempotency key was already used for a different command'
        }
        if (!processed) {
          try {
            current = applyCommand(current, actor, command, now)
          } catch (error) {
            if (error instanceof ExchangeCommandError) commandErrorMessage = error.message
            else throw error
          }
          if (!commandErrorMessage) await transaction.put(commandKey, { fingerprint })
        }
      }

      if (!commandErrorMessage) await transaction.put(STATE_KEY, current)
      snapshot = current
    })

    if (commandErrorMessage) return json({ error: commandErrorMessage }, 409)
    return json({ state: projectStateForActor(snapshot!, actor.user.id) })
  }
}
