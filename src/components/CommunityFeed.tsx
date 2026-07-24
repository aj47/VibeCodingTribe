import {
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Bot,
  ChevronDown,
  ExternalLink,
  Github,
  Home,
  Heart,
  ImagePlus,
  Link2,
  Linkedin,
  LoaderCircle,
  MessageCircle,
  Radio,
  Rocket,
  Send,
  Share2,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import type { AuthProvider } from '../auth/types'
import { COMMUNITY_INTENTS, type CommunityPostInput, type CommunityPostIntent } from '../community/types'
import type { RealtimeMessageRecord, RealtimeProfile } from '../realtime/protocol'
import { validateCommunityImage } from '../services/media'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

interface CommunityFeedProps {
  profile: RealtimeProfile
  provider?: AuthProvider
  authError?: string | null
  canPost: boolean
  authChecking: boolean
  messages: RealtimeMessageRecord[]
  participants: Array<RealtimeProfile & { online: boolean }>
  onlineCount: number
  connectionStatus: 'connected' | 'syncing' | 'offline'
  missionsOnly: boolean
  onSend: (input: CommunityPostInput) => void
  onToggleLike: (messageId: string, liked: boolean) => void
  onUploadImage: (file: File) => Promise<string>
  onSignIn: (provider: AuthProvider) => void
  localPreviewAvailable?: boolean
  onStartLocalPreview?: () => void
  onSignOut: () => void
  onOpenFeed: () => void
  onOpenMissions: () => void
  onOpenProfile: (profileId: string) => void
  onOpenOwnProfile: () => void
  onInviteAgent: () => void
}

interface PastedImage {
  file: File
  previewUrl: string
}

type CommunityPostKind = 'chat' | 'showcase' | 'feedback'

const POST_META: Record<CommunityPostKind, { label: string; context: string; icon: typeof Radio }> = {
  chat: { label: 'Chat', context: 'Community conversation', icon: MessageCircle },
  showcase: { label: 'Showcase', context: 'Build in public', icon: Rocket },
  feedback: { label: 'Feedback request', context: 'Open · needs your eyes', icon: Radio },
}

function postKind(message: Pick<RealtimeMessageRecord, 'intent'>): CommunityPostKind {
  if (message.intent === 'needs_feedback') return 'feedback'
  if (message.intent === 'showcase' || message.intent === 'update') return 'showcase'
  return 'chat'
}

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function relativeTime(timestamp: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function Avatar({ item }: { item: Pick<RealtimeProfile, 'displayName' | 'avatarColor' | 'avatarUrl'> }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [item.avatarUrl])

  return <span className="community-avatar" style={{ background: item.avatarColor }}>
    {item.avatarUrl && !imageFailed
      ? <img src={item.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      : initials(item.displayName)}
  </span>
}

function PastedImagePreview({ image, onRemove }: { image: PastedImage; onRemove: () => void }) {
  return <div className="community-pasted-image">
    <img src={image.previewUrl} alt="Pasted image preview" />
    <span><strong>{image.file.name || 'Pasted image'}</strong><small>{Math.max(1, Math.round(image.file.size / 1024))} KB · ready to upload</small></span>
    <button type="button" aria-label="Remove pasted image" onClick={onRemove}><X size={15} /></button>
  </div>
}

export function CommunityFeed({
  profile,
  provider,
  authError,
  canPost,
  authChecking,
  messages,
  participants,
  onlineCount,
  connectionStatus,
  missionsOnly,
  onSend,
  onToggleLike,
  onUploadImage,
  onSignIn,
  localPreviewAvailable,
  onStartLocalPreview,
  onSignOut,
  onOpenFeed,
  onOpenMissions,
  onOpenProfile,
  onOpenOwnProfile,
  onInviteAgent,
}: CommunityFeedProps) {
  const [draft, setDraft] = useState('')
  const [intent, setIntent] = useState<CommunityPostIntent>(missionsOnly ? 'needs_feedback' : 'chat')
  const [buildOpen, setBuildOpen] = useState(false)
  const [buildName, setBuildName] = useState('')
  const [buildUrl, setBuildUrl] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [commentKind, setCommentKind] = useState<'reply' | 'feedback'>('feedback')
  const [accountOpen, setAccountOpen] = useState(false)
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null)
  const [replyImage, setReplyImage] = useState<PastedImage | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [replyImageError, setReplyImageError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishingReply, setPublishingReply] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (missionsOnly) setIntent('needs_feedback')
  }, [missionsOnly])

  useEffect(() => () => {
    if (pastedImage) URL.revokeObjectURL(pastedImage.previewUrl)
  }, [pastedImage])

  useEffect(() => () => {
    if (replyImage) URL.revokeObjectURL(replyImage.previewUrl)
  }, [replyImage])

  const topLevel = useMemo(() => messages
    .filter((message) => !message.parentId && (!missionsOnly || message.intent === 'needs_feedback'))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt)), [messages, missionsOnly])
  const replies = useMemo(() => {
    const grouped = new Map<string, RealtimeMessageRecord[]>()
    for (const message of messages) {
      if (!message.parentId) continue
      grouped.set(message.parentId, [...(grouped.get(message.parentId) ?? []), message])
    }
    return grouped
  }, [messages])
  const needsFeedback = useMemo(() => messages
    .filter((message) => !message.parentId && message.intent === 'needs_feedback')
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 4), [messages])
  const composerMeta = COMMUNITY_INTENTS.find((item) => item.value === intent) ?? COMMUNITY_INTENTS[0]

  function beginReply(parentId: string, nextKind: 'reply' | 'feedback' = 'reply') {
    setCommentKind(nextKind)
    setReply('')
    setReplyImage(null)
    setReplyImageError(null)
    setReplyingTo(parentId)
    requestAnimationFrame(() => replyRef.current?.focus())
  }

  function replyComposer(parentId: string, displayName: string) {
    if (replyingTo !== parentId) return null
    return <form className="community-reply-form" onSubmit={(event) => void publishReply(event, parentId)}><textarea ref={replyRef} aria-label={`Reply to ${displayName}`} placeholder="Leave useful feedback, ask a question, or paste an image…" value={reply} onPaste={(event) => capturePastedImage(event, 'reply')} onChange={(event) => setReply(event.target.value)} />{replyImage && <PastedImagePreview image={replyImage} onRemove={() => setReplyImage(null)} />}{replyImageError && <p className="community-image-error" role="alert">{replyImageError}</p>}<div><span><button className={commentKind === 'feedback' ? 'is-active' : ''} type="button" onClick={() => setCommentKind('feedback')}>Feedback</button><button className={commentKind === 'reply' ? 'is-active' : ''} type="button" onClick={() => setCommentKind('reply')}>Reply</button></span><button type="button" aria-label="Cancel reply" onClick={() => { setReplyingTo(null); setReplyImage(null); setReplyImageError(null) }}><X size={14} /></button><button className="community-publish" type="submit" disabled={(!reply.trim() && !replyImage) || publishingReply}>{publishingReply ? <LoaderCircle className="is-spinning" size={14} /> : 'Send'}</button></div></form>
  }

  function renderReply(item: RealtimeMessageRecord, depth = 0): ReactNode {
    if (depth > 12) return null
    const children = replies.get(item.id) ?? []
    return <div className={`community-reply community-reply--${item.commentKind === 'feedback' ? 'feedback' : 'reply'}`} key={item.id}>
      <button type="button" onClick={() => item.profileId && onOpenProfile(item.profileId)}><Avatar item={item} /></button>
      <div>
        <span><strong>{item.displayName}</strong> · {relativeTime(item.sentAt)} <em>{item.commentKind === 'feedback' ? 'Feedback' : 'Reply'}</em></span>
        {item.text && <p>{item.text}</p>}
        {item.imageUrl && <img className="community-reply-image" src={item.imageUrl} alt={item.text || 'Image shared in this response'} loading="lazy" />}
        <div className="community-reply-actions">
          <button className="community-reply-action" type="button" aria-label={`Reply to ${item.displayName}`} disabled={!canPost} onClick={() => beginReply(item.id)}><MessageCircle size={12} /> Reply</button>
          <button className="community-reply-like" type="button" disabled={!canPost} aria-pressed={item.likedByClientIds?.includes(profile.clientId) ?? false} aria-label={`${item.likedByClientIds?.includes(profile.clientId) ? 'Unlike' : 'Like'} response by ${item.displayName}`} title={canPost ? undefined : 'Sign in to like'} onClick={() => onToggleLike(item.id, !(item.likedByClientIds?.includes(profile.clientId) ?? false))}><Heart size={12} fill="currentColor" /> {item.likedByClientIds?.length ? item.likedByClientIds.length : 'Like'}</button>
        </div>
        {replyComposer(item.id, item.displayName)}
        {children.length > 0 && <div className="community-reply-children" aria-label={`Replies to ${item.displayName}`}>{children.map((child) => renderReply(child, depth + 1))}</div>}
      </div>
    </div>
  }

  function capturePastedImage(event: ClipboardEvent<HTMLTextAreaElement>, target: 'post' | 'reply') {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'))
    if (!imageItem) return
    event.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    const error = validateCommunityImage(file)
    if (error) {
      if (target === 'post') setImageError(error)
      else setReplyImageError(error)
      return
    }
    const text = event.clipboardData.getData('text/plain')
    if (text) {
      if (target === 'post') setDraft((current) => `${current}${text}`.slice(0, 4000))
      else setReply((current) => `${current}${text}`.slice(0, 4000))
    }
    const next = { file, previewUrl: URL.createObjectURL(file) }
    if (target === 'post') {
      setPastedImage(next)
      setImageError(null)
    } else {
      setReplyImage(next)
      setReplyImageError(null)
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if ((!draft.trim() && !pastedImage) || publishing) return
    setPublishing(true)
    setImageError(null)
    try {
      const imageUrl = pastedImage ? await onUploadImage(pastedImage.file) : undefined
      onSend({
        text: draft,
        intent,
        ...(buildName.trim() ? { buildName: buildName.trim() } : {}),
        ...(buildUrl.trim() ? { buildUrl: buildUrl.trim() } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      })
      setDraft('')
      setBuildName('')
      setBuildUrl('')
      setBuildOpen(false)
      setPastedImage(null)
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not upload the image. Try again.')
    } finally {
      setPublishing(false)
    }
  }

  async function publishReply(event: FormEvent, parentId: string) {
    event.preventDefault()
    if ((!reply.trim() && !replyImage) || publishingReply) return
    setPublishingReply(true)
    setReplyImageError(null)
    try {
      const imageUrl = replyImage ? await onUploadImage(replyImage.file) : undefined
      onSend({ text: reply, parentId, commentKind, ...(imageUrl ? { imageUrl } : {}) })
      setReply('')
      setReplyImage(null)
      setReplyingTo(null)
    } catch (error) {
      setReplyImageError(error instanceof Error ? error.message : 'Could not upload the image. Try again.')
    } finally {
      setPublishingReply(false)
    }
  }

  async function sharePost(message: RealtimeMessageRecord) {
    const url = `${window.location.origin}/?post=${encodeURIComponent(message.id)}`
    if (navigator.share) await navigator.share({ title: message.buildName || 'VibeCodingTribe update', text: message.text, url }).catch(() => undefined)
    else await navigator.clipboard?.writeText(url)
  }

  return <div className="community-shell">
    <header className="community-topbar">
      <div className="community-brand-button"><Brand /></div>
      <nav aria-label="Community navigation">
        <button className={!missionsOnly ? 'is-active' : ''} type="button" onClick={onOpenFeed}><Home size={15} /> Feed</button>
        <button className={missionsOnly ? 'is-active' : ''} type="button" onClick={onOpenMissions}><Radio size={15} /> Needs feedback</button>
      </nav>
      <div className="community-topbar__actions">
        <span className={`community-live community-live--${connectionStatus}`}><i />{connectionStatus === 'connected' ? `${onlineCount} live` : connectionStatus}</span>
        <ThemeToggle />
        <button type="button" className="community-icon-button" aria-label="Notifications"><Bell size={17} /></button>
        {canPost ? <div className="community-account">
          <button type="button" className="community-account__trigger" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}><Avatar item={profile} /><span>@{profile.handle}</span><ChevronDown size={13} /></button>
          {accountOpen && <div className="community-account__menu">
            <small>{provider === 'github' ? <Github size={13} /> : <Linkedin size={13} />} Signed in</small>
            <button type="button" onClick={onOpenOwnProfile}><UserRound size={14} /> Your profile</button>
            <button type="button" onClick={onInviteAgent}><Bot size={14} /> Invite your agent</button>
            <button type="button" onClick={onSignOut}>Sign out</button>
          </div>}
        </div> : <div className="community-auth-actions" aria-label="Sign in options">
          <button className="community-provider-signin" type="button" disabled={authChecking} onClick={() => onSignIn('github')}><Github size={14} /> GitHub</button>
          <button className="community-provider-signin" type="button" disabled={authChecking} onClick={() => onSignIn('linkedin')}><Linkedin size={14} /> LinkedIn</button>
          {localPreviewAvailable && <button className="community-preview-signin" type="button" onClick={onStartLocalPreview}>Local preview</button>}
        </div>}
      </div>
    </header>
    {authError && <div className="community-auth-error" role="alert">{authError}</div>}

    <main className="community-layout">
      <aside className="community-rail community-rail--left">
        <div className="community-rail__intro"><span>THE WORKSHOP IS OPEN</span><h2>Build in public.<br />Get unstuck together.</h2><p>Small updates count. Share the rough edge, not just the launch.</p></div>
        <nav aria-label="Explore">
          <button type="button" onClick={onOpenFeed}><Sparkles size={15} /> Latest builds</button>
          <button type="button" onClick={onOpenMissions}><Radio size={15} /> Needs feedback</button>
          <button type="button" onClick={onOpenOwnProfile}><BadgeCheck size={15} /> Your badges</button>
          <button type="button" onClick={onInviteAgent}><Bot size={15} /> Agent access</button>
        </nav>
      </aside>

      <section className="community-feed" aria-label={missionsOnly ? 'Posts needing feedback' : 'Community feed'}>
        <header className="community-feed__header">
          <div><span>{missionsOnly ? 'OPEN CALLS' : 'COMMUNITY PULSE'}</span><h1>{missionsOnly ? 'Builders who need your eyes' : 'What are you building?'}</h1></div>
          <span><Users size={14} /> {participants.length} builder{participants.length === 1 ? '' : 's'}</span>
        </header>

        {canPost ? <form className="community-composer" onSubmit={publish}>
          <Avatar item={profile} />
          <div className="community-composer__body">
            <div className="community-kind-picker" role="group" aria-label="Choose post type">
              {COMMUNITY_INTENTS.map((item) => {
                const KindIcon = item.value === 'chat' ? MessageCircle : item.value === 'showcase' ? Rocket : Radio
                return <button className={intent === item.value ? 'is-active' : ''} type="button" aria-label={`${item.label} — ${item.description}`} aria-pressed={intent === item.value} disabled={missionsOnly && item.value !== 'needs_feedback'} key={item.value} onClick={() => setIntent(item.value)}><KindIcon size={14} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>
              })}
            </div>
            <textarea aria-label="Share what you are building" maxLength={4000} placeholder={intent === 'needs_feedback' ? 'What do you need another builder to look at?' : intent === 'showcase' ? 'What did you build or ship?' : 'Say something to the tribe…'} value={draft} onPaste={(event) => capturePastedImage(event, 'post')} onChange={(event) => setDraft(event.target.value)} />
            {pastedImage && <PastedImagePreview image={pastedImage} onRemove={() => setPastedImage(null)} />}
            {imageError && <p className="community-image-error" role="alert">{imageError}</p>}
            {buildOpen && <div className="community-build-fields">
              <label>Build name<input maxLength={80} placeholder="Optional project name" value={buildName} onChange={(event) => setBuildName(event.target.value)} /></label>
              <label>Build link<input type="url" placeholder="https://" value={buildUrl} onChange={(event) => setBuildUrl(event.target.value)} /></label>
            </div>}
            <footer>
              <span className="community-composer-hint">Posting as <strong>{composerMeta.label}</strong><i><ImagePlus size={12} /> Paste an image</i></span>
              <div><button className="community-attach" type="button" aria-expanded={buildOpen} onClick={() => setBuildOpen((open) => !open)}><Link2 size={14} /> Attach build</button><button className="community-publish" type="submit" disabled={(!draft.trim() && !pastedImage) || publishing}>{publishing ? <><LoaderCircle className="is-spinning" size={14} /> Uploading</> : <><Send size={14} /> Post</>}</button></div>
            </footer>
          </div>
        </form> : <section className="community-join-card"><div><h2>The conversation is the product.</h2><p>{localPreviewAvailable ? 'Preview locally, or use either identity provider for the real community.' : 'Read everything. Join with whichever professional identity fits you.'}</p></div><div className="community-join-actions">
          <button type="button" onClick={() => onSignIn('github')}><Github size={15} /> Continue with GitHub</button>
          <button type="button" onClick={() => onSignIn('linkedin')}><Linkedin size={15} /> Continue with LinkedIn</button>
          {localPreviewAvailable && <button className="community-join-preview" type="button" onClick={onStartLocalPreview}>Start local preview <ArrowUpRight size={14} /></button>}
        </div></section>}

        <div className="community-posts">
          {topLevel.length === 0 ? <div className="community-empty"><Radio size={24} /><h2>{missionsOnly ? 'No one is stuck right now' : 'The workbench is quiet'}</h2><p>{missionsOnly ? 'Share a rough edge of your own or check back after the next build session.' : 'Real updates from builders will appear here—including the conversation that used to live in Tribe Chat.'}</p></div> : topLevel.map((message) => {
            const kind = postKind(message)
            const meta = POST_META[kind]
            const PostIcon = meta.icon
            const postReplies = replies.get(message.id) ?? []
            const feedbackCount = postReplies.filter((item) => item.commentKind === 'feedback').length
            return <article className={`community-post community-post--${kind}`} key={message.id}>
              <div className="community-post__typebar"><span><PostIcon size={13} /> {meta.label}</span><small>{meta.context}</small></div>
              <header>
                <button type="button" onClick={() => message.profileId && onOpenProfile(message.profileId)}><Avatar item={message} /></button>
                <div><button type="button" className="community-author" onClick={() => message.profileId && onOpenProfile(message.profileId)}>{message.displayName}</button><span>@{message.handle} · {relativeTime(message.sentAt)}</span></div>
                {kind === 'feedback' && <em className="community-feedback-count">{feedbackCount ? `${feedbackCount} feedback` : 'Awaiting feedback'}</em>}
              </header>
              {message.text && <p>{message.text}</p>}
              {message.imageUrl && <figure className="community-post-image"><img src={message.imageUrl} alt={message.text || 'Image shared with this post'} loading="lazy" /></figure>}
              {message.buildName && <a className="community-build-attachment" href={message.buildUrl || '#'} target={message.buildUrl ? '_blank' : undefined} rel="noreferrer"><span><Rocket size={18} /></span><div><small>ATTACHED BUILD</small><strong>{message.buildName}</strong></div>{message.buildUrl && <ExternalLink size={14} />}</a>}
              <footer>
                <button type="button" onClick={() => beginReply(message.id, kind === 'feedback' ? 'feedback' : 'reply')}><MessageCircle size={14} /> {postReplies.length ? `${postReplies.length} response${postReplies.length === 1 ? '' : 's'}` : kind === 'feedback' ? 'Give feedback' : 'Reply'}</button>
                <button className="community-like" type="button" disabled={!canPost} aria-pressed={message.likedByClientIds?.includes(profile.clientId) ?? false} aria-label={`${message.likedByClientIds?.includes(profile.clientId) ? 'Unlike' : 'Like'} post by ${message.displayName}`} title={canPost ? undefined : 'Sign in to like'} onClick={() => onToggleLike(message.id, !(message.likedByClientIds?.includes(profile.clientId) ?? false))}><Heart size={14} fill="currentColor" /> {message.likedByClientIds?.length ? message.likedByClientIds.length : 'Like'}</button>
                <button type="button" onClick={() => void sharePost(message)}><Share2 size={14} /> {kind === 'showcase' ? 'Share showcase' : kind === 'feedback' ? 'Share request' : 'Share'}</button>
              </footer>
              {postReplies.length > 0 && <div className="community-replies" aria-label={`Responses to ${message.displayName}`}>{postReplies.map((item) => renderReply(item))}</div>}
              {replyComposer(message.id, message.displayName)}
            </article>
          })}
        </div>
      </section>

      <aside className="community-rail community-rail--wire" aria-label="Tribe Wire">
        <header><div><i /><span>TRIBE WIRE</span></div><strong>Conversation, in context.</strong><p>This is the same community stream—not a separate chat room.</p></header>
        <section><h2>Needs a second pair of eyes</h2>{needsFeedback.length === 0 ? <p className="community-wire-empty">Fresh feedback requests will land here.</p> : needsFeedback.map((message) => <button type="button" key={message.id} onClick={onOpenMissions}><Avatar item={message} /><span><strong>{message.displayName}</strong><small>{message.text}</small></span><MessageCircle size={14} /></button>)}</section>
        <footer><span><i /> {onlineCount} live now</span><p>The feed updates as builders post.</p></footer>
      </aside>
    </main>
  </div>
}
