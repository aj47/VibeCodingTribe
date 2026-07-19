import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Github,
  LockKeyhole,
  Radio,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import type { AgentDefinition, RepositoryReference, UserProfile } from '../domain/types'
import { Avatar } from './Avatar'
import { Brand } from './Brand'

interface OnboardingFlowProps {
  user: UserProfile
  repositories: RepositoryReference[]
  agents: AgentDefinition[]
  onComplete: (preferences: {
    repositoryId: string
    agentId: string
    help: string[]
    continuousListening: boolean
  }) => void
  onCancel: () => void
}

const helpOptions = ['Implementation', 'Code review', 'Issue triage', 'Research', 'Release coordination']

export function OnboardingFlow({ user, repositories, agents, onComplete, onCancel }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? '')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [help, setHelp] = useState(['Implementation', 'Code review'])
  const [continuousListening, setContinuousListening] = useState(false)
  const repository = repositories.find((item) => item.id === repositoryId)
  const agent = agents.find((item) => item.id === agentId)

  function toggleHelp(option: string) {
    setHelp((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])
  }

  return (
    <main className="onboarding-screen">
      <header><Brand /><button className="button button--ghost" type="button" onClick={onCancel}>Use demo workspace</button></header>
      <div className="onboarding-layout">
        <aside className="onboarding-agent">
          <div className="onboarding-agent__identity">
            <Avatar name="Guide" size="lg" isAgent status="online" tone="#b6ee79" />
            <span><b>Guide</b><small>Onboarding agent</small></span>
          </div>
          <div className="guide-message">
            <Sparkles size={14} />
            {step === 0 && <p><b>Welcome to the tribe, {user.displayName}.</b> I’ll help set up one useful room and one agent. Nothing gets write access automatically.</p>}
            {step === 1 && <p><b>Pick the context that matters first.</b> A repository community keeps rooms, threads, GitHub activity, and agents grounded together.</p>}
            {step === 2 && <p><b>Last: choose how you want help.</b> You can change these defaults for every future run.</p>}
          </div>
          <ol>
            {['GitHub identity', 'Repository community', 'Agent defaults'].map((label, index) => (
              <li key={label} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}>
                <span>{index < step ? <Check size={11} /> : index + 1}</span>{label}
              </li>
            ))}
          </ol>
          <div className="onboarding-safety"><LockKeyhole size={13} /><span><b>Power stays visible.</b> Sensitive actions always return to the room for approval.</span></div>
        </aside>

        <section className="onboarding-card">
          <div className="onboarding-progress"><span style={{ width: `${((step + 1) / 3) * 100}%` }} /></div>
          {step === 0 && (
            <div className="onboarding-step">
              <span className="step-kicker">Step 1 of 3</span>
              <h1>Your GitHub identity is connected.</h1>
              <p>This is how people and repository communities will recognize you. Matrix identity stays behind the scenes.</p>
              <div className="identity-card">
                <Avatar name={user.displayName} src={user.avatarUrl} size="lg" status="online" />
                <span><b>{user.displayName}</b><small>@{user.githubUsername}</small></span>
                <span className="connected-label"><CheckCircle2 size={13} /> Connected</span>
              </div>
              <dl className="identity-details"><div><dt>Visible identity</dt><dd>GitHub username and avatar</dd></div><div><dt>Chat account</dt><dd>{user.matrixUserId}</dd></div><div><dt>Default access</dt><dd>Read-only until explicitly changed</dd></div></dl>
            </div>
          )}
          {step === 1 && (
            <div className="onboarding-step">
              <span className="step-kicker">Step 2 of 3</span>
              <h1>Choose your first repository community.</h1>
              <p>We’ll open its General room and use repository metadata as shared context.</p>
              <div className="onboarding-repos">
                {repositories.map((repo) => (
                  <button key={repo.id} className={repositoryId === repo.id ? 'is-selected' : ''} type="button" onClick={() => setRepositoryId(repo.id)}>
                    <span className="repo-glyph">{repo.owner[0]}{repo.name[0]}</span>
                    <span><b>{repo.fullName}</b><small>{repo.description}</small><em><Github size={10} /> {repo.visibility} · {repo.language}</em></span>
                    {repositoryId === repo.id && <CheckCircle2 size={16} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="onboarding-step">
              <span className="step-kicker">Step 3 of 3</span>
              <h1>Configure your first agent.</h1>
              <p>Pick the help you want. The agent starts with conversation and repository read access only.</p>
              <div className="onboarding-agents">
                {agents.map((item) => (
                  <button key={item.id} className={agentId === item.id ? 'is-selected' : ''} type="button" onClick={() => setAgentId(item.id)}>
                    <Avatar name={item.name} src={item.avatarUrl} tone={item.avatarColor} size="sm" isAgent />
                    <span><b>{item.name}</b><small>{item.provider} · {item.runtime}</small></span>
                    {agentId === item.id && <CheckCircle2 size={14} />}
                  </button>
                ))}
              </div>
              <div className="help-options">
                <span>What do you want help with?</span>
                <div>{helpOptions.map((option) => <label key={option}><input type="checkbox" checked={help.includes(option)} onChange={() => toggleHelp(option)} /><span>{option}</span></label>)}</div>
              </div>
              <label className="onboarding-listen"><input type="checkbox" checked={continuousListening} onChange={(event) => setContinuousListening(event.target.checked)} /><Radio size={14} /><span><b>Keep {agent?.name ?? 'agent'} listening after I leave</b><small>Off by default and always visible in the room.</small></span></label>
              <div className="setup-summary"><Bot size={14} /><span><b>{agent?.name}</b> will join <b>{repository?.fullName} · #general</b> with room and repository read access.</span></div>
            </div>
          )}
          <footer>
            <button className="button button--ghost" type="button" onClick={() => step === 0 ? onCancel() : setStep((value) => value - 1)}><ArrowLeft size={14} /> {step === 0 ? 'Back to sign in' : 'Back'}</button>
            <button className="button button--primary" type="button" disabled={step === 2 && help.length === 0} onClick={() => step < 2 ? setStep((value) => value + 1) : onComplete({ repositoryId, agentId, help, continuousListening })}>{step < 2 ? 'Continue' : 'Enter the room'} <ArrowRight size={14} /></button>
          </footer>
        </section>
      </div>
    </main>
  )
}
