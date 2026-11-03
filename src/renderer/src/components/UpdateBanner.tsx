import { AnimatePresence, motion } from 'framer-motion'
import { Download, RotateCw, Sparkles } from 'lucide-react'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'

/** Bandeau discret en bas de la barre latérale : téléchargement en cours, puis « Redémarrer ». */
export default function UpdateBanner(): React.JSX.Element {
  const t = useT()
  const update = useApp((s) => s.update)
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const show = !!update && (update.state === 'downloading' || update.state === 'ready' || update.state === 'available')
  return (
    <AnimatePresence>
      {show && update && (
        <motion.div
          className="update-banner"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <Sparkles size={16} />
          <div className="update-text">
            <strong>{t.updateTitle(update.version ?? '')}</strong>
            {update.state === 'downloading' && (
              <div className="update-progress">
                <span style={{ width: `${Math.round((update.progress ?? 0) * 100)}%` }} />
              </div>
            )}
            {update.state === 'ready' && <span>{t.updateReady}</span>}
          </div>
          {update.state === 'ready' && (
            <button
              className="btn primary"
              onClick={() =>
                void api.installUpdate().catch((e: Error) => {
                  toast(e.message, 'error')
                })
              }
            >
              <RotateCw size={14} /> {t.updateRestart}
            </button>
          )}
          {update.state === 'available' && (
            <button className="btn" onClick={() => void api.downloadUpdate()}>
              <Download size={14} /> {t.updateDownload}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
