import { describe, expect, it } from 'vitest'
import { comboFromEvent, DEFAULT_SHORTCUTS, effectiveShortcuts, formatCombo, reservedCombo, shortcutMap } from '../src/shared/shortcuts'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('raccourcis clavier', () => {
  it('lit une combinaison de façon stable', () => {
    expect(comboFromEvent(key('j'))).toBe('j')
    expect(comboFromEvent(key('J', { shiftKey: true }))).toBe('Shift+j')
    expect(comboFromEvent(key('k', { metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+k')
    expect(comboFromEvent(key('ArrowDown', { altKey: true }))).toBe('Alt+ArrowDown')
    expect(comboFromEvent(key(' '))).toBe('Space')
    expect(comboFromEvent(key('Shift', { shiftKey: true }))).toBeNull()
  })

  it('ignore Maj et Option pour un symbole (AZERTY : « [ » se tape avec ⌥⇧)', () => {
    expect(comboFromEvent(key('[', { altKey: true, shiftKey: true }))).toBe('[')
    expect(comboFromEvent(key('/', { shiftKey: true }))).toBe('/')
    expect(comboFromEvent(key('[', { metaKey: true, altKey: true }))).toBe('Cmd+[')
  })

  it('applique les touches personnalisées, et une touche vide désactive', () => {
    const b = effectiveShortcuts({ next: 'n', later: '', bogus: 'x' })
    expect(b.next).toBe('n')
    expect(b.later).toBe('')
    expect(b.prev).toBe(DEFAULT_SHORTCUTS.prev)
    expect('bogus' in b).toBe(false)
  })

  it('garde les flèches et Échap tant qu’aucune action ne les reprend', () => {
    expect(shortcutMap(undefined).get('ArrowDown')).toBe('next')
    expect(shortcutMap(undefined).get('Escape')).toBe('escape')
    const m = shortcutMap({ refresh: 'ArrowDown' })
    expect(m.get('ArrowDown')).toBe('refresh')
    expect(m.get('j')).toBe('next')
  })

  it('refuse les combinaisons du menu et affiche les touches à la mode du système', () => {
    expect(reservedCombo('Cmd+r', true)).toBe(true)
    expect(reservedCombo('Ctrl+r', true)).toBe(false)
    expect(reservedCombo('Ctrl+c', false)).toBe(true)
    expect(formatCombo('Cmd+Shift+j', true)).toBe('⌘⇧J')
    expect(formatCombo('Ctrl+Shift+j', false)).toBe('Ctrl+Maj+J')
    expect(formatCombo('ArrowDown', false)).toBe('↓')
    expect(formatCombo('[', true)).toBe('[')
  })
})
