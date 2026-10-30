import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useApp } from '../lib/store'

export default function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.tone ?? 'ok'}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          >
            {t.tone === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
