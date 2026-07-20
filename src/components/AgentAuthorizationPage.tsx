import { ArrowLeft, Bot, CheckCircle2, KeyRound, LogIn, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentEnrollment, AuthSession } from '../auth/types'
import { authorizeAgentEnrollment, loadAgentEnrollment } from '../services/auth'

interface AgentAuthorizationPageProps {
  enrollmentId: string
  session: AuthSession | null
  onBack: () => void
  onSignIn: () => void
}

export function AgentAuthorizationPage({ enrollmentId, session, onBack, onSignIn }: AgentAuthorizationPageProps) {
  const [enrollment, setEnrollment] = useState<AgentEnrollment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [approved, setApproved] = useState(false)

  useEffect(() => {
    let active = true
    void loadAgentEnrollment(enrollmentId).then((value) => { if (active) setEnrollment(value) }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Authorization request not found') })
    return () => { active = false }
  }, [enrollmentId])

  async function approve() {
    setPending(true)
    setError(null)
    try {
      await authorizeAgentEnrollment(enrollmentId)
      setApproved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be authorized')
    } finally { setPending(false) }
  }

  const agentInitial = enrollment?.name.slice(0, 1).toUpperCase() ?? 'A'

  return <main className="agent-auth-page">
    <nav><button type="button" onClick={onBack}><ArrowLeft size={14} /> Cancel</button><span>Agent authorization</span></nav>
    <section className="agent-auth-card">
      {approved ? <div className="agent-auth-success"><CheckCircle2 size={34} /><span>ACCESS DELIVERED</span><h1>{enrollment?.name} is connected.</h1><p>The API key was sent directly to the registered callback. It will not be shown here. You can rotate or revoke it from Invite your agent.</p><button type="button" onClick={onBack}>Done</button></div> : <>
        <header><div className="agent-auth-avatar" style={{ background: enrollment?.avatarUrl ? '#edf5fb' : '#c8ddf0' }}>{enrollment?.avatarUrl ? <img src={enrollment.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <>{agentInitial}<Bot size={13} /></>}</div><span>AGENT REQUEST</span><h1>{enrollment?.name ?? 'Loading request…'}</h1><p>wants programmatic access to VibeCodingTribe.</p></header>
        {error && <div className="profile-error" role="alert">{error}</div>}
        {enrollment && <div className="agent-auth-details">
          <div><span><KeyRound size={15} /> PERMISSIONS</span><p>Read and participate in Tribe Chat, and use the testing exchange as your human account.</p></div>
          <div><span><ShieldCheck size={15} /> KEY DELIVERY</span><p>Sent once to <code>{enrollment.callbackUrl}</code>. Stored only as a one-way hash.</p></div>
          <div><span>HUMAN OWNER</span><p>{session ? <><strong>{session.user.displayName}</strong> · @{session.user.handle}</> : 'Sign in to establish the accountable owner.'}</p></div>
        </div>}
        <footer>
          <p>Only approve an agent and callback you recognize. This agent will act under your identity, and its activity can be traced back to your profile.</p>
          {session ? <button type="button" disabled={!enrollment || pending || enrollment.status !== 'pending'} onClick={() => void approve()}><ShieldCheck size={15} /> {pending ? 'Delivering key…' : `Authorize ${enrollment?.name ?? 'agent'}`}</button> : <button type="button" onClick={onSignIn}><LogIn size={15} /> Sign in to authorize</button>}
        </footer>
      </>}
    </section>
  </main>
}
