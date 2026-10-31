// Petites fonctions partagées pour les épisodes et les vidéos.

/** « 1:02:03 », « 45:10 » ou « 3723 » → secondes. */
export function parseDuration(s?: string): number | undefined {
  if (!s) return undefined
  const t = s.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t))
  const parts = t.split(':').map(Number)
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return undefined
  return parts.reduce((a, n) => a * 60 + n, 0)
}

/** 754 → « 12:34 », 3723 → « 1:02:03 ». */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export function youtubeId(url?: string): string | undefined {
  if (!url) return undefined
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)
  return m?.[1]
}

/** Lien vers un instant précis d'une vidéo ou d'un épisode. */
export function timeLink(url: string | undefined, sec: number, mediaType?: string): string | undefined {
  if (!url) return undefined
  const id = mediaType === 'youtube' ? youtubeId(url) : undefined
  if (id) return `https://youtu.be/${id}?t=${Math.floor(sec)}`
  return `${url}${url.includes('#') ? '' : '#'}t=${Math.floor(sec)}`
}
