import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  Github,
  GitPullRequest,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Play,
  RotateCcw,
  ShieldAlert,
  SmilePlus,
  TerminalSquare,
  X,
  XCircle,
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  AgentSession,
  ApprovalRequest,
  Message,
  Participant,
  ReturnSummary,
  Thread,
} from '../domain/types'
import { Avatar } from './Avatar'
import { ReturnBrief } from './ReturnBrief'

export interface TimelineHandle {
  scrollToMessage: (messageId: string) => void
  scrollToBottom: () => void
}

interface TimelineProps {
  messages: Message[]
  participants: Participant[]
  agentSessions: AgentSession[]
  threads: Thread[]
  approvalRequests: ApprovalRequest[]
  returnSummary?: ReturnSummary
  returnBriefHandled: boolean
  onDismissSummary: () => void
  onRegenerateSummary: () => void
  onMarkHandled: () => void
  onShowHistory: () => void
  onApprove: (approvalId: string) => void
  onDeny: (approvalId: string) => void
  onOpenThread: (threadId: string) => void
  onReact: (messageId: string, emoji: string) => void
  onRetryMessage: (messageId: string) => void
}

type TimelineItem =
  | { type: 'summary'; id: string; summary: ReturnSummary }
  | { type: 'message'; id: string; message: Message }

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function dayLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatArg(value: unknown) {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function MessageReactions({
  message,
  onReact,
}: {
  message: Message
  onReact: (messageId: string, emoji: string) => void
}) {
  if (message.reactions.length === 0) return null
  return (
    <div className="message-reactions" aria-label="Reactions">
      {message.reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          className={reaction.reactedByCurrentUser ? 'is-mine' : ''}
          type="button"
          onClick={() => onReact(message.id, reaction.emoji)}
          aria-label={`${reaction.label}, ${reaction.count} reactions`}
        >
          <span>{reaction.emoji}</span> {reaction.count}
        </button>
      ))}
    </div>
  )
}

function HumanEvent({
  message,
  sender,
  thread,
  onOpenThread,
  onReact,
  onRetryMessage,
}: {
  message: Extract<Message, { kind: 'human' }>
  sender?: Participant
  thread?: Thread
  onOpenThread: (threadId: string) => void
  onReact: (messageId: string, emoji: string) => void
  onRetryMessage: (messageId: string) => void
}) {
  if (message.deletedAt) {
    return <div className="deleted-message"><X size={12} /> Message deleted</div>
  }
  return (
    <article className={`timeline-message human-message delivery--${message.deliveryState}`} data-message-id={message.id}>
      <Avatar
        name={sender?.displayName ?? 'Unknown'}
        src={sender?.avatarUrl}
        tone={sender?.avatarColor}
        size="md"
        status={sender?.presence}
      />
      <div className="timeline-message__body">
        <header className="message-author-line">
          <b>{sender?.displayName ?? 'Unknown user'}</b>
          <span>{sender?.handle ?? '@unknown'}</span>
          <time>{timeLabel(message.sentAt)}</time>
          {message.editedAt && <small>edited</small>}
          {message.deliveryState === 'local-echo' && <small className="sending-state">sending…</small>}
          {message.deliveryState === 'failed' && <small className="failed-state">not sent</small>}
        </header>
        <div className="message-text">{message.content.text}</div>
        {message.content.codeBlocks?.map((block) => (
          <div className="code-block" key={block.id}>
            <div className="code-block__header">
              <span><FileCode2 size={12} /> {block.filename ?? block.language}</span>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(block.code)}
                aria-label="Copy code"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <pre><code>{block.code}</code></pre>
          </div>
        ))}
        {message.deliveryState === 'failed' && (
          <button className="inline-action inline-action--danger" type="button" onClick={() => onRetryMessage(message.id)}>
            <RotateCcw size={12} /> Retry
          </button>
        )}
        <MessageReactions message={message} onReact={onReact} />
        {thread && (
          <button className="thread-link" type="button" onClick={() => onOpenThread(thread.id)}>
            <MessageCircle size={13} />
            <span>{thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}</span>
            <small>Last reply {timeLabel(thread.lastReplyAt)}</small>
            <ChevronRight size={13} />
          </button>
        )}
      </div>
      <div className="message-hover-actions">
        <button type="button" aria-label="Add reaction" onClick={() => onReact(message.id, '👍')}><SmilePlus size={14} /></button>
        {thread && <button type="button" aria-label="Open thread" onClick={() => onOpenThread(thread.id)}><MessageCircle size={14} /></button>}
        <button type="button" aria-label="More message actions"><MoreHorizontal size={14} /></button>
      </div>
    </article>
  )
}

function AgentResponseEvent({
  message,
  sender,
  session,
  thread,
  onOpenThread,
  onReact,
}: {
  message: Extract<Message, { kind: 'agent-response' }>
  sender?: Participant
  session?: AgentSession
  thread?: Thread
  onOpenThread: (threadId: string) => void
  onReact: (messageId: string, emoji: string) => void
}) {
  return (
    <article className={`timeline-message agent-response${message.content.isStreaming ? ' is-streaming' : ''}`} data-message-id={message.id}>
      <Avatar
        name={sender?.displayName ?? session?.name ?? 'Agent'}
        src={sender?.avatarUrl ?? session?.avatarUrl}
        tone={sender?.avatarColor}
        size="md"
        isAgent
        status={session?.status === 'blocked' ? 'blocked' : session?.status === 'working' ? 'working' : 'online'}
      />
      <div className="timeline-message__body">
        <header className="message-author-line">
          <b>{sender?.displayName ?? session?.name ?? 'Agent'}</b>
          <span className="agent-label">Agent · {session?.provider ?? 'runtime'}</span>
          {session && <small className={`status-label status-label--${session.status}`}>{session.status.replace('-', ' ')}</small>}
          <time>{timeLabel(message.sentAt)}</time>
        </header>
        <div className="message-text">{message.content.text}</div>
        {message.content.isStreaming && <span className="streaming-cursor" aria-label="Agent is responding" />}
        <MessageReactions message={message} onReact={onReact} />
        {thread && (
          <button className="thread-link" type="button" onClick={() => onOpenThread(thread.id)}>
            <MessageCircle size={13} />
            <span>{thread.replyCount} replies</span>
            <small>Open agent thread</small>
            <ChevronRight size={13} />
          </button>
        )}
      </div>
    </article>
  )
}

function AgentProgressEvent({
  message,
  session,
}: {
  message: Extract<Message, { kind: 'agent-progress' }>
  session?: AgentSession
}) {
  const [expanded, setExpanded] = useState(message.content.state === 'blocked')
  const StateIcon = message.content.state === 'complete'
    ? CheckCircle2
    : message.content.state === 'failed' || message.content.state === 'blocked'
      ? AlertTriangle
      : LoaderCircle
  return (
    <article className={`agent-progress agent-progress--${message.content.state}`} data-message-id={message.id}>
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="agent-progress__state"><StateIcon size={14} /></span>
        <span>
          <b>{message.content.label}</b>
          <small>{session?.name ?? 'Agent'} · {message.content.state}</small>
        </span>
        {typeof message.content.progress === 'number' && (
          <span className="agent-progress__meter"><i style={{ width: `${message.content.progress}%` }} /></span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && message.content.detail && <p>{message.content.detail}</p>}
    </article>
  )
}

function AgentToolEvent({ message }: { message: Extract<Message, { kind: 'agent-tool' }> }) {
  const [expanded, setExpanded] = useState(false)
  const call = message.content.toolCall
  return (
    <article className={`tool-event tool-event--${call.status}`} data-message-id={message.id}>
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <TerminalSquare size={14} />
        <span><b>{call.displayName}</b><small>{call.resultSummary ?? call.status}</small></span>
        <span className={`tool-state tool-state--${call.status}`}>
          {call.status === 'succeeded' ? <Check size={11} /> : call.status === 'running' ? <LoaderCircle size={11} /> : <Circle size={9} />}
          {call.status.replace('-', ' ')}
        </span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && (
        <dl className="tool-event__args">
          {Object.entries(call.arguments).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{formatArg(value)}</dd></div>
          ))}
        </dl>
      )}
    </article>
  )
}

function ApprovalEvent({
  message,
  request,
  session,
  onApprove,
  onDeny,
}: {
  message: Extract<Message, { kind: 'approval' }>
  request?: ApprovalRequest
  session?: AgentSession
  onApprove: (approvalId: string) => void
  onDeny: (approvalId: string) => void
}) {
  const [details, setDetails] = useState(false)
  if (!request) return null
  return (
    <article className={`approval-card approval-card--${request.status}`} data-message-id={message.id}>
      <header>
        <span className="approval-card__icon"><ShieldAlert size={17} /></span>
        <div>
          <span>Approval required · {request.risk} risk</span>
          <h3>{request.title}</h3>
        </div>
        <small>{session?.name ?? 'Agent'}</small>
      </header>
      <p>{request.detail}</p>
      <div className="approval-scope">
        <div><span>Tool</span><code>{request.tool}</code></div>
        <div><span>Scope</span><code>{request.scope}</code></div>
        <div><span>Consequence</span><b>{request.consequence}</b></div>
      </div>
      <button className="approval-details-toggle" type="button" onClick={() => setDetails((value) => !value)}>
        {details ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {details ? 'Hide' : 'Review'} arguments and audit details
      </button>
      {details && (
        <div className="approval-details">
          {Object.entries(request.args).map(([key, value]) => (
            <div key={key}><code>{key}</code><span>{formatArg(value)}</span></div>
          ))}
          <p><Clock3 size={12} /> Requested {timeLabel(request.requestedAt)} · recorded in the room audit log</p>
        </div>
      )}
      {request.status === 'pending' ? (
        <footer>
          <button className="button button--secondary" type="button" onClick={() => onDeny(request.id)}>
            <X size={14} /> Deny
          </button>
          <button className="button button--primary" type="button" onClick={() => onApprove(request.id)}>
            <Play size={13} /> Allow once
          </button>
        </footer>
      ) : (
        <div className={`approval-resolution approval-resolution--${request.status}`}>
          {request.status === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {request.status === 'approved' ? 'Allowed once' : 'Request denied'}
          {request.resolvedAt && <time>{timeLabel(request.resolvedAt)}</time>}
        </div>
      )}
    </article>
  )
}

function GitHubEventCard({ message }: { message: Extract<Message, { kind: 'github-event' }> }) {
  const event = message.content.event
  const pr = event.pullRequest
  const check = event.checkRun
  const failed = pr?.checksState === 'failure' || check?.conclusion === 'failure'
  return (
    <article className="github-card" data-message-id={message.id}>
      <header>
        <span><Github size={15} /> GitHub</span>
        <time>{timeLabel(event.occurredAt)}</time>
      </header>
      <div className="github-card__content">
        <span className={`github-card__type${failed ? ' is-failed' : ''}`}>
          {pr ? <GitPullRequest size={16} /> : check ? <Play size={16} /> : <Github size={16} />}
        </span>
        <div>
          <small>{event.repository.fullName} · {event.action.replaceAll('-', ' ')}</small>
          <h3>{event.title}</h3>
          <p>{event.description}</p>
          {pr && (
            <div className="pr-meta">
              <span><GitBranch size={11} /> {pr.headBranch} → {pr.baseBranch}</span>
              <span className="addition">+{pr.additions}</span>
              <span className="deletion">−{pr.deletions}</span>
              <span>{pr.changedFiles} files</span>
              <span className={`check-state check-state--${pr.checksState}`}>
                {failed ? <XCircle size={11} /> : <CheckCircle2 size={11} />}
                {pr.checksState}
              </span>
            </div>
          )}
        </div>
        <a href={event.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub"><ExternalLink size={14} /></a>
      </div>
    </article>
  )
}

function ArtifactEvent({ message }: { message: Extract<Message, { kind: 'artifact' }> }) {
  return (
    <article className="artifact-event" data-message-id={message.id}>
      <span className="artifact-event__icon"><Paperclip size={15} /></span>
      <div>
        <p>{message.content.text}</p>
        {message.content.artifacts.map((artifact) => (
          <a key={artifact.id} href={artifact.url ?? '#'} onClick={(event) => !artifact.url && event.preventDefault()}>
            {artifact.kind === 'file' || artifact.kind === 'diff' ? <FileCode2 size={14} /> : <Paperclip size={14} />}
            <span><b>{artifact.name}</b><small>{artifact.kind}{artifact.sizeBytes ? ` · ${Math.ceil(artifact.sizeBytes / 1024)} KB` : ''}</small></span>
            <ExternalLink size={12} />
          </a>
        ))}
      </div>
    </article>
  )
}

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  {
    messages,
    participants,
    agentSessions,
    threads,
    approvalRequests,
    returnSummary,
    returnBriefHandled,
    onDismissSummary,
    onRegenerateSummary,
    onMarkHandled,
    onShowHistory,
    onApprove,
    onDeny,
    onOpenThread,
    onReact,
    onRetryMessage,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const participantMap = useMemo(() => new Map(participants.map((item) => [item.id, item])), [participants])
  const sessionMap = useMemo(() => new Map(agentSessions.map((item) => [item.id, item])), [agentSessions])
  const threadByRoot = useMemo(() => new Map(threads.map((item) => [item.rootMessageId, item])), [threads])
  const approvalMap = useMemo(() => new Map(approvalRequests.map((item) => [item.id, item])), [approvalRequests])
  const items = useMemo<TimelineItem[]>(() => {
    const next: TimelineItem[] = []
    messages.forEach((message, index) => {
      if (returnSummary && !returnSummary.dismissedAt && index === Math.max(1, messages.length - returnSummary.newMessageCount)) {
        next.push({ type: 'summary', id: returnSummary.id, summary: returnSummary })
      }
      next.push({ type: 'message', id: message.id, message })
    })
    if (returnSummary && !returnSummary.dismissedAt && !next.some((item) => item.type === 'summary')) {
      next.unshift({ type: 'summary', id: returnSummary.id, summary: returnSummary })
    }
    return next
  }, [messages, returnSummary])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index]
      if (item?.type === 'summary') return 260
      switch (item?.message.kind) {
        case 'approval': return 380
        case 'github-event': return 230
        case 'human': return item.message.content.codeBlocks?.length ? 300 : 112
        case 'agent-response': return 145
        default: return 86
      }
    },
    overscan: 6,
    getItemKey: (index) => items[index]?.id ?? index,
  })

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const index = items.findIndex((item) => item.type === 'message' && item.message.id === messageId)
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
    },
    [items, virtualizer],
  )

  useImperativeHandle(ref, () => ({
    scrollToMessage,
    scrollToBottom: () => virtualizer.scrollToIndex(Math.max(0, items.length - 1), { align: 'end' }),
  }), [items.length, scrollToMessage, virtualizer])

  let previousDay = ''

  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <div className="timeline-top-actions">
        <button type="button"><ChevronDown size={13} /> Load earlier messages</button>
        <span>History is encrypted in transit · Matrix synced</span>
      </div>
      <div className="virtual-timeline" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          if (!item) return null
          const currentDay = item.type === 'message' ? dayLabel(item.message.sentAt) : ''
          const showDay = Boolean(currentDay && currentDay !== previousDay)
          if (currentDay) previousDay = currentDay

          let content
          if (item.type === 'summary') {
            content = (
              <ReturnBrief
                summary={item.summary}
                isHandled={returnBriefHandled}
                onDismiss={onDismissSummary}
                onRegenerate={onRegenerateSummary}
                onMarkHandled={onMarkHandled}
                onShowHistory={onShowHistory}
                onJumpToEvent={scrollToMessage}
              />
            )
          } else {
            const message = item.message
            const sender = participantMap.get(message.senderId)
            const thread = threadByRoot.get(message.id)
            switch (message.kind) {
              case 'human':
                content = <HumanEvent message={message} sender={sender} thread={thread} onOpenThread={onOpenThread} onReact={onReact} onRetryMessage={onRetryMessage} />
                break
              case 'agent-response':
                content = <AgentResponseEvent message={message} sender={sender} session={sessionMap.get(message.content.agentSessionId)} thread={thread} onOpenThread={onOpenThread} onReact={onReact} />
                break
              case 'agent-progress':
                content = <AgentProgressEvent message={message} session={sessionMap.get(message.content.agentSessionId)} />
                break
              case 'agent-tool':
                content = <AgentToolEvent message={message} />
                break
              case 'approval':
                content = <ApprovalEvent message={message} request={approvalMap.get(message.content.approvalRequestId)} session={approvalMap.get(message.content.approvalRequestId) ? sessionMap.get(approvalMap.get(message.content.approvalRequestId)!.agentSessionId) : undefined} onApprove={onApprove} onDeny={onDeny} />
                break
              case 'github-event':
                content = <GitHubEventCard message={message} />
                break
              case 'artifact':
                content = <ArtifactEvent message={message} />
                break
              case 'system':
                content = <div className={`system-event system-event--${message.content.tone}`} data-message-id={message.id}><Circle size={7} /> {message.content.text}<time>{timeLabel(message.sentAt)}</time></div>
                break
            }
          }

          return (
            <div
              key={item.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="timeline-virtual-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {showDay && <div className="day-divider"><span>{currentDay}</span></div>}
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
})
