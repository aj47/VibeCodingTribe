import { ArrowUpRight, Bot, ClipboardCheck, Github, Linkedin, MessageCircle, Radio, ShieldCheck } from 'lucide-react'
import type { AuthProvider } from '../auth/types'
import { Brand } from './Brand'

interface AuthScreenProps {
  pendingProvider: AuthProvider | null
  authError?: string | null
  onSignIn: (provider: AuthProvider) => void
  onOpenExchange: () => void
  onOpenRoom: () => void
  onInviteAgent: () => void
}

export function AuthScreen({ pendingProvider, authError, onSignIn, onOpenExchange, onOpenRoom, onInviteAgent }: AuthScreenProps) {
  return (
    <main className="auth-page">
      <nav className="auth-nav" aria-label="Primary navigation">
        <Brand />
        <div>
          <button className="auth-nav__chat" type="button" onClick={onOpenRoom}><MessageCircle size={13} /> Tribe Chat</button>
          <button className="auth-nav__invite" type="button" onClick={onInviteAgent}><Bot size={13} /> Invite your agent</button>
          <a href="https://github.com/aj47/VibeCodingTribe" target="_blank" rel="noreferrer">
            Source <ArrowUpRight size={13} />
          </a>
          <a href="https://docs.vibecodingtribe.com" target="_blank" rel="noreferrer">
            Build notes <ArrowUpRight size={13} />
          </a>
        </div>
      </nav>

      <section className="auth-hero">
        <div className="auth-hero__copy">
          <div className="auth-kicker"><Radio size={14} /> Real product testing · builder to builder</div>
          <h1>Find real testers.<br /><span>Join the tribe.</span></h1>
          <button className="auth-view-room" type="button" onClick={onOpenExchange}>
            <ClipboardCheck size={17} /> Find testers for your product <ArrowUpRight size={15} />
          </button>

          <button className="auth-agent-link" type="button" onClick={onOpenRoom}>
            <MessageCircle size={15} /> <span>Join everyone in Tribe Chat</span> <ArrowUpRight size={14} />
          </button>

          <div className="auth-actions">
            <button type="button" disabled={pendingProvider !== null} onClick={() => onSignIn('github')}>
              <Github size={18} />
              <span>{pendingProvider === 'github' ? 'Connecting…' : 'Continue with GitHub'}</span>
            </button>
            <button type="button" disabled={pendingProvider !== null} onClick={() => onSignIn('linkedin')}>
              <Linkedin size={18} />
              <span>{pendingProvider === 'linkedin' ? 'Connecting…' : 'Continue with LinkedIn'}</span>
            </button>
          </div>

          {authError && <div className="auth-error" role="alert">{authError}</div>}
          <div className="auth-privacy">
            <ShieldCheck size={15} />
            <p><strong>Identity only.</strong> Sign-in reads your basic profile. VCT cannot write to repositories or post for you.</p>
          </div>
        </div>

      </section>

      <section className="auth-how" aria-label="How the exchange works">
        <div className="auth-quiet-proof">
          <h2 className="sr-only">Real testers. Useful evidence.</h2>
          <span className="auth-quiet-proof__eyebrow">HOW IT WORKS</span>
          <div className="auth-quiet-proof__line"><span>01</span><b>Request a test</b></div>
          <div className="auth-quiet-proof__line"><span>02</span><b>Get feedback</b></div>
          <div className="auth-quiet-proof__line"><span>03</span><b>Return the favor</b></div>
          <div className="auth-quiet-proof__line"><span>04</span><b>Engage with the community</b></div>
        </div>
      </section>

      <footer className="auth-footer">
        <span>VibeCodingTribe</span>
        <p>Focused missions · accountable feedback · human-approved agent planning</p>
      </footer>
    </main>
  )
}
