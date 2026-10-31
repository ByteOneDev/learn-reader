import { useEffect } from 'react'
import { useApp } from './store'

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Raccourcis clavier façon lecteur RSS : j/k, l, b, f, m, o, r, /, [, h. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const s = useApp.getState()
      if (s.dialog || !s.settings?.onboarded) return
      const item = s.item
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          s.move(1)
          break
        case 'k':
        case 'ArrowUp':
          s.move(-1)
          break
        case 'l':
          if (item) void s.patchItem(item.id, { later: !item.later })
          break
        case 'b':
          if (item) void s.patchItem(item.id, { bookmarked: !item.bookmarked })
          break
        case 'f':
          if (item) void s.patchItem(item.id, { favorite: !item.favorite })
          break
        case 'm':
          if (item) void s.patchItem(item.id, { read: !item.read })
          break
        case 'o':
        case 'v':
          if (item?.url) void s.api.openExternal(item.url)
          break
        case 'r':
          void s.refresh()
          break
        case 'h':
          if (item) s.togglePanel()
          break
        case '[':
          s.toggleSidebar()
          break
        case 'z':
          s.toggleFocus()
          break
        case 't':
          if (item) window.dispatchEvent(new Event('learn:edit-tags'))
          break
        case '/':
          window.dispatchEvent(new Event('learn:focus-search'))
          break
        case 'Escape':
          if (s.panelOpen) s.togglePanel(false)
          else if (s.focusMode) s.toggleFocus(false)
          else void s.select(null)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
