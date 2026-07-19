import { AlertTriangle, Hash, MessageCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, Participant } from '../domain/types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface RoomSearchProps {
  open: boolean
  roomTitle: string
  messages: Message[]
  participants: Participant[]
  onClose: () => void
  onJump: (messageId: string) => void
}

function messageText(message: Message) {
  switch (message.kind) {
    case 'human':
    case 'agent-response': return message.content.text
    case 'agent-progress': return `${message.content.label} ${message.content.detail ?? ''}`
    case 'agent-tool': return `${message.content.toolCall.displayName} ${message.content.toolCall.resultSummary ?? ''}`
    case 'approval': return `${message.content.title} ${message.content.description}`
    case 'github-event': return `${message.content.event.title} ${message.content.event.description}`
    case 'artifact': return `${message.content.text} ${message.content.artifacts.map((item) => item.name).join(' ')}`
    case 'system': return message.content.text
  }
}

function highlight(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0 || !query) return text
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}

export function RoomSearch({ open, roomTitle, messages, participants, onClose, onJump }: RoomSearchProps) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)
  const participantMap = useMemo(() => new Map(participants.map((item) => [item.id, item])), [participants])
  const results = useMemo(() => {
    if (!query.trim() || state !== 'ready') return []
    const normalized = query.toLowerCase()
    return messages.filter((message) => messageText(message).toLowerCase().includes(normalized))
  }, [messages, query, state])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setState('idle')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  function updateQuery(value: string) {
    setQuery(value)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (!value.trim()) {
      setState('idle')
      return
    }
    setState('searching')
    timerRef.current = window.setTimeout(() => setState('ready'), 180)
  }

  return (
    <Modal open={open} title={`Search #${roomTitle}`} description="Search the locally loaded room history." onClose={onClose} className="room-search-modal">
      <div className="room-search-input">
        <Search size={17} />
        <input ref={inputRef} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Try “OAuth”, “approval”, or “tests”…" aria-label={`Search ${roomTitle}`} />
        {state === 'searching' && <span className="mini-spinner" aria-label="Searching" />}
      </div>
      <div className="room-search-results" aria-live="polite">
        {state === 'idle' && (
          <div className="search-guidance"><Search size={24} /><b>Search this room</b><span>Messages, agent activity, tool logs, and GitHub events are indexed.</span></div>
        )}
        {state === 'error' && (
          <div className="search-guidance is-error"><AlertTriangle size={24} /><b>Local index unavailable</b><span>Room messages are still safe. Close and retry search.</span></div>
        )}
        {state === 'ready' && results.length === 0 && (
          <div className="search-guidance"><Search size={24} /><b>No results for “{query}”</b><span>Try a shorter term or a participant name.</span></div>
        )}
        {results.map((message) => {
          const sender = participantMap.get(message.senderId)
          const text = messageText(message)
          return (
            <button key={message.id} className="room-search-result" type="button" onClick={() => { onJump(message.id); onClose() }}>
              <Avatar name={sender?.displayName ?? 'Event'} src={sender?.avatarUrl} tone={sender?.avatarColor} size="sm" isAgent={sender?.kind === 'agent'} />
              <span>
                <span className="search-result-meta"><b>{sender?.displayName ?? 'Room event'}</b><time>{new Date(message.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>{message.threadId && <em><MessageCircle size={9} /> thread</em>}</span>
                <span className="search-result-snippet">{highlight(text, query)}</span>
              </span>
              <Hash size={13} />
            </button>
          )
        })}
      </div>
      <div className="room-search-footer"><span>{results.length} {results.length === 1 ? 'result' : 'results'}</span><button type="button" onClick={() => setState('error')}>Test recovery state</button></div>
    </Modal>
  )
}
