import { useEffect, useMemo, useState } from 'react'
import { EyeOff, Filter, X } from 'lucide-react'
import { DEFAULT_FILTER, filterIsActive, type FilterField, type SourceFilter } from '@shared/filters'
import type { FilterPreview } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import Dialog from './Dialog'

const FIELDS: FilterField[] = ['title', 'categories', 'author', 'summary']

/** Saisie de mots-clés en pastilles : Entrée ou virgule pour ajouter, × pour retirer. */
export function TermsInput({ terms, onChange, placeholder }: { terms: string[]; onChange(t: string[]): void; placeholder: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const add = (raw: string): void => {
    const next = raw
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x && !terms.some((t) => t.toLowerCase() === x.toLowerCase()))
    if (next.length) onChange([...terms, ...next])
    setText('')
  }
  return (
    <div className="terms-input">
      {terms.map((term) => (
        <span key={term} className="term-chip">
          {term}
          <button onClick={() => onChange(terms.filter((x) => x !== term))} aria-label={`× ${term}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(text)
          } else if (e.key === 'Backspace' && !text && terms.length) onChange(terms.slice(0, -1))
        }}
        onBlur={() => text.trim() && add(text)}
        placeholder={terms.length ? '' : placeholder}
      />
    </div>
  )
}

/** Filtre d'une source : règles, catégories du flux en raccourci, aperçu en direct. */
export default function FilterDialog({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const t = useT()
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const sourceId = useApp((s) => s.filterSourceId)
  const source = useApp((s) => s.sources.find((x) => x.id === s.filterSourceId))
  const [filter, setFilter] = useState<SourceFilter>(() => source?.filter ?? DEFAULT_FILTER)
  const [preview, setPreview] = useState<FilterPreview | null>(null)
  const [busy, setBusy] = useState(false)

  // Aperçu recalculé à chaque changement, sans rien enregistrer.
  useEffect(() => {
    if (!sourceId) return
    let alive = true
    const h = setTimeout(() => void api.previewSourceFilter(sourceId, filter).then((p) => alive && setPreview(p)), 180)
    return () => {
      alive = false
      clearTimeout(h)
    }
  }, [api, sourceId, filter])

  const usedTerms = useMemo(() => new Set(filter.terms.map((x) => x.toLowerCase())), [filter.terms])
  if (!source || !sourceId) return null
  const patch = (p: Partial<SourceFilter>): void => setFilter((f) => ({ ...f, ...p }))

  const save = async (next: SourceFilter | null): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.setSourceFilter(sourceId, next)
      toast(filterIsActive(next) ? t.filterSaved(r.hidden) : t.filterRemoved)
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`${t.filtersTitle} — ${source.title}`} onClose={onClose} width={600}>
      <div className="segmented" style={{ marginTop: 2 }}>
        <button className={filter.mode === 'hide' ? 'on' : ''} onClick={() => patch({ mode: 'hide' })}>
          <EyeOff size={14} /> {t.filterHide}
        </button>
        <button className={filter.mode === 'keep' ? 'on' : ''} onClick={() => patch({ mode: 'keep' })}>
          <Filter size={14} /> {t.filterKeep}
        </button>
      </div>

      <div className="field">
        <TermsInput terms={filter.terms} onChange={(terms) => patch({ terms })} placeholder={t.filterTermsPlaceholder} />
        <div className="filter-fields">
          <span>{t.filterIn}</span>
          {FIELDS.map((f) => {
            const on = filter.fields.includes(f)
            return (
              <button
                key={f}
                className={`fchip${on ? ' on' : ''}`}
                onClick={() => patch({ fields: on ? filter.fields.filter((x) => x !== f) : [...filter.fields, f] })}
                aria-pressed={on}
              >
                {t.filterFields[f]}
              </button>
            )
          })}
        </div>
      </div>

      {!!preview?.categories.length && (
        <div className="field">
          <label>{t.filterFeedCategories}</label>
          <div className="filter-cats">
            {preview.categories.map((c) => (
              <button
                key={c.name}
                className={`fchip${usedTerms.has(c.name.toLowerCase()) ? ' on' : ''}`}
                onClick={() =>
                  usedTerms.has(c.name.toLowerCase())
                    ? patch({ terms: filter.terms.filter((x) => x.toLowerCase() !== c.name.toLowerCase()) })
                    : patch({ terms: [...filter.terms, c.name], fields: filter.fields.includes('categories') ? filter.fields : [...filter.fields, 'categories'] })
                }
              >
                {c.name} <em>{c.count}</em>
              </button>
            ))}
          </div>
        </div>
      )}

      {source.kind === 'youtube' && (
        <div className="field row-between">
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>
            {t.filterShorts}
            {!!preview?.shorts && <em className="hint"> · {t.filterShortsCount(preview.shorts)}</em>}
          </span>
          <button
            className={`switch${filter.hideShorts ? ' on' : ''}`}
            role="switch"
            aria-checked={!!filter.hideShorts}
            aria-label={t.filterShorts}
            onClick={() => patch({ hideShorts: !filter.hideShorts })}
          />
        </div>
      )}

      {preview && (
        <div className="filter-preview">
          <div className="filter-preview-head">{t.filterPreview(preview.total - preview.hidden, preview.total)}</div>
          <div className="filter-preview-cols">
            <div>
              <strong>{t.filterKept}</strong>
              {preview.keptTitles.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div className="hidden-col">
              <strong>{t.filterHidden}</strong>
              {preview.hiddenTitles.map((x) => (
                <span key={x}>{x}</span>
              ))}
              {!preview.hiddenTitles.length && <span className="hint">—</span>}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {source.filter && (
          <button className="btn" onClick={() => void save(null)} disabled={busy} style={{ color: 'var(--danger)' }}>
            {t.filterRemove}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose} disabled={busy}>
          {t.close}
        </button>
        <button className="btn primary" onClick={() => void save(filter)} disabled={busy}>
          {t.save}
        </button>
      </div>
    </Dialog>
  )
}
