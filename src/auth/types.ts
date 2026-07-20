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

export interface AgentCredentialSummary {
  id: string
  name: string
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
  ownerDisplayName?: string
}
