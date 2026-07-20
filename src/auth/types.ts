export type AuthProvider = 'github' | 'linkedin'

export interface AuthUser {
  id: string
  provider: AuthProvider
  displayName: string
  handle: string
  realtimeClientId: string
  avatarUrl?: string
  email?: string
  headline?: string
  githubUrl?: string
  linkedinUrl?: string
  linkedProviders?: AuthProvider[]
}

export interface AuthSession {
  user: AuthUser
  expiresAt: string
  sessionToken?: string
}

export interface PublicHumanProfile {
  id: string
  displayName: string
  handle: string
  realtimeClientId: string
  avatarUrl?: string
  headline?: string
  githubUrl?: string
  linkedinUrl?: string
  linkedProviders: AuthProvider[]
}

export interface PublicAgentProfile {
  id: string
  displayName: string
  handle: string
  avatarUrl?: string
  avatarColor?: string
  actorType: 'agent'
  ownerHandle: string
  owner: PublicHumanProfile
}

export type PublicProfile = PublicHumanProfile | PublicAgentProfile

export interface AgentCredentialSummary {
  id: string
  name: string
  handle: string
  avatarUrl?: string
  keyPrefix: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export interface AgentEnrollment {
  id: string
  name: string
  callbackUrl: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'authorized' | 'delivered' | 'failed'
  avatarUrl?: string
  ownerDisplayName?: string
}
