import { useMemo, useState } from 'react'
import { LEANING_LABELS, type CatalogEntry } from '@shared/catalog'
import type { Lang } from '@shared/types'
import { useT } from '../lib/i18n'
import { CX, CY, H, hemicycleSeats, initials, SEAT_R, W } from './hemicycleLayout'

export const LEAN_COLORS: Record<number, string> = {
  [-3]: 'var(--lean-m3)',
  [-2]: 'var(--lean-m2)',
  [-1]: 'var(--lean-m1)',
  0: 'var(--lean-0)',
  1: 'var(--lean-p1)',
  2: 'var(--lean-p2)',
  3: 'var(--lean-p3)'
}

export default function Hemicycle({ entries, selected, onToggle, lang }: {
  entries: CatalogEntry[]
  selected: Set<string>
  onToggle(id: string): void
  lang: Lang
}): React.JSX.Element {
  const t = useT()
  const [hover, setHover] = useState<CatalogEntry | null>(null)
  const sorted = useMemo(() => [...entries].sort((a, b) => (a.leaning ?? 0) - (b.leaning ?? 0) || a.title.localeCompare(b.title)), [entries])
  const seats = useMemo(() => hemicycleSeats(sorted.length), [sorted.length])
  const chosen = sorted.filter((e) => selected.has(e.id))
  const left = chosen.filter((e) => (e.leaning ?? 0) < 0).length
  const center = chosen.filter((e) => (e.leaning ?? 0) === 0).length
  const right = chosen.filter((e) => (e.leaning ?? 0) > 0).length
  const mean = chosen.length ? chosen.reduce((a, e) => a + (e.leaning ?? 0), 0) / chosen.length : 0
  const labels = LEANING_LABELS[lang]
  const needle = Math.PI / 2 - (mean / 3) * (Math.PI / 2)

  return (
    <div className="hemicycle">
      <h4>{t.hemicycleTitle}</h4>
      <span className="hint">{t.hemicycleHint}</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t.hemicycleTitle}>
        {chosen.length > 0 && (
          <g style={{ transition: 'transform .5s' }}>
            <line x1={CX} y1={CY} x2={CX + 95 * Math.cos(needle)} y2={CY - 95 * Math.sin(needle)} stroke="var(--text-3)" strokeWidth={2} strokeLinecap="round" />
          </g>
        )}
        <circle cx={CX} cy={CY} r={6} fill="var(--text-3)" />
        <text x={CX} y={CY + 34} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--text)">
          {chosen.length} / {sorted.length}
        </text>
        <text x={CX} y={CY + 54} textAnchor="middle" fontSize={12} fill="var(--text-2)">
          {t.balance} : {labels[Math.round(mean)]}
        </text>
        {sorted.map((e, i) => {
          const s = seats[i]
          const on = selected.has(e.id)
          return (
            <g
              key={e.id}
              className={`seat${on ? '' : ' off'}`}
              onClick={() => onToggle(e.id)}
              onMouseEnter={() => setHover(e)}
              onMouseLeave={() => setHover(null)}
              role="checkbox"
              aria-checked={on}
              aria-label={`${e.title} — ${labels[e.leaning ?? 0]}`}
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === ' ' || ev.key === 'Enter') {
                  ev.preventDefault()
                  onToggle(e.id)
                }
              }}
            >
              <circle cx={s.x} cy={s.y} r={SEAT_R} fill={LEAN_COLORS[e.leaning ?? 0]} stroke="var(--reader)" strokeWidth={2} />
              <text x={s.x} y={s.y + 4.5} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="#fff" style={{ pointerEvents: 'none' }}>
                {initials(e.title)}
              </text>
              <title>{`${e.title} — ${labels[e.leaning ?? 0]}`}</title>
            </g>
          )
        })}
      </svg>
      <div className="hemi-tip">{hover ? [hover.title, labels[hover.leaning ?? 0], hover.owner && `${t.owner} : ${hover.owner}`].filter(Boolean).join(' · ') : '\u00a0'}</div>
      <div className="balance-bar" aria-hidden>
        <div style={{ flexGrow: left, background: 'var(--lean-m2)' }} />
        <div style={{ flexGrow: center, background: 'var(--lean-0)' }} />
        <div style={{ flexGrow: right, background: 'var(--lean-p2)' }} />
      </div>
      <div className="hemi-legend">
        {[-3, -2, -1, 0, 1, 2, 3].map((l) => (
          <span key={l}>
            <i className="lean-dot" style={{ background: LEAN_COLORS[l] }} />
            {labels[l]}
          </span>
        ))}
      </div>
      <div className="hemi-note">{t.hemicycleNote}</div>
    </div>
  )
}
