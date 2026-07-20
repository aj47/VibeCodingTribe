import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthProvider, AuthSession } from './auth/types'
import { AgentInvitePage } from './components/AgentInvitePage'
import { AgentAuthorizationPage } from './components/AgentAuthorizationPage'
import { AuthScreen } from './components/AuthScreen'
import { ExchangeApp } from './components/ExchangeApp'
import { LiveRoom, type MessageDeliveryState } from './components/LiveRoom'
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

type Surface = 'home' | 'exchange' | 'room' | 'invite-agent' | 'profile' | 'authorize-agent'
type ConnectionStatus = 'connected' | 'syncing' | 'offline'

const DRAFT_KEY = 'vct-general-draft-v1'
const LEGACY_STORAGE_KEYS = ['vct-workspace-v3', 'vct-realtime-profile-v1', 'vct-realtime-outbox-v1']

function loadSurface(): Surface {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/invite-agent') return 'invite-agent'
  if (path === '/settings/profile' || path.startsWith('/p/')) return 'profile'
  if (path.startsWith('/agents/authorize/')) return 'authorize-agent'
  if (path === '/exchange') return 'exchange'
  const isRoom = path === '/r/general'
  return isRoom ? 'room' : 'home'
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
  const [profile, setProfile] = useState<RealtimeProfile>(loadRealtimeProfile)
  const [messages, setMessages] = useState<RealtimeMessageRecord[]>([])
  const [knownProfiles, setKnownProfiles] = useState<RealtimeProfile[]>([])
  const [onlineProfiles, setOnlineProfiles] = useState<RealtimeProfile[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('syncing')
  const [deliveryStates, setDeliveryStates] = useState<Record<string, MessageDeliveryState>>({})
  const [draft, setDraft] = useState(() => window.localStorage.getItem(DRAFT_KEY) ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const realtimeClientRef = useRef<RealtimeRoomClient | null>(null)
  const profileBackRef = useRef<Surface>('room')
  const canPost = Boolean(authSession)

  useEffect(() => {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key)
  }, [])

  useEffect(() => {
    const handlePopState = () => setSurface(loadSurface())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, draft)
  }, [draft])

  useEffect(() => {
    if (surface === 'home') {
      if (window.location.pathname !== '/') window.history.replaceState({}, '', '/')
      document.title = 'VibeCodingTribe · Testing exchange for builders'
      return
    }
    if (surface === 'exchange') {
      window.history.replaceState({}, '', '/exchange')
      document.title = 'Testing Exchange · VibeCodingTribe'
      return
    }
    if (surface === 'room') {
      window.history.replaceState({}, '', '/r/general')
      document.title = '#general · VibeCodingTribe'
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
      if (window.location.pathname.replace(/\/+$/, '') === '/') {
        window.history.replaceState({}, '', '/exchange')
        setSurface('exchange')
      }
    })
    return () => { active = false }
  }, [sessionToken])

  const rememberProfiles = useCallback((profiles: RealtimeProfile[]) => {
    if (!profiles.length) return
    setKnownProfiles((current) => {
      const next = new Map(current.map((item) => [item.clientId, item]))
      for (const item of profiles) next.set(item.clientId, item)
      return [...next.values()]
    })
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
    })))
  }, [rememberProfiles])

  useEffect(() => {
    if (surface !== 'room' || authChecking) return
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
          const confirmedIds = new Set(event.messages.map((message) => message.id))
          setDeliveryStates((current) => Object.fromEntries(
            Object.entries(current).filter(([id]) => !confirmedIds.has(id)),
          ))
          return
        }
        if (event.type === 'message') {
          setMessages((current) => mergeMessages(current, [event.message]))
          rememberMessageAuthors([event.message])
          setDeliveryStates((current) => {
            const next = { ...current }
            delete next[event.message.id]
            return next
          })
          return
        }
        if (event.type === 'presence') {
          rememberProfiles(event.participants)
          setOnlineProfiles(event.participants)
          setOnlineCount(event.onlineCount)
          return
        }
        setNotice(event.message)
        if (event.clientMessageId) {
          setDeliveryStates((current) => ({ ...current, [event.clientMessageId!]: 'failed' }))
        }
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

  const sendMessage = useCallback((value: string) => {
    if (!canPost) return
    const text = value.trim().slice(0, MAX_REALTIME_MESSAGE_LENGTH)
    if (!text) return
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
    }
    setMessages((current) => mergeMessages(current, [optimisticMessage]))
    setDeliveryStates((current) => ({ ...current, [id]: 'sending' }))
    setDraft('')
    realtimeClientRef.current?.send({ id, text })
  }, [canPost, profile])

  const retryMessage = useCallback((messageId: string) => {
    const message = messages.find((item) => item.id === messageId)
    if (!message) return
    setDeliveryStates((current) => ({ ...current, [messageId]: 'sending' }))
    realtimeClientRef.current?.send({ id: message.id, text: message.text })
  }, [messages])

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
    setSurface('home')
  }

  const openRoom = () => {
    window.history.pushState({}, '', '/r/general')
    setSurface('room')
  }

  const openExchange = () => {
    window.history.pushState({}, '', '/exchange')
    setSurface('exchange')
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
    profileBackRef.current = 'room'
    window.history.pushState({}, '', `/p/${encodeURIComponent(profileId)}`)
    setSurface('profile')
  }

  const backFromProfile = () => {
    if (profileBackRef.current === 'invite-agent') return openAgentInvite()
    if (profileBackRef.current === 'exchange') return openExchange()
    if (profileBackRef.current === 'home') return openHome()
    return openRoom()
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

  if (surface === 'exchange') {
    return (
      <ExchangeApp
        signedIn={Boolean(authSession)}
        authenticatedUserId={authSession?.user.id}
        onOpenRoom={openRoom}
        onSignIn={() => {
          setAuthPendingProvider('linkedin')
          beginOAuth('linkedin', '/exchange')
        }}
      />
    )
  }

  return (
    <LiveRoom
      profile={profile}
      provider={authSession?.user.provider}
      canPost={canPost}
      authChecking={authChecking}
      pendingProvider={authPendingProvider}
      messages={messages}
      participants={participants}
      onlineCount={onlineCount}
      connectionStatus={connectionStatus}
      deliveryStates={deliveryStates}
      draft={draft}
      notice={notice}
      onDraftChange={setDraft}
      onSend={sendMessage}
      onRetry={retryMessage}
      onDismissNotice={() => setNotice(null)}
      onSignIn={(provider) => {
        setAuthPendingProvider(provider)
        beginOAuth(provider)
      }}
      onSignOut={() => {
        clearAuthSession()
        setSessionToken(null)
        setAuthSession(null)
        setOnlineProfiles([])
        setKnownProfiles([])
      }}
      onInviteAgent={openAgentInvite}
      onOpenExchange={openExchange}
      onOpenProfile={openPublicProfile}
      onOpenOwnProfile={openOwnProfile}
    />
  )
}
