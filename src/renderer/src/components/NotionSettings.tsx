import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { NotionStatus } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'

export default function NotionSettings(): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<NotionStatus | null>(null)
  const [token, setToken] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.notionStatus().then(setStatus)
  }, [api])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label>{t.notion}</label>
      {!status?.connected ? (
        <>
          <p className="hint" style={{ margin: '0 0 8px' }}>{t.notionHelp}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.notionToken} spellCheck={false} autoComplete="off" />
            <button className="btn primary" disabled={busy || !token.trim()} onClick={() => void run(async () => setStatus(await api.notionConnect(token)))}>
              {t.notionConnect}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span className="chip">{t.notionConnected(status.workspace ?? 'Notion')}</span>
            <button
              className="btn"
              style={{ height: 30 }}
              onClick={() =>
                void run(async () => {
                  await api.notionDisconnect()
                  setStatus(await api.notionStatus())
                  await updateSettings({})
                })
              }
            >
              {t.notionDisconnect}
            </button>
          </div>
          {!status.databaseUrl ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="text-input" value={parent} onChange={(e) => setParent(e.target.value)} placeholder={t.notionParent} spellCheck={false} />
              <button className="btn primary" disabled={busy || !parent.trim()} onClick={() => void run(async () => setStatus(await api.notionCreateDatabase(parent)))}>
                {t.notionCreateDb}
              </button>
            </div>
          ) : (
            <>
              <div className="row-between">
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.notionDbReady}</span>
                <button className="btn" style={{ height: 30 }} onClick={() => void api.openExternal(status.databaseUrl!)}>
                  <ExternalLink size={14} /> {t.notionOpenDb}
                </button>
              </div>
              <div className="row-between" style={{ marginTop: 12 }}>
                <span>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.notionSync}</span>
                  <span className="hint" style={{ display: 'block', marginTop: 4 }}>{t.notionSyncHint}</span>
                </span>
                <button
                  className={`switch${settings.notionSync ? ' on' : ''}`}
                  onClick={() => void updateSettings({ notionSync: !settings.notionSync })}
                  role="switch"
                  aria-checked={!!settings.notionSync}
                  aria-label={t.notionSync}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy} onClick={() => void run(async () => toast(`${t.notionSent} · ${await api.notionPushAll()}`))}>
                  {t.notionPushAll}
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api.notionSyncNow()
                      toast(t.notionSynced(r.pushed, r.updated))
                    })
                  }
                >
                  {t.notionSyncNow}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
