import {
  Bot,
  ClipboardCheck,
  ChevronDown,
  Github,
  Globe2,
  Hash,
  Linkedin,
  LockKeyhole,
  LogIn,
  LogOut,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AuthProvider } from '../auth/types'
import {
  MAX_REALTIME_MESSAGE_LENGTH,
  type RealtimeMessageRecord,
  type RealtimeProfile,
} from '../realtime/protocol'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

export type MessageDeliveryState = 'sending' | 'failed'

interface RoomParticipant extends RealtimeProfile {
  online: boolean
}

interface LiveRoomProps {
  profile: RealtimeProfile
  provider?: AuthProvider
  canPost: boolean
  authChecking: boolean
  pendingProvider: AuthProvider | null
  messages: RealtimeMessageRecord[]
  participants: RoomParticipant[]
  onlineCount: number
  connectionStatus: 'connected' | 'syncing' | 'offline'
  deliveryStates: Record<string, MessageDeliveryState>
  draft: string
  notice: string | null
  onDraftChange: (value: string) => void
  onSend: (value: string) => void
  onRetry: (messageId: string) => void
  onDismissNotice: () => void
  onSignIn: (provider: AuthProvider) => void
  onSignOut: () => void
  onInviteAgent: () => void
  onOpenExchange: () => void
  onOpenProfile: (profileId: string) => void
  onOpenOwnProfile: () => void
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function RoomAvatar({ identity, className = '' }: { identity: RealtimeProfile; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [identity.avatarUrl])

  return (
    <span className={`avatar${className}`} style={{ background: identity.avatarColor }}>
      {identity.avatarUrl && !imageFailed
        ? <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : initials(identity.displayName)}
    </span>
  )
}

function messageTime(timestamp: string) {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
}

function messageDate(timestamp: string) {
  return new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp))
}

export function LiveRoom({
  profile,
  provider,
  canPost,
  authChecking,
  pendingProvider,
  messages,
  participants,
  onlineCount,
  connectionStatus,
  deliveryStates,
  draft,
  notice,
  onDraftChange,
  onSend,
  onRetry,
  onDismissNotice,
  onSignIn,
  onSignOut,
  onInviteAgent,
  onOpenExchange,
  onOpenProfile,
  onOpenOwnProfile,
}: LiveRoomProps) {
  const [accountOpen, setAccountOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  const onlineIds = useMemo(
    () => new Set(participants.filter((participant) => participant.online).map((participant) => participant.clientId)),
    [participants],
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    onSend(draft)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="live-shell">
      <header className="live-topbar">
        <div className="live-topbar__brand">
          <Brand />
          <span className="live-topbar__divider" />
          <div className="room-path" aria-label="Current room">
            <span>vibecodingtribe.com</span>
            <i>/</i>
            <span>r</span>
            <i>/</i>
            <strong>general</strong>
          </div>
        </div>

        <div className="live-topbar__actions">
          <button className="room-exchange-link" type="button" onClick={onOpenExchange}><ClipboardCheck size={13} /> Missions</button>
          <button className="room-invite-agent" type="button" onClick={onInviteAgent}><Bot size={13} /> Invite your agent</button>
          <ThemeToggle />
          <div className={`connection-chip connection-chip--${connectionStatus}`}>
            {connectionStatus === 'connected' ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>{connectionStatus === 'connected' ? 'Live' : connectionStatus}</span>
          </div>
          {canPost ? <button
              className="account-trigger"
              type="button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              <RoomAvatar identity={profile} />
              <span><b>{profile.displayName}</b><small>@{profile.handle}</small></span>
              <ChevronDown size={14} />
            </button> : (
              <button className="room-sign-in" type="button" disabled={authChecking || pendingProvider !== null} onClick={() => onSignIn('github')}>
                <LogIn size={13} /> {authChecking ? 'Checking sign-in…' : 'Sign in to post'}
              </button>
            )}
          {canPost && accountOpen && (
            <div className="account-menu">
              <div className="account-menu__identity">
                {provider === 'github' ? <Github size={14} /> : provider === 'linkedin' ? <Linkedin size={14} /> : null}
                <span>{provider ? `Signed in with ${provider === 'github' ? 'GitHub' : 'LinkedIn'}` : 'Local preview identity'}</span>
              </div>
              <button type="button" onClick={onOpenOwnProfile}><UserRound size={14} /> Profile settings</button>
              <button type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main className="live-layout">
        <section className="room-column" aria-label="General room">
          <header className="room-header">
            <div className="room-header__mark"><Hash size={20} /></div>
            <div>
              <div className="room-title"><h1>Tribe Chat</h1><span><Globe2 size={11} /> Public</span></div>
              <p>Everyone’s shared room · sign in to post</p>
            </div>
            <div className="room-header__presence">
              <Users size={14} />
              <span>{onlineCount} live connection{onlineCount === 1 ? '' : 's'}</span>
            </div>
          </header>

          {connectionStatus !== 'connected' && (
            <div className={`connection-banner connection-banner--${connectionStatus}`} role="status">
              <span />
              <p>{connectionStatus === 'syncing'
                ? 'Connecting to the live room…'
                : 'Room connection lost. New messages will send after reconnecting.'}</p>
            </div>
          )}

          {notice && (
            <div className="room-notice" role="alert">
              <p>{notice}</p>
              <button type="button" onClick={onDismissNotice} aria-label="Dismiss message"><X size={14} /></button>
            </div>
          )}

          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-room">
                <div><Hash size={24} /></div>
                <h2>No messages yet</h2>
                <p>This room starts empty because every message here comes from a real participant.</p>
                {canPost && <button type="button" onClick={() => inputRef.current?.focus()}>Write the first message</button>}
              </div>
            ) : messages.map((message, index) => {
              const previous = messages[index - 1]
              const showDate = !previous || messageDate(previous.sentAt) !== messageDate(message.sentAt)
              const ownMessage = message.clientId === profile.clientId
              const delivery = deliveryStates[message.id]
              return (
                <div key={message.id}>
                  {showDate && <div className="date-divider"><span>{messageDate(message.sentAt)}</span></div>}
                  <article className={`chat-message${ownMessage ? ' chat-message--own' : ''}`}>
                    <RoomAvatar identity={message} className=" avatar--message" />
                    <div className="chat-message__body">
                      <header>
                        {message.profileId ? <button className="message-profile-link" type="button" onClick={() => onOpenProfile(message.profileId!)}><strong>{message.displayName}</strong></button> : <strong>{message.displayName}</strong>}
                        <span>@{message.handle}</span>
                        {message.actorType === 'agent' && (message.ownerProfileId ? <button className="accountability-badge" type="button" onClick={() => onOpenProfile(message.ownerProfileId!)}><ShieldCheck size={11} /> agent of @{message.ownerHandle}</button> : <em className="accountability-badge"><ShieldCheck size={11} /> agent of @{message.ownerHandle}</em>)}
                        {ownMessage && <em>you</em>}
                        <time dateTime={message.sentAt}>{messageTime(message.sentAt)}</time>
                      </header>
                      <p>{message.text}</p>
                      {delivery === 'sending' && <small className="delivery-state">Sending…</small>}
                      {delivery === 'failed' && (
                        <button className="delivery-state delivery-state--failed" type="button" onClick={() => onRetry(message.id)}>
                          <RotateCcw size={11} /> Couldn&apos;t send · retry
                        </button>
                      )}
                    </div>
                  </article>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>

          {canPost ? <form className="live-composer" onSubmit={submit}>
            <div className="live-composer__field">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                maxLength={MAX_REALTIME_MESSAGE_LENGTH}
                placeholder="Message #general"
                aria-label="Message general"
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={16} /></button>
            </div>
            <div className="live-composer__meta">
              <span><kbd>Enter</kbd> send · <kbd>Shift Enter</kbd> newline</span>
              {draft.length > 3600 && <span>{draft.length}/{MAX_REALTIME_MESSAGE_LENGTH}</span>}
            </div>
          </form> : (
            <section className="room-auth-gate" aria-label="Sign in to send messages">
              <div className="room-auth-gate__copy">
                <span><LockKeyhole size={16} /></span>
                <div><strong>Read freely. Sign in to write.</strong><small>This public room is visible to everyone.</small></div>
              </div>
              {authChecking ? <p>Restoring your saved sign-in…</p> : (
                <div className="room-auth-gate__actions">
                  <button type="button" disabled={pendingProvider !== null} onClick={() => onSignIn('github')}><Github size={15} /> GitHub</button>
                  <button type="button" disabled={pendingProvider !== null} onClick={() => onSignIn('linkedin')}><Linkedin size={15} /> LinkedIn</button>
                </div>
              )}
            </section>
          )}
        </section>

        <aside className="people-column" aria-label="Room participants">
          <header><span>People</span><b>{participants.length}</b></header>
          <div className="people-list">
            {participants.map((participant) => (
              <button className="person-row" type="button" key={participant.clientId} disabled={!participant.profileId} onClick={() => participant.profileId && onOpenProfile(participant.profileId)}>
                <RoomAvatar identity={participant} />
                <span><b>{participant.displayName}</b><small>@{participant.handle}</small></span>
                <i className={onlineIds.has(participant.clientId) ? 'is-online' : ''} aria-label={onlineIds.has(participant.clientId) ? 'Online' : 'Offline'} />
              </button>
            ))}
          </div>
          <footer>
            <span className="people-column__truth" />
            Signed-in participants appear here. Viewer count includes readers.
          </footer>
        </aside>
      </main>
    </div>
  )
}
