import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, FileText, Headphones, Highlighter, PlayCircle, Search } from 'lucide-react'
import type { Item, SearchResults } from '@shared/types'
import { snippetParts } from '@shared/search'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { relativeTime } from '../lib/time'

function Snippet({ raw }: { raw: string }): React.JSX.Element {
  return (
    <span className="sp-snippet">
      {snippetParts(raw).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

function itemIcon(item: Item): React.JSX.Element {
  if (item.format) return <BookOpen size={15} />
  if (item.mediaType === 'audio') return <Headphones size={15} />
  if (item.mediaType === 'video' || item.mediaType === 'youtube') return <PlayCircle size={15} />
  return <FileText size={15} />
}

type Row = { kind: 'item'; id: string; open(): void } | { kind: 'highlight'; id: string; open(): void }

/** « Rechercher partout » : articles, livres, vidéos, podcasts, surlignages et notes, au clavier. */
export default function SearchPalette({ onClose }: { onClose(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const sources = useApp((s) => s.sources)
  const lang = useApp((s) => s.settings?.language ?? 'fr')
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchResults | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    if (!q.trim()) {
      setRes(null)
      return
    }
    const h = setTimeout(() => void api.search(q).then((r) => alive && (setRes(r), setActive(0))), 120)
    return () => {
      alive = false
      clearTimeout(h)
    }
  }, [api, q])

  const rows: Row[] = useMemo(() => {
    if (!res) return []
    const s = useApp.getState()
    return [
      ...res.items.map((r) => ({ kind: 'item' as const, id: r.item.id, open: () => void s.openLink(r.item.id) })),
      ...res.highlights.map((r) => ({ kind: 'highlight' as const, id: r.highlight.id, open: () => void s.openHighlight(r.highlight.itemId, r.highlight.id, r.highlight.layer) }))
    ]
  }, [res])

  const choose = (i: number): void => {
    const row = rows[i]
    if (!row) return
    onClose()
    row.open()
  }

  useEffect(() => {
    listRef.current?.querySelector('.sp-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const sourceTitle = (id: string): string => sources.find((s) => s.id === id)?.title ?? ''
  let index = -1

  return (
    <motion.div className="scrim sp-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onMouseDown={onClose}>
      <motion.div
        className="search-palette"
        role="dialog"
        aria-label={t.searchAll}
        initial={{ opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sp-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.searchAllPlaceholder}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(rows.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(active)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
        </div>
        <div className="sp-results" ref={listRef}>
          {res && !rows.length && <div className="sp-empty">{t.searchNothing}</div>}
          {!!res?.items.length && <div className="sp-section">{t.searchArticles}</div>}
          {res?.items.map((r) => {
            const i = ++index
            return (
              <button key={r.item.id} className={`sp-row${i === active ? ' active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => choose(i)}>
                <span className="sp-icon">{itemIcon(r.item)}</span>
                <span className="sp-body">
                  <span className="sp-title">{r.item.title}</span>
                  <Snippet raw={r.snippet} />
                  <span className="sp-meta">
                    {sourceTitle(r.item.sourceId)} · {relativeTime(r.item.publishedAt, lang)}
                  </span>
                </span>
              </button>
            )
          })}
          {!!res?.highlights.length && <div className="sp-section">{t.searchHlSection}</div>}
          {res?.highlights.map((r) => {
            const i = ++index
            return (
              <button key={r.highlight.id} className={`sp-row${i === active ? ' active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => choose(i)}>
                <span className="sp-icon" style={{ color: `var(--dot-${r.highlight.color})` }}>
                  <Highlighter size={15} />
                </span>
                <span className="sp-body">
                  <Snippet raw={r.snippet} />
                  <span className="sp-meta">{r.itemTitle}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="sp-foot">{t.searchHint}</div>
      </motion.div>
    </motion.div>
  )
}
