import { useEffect, useState } from 'react'
import { BookOpen, FileText, Headphones, PlayCircle } from 'lucide-react'
import type { Item } from '@shared/types'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import Dialog from '../Dialog'

function iconFor(item: Item): React.JSX.Element {
  if (item.format) return <BookOpen size={15} />
  if (item.mediaType === 'audio') return <Headphones size={15} />
  if (item.mediaType === 'video') return <PlayCircle size={15} />
  return <FileText size={15} />
}

/** Choix d'un document à lier (articles, liens enregistrés, vidéos, podcasts, livres). */
export default function DocPicker({ onPick, onClose }: { onPick(item: Item): void; onClose(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const sources = useApp((s) => s.sources)
  const [q, setQ] = useState('')
  const [list, setList] = useState<Item[]>([])

  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      const search = q.trim() || undefined
      const parts = await Promise.all(
        (['home', 'links', 'library'] as const).map((type) => api.listItems({ view: { type }, search, limit: 40 }).catch(() => [] as Item[]))
      )
      const seen = new Set<string>()
      const merged = parts.flat().filter((i) => !seen.has(i.id) && seen.add(i.id))
      merged.sort((a, b) => b.publishedAt - a.publishedAt)
      if (alive) setList(merged.slice(0, 60))
    }, 160)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api, q])

  return (
    <Dialog title={t.linkDocument} onClose={onClose} width={620}>
      <input className="text-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.linkDocumentHint} />
      <div className="picker-list">
        {list.map((item) => (
          <button key={item.id} className="picker-row" onClick={() => onPick(item)}>
            <span className="doc-icon">{iconFor(item)}</span>
            <span className="picker-body">
              <span className="q">{item.title}</span>
              <span className="src">{sources.find((s) => s.id === item.sourceId)?.title ?? item.author ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
