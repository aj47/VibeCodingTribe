import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveTheme } from '../theme'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('restores the saved theme and persists the next choice', () => {
    saveTheme('dark')
    render(<ThemeToggle />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    const toggle = screen.getByRole('button', { name: 'Switch to light mode' })
    fireEvent.click(toggle)

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('vct-theme-v1')).toBe('light')
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument()
  })
})
