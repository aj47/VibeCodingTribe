import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthProvider, AuthSession } from './auth/types'
import { AgentInvitePage } from './components/AgentInvitePage'
import { AgentAuthorizationPage } from './components/AgentAuthorizationPage'
import { AuthScreen } from './components/AuthScreen'
import { CommunityFeed } from './components/CommunityFeed'
import { ProfilePage } from './components/ProfilePage'
import {
  MAX_REALTIME_MESSAGE_LENGTH,
  type RealtimeMessageRecord,
  type RealtimeProfile,
} from './realtime/protocol'
import {
  authErrorFromLocation,
  beginOAuth,
  clearAuthSession,
  consumeAuthCallback,
  getSessionToken,
  loadAuthSession,
} from './services/auth'
import {
  createRealtimeMessageId,
  loadRealtimeProfile,
  RealtimeRoomClient,
  saveRealtimeProfile,
} from './services/realtime'
import { mergeRealtimeProfiles } from './realtime/participants'
import type { CommunityPostInput } from './community/types'
import { uploadCommunityImage } from './services/media'

type Surface = 'home' | 'community' | 'invite-agent' | 'profile' | 'authorize-agent'
type ConnectionStatus = 'connected' | 'syncing' | 'offline'

const LEGACY_STORAGE_KEYS = ['vct-workspace-v3', 'vct-realtime-profile-v1', 'vct-realtime-outbox-v1']

function loadSurface(): Surface {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/exchange') {
    window.history.replaceState({}, '', `/missions${window.location.search}${window.location.hash}`)
  }
  if (path === '/welcome') return 'home'
  if (path === '/invite-agent') return 'invite-agent'
  if (path === '/settings/profile' || path === '/badges' || path.startsWith('/p/')) return 'profile'
  if (path.startsWith('/agents/authorize/')) return 'authorize-agent'
  return 'community'
}

function mergeMessages(current: RealtimeMessageRecord[], incoming: RealtimeMessageRecord[]) {
  const merged = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) merged.set(message.id, message)
  return [...merged.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

export function App() {
  const [surface, setSurface] = useState<Surface>(loadSurface)
  const [authPendingProvider, setAuthPendingProvider] = useState<AuthProvider | null>(null)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [sessionToken, setSessionToken] = useState(consumeAuthCallback)
  const [authChecking, setAuthChecking] = useState(() => Boolean(getSessionToken()))
  const [authError] = useState(authErrorFromLocation)
  const [localPreview, setLocalPreview] = useState(() => import.meta.env.DEV && window.sessionStorage.getItem('vct-community-preview-v1') === 'true')
  const [profile, setProfile] = useState<RealtimeProfile>(loadRealtimeProfile)
  const [messages, setMessages] = useState<RealtimeMessageRecord[]>([])
  const [knownProfiles, setKnownProfiles] = useState<RealtimeProfile[]>([])
  const [onlineProfiles, setOnlineProfiles] = useState<RealtimeProfile[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('syncing')
  const realtimeClientRef = useRef<RealtimeRoomClient | null>(null)
  const profileBackRef = useRef<Surface>('community')
  const canPost = Boolean(authSession) || localPreview

  useEffect(() => {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key)
  }, [])

  useEffect(() => {
    const handlePopState = () => setSurface(loadSurface())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (surface === 'home') {
      if (window.location.pathname !== '/welcome') window.history.replaceState({}, '', '/welcome')
      document.title = 'VibeCodingTribe · Build in public, together'
      return
    }
    if (surface === 'community') {
      if (window.location.pathname === '/r/general') window.history.replaceState({}, '', '/')
      document.title = window.location.pathname === '/missions' ? 'Needs Feedback · VibeCodingTribe' : 'Community Feed · VibeCodingTribe'
      return
    }
    if (surface === 'invite-agent') {
      window.history.replaceState({}, '', '/invite-agent')
      document.title = 'Invite your agent · VibeCodingTribe'
      return
    }
    if (surface === 'profile') {
      document.title = 'Human profile · VibeCodingTribe'
      return
    }
    if (surface === 'authorize-agent') {
      document.title = 'Authorize agent · VibeCodingTribe'
    }
  }, [surface])

  useEffect(() => {
    if (!sessionToken) {
      setAuthChecking(false)
      return
    }
    let active = true
    setAuthChecking(true)
    void loadAuthSession(sessionToken).then((session) => {
      if (!active) return
      if (!session) {
        clearAuthSession()
        setSessionToken(null)
        setAuthSession(null)
        setAuthChecking(false)
        return
      }
      const authenticatedProfile: RealtimeProfile = {
        clientId: session.user.realtimeClientId,
        displayName: session.user.displayName,
        handle: session.user.handle,
        avatarColor: session.user.provider === 'github' ? '#9bcf66' : '#70a8c4',
        ...(session.user.avatarUrl ? { avatarUrl: session.user.avatarUrl } : {}),
        profileId: session.user.id,
        actorType: 'human',
      }
      saveRealtimeProfile(authenticatedProfile)
      setProfile(authenticatedProfile)
      setKnownProfiles([authenticatedProfile])
      setAuthSession(session)
      setAuthChecking(false)
    })
    return () => { active = false }
  }, [sessionToken])

  const rememberProfiles = useCallback((profiles: RealtimeProfile[]) => {
    if (!profiles.length) return
    setKnownProfiles((current) => mergeRealtimeProfiles(current, profiles))
  }, [])

  const rememberMessageAuthors = useCallback((records: RealtimeMessageRecord[]) => {
    rememberProfiles(records.map((record) => ({
      clientId: record.clientId,
      displayName: record.displayName,
      handle: record.handle,
      avatarColor: record.avatarColor,
      ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
      ...(record.profileId ? { profileId: record.profileId } : {}),
      ...(record.actorType ? { actorType: record.actorType } : {}),
      ...(record.ownerHandle ? { ownerHandle: record.ownerHandle } : {}),
      ...(record.ownerProfileId ? { ownerProfileId: record.ownerProfileId } : {}),
    })))
  }, [rememberProfiles])

  useEffect(() => {
    if (surface !== 'community' || authChecking) return
    const activeSessionToken = authSession ? (getSessionToken() ?? sessionToken ?? undefined) : undefined
    const client = new RealtimeRoomClient(profile, {
      onStatus: setConnectionStatus,
      onEvent: (event) => {
        if (event.type === 'snapshot') {
          setMessages((current) => mergeMessages(current, event.messages))
          rememberMessageAuthors(event.messages)
          rememberProfiles(event.participants)
          setOnlineProfiles(event.participants)
          setOnlineCount(event.onlineCount)
          return
        }
        if (event.type === 'message') {
          setMessages((current) => mergeMessages(current, [event.message]))
          rememberMessageAuthors([event.message])
          return
        }
        if (event.type === 'presence') {
          rememberProfiles(event.participants)
          setOnlineProfiles(event.participants)
          setOnlineCount(event.onlineCount)
          return
        }
        // The feed keeps optimistic posts visible; reconnecting retries them from the durable outbox.
      },
    }, undefined, activeSessionToken, canPost)
    realtimeClientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
      if (realtimeClientRef.current === client) realtimeClientRef.current = null
    }
  }, [authChecking, authSession, canPost, profile, rememberMessageAuthors, rememberProfiles, sessionToken, surface])

  const participants = useMemo(() => {
    const onlineIds = new Set(onlineProfiles.map((item) => item.clientId))
    return knownProfiles
      .map((item) => ({ ...item, online: onlineIds.has(item.clientId) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName))
  }, [knownProfiles, onlineProfiles])

  const sendMessage = useCallback((value: string | CommunityPostInput) => {
    if (!canPost) return
    const input = typeof value === 'string' ? { text: value } : value
    const text = input.text.trim().slice(0, MAX_REALTIME_MESSAGE_LENGTH)
    if (!text && !input.imageUrl) return
    const id = createRealtimeMessageId(profile.clientId)
    const optimisticMessage: RealtimeMessageRecord = {
      id,
      clientId: profile.clientId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarColor: profile.avatarColor,
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile.profileId ? { profileId: profile.profileId } : {}),
      ...(profile.actorType ? { actorType: profile.actorType } : {}),
      ...(profile.ownerHandle ? { ownerHandle: profile.ownerHandle } : {}),
      text,
      sentAt: new Date().toISOString(),
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.commentKind ? { commentKind: input.commentKind } : {}),
      ...(input.buildName ? { buildName: input.buildName.trim().slice(0, 80) } : {}),
      ...(input.buildUrl ? { buildUrl: input.buildUrl } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    }
    setMessages((current) => mergeMessages(current, [optimisticMessage]))
    realtimeClientRef.current?.send({
      id,
      text,
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.commentKind ? { commentKind: input.commentKind } : {}),
      ...(input.buildName ? { buildName: input.buildName.trim().slice(0, 80) } : {}),
      ...(input.buildUrl ? { buildUrl: input.buildUrl } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    })
  }, [canPost, profile])

  const toggleLike = useCallback((messageId: string, liked: boolean) => {
    if (!canPost) return
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message
      const likedBy = new Set(message.likedByClientIds ?? [])
      if (liked) likedBy.add(profile.clientId)
      else likedBy.delete(profile.clientId)
      return { ...message, likedByClientIds: [...likedBy] }
    }))
    realtimeClientRef.current?.setLike(messageId, liked)
  }, [canPost, profile.clientId])

  if (surface === 'home' && authChecking) {
    return (
      <main className="session-check" aria-live="polite">
        <span />
        <p>Checking your room session…</p>
      </main>
    )
  }

  const openHome = () => {
    window.history.pushState({}, '', '/')
    setSurface('community')
  }

  const openRoom = () => {
    window.history.pushState({}, '', '/')
    setSurface('community')
  }

  const openMissions = () => {
    window.history.pushState({}, '', '/missions')
    setSurface('community')
  }

  const openExchange = () => {
    openMissions()
  }

  const openAgentInvite = () => {
    window.history.pushState({}, '', '/invite-agent')
    setSurface('invite-agent')
  }

  const openOwnProfile = () => {
    profileBackRef.current = surface
    window.history.pushState({}, '', '/settings/profile')
    setSurface('profile')
  }

  const openPublicProfile = (profileId: string) => {
    profileBackRef.current = 'community'
    window.history.pushState({}, '', `/p/${encodeURIComponent(profileId)}`)
    setSurface('profile')
  }

  const backFromProfile = () => {
    if (profileBackRef.current === 'invite-agent') return openAgentInvite()
    if (profileBackRef.current === 'home') return openHome()
    return openHome()
  }

  if (surface === 'home') {
    return (
      <AuthScreen
        pendingProvider={authPendingProvider}
        authError={authError}
        onSignIn={(provider) => {
          setAuthPendingProvider(provider)
          beginOAuth(provider)
        }}
        onOpenExchange={openExchange}
        onOpenRoom={openRoom}
        onInviteAgent={openAgentInvite}
      />
    )
  }

  if (surface === 'invite-agent') {
    return <AgentInvitePage session={authSession} onOpenRoom={openRoom} onBackHome={openHome} onSignIn={() => {
      setAuthPendingProvider('github')
      beginOAuth('github', '/invite-agent')
    }} onOpenProfile={openOwnProfile} />
  }

  if (surface === 'authorize-agent') {
    const enrollmentId = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
    return <AgentAuthorizationPage enrollmentId={enrollmentId} session={authSession} onBack={openAgentInvite} onSignIn={() => {
      setAuthPendingProvider('github')
      beginOAuth('github', window.location.pathname)
    }} />
  }

  if (surface === 'profile') {
    const pathProfileId = window.location.pathname.startsWith('/p/') ? decodeURIComponent(window.location.pathname.slice(3)) : undefined
    return <ProfilePage session={authSession} profileId={pathProfileId} onBack={backFromProfile} onSignIn={() => {
      setAuthPendingProvider('github')
      beginOAuth('github', window.location.pathname)
    }} />
  }

  return (
    <CommunityFeed
      profile={profile}
      provider={authSession?.user.provider}
      authError={authError}
      canPost={canPost}
      authChecking={authChecking}
      messages={messages}
      participants={participants}
      onlineCount={onlineCount}
      connectionStatus={connectionStatus}
      onSend={sendMessage}
      onToggleLike={toggleLike}
      onUploadImage={uploadCommunityImage}
      missionsOnly={window.location.pathname === '/missions'}
      onSignIn={(provider) => {
        setAuthPendingProvider(provider)
        beginOAuth(provider, window.location.pathname)
      }}
      localPreviewAvailable={import.meta.env.DEV && !localPreview}
      onStartLocalPreview={() => {
        window.sessionStorage.setItem('vct-community-preview-v1', 'true')
        setLocalPreview(true)
      }}
      onSignOut={() => {
        clearAuthSession()
        setSessionToken(null)
        setAuthSession(null)
        setOnlineProfiles([])
        setKnownProfiles([])
        window.sessionStorage.removeItem('vct-community-preview-v1')
        setLocalPreview(false)
      }}
      onInviteAgent={openAgentInvite}
      onOpenFeed={openHome}
      onOpenMissions={openMissions}
      onOpenProfile={openPublicProfile}
      onOpenOwnProfile={openOwnProfile}
    />
  )
}
