import { ArrowLeft, ArrowUpRight, BadgeCheck, Github, Globe2, Linkedin, LockKeyhole, MessageCircle, Rocket, Save, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { AuthProvider, AuthSession, PublicAgentProfile, PublicHumanProfile, PublicProfile } from '../auth/types'
import { beginLinkOAuth, loadOwnProfile, loadPublicProfile, updateOwnProfile } from '../services/auth'

interface ProfilePageProps {
  session: AuthSession | null
  profileId?: string
  badgesOnly?: boolean
  onBack: () => void
  onSignIn: () => void
  onProfileUpdated?: (profile: PublicHumanProfile) => void
}

const BADGES = [
  { id: 'first_post', name: 'First Post', description: 'Shared the first build update.', icon: Rocket },
  { id: 'first_feedback_given', name: 'First Feedback Given', description: 'Helped another builder move forward.', icon: MessageCircle },
  { id: 'first_feedback_received', name: 'First Feedback Received', description: 'Invited the tribe into the work.', icon: Sparkles },
  { id: 'shipped_feedback', name: 'Shipped Feedback', description: 'A suggestion made it into a build.', icon: BadgeCheck },
  { id: 'early_builder', name: 'Early Builder', description: 'Built with the tribe from the beginning.', icon: Rocket },
  { id: 'community_helper', name: 'Community Helper', description: 'Gave feedback builders marked useful.', icon: ShieldCheck },
] as const

function pointsLabel(points: number | undefined) {
  return `(+${Math.max(0, points ?? 0).toLocaleString()})`
}

export function ProfilePage({ session, profileId, badgesOnly = false, onBack, onSignIn, onProfileUpdated }: ProfilePageProps) {
  const ownProfile = !profileId || profileId === session?.user.id
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [draft, setDraft] = useState({ displayName: '', handle: '', headline: '', bio: '', githubUrl: '', linkedinUrl: '', websiteUrl: '' })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (ownProfile && !session) return
    let active = true
    const request = ownProfile ? loadOwnProfile().then((value) => value.profile) : loadPublicProfile(profileId!)
    void request.then((value) => {
      if (!active) return
      setProfile(value)
      if ('actorType' in value) return
      setDraft({ displayName: value.displayName, handle: value.handle, headline: value.headline ?? '', bio: value.bio ?? '', githubUrl: value.githubUrl ?? '', linkedinUrl: value.linkedinUrl ?? '', websiteUrl: value.websiteUrl ?? '' })
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
      onProfileUpdated?.(result.profile)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile could not be saved')
    }
  }

  async function link(provider: AuthProvider) {
    try { await beginLinkOAuth(provider) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link account') }
  }

  const agentProfile = profile && 'actorType' in profile && profile.actorType === 'agent' ? profile as PublicAgentProfile : null
  const humanProfile = profile && !agentProfile ? profile as PublicHumanProfile : null
  const ownerProfile = agentProfile?.owner && typeof agentProfile.owner.id === 'string' && agentProfile.owner.id ? agentProfile.owner : null
  const ownerProfileHref = ownerProfile ? `/p/${encodeURIComponent(ownerProfile.id)}` : null

  if (ownProfile && !session) return <main className="profile-page"><div className="profile-auth-gate"><UserRound size={28} /><h1>Sign in to edit your profile.</h1><p>Your profile is the public human identity behind every agent you authorize.</p><button type="button" onClick={onSignIn}>Sign in with GitHub</button></div></main>

  return <main className="profile-page">
    <nav className="profile-nav"><button type="button" onClick={onBack}><ArrowLeft size={14} /> Back</button><span>{agentProfile ? 'Agent profile' : 'Human profile'}</span></nav>
    {error && <div className="profile-error" role="alert">{error}</div>}
    {!profile ? <div className="profile-loading"><span className="exchange-service-state__spinner" /> Loading profile…</div> : <section className={`profile-sheet${agentProfile ? ' profile-sheet--agent' : ''}`}>
      <header>
        <div className="profile-sheet__avatar" style={{ background: agentProfile?.avatarColor ?? '#d8e9f7' }}>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.displayName.slice(0, 1)}</div>
        <div><span>{agentProfile ? 'AGENT IDENTITY' : 'HUMAN ACCOUNT'}</span><h1>{profile.displayName}</h1><p>@{profile.handle}{humanProfile && <strong className="profile-points">{pointsLabel(humanProfile.points)}</strong>}</p></div>
        <div className="profile-sheet__trust">{agentProfile ? <><ShieldCheck size={15} /> agent of {ownerProfileHref ? <a href={ownerProfileHref}>@{ownerProfile?.handle ?? agentProfile.ownerHandle}</a> : <span>@{agentProfile.ownerHandle}</span>}</> : <><ShieldCheck size={15} /> Owns every connected agent</>}</div>
      </header>
      {agentProfile ? <div className="public-profile-links public-agent-profile">
        <p>This agent has its own public identity. Every action remains accountable to {ownerProfileHref ? <a href={ownerProfileHref}><strong>{ownerProfile?.displayName}</strong> · @{ownerProfile?.handle}</a> : <strong>@{agentProfile.ownerHandle}</strong>}.</p>
        <small>Agent avatars and names are supplied by the connected agent during enrollment.</small>
      </div> : humanProfile && ownProfile && badgesOnly ? <BadgeCollection profile={humanProfile} /> : humanProfile && ownProfile ? <><form onSubmit={submit}>
        <div className="profile-field"><label htmlFor="profile-name">Display name</label><input id="profile-name" required maxLength={40} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></div>
        <div className="profile-field"><label htmlFor="profile-handle">Handle</label><input id="profile-handle" required minLength={2} maxLength={32} pattern="@?[A-Za-z0-9_-]{2,32}" placeholder="your-handle" value={draft.handle} onChange={(event) => setDraft({ ...draft, handle: event.target.value })} /><small className="profile-field__hint">Letters, numbers, hyphens, and underscores. Handles are unique.</small></div>
        <div className="profile-field"><label htmlFor="profile-headline">Headline</label><input id="profile-headline" maxLength={120} placeholder="What are you building?" value={draft.headline} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></div>
        <div className="profile-field profile-field--bio"><label htmlFor="profile-bio">About your work</label><textarea id="profile-bio" maxLength={320} placeholder="What do you build, explore, or want help with?" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></div>
        <div className="profile-link-field"><Github size={18} /><label htmlFor="profile-github"><span>GitHub profile</span><small>{humanProfile.linkedProviders.includes('github') ? 'Verified sign-in attached' : 'Public profile link'}</small></label><input id="profile-github" type="url" placeholder="https://github.com/username" value={draft.githubUrl} onChange={(event) => setDraft({ ...draft, githubUrl: event.target.value })} />{!humanProfile.linkedProviders.includes('github') && <button type="button" onClick={() => void link('github')}>Verify</button>}</div>
        <div className="profile-link-field"><Linkedin size={18} /><label htmlFor="profile-linkedin"><span>LinkedIn profile</span><small>{humanProfile.linkedProviders.includes('linkedin') ? 'Verified sign-in attached' : 'Public profile link'}</small></label><input id="profile-linkedin" type="url" placeholder="https://www.linkedin.com/in/username" value={draft.linkedinUrl} onChange={(event) => setDraft({ ...draft, linkedinUrl: event.target.value })} />{!humanProfile.linkedProviders.includes('linkedin') && <button type="button" onClick={() => void link('linkedin')}>Verify</button>}</div>
        <div className="profile-link-field"><Globe2 size={18} /><label htmlFor="profile-website"><span>Website or portfolio</span><small>Your public home on the web</small></label><input id="profile-website" type="url" placeholder="https://your-site.com" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} /></div>
        <footer><span>{saved ? 'Profile saved.' : 'These links are visible when someone opens your profile.'}</span><button type="submit"><Save size={14} /> Save profile</button></footer>
      </form><BadgeCollection profile={humanProfile} /></> : humanProfile ? <><div className="public-profile-links">
        <p>{humanProfile.bio || humanProfile.headline || 'Builder on VibeCodingTribe'}</p>
        <div>{humanProfile.githubUrl && <a href={humanProfile.githubUrl} target="_blank" rel="noreferrer"><Github size={17} /> GitHub <ArrowUpRight size={13} /></a>}{humanProfile.linkedinUrl && <a href={humanProfile.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin size={17} /> LinkedIn <ArrowUpRight size={13} /></a>}{humanProfile.websiteUrl && <a href={humanProfile.websiteUrl} target="_blank" rel="noreferrer"><Globe2 size={17} /> Website <ArrowUpRight size={13} /></a>}</div>
        {!humanProfile.githubUrl && !humanProfile.linkedinUrl && <small>No public profiles attached yet.</small>}
      </div><BadgeCollection profile={humanProfile} /></> : null}
    </section>}
  </main>
}

function BadgeCollection({ profile }: { profile: PublicHumanProfile }) {
  const awarded = new Set(profile.badges?.map((badge) => badge.id) ?? [])
  return <section className="profile-badges" aria-labelledby="profile-badges-title">
    <header><div><span>PROGRESS, NOT POINTS</span><h2 id="profile-badges-title">Builder badges</h2></div><strong>{awarded.size} / {BADGES.length} unlocked</strong></header>
    <div>{BADGES.map((badge) => {
      const Icon = badge.icon
      const unlocked = awarded.has(badge.id)
      return <article className={unlocked ? 'is-unlocked' : ''} key={badge.id}><span>{unlocked ? <Icon size={19} /> : <LockKeyhole size={16} />}</span><div><strong>{badge.name}</strong><p>{badge.description}</p></div>{unlocked && <BadgeCheck size={15} />}</article>
    })}</div>
  </section>
}
