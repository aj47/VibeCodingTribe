import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthProvider, AuthSession, PublicHumanProfile } from './auth/types'
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
import { channelFromPath, channelPath, DEFAULT_CHANNEL_ID, type CommunityChannelId } from './community/channels'
import type { ChannelActivityMap } from './community/channel-navigation'
import { loadLocalChannelActivity, loadLocalReadState, markThreadRead as markLocalThreadRead, saveLocalChannelActivity, saveLocalReadState, type LocalReadState } from './services/read-state'
import { uploadCommunityImage } from './services/media'

type Surface = 'home' | 'community' | 'invite-agent' | 'profile' | 'authorize-agent'
type ConnectionStatus = 'connected' | 'syncing' | 'offline'

const LEGACY_STORAGE_KEYS = ['vct-workspace-v3', 'vct-realtime-profile-v1', 'vct-realtime-outbox-v1']

function loadSurface(): Surface {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/exchange' || path === '/missions' || path === '/c/feedback' || path === '/c/showcases') {
    window.history.replaceState({}, '', `${channelPath('general')}${window.location.search}${window.location.hash}`)
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
  const [, setRouteVersion] = useState(0)
  const [readState, setReadState] = useState<LocalReadState>(() => loadLocalReadState(profile.clientId))
  const [channelActivity, setChannelActivity] = useState<ChannelActivityMap>(() => Object.fromEntries(Object.entries(loadLocalChannelActivity(profile.clientId)).map(([id, latestActivity]) => [id, { latestActivity }])) as ChannelActivityMap)
  const [messages, setMessages] = useState<RealtimeMessageRecord[]>([])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [knownProfiles, setKnownProfiles] = useState<RealtimeProfile[]>([])
  const [onlineProfiles, setOnlineProfiles] = useState<RealtimeProfile[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('syncing')
  const realtimeClientRef = useRef<RealtimeRoomClient | null>(null)
  const profileBackRef = useRef<Surface>('community')
  const canPost = Boolean(authSession) || localPreview
  const channelId = channelFromPath(window.location.pathname)
  const threadId = new URLSearchParams(window.location.search).get('thread') ?? undefined

  useEffect(() => {
    setReadState(loadLocalReadState(profile.clientId))
    const activity = loadLocalChannelActivity(profile.clientId)
    setChannelActivity(Object.fromEntries(Object.entries(activity).map(([id, latestActivity]) => [id, { latestActivity }])) as ChannelActivityMap)
  }, [profile.clientId])

  const rememberChannelActivity = useCallback((records: RealtimeMessageRecord[], selectedChannelId: CommunityChannelId) => {
    const latest = records.reduce<string | undefined>((current, record) => !current || record.sentAt > current ? record.sentAt : current, undefined)
    if (!latest) return
    setChannelActivity((current) => {
      const previous = current[selectedChannelId]?.latestActivity
      if (previous && previous >= latest) return current
      const next = { ...current, [selectedChannelId]: { latestActivity: latest } }
      saveLocalChannelActivity(profile.clientId, Object.fromEntries(Object.entries(next).map(([id, value]) => [id, value.latestActivity])) as Partial<Record<CommunityChannelId, string>>)
      return next
    })
  }, [profile.clientId])

  const markChannelRead = useCallback((targetChannelId: CommunityChannelId, activityAt?: string) => {
    if (!activityAt) return
    setReadState((current) => {
      const next = { ...current, channels: { ...current.channels, [targetChannelId]: activityAt } }
      saveLocalReadState(profile.clientId, next)
      return next
    })
  }, [profile.clientId])

  const onReadThread = useCallback((targetChannelId: CommunityChannelId, parentId: string, activityAt: string) => {
    setReadState((current) => {
      const next = markLocalThreadRead(current, targetChannelId, parentId, activityAt)
      saveLocalReadState(profile.clientId, next)
      return next
    })
  }, [profile.clientId])

  useEffect(() => {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key)
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setRouteVersion((current) => current + 1)
      setSurface(loadSurface())
    }
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

  const onProfileUpdated = useCallback((updated: PublicHumanProfile) => {
    const nextProfile: RealtimeProfile = {
      clientId: updated.realtimeClientId,
      displayName: updated.displayName,
      handle: updated.handle,
      avatarColor: authSession?.user.provider === 'github' ? '#9bcf66' : '#70a8c4',
      ...(updated.avatarUrl ? { avatarUrl: updated.avatarUrl } : {}),
      profileId: updated.id,
      actorType: 'human',
    }
    saveRealtimeProfile(nextProfile)
    setProfile(nextProfile)
    setAuthSession((current) => current ? { ...current, user: { ...current.user, ...updated } } : current)
    setKnownProfiles((current) => mergeRealtimeProfiles(current, [nextProfile]))
    setMessages((current) => current.map((message) => {
      const ownsMessage = message.profileId === updated.id || message.clientId === updated.realtimeClientId
      const ownsAgent = message.actorType === 'agent' && message.ownerProfileId === updated.id
      return {
        ...message,
        ...(ownsMessage ? { displayName: updated.displayName, handle: updated.handle, ...(updated.avatarUrl ? { avatarUrl: updated.avatarUrl } : { avatarUrl: undefined }) } : {}),
        ...(ownsAgent ? { ownerHandle: updated.handle } : {}),
      }
    }))
  }, [authSession?.user.provider])

  useEffect(() => {
    if (surface !== 'community' || authChecking) return
    const activeSessionToken = authSession ? (getSessionToken() ?? sessionToken ?? undefined) : undefined
    setMessages([])
    setMessagesLoaded(false)
    setOnlineProfiles([])
    setOnlineCount(0)
    const client = new RealtimeRoomClient(profile, {
      onStatus: setConnectionStatus,
      onEvent: (event) => {
        if (event.type === 'snapshot') {
          setMessages((current) => mergeMessages(current, event.messages))
          setMessagesLoaded(true)
          rememberChannelActivity(event.messages, channelId)
          const latest = event.messages.reduce<string | undefined>((current, record) => !current || record.sentAt > current ? record.sentAt : current, undefined)
          markChannelRead(channelId, latest)
          rememberMessageAuthors(event.messages)
          rememberProfiles(event.participants)
          setOnlineProfiles(event.participants)
          setOnlineCount(event.onlineCount)
          return
        }
        if (event.type === 'message') {
          setMessages((current) => mergeMessages(current, [event.message]))
          rememberChannelActivity([event.message], channelId)
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
    }, undefined, activeSessionToken, canPost, channelId)
    realtimeClientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
      if (realtimeClientRef.current === client) realtimeClientRef.current = null
    }
    }, [authChecking, authSession, canPost, channelId, markChannelRead, profile, rememberChannelActivity, rememberMessageAuthors, rememberProfiles, sessionToken, surface])

  const participants = useMemo(() => {
    const onlineIds = new Set(onlineProfiles.map((item) => item.clientId))
    return knownProfiles
      .map((item) => ({ ...item, online: onlineIds.has(item.clientId) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName))
  }, [knownProfiles, onlineProfiles])

  const sendMessage = useCallback((value: string | CommunityPostInput) => {
    if (!canPost) return
    const input = typeof value === 'string' ? { text: value } : value
    const messageChannelId = input.channelId ?? channelId ?? DEFAULT_CHANNEL_ID
    const text = input.text.trim().slice(0, MAX_REALTIME_MESSAGE_LENGTH)
    if (!text && !input.imageUrl) return
    const id = createRealtimeMessageId(profile.clientId)
    const optimisticMessage: RealtimeMessageRecord = {
      id,
      channelId: messageChannelId,
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
      channelId: messageChannelId,
      text,
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.commentKind ? { commentKind: input.commentKind } : {}),
      ...(input.buildName ? { buildName: input.buildName.trim().slice(0, 80) } : {}),
      ...(input.buildUrl ? { buildUrl: input.buildUrl } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    })
  }, [canPost, channelId, profile])

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
    window.history.pushState({}, '', channelPath('general'))
    setRouteVersion((current) => current + 1)
    setSurface('community')
  }

  const openRoom = () => {
    window.history.pushState({}, '', channelPath('general'))
    setRouteVersion((current) => current + 1)
    setSurface('community')
  }

  const openMissions = () => {
    window.history.pushState({}, '', channelPath('general'))
    setRouteVersion((current) => current + 1)
    setSurface('community')
  }

  const openChannel = (targetChannelId: CommunityChannelId) => {
    window.history.pushState({}, '', channelPath(targetChannelId))
    setRouteVersion((current) => current + 1)
    setSurface('community')
  }

  const openThread = (targetChannelId: CommunityChannelId, parentId: string) => {
    window.history.pushState({}, '', `${channelPath(targetChannelId)}?thread=${encodeURIComponent(parentId)}`)
    setRouteVersion((current) => current + 1)
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
    setRouteVersion((current) => current + 1)
    setSurface('profile')
  }

  const openBadges = () => {
    profileBackRef.current = surface
    window.history.pushState({}, '', '/badges')
    setRouteVersion((current) => current + 1)
    setSurface('profile')
  }

  const openPublicProfile = (profileId: string) => {
    profileBackRef.current = 'community'
    window.history.pushState({}, '', `/p/${encodeURIComponent(profileId)}`)
    setRouteVersion((current) => current + 1)
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
    return <ProfilePage session={authSession} profileId={pathProfileId} badgesOnly={window.location.pathname === '/badges'} onBack={backFromProfile} onProfileUpdated={onProfileUpdated} onSignIn={() => {
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
      messagesLoaded={messagesLoaded}
      participants={participants}
      onlineCount={onlineCount}
      connectionStatus={connectionStatus}
      onSend={sendMessage}
      onToggleLike={toggleLike}
      onUploadImage={uploadCommunityImage}
      missionsOnly={channelId === 'feedback'}
      channelId={channelId}
      channelActivity={channelActivity}
      readState={readState}
      threadId={threadId}
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
      onOpenChannel={openChannel}
      onOpenThread={openThread}
      onReadThread={onReadThread}
      onOpenProfile={openPublicProfile}
      onOpenOwnProfile={openOwnProfile}
      onOpenBadges={openBadges}
    />
  )
}
