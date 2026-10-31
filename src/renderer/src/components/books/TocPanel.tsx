import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { TocEntry } from '@shared/types'
import { useT } from '../../lib/i18n'

export default function TocPanel({ toc, current, onPick, onClose }: {
  toc: TocEntry[]
  current: number
  onPick(entry: TocEntry): void
  onClose(): void
}): React.JSX.Element {
  const t = useT()
  return (
    <motion.aside
      className="toc-panel"
      initial={{ x: -320, opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -320, opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 42 }}
    >
      <header>
        <span>{t.toc}</span>
        <button className="tb-btn" onClick={onClose} aria-label={t.close}>
          <X size={16} />
        </button>
      </header>
      <div className="scroll">
        {toc.length === 0 && <div className="hint" style={{ padding: 8 }}>{t.noToc}</div>}
        {toc.map((e, i) => (
          <button
            key={`${e.chapter}-${e.anchor ?? ''}-${i}`}
            className={`toc-entry${e.chapter === current ? ' on' : ''}`}
            style={{ paddingLeft: 14 + e.depth * 16 }}
            onClick={() => onPick(e)}
          >
            <span className="label">{e.title}</span>
          </button>
        ))}
      </div>
    </motion.aside>
  )
}
