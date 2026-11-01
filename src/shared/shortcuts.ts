// Raccourcis clavier personnalisables. Une combinaison s'écrit « k », « Shift+k », « Cmd+Shift+j », « ArrowDown »…
// Le format est indépendant de l'interface (JSON dans les réglages) : l'app native pourra le reprendre tel quel.

export const SHORTCUT_ACTIONS = [
  'next',
  'prev',
  'later',
  'bookmark',
  'favorite',
  'read',
  'open',
  'tags',
  'panel',
  'focus',
  'sidebar',
  'grouping',
  'search',
  'refresh'
] as const

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  next: 'j',
  prev: 'k',
  later: 'l',
  bookmark: 'b',
  favorite: 'f',
  read: 'm',
  open: 'o',
  tags: 't',
  panel: 'h',
  focus: 'z',
  sidebar: '[',
  grouping: 'g',
  search: '/',
  refresh: 'r'
}

/** Touches fixes, actives tant qu'aucune action personnalisée ne les reprend. */
export const FIXED_KEYS: Record<string, ShortcutAction | 'escape'> = {
  ArrowDown: 'next',
  ArrowUp: 'prev',
  Escape: 'escape'
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead', 'Fn', 'OS', 'Unidentified', 'Process'])

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Combinaison d'un appui. Pour un caractère qui n'est pas une lettre (« [ », « / », « 1 »…), Maj et Option
 * ne comptent pas : sur un clavier AZERTY, ils servent justement à le taper (« [ » = ⌥⇧( sur Mac).
 */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  let key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key.length === 1 && /\s/.test(key)) return null
  const letterOrNamed = /^[a-z]$/.test(key) || key.length > 1
  const mods: string[] = []
  if (e.metaKey) mods.push('Cmd')
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey && letterOrNamed) mods.push('Alt')
  if (e.shiftKey && letterOrNamed) mods.push('Shift')
  if (key === '+') key = 'Plus'
  return [...mods, key].join('+')
}

/** Raccourcis effectifs : les personnalisés par-dessus ceux par défaut ; « » (vide) désactive une action. */
export function effectiveShortcuts(custom: Record<string, string> | undefined): Record<ShortcutAction, string> {
  const out = { ...DEFAULT_SHORTCUTS }
  for (const a of SHORTCUT_ACTIONS) if (custom && typeof custom[a] === 'string') out[a] = custom[a]
  return out
}

/** Table combinaison → action, pour le gestionnaire de touches. */
export function shortcutMap(custom: Record<string, string> | undefined): Map<string, ShortcutAction | 'escape'> {
  const map = new Map<string, ShortcutAction | 'escape'>()
  const bindings = effectiveShortcuts(custom)
  const taken = new Set(Object.values(bindings))
  for (const [combo, action] of Object.entries(FIXED_KEYS)) if (!taken.has(combo)) map.set(combo, action)
  for (const a of SHORTCUT_ACTIONS) if (bindings[a]) map.set(bindings[a], a)
  return map
}

/** Combinaisons prises par le menu de l'app ou par le système d'édition (copier, coller…). */
export function reservedCombo(combo: string, mac: boolean): boolean {
  const mod = mac ? 'Cmd' : 'Ctrl'
  return [',', 'n', 'r', 'q', 'w', 'c', 'v', 'x', 'a', 'z', 'Shift+z', 'm', 'h'].some((k) => combo === `${mod}+${k}`) || combo === 'Escape'
}

const SYMBOLS: Record<string, string> = {
  Cmd: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Backspace: '⌫',
  Tab: '⇥',
  Space: '␣',
  Escape: 'Esc',
  Plus: '+'
}

/** Affichage lisible : « ⌘⇧J » sur Mac, « Ctrl+Maj+J » ailleurs. */
export function formatCombo(combo: string, mac: boolean): string {
  if (!combo) return ''
  const parts = combo.split('+').map((p) => (p === '' ? '+' : p))
  const key = parts.pop()!
  const keyLabel = SYMBOLS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  if (mac) return parts.map((m) => SYMBOLS[m] ?? m).join('') + keyLabel
  const names: Record<string, string> = { Cmd: 'Win', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Maj' }
  return [...parts.map((m) => names[m] ?? m), SYMBOLS[key] && key.startsWith('Arrow') ? SYMBOLS[key] : keyLabel].join('+')
}
