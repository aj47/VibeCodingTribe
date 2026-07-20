import type { RealtimeProfile } from './protocol'

function isAgent(profile: RealtimeProfile) {
  return profile.actorType === 'agent'
}

function normalizedHandle(profile: RealtimeProfile) {
  return profile.handle.trim().replace(/^@/, '').toLowerCase()
}

function sameIdentity(left: RealtimeProfile, right: RealtimeProfile) {
  if (isAgent(left) || isAgent(right)) {
    return isAgent(left) && isAgent(right)
      && Boolean(left.profileId && right.profileId && left.profileId === right.profileId)
  }

  if (left.profileId && right.profileId) return left.profileId === right.profileId
  return normalizedHandle(left) === normalizedHandle(right)
}

function profileKey(profile: RealtimeProfile) {
  if (isAgent(profile)) return `agent:${profile.profileId ?? profile.clientId}`
  return `human:${profile.profileId ?? normalizedHandle(profile)}`
}

/** Merge profiles while collapsing legacy realtime IDs for the same human. */
export function mergeRealtimeProfiles(current: RealtimeProfile[], incoming: RealtimeProfile[]) {
  const merged = new Map<string, RealtimeProfile>()

  for (const profile of [...current, ...incoming]) {
    for (const [key, existing] of merged) {
      if (sameIdentity(existing, profile)) merged.delete(key)
    }
    merged.set(profileKey(profile), profile)
  }

  return [...merged.values()]
}
