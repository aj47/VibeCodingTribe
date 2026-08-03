import type { ActivityDigestEvent, ActivityDigestEventKind } from './notifications'

export interface TransactionalEmail {
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
  unsubscribeUrl: string
}

export interface TransactionalEmailProvider {
  send(email: TransactionalEmail): Promise<void>
}

export interface CloudflareEmailBinding {
  send(message: {
    to: string
    from: string
    subject: string
    html: string
    text: string
    replyTo?: string
    headers?: Record<string, string>
  }): Promise<unknown>
}

export interface ResendEmailProviderOptions {
  apiKey: string
  from: string
  replyTo?: string
  fetchImpl?: typeof fetch
}

export interface CloudflareEmailProviderOptions {
  binding: CloudflareEmailBinding
  from: string
  replyTo?: string
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function sectionTitle(kind: ActivityDigestEventKind) {
  return kind === 'feedback' ? 'Feedback on your work' : 'Replies to your posts'
}

function groupedEvents(events: ActivityDigestEvent[]) {
  return (['feedback', 'reply'] as const).map((kind) => ({
    kind,
    events: events.filter((event) => event.kind === kind),
  })).filter((section) => section.events.length > 0)
}

function pluralizeActivity(count: number) {
  return `${count} new ${count === 1 ? 'community update' : 'community updates'}`
}

function digestSettingsUrl(events: ActivityDigestEvent[], unsubscribeUrl: string) {
  try {
    return new URL('/settings/profile', events[0]?.deepLink ?? unsubscribeUrl).toString()
  } catch {
    return unsubscribeUrl
  }
}

export function activityDigestEmail(
  recipientName: string,
  day: string,
  events: ActivityDigestEvent[],
  idempotencyKey: string,
  unsubscribeUrl: string,
): TransactionalEmail {
  const sections = groupedEvents(events)
  const activityLabel = pluralizeActivity(events.length)
  const activityVerb = events.length === 1 ? 'is' : 'are'
  const settingsUrl = digestSettingsUrl(events, unsubscribeUrl)
  const subject = `Vibe Coding Tribe · ${activityLabel}`
  const textSections = sections.map(({ kind, events: sectionEvents }) => [
    sectionTitle(kind),
    ...sectionEvents.map((event) => `- ${event.actorDisplayName} on ${event.parentTitle}\n  ${event.preview}\n  View activity: ${event.deepLink}`),
  ].join('\n')).join('\n\n')
  const htmlSections = sections.map(({ kind, events: sectionEvents }) => `
    <tr><td style="padding:22px 0 8px;color:#667085;font:700 11px/16px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(sectionTitle(kind))}</td></tr>
    ${sectionEvents.map((event) => `<tr><td style="padding:0 0 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e4e7ec;border-radius:10px;background:#ffffff">
        <tr><td style="padding:18px 18px 8px;color:#101828;font:700 15px/21px Arial,sans-serif">${escapeHtml(event.parentTitle)}</td></tr>
        <tr><td style="padding:0 18px 10px;color:#475467;font:400 13px/19px Arial,sans-serif"><strong style="color:#344054">${escapeHtml(event.actorDisplayName)}</strong> joined the conversation</td></tr>
        <tr><td style="padding:0 18px 16px;color:#344054;font:400 14px/21px Arial,sans-serif">${escapeHtml(event.preview)}</td></tr>
        <tr><td style="padding:0 18px 18px"><a href="${escapeHtml(event.deepLink)}" style="display:inline-block;padding:10px 14px;border-radius:6px;background:#176b4c;color:#ffffff;font:700 13px/16px Arial,sans-serif;text-decoration:none">View activity</a></td></tr>
      </table>
    </td></tr>`).join('')}`).join('')
  return {
    to: '',
    subject,
    idempotencyKey,
    unsubscribeUrl,
    text: `VIBE CODING TRIBE\n${activityLabel.toUpperCase()} · ${day}\n\nHi ${recipientName}, there is fresh activity around your work.\n\n${textSections}\n\nNotification settings: ${settingsUrl}\nStop only daily activity emails: ${unsubscribeUrl}\n\nThis is a transactional activity digest for your Vibe Coding Tribe account.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f4f6f5"><span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(activityLabel)} around your Vibe Coding Tribe work.</span><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f6f5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
      <tr><td style="padding:0 4px 18px;color:#176b4c;font:700 12px/16px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase">Vibe Coding Tribe</td></tr>
      <tr><td style="padding:28px 26px 24px;border-radius:12px 12px 0 0;background:#173d31;color:#ffffff"><p style="margin:0 0 8px;color:#b9e0cf;font:700 11px/16px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">Community update · ${escapeHtml(day)}</p><h1 style="margin:0;color:#ffffff;font:700 27px/33px Arial,sans-serif">There’s fresh activity around your work.</h1><p style="margin:12px 0 0;color:#d7eee3;font:400 15px/22px Arial,sans-serif">Hi ${escapeHtml(recipientName)}, ${escapeHtml(activityLabel)} ${activityVerb} ready to catch up on.</p></td></tr>
      <tr><td style="padding:0 26px 26px;border-radius:0 0 12px 12px;background:#ffffff"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlSections}</table><p style="margin:18px 0 0;color:#667085;font:400 12px/18px Arial,sans-serif">This is a transactional activity digest. <a href="${escapeHtml(settingsUrl)}" style="color:#475467;text-decoration:underline">Notification settings</a> · <a href="${escapeHtml(unsubscribeUrl)}" style="color:#475467;text-decoration:underline">Stop daily activity emails</a></p></td></tr>
      <tr><td style="padding:18px 4px 0;color:#98a2b3;font:400 11px/16px Arial,sans-serif">Vibe Coding Tribe · built conversations, shipped together</td></tr>
    </table></td></tr></table></body></html>`,
  }
}

export class ResendEmailProvider implements TransactionalEmailProvider {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: ResendEmailProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async send(email: TransactionalEmail) {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}),
        headers: { 'List-Unsubscribe': `<${email.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    })
    if (!response.ok) throw new Error(`Transactional email provider returned ${response.status}`)
  }
}

/**
 * Cloudflare Email Service is the production provider. The digest ledger keeps
 * the deterministic key at the application boundary; the custom header also
 * makes that key visible in Email Service logs for operational deduplication.
 */
export class CloudflareEmailProvider implements TransactionalEmailProvider {
  constructor(private readonly options: CloudflareEmailProviderOptions) {}

  async send(email: TransactionalEmail) {
    await this.options.binding.send({
      to: email.to,
      from: this.options.from,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(this.options.replyTo ? { replyTo: this.options.replyTo } : {}),
      headers: {
        'X-VCT-Digest-Key': email.idempotencyKey,
        'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
  }
}
