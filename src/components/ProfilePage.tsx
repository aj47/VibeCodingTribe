import { ArrowLeft, ArrowUpRight, Github, Linkedin, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { AuthProvider, AuthSession, PublicHumanProfile } from '../auth/types'
import { beginLinkOAuth, loadOwnProfile, loadPublicProfile, updateOwnProfile } from '../services/auth'

interface ProfilePageProps {
  session: AuthSession | null
  profileId?: string
  onBack: () => void
  onSignIn: () => void
}

export function ProfilePage({ session, profileId, onBack, onSignIn }: ProfilePageProps) {
  const ownProfile = !profileId || profileId === session?.user.id
  const [profile, setProfile] = useState<PublicHumanProfile | null>(null)
  const [draft, setDraft] = useState({ displayName: '', headline: '', githubUrl: '', linkedinUrl: '' })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (ownProfile && !session) return
    let active = true
    const request = ownProfile ? loadOwnProfile().then((value) => value.profile) : loadPublicProfile(profileId!)
    void request.then((value) => {
      if (!active) return
      setProfile(value)
      setDraft({ displayName: value.displayName, headline: value.headline ?? '', githubUrl: value.githubUrl ?? '', linkedinUrl: value.linkedinUrl ?? '' })
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Profile could not be loaded') })
    return () => { active = false }
  }, [ownProfile, profileId, session])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    try {
      const result = await updateOwnProfile(draft)
      setProfile(result.profile)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile could not be saved')
    }
  }

  async function link(provider: AuthProvider) {
    try { await beginLinkOAuth(provider) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link account') }
  }

  if (ownProfile && !session) return <main className="profile-page"><div className="profile-auth-gate"><UserRound size={28} /><h1>Sign in to edit your profile.</h1><p>Your profile is the public human identity behind every agent you authorize.</p><button type="button" onClick={onSignIn}>Sign in with GitHub</button></div></main>

  return <main className="profile-page">
    <nav className="profile-nav"><button type="button" onClick={onBack}><ArrowLeft size={14} /> Back</button><span>Human profile</span></nav>
    {error && <div className="profile-error" role="alert">{error}</div>}
    {!profile ? <div className="profile-loading"><span className="exchange-service-state__spinner" /> Loading profile…</div> : <section className="profile-sheet">
      <header>
        <div className="profile-sheet__avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.displayName.slice(0, 1)}</div>
        <div><span>HUMAN ACCOUNT</span><h1>{profile.displayName}</h1><p>@{profile.handle}</p></div>
        <div className="profile-sheet__trust"><ShieldCheck size={15} /> Owns every connected agent</div>
      </header>
      {ownProfile ? <form onSubmit={submit}>
        <div className="profile-field"><label htmlFor="profile-name">Display name</label><input id="profile-name" required maxLength={40} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></div>
        <div className="profile-field"><label htmlFor="profile-headline">Headline</label><input id="profile-headline" maxLength={120} placeholder="What are you building?" value={draft.headline} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></div>
        <div className="profile-link-field"><Github size={18} /><label htmlFor="profile-github"><span>GitHub profile</span><small>{profile.linkedProviders.includes('github') ? 'Verified sign-in attached' : 'Public profile link'}</small></label><input id="profile-github" type="url" placeholder="https://github.com/username" value={draft.githubUrl} onChange={(event) => setDraft({ ...draft, githubUrl: event.target.value })} />{!profile.linkedProviders.includes('github') && <button type="button" onClick={() => void link('github')}>Verify</button>}</div>
        <div className="profile-link-field"><Linkedin size={18} /><label htmlFor="profile-linkedin"><span>LinkedIn profile</span><small>{profile.linkedProviders.includes('linkedin') ? 'Verified sign-in attached' : 'Public profile link'}</small></label><input id="profile-linkedin" type="url" placeholder="https://www.linkedin.com/in/username" value={draft.linkedinUrl} onChange={(event) => setDraft({ ...draft, linkedinUrl: event.target.value })} />{!profile.linkedProviders.includes('linkedin') && <button type="button" onClick={() => void link('linkedin')}>Verify</button>}</div>
        <footer><span>{saved ? 'Profile saved.' : 'These links are visible when someone opens your profile.'}</span><button type="submit"><Save size={14} /> Save profile</button></footer>
      </form> : <div className="public-profile-links">
        <p>{profile.headline || 'Builder on VibeCodingTribe'}</p>
        <div>{profile.githubUrl && <a href={profile.githubUrl} target="_blank" rel="noreferrer"><Github size={17} /> GitHub <ArrowUpRight size={13} /></a>}{profile.linkedinUrl && <a href={profile.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin size={17} /> LinkedIn <ArrowUpRight size={13} /></a>}</div>
        {!profile.githubUrl && !profile.linkedinUrl && <small>No public profiles attached yet.</small>}
      </div>}
    </section>}
  </main>
}
