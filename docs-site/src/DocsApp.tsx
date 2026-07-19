import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Github,
  Hash,
  Menu,
  MessageSquareText,
  Radio,
  Search,
  X,
} from 'lucide-react'
import { docGroups, docs, findDoc } from './content'

const APP_URL = 'https://vibecodingtribe.com/'
const GITHUB_URL = 'https://github.com/aj47/VibeCodingTribe'
const HEALTH_URL = 'https://vibecodingtribe-realtime.techfren.workers.dev/health'

function pathFor(slug: string) {
  return slug ? `/${slug}` : '/'
}

function Brand() {
  return <a className="docs-brand" href="/" data-doc-link aria-label="VibeCodingTribe documentation home">
    <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 7.5h18M5 14h12M5 20.5h18"/><circle cx="22" cy="14" r="2.5"/></svg>
    <span>vibecoding<span>tribe</span></span><em>docs</em>
  </a>
}

function SearchDialog({ onClose, onNavigate }: { onClose: () => void; onNavigate: (slug: string) => void }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => {
    const needle = query.toLowerCase().trim()
    if (!needle) return docs.slice(0, 7)
    return docs.filter((doc) => `${doc.title} ${doc.summary} ${doc.searchText}`.toLowerCase().includes(needle)).slice(0, 8)
  }, [query])

  useEffect(() => inputRef.current?.focus(), [])

  return <div className="search-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title">
      <h2 className="sr-only" id="search-title">Search documentation</h2>
      <div className="search-dialog__input"><Search size={18}/><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guides, concepts, commands…" aria-label="Search documentation"/><button type="button" onClick={onClose} aria-label="Close search"><X size={17}/></button></div>
      <div className="search-dialog__meta"><span>{query ? `${results.length} matching pages` : 'Suggested pages'}</span><kbd>esc</kbd></div>
      <div className="search-results">
        {results.map((doc) => <button key={doc.slug} type="button" onClick={() => onNavigate(doc.slug)}>
          <span><small>{doc.group}</small><strong>{doc.title}</strong><em>{doc.summary}</em></span><ChevronRight size={17}/>
        </button>)}
        {results.length === 0 && <div className="search-empty"><Search size={22}/><strong>No matching page</strong><span>Try a product concept, command, or system name.</span></div>}
      </div>
    </section>
  </div>
}

function Sidebar({ currentSlug, open, onClose }: { currentSlug: string; open: boolean; onClose: () => void }) {
  return <>
    {open && <button className="sidebar-scrim is-open" type="button" aria-label="Dismiss navigation overlay" onClick={onClose}/>}
    <aside className={`docs-sidebar ${open ? 'is-open' : ''}`}>
      <div className="docs-sidebar__brand"><Brand/><button type="button" onClick={onClose} aria-label="Close navigation"><X size={18}/></button></div>
      <nav aria-label="Documentation">
        {docGroups.map((group) => <section key={group}>
          <h2>{group}</h2>
          {docs.filter((doc) => doc.group === group).map((doc) => <a key={doc.slug} href={pathFor(doc.slug)} data-doc-link aria-current={doc.slug === currentSlug ? 'page' : undefined}>
            <span>{doc.title}</span>{doc.slug === currentSlug && <i/>}
          </a>)}
        </section>)}
      </nav>
      <div className="docs-sidebar__foot"><span>Open source</span><a href={GITHUB_URL}>View repository <ExternalLink size={13}/></a></div>
    </aside>
  </>
}

function LiveRail({ status }: { status: 'checking' | 'online' | 'degraded' }) {
  return <div className="live-rail">
    <div><Radio size={15}/><span>LIVE ROOM</span></div>
    <code>aj47/VibeCodingTribe</code><i>/</i><strong>#general</strong>
    <em className={`live-rail__status live-rail__status--${status}`}><span/>{status === 'checking' ? 'checking' : status}</em>
  </div>
}

export function DocsApp() {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [status, setStatus] = useState<'checking' | 'online' | 'degraded'>('checking')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const found = findDoc(pathname)
  const current = found ?? docs[0]
  const currentIndex = docs.findIndex((doc) => doc.slug === current.slug)
  const previous = currentIndex > 0 ? docs[currentIndex - 1] : null
  const next = currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null

  const navigate = (slug: string) => {
    const nextPath = pathFor(slug)
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setPathname(nextPath)
    setSearchOpen(false)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-doc-link]')
      if (!anchor || anchor.origin !== window.location.origin) return
      event.preventDefault()
      navigate(anchor.pathname.replace(/^\//, ''))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setSidebarOpen(false)
      }
    }
    window.addEventListener('popstate', onPopState)
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  })

  useEffect(() => {
    document.title = `${current.title} · VibeCodingTribe Docs`
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description) description.content = current.summary
  }, [current])

  useEffect(() => {
    let active = true
    fetch(HEALTH_URL).then((response) => {
      if (!response.ok) throw new Error('Health check failed')
      return response.json() as Promise<{ status?: string }>
    }).then((payload) => { if (active) setStatus(payload.status === 'ok' ? 'online' : 'degraded') })
      .catch(() => { if (active) setStatus('degraded') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onCopy = async (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]')
      if (!button) return
      const block = button.closest<HTMLElement>('[data-code]')
      const code = block?.dataset.code
      if (!code) return
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      window.setTimeout(() => setCopiedCode((value) => value === code ? null : value), 1600)
    }
    document.addEventListener('click', onCopy)
    return () => document.removeEventListener('click', onCopy)
  }, [])

  useEffect(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-code]')) {
      const code = button.closest<HTMLElement>('[data-code]')?.dataset.code
      button.textContent = code && copiedCode === code ? 'Copied' : 'Copy'
    }
  }, [copiedCode, pathname])

  return <div className="docs-shell">
    <Sidebar currentSlug={current.slug} open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>
    <header className="docs-topbar">
      <button className="mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" aria-expanded={sidebarOpen}><Menu size={19}/></button>
      <div className="mobile-brand"><Brand/></div>
      <button className="docs-search" type="button" onClick={() => setSearchOpen(true)} aria-label="Search documentation"><Search size={15}/><span>Search documentation</span><kbd>⌘ K</kbd></button>
      <nav aria-label="External links"><a href={GITHUB_URL}><Github size={16}/><span>GitHub</span></a><a className="open-app" href={APP_URL}><MessageSquareText size={15}/>Open app</a></nav>
    </header>

    <main className="docs-main">
      <LiveRail status={status}/>
      {!found && <div className="not-found"><Hash size={20}/><span>That route is not documented. Showing the overview.</span></div>}
      <div className="docs-layout">
        <article className="docs-article">
          <header className="article-hero">
            <div className="article-hero__eyebrow"><span>{current.eyebrow}</span><i/>{current.readingTime}</div>
            <h1>{current.title}</h1>
            <p>{current.summary}</p>
            {current.slug === '' && <div className="article-hero__actions"><a href="/quickstart" data-doc-link>Start building <ArrowRight size={15}/></a><a href={APP_URL}>Open live room <ExternalLink size={14}/></a></div>}
          </header>
          <div className="article-sections">
            {current.sections.map((section) => <section id={section.id} key={section.id}>
              <a className="section-anchor" href={`#${section.id}`} aria-label={`Link to ${section.title}`}><Hash size={17}/></a>
              <h2>{section.title}</h2>
              <div className="section-body">{section.body}</div>
            </section>)}
          </div>
          <footer className="article-footer">
            <div><BookOpen size={16}/><span>Found something unclear?</span><a href={`${GITHUB_URL}/issues/new`}>Open a documentation issue</a></div>
            <nav aria-label="Pagination">
              {previous ? <a href={pathFor(previous.slug)} data-doc-link><ArrowLeft size={16}/><span><small>Previous</small>{previous.title}</span></a> : <span/>}
              {next && <a href={pathFor(next.slug)} data-doc-link><span><small>Next</small>{next.title}</span><ArrowRight size={16}/></a>}
            </nav>
          </footer>
        </article>
        <aside className="on-this-page"><strong>On this page</strong><nav>{current.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav><div><Check size={14}/><span>Verified against<br/><code>main</code></span></div></aside>
      </div>
    </main>
    {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} onNavigate={navigate}/>} 
  </div>
}
