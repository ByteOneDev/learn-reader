import type { Lang } from '@shared/types'

/** Date relative compacte façon Reeder : 12m, 3h, 1d, puis la date. */
export function relativeTime(t: number, lang: Lang, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return lang === 'fr' ? 'maint.' : 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return lang === 'fr' ? `${d}j` : `${d}d`
  return new Date(t).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' })
}

export function fullDate(t: number, lang: Lang): string {
  return new Date(t).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
