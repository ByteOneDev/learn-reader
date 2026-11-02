import { useMemo, useRef, useState } from 'react'
import { Check, FileUp, ListPlus, Upload } from 'lucide-react'
import { catalog } from '@shared/catalog'
import { guessCategory, parseList, parseTakeoutCsv, type ImportCandidate } from '@shared/importList'
import type { Source } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { subscribeAll } from '../lib/subscribe'
import { categoryLabel } from './Sidebar'

/** Déjà suivi ? (même chaîne YouTube, même subreddit, même adresse) */
function alreadyFollowed(c: ImportCandidate, sources: Source[]): boolean {
  const id = c.input.match(/UC[\w-]{22}/)?.[0]
  const sub = c.input.match(/^r\/([\w-]+)$/i)?.[1]?.toLowerCase()
  return sources.some((s) => (id && s.url.includes(id)) || (sub && s.url.toLowerCase().includes(`/r/${sub}/`)) || s.url === c.input || s.siteUrl === c.input)
}

/** Onglet « Importer » : abonnements YouTube (Google Takeout), OPML, ou liste collée, avec catégories. */
export default function ImportPanel({ onDone }: { onDone(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const sources = useApp((s) => s.sources)
  const lang = useApp((s) => s.settings?.language ?? 'fr')
  const reloadMeta = useApp((s) => s.reloadMeta)
  const loadItems = useApp((s) => s.loadItems)
  const toast = useApp((s) => s.toast)
  const showReport = useApp((s) => s.showReport)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<(ImportCandidate & { on: boolean; followed: boolean })[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const categories = useMemo(() => [...new Set([...catalog.categories.map((c) => c.id), ...sources.map((s) => s.category).filter((c): c is string => !!c)])], [sources])
  const known = useMemo(() => catalog.entries.map((e) => ({ title: e.title, input: e.input, category: e.category })), [])

  const preview = (list: { input: string; title: string; kind?: ImportCandidate['kind'] }[]): void => {
    if (!list.length) return toast(t.importNothing, 'error')
    setRows(
      list.map((x) => {
        const c: ImportCandidate = { ...x, category: guessCategory(x.title, x.input, known) }
        const followed = alreadyFollowed(c, sources)
        return { ...c, on: !followed, followed }
      })
    )
  }

  const readTakeout = async (file: File): Promise<void> => {
    const channels = parseTakeoutCsv(await file.text())
    preview(channels.map((c) => ({ input: c.url, title: c.title, kind: 'youtube' as const })))
  }

  const subscribe = async (): Promise<void> => {
    const chosen = (rows ?? []).filter((r) => r.on)
    setProgress({ done: 0, total: chosen.length })
    const report = await subscribeAll(
      api,
      chosen.map((r) => ({ input: r.input, title: r.title.startsWith('r/') ? undefined : r.title, kind: r.kind, category: r.category || undefined })),
      (done) => setProgress({ done, total: chosen.length })
    )
    setProgress(null)
    await reloadMeta()
    await loadItems(true)
    onDone()
    if (report.failed.length) showReport(report)
    else toast(t.subscribedCount(report.added))
  }

  if (rows) {
    const count = rows.filter((r) => r.on).length
    return (
      <div className="field import-preview">
        <div className="import-head">
          <span>{t.importFound(rows.length, rows.filter((r) => r.followed).length)}</span>
          <button className="link-btn" onClick={() => setRows(rows.map((r) => ({ ...r, on: !r.followed && count === 0 })))}>
            {count ? t.uncheckAll : t.checkAll}
          </button>
        </div>
        <div className="import-list">
          {rows.map((r, i) => (
            <div key={r.input} className={`import-row${r.on ? ' on' : ''}${r.followed ? ' followed' : ''}`}>
              <button
                className={`checkbox${r.on ? ' on' : ''}`}
                disabled={r.followed}
                onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                aria-label={r.title}
              >
                {r.on && <Check size={13} strokeWidth={3} />}
              </button>
              <span className="import-title" title={r.input}>
                {r.title}
                {r.followed && <em> · {t.alreadyFollowed}</em>}
              </span>
              <select value={r.category} disabled={r.followed} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c, lang)}
                  </option>
                ))}
                <option value="">{t.otherCategory}</option>
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn" onClick={() => setRows(null)} disabled={!!progress}>
            {t.back}
          </button>
          <button className="btn primary" onClick={() => void subscribe()} disabled={!count || !!progress}>
            {progress ? t.subscribing(progress.done, progress.total) : t.subscribeN(count)}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="field import-panel">
      <div className="import-sources">
        <button className="import-card" onClick={() => fileRef.current?.click()}>
          <FileUp size={20} />
          <strong>{t.importYoutube}</strong>
          <span>{t.importYoutubeHint}</span>
        </button>
        <button
          className="import-card"
          onClick={async () => {
            const r = await api.importOpml()
            if (!r) return
            await reloadMeta()
            onDone()
            toast(`OPML : +${r.added}${r.failed ? ` · ${t.errorsCount(r.failed)}` : ''}`, r.failed ? 'error' : 'ok')
          }}
        >
          <Upload size={20} />
          <strong>{t.importOpml}</strong>
          <span>{t.importOpmlHint}</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void readTakeout(f)
          e.target.value = ''
        }}
      />
      <label style={{ marginTop: 16 }}>{t.importPaste}</label>
      <textarea className="text-input import-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.importPastePlaceholder} rows={6} spellCheck={false} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn primary" disabled={!text.trim()} onClick={() => preview(parseList(text))}>
          <ListPlus size={16} /> {t.importAnalyze}
        </button>
      </div>
    </div>
  )
}
