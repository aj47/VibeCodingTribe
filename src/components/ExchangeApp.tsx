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
  Github,
  Inbox,
  Linkedin,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
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

type ExchangeView = 'discover' | 'needs-you' | 'ledger'

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
  summary: '',
  stepsTaken: '',
  expectedResult: '',
  actualResult: '',
  severity: 'medium',
  recommendation: '',
  evidenceUrl: '',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function statusLabel(status: string) {
  return status.replace('_', ' ')
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
  const reviewMission = state.missions.find((item) => item.requesterId === activeUserId && item.status === 'in_review')
  const acceptedMissionNeedingTasks = state.missions.find((item) => item.requesterId === activeUserId && item.status === 'accepted'
    && state.feedback.some((feedbackItem) => feedbackItem.missionId === item.id && !state.agentRuns.some((run) => run.feedbackId === feedbackItem.id)))
  const openMissionToTest = state.missions.find((item) => item.status === 'open' && item.requesterId !== activeUserId)
  const latestOwnedMission = [...state.missions].reverse().find((item) => item.requesterId === activeUserId)
  const mission = reviewMission ?? activeClaimMission ?? acceptedMissionNeedingTasks ?? openMissionToTest ?? latestOwnedMission ?? state.missions.at(-1)
  const product = mission ? state.products.find((item) => item.id === mission.productId) : undefined
  const claim = mission ? state.claims.find((item) => item.missionId === mission.id) : undefined
  const feedback = mission ? state.feedback.find((item) => item.missionId === mission.id) : undefined
  const agentRun = feedback ? state.agentRuns.find((item) => item.feedbackId === feedback.id) : undefined
  const requester = mission ? state.users.find((user) => user.id === mission.requesterId) : undefined
  const tester = claim ? state.users.find((user) => user.id === claim.testerId) : undefined
  const canRequestFeedback = balance >= 10

  const relevantTransactions = [...state.transactions].reverse().filter((transaction) => (
    transaction.postings.some((posting) => posting.accountId === `user:${activeUserId}`)
  ))

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
              <button type="button" onClick={() => setView('ledger')}>View credit history <ArrowRight size={13} /></button>
            </div>
          </details>

          {view === 'discover' && (
            <>
              <section className={`exchange-guide${!canRequestFeedback ? ' exchange-guide--earn' : ''}`} aria-labelledby="exchange-guide-title">
                <header>
                  <span>YOUR NEXT STEP</span>
                  <h1 id="exchange-guide-title">{activeClaimForUser ? 'Finish your test and earn 8 credits.' : reviewMission ? `${tester?.displayName ?? 'A tester'}’s feedback is ready for you.` : acceptedMissionNeedingTasks ? 'Turn accepted feedback into a plan.' : canRequestFeedback ? 'You’re ready to request feedback.' : openMissionToTest ? 'Earn credits by helping another builder.' : latestOwnedMission?.status === 'open' ? 'Your feedback request is live.' : 'Start by helping another builder.'}</h1>
                  <p>{activeClaimForUser ? 'Share what you tried, what happened, and what you would change.' : reviewMission ? 'Read the evidence, then decide whether the feedback earned its reward.' : acceptedMissionNeedingTasks ? 'Create draft development tasks without giving an agent repository access.' : canRequestFeedback ? 'Spend 10 credits for a focused product test, or earn more by testing someone else’s app.' : openMissionToTest ? 'You need 10 credits to request feedback. Complete this test to earn 8.' : latestOwnedMission?.status === 'open' ? 'Another builder can claim it now. We’ll bring you back when feedback needs your review.' : 'New testing requests will appear here as builders publish them.'}</p>
                </header>

                {(activeClaimForUser || reviewMission || acceptedMissionNeedingTasks) ? (
                  <button className="next-step-button" type="button" onClick={revealMission}>
                    <span>{activeClaimForUser ? <ClipboardCheck size={24} /> : reviewMission ? <Inbox size={24} /> : <Sparkles size={24} />}</span>
                    <span><strong>{activeClaimForUser ? 'Continue giving feedback' : reviewMission ? 'Review submitted feedback' : 'Create development tasks'}</strong><small>{activeClaimForUser ? 'Complete the structured feedback form' : reviewMission ? `See ${tester?.displayName ?? 'the tester'}’s findings and attached evidence` : 'Use the read-only planning adapter'}</small></span>
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
                  <header><div><small>NEW PRODUCT SPACE + MISSION</small><h2>Fund a focused test</h2></div><strong><Coins size={14} /> 10 credits</strong></header>
                  <div className="form-grid">
                    <label>Product name<input required value={missionDraft.productName} onChange={(event) => setMissionDraft({ ...missionDraft, productName: event.target.value })} /></label>
                    <label>Product URL<input type="url" required value={missionDraft.productUrl} onChange={(event) => setMissionDraft({ ...missionDraft, productUrl: event.target.value })} /></label>
                  </div>
                  <label>What is the product?<textarea required value={missionDraft.productDescription} onChange={(event) => setMissionDraft({ ...missionDraft, productDescription: event.target.value })} /></label>
                  <label>Mission title<input required value={missionDraft.title} onChange={(event) => setMissionDraft({ ...missionDraft, title: event.target.value })} /></label>
                  <label>Test scenario<textarea required value={missionDraft.scenario} onChange={(event) => setMissionDraft({ ...missionDraft, scenario: event.target.value })} /></label>
                  <label>What does success look like?<textarea required value={missionDraft.successCriteria} onChange={(event) => setMissionDraft({ ...missionDraft, successCriteria: event.target.value })} /></label>
                  <label>Device requirement<input value={missionDraft.deviceRequirement} onChange={(event) => setMissionDraft({ ...missionDraft, deviceRequirement: event.target.value })} /></label>
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
                    <span><Coins size={14} /><strong>{mission.rewardCredits}</strong> reward</span>
                    <span><Clock3 size={14} />48 hour claim</span>
                    <span><UserRoundCheck size={14} />{mission.deviceRequirement}</span>
                    {product.url && <a href={product.url} target="_blank" rel="noreferrer">Open product <ExternalLink size={13} /></a>}
                  </div>
                  <details className="mission-details">
                    <summary>View test instructions and success criteria <ChevronRight size={13} /></summary>
                    <div className="mission-brief">
                      <div><span>SCENARIO</span><p>{mission.scenario}</p></div>
                      <div><span>SUCCESS LOOKS LIKE</span><p>{mission.successCriteria}</p></div>
                    </div>
                  </details>

                  {mission.status === 'open' && activeUserId !== mission.requesterId && (
                    <div className="mission-action"><div><strong>Ready to test this?</strong><p>You can hold one active claim. Abandoned claims expire after 48 hours.</p></div><button className="primary-action" type="button" disabled={pending} onClick={() => void commit('claim_mission', { missionId: mission.id }, 'Mission claimed. Your feedback is due in 48 hours.')}><ClipboardCheck size={15} /> Claim mission</button></div>
                  )}
                  {mission.status === 'open' && activeUserId === mission.requesterId && <div className="mission-wait"><Clock3 size={16} /><span><strong>Your mission is live.</strong> It is ready for another builder to claim.</span></div>}

                  {mission.status === 'claimed' && claim?.testerId === activeUserId && (
                    <form className="exchange-form feedback-form" onSubmit={handleFeedbackSubmit}>
                      <header><div><small>STRUCTURED FEEDBACK</small><h3>Complete the mission</h3></div><span>Due {formatDate(claim.expiresAt)}</span></header>
                      <label>What did you find?<input required value={feedbackDraft.summary} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, summary: event.target.value })} /></label>
                      <label>Steps you took<textarea required value={feedbackDraft.stepsTaken} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, stepsTaken: event.target.value })} /></label>
                      <div className="form-grid"><label>Expected result<textarea required value={feedbackDraft.expectedResult} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, expectedResult: event.target.value })} /></label><label>Actual result<textarea required value={feedbackDraft.actualResult} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, actualResult: event.target.value })} /></label></div>
                      <div className="form-grid"><label>Severity<select value={feedbackDraft.severity} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, severity: event.target.value as SubmitFeedbackInput['severity'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Screenshot or recording URL<input type="url" value={feedbackDraft.evidenceUrl} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, evidenceUrl: event.target.value })} /></label></div>
                      <label>Recommendation<textarea required value={feedbackDraft.recommendation} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, recommendation: event.target.value })} /></label>
                      <footer><span>Feedback stays tied to this mission.</span><button className="primary-action" type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit feedback'} {!pending && <ArrowRight size={14} />}</button></footer>
                    </form>
                  )}
                  {mission.status === 'claimed' && claim?.testerId !== activeUserId && <div className="mission-wait"><Clock3 size={16} /><span><strong>{tester?.displayName} is testing now.</strong> You’ll get a Needs You review when feedback arrives.</span></div>}

                  {mission.status === 'in_review' && feedback && activeUserId === mission.requesterId && (
                    <section className="feedback-review">
                      <header><div><span>FEEDBACK FROM {tester?.displayName?.toUpperCase()}</span><h3>{feedback.summary}</h3></div><em className={`severity severity--${feedback.severity}`}>{feedback.severity} severity</em></header>
                      <dl><div><dt>Steps taken</dt><dd>{feedback.stepsTaken}</dd></div><div><dt>Expected</dt><dd>{feedback.expectedResult}</dd></div><div><dt>Actual</dt><dd>{feedback.actualResult}</dd></div><div><dt>Recommendation</dt><dd>{feedback.recommendation}</dd></div></dl>
                      {feedback.evidenceUrl && <a href={feedback.evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open attached evidence</a>}
                      <footer><span>Accepting releases {mission.rewardCredits} credits to {tester?.displayName} and retires {mission.platformCredits} credits.</span><button className="primary-action" type="button" disabled={pending} onClick={() => void commit('accept_feedback', { missionId: mission.id }, `Feedback accepted. ${mission.rewardCredits} credits transferred to ${tester?.displayName}; ${mission.platformCredits} credits retired.`)}><CheckCircle2 size={15} /> Accept feedback</button></footer>
                    </section>
                  )}
                  {mission.status === 'in_review' && activeUserId !== mission.requesterId && <div className="mission-wait"><Clock3 size={16} /><span><strong>Feedback is awaiting {requester?.displayName}’s review.</strong> Credits remain safely in escrow.</span></div>}

                  {mission.status === 'accepted' && feedback && (
                    <section className="settlement-panel">
                      <div className="settlement-summary"><CheckCircle2 size={22} /><div><span>MISSION SETTLED</span><h3>Useful feedback paid out</h3><p>10 escrow credits became an 8-credit tester reward and a 2-credit platform sink.</p></div><div className="settlement-math"><span>10</span><i>→</i><strong>8</strong><small>+2 retired</small></div></div>
                      {!agentRun && activeUserId === mission.requesterId && <div className="agent-conversion"><div><Bot size={18} /><span><strong>Make the feedback buildable</strong><small>A read-only planning agent can draft tasks from this accepted feedback.</small></span></div><button type="button" disabled={pending} onClick={() => void commit('convert_feedback_to_tasks', { missionId: mission.id }, 'Server planning adapter created three draft tasks. No repository was accessed.')}><Sparkles size={14} /> Convert to tasks</button></div>}
                      {!agentRun && activeUserId !== mission.requesterId && <div className="mission-wait"><Coins size={16} /><span><strong>You earned {mission.rewardCredits} credits.</strong> Your available balance is now {balance}.</span></div>}
                      {agentRun && <div className="task-set"><header><div><span><Bot size={13} /> SERVER PLANNING ADAPTER · READ ONLY</span><h3>Draft development tasks</h3></div><em>{agentRun.tasks.length} drafts</em></header>{agentRun.tasks.map((task) => <article key={task.id}><strong>{task.priority}</strong><div><h4>{task.title}</h4><p>{task.description}</p><small>Evidence · {task.evidence}</small></div><span>Draft</span></article>)}</div>}
                    </section>
                  )}
                </article>
              )}
            </>
          )}

          {view === 'needs-you' && (
            <><header className="workspace-header"><div><span>ACTION INBOX</span><h1>Needs You</h1><p>Reviews, feedback deadlines, disputes, and agent handoffs land here.</p></div><Inbox size={26} /></header><section className="action-list">{actions.length === 0 ? <div className="empty-actions"><CheckCircle2 size={24} /><h2>You’re caught up</h2><p>Nothing needs {activeUser.displayName.split(' ')[0]} right now.</p></div> : actions.map((action) => <button key={action.id} type="button" onClick={() => setView('discover')}><span className={`action-icon action-icon--${action.kind}`}>{action.kind === 'review_feedback' ? <ClipboardCheck size={17} /> : action.kind === 'create_tasks' ? <Bot size={17} /> : <Clock3 size={17} />}</span><span><small>{statusLabel(action.kind)}</small><strong>{action.title}</strong><em>{action.kind === 'submit_feedback' ? `Due ${formatDate(action.dueAt)}` : 'Ready now'}</em></span><ChevronRight size={16} /></button>)}</section></>
          )}

          {view === 'ledger' && (
            <><header className="workspace-header"><div><span>CREDIT ACCOUNT</span><h1>Immutable history</h1><p>Your balance is calculated from append-only, balanced postings.</p></div><strong className="ledger-balance"><Coins size={18} />{balance}</strong></header><section className="ledger"><header><span>TRANSACTION</span><span>POSTING</span><span>DATE</span></header>{relevantTransactions.map((transaction) => { const posting = transaction.postings.find((item) => item.accountId === `user:${activeUserId}`)!; return <article key={transaction.id}><span><i><CircleDollarSign size={16} /></i><span><strong>{posting.label}</strong><small>{transaction.referenceId}</small></span></span><b className={posting.amount > 0 ? 'is-positive' : 'is-negative'}>{posting.amount > 0 ? '+' : ''}{posting.amount}</b><time>{formatDate(transaction.createdAt)}</time></article>})}<footer><ShieldCheck size={14} /> Each transaction balances to zero across user and system accounts.</footer></section></>
          )}
        </section>
      </main>
    </div>
  )
}
