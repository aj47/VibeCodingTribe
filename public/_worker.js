const REALTIME_ORIGIN = 'https://vibecodingtribe-realtime.techfren.workers.dev'
const POST_ID_PATTERN = /^[a-zA-Z0-9:_-]{8,160}$/

function validPostId(value) {
  return typeof value === 'string' && POST_ID_PATTERN.test(value) ? value : null
}

async function loadPost(id) {
  try {
    const response = await fetch(`${REALTIME_ORIGIN}/api/preview/post?id=${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return null
    const body = await response.json()
    return body && body.post ? body.post : null
  } catch {
    return null
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(value, length) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1).trimEnd()}…` : normalized
}

function wrapText(value, maxCharacters, maxLines) {
  const words = truncate(value, 260).split(' ').filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    if ((current + (current ? ' ' : '') + word).length > maxCharacters && current) {
      lines.push(current)
      current = word
    } else {
      current += `${current ? ' ' : ''}${word}`
    }
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && current) lines.push(current)
  return lines.slice(0, maxLines)
}

function postLabel(post) {
  if (post.intent === 'needs_feedback') return 'FEEDBACK REQUEST'
  if (post.intent === 'showcase' || post.intent === 'update') return 'SHOWCASE'
  return 'COMMUNITY NOTE'
}

function renderOgImage(post) {
  const author = truncate(post.displayName || post.handle || 'Builder', 48)
  const lines = wrapText(post.text || post.buildName || 'A new build from the workshop.', 43, 4)
  const textNodes = lines.map((line, index) => `<text x="88" y="${300 + index * 43}" fill="#f3f6f1" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700">${escapeHtml(line)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101712"/><stop offset="1" stop-color="#23392a"/></linearGradient>
    <pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="#b4d8bd" stroke-opacity=".08"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <circle cx="1085" cy="80" r="170" fill="#8bd3a2" fill-opacity=".12"/>
  <circle cx="1120" cy="70" r="92" fill="none" stroke="#8bd3a2" stroke-opacity=".35" stroke-width="2"/>
  <path d="M88 92 118 138 148 92" fill="none" stroke="#75d094" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="88" cy="92" r="11" fill="#101712" stroke="#75d094" stroke-width="7"/>
  <circle cx="148" cy="92" r="11" fill="#101712" stroke="#75d094" stroke-width="7"/>
  <circle cx="118" cy="138" r="11" fill="#101712" stroke="#75d094" stroke-width="7"/>
  <text x="180" y="116" fill="#f3f6f1" font-family="Arial, Helvetica, sans-serif" font-size="33" font-weight="700">VibeCoding<tspan fill="#75d094">Tribe</tspan></text>
  <text x="88" y="208" fill="#8bd3a2" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" letter-spacing="3">${postLabel(post)}</text>
  ${textNodes}
  <text x="88" y="535" fill="#b7c6b9" font-family="Arial, Helvetica, sans-serif" font-size="20">${escapeHtml(author)} · shared from the workshop</text>
  <rect x="88" y="570" width="1024" height="2" fill="#75d094" fill-opacity=".45"/>
</svg>`
}

function metaTag(kind, value) {
  return `<meta ${kind.startsWith('twitter:') || kind === 'description' ? 'name' : 'property'}="${escapeHtml(kind)}" content="${escapeHtml(value)}">`
}

function injectPostMetadata(html, requestUrl, post, imageUrl) {
  const title = truncate(post.text || post.buildName || `${post.displayName || 'Builder'} shared a post`, 180)
  const description = truncate(post.text || `${post.displayName || 'A builder'} shared a ${postLabel(post).toLowerCase()} in the VibeCodingTribe workshop.`, 320)
  const canonical = new URL(requestUrl)
  canonical.search = `?post=${encodeURIComponent(post.id)}`
  const values = {
    description,
    'og:type': 'article',
    'og:site_name': 'VibeCodingTribe',
    'og:title': title,
    'og:description': description,
    'og:url': canonical.href,
    'og:image': imageUrl,
    'og:image:type': 'image/svg+xml',
    'og:image:width': '1200',
    'og:image:height': '630',
    'og:image:alt': `${title} — VibeCodingTribe`,
    'twitter:card': 'summary_large_image',
    'twitter:title': title,
    'twitter:description': description,
    'twitter:image': imageUrl,
    'twitter:image:alt': `${title} — VibeCodingTribe`,
  }
  const keys = Object.keys(values).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const managedTags = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["'](?:${keys})["'][^>]*>\\s*`, 'gi')
  let output = html.replace(managedTags, '')
  output = output.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)} · VibeCodingTribe</title>`)
  const tags = Object.entries(values).map(([key, value]) => metaTag(key, value)).join('\n    ')
  output = output.replace(/<\/head>/i, `    ${tags}\n  </head>`)
  return output
}

async function staticAsset(request, env, path = null) {
  if (!path) return env.ASSETS.fetch(request)
  return env.ASSETS.fetch(new Request(new URL(path, request.url), request))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const postId = validPostId(url.searchParams.get('post'))

    if (url.pathname === '/og/post' && request.method === 'GET') {
      const id = validPostId(url.searchParams.get('id'))
      const post = id ? await loadPost(id) : null
      if (!post) return staticAsset(request, env, '/og-image.png')
      return new Response(renderOgImage(post), {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=300',
          'Content-Type': 'image/svg+xml; charset=UTF-8',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    if (postId && request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const post = await loadPost(postId)
      const asset = await staticAsset(request, env)
      if (!post || !asset.headers.get('content-type')?.includes('text/html')) return asset
      const imageUrl = new URL(`/og/post?id=${encodeURIComponent(postId)}`, request.url).href
      const headers = new Headers(asset.headers)
      headers.set('Cache-Control', 'public, max-age=60, s-maxage=300')
      headers.set('Content-Type', 'text/html; charset=UTF-8')
      return new Response(injectPostMetadata(await asset.text(), request.url, post, imageUrl), { status: asset.status, headers })
    }

    return staticAsset(request, env)
  },
}
