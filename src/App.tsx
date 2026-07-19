import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ActivityLogEntry,
  AgentPermission,
  AgentSession,
  ApprovalRequest,
  AttentionItem,
  Conversation,
  Draft,
  Message,
  Participant,
  ReturnSummary,
} from './domain/types'
import { seedData } from './data/seed'
import { mockAdapters } from './services/adapters'
import { AgentActionModal } from './components/AgentActionModal'
import { AttentionSidebar } from './components/AttentionSidebar'
import { AuthScreen } from './components/AuthScreen'
import { Composer } from './components/Composer'
import { ConnectRepositoryModal, ProfileModal } from './components/SettingsModals'
import { ConversationHeader } from './components/ConversationHeader'
import { DetailPanel } from './components/DetailPanel'
import { OnboardingFlow } from './components/OnboardingFlow'
import { QuickSwitcher } from './components/QuickSwitcher'
import { RoomSearch } from './components/RoomSearch'
import { RealtimeIdentityModal } from './components/RealtimeIdentityModal'
import { ThreadPanel } from './components/ThreadPanel'
import { Timeline, type TimelineHandle } from './components/Timeline'
import { Toast } from './components/Toast'
import { LIVE_CONVERSATION_ID, type RealtimeMessageRecord, type RealtimeProfile } from './realtime/protocol'
import {
  createRealtimeMessageId,
  loadRealtimeProfile,
  realtimeProfileToParticipant,
  realtimeRecordToMessage,
  RealtimeRoomClient,
  saveRealtimeProfile,
} from './services/realtime'

type AuthMode = 'signed-out' | 'onboarding' | 'app'

interface PersistedWorkspace {
  selectedConversationId: string
  conversations: Conversation[]
  messages: Message[]
  attentionItems: AttentionItem[]
  approvalRequests: ApprovalRequest[]
  agentSessions: AgentSession[]
  returnSummaries: ReturnSummary[]
  activityLog: ActivityLogEntry[]
  drafts: Draft[]
  handledSummaryIds: string[]
}

const WORKSPACE_KEY = 'vct-workspace-v3'
const AUTH_KEY = 'vct-auth-mode-v1'

function cloneSeed(): PersistedWorkspace {
  return {
    selectedConversationId: seedData.selectedConversationId,
    conversations: structuredClone(seedData.conversations),
    messages: structuredClone(seedData.messages),
    attentionItems: structuredClone(seedData.attentionItems),
    approvalRequests: structuredClone(seedData.approvalRequests),
    agentSessions: structuredClone(seedData.agentSessions),
    returnSummaries: structuredClone(seedData.returnSummaries),
    activityLog: structuredClone(seedData.activityLog),
    drafts: structuredClone(seedData.drafts),
    handledSummaryIds: [],
  }
}

function loadWorkspace(): PersistedWorkspace {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_KEY)
    if (!stored) return cloneSeed()
    const parsed = JSON.parse(stored) as Partial<PersistedWorkspace>
    const fallback = cloneSeed()
    return {
      selectedConversationId: parsed.selectedConversationId ?? fallback.selectedConversationId,
      conversations: parsed.conversations ?? fallback.conversations,
      messages: parsed.messages ?? fallback.messages,
      attentionItems: parsed.attentionItems ?? fallback.attentionItems,
      approvalRequests: parsed.approvalRequests ?? fallback.approvalRequests,
      agentSessions: parsed.agentSessions ?? fallback.agentSessions,
      returnSummaries: parsed.returnSummaries ?? fallback.returnSummaries,
      activityLog: parsed.activityLog ?? fallback.activityLog,
      drafts: parsed.drafts ?? fallback.drafts,
      handledSummaryIds: parsed.handledSummaryIds ?? [],
    }
  } catch {
    return cloneSeed()
  }
}

function loadAuthMode(): AuthMode {
  const stored = window.localStorage.getItem(AUTH_KEY)
  return stored === 'signed-out' || stored === 'onboarding' || stored === 'app' ? stored : 'app'
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

let localSequence = 0
function localId(prefix: string) {
  localSequence += 1
  return `${prefix}-${Date.now()}-${localSequence}`
}

export function App() {
  const initial = useRef<PersistedWorkspace | null>(null)
  if (!initial.current) initial.current = loadWorkspace()
  const initialWorkspace = initial.current

  const [authMode, setAuthMode] = useState<AuthMode>(loadAuthMode)
  const [authPending, setAuthPending] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState(initialWorkspace.selectedConversationId)
  const [conversations, setConversations] = useState(initialWorkspace.conversations)
  const [messages, setMessages] = useState(initialWorkspace.messages)
  const [attentionItems, setAttentionItems] = useState(initialWorkspace.attentionItems)
  const [approvalRequests, setApprovalRequests] = useState(initialWorkspace.approvalRequests)
  const [agentSessions, setAgentSessions] = useState(initialWorkspace.agentSessions)
  const [returnSummaries, setReturnSummaries] = useState(initialWorkspace.returnSummaries)
  const [activityLog, setActivityLog] = useState(initialWorkspace.activityLog)
  const [drafts, setDrafts] = useState(initialWorkspace.drafts)
  const [handledSummaryIds, setHandledSummaryIds] = useState(initialWorkspace.handledSummaryIds)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(() => window.innerWidth >= 1280)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [roomSearchOpen, setRoomSearchOpen] = useState(false)
  const [agentActionsOpen, setAgentActionsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [connectRepositoryOpen, setConnectRepositoryOpen] = useState(false)
  const [realtimeIdentityOpen, setRealtimeIdentityOpen] = useState(false)
  const [syncState, setSyncState] = useState<'connected' | 'syncing' | 'offline'>('syncing')
  const [realtimeProfile, setRealtimeProfile] = useState<RealtimeProfile>(loadRealtimeProfile)
  const [realtimeParticipants, setRealtimeParticipants] = useState<Participant[]>(() => [
    realtimeProfileToParticipant(loadRealtimeProfile()),
  ])
  const [realtimeOnlineCount, setRealtimeOnlineCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<TimelineHandle>(null)
  const keyPrefixRef = useRef<string | null>(null)
  const realtimeClientRef = useRef<RealtimeRoomClient | null>(null)

  const selectedRawConversation = conversations.find((item) => item.id === selectedConversationId) ?? conversations[0]
  const allParticipants = useMemo(() => {
    const participants = new Map(seedData.participants.map((participant) => [participant.id, participant]))
    for (const participant of realtimeParticipants) participants.set(participant.id, participant)
    return [...participants.values()]
  }, [realtimeParticipants])
  const selectedConversation = useMemo(() => {
    if (!selectedRawConversation) return undefined
    const participants = selectedRawConversation.id === LIVE_CONVERSATION_ID
      ? allParticipants
      : selectedRawConversation.participants
    return {
      ...selectedRawConversation,
      participants,
      agents: agentSessions.filter((session) => session.conversationId === selectedRawConversation.id),
    }
  }, [agentSessions, allParticipants, selectedRawConversation])
  const selectedMessages = useMemo(
    () => messages.filter((message) => message.conversationId === selectedConversationId).sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages, selectedConversationId],
  )
  const selectedSummary = returnSummaries.find((summary) => summary.conversationId === selectedConversationId)
  const selectedThread = seedData.threads.find((thread) => thread.id === selectedThreadId)
  const selectedAttention = attentionItems.find((item) => item.conversationId === selectedConversationId && !item.handledAt)
  const selectedDraftId = `${selectedConversationId}:room`
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId)?.text ?? ''
  const threadDraftId = selectedThreadId ? `${selectedConversationId}:${selectedThreadId}` : ''
  const threadDraft = drafts.find((draft) => draft.id === threadDraftId)?.text ?? ''

  useEffect(() => {
    window.localStorage.setItem(AUTH_KEY, authMode)
  }, [authMode])

  useEffect(() => {
    const snapshot: PersistedWorkspace = {
      selectedConversationId,
      conversations,
      messages,
      attentionItems,
      approvalRequests,
      agentSessions,
      returnSummaries,
      activityLog,
      drafts,
      handledSummaryIds,
    }
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(snapshot))
  }, [activityLog, agentSessions, approvalRequests, attentionItems, conversations, drafts, handledSummaryIds, messages, returnSummaries, selectedConversationId])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 900) setDetailsOpen(false)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const unsubscribe = mockAdapters.agent.subscribe((event) => {
      if (event.type === 'session-updated') {
        setAgentSessions((current) => {
          const exists = current.some((session) => session.id === event.session.id)
          return exists
            ? current.map((session) => session.id === event.session.id ? event.session : session)
            : [...current, event.session]
        })
      } else if (event.type === 'approval-updated') {
        setApprovalRequests((current) => current.map((request) => request.id === event.approval.id ? event.approval : request))
      } else if (event.type === 'activity') {
        setActivityLog((current) => current.some((entry) => entry.id === event.entry.id) ? current : [...current, event.entry])
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!selectedConversation) return
    const pathname = selectedConversation.repo
      ? `/app/${selectedConversation.repo.owner}/${selectedConversation.repo.name}/${selectedConversation.slug ?? selectedConversation.id}`
      : `/app/dm/${selectedConversation.id}`
    const query = new URLSearchParams()
    if (selectedThreadId) query.set('thread', selectedThreadId)
    if (detailsOpen && !selectedThreadId) query.set('panel', 'details')
    window.history.replaceState({}, '', `${pathname}${query.size ? `?${query}` : ''}`)
    document.title = `${selectedConversation.title} · VibeCodingTribe`
  }, [detailsOpen, selectedConversation, selectedThreadId])

  const setDraft = useCallback((id: string, conversationId: string, threadId: string | undefined, text: string) => {
    setDrafts((current) => {
      const next: Draft = {
        id,
        conversationId,
        threadId,
        text,
        updatedAt: new Date().toISOString(),
        attachmentIds: [],
      }
      return current.some((draft) => draft.id === id)
        ? current.map((draft) => draft.id === id ? next : draft)
        : [...current, next]
    })
  }, [])

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId)
    setSelectedThreadId(null)
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0, unreadMentionCount: 0 } : conversation))
    window.setTimeout(() => timelineRef.current?.scrollToBottom(), 50)
  }, [])

  const markHandled = useCallback(() => {
    const handledAt = new Date().toISOString()
    setAttentionItems((current) => current.map((item) => item.conversationId === selectedConversationId && !item.handledAt ? { ...item, handledAt } : item))
    if (selectedSummary) setHandledSummaryIds((current) => current.includes(selectedSummary.id) ? current : [...current, selectedSummary.id])
    setToast('Marked handled · unread state preserved')
  }, [selectedConversationId, selectedSummary])

  const addMessage = useCallback((message: Message) => {
    setMessages((current) => current.some((item) => item.id === message.id)
      ? current.map((item) => item.id === message.id ? message : item)
      : [...current, message])
    setConversations((current) => current.map((conversation) => conversation.id === message.conversationId ? {
      ...conversation,
      lastMessageAt: message.sentAt,
      lastMessagePreview: message.kind === 'human' || message.kind === 'agent-response' ? message.content.text : conversation.lastMessagePreview,
    } : conversation))
  }, [])

  const mergeRealtimeRecords = useCallback((records: RealtimeMessageRecord[]) => {
    if (!records.length) return
    const incoming = records.map(realtimeRecordToMessage)
    setMessages((current) => {
      const merged = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) merged.set(message.id, message)
      return [...merged.values()]
    })
    const latest = [...incoming].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
    if (latest) {
      setConversations((current) => current.map((conversation) => conversation.id === LIVE_CONVERSATION_ID ? {
        ...conversation,
        lastMessageAt: latest.sentAt,
        lastMessagePreview: latest.content.text,
      } : conversation))
    }
  }, [])

  useEffect(() => {
    if (authMode !== 'app') return
    const client = new RealtimeRoomClient(realtimeProfile, {
      onStatus: setSyncState,
      onEvent: (event) => {
        if (event.type === 'snapshot') {
          mergeRealtimeRecords(event.messages)
          const onlineIds = new Set(event.participants.map((profile) => profile.clientId))
          const profiles = new Map<string, RealtimeProfile>()
          for (const message of event.messages) {
            profiles.set(message.clientId, {
              clientId: message.clientId,
              displayName: message.displayName,
              handle: message.handle,
              avatarColor: message.avatarColor,
            })
          }
          for (const profile of event.participants) profiles.set(profile.clientId, profile)
          setRealtimeParticipants([...profiles.values()].map((profile) => ({
            ...realtimeProfileToParticipant(profile),
            presence: onlineIds.has(profile.clientId) ? 'online' : 'offline',
          })))
          setRealtimeOnlineCount(event.onlineCount)
        } else if (event.type === 'message') {
          mergeRealtimeRecords([event.message])
          setRealtimeParticipants((current) => {
            const participant = realtimeProfileToParticipant({
              clientId: event.message.clientId,
              displayName: event.message.displayName,
              handle: event.message.handle,
              avatarColor: event.message.avatarColor,
            })
            return current.some((item) => item.id === participant.id)
              ? current.map((item) => item.id === participant.id ? { ...participant, presence: item.presence } : item)
              : [...current, participant]
          })
          window.setTimeout(() => timelineRef.current?.scrollToBottom(), 30)
        } else if (event.type === 'presence') {
          const onlineIds = new Set(event.participants.map((profile) => `realtime:${profile.clientId}`))
          setRealtimeParticipants((current) => {
            const participants = new Map<string, Participant>(current.map((participant) => [participant.id, { ...participant, presence: 'offline' }]))
            for (const profile of event.participants) {
              const participant = realtimeProfileToParticipant(profile)
              participants.set(participant.id, participant)
            }
            return [...participants.values()].map((participant) => onlineIds.has(participant.id) ? { ...participant, presence: 'online' } : participant)
          })
          setRealtimeOnlineCount(event.onlineCount)
        } else if (event.type === 'error') {
          setToast(event.message)
          if (event.clientMessageId) {
            setMessages((current) => current.map((message) => message.id === event.clientMessageId ? { ...message, deliveryState: 'failed' } : message))
          }
        }
      },
    })
    realtimeClientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
      if (realtimeClientRef.current === client) realtimeClientRef.current = null
    }
  }, [authMode, mergeRealtimeRecords, realtimeProfile])

  const startAgent = useCallback(async (
    agentId: string,
    action: string,
    prompt: string,
    permissions: AgentPermission[],
    threadId?: string,
  ) => {
    if (!selectedConversation) return
    setAgentActionsOpen(false)
    setDetailsOpen(true)
    const session = await mockAdapters.agent.invoke({
      agentId,
      conversationId: selectedConversation.id,
      threadId,
      task: `${action}: ${prompt}`,
      continuousListening: permissions.includes('continuous-listening'),
    })
    setAgentSessions((current) => current.map((item) => item.id === session.id ? { ...item, permissions } : item))
    const participant = seedData.participants.find((item) => item.agentId === agentId)
    const senderId = participant?.id ?? seedData.participants.find((item) => item.kind === 'agent')!.id
    const progressId = localId('agent-progress')
    addMessage({
      id: progressId,
      conversationId: selectedConversation.id,
      senderId,
      sentAt: new Date().toISOString(),
      threadId,
      deliveryState: 'sent',
      reactions: [],
      kind: 'agent-progress',
      content: {
        agentSessionId: session.id,
        label: `${session.name} is reading permitted context`,
        detail: `Action: ${action} · Room${selectedConversation.repo ? ` · ${selectedConversation.repo.fullName}` : ''}`,
        progress: 18,
        state: 'running',
      },
    })
    setToast(`${session.name} joined with ${permissions.length} scoped permissions`)
    await wait(520)
    let responseId: string | null = null
    let responseText = ''
    for await (const chunk of mockAdapters.agent.stream(session.id)) {
      await wait(chunk.kind === 'status' ? 420 : 650)
      if (chunk.kind === 'status') {
        setMessages((current) => current.map((message) => message.id === progressId && message.kind === 'agent-progress' ? {
          ...message,
          content: { ...message.content, detail: chunk.text, progress: 46 },
        } : message))
      } else {
        responseText = responseText ? `${responseText} ${chunk.text}` : chunk.text
        if (!responseId) {
          responseId = localId('agent-response')
          addMessage({
            id: responseId,
            conversationId: selectedConversation.id,
            senderId,
            sentAt: new Date().toISOString(),
            threadId,
            deliveryState: 'sent',
            reactions: [],
            kind: 'agent-response',
            content: { agentSessionId: session.id, text: responseText, isStreaming: chunk.kind !== 'done' },
          })
        } else {
          const targetId = responseId
          setMessages((current) => current.map((message) => message.id === targetId && message.kind === 'agent-response' ? {
            ...message,
            content: { ...message.content, text: responseText, isStreaming: chunk.kind !== 'done' },
          } : message))
        }
      }
      timelineRef.current?.scrollToBottom()
    }
    setMessages((current) => current.map((message) => message.id === progressId && message.kind === 'agent-progress' ? {
      ...message,
      content: { ...message.content, label: `${session.name} completed the run`, detail: '3 context steps · no external side effects', progress: 100, state: 'complete' },
    } : message))
  }, [addMessage, selectedConversation])

  const sendMessage = useCallback((text: string, attachmentName?: string, threadId?: string) => {
    if (!selectedConversation) return
    const isLiveChannel = selectedConversation.id === LIVE_CONVERSATION_ID
    const id = isLiveChannel ? createRealtimeMessageId(realtimeProfile.clientId) : localId('local-message')
    const body = attachmentName ? `${text}${text ? '\n\n' : ''}📎 ${attachmentName}` : text
    const message: Message = {
      id,
      conversationId: selectedConversation.id,
      senderId: isLiveChannel ? `realtime:${realtimeProfile.clientId}` : seedData.currentUser.participantId,
      sentAt: new Date().toISOString(),
      threadId,
      deliveryState: 'local-echo',
      reactions: [],
      kind: 'human',
      content: { text: body, format: 'markdown' },
    }
    addMessage(message)
    const draftId = threadId ? `${selectedConversation.id}:${threadId}` : `${selectedConversation.id}:room`
    setDraft(draftId, selectedConversation.id, threadId, '')
    if (isLiveChannel) {
      realtimeClientRef.current?.send({ id, text: body, threadId })
      window.setTimeout(() => timelineRef.current?.scrollToBottom(), 30)
    } else {
      window.setTimeout(() => {
        setMessages((current) => current.map((item) => item.id === id ? { ...item, deliveryState: 'sent' } : item))
        timelineRef.current?.scrollToBottom()
      }, 260)
    }
    if (/@(forge|scout)\b/i.test(text)) {
      const mentioned = /@scout\b/i.test(text) ? seedData.agentDefinitions.find((agent) => agent.name === 'Scout') : seedData.agentDefinitions.find((agent) => agent.name === 'Forge')
      if (mentioned) window.setTimeout(() => void startAgent(mentioned.id, 'ask', text, ['read-room', 'read-repository'], threadId), 420)
    }
  }, [addMessage, realtimeProfile.clientId, selectedConversation, setDraft, startAgent])

  const retryMessage = useCallback((messageId: string) => {
    const message = messages.find((item) => item.id === messageId)
    if (!message || message.kind !== 'human') return
    setMessages((current) => current.map((item) => item.id === messageId ? { ...item, deliveryState: 'local-echo' } : item))
    if (message.conversationId === LIVE_CONVERSATION_ID) {
      realtimeClientRef.current?.send({ id: message.id, text: message.content.text, threadId: message.threadId })
    } else {
      window.setTimeout(() => setMessages((current) => current.map((item) => item.id === messageId ? { ...item, deliveryState: 'sent' } : item)), 260)
    }
  }, [messages])

  const resolveApproval = useCallback(async (approvalId: string, decision: 'approved' | 'denied') => {
    try {
      const resolved = await mockAdapters.agent.resolveApproval(approvalId, decision, seedData.currentUser.participantId)
      setApprovalRequests((current) => current.map((request) => request.id === resolved.id ? resolved : request))
      if (decision === 'approved') {
        markHandled()
        setToast('Allowed once · Forge is creating a reviewable branch')
        await wait(620)
        const request = approvalRequests.find((item) => item.id === approvalId)
        const session = request ? agentSessions.find((item) => item.id === request.agentSessionId) : undefined
        const sender = seedData.participants.find((item) => item.agentId === session?.agentId)
        if (request && session && sender) {
          const repo = selectedConversation?.repo
          if (repo) await mockAdapters.github.performWrite({ action: 'create-branch', repositoryId: repo.id, payload: request.args }, resolved)
          addMessage({
            id: localId('agent-result'),
            conversationId: request.conversationId,
            senderId: sender.id,
            sentAt: new Date().toISOString(),
            threadId: session.threadId,
            deliveryState: 'sent',
            reactions: [],
            kind: 'agent-response',
            content: { agentSessionId: session.id, isStreaming: false, text: 'Branch `fix/oauth-callback-lock` is ready with the six-file patch and concurrent callback test. Nothing was merged or deployed. Maya can review it now.' },
          })
          setAgentSessions((current) => current.map((item) => item.id === session.id ? { ...item, status: item.continuousListening ? 'listening' : 'completed', statusDetail: 'Branch created; ready for review', lastActivity: new Date().toISOString() } : item))
          setToast('Branch created · recorded in the audit log')
        }
      } else {
        setToast('Request denied · no repository changes made')
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not resolve approval')
    }
  }, [addMessage, agentSessions, approvalRequests, markHandled, selectedConversation])

  const stopAgent = useCallback(async (sessionId: string) => {
    const session = agentSessions.find((item) => item.id === sessionId)
    if (!session) return
    if (session.status === 'working' && !window.confirm(`Stop ${session.name}'s active run? The action will be recorded.`)) return
    await mockAdapters.agent.stop(sessionId)
    setToast(`${session.name} stopped · activity preserved`)
  }, [agentSessions])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      const isEditing = target instanceof Element && target.matches('input, textarea, [contenteditable="true"]')
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuickSwitcherOpen(true)
        return
      }
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setRoomSearchOpen(true)
        return
      }
      if (mod && event.key === '.') {
        event.preventDefault()
        const foreground = agentSessions.find((session) => session.conversationId === selectedConversationId && ['working', 'waiting', 'blocked', 'approval-required'].includes(session.status))
        if (foreground) void stopAgent(foreground.id)
        return
      }
      if (isEditing || mod || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'g') {
        keyPrefixRef.current = 'g'
        window.setTimeout(() => { keyPrefixRef.current = null }, 900)
        return
      }
      if (keyPrefixRef.current === 'g') {
        keyPrefixRef.current = null
        const targetSection = key === 'n' ? 'needs-you' : key === 'a' ? 'active' : null
        if (targetSection) {
          const ids = attentionItems.filter((item) => item.section === targetSection && !item.handledAt).sort((a, b) => b.score - a.score).map((item) => item.conversationId)
          if (ids.length) selectConversation(ids[(ids.indexOf(selectedConversationId) + 1) % ids.length]!)
        } else if (key === 'r' && selectedConversation?.repo) {
          window.open(selectedConversation.repo.htmlUrl, '_blank', 'noopener,noreferrer')
        }
        return
      }
      if (key === 'c') composerRef.current?.focus()
      if (key === 'a') setAgentActionsOpen(true)
      if (key === 'h' && selectedAttention) markHandled()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [agentSessions, attentionItems, markHandled, selectConversation, selectedAttention, selectedConversation, selectedConversationId, stopAgent])

  if (authMode === 'signed-out') {
    return (
      <AuthScreen
        pending={authPending}
        onSignIn={() => {
          setAuthPending(true)
          window.setTimeout(() => { setAuthPending(false); setAuthMode('onboarding') }, 750)
        }}
        onOpenDemo={() => setAuthMode('app')}
      />
    )
  }

  if (authMode === 'onboarding') {
    return (
      <OnboardingFlow
        user={seedData.currentUser}
        repositories={seedData.repositories}
        agents={seedData.agentDefinitions}
        onCancel={() => setAuthMode('app')}
        onComplete={({ repositoryId, agentId, continuousListening }) => {
          const conversation = conversations.find((item) => item.repo?.id === repositoryId)
          if (conversation) setSelectedConversationId(conversation.id)
          setAuthMode('app')
          setToast(`${seedData.agentDefinitions.find((agent) => agent.id === agentId)?.name ?? 'Agent'} is ready · listening ${continuousListening ? 'enabled' : 'off'}`)
        }}
      />
    )
  }

  if (!selectedConversation) return null

  return (
    <div className={`app-shell${detailsOpen || selectedThread ? ' has-detail-panel' : ''}`}>
      <AttentionSidebar
        currentUser={seedData.currentUser}
        conversations={conversations.map((conversation) => ({ ...conversation, agents: agentSessions.filter((session) => session.conversationId === conversation.id) }))}
        attentionItems={attentionItems}
        sections={seedData.sidebarSections}
        selectedConversationId={selectedConversation.id}
        syncState={syncState}
        isMobileOpen={mobileNavigationOpen}
        onCloseMobile={() => setMobileNavigationOpen(false)}
        onSelectConversation={selectConversation}
        onOpenQuickSwitcher={() => setQuickSwitcherOpen(true)}
        onAddRepository={() => setConnectRepositoryOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <main className="conversation-scene">
        {selectedConversation.id === LIVE_CONVERSATION_ID && syncState !== 'connected' && (
          <div className={`sync-banner sync-banner--${syncState}`}>
            <span className="mini-spinner" />
            {syncState === 'syncing' ? 'Connecting to live #general…' : 'Live channel unavailable · messages remain queued in this browser'}
          </div>
        )}
        <ConversationHeader
          conversation={selectedConversation}
          isHandled={!selectedAttention}
          detailsOpen={detailsOpen}
          liveConnection={selectedConversation.id === LIVE_CONVERSATION_ID ? syncState : undefined}
          liveIdentity={realtimeProfile.displayName}
          liveOnlineCount={realtimeOnlineCount}
          onOpenNavigation={() => setMobileNavigationOpen(true)}
          onOpenSearch={() => setRoomSearchOpen(true)}
          onOpenAgentMenu={() => setDetailsOpen(true)}
          onOpenLiveIdentity={() => setRealtimeIdentityOpen(true)}
          onToggleDetails={() => { setSelectedThreadId(null); setDetailsOpen((value) => !value) }}
          onMarkHandled={markHandled}
        />
        <Timeline
          ref={timelineRef}
          messages={selectedMessages}
          participants={allParticipants}
          agentSessions={agentSessions}
          threads={seedData.threads.filter((thread) => thread.conversationId === selectedConversation.id)}
          approvalRequests={approvalRequests}
          returnSummary={selectedSummary}
          returnBriefHandled={Boolean(selectedSummary && handledSummaryIds.includes(selectedSummary.id))}
          onDismissSummary={() => selectedSummary && setReturnSummaries((current) => current.map((summary) => summary.id === selectedSummary.id ? { ...summary, dismissedAt: new Date().toISOString() } : summary))}
          onRegenerateSummary={() => {
            if (!selectedSummary) return
            setReturnSummaries((current) => current.map((summary) => summary.id === selectedSummary.id ? { ...summary, status: 'generating', dismissedAt: undefined } : summary))
            window.setTimeout(() => setReturnSummaries((current) => current.map((summary) => summary.id === selectedSummary.id ? { ...summary, status: 'ready', generatedAt: new Date().toISOString() } : summary)), 850)
          }}
          onMarkHandled={markHandled}
          onShowHistory={() => timelineRef.current?.scrollToMessage(selectedMessages[0]?.id ?? '')}
          onApprove={(id) => void resolveApproval(id, 'approved')}
          onDeny={(id) => void resolveApproval(id, 'denied')}
          onOpenThread={(threadId) => { setDetailsOpen(false); setSelectedThreadId(threadId) }}
          onReact={(messageId, emoji) => setMessages((current) => current.map((message) => {
            if (message.id !== messageId) return message
            const existing = message.reactions.find((reaction) => reaction.emoji === emoji)
            if (existing) return { ...message, reactions: message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, reactedByCurrentUser: !reaction.reactedByCurrentUser, count: Math.max(0, reaction.count + (reaction.reactedByCurrentUser ? -1 : 1)) } : reaction) } as Message
            return { ...message, reactions: [...message.reactions, { emoji, label: emoji, count: 1, participantIds: [seedData.currentUser.participantId], reactedByCurrentUser: true }] } as Message
          }))}
          onRetryMessage={retryMessage}
        />
        <Composer
          inputRef={composerRef}
          conversationTitle={selectedConversation.title}
          value={selectedDraft}
          participants={selectedConversation.participants}
          typingLabel={selectedConversation.activeNow && selectedConversation.id !== seedData.selectedConversationId ? 'Maya is typing…' : undefined}
          onChange={(value) => setDraft(selectedDraftId, selectedConversation.id, undefined, value)}
          onSend={(text, attachment) => sendMessage(text, attachment)}
          onOpenAgentActions={() => setAgentActionsOpen(true)}
        />
      </main>

      {selectedThread ? (
        <ThreadPanel
          thread={selectedThread}
          messages={messages}
          participants={allParticipants}
          draft={threadDraft}
          onChangeDraft={(value) => setDraft(threadDraftId, selectedConversation.id, selectedThread.id, value)}
          onSend={(text, attachment) => sendMessage(text, attachment, selectedThread.id)}
          onClose={() => setSelectedThreadId(null)}
          onOpenAgentActions={() => setAgentActionsOpen(true)}
        />
      ) : (
        <DetailPanel
          open={detailsOpen}
          conversation={selectedConversation}
          agentSessions={agentSessions}
          activityLog={activityLog}
          onClose={() => setDetailsOpen(false)}
          onOpenAgentActions={() => setAgentActionsOpen(true)}
          onStopAgent={(id) => void stopAgent(id)}
          onDetachAgent={(id) => {
            const session = agentSessions.find((item) => item.id === id)
            setAgentSessions((current) => current.filter((item) => item.id !== id))
            setToast(`${session?.name ?? 'Agent'} detached · history preserved`)
          }}
          onToggleListening={(id) => setAgentSessions((current) => current.map((session) => session.id === id ? {
            ...session,
            continuousListening: !session.continuousListening,
            permissions: session.continuousListening ? session.permissions.filter((permission) => permission !== 'continuous-listening') : [...session.permissions, 'continuous-listening'],
          } : session))}
        />
      )}

      <QuickSwitcher
        open={quickSwitcherOpen}
        conversations={conversations}
        repositories={seedData.repositories}
        agents={seedData.agentDefinitions}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelectConversation={selectConversation}
        onConnectRepository={() => setConnectRepositoryOpen(true)}
        onOpenSettings={() => setProfileOpen(true)}
        onOpenAgentActions={() => setAgentActionsOpen(true)}
        onMarkHandled={markHandled}
      />
      <RoomSearch
        open={roomSearchOpen}
        roomTitle={selectedConversation.title}
        messages={selectedMessages}
        participants={allParticipants}
        onClose={() => setRoomSearchOpen(false)}
        onJump={(messageId) => timelineRef.current?.scrollToMessage(messageId)}
      />
      <AgentActionModal
        open={agentActionsOpen}
        agents={seedData.agentDefinitions}
        repository={selectedConversation.repo}
        onClose={() => setAgentActionsOpen(false)}
        onStart={(agentId, action, prompt, permissions) => void startAgent(agentId, action, prompt, permissions, selectedThreadId ?? undefined)}
      />
      <ProfileModal
        open={profileOpen}
        user={seedData.currentUser}
        repositories={seedData.repositories}
        onClose={() => setProfileOpen(false)}
        onSignOut={() => { setProfileOpen(false); setAuthMode('signed-out') }}
        onRestartOnboarding={() => { setProfileOpen(false); setAuthMode('onboarding') }}
      />
      <ConnectRepositoryModal
        open={connectRepositoryOpen}
        repositories={seedData.repositories}
        onClose={() => setConnectRepositoryOpen(false)}
        onConnect={(repositoryId) => setToast(`${seedData.repositories.find((repo) => repo.id === repositoryId)?.fullName ?? 'Repository'} connected`)}
      />
      <RealtimeIdentityModal
        open={realtimeIdentityOpen}
        profile={realtimeProfile}
        onClose={() => setRealtimeIdentityOpen(false)}
        onSave={(profile) => {
          saveRealtimeProfile(profile)
          setRealtimeProfile(profile)
          setToast(`Live identity updated to ${profile.displayName}`)
        }}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
