import { useEffect, useMemo, useState } from 'react'
import type { BalanceEntry, ReadingBalance } from '@shared/types'
import { LEANING_LABELS } from '@shared/catalog'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { LEAN_COLORS } from '../onboarding/Hemicycle'
import { CX, CY, H, hemicycleSeats, initials, SEAT_R, W } from '../onboarding/hemicycleLayout'
import Dialog from './Dialog'

/** Bilan de lecture : le même hémicycle qu'au premier lancement, rempli par ce qu'on lit vraiment. */
export default function BalanceDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const lang = useApp((s) => s.settings?.language ?? 'fr')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ReadingBalance | null>(null)
  const [hover, setHover] = useState<BalanceEntry | null>(null)

  useEffect(() => {
    void api.readingBalance(days).then(setData)
  }, [api, days])

  const entries = data?.entries ?? []
  const seats = useMemo(() => hemicycleSeats(entries.length), [entries.length])
  const max = Math.max(1, ...entries.map((e) => e.reads))
  const total = entries.reduce((a, e) => a + e.reads, 0)
  const left = entries.filter((e) => e.leaning < 0).reduce((a, e) => a + e.reads, 0)
  const center = entries.filter((e) => e.leaning === 0).reduce((a, e) => a + e.reads, 0)
  const right = entries.filter((e) => e.leaning > 0).reduce((a, e) => a + e.reads, 0)
  const mean = total ? entries.reduce((a, e) => a + e.leaning * e.reads, 0) / total : 0
  const needle = Math.PI / 2 - (mean / 3) * (Math.PI / 2)
  const labels = LEANING_LABELS[lang]
  const pct = (n: number): string => (total ? `${Math.round((n / total) * 100)} %` : '—')

  return (
    <Dialog title={t.balanceTitle} onClose={onClose} width={680}>
      <p className="hint" style={{ fontSize: 13.5, marginTop: 0 }}>
        {t.balanceHint}
      </p>
      <div className="segmented" style={{ marginBottom: 12 }}>
        {[7, 30, 90].map((d) => (
          <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
            {t.days(d)}
          </button>
        ))}
      </div>

      {data && entries.length === 0 && <div className="list-empty">{t.balanceEmpty}</div>}
      {entries.length > 0 && (
        <div className="hemicycle" style={{ marginBottom: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.balanceTitle}>
            {total > 0 && (
              <line x1={CX} y1={CY} x2={CX + 95 * Math.cos(needle)} y2={CY - 95 * Math.sin(needle)} stroke="var(--text-3)" strokeWidth={2} strokeLinecap="round" />
            )}
            <circle cx={CX} cy={CY} r={6} fill="var(--text-3)" />
            <text x={CX} y={CY + 34} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--text)">
              {t.reads(total)}
            </text>
            <text x={CX} y={CY + 54} textAnchor="middle" fontSize={12} fill="var(--text-2)">
              {total ? `${t.balance} : ${labels[Math.round(mean)]}` : t.balanceNoReads}
            </text>
            {entries.map((e, i) => {
              const s = seats[i]
              const weight = e.reads / max
              return (
                <g key={e.sourceId} className="seat" onMouseEnter={() => setHover(e)} onMouseLeave={() => setHover(null)}>
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={SEAT_R * (0.75 + 0.35 * weight)}
                    fill={LEAN_COLORS[e.leaning] ?? 'var(--lean-0)'}
                    opacity={e.reads ? 0.45 + 0.55 * weight : 0.16}
                    stroke="var(--reader)"
                    strokeWidth={2}
                  />
                  <text x={s.x} y={s.y + 4.5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fff" style={{ pointerEvents: 'none' }}>
                    {e.reads || initials(e.title)}
                  </text>
                  <title>{`${e.title} — ${labels[e.leaning]} — ${t.reads(e.reads)}`}</title>
                </g>
              )
            })}
          </svg>
          <div className="hemi-tip">
            {hover ? [hover.title, labels[hover.leaning], t.reads(hover.reads), hover.owner && `${t.owner} : ${hover.owner}`].filter(Boolean).join(' · ') : ' '}
          </div>
          <div className="balance-bar" aria-hidden>
            <div style={{ flexGrow: left, background: 'var(--lean-m2)' }} />
            <div style={{ flexGrow: center, background: 'var(--lean-0)' }} />
            <div style={{ flexGrow: right, background: 'var(--lean-p2)' }} />
          </div>
          <div className="hemi-legend">
            <span>
              <i className="lean-dot" style={{ background: 'var(--lean-m2)' }} /> {t.leftShare} {pct(left)}
            </span>
            <span>
              <i className="lean-dot" style={{ background: 'var(--lean-0)' }} /> {t.centerShare} {pct(center)}
            </span>
            <span>
              <i className="lean-dot" style={{ background: 'var(--lean-p2)' }} /> {t.rightShare} {pct(right)}
            </span>
          </div>
          {!!data?.otherReads && <div className="hemi-note">{t.otherReads(data.otherReads)}</div>}
          <div className="hemi-note">{t.hemicycleNote}</div>
        </div>
      )}
    </Dialog>
  )
}
