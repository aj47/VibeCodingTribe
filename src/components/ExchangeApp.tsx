import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Coins,
  ExternalLink,
  FolderOpen,
  Github,
  History,
  Inbox,
  Linkedin,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  UserRoundCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  creditBalance,
  needsYouActions,
  reputationFor,
} from '../exchange/domain'
import type { CreateMissionInput, ExchangeState, SubmitFeedbackInput } from '../exchange/types'
import { ExchangeApiClient, ExchangeApiError, type ExchangeCommandType } from '../services/exchange'
import { Brand } from './Brand'

type ExchangeView = 'discover' | 'needs-you' | 'history' | 'ledger'
type HistorySelection = { type: 'mission' | 'feedback'; id: string }

const MISSION_DRAFT: CreateMissionInput = {
  productName: '',
  productUrl: '',
  productDescription: '',
  title: '',
  scenario: '',
  successCriteria: '',
  deviceRequirement: '',
}

const FEEDBACK_DRAFT: SubmitFeedbackInput = {
  note: '',
  evidenceUrl: '',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function statusLabel(status: string) {
  return status.replace('_', ' ')
}

function feedbackText(feedback: ExchangeState['feedback'][number]) {
  return feedback.note?.trim()
    || [feedback.summary, feedback.stepsTaken, feedback.recommendation].filter(Boolean).join('\n\n').trim()
    || 'No written note was added.'
}

function feedbackHeading(feedback: ExchangeState['feedback'][number]) {
  const firstLine = feedbackText(feedback).split(/\r?\n/).find(Boolean) || 'Feedback without a note'
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

interface ExchangeAppProps {
  onOpenRoom: () => void
  onSignIn: () => void
  signedIn: boolean
  authenticatedUserId?: string
}

export function ExchangeApp({ onOpenRoom, onSignIn, signedIn, authenticatedUserId }: ExchangeAppProps) {
  const [state, setState] = useState<ExchangeState | null>(null)
  const [view, setView] = useState<ExchangeView>('discover')
  const [selectedHistory, setSelectedHistory] = useState<HistorySelection | null>(null)
  const [showMissionForm, setShowMissionForm] = useState(false)
  const [missionDraft, setMissionDraft] = useState(MISSION_DRAFT)
  const [feedbackDraft, setFeedbackDraft] = useState(FEEDBACK_DRAFT)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const activeUserId = authenticatedUserId ?? ''
  const api = useMemo(() => new ExchangeApiClient(), [])

  useEffect(() => {
    if (!signedIn) {
      setState(null)
      setLoadError('Sign in with LinkedIn or GitHub to access missions and credits.')
      return
    }
    let active = true
    setLoadError(null)
    void api.snapshot().then((snapshot) => {
      if (active) setState(snapshot)
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'The exchange could not be loaded')
    })
    return () => { active = false }
  }, [api, signedIn])

  useEffect(() => {
    if (!selectedHistory) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedHistory(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [selectedHistory])

  if (!state) {
    return (
      <div className="exchange-shell">
        <header className="exchange-topbar"><Brand /><nav aria-label="Exchange navigation"><button className="is-active" type="button">Missions</button><button type="button">Needs You</button><button type="button">Ledger</button></nav><div className="exchange-topbar__actions"><button className="exchange-room-link" type="button" onClick={onOpenRoom}><MessageSquareText size={14} /> Tribe Chat</button></div></header>
        <main className="exchange-service-state" aria-live="polite">
          {loadError ? <><ShieldCheck size={27} /><h1>Connect to the exchange</h1><p>{loadError}</p>{!signedIn && <button className="primary-action" type="button" onClick={onSignIn}><Linkedin size={14} /> Sign in with LinkedIn</button>}</> : <><span className="exchange-service-state__spinner" /><h1>Loading your exchange…</h1><p>Restoring missions, credits, and pending actions from the server.</p></>}
        </main>
      </div>
    )
  }

  const activeUser = state.users.find((user) => user.id === activeUserId) ?? state.users[0]!
  const actions = needsYouActions(state, activeUserId)
  const reputation = reputationFor(state, activeUserId)
  const balance = creditBalance(state, activeUserId)
  const activeClaimForUser = state.claims.find((item) => item.testerId === activeUserId && item.status === 'active')
  const activeClaimMission = activeClaimForUser ? state.missions.find((item) => item.id === activeClaimForUser.missionId) : undefined
  const reviewFeedback = state.feedback.find((item) => item.testerId !== activeUserId && item.status === 'submitted'
    && state.missions.some((missionItem) => missionItem.id === item.missionId && missionItem.requesterId === activeUserId))
  const reviewMission = reviewFeedback ? state.missions.find((item) => item.id === reviewFeedback.missionId) : undefined
  const acceptedMissionNeedingTasks = state.missions.find((item) => item.requesterId === activeUserId && item.status === 'accepted'
    && state.feedback.some((feedbackItem) => feedbackItem.missionId === item.id && !state.agentRuns.some((run) => run.feedbackId === feedbackItem.id)))
  const openMissionToTest = state.missions.find((item) => ['open', 'claimed', 'in_review', 'accepted'].includes(item.status)
    && item.requesterId !== activeUserId
    && !state.claims.some((claimItem) => claimItem.missionId === item.id && claimItem.testerId === activeUserId && claimItem.status !== 'expired'))
  const latestOwnedMission = [...state.missions].reverse().find((item) => item.requesterId === activeUserId)
  const mission = reviewMission ?? activeClaimMission ?? acceptedMissionNeedingTasks ?? openMissionToTest ?? latestOwnedMission ?? state.missions.at(-1)
  const product = mission ? state.products.find((item) => item.id === mission.productId) : undefined
  const claim = mission ? state.claims.find((item) => item.missionId === mission.id && item.testerId === activeUserId && ['active', 'submitted'].includes(item.status)) : undefined
  const missionFeedback = mission ? state.feedback.filter((item) => item.missionId === mission.id) : []
  const pendingFeedback = missionFeedback.filter((item) => item.status === 'submitted')
  const acceptedFeedback = missionFeedback.filter((item) => item.status === 'accepted')
  const reviewerTester = reviewFeedback ? state.users.find((user) => user.id === reviewFeedback.testerId) : undefined
  const requester = mission ? state.users.find((user) => user.id === mission.requesterId) : undefined
  const canRequestFeedback = balance >= 10

  const relevantTransactions = [...state.transactions].reverse().filter((transaction) => (
    transaction.postings.some((posting) => posting.accountId === `user:${activeUserId}`)
  ))
  const submittedFeedback = [...state.feedback]
    .filter((feedback) => feedback.testerId === activeUserId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  const submittedMissions = [...state.missions]
    .filter((item) => item.requesterId === activeUserId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  async function commit(type: ExchangeCommandType, input: Record<string, unknown>, success: string) {
    if (pending) return false
    setPending(true)
    try {
      const next = await api.command(type, input)
      setState(next)
      setNotice(success)
      return true
    } catch (error) {
      setNotice(error instanceof ExchangeApiError ? error.message : 'That action could not be completed')
      return false
    } finally {
      setPending(false)
    }
  }

  async function handleMissionSubmit(event: FormEvent) {
    event.preventDefault()
    if (await commit('create_mission', missionDraft as unknown as Record<string, unknown>, 'Mission published. 10 credits are secured in server escrow.')) setShowMissionForm(false)
  }

  function revealMission() {
    setView('discover')
    window.setTimeout(() => document.getElementById('current-mission')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function revealMissionForm() {
    setView('discover')
    setShowMissionForm(true)
    window.setTimeout(() => document.getElementById('mission-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function handleFeedbackSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mission) return
    void commit('submit_feedback', { missionId: mission.id, feedback: feedbackDraft }, 'Feedback submitted. The requester now has a review in Needs You.')
  }

  return (
    <div className="exchange-shell">
      <header className="exchange-topbar">
        <Brand />
        <nav aria-label="Exchange navigation">
          <button className={view === 'discover' ? 'is-active' : ''} type="button" onClick={() => setView('discover')}>Home</button>
          <button className={view === 'needs-you' ? 'is-active' : ''} type="button" onClick={() => setView('needs-you')}>
            Needs You {actions.length > 0 && <span>{actions.length}</span>}
          </button>
          <button className={view === 'history' ? 'is-active' : ''} type="button" onClick={() => setView('history')}><History size={13} /> History</button>
        </nav>
        <div className="exchange-topbar__actions">
          <button className="exchange-room-link" type="button" onClick={onOpenRoom}><MessageSquareText size={14} /> Tribe Chat</button>
          {!signedIn && <button className="exchange-signin" type="button" onClick={onSignIn}><Linkedin size={14} /> Sign in</button>}
        </div>
      </header>

      <main className="exchange-layout">
        <section className="exchange-workspace">
          {notice && <div className="exchange-notice" role="status"><CheckCircle2 size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}

          <details className="exchange-account">
            <summary>
              <span className="profile-avatar" style={{ background: activeUser.avatarColor }}>{activeUser.displayName.split(' ').map((part) => part[0]).join('')}</span>
              <span><strong>{activeUser.displayName}</strong><small>{activeUser.headline}</small></span>
              <span className="account-balance"><Coins size={16} /><strong>{balance}</strong><small>credits</small></span>
              <span className="account-details-label">Profile & details <ChevronRight size={13} /></span>
            </summary>
            <div className="exchange-account__details">
              <section><span>VERIFIED WITH</span><strong className="provider-mark">{activeUser.provider === 'linkedin' ? <Linkedin size={12} /> : <Github size={12} />}{activeUser.provider}</strong></section>
              <section><span>TESTING FIT</span><strong>{activeUser.skills.join(' · ') || 'Add your skills'}</strong><small>{activeUser.devices.join(' · ') || 'Add your testing devices'}</small></section>
              <section><span>REPUTATION</span><strong>{reputation.testerAccepted} accepted test{reputation.testerAccepted === 1 ? '' : 's'}</strong><small>{reputation.testerCompleted} completed · {reputation.requesterCompleted} requests accepted</small></section>
              <div className="exchange-account__actions"><button type="button" onClick={() => setView('ledger')}>View credit history <ArrowRight size={13} /></button><button type="button" onClick={() => setView('history')}><History size={13} /> View feedback history <ArrowRight size={13} /></button></div>
            </div>
          </details>

          {view === 'discover' && (
            <>
              <section className={`exchange-guide${!canRequestFeedback ? ' exchange-guide--earn' : ''}`} aria-labelledby="exchange-guide-title">
                <header>
                  <span>YOUR NEXT STEP</span>
                  <h1 id="exchange-guide-title">{activeClaimForUser ? 'Finish your test and earn 8 credits.' : reviewMission ? `${reviewerTester?.displayName ?? 'A tester'}’s feedback is ready for you.` : acceptedMissionNeedingTasks ? 'Turn accepted feedback into a plan.' : canRequestFeedback ? 'You’re ready to request feedback.' : openMissionToTest ? 'Earn credits by helping another builder.' : latestOwnedMission?.status === 'open' ? 'Your feedback request is live.' : 'Start by helping another builder.'}</h1>
                  <p>{activeClaimForUser ? 'Share what you tried, what happened, and what you would change.' : reviewMission ? 'Review each submission independently. Every accepted submission earns its own reward.' : acceptedMissionNeedingTasks ? 'Create draft development tasks without giving an agent repository access.' : canRequestFeedback ? 'Spend 10 credits for a focused product test, or earn more by testing someone else’s app.' : openMissionToTest ? 'Complete a test to earn 8 credits. Multiple builders can review the same mission.' : latestOwnedMission?.status === 'open' ? 'Your feedback request is live and can collect feedback from multiple builders.' : 'New testing requests will appear here as builders publish them.'}</p>
                </header>

                {(activeClaimForUser || reviewMission || acceptedMissionNeedingTasks) ? (
                  <button className="next-step-button" type="button" onClick={revealMission}>
                    <span>{activeClaimForUser ? <ClipboardCheck size={24} /> : reviewMission ? <Inbox size={24} /> : <Sparkles size={24} />}</span>
                    <span><strong>{activeClaimForUser ? 'Continue giving feedback' : reviewMission ? 'Review submitted feedback' : 'Create development tasks'}</strong><small>{activeClaimForUser ? 'Share a quick note or suggestion' : reviewMission ? 'See every tester’s note and attached evidence' : 'Use the read-only planning adapter'}</small></span>
                    <ArrowRight size={22} />
                  </button>
                ) : (
                  <div className="exchange-guide__actions">
                    <button className="exchange-choice exchange-choice--request" type="button" disabled={!canRequestFeedback || pending} onClick={revealMissionForm}>
                      <span className="exchange-choice__icon"><Plus size={25} /></span>
                      <span><small>{canRequestFeedback ? 'SPEND 10 CREDITS' : `${balance} OF 10 CREDITS`}</small><strong>Request feedback</strong><em>{canRequestFeedback ? 'Tell a tester exactly what to try.' : 'Complete tests to unlock a request.'}</em></span>
                      <ArrowRight size={21} />
                    </button>
                    <button className="exchange-choice exchange-choice--give" type="button" disabled={!openMissionToTest || pending} onClick={() => openMissionToTest && void commit('claim_mission', { missionId: openMissionToTest.id }, 'Mission claimed. Your feedback is due in 48 hours.')}>
                      <span className="exchange-choice__icon"><ClipboardCheck size={25} /></span>
                      <span><small>{openMissionToTest ? 'EARN 8 CREDITS' : 'NO OPEN TESTS'}</small><strong>{openMissionToTest ? 'Give feedback' : 'Check back soon'}</strong><em>{openMissionToTest ? `${state.products.find((item) => item.id === openMissionToTest.productId)?.name} · 48 hours to finish` : 'We’ll show the next request here.'}</em></span>
                      <ArrowRight size={21} />
                    </button>
                  </div>
                )}

                {!canRequestFeedback && <div className="credit-unlock"><span style={{ width: `${Math.min(100, balance * 10)}%` }} /><small>{balance}/10 credits toward your next feedback request</small></div>}
              </section>

              {showMissionForm && (
                <form id="mission-form" className="exchange-form mission-form" onSubmit={handleMissionSubmit}>
                  <header><div><small>NEW PRODUCT SPACE + MISSION</small><h2>Ask for a fresh perspective</h2></div><strong><Coins size={14} /> 10 credits</strong></header>
                  <p className="form-intro">Add as much or as little context as you have. Every field is optional; a link and a short prompt are enough to get started.</p>
                  <div className="form-grid">
                    <label>Product name <span aria-hidden="true" className="optional-label">optional</span><input value={missionDraft.productName} onChange={(event) => setMissionDraft({ ...missionDraft, productName: event.target.value })} /></label>
                    <label>Product URL <span aria-hidden="true" className="optional-label">optional</span><input type="url" placeholder="https://" value={missionDraft.productUrl} onChange={(event) => setMissionDraft({ ...missionDraft, productUrl: event.target.value })} /></label>
                  </div>
                  <label>Tell builders about it <span aria-hidden="true" className="optional-label">optional</span><textarea placeholder="What are you making? What should someone try?" value={missionDraft.productDescription} onChange={(event) => setMissionDraft({ ...missionDraft, productDescription: event.target.value })} /></label>
                  <label>Request title <span aria-hidden="true" className="optional-label">optional</span><input placeholder="e.g. Try the first-run experience" value={missionDraft.title} onChange={(event) => setMissionDraft({ ...missionDraft, title: event.target.value })} /></label>
                  <label>Anything you want someone to try <span aria-hidden="true" className="optional-label">optional</span><textarea placeholder="A flow, feature, rough edge, or question is all you need." value={missionDraft.scenario} onChange={(event) => setMissionDraft({ ...missionDraft, scenario: event.target.value })} /></label>
                  <label>What would be useful to hear back? <span aria-hidden="true" className="optional-label">optional</span><textarea placeholder="Leave blank if you just want open-ended reactions." value={missionDraft.successCriteria} onChange={(event) => setMissionDraft({ ...missionDraft, successCriteria: event.target.value })} /></label>
                  <label>Device or setup notes <span aria-hidden="true" className="optional-label">optional</span><input placeholder="e.g. iPhone, desktop, screen reader" value={missionDraft.deviceRequirement} onChange={(event) => setMissionDraft({ ...missionDraft, deviceRequirement: event.target.value })} /></label>
                  <footer><button type="button" onClick={() => setShowMissionForm(false)}>Cancel</button><button className="primary-action" type="submit" disabled={pending}>{pending ? 'Publishing…' : 'Publish and fund'} {!pending && <ArrowRight size={14} />}</button></footer>
                </form>
              )}

              {mission && product && (
                <article id="current-mission" className="mission-panel">
                  <header>
                    <div className="product-mark">{product.name.slice(0, 1)}</div>
                    <div><span>{product.name} · by {requester?.displayName}</span><h2>{mission.title}</h2></div>
                    <em className={`mission-status mission-status--${mission.status}`}>{statusLabel(mission.status)}</em>
                  </header>
                  <div className="mission-meta">
                    <span><Coins size={14} /><strong>{mission.rewardCredits}</strong> per accepted feedback</span>
                    <span><UserRoundCheck size={14} /><strong>{missionFeedback.length}</strong> feedback{missionFeedback.length === 1 ? '' : 's'}</span>
                    <span><Clock3 size={14} />48 hour claim</span>
                    <span><UserRoundCheck size={14} />{mission.deviceRequirement}</span>
                    {product.url && <a href={product.url} target="_blank" rel="noreferrer">Open product <ExternalLink size={13} /></a>}
                  </div>
                  <details className="mission-details">
                    <summary>View test instructions and success criteria <ChevronRight size={13} /></summary>
                    <div className="mission-brief">
                      <div><span>SCENARIO</span><p>{mission.scenario || 'No specific flow — explore and share whatever stands out.'}</p></div>
                      <div><span>USEFUL SIGNAL</span><p>{mission.successCriteria || 'Open-ended reactions and suggestions are welcome.'}</p></div>
                    </div>
                  </details>

                  {['open', 'claimed', 'in_review', 'accepted'].includes(mission.status) && activeUserId !== mission.requesterId && !claim && !state.claims.some((item) => item.missionId === mission.id && item.testerId === activeUserId && item.status !== 'expired') && (
                    <div className="mission-action"><div><strong>Ready to test this?</strong><p>Multiple builders can claim this mission. Your own claim is due in 48 hours.</p></div><button className="primary-action" type="button" disabled={pending} onClick={() => void commit('claim_mission', { missionId: mission.id }, 'Mission claimed. Your feedback is due in 48 hours.')}><ClipboardCheck size={15} /> Claim mission</button></div>
                  )}
                  {['open', 'claimed', 'in_review', 'accepted'].includes(mission.status) && activeUserId === mission.requesterId && <div className="mission-wait"><Clock3 size={16} /><span><strong>Your mission can collect more feedback.</strong> {missionFeedback.length ? `${missionFeedback.length} submission${missionFeedback.length === 1 ? '' : 's'} so far.` : 'It is ready for another builder to claim, and can collect more feedback afterward.'}</span></div>}

                  {claim?.testerId === activeUserId && claim.status === 'active' && (
                    <form className="exchange-form feedback-form" onSubmit={handleFeedbackSubmit}>
                      <header><div><small>OPEN-ENDED FEEDBACK</small><h3>What did you notice?</h3></div><span>Due {formatDate(claim.expiresAt)}</span></header>
                      <p className="form-intro">There is no checklist to complete. Leave a thought, suggestion, question, or rough edge in your own words — even a short note helps.</p>
                      <label>Your note <span aria-hidden="true" className="optional-label">optional</span><textarea className="feedback-note-input" placeholder="Something that stood out, felt confusing, worked well, or could be better…" value={feedbackDraft.note} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, note: event.target.value })} /></label>
                      <label>Screenshot or recording URL <span aria-hidden="true" className="optional-label">optional</span><input type="text" placeholder="https://" value={feedbackDraft.evidenceUrl} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, evidenceUrl: event.target.value })} /></label>
                      <footer><span>Share only what feels useful. The requester can read this note as-is.</span><button className="primary-action" type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit feedback'} {!pending && <ArrowRight size={14} />}</button></footer>
                    </form>
                  )}
                  {claim?.testerId === activeUserId && claim.status === 'submitted' && <div className="mission-wait"><Clock3 size={16} /><span><strong>Your feedback is submitted.</strong> The requester is reviewing it with the other mission submissions.</span></div>}
                  {!claim && activeUserId !== mission.requesterId && pendingFeedback.length > 0 && <div className="mission-wait"><Clock3 size={16} /><span><strong>Other builders are being reviewed.</strong> You can still add your own feedback.</span></div>}

                  {pendingFeedback.length > 0 && activeUserId === mission.requesterId && pendingFeedback.map((pendingItem) => {
                    const pendingTester = state.users.find((user) => user.id === pendingItem.testerId)
                    return <section className="feedback-review" key={pendingItem.id}>
                      <header><div><span>FEEDBACK FROM {pendingTester?.displayName?.toUpperCase()}</span><h3>{feedbackHeading(pendingItem)}</h3></div></header>
                      <div className="feedback-note"><p>{feedbackText(pendingItem)}</p></div>
                      {pendingItem.evidenceUrl && <a href={pendingItem.evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open attached evidence</a>}
                      <footer><span>Accepting pays {mission.rewardCredits} credits to {pendingTester?.displayName} and retires {mission.platformCredits} credits. This mission can accept more feedback afterward.</span><button className="primary-action" type="button" disabled={pending} onClick={() => void commit('accept_feedback', { missionId: mission.id, feedbackId: pendingItem.id }, `Feedback accepted. ${mission.rewardCredits} credits transferred to ${pendingTester?.displayName}; more builders can still contribute.`)}><CheckCircle2 size={15} /> Accept feedback</button></footer>
                    </section>
                  })}
                  {pendingFeedback.length > 0 && activeUserId !== mission.requesterId && <div className="mission-wait"><Clock3 size={16} /><span><strong>Feedback is being reviewed.</strong> The requester can accept each submission independently.</span></div>}

                  {acceptedFeedback.length > 0 && (
                    <section className="settlement-panel">
                      <div className="settlement-summary"><CheckCircle2 size={22} /><div><span>{acceptedFeedback.length} FEEDBACK {acceptedFeedback.length === 1 ? 'SUBMISSION' : 'SUBMISSIONS'} PAID</span><h3>Useful feedback keeps earning its reward</h3><p>Each accepted submission pays {mission.rewardCredits} credits. The original mission funding is not a cap.</p></div><div className="settlement-math"><span>{acceptedFeedback.length * mission.rewardCredits}</span><small>credits paid</small></div></div>
                      {acceptedFeedback.map((acceptedItem) => {
                        const acceptedTester = state.users.find((user) => user.id === acceptedItem.testerId)
                        const acceptedRun = state.agentRuns.find((run) => run.feedbackId === acceptedItem.id)
                        return <div key={acceptedItem.id}><div className="accepted-feedback-row"><strong>{acceptedTester?.displayName}</strong><span>{feedbackHeading(acceptedItem)}</span>{!acceptedRun && activeUserId === mission.requesterId && <button type="button" disabled={pending} onClick={() => void commit('convert_feedback_to_tasks', { missionId: mission.id, feedbackId: acceptedItem.id }, 'Server planning adapter created three draft tasks. No repository was accessed.')}><Sparkles size={14} /> Convert to tasks</button>}{acceptedRun && <small>{acceptedRun.tasks.length} draft tasks created</small>}{activeUserId !== mission.requesterId && acceptedItem.testerId === activeUserId && <small><Coins size={13} /> You earned {mission.rewardCredits} credits</small>}</div>{acceptedRun && <div className="task-set"><header><div><span><Bot size={13} /> SERVER PLANNING ADAPTER · READ ONLY</span><h3>Draft development tasks</h3></div><em>{acceptedRun.tasks.length} drafts</em></header>{acceptedRun.tasks.map((task) => <article key={task.id}><strong>{task.priority}</strong><div><h4>{task.title}</h4><p>{task.description}</p><small>Evidence · {task.evidence}</small></div><span>Draft</span></article>)}</div>}</div>
                      })}
                    </section>
                  )}
                </article>
              )}
            </>
          )}

          {view === 'needs-you' && (
            <><header className="workspace-header"><div><span>ACTION INBOX</span><h1>Needs You</h1><p>Reviews, feedback deadlines, disputes, and agent handoffs land here.</p></div><Inbox size={26} /></header><section className="action-list">{actions.length === 0 ? <div className="empty-actions"><CheckCircle2 size={24} /><h2>You’re caught up</h2><p>Nothing needs {activeUser.displayName.split(' ')[0]} right now.</p></div> : actions.map((action) => <button key={action.id} type="button" onClick={() => setView('discover')}><span className={`action-icon action-icon--${action.kind}`}>{action.kind === 'review_feedback' ? <ClipboardCheck size={17} /> : action.kind === 'create_tasks' ? <Bot size={17} /> : <Clock3 size={17} />}</span><span><small>{statusLabel(action.kind)}</small><strong>{action.title}</strong><em>{action.kind === 'submit_feedback' ? `Due ${formatDate(action.dueAt)}` : 'Ready now'}</em></span><ChevronRight size={16} /></button>)}</section></>
          )}

          {view === 'history' && (
            <>
              <header className="workspace-header history-header">
                <div><span>YOUR ACTIVITY</span><h1>Feedback history</h1><p>Every request you’ve published and every note you’ve submitted, with its current status.</p></div>
                <History size={26} />
              </header>

              <section className="history-summary" aria-label="History summary">
                <div><strong>{submittedMissions.length}</strong><span>projects submitted</span></div>
                <div><strong>{submittedFeedback.length}</strong><span>feedback notes sent</span></div>
                <div><strong>{submittedFeedback.filter((feedback) => feedback.status === 'accepted').length}</strong><span>notes accepted</span></div>
              </section>

              <section className="history-section" aria-labelledby="projects-history-title">
                <header className="history-section__header"><div><span>REQUESTER HISTORY</span><h2 id="projects-history-title">Projects submitted for feedback</h2></div><small>{submittedMissions.length} total</small></header>
                {submittedMissions.length === 0 ? <div className="history-empty"><FolderOpen size={22} /><h3>No projects yet</h3><p>Publish a feedback request and it will stay here with its live status.</p><button type="button" onClick={() => { setView('discover'); revealMissionForm() }}>Request feedback <ArrowRight size={13} /></button></div> : <div className="history-list">{submittedMissions.map((item) => {
                  const itemProduct = state.products.find((productItem) => productItem.id === item.productId)
                  const itemFeedback = state.feedback.filter((feedback) => feedback.missionId === item.id)
                  return <button className="history-row" key={item.id} type="button" onClick={() => setSelectedHistory({ type: 'mission', id: item.id })}>
                    <span className="history-row__icon history-row__icon--project"><FolderOpen size={17} /></span>
                    <span className="history-row__content"><strong>{item.title}</strong><small>{itemProduct?.name || 'Untitled product'} · Submitted {formatDate(item.createdAt)}</small></span>
                    <span className="history-row__meta"><em className={`mission-status mission-status--${item.status}`}>{statusLabel(item.status)}</em><small>{itemFeedback.length} feedback{itemFeedback.length === 1 ? '' : 's'}</small></span>
                    <ChevronRight size={16} />
                  </button>
                })}</div>}
              </section>

              <section className="history-section" aria-labelledby="feedback-history-title">
                <header className="history-section__header"><div><span>TESTER HISTORY</span><h2 id="feedback-history-title">Feedback you’ve submitted</h2></div><small>{submittedFeedback.length} total</small></header>
                {submittedFeedback.length === 0 ? <div className="history-empty"><MessageSquareText size={22} /><h3>No feedback submitted yet</h3><p>Claim another builder’s request to leave your first note.</p><button type="button" onClick={() => setView('discover')}>Find a request <ArrowRight size={13} /></button></div> : <div className="history-list">{submittedFeedback.map((feedback) => {
                  const feedbackMission = state.missions.find((item) => item.id === feedback.missionId)
                  const feedbackProduct = feedbackMission ? state.products.find((item) => item.id === feedbackMission.productId) : undefined
                  return <button className="history-row" key={feedback.id} type="button" onClick={() => setSelectedHistory({ type: 'feedback', id: feedback.id })}>
                    <span className="history-row__icon history-row__icon--feedback"><MessageSquareText size={17} /></span>
                    <span className="history-row__content"><strong>{feedbackHeading(feedback)}</strong><small>{feedbackProduct?.name || 'Project feedback'} · Submitted {formatDate(feedback.submittedAt)}</small></span>
                    <span className="history-row__meta"><em className={`mission-status mission-status--${feedback.status}`}>{statusLabel(feedback.status)}</em><small>{feedback.status === 'accepted' && feedback.acceptedAt ? `Accepted ${formatDate(feedback.acceptedAt)}` : 'Awaiting review'}</small></span>
                    <ChevronRight size={16} />
                  </button>
                })}</div>}
              </section>
            </>
          )}

          {view === 'ledger' && (
            <><header className="workspace-header"><div><span>CREDIT ACCOUNT</span><h1>Immutable history</h1><p>Your balance is calculated from append-only, balanced postings.</p></div><strong className="ledger-balance"><Coins size={18} />{balance}</strong></header><section className="ledger"><header><span>TRANSACTION</span><span>POSTING</span><span>DATE</span></header>{relevantTransactions.map((transaction) => { const posting = transaction.postings.find((item) => item.accountId === `user:${activeUserId}`)!; return <article key={transaction.id}><span><i><CircleDollarSign size={16} /></i><span><strong>{posting.label}</strong><small>{transaction.referenceId}</small></span></span><b className={posting.amount > 0 ? 'is-positive' : 'is-negative'}>{posting.amount > 0 ? '+' : ''}{posting.amount}</b><time>{formatDate(transaction.createdAt)}</time></article>})}<footer><ShieldCheck size={14} /> Each transaction balances to zero across user and system accounts.</footer></section></>
          )}
        </section>
      </main>

      {selectedHistory && (() => {
        const selectedMission = selectedHistory.type === 'mission' ? state.missions.find((item) => item.id === selectedHistory.id) : undefined
        const selectedFeedback = selectedHistory.type === 'feedback' ? state.feedback.find((item) => item.id === selectedHistory.id) : undefined
        const detailMission = selectedMission ?? (selectedFeedback ? state.missions.find((item) => item.id === selectedFeedback.missionId) : undefined)
        const detailProduct = detailMission ? state.products.find((item) => item.id === detailMission.productId) : undefined
        const detailFeedback = detailMission ? state.feedback.filter((item) => item.missionId === detailMission.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)) : []
        const detailRequester = detailMission ? state.users.find((user) => user.id === detailMission.requesterId) : undefined
        return <div className="history-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedHistory(null) }}>
          <aside className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-drawer-title">
            <header className="history-drawer__header"><div><span>{selectedMission ? 'PROJECT DETAILS' : 'FEEDBACK DETAILS'}</span><h2 id="history-drawer-title">{selectedMission ? selectedMission.title : selectedFeedback ? feedbackHeading(selectedFeedback) : 'History item'}</h2></div><button type="button" aria-label="Close details" onClick={() => setSelectedHistory(null)}><X size={18} /></button></header>
            {detailMission && detailProduct && selectedMission && <>
              <div className="history-drawer__status"><em className={`mission-status mission-status--${detailMission.status}`}>{statusLabel(detailMission.status)}</em><span>Submitted {formatDate(detailMission.createdAt)}</span></div>
              <div className="history-drawer__body">
                <div className="history-detail-product"><span className="product-mark">{detailProduct.name.slice(0, 1)}</span><div><strong>{detailProduct.name}</strong><small>by {detailRequester?.displayName || 'you'}</small></div>{detailProduct.url && <a href={detailProduct.url} target="_blank" rel="noreferrer" aria-label="Open product"><ExternalLink size={15} /></a>}</div>
                {detailProduct.description && <div className="history-detail-copy"><span>ABOUT THE PROJECT</span><p>{detailProduct.description}</p></div>}
                <div className="history-detail-copy"><span>WHAT TESTERS WERE ASKED TO TRY</span><p>{detailMission.scenario || 'No specific scenario was added.'}</p></div>
                <div className="history-detail-copy"><span>SUCCESS LOOKS LIKE</span><p>{detailMission.successCriteria || 'Open-ended reactions welcome.'}</p></div>
                <div className="history-detail-feedback"><header><span>FEEDBACK RECEIVED</span><strong>{detailFeedback.length}</strong></header>{detailFeedback.length === 0 ? <p>No feedback yet. This request is still open to builders.</p> : detailFeedback.map((feedback) => <button type="button" key={feedback.id} onClick={() => setSelectedHistory({ type: 'feedback', id: feedback.id })}><span><strong>{feedbackHeading(feedback)}</strong><small>{statusLabel(feedback.status)} · {formatDate(feedback.submittedAt)}</small></span><ChevronRight size={15} /></button>)}</div>
              </div>
            </>}
            {detailMission && detailProduct && selectedFeedback && <>
              <div className="history-drawer__status"><em className={`mission-status mission-status--${selectedFeedback.status}`}>{statusLabel(selectedFeedback.status)}</em><span>Submitted {formatDate(selectedFeedback.submittedAt)}</span></div>
              <div className="history-drawer__body">
                <div className="history-detail-context"><span>ON PROJECT</span><strong>{detailMission.title}</strong><small>{detailProduct.name} · by {detailRequester?.displayName || 'the requester'}</small></div>
                <div className="history-detail-copy history-detail-copy--note"><span>YOUR NOTE</span><p>{feedbackText(selectedFeedback)}</p></div>
                {selectedFeedback.evidenceUrl && <a className="history-evidence" href={selectedFeedback.evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open attached evidence</a>}
                <dl className="history-detail-facts"><div><dt>Submitted</dt><dd>{formatDate(selectedFeedback.submittedAt)}</dd></div><div><dt>Status</dt><dd>{statusLabel(selectedFeedback.status)}</dd></div>{selectedFeedback.acceptedAt && <div><dt>Accepted</dt><dd>{formatDate(selectedFeedback.acceptedAt)}</dd></div>}</dl>
              </div>
            </>}
          </aside>
        </div>
      })()}
    </div>
  )
}
