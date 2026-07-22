export type Theme = 'light' | 'dark'

const THEME_KEY = 'vct-theme-v1'

function storedTheme(): Theme | null {
  const value = window.localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

function systemTheme(): Theme {
  // Optional chaining keeps this safe where matchMedia is unavailable (jsdom, older browsers).
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

/** Explicit choice wins, otherwise follow the OS preference. */
export function loadTheme(): Theme {
  return storedTheme() ?? systemTheme()
}

export function saveTheme(theme: Theme) {
  window.localStorage.setItem(THEME_KEY, theme)
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}
