import { useEffect, useState } from 'react'
import type { ResolvedInput } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import Dialog from './Dialog'

export default function AddSourceDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const setView = useApp((s) => s.setView)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const toast = useApp((s) => s.toast)
  const [tab, setTab] = useState<'feed' | 'link'>('feed')
  const [input, setInput] = useState('')
  const [detected, setDetected] = useState<ResolvedInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError('')
    setDetected(null)
    if (tab !== 'feed' || !input.trim()) return
    const h = setTimeout(() => {
      api
        .resolveInput(input)
        .then(setDetected)
        .catch((e: Error) => setError(e.message))
    }, 250)
    return () => clearTimeout(h)
  }, [input, tab, api])

  const submit = async (): Promise<void> => {
    if (!input.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      if (tab === 'feed') {
        const s = await api.addSource({ input })
        await reloadMeta()
        setView({ type: 'source', sourceId: s.id })
        toast(`${t.add} : ${s.title}`)
      } else {
        await api.saveLink(input)
        await reloadMeta()
        setView({ type: 'links' })
        toast(t.links)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t.addSource} onClose={onClose}>
      <div className="segmented" style={{ marginTop: 4 }}>
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
          {t.feedTab}
        </button>
        <button className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>
          {t.linkTab}
        </button>
      </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          className="text-input"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tab === 'feed' ? t.sourceInput : t.linkInput}
          spellCheck={false}
        />
        {detected && (
          <div className="detected">
            {t.detected} <span className="chip">{t.kinds[detected.kind]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detected.title ?? detected.url}</span>
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>
            {t.close}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
            {busy ? t.adding : tab === 'feed' ? t.add : t.save}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
