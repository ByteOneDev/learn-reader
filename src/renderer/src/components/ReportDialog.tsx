import { useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from 'lucide-react'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { friendlyError, isNetworkError } from '../lib/errors'
import { subscribeAll } from '../lib/subscribe'
import Dialog from './Dialog'

/** Bilan d'un abonnement groupé : sources ajoutées, échecs et leur motif, nouvel essai. */
export default function ReportDialog(): React.JSX.Element | null {
  const t = useT()
  const report = useApp((s) => s.report)
  const showReport = useApp((s) => s.showReport)
  const api = useApp((s) => s.api)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const loadItems = useApp((s) => s.loadItems)
  const toast = useApp((s) => s.toast)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  if (!report) return null

  const network = report.failed.filter((f) => isNetworkError(f.error)).length
  // Presque tout échoue pour une raison réseau : le problème vient de la connexion de l'ordinateur.
  const offline = report.failed.length > 0 && network / report.failed.length >= 0.8 && report.added <= report.failed.length / 4

  const retry = async (): Promise<void> => {
    const list = report.failed.map((f) => f.source)
    setProgress({ done: 0, total: list.length })
    const r = await subscribeAll(api, list, (done) => setProgress({ done, total: list.length }))
    setProgress(null)
    await reloadMeta()
    await loadItems(true)
    if (r.failed.length) showReport({ added: report.added + r.added, failed: r.failed })
    else {
      showReport(null)
      toast(t.subscribedCount(report.added + r.added))
    }
  }

  return (
    <Dialog title={t.reportTitle} onClose={() => showReport(null)} width={600}>
      <div className="report-summary">
        <span className="ok">
          <CheckCircle2 size={17} /> {t.reportAdded(report.added)}
        </span>
        <span className="ko">
          <AlertTriangle size={17} /> {t.errorsCount(report.failed.length)}
        </span>
      </div>
      {offline && (
        <div className="report-hint">
          <WifiOff size={18} />
          <p>{t.reportNetworkHint}</p>
        </div>
      )}
      <div className="report-list">
        {report.failed.map((f) => (
          <div key={f.input} className="report-row">
            <span className="report-name">{f.input}</span>
            <span className="report-error">{friendlyError(f.error)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={() => void retry()} disabled={!!progress}>
          <RefreshCw size={15} className={progress ? 'spin' : ''} /> {progress ? t.subscribing(progress.done, progress.total) : t.retryFailed}
        </button>
        <button className="btn primary" onClick={() => showReport(null)} disabled={!!progress}>
          {t.done}
        </button>
      </div>
    </Dialog>
  )
}
