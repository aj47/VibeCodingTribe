import type { ExchangeState } from '../exchange/types'
import { authOrigin, getSessionToken } from './auth'

export type ExchangeCommandType =
  | 'create_mission'
  | 'claim_mission'
  | 'submit_feedback'
  | 'accept_feedback'
  | 'convert_feedback_to_tasks'

export class ExchangeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function commandId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `exchange_${random}`
}

function parseSnapshot(value: unknown): ExchangeState {
  const body = value as { state?: ExchangeState }
  if (!body?.state || body.state.version !== 1 || !Array.isArray(body.state.transactions)) {
    throw new ExchangeApiError('The exchange returned an invalid snapshot', 502)
  }
  return body.state
}

export class ExchangeApiClient {
  async snapshot() {
    return this.request('GET')
  }

  async command(type: ExchangeCommandType, input: Record<string, unknown> = {}) {
    return this.request('POST', { type, input }, commandId())
  }

  private async request(method: 'GET' | 'POST', body?: unknown, idempotencyKey?: string) {
    const headers = new Headers({ Accept: 'application/json' })
    const token = getSessionToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (body) headers.set('Content-Type', 'application/json')
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

    let response: Response
    try {
      response = await fetch(new URL('/api/exchange', authOrigin()), {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new ExchangeApiError('The exchange service is unavailable. Check the Worker connection and retry.', 0)
    }
    const value = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ExchangeApiError(value.error || 'The exchange request failed', response.status)
    return parseSnapshot(value)
  }
}
