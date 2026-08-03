import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installExchangeApiMock } from './test/exchange-api'
import { App } from './App'

describe('App community loop', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    installExchangeApiMock()
  })

  it('makes the community conversation the public home feed', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'What are you building?' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Community feed' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Tribe Wire' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LinkedIn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Local preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start local preview' })).toBeInTheDocument()
  })

  it('opens a shared post in its encoded room', () => {
    window.history.replaceState({}, '', '/?post=feedback_12345678&channel=feedback')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Builders who need your eyes' })).toBeInTheDocument()
  })

  it('resolves legacy shared links that do not encode a room', async () => {
    window.history.replaceState({}, '', '/?post=feedback_12345678')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/preview/post') return Response.json({ post: { id: 'feedback_12345678', channelId: 'feedback' } })
      return Response.json({ state: {} })
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Builders who need your eyes' })).toBeInTheDocument())
    expect(new URLSearchParams(window.location.search).get('channel')).toBe('feedback')
  })

  it('redirects the former chat route into the same main feed', async () => {
    window.history.replaceState({}, '', '/r/general')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.getByRole('region', { name: 'Community feed' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading messages…')
  })

  it('folds the former Missions view into General', () => {
    window.history.replaceState({}, '', '/missions')
    render(<App />)

    expect(window.location.pathname).toBe('/c/general')
    expect(screen.getByRole('heading', { name: 'What are you building?' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Community feed' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Channels' })).toHaveTextContent('General')
  })

  it('redirects the retired exchange route to General', async () => {
    window.history.replaceState({}, '', '/exchange')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/c/general'))
    expect(screen.getByRole('heading', { name: 'What are you building?' })).toBeInTheDocument()
  })

  it('preserves and consumes an OAuth session while redirecting the retired exchange route', () => {
    window.history.replaceState({}, '', '/exchange#vct_session=signed.callback-token')
    render(<App />)

    expect(window.location.pathname).toBe('/c/general')
    expect(window.location.hash).toBe('')
    expect(window.localStorage.getItem('vct-session-token-v1')).toBe('signed.callback-token')
  })

  it('shows OAuth callback failures after redirecting the retired exchange route', () => {
    window.history.replaceState({}, '', '/exchange?auth_error=Could+not+complete+linkedin+sign-in')
    render(<App />)

    expect(window.location.pathname).toBe('/c/general')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not complete linkedin sign-in')
  })

  it('opens agent setup from the community shell', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent access' }))

    expect(window.location.pathname).toBe('/invite-agent')
    expect(screen.getByRole('heading', { name: /Give your agent a key.*Keep a human accountable/i })).toBeInTheDocument()
  })

  it('renders the agent setup page directly', () => {
    window.history.replaceState({}, '', '/invite-agent')
    render(<App />)

    expect(screen.getByRole('heading', { name: /Give your agent a key.*Keep a human accountable/i })).toBeInTheDocument()
    expect(screen.getByText(/POST .*api\/agents\/enrollments/i)).toBeInTheDocument()
  })

  it('does not enable anonymous posting from a stale demo flag', () => {
    window.sessionStorage.setItem('vct-local-demo-v1', 'true')
    render(<App />)

    expect(screen.queryByRole('textbox', { name: 'Share what you are building' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Local preview' })).toBeInTheDocument()
  })

  it('enables the development composer through the explicit local preview', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Local preview' }))

    expect(screen.getByRole('textbox', { name: 'Share what you are building' })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('vct-community-preview-v1')).toBe('true')
  })
})
