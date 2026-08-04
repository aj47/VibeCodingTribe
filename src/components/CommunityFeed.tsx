import {
  ArrowUpRight,
  Bell,
  Bot,
  ChevronDown,
  ExternalLink,
  Github,
  Heart,
  History,
  ImagePlus,
  Link2,
  Linkedin,
  LoaderCircle,
  Menu,
  MessageCircle,
  Pencil,
  Radio,
  Rocket,
  Send,
  Share2,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import type { AuthProvider } from '../auth/types'
import { type CommunityChannelId } from '../community/channels'
import { findActiveThreads, type ChannelActivityMap } from '../community/channel-navigation'
import { type CommunityPostInput, type CommunityPostIntent } from '../community/types'
import { extractFirstHttpUrl, type RealtimeMessageRecord, type RealtimeProfile } from '../realtime/protocol'
import { validateCommunityImage } from '../services/media'
import { type LocalReadState } from '../services/read-state'
import { Brand } from './Brand'
import { ChannelSidebar } from './ChannelSidebar'
import { ThemeToggle } from './ThemeToggle'

interface CommunityFeedProps {
  profile: RealtimeProfile
  provider?: AuthProvider
  authError?: string | null
  canPost: boolean
  authChecking: boolean
  messages: RealtimeMessageRecord[]
  messagesLoaded?: boolean
  participants: Array<RealtimeProfile & { online: boolean }>
  onlineCount: number
  connectionStatus: 'connected' | 'syncing' | 'offline'
  missionsOnly: boolean
  channelId: CommunityChannelId
  channelActivity: ChannelActivityMap
  readState: LocalReadState
  threadId?: string
  onSend: (input: CommunityPostInput) => void
  onToggleLike: (messageId: string, liked: boolean) => void
  onEditMessage: (messageId: string, text: string) => void
  onDeleteMessage: (messageId: string) => void
  onUploadImage: (file: File) => Promise<string>
  onSignIn: (provider: AuthProvider) => void
  localPreviewAvailable?: boolean
  onStartLocalPreview?: () => void
  onSignOut: () => void
  onOpenFeed: () => void
  onOpenMissions: () => void
  onOpenChannel: (channelId: CommunityChannelId) => void
  onOpenThread: (channelId: CommunityChannelId, parentId: string) => void
  onCloseThread?: () => void
  onReadThread: (channelId: CommunityChannelId, parentId: string, activityAt: string) => void
  onOpenProfile: (profileId: string) => void
  onOpenOwnProfile: () => void
  onOpenBadges: () => void
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

const REPLY_PREVIEW_CHARACTER_LIMIT = 420
const REPLY_PREVIEW_LINE_LIMIT = 6

function needsReplyPreview(value: string) {
  return value.trim().length > REPLY_PREVIEW_CHARACTER_LIMIT || value.split('\n').length > REPLY_PREVIEW_LINE_LIMIT
}

function postKind(message: Pick<RealtimeMessageRecord, 'intent'>): CommunityPostKind {
  if (message.intent === 'needs_feedback') return 'feedback'
  if (message.intent === 'showcase' || message.intent === 'update') return 'showcase'
  return 'chat'
}

function intentForChannel(channelId: CommunityChannelId): CommunityPostIntent {
  if (channelId === 'feedback') return 'needs_feedback'
  if (channelId === 'showcases') return 'showcase'
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

function absoluteTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function ownsMessage(message: RealtimeMessageRecord, profile: RealtimeProfile) {
  return Boolean((profile.profileId && message.profileId === profile.profileId) || message.clientId === profile.clientId)
}

function pointsLabel(points: number | undefined) {
  return `(+${Math.max(0, points ?? 0).toLocaleString()})`
}

function Avatar({ item }: { item: Pick<RealtimeProfile, 'displayName' | 'avatarColor' | 'avatarUrl'> }) {
  return <span className="community-avatar" style={{ background: item.avatarColor }}>
    <span aria-hidden="true">{initials(item.displayName)}</span>
    {item.avatarUrl && <img src={item.avatarUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
  </span>
}

function PastedImagePreview({ image, onRemove }: { image: PastedImage; onRemove: () => void }) {
  return <div className="community-pasted-image">
    <img src={image.previewUrl} alt="Pasted image preview" />
    <span><strong>{image.file.name || 'Pasted image'}</strong><small>{Math.max(1, Math.round(image.file.size / 1024))} KB · ready to upload</small></span>
    <button type="button" aria-label="Remove pasted image" onClick={onRemove}><X size={15} /></button>
  </div>
}

interface CommunityVideoLink {
  provider: string
  title: string
  kind: 'iframe' | 'video'
  src: string
}

function communityVideoLink(value: string | undefined): CommunityVideoLink | undefined {
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const youtubeId = host === 'youtu.be'
    ? url.pathname.split('/').filter(Boolean)[0]
    : ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
      ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,20})/)?.[1]
      : undefined
  if (youtubeId && /^[\w-]{6,20}$/.test(youtubeId)) {
    return { provider: 'YouTube', title: 'YouTube video', kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0` }
  }
  const vimeoId = host === 'player.vimeo.com'
    ? url.pathname.match(/^\/video\/(\d+)/)?.[1]
    : ['vimeo.com'].includes(host)
      ? url.pathname.match(/^\/(?:video\/)?(\d+)/)?.[1]
      : undefined
  if (vimeoId) return { provider: 'Vimeo', title: 'Vimeo video', kind: 'iframe', src: `https://player.vimeo.com/video/${vimeoId}` }
  const loomId = host === 'loom.com'
    ? url.pathname.match(/^\/(?:share|embed)\/([a-zA-Z0-9]+)$/)?.[1]
    : undefined
  if (loomId) return { provider: 'Loom', title: 'Loom video', kind: 'iframe', src: `https://www.loom.com/embed/${loomId}` }
  const dailymotionId = host === 'dai.ly'
    ? url.pathname.match(/^\/([a-zA-Z0-9]+)$/)?.[1]
    : host === 'dailymotion.com'
      ? url.pathname.match(/^\/video\/([a-zA-Z0-9]+)$/)?.[1]
      : undefined
  if (dailymotionId) return { provider: 'Dailymotion', title: 'Dailymotion video', kind: 'iframe', src: `https://www.dailymotion.com/embed/video/${dailymotionId}` }
  if (/\.(?:mp4|webm|ogg|m4v)(?:$|[?#])/i.test(url.pathname + url.search + url.hash)) {
    return { provider: 'Video file', title: 'Video preview', kind: 'video', src: url.toString() }
  }
  return undefined
}

function CommunityVideoLinkPreview({ href, video }: { href: string; video: CommunityVideoLink }) {
  return <section className="community-video-link-preview" aria-label={`${video.provider} video preview`}>
    <div className="community-video-link-preview__player">
      {video.kind === 'video'
        ? <video src={video.src} controls playsInline preload="metadata">Your browser cannot play this video.</video>
        : <iframe src={video.src} title={`${video.title} preview`} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" />}
    </div>
    <a className="community-video-link-preview__source" href={href} target="_blank" rel="noreferrer">
      <span><strong>{video.provider}</strong><small>INLINE VIDEO LINK</small></span>
      <div><b>{video.title}</b><small>{href}</small></div>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  </section>
}

function CommunityLinkPreview({ message }: { message: Pick<RealtimeMessageRecord, 'text' | 'buildName' | 'buildUrl' | 'linkPreview'> }) {
  const preview = message.linkPreview
  const href = preview?.url ?? message.buildUrl ?? extractFirstHttpUrl(message.text)
  if (!href) return null
  const video = communityVideoLink(href)
  if (video) return <CommunityVideoLinkPreview href={href} video={video} />
  let hostname = href
  try { hostname = new URL(href).hostname.replace(/^www\./, '') } catch { /* keep the full URL */ }
  const title = preview?.title ?? message.buildName ?? hostname
  const description = preview?.description
  const siteName = preview?.siteName ?? hostname
  return <a className="community-link-preview" href={href} target="_blank" rel="noreferrer" aria-label={`Open link preview for ${title}`}>
    {preview?.imageUrl && <div className="community-link-preview__image"><img src={preview.imageUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /></div>}
    <div className="community-link-preview__content">
      <span className="community-link-preview__site"><Link2 size={12} /> {siteName}</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      <small>{href}</small>
    </div>
    <ExternalLink className="community-link-preview__external" size={14} aria-hidden="true" />
  </a>
}

const MESSAGE_SKELETONS = [
  { kind: 'chat', lines: ['86%', '62%'] },
  { kind: 'showcase', lines: ['74%', '91%', '48%'] },
  { kind: 'feedback', lines: ['92%', '68%'] },
] as const

function CommunityMessageSkeleton() {
  return <div className="community-message-skeleton" role="status">
    <span className="sr-only">Loading messages…</span>
    <div aria-hidden="true">
      {MESSAGE_SKELETONS.map((item, index) => <article className={`community-skeleton-post community-skeleton-post--${item.kind}`} key={item.kind}>
        {item.kind !== 'chat' && <div className="community-skeleton-post__typebar"><span className="community-skeleton__shape" /><span className="community-skeleton__shape" /></div>}
        <header>
          <span className="community-skeleton__shape community-skeleton-post__avatar" />
          <div>
            <span className="community-skeleton__shape community-skeleton-post__author" style={{ width: index === 1 ? '112px' : '88px' }} />
            <span className="community-skeleton__shape community-skeleton-post__meta" style={{ width: index === 2 ? '132px' : '108px' }} />
          </div>
        </header>
        <div className="community-skeleton-post__copy">
          {item.lines.map((width) => <span className="community-skeleton__shape" style={{ width }} key={width} />)}
        </div>
        <footer>
          <span className="community-skeleton__shape" />
          <span className="community-skeleton__shape" />
          <span className="community-skeleton__shape" />
        </footer>
      </article>)}
    </div>
  </div>
}

export function CommunityFeed({
  profile,
  provider,
  authError,
  canPost,
  authChecking,
  messages,
  messagesLoaded,
  participants,
  onlineCount,
  connectionStatus,
  missionsOnly,
  channelId,
  channelActivity,
  readState,
  threadId,
  onSend,
  onToggleLike,
  onEditMessage,
  onDeleteMessage,
  onUploadImage,
  onSignIn,
  localPreviewAvailable,
  onStartLocalPreview,
  onSignOut,
  onOpenChannel,
  onOpenThread,
  onCloseThread = () => {},
  onReadThread,
  onOpenProfile,
  onOpenOwnProfile,
  onInviteAgent,
}: CommunityFeedProps) {
  const [draft, setDraft] = useState('')
  const [intent, setIntent] = useState<CommunityPostIntent>(() => missionsOnly ? 'needs_feedback' : intentForChannel(channelId))
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
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [historyMessageId, setHistoryMessageId] = useState<string | null>(null)
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null)
  const [expandedReplyIds, setExpandedReplyIds] = useState<Set<string>>(() => new Set())
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const modalCloseRef = useRef<HTMLButtonElement>(null)
  const threadDrawerCloseRef = useRef<HTMLButtonElement>(null)
  const channelPickerButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setIntent(missionsOnly ? 'needs_feedback' : intentForChannel(channelId))
  }, [channelId, missionsOnly])

  useEffect(() => {
    if (!channelPickerOpen) channelPickerButtonRef.current?.focus()
  }, [channelPickerOpen])

  useEffect(() => {
    if (editingMessageId) editRef.current?.focus()
  }, [editingMessageId])

  useEffect(() => {
    if (!historyMessageId && !deleteMessageId) return
    modalCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHistoryMessageId(null)
      setDeleteMessageId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleteMessageId, historyMessageId])

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
    const messagesById = new Map(messages.map((message) => [message.id, message]))
    for (const message of messages) {
      if (!message.parentId) continue
      let rootId = message.parentId
      const visited = new Set([message.id])
      while (rootId) {
        if (visited.has(rootId)) break
        visited.add(rootId)
        const parent = messagesById.get(rootId)
        if (!parent?.parentId) break
        rootId = parent.parentId
      }
      grouped.set(rootId, [...(grouped.get(rootId) ?? []), message])
    }
    return grouped
  }, [messages])
  const threadRoot = useMemo(() => threadId ? topLevel.find((message) => message.id === threadId) : undefined, [threadId, topLevel])
  const threadReplies = useMemo(() => threadRoot ? replies.get(threadRoot.id) ?? [] : [], [replies, threadRoot])
  const threadKind = threadRoot ? postKind(threadRoot) : undefined
  const threadFeedbackCount = threadReplies.filter((item) => item.commentKind === 'feedback').length

  useEffect(() => {
    if (!threadRoot) return
    setReplyingTo(threadRoot.id)
    setCommentKind(threadKind === 'feedback' ? 'feedback' : 'reply')
  }, [threadKind, threadRoot])

  useEffect(() => {
    if (!threadRoot) return
    threadDrawerCloseRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseThread()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onCloseThread, threadRoot])
  const activeThreads = useMemo(() => findActiveThreads(messages, channelId), [channelId, messages])
  const initialMessagesLoaded = messagesLoaded ?? connectionStatus !== 'syncing'
  const messagesLoading = !initialMessagesLoaded && messages.length === 0 && connectionStatus !== 'offline'
  useEffect(() => {
    if (!threadId || !replies.has(threadId)) return
    const latestReply = [...(replies.get(threadId) ?? [])].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
    if (latestReply) onReadThread(channelId, threadId, latestReply.sentAt)
  }, [channelId, onReadThread, replies, threadId])

  function openThread(channel: CommunityChannelId, parentId: string) {
    const thread = channel === channelId ? activeThreads.find((item) => item.parentId === parentId) : undefined
    if (thread) onReadThread(channel, parentId, thread.latestActivity)
    onOpenThread(channel, parentId)
    setChannelPickerOpen(false)
  }

  function openPostThread(message: RealtimeMessageRecord) {
    const postReplies = replies.get(message.id) ?? []
    const latestReply = [...postReplies].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
    if (latestReply) onReadThread(channelId, message.id, latestReply.sentAt)
    onOpenThread(channelId, message.id)
    setCommentKind(postKind(message) === 'feedback' ? 'feedback' : 'reply')
    setReply('')
    setReplyImage(null)
    setReplyImageError(null)
    setReplyingTo(message.id)
  }

  function closeThread() {
    setReplyingTo(null)
    setReply('')
    setReplyImage(null)
    setReplyImageError(null)
    onCloseThread()
  }

  function toggleExpandedReply(messageId: string) {
    setExpandedReplyIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
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
    if (!draft.trim() && !pastedImage && !buildUrl.trim()) return
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
      if (!threadId) setReplyingTo(null)
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

  function beginEditing(message: RealtimeMessageRecord) {
    setEditingMessageId(message.id)
    setEditDraft(message.text)
  }

  function saveEdit(event: FormEvent, message: RealtimeMessageRecord) {
    event.preventDefault()
    const text = editDraft.trim()
    if (text === message.text || (!text && !message.imageUrl && !message.buildUrl)) return
    onEditMessage(message.id, text)
    setEditingMessageId(null)
    setEditDraft('')
  }

  function insertFeedbackOutline() {
    if (reply.trim()) return
    setCommentKind('feedback')
    setReply('What works:\n\nWhat could be clearer:\n\nOne next step:\n')
    requestAnimationFrame(() => replyRef.current?.focus())
  }

  function renderReplyForm(parentId: string, parentDisplayName: string, drawer = false) {
    return <form className={`community-reply-form${drawer ? ' community-reply-form--drawer' : ''}`} onSubmit={(event) => void publishReply(event, parentId)}>
      {commentKind === 'feedback' && <div className="community-feedback-guide">
        <div><strong>Make it actionable</strong><span>What works · what’s unclear · one next step</span></div>
        <button type="button" disabled={Boolean(reply.trim())} onClick={insertFeedbackOutline}>Use outline</button>
      </div>}
      <textarea ref={replyRef} aria-label={`${commentKind === 'feedback' ? 'Give feedback on' : 'Reply to'} ${parentDisplayName}`} placeholder={commentKind === 'feedback' ? 'Share what works, what is unclear, and one next step…' : 'Reply to the conversation or paste an image…'} value={reply} onPaste={(event) => capturePastedImage(event, 'reply')} onChange={(event) => setReply(event.target.value)} />
      {replyImage && <PastedImagePreview image={replyImage} onRemove={() => setReplyImage(null)} />}
      {replyImageError && <p className="community-image-error" role="alert">{replyImageError}</p>}
      <div><span><button className={commentKind === 'feedback' ? 'is-active' : ''} type="button" onClick={() => setCommentKind('feedback')}>Feedback</button><button className={commentKind === 'reply' ? 'is-active' : ''} type="button" onClick={() => setCommentKind('reply')}>Reply</button></span><button type="button" aria-label="Cancel reply" onClick={drawer ? closeThread : () => { setReplyingTo(null); setReplyImage(null); setReplyImageError(null) }}><X size={14} /></button><button className="community-publish" type="submit" disabled={(!reply.trim() && !replyImage) || publishingReply}>{publishingReply ? <LoaderCircle className="is-spinning" size={14} /> : 'Send'}</button></div>
    </form>
  }

  function renderReply(item: RealtimeMessageRecord, full = false) {
    const canCollapse = Boolean(item.text && needsReplyPreview(item.text))
    const expanded = full || expandedReplyIds.has(item.id)
    return <div className={`community-reply community-reply--${item.commentKind === 'feedback' ? 'feedback' : 'reply'}`} key={item.id}>
      <button type="button" onClick={() => item.profileId && onOpenProfile(item.profileId)}><Avatar item={item} /></button>
      <div>
        <div className="community-reply__meta"><span><strong>{item.displayName} <span className="community-reply-points">{pointsLabel(item.points)}</span></strong> · {relativeTime(item.sentAt)}{item.editedAt && !item.deletedAt ? ' · edited' : ''} <em>{item.commentKind === 'feedback' ? 'Feedback' : 'Reply'}</em></span><span className="community-reply__actions">{!!item.revisions?.length && <button type="button" onClick={() => setHistoryMessageId(item.id)}><History size={11} /> History</button>}{ownsMessage(item, profile) && !item.deletedAt && <><button type="button" onClick={() => beginEditing(item)}><Pencil size={11} /> Edit</button><button className="is-destructive" type="button" onClick={() => setDeleteMessageId(item.id)}><Trash2 size={11} /> Remove</button></>}</span></div>
        {item.deletedAt ? <div className="community-reply-removed"><Trash2 size={13} /><span>Response removed by its author. <button type="button" onClick={() => setHistoryMessageId(item.id)}>View history</button></span></div> : editingMessageId === item.id ? <form className="community-message-editor community-message-editor--reply" onSubmit={(event) => saveEdit(event, item)}><label htmlFor={`edit-${item.id}`}>Edit response</label><textarea ref={editRef} id={`edit-${item.id}`} maxLength={4000} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} /><div><small>Previous versions stay public.</small><button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button><button className="community-publish" type="submit" disabled={editDraft.trim() === item.text || (!editDraft.trim() && !item.imageUrl)}>Save changes</button></div></form> : <>
          {item.text && <div className={`community-reply-copy${canCollapse && !expanded ? ' is-collapsed' : ''}`}><p className="community-reply-body">{item.text}</p></div>}
          {canCollapse && !full && <button className="community-reply-expand" type="button" aria-expanded={expanded} onClick={() => toggleExpandedReply(item.id)}>{expanded ? 'Show less' : 'Read full feedback'}</button>}
          {item.imageUrl && <img className="community-reply-image" src={item.imageUrl} alt={item.text || 'Image shared in this response'} loading="lazy" />}
          <button className="community-reply-like" type="button" disabled={!canPost} aria-pressed={item.likedByClientIds?.includes(profile.clientId) ?? false} aria-label={`${item.likedByClientIds?.includes(profile.clientId) ? 'Unlike' : 'Like'} response by ${item.displayName}`} title={canPost ? undefined : 'Sign in to like'} onClick={() => onToggleLike(item.id, !(item.likedByClientIds?.includes(profile.clientId) ?? false))}><Heart size={12} fill="currentColor" /> {item.likedByClientIds?.length ? item.likedByClientIds.length : 'Like'}</button>
        </>}
      </div>
    </div>
  }

  const historyMessage = historyMessageId ? messages.find((message) => message.id === historyMessageId) ?? null : null
  const deleteMessage = deleteMessageId ? messages.find((message) => message.id === deleteMessageId) ?? null : null
  const historyVersions = historyMessage ? [
    ...(historyMessage.deletedAt ? [] : [{
      revision: (historyMessage.revisions?.length ?? 0) + 1,
      createdAt: historyMessage.editedAt ?? historyMessage.sentAt,
      text: historyMessage.text,
      buildName: historyMessage.buildName,
      buildUrl: historyMessage.buildUrl,
      imageUrl: historyMessage.imageUrl,
      current: true,
    }]),
    ...[...(historyMessage.revisions ?? [])].reverse().map((revision) => ({ ...revision, current: false })),
  ] : []

  return <div className="community-shell">
    <header className="community-topbar">
      <div className="community-brand-button"><Brand /></div>
      <button ref={channelPickerButtonRef} className="community-mobile-channels" type="button" aria-label="Open channels" aria-expanded={channelPickerOpen} onClick={() => setChannelPickerOpen(true)}><Menu size={18} /><span>#{channelId}</span></button>
      <nav aria-label="Community navigation">
        <button type="button" onClick={onInviteAgent}><Bot size={15} /> Agent access</button>
      </nav>
      <div className="community-topbar__actions">
        <span className={`community-live community-live--${connectionStatus}`}><i />{connectionStatus === 'connected' ? `${onlineCount} live` : connectionStatus}</span>
        <ThemeToggle />
        <button type="button" className="community-icon-button" aria-label="Email and notification settings" title="Email and notification settings" onClick={onOpenOwnProfile}><Bell size={17} /></button>
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

    {channelPickerOpen && <div className="community-mobile-channel-picker" role="dialog" aria-modal="true" aria-label="Choose a channel">
      <div className="community-mobile-channel-picker__backdrop" onClick={() => setChannelPickerOpen(false)} />
      <section className="community-mobile-channel-picker__panel">
        <header><div><span>WORKSHOP ROOMS</span><strong>Choose a channel</strong></div><button type="button" aria-label="Close channels" onClick={() => setChannelPickerOpen(false)}><X size={18} /></button></header>
        <ChannelSidebar selectedChannelId={channelId} activity={channelActivity} messages={messages} readState={readState} onSelectChannel={(nextChannelId) => { onOpenChannel(nextChannelId); setChannelPickerOpen(false) }} onOpenThread={openThread} onReadThread={onReadThread} autoFocusSearch />
      </section>
    </div>}

    <main className="community-layout">
      <aside className="community-rail community-rail--left">
        <div className="community-rail__intro"><span>THE WORKSHOP IS OPEN</span><h2>Build in public.<br />Get unstuck together.</h2><p>Small updates count. Share the rough edge, not just the launch.</p></div>
        <ChannelSidebar selectedChannelId={channelId} activity={channelActivity} messages={messages} readState={readState} onSelectChannel={onOpenChannel} onOpenThread={openThread} onReadThread={onReadThread} />
      </aside>

      <section className="community-feed" aria-label={missionsOnly ? 'Posts needing feedback' : 'Community feed'}>
        <header className="community-feed__header">
          <div><span>{missionsOnly ? 'OPEN CALLS' : 'COMMUNITY PULSE'}</span><h1>{missionsOnly ? 'Builders who need your eyes' : 'What are you building?'}</h1></div>
          <span><Users size={14} /> {participants.length} builder{participants.length === 1 ? '' : 's'}</span>
        </header>

        {canPost ? <form className="community-composer" onSubmit={publish}>
          <Avatar item={profile} />
          <div className="community-composer__body">
            <textarea aria-label="Share what you are building" maxLength={4000} placeholder={intent === 'needs_feedback' ? 'What do you need another builder to look at?' : intent === 'showcase' ? 'What did you build or ship?' : 'Share a session update with the tribe…'} value={draft} onPaste={(event) => capturePastedImage(event, 'post')} onChange={(event) => setDraft(event.target.value)} />
            {pastedImage && <PastedImagePreview image={pastedImage} onRemove={() => setPastedImage(null)} />}
            {imageError && <p className="community-image-error" role="alert">{imageError}</p>}
            {buildOpen && <div className="community-build-fields">
              <label>Build name<input maxLength={80} placeholder="Optional project name" value={buildName} onChange={(event) => setBuildName(event.target.value)} /></label>
              <label>Build link<input type="url" placeholder="https://" value={buildUrl} onChange={(event) => setBuildUrl(event.target.value)} /></label>
            </div>}
            <footer>
              <span className="community-composer-hint">Posting to <strong>#{channelId}</strong><i><ImagePlus size={12} /> Paste an image</i></span>
              <div><button className="community-attach" type="button" aria-expanded={buildOpen} onClick={() => setBuildOpen((open) => !open)}><Link2 size={14} /> Attach build</button><button className="community-publish" type="submit" disabled={(!draft.trim() && !pastedImage) || publishing}>{publishing ? <><LoaderCircle className="is-spinning" size={14} /> Uploading</> : <><Send size={14} /> Post</>}</button></div>
            </footer>
          </div>
        </form> : <section className="community-join-card"><div><h2>The conversation is the product.</h2><p>{localPreviewAvailable ? 'Preview locally, or use either identity provider for the real community.' : 'Read everything. Join with whichever professional identity fits you.'}</p></div><div className="community-join-actions">
          <button type="button" onClick={() => onSignIn('github')}><Github size={15} /> Continue with GitHub</button>
          <button type="button" onClick={() => onSignIn('linkedin')}><Linkedin size={15} /> Continue with LinkedIn</button>
          {localPreviewAvailable && <button className="community-join-preview" type="button" onClick={onStartLocalPreview}>Start local preview <ArrowUpRight size={14} /></button>}
        </div></section>}

        <div className="community-posts" aria-busy={messagesLoading}>
          {messagesLoading ? <CommunityMessageSkeleton /> : topLevel.length === 0 ? <div className="community-empty"><Radio size={24} /><h2>{missionsOnly ? 'No one is stuck right now' : 'The workbench is quiet'}</h2><p>{missionsOnly ? 'Share a rough edge of your own or check back after the next build session.' : 'Real updates from builders will appear here—including the conversation that used to live in Tribe Chat.'}</p></div> : topLevel.map((message) => {
            const kind = postKind(message)
            const meta = POST_META[kind]
            const PostIcon = meta.icon
            const postReplies = replies.get(message.id) ?? []
            const renderedReplies: Array<RealtimeMessageRecord | null> = postReplies.length > 3
              ? [postReplies[0]!, null, ...postReplies.slice(-2)]
              : postReplies
            const hiddenReplyCount = postReplies.length - renderedReplies.filter(Boolean).length
            const feedbackCount = postReplies.filter((item) => item.commentKind === 'feedback').length
            return <article
              className={`community-post community-post--${kind}${threadId === message.id ? ' is-thread-focused' : ''}`}
              data-thread-id={message.id}
              key={message.id}
              tabIndex={threadId === message.id ? -1 : undefined}
            >
              <div className="community-post__typebar"><span><PostIcon size={13} /> {meta.label}</span><small>{meta.context}</small></div>
              <header>
                <button type="button" onClick={() => message.profileId && onOpenProfile(message.profileId)}><Avatar item={message} /></button>
                <div><button type="button" className="community-author" onClick={() => message.profileId && onOpenProfile(message.profileId)}>{message.displayName} <span className="community-author-points">{pointsLabel(message.points)}</span></button><span>@{message.handle} · {relativeTime(message.sentAt)}{message.editedAt && !message.deletedAt ? ' · edited' : ''}</span></div>
                <div className="community-post__header-actions">
                  {kind === 'feedback' && !message.deletedAt && <em className="community-feedback-count">{feedbackCount ? `${feedbackCount} feedback` : 'Awaiting feedback'}</em>}
                  {!!message.revisions?.length && <button type="button" onClick={() => setHistoryMessageId(message.id)}><History size={12} /> History</button>}
                  {ownsMessage(message, profile) && !message.deletedAt && <><button type="button" onClick={() => beginEditing(message)}><Pencil size={12} /> Edit</button><button className="is-destructive" type="button" onClick={() => setDeleteMessageId(message.id)}><Trash2 size={12} /> Remove</button></>}
                </div>
              </header>
              {message.deletedAt ? <div className="community-message-removed"><Trash2 size={17} /><div><strong>Post removed by its author</strong><span>The public revision history remains available for transparency.</span></div><button type="button" onClick={() => setHistoryMessageId(message.id)}><History size={13} /> View history</button></div> : editingMessageId === message.id ? <form className="community-message-editor community-message-editor--post" onSubmit={(event) => saveEdit(event, message)}><label htmlFor={`edit-${message.id}`}>Edit post</label><textarea ref={editRef} id={`edit-${message.id}`} maxLength={4000} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} /><div><small>Previous versions stay public.</small><button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button><button className="community-publish" type="submit" disabled={editDraft.trim() === message.text || (!editDraft.trim() && !message.imageUrl && !message.buildUrl)}>Save changes</button></div></form> : <>
                {message.text && <p>{message.text}</p>}
                {message.imageUrl && <figure className="community-post-image"><img src={message.imageUrl} alt={message.text || 'Image shared with this post'} loading="lazy" /></figure>}
                {(message.linkPreview || message.buildUrl || extractFirstHttpUrl(message.text)) && <CommunityLinkPreview message={message} />}
                {message.buildName && <a className="community-build-attachment" href={message.buildUrl || '#'} target={message.buildUrl ? '_blank' : undefined} rel="noreferrer"><span><Rocket size={18} /></span><div><small>ATTACHED BUILD</small><strong>{message.buildName}</strong></div>{message.buildUrl && <ExternalLink size={14} />}</a>}
              </>}
              {!message.deletedAt && <footer>
                <button type="button" onClick={() => openPostThread(message)}><MessageCircle size={14} /> {postReplies.length ? `${kind === 'feedback' ? 'View ' : ''}${postReplies.length} response${postReplies.length === 1 ? '' : 's'}` : kind === 'feedback' ? 'Give feedback' : 'Reply'}</button>
                <button className="community-like" type="button" disabled={!canPost} aria-pressed={message.likedByClientIds?.includes(profile.clientId) ?? false} aria-label={`${message.likedByClientIds?.includes(profile.clientId) ? 'Unlike' : 'Like'} post by ${message.displayName}`} title={canPost ? undefined : 'Sign in to like'} onClick={() => onToggleLike(message.id, !(message.likedByClientIds?.includes(profile.clientId) ?? false))}><Heart size={14} fill="currentColor" /> {message.likedByClientIds?.length ? message.likedByClientIds.length : 'Like'}</button>
                <button type="button" onClick={() => void sharePost(message)}><Share2 size={14} /> {kind === 'showcase' ? 'Share showcase' : kind === 'feedback' ? 'Share request' : 'Share'}</button>
              </footer>}
              {postReplies.length > 0 && threadId !== message.id && <div className="community-replies" aria-label={`Responses to ${message.displayName}`}>{renderedReplies.map((item) => item ? renderReply(item) : <button className="community-replies__hidden" key={`${message.id}-hidden`} type="button" onClick={() => openPostThread(message)} aria-label={`View ${hiddenReplyCount} more response${hiddenReplyCount === 1 ? '' : 's'}`}><ChevronDown size={13} /> View {hiddenReplyCount} more response{hiddenReplyCount === 1 ? '' : 's'}</button>)}</div>}
              {!message.deletedAt && !threadId && replyingTo === message.id && renderReplyForm(message.id, message.displayName)}
            </article>
          })}
        </div>
      </section>

    </main>
    {threadRoot && threadKind && <div className="community-thread-drawer" role="presentation">
      <button className="community-thread-drawer__backdrop" type="button" aria-label="Close thread" onClick={closeThread} />
      <aside className="community-thread-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="community-thread-title">
        <header className="community-thread-drawer__header">
          <div><span><MessageCircle size={14} /> {threadKind === 'feedback' ? 'FEEDBACK THREAD' : 'CONVERSATION THREAD'}</span><h2 id="community-thread-title">{threadKind === 'feedback' ? 'Review this request' : 'Follow the conversation'}</h2><p>{threadKind === 'feedback' ? `${threadFeedbackCount ? `${threadFeedbackCount} feedback` : 'No feedback yet'} · ${threadReplies.length} total response${threadReplies.length === 1 ? '' : 's'}` : `${threadReplies.length} response${threadReplies.length === 1 ? '' : 's'} in this thread`}</p></div>
          <button ref={threadDrawerCloseRef} type="button" aria-label="Close thread" onClick={closeThread}><X size={18} /></button>
        </header>
        <div className="community-thread-drawer__content">
          <article className={`community-thread-drawer__root community-thread-drawer__root--${threadKind}`}>
            <header>
              <button type="button" onClick={() => threadRoot.profileId && onOpenProfile(threadRoot.profileId)}><Avatar item={threadRoot} /></button>
              <div><button type="button" className="community-author" onClick={() => threadRoot.profileId && onOpenProfile(threadRoot.profileId)}>{threadRoot.displayName} <span className="community-author-points">{pointsLabel(threadRoot.points)}</span></button><span>@{threadRoot.handle} · {relativeTime(threadRoot.sentAt)}{threadRoot.editedAt && !threadRoot.deletedAt ? ' · edited' : ''}</span></div>
            </header>
            {threadRoot.deletedAt ? <div className="community-message-removed"><Trash2 size={17} /><div><strong>Post removed by its author</strong><span>The public revision history remains available for transparency.</span></div></div> : <>
              {threadRoot.text && <p className="community-thread-drawer__root-body">{threadRoot.text}</p>}
              {threadRoot.imageUrl && <figure className="community-post-image"><img src={threadRoot.imageUrl} alt={threadRoot.text || 'Image shared with this post'} loading="lazy" /></figure>}
              {(threadRoot.linkPreview || threadRoot.buildUrl || extractFirstHttpUrl(threadRoot.text)) && <CommunityLinkPreview message={threadRoot} />}
              {threadRoot.buildName && <a className="community-build-attachment" href={threadRoot.buildUrl || '#'} target={threadRoot.buildUrl ? '_blank' : undefined} rel="noreferrer"><span><Rocket size={18} /></span><div><small>ATTACHED BUILD</small><strong>{threadRoot.buildName}</strong></div>{threadRoot.buildUrl && <ExternalLink size={14} />}</a>}
            </>}
          </article>
          <section className="community-thread-drawer__responses" aria-label={`Responses to ${threadRoot.displayName}`}>
            <header><span>RESPONSES</span><strong>{threadReplies.length}</strong></header>
            {threadReplies.length > 0 ? threadReplies.map((item) => renderReply(item, true)) : <div className="community-thread-drawer__empty"><MessageCircle size={18} /><strong>No responses yet</strong><p>Be the first builder to leave a useful perspective.</p></div>}
          </section>
          {canPost ? renderReplyForm(threadRoot.id, threadRoot.displayName, true) : <section className="community-thread-drawer__signin"><div><strong>Have a useful perspective?</strong><p>Sign in to add feedback or reply to this conversation.</p></div><div><button type="button" onClick={() => onSignIn('github')}><Github size={14} /> GitHub</button><button type="button" onClick={() => onSignIn('linkedin')}><Linkedin size={14} /> LinkedIn</button></div></section>}
        </div>
      </aside>
    </div>}
    {historyMessage && <div className="community-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryMessageId(null) }}>
      <section className="community-history" role="dialog" aria-modal="true" aria-labelledby="community-history-title">
        <header><div><span><History size={14} /> PUBLIC RECORD</span><h2 id="community-history-title">{historyMessage.deletedAt ? 'Removed message history' : 'Edit history'}</h2><p>Every version published by {historyMessage.displayName}, newest first.</p></div><button ref={modalCloseRef} type="button" aria-label="Close edit history" onClick={() => setHistoryMessageId(null)}><X size={18} /></button></header>
        {historyMessage.deletedAt && <div className="community-history__removed"><Trash2 size={14} /><span>Removed {absoluteTime(historyMessage.deletedAt)}. Prior versions remain public.</span></div>}
        <ol>{historyVersions.map((version) => <li key={`${version.revision}-${version.createdAt}`}>
          <header><strong>{version.current ? 'Current version' : `Version ${version.revision}`}</strong><time dateTime={version.createdAt}>{absoluteTime(version.createdAt)}</time></header>
          {version.text ? <p>{version.text}</p> : <p className="is-empty">No text in this version.</p>}
          {version.imageUrl && <a className="community-history__image" href={version.imageUrl} target="_blank" rel="noreferrer"><img src={version.imageUrl} alt="Attachment from this message version" /><span>Open image attachment <ArrowUpRight size={12} /></span></a>}
          {(version.buildName || version.buildUrl) && <a className="community-history__build" href={version.buildUrl || '#'} target={version.buildUrl ? '_blank' : undefined} rel="noreferrer"><Rocket size={13} /><span>{version.buildName || version.buildUrl}</span>{version.buildUrl && <ArrowUpRight size={12} />}</a>}
        </li>)}</ol>
      </section>
    </div>}
    {deleteMessage && <div className="community-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteMessageId(null) }}>
      <section className="community-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="community-delete-title" aria-describedby="community-delete-description">
        <span className="community-delete-dialog__icon"><Trash2 size={21} /></span><h2 id="community-delete-title">Remove this {deleteMessage.parentId ? 'response' : 'post'}?</h2><p id="community-delete-description">It will be replaced with a public removal notice. Its contents stay available in edit history so the conversation keeps an accountable record.</p>
        <div><button ref={modalCloseRef} type="button" onClick={() => setDeleteMessageId(null)}>Keep it</button><button className="is-destructive" type="button" onClick={() => { onDeleteMessage(deleteMessage.id); setDeleteMessageId(null); if (editingMessageId === deleteMessage.id) setEditingMessageId(null) }}><Trash2 size={14} /> Remove {deleteMessage.parentId ? 'response' : 'post'}</button></div>
      </section>
    </div>}
  </div>
}
