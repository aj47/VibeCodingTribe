export type AuthProvider = 'github' | 'linkedin'

export interface AuthUser {
  id: string
  provider: AuthProvider
  displayName: string
  handle: string
  realtimeClientId: string
  avatarUrl?: string
  email?: string
}

export interface AuthSession {
  user: AuthUser
  expiresAt: string
  sessionToken?: string
}
