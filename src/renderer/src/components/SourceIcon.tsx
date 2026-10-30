import type { Source } from '@shared/types'

const PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58']

function colorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export default function SourceIcon({ source, size = 'sm' }: { source?: Source; size?: 'sm' | 'lg' }): React.JSX.Element {
  const cls = `src-icon${size === 'lg' ? ' lg' : ''}`
  if (source?.icon) return <img className={cls} src={source.icon} alt="" draggable={false} />
  const title = source?.title ?? '?'
  const letter = (title.replace(/^(r\/|@)/, '')[0] ?? '?').toUpperCase()
  return (
    <span className={cls} style={{ background: colorFor(title) }} aria-hidden>
      {letter}
    </span>
  )
}
