import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { comboFromEvent, DEFAULT_SHORTCUTS, effectiveShortcuts, FIXED_KEYS, formatCombo, reservedCombo, SHORTCUT_ACTIONS, type ShortcutAction } from '@shared/shortcuts'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import Dialog from './Dialog'

/** Réglage des raccourcis : clic sur une touche, puis appui sur la nouvelle combinaison. */
export default function ShortcutsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useApp((s) => s.toast)
  const mac = useApp((s) => s.api.platform === 'darwin')
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const bindings = effectiveShortcuts(settings?.shortcuts)

  const save = (next: Record<ShortcutAction, string>): void => {
    // On ne stocke que ce qui diffère des valeurs par défaut.
    const custom = Object.fromEntries(SHORTCUT_ACTIONS.filter((a) => next[a] !== DEFAULT_SHORTCUTS[a]).map((a) => [a, next[a]]))
    void updateSettings({ shortcuts: Object.keys(custom).length ? custom : undefined })
  }

  const assign = (action: ShortcutAction, combo: string): void => {
    const next = { ...bindings }
    const other = SHORTCUT_ACTIONS.find((a) => a !== action && next[a] === combo)
    // Touche déjà prise : les deux actions échangent leurs touches.
    if (other) {
      next[other] = next[action]
      toast(t.shortcutSwapped(t.shortcutLabels[other]))
    }
    next[action] = combo
    save(next)
  }

  // Écoute en phase de capture : la touche ne déclenche ni l'action en cours ni la fermeture du dialogue.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey) {
        assign(recording, '')
        return setRecording(null)
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      if (reservedCombo(combo, mac)) {
        toast(t.shortcutReserved(formatCombo(combo, mac)), 'error')
        return
      }
      assign(recording, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording]) // eslint-disable-line react-hooks/exhaustive-deps

  const customized = SHORTCUT_ACTIONS.some((a) => bindings[a] !== DEFAULT_SHORTCUTS[a])
  const fixed = Object.entries(FIXED_KEYS).filter(([combo]) => !Object.values(bindings).includes(combo))

  return (
    <Dialog title={t.shortcutsTitle} onClose={() => (recording ? setRecording(null) : onClose())} width={560}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t.shortcutsHint}
      </p>
      <div className="shortcut-list">
        {SHORTCUT_ACTIONS.map((a) => {
          const combo = bindings[a]
          const changed = combo !== DEFAULT_SHORTCUTS[a]
          return (
            <div key={a} className={`shortcut-row${recording === a ? ' recording' : ''}`}>
              <span className="shortcut-label">{t.shortcutLabels[a]}</span>
              {changed && (
                <button className="shortcut-reset" onClick={() => assign(a, DEFAULT_SHORTCUTS[a])} title={t.shortcutDefault(formatCombo(DEFAULT_SHORTCUTS[a], mac))} aria-label={t.reset}>
                  <RotateCcw size={13} />
                </button>
              )}
              <button className={`keycap${combo ? '' : ' empty'}`} onClick={() => setRecording(recording === a ? null : a)} aria-label={`${t.shortcutLabels[a]} : ${combo || t.shortcutNone}`}>
                {recording === a ? t.pressKey : combo ? formatCombo(combo, mac) : t.shortcutNone}
              </button>
              {combo && recording !== a && (
                <button className="shortcut-clear" onClick={() => assign(a, '')} title={t.shortcutDisable} aria-label={t.shortcutDisable}>
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {fixed.length > 0 && (
        <p className="hint">
          {t.shortcutFixed}{' '}
          {fixed.map(([combo, action], i) => (
            <span key={combo}>
              {i > 0 && ' · '}
              <kbd>{formatCombo(combo, mac)}</kbd> {action === 'escape' ? t.shortcutEscape : t.shortcutLabels[action]}
            </span>
          ))}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <button className="btn" disabled={!customized} onClick={() => void updateSettings({ shortcuts: undefined })}>
          <RotateCcw size={15} /> {t.resetAll}
        </button>
        <button className="btn primary" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </Dialog>
  )
}
