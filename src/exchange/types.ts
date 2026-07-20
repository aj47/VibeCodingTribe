export type UserId = string

export interface ExchangeUser {
  id: UserId
  displayName: string
  handle: string
  provider: 'linkedin' | 'github'
  headline: string
  skills: string[]
  devices: string[]
  avatarColor: string
}

export interface Product {
  id: string
  ownerId: UserId
  name: string
  url: string
  description: string
  createdAt: string
}

export type MissionStatus = 'open' | 'claimed' | 'in_review' | 'accepted'

export interface Mission {
  id: string
  productId: string
  requesterId: UserId
  title: string
  scenario: string
  successCriteria: string
  deviceRequirement: string
  rewardCredits: number
  platformCredits: number
  status: MissionStatus
  createdAt: string
  acceptedAt?: string
}

export interface Claim {
  id: string
  missionId: string
  testerId: UserId
  status: 'active' | 'submitted' | 'completed' | 'expired'
  claimedAt: string
  expiresAt: string
  submittedAt?: string
}

export type FeedbackSeverity = 'low' | 'medium' | 'high'

export interface Feedback {
  id: string
  missionId: string
  claimId: string
  testerId: UserId
  note: string
  evidenceUrl?: string
  /** Older structured submissions remain readable after the freeform format change. */
  summary?: string
  stepsTaken?: string
  expectedResult?: string
  actualResult?: string
  severity?: FeedbackSeverity
  recommendation?: string
  status: 'submitted' | 'accepted'
  submittedAt: string
  acceptedAt?: string
}

export interface CreditPosting {
  accountId: string
  amount: number
  label: string
}

export interface CreditTransaction {
  id: string
  type: 'starter_grant' | 'mission_funded' | 'mission_settled'
  referenceId: string
  actorId: UserId | 'system'
  createdAt: string
  postings: CreditPosting[]
}

export interface DevelopmentTask {
  id: string
  feedbackId: string
  title: string
  description: string
  priority: 'P0' | 'P1' | 'P2'
  evidence: string
  status: 'draft'
}

export interface AgentRun {
  id: string
  feedbackId: string
  provider: 'server-planning-adapter'
  capability: 'feedback_to_tasks'
  policyVersion: '1'
  createdAt: string
  tasks: DevelopmentTask[]
}

export interface ExchangeState {
  version: 1
  sequence: number
  users: ExchangeUser[]
  products: Product[]
  missions: Mission[]
  claims: Claim[]
  feedback: Feedback[]
  transactions: CreditTransaction[]
  agentRuns: AgentRun[]
}

export interface CreateMissionInput {
  productName: string
  productUrl: string
  productDescription: string
  title: string
  scenario: string
  successCriteria: string
  deviceRequirement: string
}

export interface SubmitFeedbackInput {
  note?: string
  evidenceUrl?: string
}

export type NeedsYouAction =
  | { id: string; kind: 'submit_feedback'; missionId: string; title: string; dueAt: string }
  | { id: string; kind: 'review_feedback'; missionId: string; title: string; dueAt: string }
  | { id: string; kind: 'create_tasks'; missionId: string; title: string; dueAt: string }
