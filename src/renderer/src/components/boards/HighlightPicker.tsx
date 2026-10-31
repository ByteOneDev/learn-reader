import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { HighlightWithItem } from '@shared/types'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import Dialog from '../Dialog'

export default function HighlightPicker({ exclude, onPick, onClose }: { exclude: Set<string>; onPick(list: HighlightWithItem[]): void; onClose(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const [all, setAll] = useState<HighlightWithItem[]>([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    void api.allHighlights().then(setAll)
  }, [api])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter((h) => !exclude.has(h.id) && (!s || h.quote.toLowerCase().includes(s) || h.note.toLowerCase().includes(s) || h.itemTitle.toLowerCase().includes(s)))
  }, [all, q, exclude])

  return (
    <Dialog title={t.pickHighlights} onClose={onClose} width={620}>
      <input className="text-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchHighlights} />
      <div className="picker-list">
        {all.length === 0 && <div className="list-empty">{t.noHighlightsYet}</div>}
        {list.map((h) => {
          const on = picked.has(h.id)
          return (
            <button
              key={h.id}
              className={`picker-row${on ? ' on' : ''}`}
              style={{ ['--c' as string]: `var(--dot-${h.color})` }}
              onClick={() =>
                setPicked((p) => {
                  const n = new Set(p)
                  if (n.has(h.id)) n.delete(h.id)
                  else n.add(h.id)
                  return n
                })
              }
            >
              <span className={`checkbox${on ? ' on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
              <span className="picker-body">
                <span className="q">{h.quote}</span>
                <span className="src">{h.itemTitle}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {t.close}
        </button>
        <button className="btn primary" disabled={!picked.size} onClick={() => onPick(all.filter((h) => picked.has(h.id)))}>
          {t.addSelected(picked.size)}
        </button>
      </div>
    </Dialog>
  )
}
