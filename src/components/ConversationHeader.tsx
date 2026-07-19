import {
  Bot,
  Check,
  ChevronRight,
  Github,
  Info,
  Menu,
  Radio,
  Search,
  Users,
} from 'lucide-react'
import type { Conversation } from '../domain/types'
import { Avatar } from './Avatar'

interface ConversationHeaderProps {
  conversation: Conversation
  isHandled: boolean
  detailsOpen: boolean
  liveConnection?: 'connected' | 'syncing' | 'offline'
  liveIdentity?: string
  liveOnlineCount?: number
  onOpenNavigation: () => void
  onOpenSearch: () => void
  onOpenAgentMenu: () => void
  onToggleDetails: () => void
  onMarkHandled: () => void
  onOpenLiveIdentity?: () => void
}

export function ConversationHeader({
  conversation,
  isHandled,
  detailsOpen,
  liveConnection,
  liveIdentity,
  liveOnlineCount = 0,
  onOpenNavigation,
  onOpenSearch,
  onOpenAgentMenu,
  onToggleDetails,
  onMarkHandled,
  onOpenLiveIdentity,
}: ConversationHeaderProps) {
  const activeAgents = conversation.agents.filter((agent) =>
    ['working', 'blocked', 'approval-required', 'listening'].includes(agent.status),
  )

  return (
    <header className="conversation-header">
      <div className="conversation-header__identity">
        <button
          className="icon-button mobile-nav-button"
          type="button"
          onClick={onOpenNavigation}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <div className="conversation-header__text">
          {conversation.repo && (
            <div className="repo-breadcrumb">
              <Github size={11} />
              <span>{conversation.repo.fullName}</span>
              <ChevronRight size={10} />
              <span>{conversation.repo.defaultBranch}</span>
            </div>
          )}
          <div className="room-title-row">
            <h1>
              {conversation.type === 'room' && <span>#</span>}
              {conversation.title}
            </h1>
            {conversation.isMuted && <small>Muted</small>}
          </div>
        </div>
      </div>

      <div className="conversation-header__presence">
        <div className="avatar-stack" aria-label={`${conversation.participants.length} participants`}>
          {conversation.participants.slice(0, 3).map((participant) => (
            <Avatar
              key={participant.id}
              name={participant.displayName}
              src={participant.avatarUrl}
              size="xs"
              tone={participant.avatarColor}
              isAgent={participant.kind === 'agent'}
            />
          ))}
        </div>
        <span className="participant-count">
          <Users size={12} /> {conversation.participants.length}
        </span>
        {liveConnection && (
          <button
            className={`realtime-presence-chip realtime-presence-chip--${liveConnection}`}
            type="button"
            onClick={onOpenLiveIdentity}
            aria-label={`${liveOnlineCount} live connection${liveOnlineCount === 1 ? '' : 's'}. Identity ${liveIdentity ?? 'builder'}`}
          >
            <Radio size={11} />
            <span>{liveOnlineCount} live</span>
            <b>{liveConnection === 'connected' ? liveIdentity : liveConnection}</b>
          </button>
        )}
        {activeAgents.length > 0 && (
          <button className="active-agent-chip" type="button" onClick={onOpenAgentMenu}>
            <span className={`agent-beacon agent-beacon--${activeAgents[0].status}`}>
              <Bot size={9} />
            </span>
            <span>{activeAgents[0].name}</span>
            <b>{activeAgents[0].status.replace('-', ' ')}</b>
          </button>
        )}
      </div>

      <div className="conversation-header__actions">
        {conversation.attentionReason && (
          <button
            className={`button button--small ${isHandled ? 'button--ghost' : 'button--secondary'}`}
            type="button"
            onClick={onMarkHandled}
            disabled={isHandled}
          >
            <Check size={13} /> {isHandled ? 'Handled' : 'Mark handled'}
          </button>
        )}
        <button className="icon-button" type="button" onClick={onOpenSearch} aria-label="Search room">
          <Search size={17} />
        </button>
        <button
          className={`icon-button${detailsOpen ? ' is-active' : ''}`}
          type="button"
          onClick={onToggleDetails}
          aria-label="Conversation details"
          aria-pressed={detailsOpen}
        >
          <Info size={17} />
        </button>
      </div>
    </header>
  )
}
