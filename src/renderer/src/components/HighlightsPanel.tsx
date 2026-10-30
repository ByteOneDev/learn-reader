import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Highlight } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'

export default function HighlightsPanel({ highlights, orphans, layer, onJump }: {
  highlights: Highlight[]
  orphans: Set<string>
  layer: 'feed' | 'full'
  onJump(h: Highlight): void
}): React.JSX.Element {
  const t = useT()
  const togglePanel = useApp((s) => s.togglePanel)
  const sorted = [...highlights].sort((a, b) => (a.layer === b.layer ? a.start - b.start : a.layer === layer ? -1 : 1))
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
            {h.layer === layer && orphans.has(h.id) && <div className="o">{t.orphan}</div>}
            {h.layer !== layer && <div className="hint" style={{ marginTop: 6 }}>{h.layer === 'full' ? t.fullText : t.feedText}</div>}
          </motion.button>
        ))}
      </div>
    </motion.aside>
  )
}
