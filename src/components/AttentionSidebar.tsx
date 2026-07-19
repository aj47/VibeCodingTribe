import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Github,
  Hash,
  Inbox,
  MessageCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AttentionItem,
  Conversation,
  SidebarSection,
  SidebarSectionId,
  UserProfile,
} from '../domain/types'
import { Avatar } from './Avatar'
import { Brand } from './Brand'

interface AttentionSidebarProps {
  currentUser: UserProfile
  conversations: Conversation[]
  attentionItems: AttentionItem[]
  sections: SidebarSection[]
  selectedConversationId: string
  syncState: 'connected' | 'syncing' | 'offline'
  isMobileOpen: boolean
  onCloseMobile: () => void
  onSelectConversation: (conversationId: string) => void
  onOpenQuickSwitcher: () => void
  onAddRepository: () => void
  onOpenProfile: () => void
}

const sectionIcons: Record<SidebarSectionId, typeof Inbox> = {
  'needs-you': Inbox,
  active: CircleDot,
  waiting: AlertCircle,
  repositories: Github,
  'direct-messages': MessageCircle,
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function conversationIcon(conversation: Conversation) {
  if (conversation.type === 'dm') {
    const peer = conversation.participants[0]
    if (peer) {
      return (
        <Avatar
          name={peer.displayName}
          src={peer.avatarUrl}
          size="sm"
          tone={peer.avatarColor}
          isAgent={peer.kind === 'agent'}
          status={peer.presence}
        />
      )
    }
    return <MessageCircle size={15} />
  }
  if (conversation.pullRequest || conversation.issue) return <Github size={14} />
  if (conversation.type === 'thread') return <MessageCircle size={14} />
  return <Hash size={14} />
}

function isCompactViewport() {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 900px)').matches
  }
  return window.innerWidth <= 900
}

export function AttentionSidebar({
  currentUser,
  conversations,
  attentionItems,
  sections,
  selectedConversationId,
  syncState,
  isMobileOpen,
  onCloseMobile,
  onSelectConversation,
  onOpenQuickSwitcher,
  onAddRepository,
  onOpenProfile,
}: AttentionSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, section.isCollapsed])),
  )
  const [isCompact, setIsCompact] = useState(isCompactViewport)
  const conversationsById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation])),
    [conversations],
  )
  const attentionById = useMemo(
    () => new Map(attentionItems.map((item) => [item.id, item])),
    [attentionItems],
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(max-width: 900px)')
    const onChange = () => setIsCompact(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  function getSectionRows(section: SidebarSection) {
    if (section.id === 'needs-you' || section.id === 'active' || section.id === 'waiting') {
      return section.attentionItemIds
        .map((itemId) => attentionById.get(itemId))
        .filter((item): item is AttentionItem => Boolean(item && !item.handledAt))
        .sort((a, b) => b.score - a.score)
        .map((item) => ({ conversation: conversationsById.get(item.conversationId), attention: item }))
        .filter(
          (row): row is { conversation: Conversation; attention: AttentionItem } =>
            Boolean(row.conversation),
        )
    }
    return section.conversationIds
      .map((id) => conversationsById.get(id))
      .filter((conversation): conversation is Conversation => Boolean(conversation))
      .map((conversation) => ({ conversation, attention: undefined }))
  }

  return (
    <>
      <button
        className={`sidebar-scrim${isMobileOpen ? ' is-visible' : ''}`}
        type="button"
        onClick={onCloseMobile}
        aria-label="Close navigation"
        tabIndex={isMobileOpen ? 0 : -1}
      />
      <aside
        className={`attention-sidebar${isMobileOpen ? ' is-mobile-open' : ''}`}
        aria-hidden={isCompact && !isMobileOpen ? true : undefined}
        inert={isCompact && !isMobileOpen}
      >
        <div className="sidebar-brand-row">
          <Brand />
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>

        <button className="quick-switch-button" type="button" onClick={onOpenQuickSwitcher}>
          <Search size={14} />
          <span>Jump to anything</span>
          <kbd>⌘ K</kbd>
        </button>

        <nav className="attention-nav" aria-label="Conversations">
          {sections.map((section) => {
            const rows = getSectionRows(section)
            const SectionIcon = sectionIcons[section.id]
            const isCollapsed = collapsed[section.id]

            return (
              <section
                className={`attention-section attention-section--${section.id}`}
                key={section.id}
              >
                <div className="attention-section__header">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))
                    }
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <SectionIcon size={12} />
                    <span>{section.label}</span>
                    {rows.length > 0 && <b>{rows.length}</b>}
                  </button>
                  {section.id === 'repositories' && (
                    <button
                      className="section-add"
                      type="button"
                      onClick={onAddRepository}
                      aria-label="Connect repository"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  <div className="attention-section__rows">
                    {rows.length === 0 && section.id === 'needs-you' ? (
                      <div className="attention-empty">
                        <span>✓</span>
                        <p><b>You’re caught up.</b> Nothing needs a decision right now.</p>
                      </div>
                    ) : (
                      rows.map(({ conversation, attention }) => {
                        const isSelected = conversation.id === selectedConversationId
                        const activeAgent = conversation.agents.find((agent) =>
                          ['working', 'blocked', 'approval-required', 'listening'].includes(agent.status),
                        )
                        return (
                          <button
                            key={`${section.id}-${conversation.id}`}
                            className={`attention-row${isSelected ? ' is-selected' : ''}${
                              attention?.isUnread || conversation.unreadCount ? ' is-unread' : ''
                            }`}
                            type="button"
                            onClick={() => {
                              onSelectConversation(conversation.id)
                              onCloseMobile()
                            }}
                            aria-current={isSelected ? 'page' : undefined}
                          >
                            <span className="attention-row__icon">{conversationIcon(conversation)}</span>
                            <span className="attention-row__copy">
                              <span className="attention-row__title">
                                <b>{conversation.title}</b>
                                <time>{relativeTime(conversation.lastMessageAt)}</time>
                              </span>
                              <span className="attention-row__meta">
                                {attention?.reasonLabel ?? conversation.lastMessagePreview}
                              </span>
                            </span>
                            <span className="attention-row__state">
                              {activeAgent && (
                                <i
                                  className={`agent-beacon agent-beacon--${activeAgent.status}`}
                                  title={`${activeAgent.name}: ${activeAgent.status}`}
                                >
                                  <Bot size={9} />
                                </i>
                              )}
                              {conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="profile-button" type="button" onClick={onOpenProfile}>
            <Avatar name={currentUser.displayName} src={currentUser.avatarUrl} size="sm" status="online" />
            <span>
              <b>{currentUser.displayName}</b>
              <small>@{currentUser.githubUsername}</small>
            </span>
            <i className={`sync-state sync-state--${syncState}`}>
              <span /> {syncState}
            </i>
          </button>
        </div>
      </aside>
    </>
  )
}
