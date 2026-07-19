import { ArrowRight, Github, ShieldCheck, Sparkles } from 'lucide-react'
import { Brand } from './Brand'

interface AuthScreenProps {
  pending: boolean
  onSignIn: () => void
  onOpenDemo: () => void
}

export function AuthScreen({ pending, onSignIn, onOpenDemo }: AuthScreenProps) {
  return (
    <main className="auth-screen">
      <nav className="auth-nav">
        <Brand />
        <button className="button button--ghost" type="button" onClick={onOpenDemo}>
          Open demo workspace
        </button>
      </nav>

      <section className="auth-hero">
        <div className="auth-hero__copy">
          <div className="eyebrow">
            <span className="signal-dot" /> Agent-native developer chat
          </div>
          <h1>
            Your coding agent
            <br />
            belongs in the <em>room.</em>
          </h1>
          <p>
            One persistent place for maintainers, contributors, and coding agents
            to talk, decide, and ship around a shared GitHub context.
          </p>
          <div className="auth-actions">
            <button
              className="button button--primary button--large"
              type="button"
              disabled={pending}
              onClick={onSignIn}
            >
              <Github size={19} />
              {pending ? 'Connecting GitHub…' : 'Continue with GitHub'}
              {!pending && <ArrowRight size={18} />}
            </button>
            <span>
              <ShieldCheck size={15} /> Read-only repository access by default
            </span>
          </div>
        </div>

        <div className="auth-preview" aria-label="Product preview">
          <div className="auth-preview__topbar">
            <span />
            <span />
            <span />
            <code>vibecodingtribe/core · # ship-room</code>
          </div>
          <div className="auth-preview__layout">
            <aside>
              <strong>NEEDS YOU</strong>
              <div className="auth-preview__item is-hot">
                <i>!</i>
                <span>OAuth callback<small>Agent blocked</small></span>
                <b>1</b>
              </div>
              <strong>ACTIVE</strong>
              <div className="auth-preview__item">
                <i>#</i>
                <span>ship-room<small>3 people · Patch working</small></span>
              </div>
              <div className="auth-preview__item">
                <i>⌁</i>
                <span>PR #184<small>Review requested</small></span>
              </div>
            </aside>
            <div className="auth-preview__chat">
              <div className="auth-preview__summary">
                <Sparkles size={14} />
                <span><b>While you were away</b> 2 decisions · 1 blocker</span>
              </div>
              <div className="preview-message">
                <span className="preview-avatar is-human">AJ</span>
                <p><b>AJ</b><small>10:32</small>Can we keep the callback state scoped to the install?</p>
              </div>
              <div className="preview-message is-agent">
                <span className="preview-avatar is-agent">P</span>
                <p>
                  <b>Patch <em>AGENT · WORKING</em></b><small>10:33</small>
                  Yes. I traced the auth flow and found the state leak.
                  <code>✓ read auth/callback.ts &nbsp; ✓ ran 18 tests</code>
                </p>
              </div>
              <div className="auth-preview__composer">
                Message #ship-room <kbd>⌘ ↵</kbd>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="auth-footer">
        <span>Matrix-backed chat</span>
        <i />
        <span>GitHub-native identity</span>
        <i />
        <span>Explicit agent permissions</span>
      </footer>
    </main>
  )
}
