import { useEffect } from 'react'
import { comboFromEvent, effectiveShortcuts, formatCombo, shortcutMap, type ShortcutAction } from '@shared/shortcuts'
import { useApp } from './store'

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Touche affichée d'une action (infobulles, aide), selon les réglages. */
export function useKeyLabel(action: ShortcutAction): string {
  const custom = useApp((s) => s.settings?.shortcuts)
  const mac = useApp((s) => s.api.platform === 'darwin')
  return formatCombo(effectiveShortcuts(custom)[action], mac)
}

/** Raccourcis clavier façon lecteur RSS (j/k, l, b, f…), personnalisables dans les Réglages. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e) || e.isComposing) return
      const s = useApp.getState()
      if (s.dialog || !s.settings?.onboarded) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = shortcutMap(s.settings.shortcuts).get(combo)
      if (!action) return
      // Dans un board, les touches simples appartiennent à l'éditeur (outils Excalidraw : r, o, l, h…, flèches,
      // Échap). Restent à Learn : les combinaisons avec ⌘/Ctrl, et la barre latérale hors du dessin.
      if (s.view.type === 'board') {
        const withMod = combo.startsWith('Cmd+') || combo.startsWith('Ctrl+')
        const inSketch = !!(e.target as HTMLElement | null)?.closest?.('.excalidraw')
        if (!withMod && !(action === 'sidebar' && !inSketch)) return
        if (action === 'next' || action === 'prev' || action === 'escape') return
      }
      const item = s.item
      switch (action) {
        case 'next':
          s.move(1)
          break
        case 'prev':
          s.move(-1)
          break
        case 'later':
          if (item) void s.patchItem(item.id, { later: !item.later })
          break
        case 'bookmark':
          if (item) void s.patchItem(item.id, { bookmarked: !item.bookmarked })
          break
        case 'favorite':
          if (item) void s.patchItem(item.id, { favorite: !item.favorite })
          break
        case 'read':
          if (item) void s.patchItem(item.id, { read: !item.read })
          break
        case 'open':
          if (item?.url) void s.api.openExternal(item.url)
          break
        case 'refresh':
          void s.refresh()
          break
        case 'panel':
          if (item) s.togglePanel()
          break
        case 'sidebar':
          s.toggleSidebar()
          break
        case 'focus':
          s.toggleFocus()
          break
        case 'tags':
          if (item) window.dispatchEvent(new Event('learn:edit-tags'))
          break
        case 'grouping':
          void s.updateSettings({ sidebarGroup: (s.settings.sidebarGroup ?? 'type') === 'type' ? 'category' : 'type' })
          break
        case 'search':
          window.dispatchEvent(new Event('learn:focus-search'))
          break
        case 'escape':
          if (s.panelOpen) s.togglePanel(false)
          else if (s.focusMode) s.toggleFocus(false)
          else void s.select(null)
          break
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
