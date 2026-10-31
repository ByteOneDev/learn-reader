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
  const [tab, setTab] = useState<'feed' | 'link' | 'book' | 'newsletter'>('feed')
  const importBooks = useApp((s) => s.importBooks)
  const [input, setInput] = useState('')
  const [detected, setDetected] = useState<ResolvedInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [podcasts, setPodcasts] = useState<{ title: string; author?: string; feedUrl: string; artwork?: string }[] | null>(null)

  // Ni adresse, ni r/…, ni @… (« Choses à Savoir TECH ») : on le cherche parmi les podcasts.
  const looksLikeName = (v: string): boolean => !/[./:@]/.test(v.trim())

  useEffect(() => {
    setError('')
    setDetected(null)
    setPodcasts(null)
    if (tab !== 'feed' || !input.trim()) return
    const h = setTimeout(() => {
      if (looksLikeName(input)) {
        api
          .searchPodcasts(input)
          .then(setPodcasts)
          .catch((e: Error) => setError(e.message))
        return
      }
      api
        .resolveInput(input)
        .then(setDetected)
        .catch((e: Error) => setError(e.message))
    }, 350)
    return () => clearTimeout(h)
  }, [input, tab, api])

  const subscribePodcast = async (feedUrl: string, title: string): Promise<void> => {
    setBusy(true)
    try {
      const s = await api.addSource({ input: feedUrl, kind: 'podcast', title })
      await reloadMeta()
      setView({ type: 'source', sourceId: s.id })
      toast(`${t.add} : ${s.title}`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
        <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>
          {t.bookTab}
        </button>
        <button className={tab === 'newsletter' ? 'on' : ''} onClick={() => setTab('newsletter')}>
          {t.newsletterTab}
        </button>
      </div>
      {tab === 'newsletter' && (
        <div className="field newsletter-help">
          <p>
            <strong>{t.nlWebTitle}</strong> {t.nlWebText}
          </p>
          <p>
            <strong>{t.nlMailTitle}</strong> {t.nlMailText}
          </p>
          <ol>
            <li>
              <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://kill-the-newsletter.com/') }}>
                {t.nlStep1}
              </a>
            </li>
            <li>{t.nlStep2}</li>
            <li>{t.nlStep3}</li>
          </ol>
          <button className="btn primary" onClick={() => setTab('feed')}>
            {t.nlPaste}
          </button>
        </div>
      )}
      {tab === 'book' && (
        <div className="field">
          <p className="hint" style={{ fontSize: 14, margin: '4px 0 16px' }}>{t.bookHint}</p>
          <button
            className="btn primary"
            onClick={() => {
              onClose()
              void importBooks()
            }}
          >
            {t.importBooks}
          </button>
        </div>
      )}
      {(tab === 'feed' || tab === 'link') && (
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
        {podcasts && (
          <div className="podcast-results">
            <div className="hint" style={{ margin: '10px 0 6px' }}>{podcasts.length ? t.podcastResults : t.noPodcastFound}</div>
            {podcasts.slice(0, 6).map((p) => (
              <div key={p.feedUrl} className="podcast-result">
                {p.artwork ? <img src={p.artwork} alt="" /> : <span className="player-art" />}
                <span className="podcast-text">
                  <span className="t">{p.title}</span>
                  {p.author && <span className="a">{p.author}</span>}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => void subscribePodcast(p.feedUrl, p.title)}>
                  {t.add}
                </button>
              </div>
            ))}
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
      )}
    </Dialog>
  )
}
