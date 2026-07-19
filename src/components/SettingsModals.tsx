import { Check, Github, Link2, LockKeyhole, LogOut, Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RepositoryReference, UserProfile } from '../domain/types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface ProfileModalProps {
  open: boolean
  user: UserProfile
  repositories: RepositoryReference[]
  onClose: () => void
  onSignOut: () => void
  onRestartOnboarding: () => void
}

export function ProfileModal({ open, user, repositories, onClose, onSignOut, onRestartOnboarding }: ProfileModalProps) {
  return (
    <Modal open={open} title="Profile & connections" description="Your visible identity, repository access, and session." onClose={onClose} className="settings-modal">
      <div className="settings-profile">
        <Avatar name={user.displayName} src={user.avatarUrl} size="lg" status="online" />
        <span><b>{user.displayName}</b><small>@{user.githubUsername}</small><em><Github size={11} /> GitHub connected</em></span>
      </div>
      <div className="settings-list">
        <div className="settings-list__label">Identity</div>
        <div><span><b>Matrix account</b><small>Provisioned automatically</small></span><code>{user.matrixUserId}</code></div>
        <div><span><b>Timezone</b><small>Used for room activity and summaries</small></span><span>{user.timezone}</span></div>
        <div className="settings-list__label">Connected repositories</div>
        {repositories.filter((repo) => repo.connected).map((repo) => <div key={repo.id}><span><b>{repo.fullName}</b><small>{repo.visibility} · {repo.permission}</small></span><em><Check size={12} /> Connected</em></div>)}
        <div className="settings-list__label">Safety defaults</div>
        <div><ShieldCheck size={15} /><span><b>Repository writes need approval</b><small>Branch, comment, PR, merge, and destructive actions are gated.</small></span></div>
        <div><LockKeyhole size={15} /><span><b>Continuous listening is opt-in</b><small>Shown in every room where it is enabled.</small></span></div>
      </div>
      <footer className="modal__footer settings-footer">
        <button className="button button--ghost" type="button" onClick={onRestartOnboarding}>Restart onboarding</button>
        <span />
        <button className="button button--danger" type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
      </footer>
    </Modal>
  )
}

interface ConnectRepositoryModalProps {
  open: boolean
  repositories: RepositoryReference[]
  onClose: () => void
  onConnect: (repositoryId: string) => void
}

export function ConnectRepositoryModal({ open, repositories, onClose, onConnect }: ConnectRepositoryModalProps) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => repositories.filter((repo) => `${repo.fullName} ${repo.description}`.toLowerCase().includes(query.toLowerCase())), [query, repositories])
  return (
    <Modal open={open} title="Connect a repository" description="Repository access is provided by the VibeCodingTribe GitHub App." onClose={onClose} className="connect-repo-modal">
      <div className="github-install-note"><Github size={18} /><span><b>GitHub App installed</b><small>3 repositories available · access follows your GitHub permissions</small></span><button type="button">Manage <Link2 size={11} /></button></div>
      <label className="repo-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a repository…" /></label>
      <div className="connect-repo-list">
        {filtered.map((repo) => <button key={repo.id} type="button" onClick={() => { onConnect(repo.id); onClose() }}><span className="repo-glyph">{repo.owner[0]}{repo.name[0]}</span><span><b>{repo.fullName}</b><small>{repo.description}</small><em>{repo.visibility} · {repo.permission} access</em></span>{repo.connected ? <i><Check size={11} /> Connected</i> : <i>Connect</i>}</button>)}
      </div>
      <footer className="connect-repo-footer"><LockKeyhole size={12} /> Private repository contents stay scoped to members with matching GitHub access.</footer>
    </Modal>
  )
}
