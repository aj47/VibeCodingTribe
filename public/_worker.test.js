import { afterEach, describe, expect, it, vi } from 'vitest'
import pagesWorker from './_worker.js'

describe('shared post metadata', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the source room in the canonical shared-post URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ post: {
      id: 'feedback_12345678',
      channelId: 'feedback',
      displayName: 'Ada Builder',
      text: 'Please review this build.',
    } })))
    const env = {
      ASSETS: {
        fetch: vi.fn(async () => new Response('<html><head><title>VibeCodingTribe</title></head><body></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        })),
      },
    }

    const response = await pagesWorker.fetch(new Request('https://vibecodingtribe.com/?post=feedback_12345678'), env)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('https://vibecodingtribe.com/?post=feedback_12345678&amp;channel=feedback')
  })
})
