import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installExchangeApiMock } from '../test/exchange-api'
import { ExchangeApp } from './ExchangeApp'

describe('ExchangeApp', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installExchangeApiMock()
  })

  it('runs the complete two-builder happy path through the exchange API', async () => {
    const api = installExchangeApiMock()
    const requesterView = render(<ExchangeApp signedIn authenticatedUserId="user_a" onOpenRoom={vi.fn()} onSignIn={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'You’re ready to request feedback.' })).toBeInTheDocument()
    expect(screen.getByText('10', { selector: '.account-balance strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Request feedback/i }))
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Release Candidate' } })
    fireEvent.change(screen.getByLabelText(/Product URL/), { target: { value: 'https://product.test' } })
    fireEvent.change(screen.getByLabelText(/Tell builders about it/), { target: { value: 'A product ready for testing.' } })
    fireEvent.change(screen.getByLabelText(/Request title/), { target: { value: 'Test the first-run experience' } })
    fireEvent.change(screen.getByLabelText(/Anything you want someone to try/), { target: { value: 'Create an account and complete onboarding.' } })
    fireEvent.change(screen.getByLabelText(/What would be useful to hear back/), { target: { value: 'Onboarding completes without confusion.' } })
    fireEvent.click(screen.getByRole('button', { name: /Publish and fund/i }))
    expect(await screen.findByText(/10 credits are secured in server escrow/i)).toBeInTheDocument()

    requesterView.unmount()
    api.actAs('user_b')
    const testerView = render(<ExchangeApp signedIn authenticatedUserId="user_b" onOpenRoom={vi.fn()} onSignIn={vi.fn()} />)
    const giveFeedbackButton = await screen.findByRole('button', { name: /Give feedback/i })
    await waitFor(() => expect(giveFeedbackButton).toBeEnabled())
    fireEvent.click(giveFeedbackButton)
    expect(await screen.findByRole('heading', { name: 'What did you notice?' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Your note/), { target: { value: 'The confirmation disappears too quickly. Keep the success state visible.' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit feedback/i }))
    expect(await screen.findByText(/requester now has a review/i)).toBeInTheDocument()

    testerView.unmount()
    api.actAs('user_a')
    render(<ExchangeApp signedIn authenticatedUserId="user_a" onOpenRoom={vi.fn()} onSignIn={vi.fn()} />)
    const acceptButton = await screen.findByRole('button', { name: 'Accept feedback' })
    await waitFor(() => expect(acceptButton).toBeEnabled())
    fireEvent.click(acceptButton)
    expect(await screen.findByText(/8 credits transferred to Tester Two/i)).toBeInTheDocument()
    const convertButton = screen.getByRole('button', { name: 'Convert to tasks' })
    await waitFor(() => expect(convertButton).toBeEnabled())
    fireEvent.click(convertButton)

    expect(await screen.findByRole('heading', { name: 'Draft development tasks' })).toBeInTheDocument()
    expect(screen.getByText('Review: The confirmation disappears too quickly. Keep the success state visible.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/No repository was accessed/i)).toBeInTheDocument())
  })

  it('makes the credit requirement obvious after funding a request', async () => {
    render(<ExchangeApp signedIn authenticatedUserId="user_a" onOpenRoom={vi.fn()} onSignIn={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Request feedback/i }))
    fireEvent.click(screen.getByRole('button', { name: /Publish and fund/i }))

    expect(await screen.findByRole('heading', { name: 'Your feedback request is live.' })).toBeInTheDocument()
    expect(screen.getByText('0/10 credits toward your next feedback request')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request feedback/i })).toBeDisabled()
    expect(screen.getByText(/ready for another builder to claim/i)).toBeInTheDocument()
  })

  it('shows submitted projects in history and opens their details', async () => {
    render(<ExchangeApp signedIn authenticatedUserId="user_a" onOpenRoom={vi.fn()} onSignIn={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Request feedback/i }))
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Launchpad' } })
    fireEvent.change(screen.getByLabelText(/Request title/), { target: { value: 'Try the invite flow' } })
    fireEvent.click(screen.getByRole('button', { name: /Publish and fund/i }))
    expect(await screen.findByRole('heading', { name: 'Your feedback request is live.' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Exchange navigation' })).getByRole('button', { name: /History/i }))
    expect(await screen.findByRole('heading', { name: 'Feedback history' })).toBeInTheDocument()
    expect(screen.getByText('Projects submitted for feedback')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Try the invite flow.*Launchpad/i }))

    expect(await screen.findByRole('dialog', { name: /Try the invite flow/i })).toBeInTheDocument()
    expect(screen.getByText('WHAT TESTERS WERE ASKED TO TRY')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('requires authentication before loading exchange data', async () => {
    const onSignIn = vi.fn()
    render(<ExchangeApp signedIn={false} onOpenRoom={vi.fn()} onSignIn={onSignIn} />)

    expect(await screen.findByRole('heading', { name: 'Connect to the exchange' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with LinkedIn' }))
    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
