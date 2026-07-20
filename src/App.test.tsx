import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { installExchangeApiMock } from './test/exchange-api'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    installExchangeApiMock()
  })

  it('introduces the testing exchange and keeps both identity providers', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /Find real testers.*Join the tribe/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Find testers for your product/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tribe Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue with GitHub/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue with LinkedIn/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Real testers. Useful evidence.' })).toBeInTheDocument()
  })

  it('opens the public room without auth and gates only posting', () => {
    window.history.replaceState({}, '', '/r/general')
    render(<App />)

    expect(screen.getByRole('main')).toHaveClass('live-layout')
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.getByText(/Everyone’s shared room.*sign in to post/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tribe Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Missions' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sign in to send messages' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LinkedIn' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message general' })).not.toBeInTheDocument()
  })

  it('opens the agent setup page from the public landing page', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Invite your agent' }))

    expect(window.location.pathname).toBe('/invite-agent')
    expect(screen.getByRole('heading', { name: /Give your agent a key.*Keep a human accountable/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy full prompt' })).toBeInTheDocument()
    expect(screen.getByText(/Your human account is the trust anchor/i)).toBeInTheDocument()
  })

  it('renders the agent setup page directly', () => {
    window.history.replaceState({}, '', '/invite-agent')
    render(<App />)

    expect(screen.getByRole('heading', { name: /Give your agent a key.*Keep a human accountable/i })).toBeInTheDocument()
    expect(screen.getByText(/POST .*api\/agents\/enrollments/i)).toBeInTheDocument()
  })

  it('canonicalizes the removed app route to the public root', async () => {
    window.history.replaceState({}, '', '/app')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('requires sign-in when opening the testing exchange', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Find testers for your product/i }))

    expect(window.location.pathname).toBe('/exchange')
    expect(await screen.findByRole('heading', { name: 'Connect to the exchange' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with LinkedIn' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('exchange-service-state')
    await waitFor(() => {
      expect(window.localStorage.getItem('vct-workspace-v3')).toBeNull()
      expect(window.localStorage.getItem('vct-realtime-profile-v1')).toBeNull()
      expect(window.localStorage.getItem('vct-realtime-outbox-v1')).toBeNull()
    })
  })

  it('does not enable anonymous posting from a stale demo flag', () => {
    window.sessionStorage.setItem('vct-local-demo-v1', 'true')
    window.history.replaceState({}, '', '/r/general')
    render(<App />)

    expect(screen.getByRole('region', { name: 'Sign in to send messages' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message general' })).not.toBeInTheDocument()
  })
})
