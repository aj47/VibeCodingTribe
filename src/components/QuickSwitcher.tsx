import {
  Bot,
  Check,
  Command,
  Github,
  Hash,
  MessageCircle,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentDefinition, Conversation, RepositoryReference } from '../domain/types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface QuickSwitcherProps {
  open: boolean
  conversations: Conversation[]
  repositories: RepositoryReference[]
  agents: AgentDefinition[]
  onClose: () => void
  onSelectConversation: (conversationId: string) => void
  onConnectRepository: () => void
  onOpenSettings: () => void
  onOpenAgentActions: () => void
  onMarkHandled: () => void
}

type SwitchItem = {
  id: string
  section: 'Conversations' | 'Repositories' | 'Agents' | 'Commands'
  title: string
  subtitle: string
  icon: typeof Search
  avatar?: { name: string; src?: string; tone?: string; agent?: boolean }
  run: () => void
}

export function QuickSwitcher({
  open,
  conversations,
  repositories,
  agents,
  onClose,
  onSelectConversation,
  onConnectRepository,
  onOpenSettings,
  onOpenAgentActions,
  onMarkHandled,
}: QuickSwitcherProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const items = useMemo<SwitchItem[]>(() => {
    const conversationItems = conversations.map((conversation) => ({
      id: `conversation-${conversation.id}`,
      section: 'Conversations' as const,
      title: conversation.title,
      subtitle: conversation.attentionReason ?? conversation.subtitle ?? conversation.lastMessagePreview,
      icon: conversation.type === 'dm' ? MessageCircle : Hash,
      avatar: conversation.type === 'dm' && conversation.participants[1]
        ? {
            name: conversation.participants[1].displayName,
            src: conversation.participants[1].avatarUrl,
            tone: conversation.participants[1].avatarColor,
            agent: conversation.participants[1].kind === 'agent',
          }
        : undefined,
      run: () => onSelectConversation(conversation.id),
    }))
    const repositoryItems = repositories.map((repository) => ({
      id: `repository-${repository.id}`,
      section: 'Repositories' as const,
      title: repository.fullName,
      subtitle: `${repository.visibility} · ${repository.permission} access`,
      icon: Github,
      run: () => {
        const conversation = conversations.find((item) => item.repo?.id === repository.id)
        if (conversation) onSelectConversation(conversation.id)
      },
    }))
    const agentItems = agents.map((agent) => ({
      id: `agent-${agent.id}`,
      section: 'Agents' as const,
      title: agent.name,
      subtitle: `${agent.provider} · ${agent.capabilities.slice(0, 2).join(', ')}`,
      icon: Bot,
      avatar: { name: agent.name, src: agent.avatarUrl, tone: agent.avatarColor, agent: true },
      run: onOpenAgentActions,
    }))
    const commands: SwitchItem[] = [
      { id: 'command-connect', section: 'Commands', title: 'Connect a repository', subtitle: 'Install or update the GitHub App', icon: Plus, run: onConnectRepository },
      { id: 'command-agent', section: 'Commands', title: 'Start an agent', subtitle: 'Ask, investigate, review, or run tests', icon: Bot, run: onOpenAgentActions },
      { id: 'command-handled', section: 'Commands', title: 'Mark current item handled', subtitle: 'Remove it from Needs You without changing read state', icon: Check, run: onMarkHandled },
      { id: 'command-settings', section: 'Commands', title: 'Open profile and settings', subtitle: 'Identity, permissions, and connected repositories', icon: Settings, run: onOpenSettings },
    ]
    return [...conversationItems, ...repositoryItems, ...agentItems, ...commands]
  }, [agents, conversations, onConnectRepository, onMarkHandled, onOpenAgentActions, onOpenSettings, onSelectConversation, repositories])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return items.slice(0, 12)
    return items.filter((item) => `${item.title} ${item.subtitle} ${item.section}`.toLowerCase().includes(normalized))
  }, [items, query])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [activeIndex, filtered.length])

  function run(item: SwitchItem) {
    item.run()
    onClose()
  }

  return (
    <Modal open={open} title="Jump to anything" onClose={onClose} className="quick-switcher-modal">
      <div className="switcher-search">
        <Search size={17} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((value) => Math.min(filtered.length - 1, value + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((value) => Math.max(0, value - 1))
            } else if (event.key === 'Enter' && filtered[activeIndex]) {
              run(filtered[activeIndex])
            }
          }}
          placeholder="Search rooms, repositories, agents, or commands…"
          aria-label="Search everything"
        />
        <kbd>esc</kbd>
      </div>
      <div className="switcher-results" role="listbox" aria-label="Switcher results">
        {filtered.length === 0 ? (
          <div className="switcher-empty"><Search size={23} /><b>No matches</b><span>Try a room, repository, agent, or action name.</span></div>
        ) : (
          filtered.map((item, index) => {
            const Icon = item.icon
            const isNewSection = index === 0 || filtered[index - 1]?.section !== item.section
            return (
              <div key={item.id}>
                {isNewSection && <div className="switcher-section-label">{item.section}</div>}
                <button
                  className={`switcher-result${index === activeIndex ? ' is-active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  {item.avatar ? (
                    <Avatar name={item.avatar.name} src={item.avatar.src} tone={item.avatar.tone} size="sm" isAgent={item.avatar.agent} />
                  ) : (
                    <span className="switcher-result__icon"><Icon size={15} /></span>
                  )}
                  <span><b>{item.title}</b><small>{item.subtitle}</small></span>
                  {index === activeIndex && <kbd>↵</kbd>}
                </button>
              </div>
            )
          })
        )}
      </div>
      <div className="switcher-footer"><span><Command size={12} />K to open</span><span>↑↓ navigate</span><span>↵ select</span></div>
    </Modal>
  )
}
