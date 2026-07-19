import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof window.localStorage?.clear !== 'function') {
  class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length() {
      return this.values.size
    }

    clear() {
      this.values.clear()
    }

    getItem(key: string) {
      return this.values.get(key) ?? null
    }

    key(index: number) {
      return [...this.values.keys()][index] ?? null
    }

    removeItem(key: string) {
      this.values.delete(key)
    }

    setItem(key: string, value: string) {
      this.values.set(key, value)
    }
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 0)
}

if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
