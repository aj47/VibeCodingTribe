import { describe, expect, it } from 'vitest'
import { collectActivityDigestEvents, digestDay, type DigestRecipient } from './notifications'
import type { RealtimeMessageRecord } from '../src/realtime/protocol'

const recipient: DigestRecipient = {
  accountId: 'human_ada',
  realtimeClientId: 'human_realtime_ada',
  displayName: 'Ada Builder',
  email: 'ada@example.com',
  preferences: { activityDigest: true },
}

function message(overrides: Partial<RealtimeMessageRecord>): RealtimeMessageRecord {
  return {
    id: 'message',
    channelId: 'showcases',
    clientId: 'human_other',
    displayName: 'Other Builder',
    handle: 'other',
    avatarColor: '#657c54',
    profileId: 'human_other',
    text: 'A useful update',
    sentAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('activity digest collection', () => {
  it('collects replies and feedback for owned posts with previews and thread links', () => {
    const events = collectActivityDigestEvents([
      message({ id: 'showcase', profileId: recipient.accountId, clientId: recipient.realtimeClientId, displayName: recipient.displayName, text: 'Ship notes', buildName: 'Calm Ship', intent: 'showcase' }),
      message({ id: 'reply', parentId: 'showcase', text: 'This is a thoughtful reply.', commentKind: 'reply', sentAt: '2026-08-01T11:00:00.000Z' }),
      message({ id: 'feedback', parentId: 'showcase', text: 'The onboarding step is confusing.', commentKind: 'feedback', sentAt: '2026-08-01T12:00:00.000Z' }),
    ], recipient, 'https://vibecodingtribe.com')

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'feedback', parentTitle: 'Calm Ship', preview: 'The onboarding step is confusing.' })
    expect(events[0]!.deepLink).toBe('https://vibecodingtribe.com/c/showcases?thread=showcase')
    expect(events[1]!.kind).toBe('reply')
  })

  it('does not notify the author or treat feedback on a general post as showcase feedback', () => {
    const events = collectActivityDigestEvents([
      message({ id: 'post', profileId: recipient.accountId, clientId: recipient.realtimeClientId }),
      message({ id: 'self-reply', parentId: 'post', profileId: recipient.accountId, clientId: recipient.realtimeClientId, displayName: recipient.displayName }),
      message({ id: 'general-post', channelId: 'general', profileId: recipient.accountId, clientId: recipient.realtimeClientId }),
      message({ id: 'general-feedback', channelId: 'general', parentId: 'general-post', commentKind: 'feedback' }),
    ], recipient, 'https://vibecodingtribe.com')

    expect(events).toEqual([])
  })

  it('does not email tombstoned activity or activity on a removed post', () => {
    const events = collectActivityDigestEvents([
      message({ id: 'live-showcase', profileId: recipient.accountId, clientId: recipient.realtimeClientId, intent: 'showcase' }),
      message({ id: 'removed-reply', parentId: 'live-showcase', deletedAt: '2026-08-01T12:00:00.000Z', text: '', revisions: [{ revision: 1, createdAt: '2026-08-01T11:00:00.000Z', text: 'Removed' }] }),
      message({ id: 'removed-showcase', profileId: recipient.accountId, clientId: recipient.realtimeClientId, intent: 'showcase', deletedAt: '2026-08-01T12:00:00.000Z', text: '' }),
      message({ id: 'reply-on-removed', parentId: 'removed-showcase' }),
    ], recipient, 'https://vibecodingtribe.com')

    expect(events).toEqual([])
  })

  it('uses a deterministic UTC day', () => {
    expect(digestDay(new Date('2026-08-01T23:59:59.000Z'))).toBe('2026-08-01')
    expect(digestDay(new Date('2026-08-02T00:00:00.000Z'))).toBe('2026-08-02')
  })
})
