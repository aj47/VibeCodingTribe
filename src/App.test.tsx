import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
    expect(screen.getByRole('complementary', { name: 'Tribe Wire' })).toHaveTextContent(/same community stream.*not a separate chat room/i)
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LinkedIn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Local preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start local preview' })).toBeInTheDocument()
  })

  it('redirects the former chat route into the same main feed', async () => {
    window.history.replaceState({}, '', '/r/general')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.getByRole('region', { name: 'Community feed' })).toBeInTheDocument()
    expect(screen.getByText(/conversation that used to live in Tribe Chat/i)).toBeInTheDocument()
  })

  it('uses Missions as the Needs Feedback view of the same feed', () => {
    window.history.replaceState({}, '', '/missions')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Builders who need your eyes' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Posts needing feedback' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Needs feedback' })[0]).toHaveClass('is-active')
  })

  it('redirects the retired exchange route to Needs Feedback', async () => {
    window.history.replaceState({}, '', '/exchange')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/missions'))
    expect(screen.getByRole('heading', { name: 'Builders who need your eyes' })).toBeInTheDocument()
  })

  it('preserves and consumes an OAuth session while redirecting the retired exchange route', () => {
    window.history.replaceState({}, '', '/exchange#vct_session=signed.callback-token')
    render(<App />)

    expect(window.location.pathname).toBe('/missions')
    expect(window.location.hash).toBe('')
    expect(window.localStorage.getItem('vct-session-token-v1')).toBe('signed.callback-token')
  })

  it('shows OAuth callback failures after redirecting the retired exchange route', () => {
    window.history.replaceState({}, '', '/exchange?auth_error=Could+not+complete+linkedin+sign-in')
    render(<App />)

    expect(window.location.pathname).toBe('/missions')
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
