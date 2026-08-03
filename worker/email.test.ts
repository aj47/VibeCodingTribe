import { describe, expect, it, vi } from 'vitest'
import { activityDigestEmail, CloudflareEmailProvider, ResendEmailProvider } from './email'
import type { ActivityDigestEvent } from './notifications'

const events: ActivityDigestEvent[] = [{
  id: 'activity:reply:showcases:reply-1',
  kind: 'reply',
  channelId: 'showcases',
  parentId: 'post-1',
  createdAt: '2026-08-01T10:00:00.000Z',
  actorDisplayName: 'Grace Builder',
  parentTitle: 'My launch',
  preview: 'This is a helpful thought.',
  deepLink: 'https://vibecodingtribe.com/c/showcases?thread=post-1',
}]

describe('activity digest email', () => {
  it('renders compact community-update cards with durable CTA and preference links', () => {
    const email = activityDigestEmail('Ada Builder', '2026-08-01', events, 'activity-digest:human_ada:2026-08-01', 'https://worker.example/notifications/activity-digest/unsubscribe?token=signed')
    expect(email.subject).toContain('1 new community update')
    expect(email.text).toContain('This is a helpful thought.')
    expect(email.text).toContain('Notification settings: https://vibecodingtribe.com/settings/profile')
    expect(email.html).toContain('Vibe Coding Tribe')
    expect(email.html).toContain('View activity')
    expect(email.html).toContain('https://vibecodingtribe.com/c/showcases?thread=post-1')
    expect(email.html).toContain('My launch')
    expect(email.html).toContain('Grace Builder</strong> joined the conversation')
    expect(email.html).toContain('role="presentation"')
    expect(email.html).toContain('Notification settings')
    expect(email.html).toContain('Stop daily activity emails')
  })

  it('passes the deterministic key to Cloudflare Email Service', async () => {
    const send = vi.fn(async () => ({ messageId: 'msg_1' }))
    const provider = new CloudflareEmailProvider({ binding: { send }, from: 'Vibe Coding Tribe <mail@example.com>' })
    const email = activityDigestEmail('Ada', '2026-08-01', events, 'digest-key', 'https://worker.example/unsubscribe?token=signed')
    await provider.send({ ...email, to: 'ada@example.com' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ada@example.com',
      from: 'Vibe Coding Tribe <mail@example.com>',
      headers: expect.objectContaining({ 'X-VCT-Digest-Key': 'digest-key', 'List-Unsubscribe': '<https://worker.example/unsubscribe?token=signed>' }),
    }))
  })

  it('uses the same key for an alternate Resend-compatible provider', async () => {
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    const provider = new ResendEmailProvider({ apiKey: 'test-key', from: 'mail@example.com', fetchImpl: fetchImpl as unknown as typeof fetch })
    const email = activityDigestEmail('Ada', '2026-08-01', events, 'digest-key', 'https://worker.example/unsubscribe?token=signed')
    await provider.send({ ...email, to: 'ada@example.com' })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': 'digest-key' }),
    }))
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({ headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  })
})
