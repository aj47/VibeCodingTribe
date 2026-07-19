import {
  Bot,
  CheckCircle2,
  Code2,
  FileSearch,
  FlaskConical,
  GitPullRequest,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'
import type { AgentDefinition, AgentPermission, RepositoryReference } from '../domain/types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface AgentActionModalProps {
  open: boolean
  agents: AgentDefinition[]
  repository?: RepositoryReference
  onClose: () => void
  onStart: (agentId: string, action: string, prompt: string, permissions: AgentPermission[]) => void
}

const actions = [
  { id: 'ask', label: 'Ask', icon: MessageSquareText, hint: 'Answer in room context' },
  { id: 'investigate', label: 'Investigate', icon: Search, hint: 'Trace a problem' },
  { id: 'fix', label: 'Fix issue', icon: Wrench, hint: 'Plan and edit code' },
  { id: 'review', label: 'Review PR', icon: GitPullRequest, hint: 'Inspect a change' },
  { id: 'research', label: 'Research', icon: FileSearch, hint: 'Gather sources' },
  { id: 'summarize', label: 'Summarize', icon: Sparkles, hint: 'Condense this room' },
  { id: 'explain', label: 'Explain code', icon: Code2, hint: 'Walk through code' },
  { id: 'tests', label: 'Run tests', icon: FlaskConical, hint: 'Verify repository' },
] as const

export function AgentActionModal({ open, agents, repository, onClose, onStart }: AgentActionModalProps) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [action, setAction] = useState('investigate')
  const [prompt, setPrompt] = useState('')
  const [permissions, setPermissions] = useState<AgentPermission[]>([
    'read-room',
    'read-thread',
    ...(repository ? (['read-repository'] as AgentPermission[]) : []),
  ])
  const [continuous, setContinuous] = useState(false)
  const agent = agents.find((item) => item.id === agentId) ?? agents[0]

  function togglePermission(permission: AgentPermission) {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    )
  }

  return (
    <Modal
      open={open}
      title="Bring an agent into the work"
      description="Choose a visible action and the exact context this run can access."
      onClose={onClose}
      className="agent-action-modal"
    >
      <div className="agent-modal__body">
        <label className="field-label">Agent</label>
        <div className="agent-selector">
          {agents.map((item) => (
            <button
              key={item.id}
              className={item.id === agent?.id ? 'is-selected' : ''}
              type="button"
              onClick={() => setAgentId(item.id)}
            >
              <Avatar name={item.name} src={item.avatarUrl} tone={item.avatarColor} size="sm" isAgent />
              <span><b>{item.name}</b><small>{item.provider} · {item.runtime}</small></span>
              {item.id === agent?.id && <CheckCircle2 size={14} />}
            </button>
          ))}
        </div>

        <label className="field-label">Action</label>
        <div className="agent-action-grid">
          {actions.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={action === item.id ? 'is-selected' : ''} type="button" onClick={() => setAction(item.id)}>
                <Icon size={15} />
                <span><b>{item.label}</b><small>{item.hint}</small></span>
              </button>
            )
          })}
        </div>

        <label className="field-label" htmlFor="agent-prompt">What should {agent?.name ?? 'the agent'} do?</label>
        <textarea
          id="agent-prompt"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the outcome, constraints, or question…"
        />

        <div className="permission-box">
          <div className="permission-box__header">
            <ShieldCheck size={15} />
            <span><b>Run permissions</b><small>Write access still requires an in-room approval.</small></span>
          </div>
          <div className="permission-chips">
            {([
              ['read-room', 'Read this room'],
              ['read-repository', `Read ${repository?.fullName ?? 'repository'}`],
              ['run-local-tools', 'Run local tools'],
            ] as Array<[AgentPermission, string]>).map(([permission, label]) => (
              <label key={permission}>
                <input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <label className="continuous-listen">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(event) => {
                setContinuous(event.target.checked)
                if (event.target.checked && !permissions.includes('continuous-listening')) {
                  setPermissions((current) => [...current, 'continuous-listening'])
                } else if (!event.target.checked) {
                  setPermissions((current) => current.filter((item) => item !== 'continuous-listening'))
                }
              }}
            />
            <span><b>Keep listening after I leave</b><small>Visible to everyone in the room. Off by default.</small></span>
          </label>
        </div>
      </div>
      <footer className="modal__footer">
        <button className="button button--ghost" type="button" onClick={onClose}>Cancel</button>
        <button
          className="button button--primary"
          type="button"
          disabled={!agent || !prompt.trim()}
          onClick={() => agent && onStart(agent.id, action, prompt.trim(), permissions)}
        >
          <Bot size={15} /> Start {actions.find((item) => item.id === action)?.label.toLowerCase()}
        </button>
      </footer>
    </Modal>
  )
}
