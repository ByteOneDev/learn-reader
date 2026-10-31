import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Highlight } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'

function layerRank(layer: string): number {
  if (layer === 'feed') return -2
  if (layer === 'full') return -1
  return Number(layer.split(':')[1]) || 0
}

export default function HighlightsPanel({ highlights, orphans, current, labelFor, onJump }: {
  highlights: Highlight[]
  orphans: Set<string>
  /** Couche affichée (texte du flux, chapitre…) : les autres sont étiquetées. */
  current?: string
  labelFor(layer: string): string
  onJump(h: Highlight): void
}): React.JSX.Element {
  const t = useT()
  const togglePanel = useApp((s) => s.togglePanel)
  const sorted = [...highlights].sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.start - b.start)
  return (
    <motion.aside
      className="hl-panel"
      initial={{ x: 340, opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 42 }}
    >
      <header>
        <span>
          {t.highlightsOf} · {highlights.length}
        </span>
        <button className="tb-btn" onClick={() => togglePanel(false)} aria-label={t.close}>
          <X size={16} />
        </button>
      </header>
      <div className="scroll">
        {sorted.length === 0 && <div className="hint" style={{ padding: '6px 4px' }}>{t.noHighlights}</div>}
        {sorted.map((h, i) => (
          <motion.button
            key={h.id}
            className="hl-entry"
            style={{ ['--c' as string]: `var(--dot-${h.color})` }}
            onClick={() => onJump(h)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.3) }}
          >
            <div className="q">{h.quote}</div>
            {h.note.trim() && <div className="n">{h.note}</div>}
            {orphans.has(h.id) && <div className="o">{t.orphan}</div>}
            {h.layer !== current && <div className="hint" style={{ marginTop: 6 }}>{labelFor(h.layer)}</div>}
          </motion.button>
        ))}
      </div>
    </motion.aside>
  )
}
