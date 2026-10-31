import { useEffect, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

export default function Dialog({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onMouseDown={onClose}>
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="round-btn" onClick={onClose} aria-label="Fermer" style={{ width: 32, height: 32 }}>
            <X size={16} />
          </button>
        </header>
        <div className="body">{children}</div>
      </motion.div>
    </motion.div>
  )
}
