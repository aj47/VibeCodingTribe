import { vi } from 'vitest'
import {
  acceptFeedback,
  claimMission,
  convertAcceptedFeedbackToTasks,
  createMission,
  submitFeedback,
} from '../exchange/domain'
import type { CreateMissionInput, ExchangeState, SubmitFeedbackInput } from '../exchange/types'
import { createTestExchangeState } from './exchange-fixtures'

export function installExchangeApiMock() {
  let state: ExchangeState = createTestExchangeState()
  let actorId = 'user_a'
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init || init.method === 'GET') return Response.json({ state })
    const command = JSON.parse(String(init.body)) as { type: string; input: Record<string, unknown> }
    switch (command.type) {
      case 'create_mission': state = createMission(state, actorId, command.input as unknown as CreateMissionInput); break
      case 'claim_mission': state = claimMission(state, String(command.input.missionId), actorId); break
      case 'submit_feedback': state = submitFeedback(state, String(command.input.missionId), actorId, command.input.feedback as SubmitFeedbackInput); break
      case 'accept_feedback': state = acceptFeedback(state, String(command.input.missionId), actorId, String(command.input.feedbackId)); break
      case 'convert_feedback_to_tasks': state = convertAcceptedFeedbackToTasks(state, String(command.input.missionId), actorId, command.input.feedbackId ? String(command.input.feedbackId) : undefined); break
      default: return Response.json({ error: 'Unknown command' }, { status: 400 })
    }
    return Response.json({ state })
  }))
  return {
    actAs(userId: string) { actorId = userId },
  }
}
