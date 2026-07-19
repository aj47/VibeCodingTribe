import { ArrowLeft, CheckCircle2, MessageCircle, X } from 'lucide-react'
import type { Message, Participant, Thread } from '../domain/types'
import { Avatar } from './Avatar'
import { Composer } from './Composer'

interface ThreadPanelProps {
  thread: Thread
  messages: Message[]
  participants: Participant[]
  draft: string
  onChangeDraft: (value: string) => void
  onSend: (text: string, attachmentName?: string) => void
  onClose: () => void
  onOpenAgentActions: () => void
}

function contentText(message: Message) {
  switch (message.kind) {
    case 'human':
    case 'agent-response': return message.content.text
    case 'agent-progress': return message.content.detail ?? message.content.label
    case 'agent-tool': return message.content.toolCall.resultSummary ?? message.content.toolCall.displayName
    case 'approval': return message.content.description
    case 'github-event': return message.content.event.description
    case 'artifact': return message.content.text
    case 'system': return message.content.text
  }
}

export function ThreadPanel({
  thread,
  messages,
  participants,
  draft,
  onChangeDraft,
  onSend,
  onClose,
  onOpenAgentActions,
}: ThreadPanelProps) {
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]))
  const threadMessages = messages.filter((message) => message.id === thread.rootMessageId || message.threadId === thread.id)

  return (
    <aside className="thread-panel" aria-label="Thread">
      <header className="thread-panel__header">
        <button className="icon-button thread-mobile-back" type="button" onClick={onClose} aria-label="Back to room"><ArrowLeft size={17} /></button>
        <div><span>Thread</span><h2>{thread.title ?? 'Conversation thread'}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close thread"><X size={17} /></button>
      </header>
      <div className="thread-panel__meta">
        <MessageCircle size={12} /> {thread.replyCount} replies
        <span />
        {thread.isResolved ? <><CheckCircle2 size={12} /> Resolved</> : 'Open'}
      </div>
      <div className="thread-timeline">
        {threadMessages.map((message) => {
          const sender = participantMap.get(message.senderId)
          const isRoot = message.id === thread.rootMessageId
          return (
            <article key={message.id} className={`thread-message${isRoot ? ' is-root' : ''}`}>
              <Avatar name={sender?.displayName ?? 'Event'} src={sender?.avatarUrl} tone={sender?.avatarColor} size="sm" isAgent={sender?.kind === 'agent'} />
              <div>
                <header><b>{sender?.displayName ?? 'Event'}</b>{sender?.kind === 'agent' && <em>agent</em>}<time>{new Date(message.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></header>
                <p>{contentText(message)}</p>
              </div>
              {isRoot && <span className="root-label">Root message</span>}
            </article>
          )
        })}
      </div>
      <Composer
        conversationTitle="thread"
        value={draft}
        participants={participants}
        onChange={onChangeDraft}
        onSend={onSend}
        onOpenAgentActions={onOpenAgentActions}
      />
    </aside>
  )
}
