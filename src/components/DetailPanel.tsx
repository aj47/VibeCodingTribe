import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  GitBranch,
  Github,
  LockKeyhole,
  Play,
  Radio,
  ShieldCheck,
  Square,
  Unplug,
  Users,
  X,
} from 'lucide-react'
import type {
  ActivityLogEntry,
  AgentSession,
  Conversation,
} from '../domain/types'
import { Avatar } from './Avatar'

interface DetailPanelProps {
  open: boolean
  conversation: Conversation
  agentSessions: AgentSession[]
  activityLog: ActivityLogEntry[]
  onClose: () => void
  onOpenAgentActions: () => void
  onStopAgent: (sessionId: string) => void
  onDetachAgent: (sessionId: string) => void
  onToggleListening: (sessionId: string) => void
}

const permissionLabels: Record<string, string> = {
  'read-room': 'Read room',
  'read-thread': 'Read threads',
  'read-repository': 'Read repository',
  'write-repository': 'Write repository',
  'run-local-tools': 'Run local tools',
  'run-remote-tools': 'Run remote tools',
  'continuous-listening': 'Continuous listening',
  'create-branches': 'Create branches',
  'post-comments': 'Post comments',
  'open-pull-requests': 'Open pull requests',
  'merge-changes': 'Merge changes',
  'access-secrets': 'Access secrets',
}

function logIcon(entry: ActivityLogEntry) {
  if (entry.status === 'success') return <CheckCircle2 size={11} />
  if (entry.type === 'tool-call') return <Play size={11} />
  if (entry.type === 'approval') return <ShieldCheck size={11} />
  return <Activity size={11} />
}

export function DetailPanel({
  open,
  conversation,
  agentSessions,
  activityLog,
  onClose,
  onOpenAgentActions,
  onStopAgent,
  onDetachAgent,
  onToggleListening,
}: DetailPanelProps) {
  if (!open) return null
  const scopedAgents = agentSessions.filter((session) => session.conversationId === conversation.id)
  const scopedLog = activityLog.filter((entry) => entry.conversationId === conversation.id).slice().reverse()

  return (
    <aside className="detail-panel" aria-label="Conversation details">
      <header className="detail-panel__header">
        <div><span>Room context</span><h2>Details & agents</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close details"><X size={17} /></button>
      </header>

      <div className="detail-panel__scroll">
        {conversation.repo && (
          <section className="detail-section repository-context">
            <div className="detail-section__label"><Github size={12} /> Repository</div>
            <a href={conversation.repo.htmlUrl} target="_blank" rel="noreferrer">
              <span className="repo-glyph">{conversation.repo.owner[0]}{conversation.repo.name[0]}</span>
              <span><b>{conversation.repo.fullName}</b><small>{conversation.repo.description}</small></span>
              <ExternalLink size={12} />
            </a>
            <div className="repo-facts">
              <span><GitBranch size={11} /> {conversation.repo.defaultBranch}</span>
              <span><LockKeyhole size={11} /> {conversation.repo.visibility}</span>
              <span>{conversation.repo.permission} access</span>
            </div>
          </section>
        )}

        <section className="detail-section">
          <div className="detail-section__label"><Users size={12} /> Participants · {conversation.participants.length}</div>
          <div className="participant-list">
            {conversation.participants.slice(0, 5).map((participant) => (
              <div key={participant.id}>
                <Avatar name={participant.displayName} src={participant.avatarUrl} tone={participant.avatarColor} size="sm" isAgent={participant.kind === 'agent'} status={participant.presence} />
                <span><b>{participant.displayName}</b><small>{participant.role ?? participant.kind} · {participant.presence}</small></span>
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section agent-section">
          <div className="detail-section__label"><Bot size={12} /> Attached agents · {scopedAgents.length}</div>
          {scopedAgents.length === 0 ? (
            <div className="empty-agent-state">
              <Bot size={22} />
              <b>No agent attached</b>
              <span>Bring one into the room with explicit context and permissions.</span>
              <button className="button button--secondary button--small" type="button" onClick={onOpenAgentActions}>Attach agent</button>
            </div>
          ) : scopedAgents.map((session) => (
            <article className="agent-inspector" key={session.id}>
              <header>
                <Avatar name={session.name} src={session.avatarUrl} size="md" isAgent status={session.status === 'working' ? 'working' : session.status === 'blocked' ? 'blocked' : 'online'} />
                <span><b>{session.name}</b><small>{session.provider} · {session.runtime}</small></span>
                <em className={`status-label status-label--${session.status}`}><i /> {session.status.replace('-', ' ')}</em>
              </header>
              <div className="agent-current-task"><span>Current task</span><p>{session.task}</p><small><Clock3 size={11} /> Last activity {new Date(session.lastActivity).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>
              <button className={`listening-toggle${session.continuousListening ? ' is-on' : ''}`} type="button" onClick={() => onToggleListening(session.id)} aria-pressed={session.continuousListening}>
                <span><Radio size={13} /><span><b>Continuous listening</b><small>Keeps listening after you leave</small></span></span>
                <i><b /></i>
              </button>
              <div className="agent-permissions">
                <span><Eye size={11} /> Session permissions</span>
                <div>{session.permissions.map((permission) => <em key={permission}>{permissionLabels[permission] ?? permission}</em>)}</div>
              </div>
              <footer>
                {!['completed', 'failed', 'stopped'].includes(session.status) && (
                  <button className="button button--danger button--small" type="button" onClick={() => onStopAgent(session.id)}><Square size={11} /> Stop</button>
                )}
                <button className="button button--ghost button--small" type="button" onClick={() => onDetachAgent(session.id)}><Unplug size={11} /> Detach</button>
                <button className="icon-button" type="button" aria-label="Open full agent activity"><ChevronRight size={14} /></button>
              </footer>
            </article>
          ))}
        </section>

        <section className="detail-section audit-section">
          <div className="detail-section__label"><Activity size={12} /> Activity & audit</div>
          {scopedLog.length === 0 ? (
            <p className="empty-audit">No agent tool use has been recorded in this room.</p>
          ) : (
            <div className="audit-list">
              {scopedLog.map((entry) => (
                <div key={entry.id} className={`audit-row audit-row--${entry.status ?? 'info'}`}>
                  <span>{logIcon(entry)}</span>
                  <div><b>{entry.title}</b><p>{entry.detail}</p><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
