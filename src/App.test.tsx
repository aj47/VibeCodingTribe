import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('opens and filters the quick switcher from the keyboard', async () => {
    render(<App />)

    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Jump to anything' })
    const search = screen.getByRole('textbox', { name: 'Search everything' })
    expect(dialog).toBeInTheDocument()

    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'Start an agent' } })

    expect(screen.getByRole('option', { name: /Start an agent/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Connect a repository/ })).not.toBeInTheDocument()
  })
})
