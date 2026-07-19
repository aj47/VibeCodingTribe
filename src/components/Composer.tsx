import {
  AtSign,
  Bot,
  Braces,
  FileUp,
  Image,
  Paperclip,
  Send,
  Smile,
  Sparkles,
  X,
} from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { Participant } from '../domain/types'

interface ComposerProps {
  conversationTitle: string
  value: string
  participants: Participant[]
  disabled?: boolean
  typingLabel?: string
  replyLabel?: string
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: (text: string, attachmentName?: string) => void
  onOpenAgentActions: () => void
  onCancelReply?: () => void
}

export function Composer({
  conversationTitle,
  value,
  participants,
  disabled = false,
  typingLabel,
  replyLabel,
  inputRef,
  onChange,
  onSend,
  onOpenAgentActions,
  onCancelReply,
}: ComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<string | undefined>()
  const [showMentions, setShowMentions] = useState(false)
  const textareaRef = inputRef ?? internalRef

  function send() {
    if ((!value.trim() && !attachment) || disabled) return
    onSend(value.trim(), attachment)
    setAttachment(undefined)
    setShowMentions(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
    if (event.key === 'Escape') setShowMentions(false)
  }

  function insertMention(handle: string) {
    const lastAt = value.lastIndexOf('@')
    const prefix = lastAt >= 0 ? value.slice(0, lastAt) : `${value} `
    onChange(`${prefix}@${handle.replace(/^@/, '')} `)
    setShowMentions(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <footer className="composer-region">
      <div className="composer-status-line">
        {typingLabel ? (
          <span className="typing-label"><i /><i /><i /> {typingLabel}</span>
        ) : (
          <span>Messages stay in this repository context</span>
        )}
        <small><kbd>Enter</kbd> send · <kbd>⇧ Enter</kbd> newline</small>
      </div>
      <div className={`composer${disabled ? ' is-disabled' : ''}`}>
        {replyLabel && (
          <div className="composer__reply">
            <span>Replying to <b>{replyLabel}</b></span>
            <button type="button" onClick={onCancelReply} aria-label="Cancel reply"><X size={13} /></button>
          </div>
        )}
        {attachment && (
          <div className="composer__attachment">
            <FileUp size={13} />
            <span>{attachment}</span>
            <small>Ready to send</small>
            <button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment"><X size={13} /></button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={`Message #${conversationTitle}`}
          aria-label={`Message ${conversationTitle}`}
          onChange={(event) => {
            const next = event.target.value
            onChange(next)
            const lastWord = next.split(/\s/).at(-1) ?? ''
            setShowMentions(lastWord.startsWith('@'))
          }}
          onKeyDown={onKeyDown}
        />
        {showMentions && (
          <div className="mention-menu" role="listbox" aria-label="Mention someone">
            <span>People and agents</span>
            {participants.slice(0, 6).map((participant) => (
              <button key={participant.id} type="button" onClick={() => insertMention(participant.handle)}>
                <i style={{ background: participant.avatarColor }}>{participant.avatarFallback}</i>
                <span><b>{participant.displayName}</b><small>{participant.handle}</small></span>
                {participant.kind === 'agent' && <em><Bot size={10} /> agent</em>}
              </button>
            ))}
          </div>
        )}
        <div className="composer__toolbar">
          <div>
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              onChange={(event) => setAttachment(event.target.files?.[0]?.name)}
            />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach file" title="Attach file">
              <Paperclip size={16} />
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach image" title="Attach image">
              <Image size={16} />
            </button>
            <button type="button" onClick={() => onChange(`${value}\n\`\`\`ts\n\n\`\`\``)} aria-label="Insert code block" title="Insert code block">
              <Braces size={16} />
            </button>
            <button type="button" onClick={() => setShowMentions(true)} aria-label="Mention someone" title="Mention someone">
              <AtSign size={16} />
            </button>
            <button type="button" onClick={() => onChange(`${value} ✨`)} aria-label="Add emoji" title="Add emoji">
              <Smile size={16} />
            </button>
          </div>
          <div>
            <button className="composer-agent-button" type="button" onClick={onOpenAgentActions}>
              <Sparkles size={14} /> Agent
            </button>
            <button className="composer-send-button" type="button" onClick={send} disabled={(!value.trim() && !attachment) || disabled} aria-label="Send message">
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
