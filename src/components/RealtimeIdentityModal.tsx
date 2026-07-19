import { Radio, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { normalizeDisplayName, normalizeHandle, type RealtimeProfile } from '../realtime/protocol'
import { Modal } from './Modal'

interface RealtimeIdentityModalProps {
  open: boolean
  profile: RealtimeProfile
  onClose: () => void
  onSave: (profile: RealtimeProfile) => void
}

export function RealtimeIdentityModal({ open, profile, onClose, onSave }: RealtimeIdentityModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [handle, setHandle] = useState(profile.handle)

  useEffect(() => {
    if (!open) return
    setDisplayName(profile.displayName)
    setHandle(profile.handle)
  }, [open, profile])

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextDisplayName = normalizeDisplayName(displayName)
    if (!nextDisplayName) return
    onSave({ ...profile, displayName: nextDisplayName, handle: normalizeHandle(handle) })
    onClose()
  }

  return (
    <Modal
      open={open}
      title="Live channel identity"
      description="This browser identity is shown to everyone connected to #general. GitHub sign-in replaces it in the next milestone."
      onClose={onClose}
      className="realtime-identity-modal"
    >
      <form onSubmit={submit}>
        <div className="realtime-identity-preview">
          <span style={{ background: profile.avatarColor }}><UserRound size={17} /></span>
          <div><b>{normalizeDisplayName(displayName) || 'Builder'}</b><small>@{normalizeHandle(handle)}</small></div>
          <em><Radio size={11} /> live</em>
        </div>
        <div className="realtime-identity-fields">
          <label>
            <span>Display name</span>
            <input value={displayName} maxLength={40} autoComplete="name" onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            <span>Handle</span>
            <input value={handle} maxLength={32} autoComplete="username" onChange={(event) => setHandle(event.target.value)} />
          </label>
        </div>
        <footer className="modal__footer">
          <button className="button button--ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" disabled={!normalizeDisplayName(displayName)}>Save live identity</button>
        </footer>
      </form>
    </Modal>
  )
}
