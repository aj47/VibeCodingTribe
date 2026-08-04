import { afterEach, describe, expect, it, vi } from 'vitest'
// The Pages worker is authored as deployable JavaScript rather than application TypeScript.
// @ts-expect-error JavaScript worker exports do not have generated declarations.
import pagesWorker from '../public/_worker.js'

afterEach(() => vi.unstubAllGlobals())

describe('shared post metadata', () => {
  it('exposes an attached build URL to crawler and agent clients', async () => {
    const post = {
      id: 'post_12345678',
      displayName: 'Builder',
      handle: 'builder',
      text: 'replmux - jupyter kernels in your CLI.',
      buildName: 'replmux',
      buildUrl: 'https://github.com/memgrafter/replmux',
      linkPreview: { url: 'https://github.com/memgrafter/replmux' },
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ post })))
    const env = {
      ASSETS: {
        fetch: async () => new Response('<html><head><title>VibeCodingTribe</title></head><body><div id="root"></div></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      },
    }

    const response = await pagesWorker.fetch(new Request('https://vibecodingtribe.com/?post=post_12345678'), env)
    const html = await response.text()

    expect(html).toContain('Attached link: https://github.com/memgrafter/replmux')
    expect(html).toContain('property="og:see_also" content="https://github.com/memgrafter/replmux"')
  })
})
