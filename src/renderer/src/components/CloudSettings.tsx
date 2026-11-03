import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import type { CloudStatus } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/time'

/** Réglages › Synchronisation (bêta) : projet Supabase, compte, état. */
export default function CloudSettings(): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const settings = useApp((s) => s.settings)!
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [url, setUrl] = useState(settings.cloudUrl ?? '')
  const [anonKey, setAnonKey] = useState(settings.cloudAnonKey ?? '')
  const [email, setEmail] = useState(settings.cloudEmail ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.cloudStatus().then(setStatus)
    return api.onEvent((e) => {
      if (e.type === 'cloud-status') setStatus(e.status)
    })
  }, [api])

  const run = async (fn: () => Promise<CloudStatus>, ok?: string): Promise<void> => {
    setBusy(true)
    try {
      const s = await fn()
      setStatus(s)
      setPassword('')
      if (s.error) toast(s.error, 'error')
      else if (ok) toast(ok)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (status?.connected) {
    return (
      <div className="field">
        <label>
          {t.cloudTitle} <span className="beta-badge">bêta</span>
        </label>
        <div className="row-between">
          <span className="cloud-state">
            <Cloud size={16} />
            <span>
              <strong>{status.email}</strong>
              <span className="hint">
                {status.lastSync ? t.cloudLastSync(relativeTime(status.lastSync, settings.language)) : t.cloudNever}
                {!!status.pending && ` · ${t.cloudPending(status.pending)}`}
              </span>
            </span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => void run(() => api.cloudSyncNow())}>
              <RefreshCw size={15} className={busy ? 'spin' : ''} /> {t.cloudSyncNow}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => api.cloudDisconnect())}>
              <CloudOff size={15} /> {t.cloudSignOut}
            </button>
          </span>
        </div>
        {status.error && <p className="error-text">{status.error}</p>}
        <p className="hint" style={{ margin: '6px 0 0' }}>{t.cloudWhat}</p>
      </div>
    )
  }

  const ready = url.trim() && anonKey.trim() && email.trim() && password.length >= 6
  return (
    <div className="field">
      <label>
        {t.cloudTitle} <span className="beta-badge">bêta</span>
      </label>
      <p className="hint" style={{ margin: '0 0 8px' }}>{t.cloudIntro}</p>
      <div className="cloud-form">
        <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" spellCheck={false} />
        <input className="text-input" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder={t.cloudAnonKey} spellCheck={false} />
        <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.cloudEmail} autoComplete="email" />
        <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.cloudPassword} autoComplete="current-password" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={!ready || busy} onClick={() => void run(() => api.cloudConnect({ url, anonKey, email, password }), t.cloudConnected)}>
          {t.cloudSignIn}
        </button>
        <button className="btn" disabled={!ready || busy} onClick={() => void run(() => api.cloudConnect({ url, anonKey, email, password, create: true }), t.cloudConnected)}>
          {t.cloudSignUp}
        </button>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>{t.cloudWhat}</p>
    </div>
  )
}
