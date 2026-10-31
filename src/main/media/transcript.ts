import type { Cue } from '@shared/types'
import { htmlToText } from '@shared/util'

// Transcriptions de podcasts (balise podcast:transcript) : WebVTT, SRT, JSON (format Podcasting 2.0),
// HTML ou texte brut. On produit des segments horodatés, regroupés en phrases lisibles.

function ts(s: string): number {
  const m = s.trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/)
  if (!m) return NaN
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function fromTimed(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim())
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at === -1) continue
    const [a, b] = lines[at].split('-->')
    const start = ts(a)
    const end = ts(b.trim().split(/\s+/)[0])
    if (!Number.isFinite(start)) continue
    let body = lines.slice(at + 1).join(' ')
    let speaker: string | undefined
    const v = body.match(/^<v(?:\.[\w.]+)?\s+([^>]+)>/)
    if (v) speaker = v[1].trim()
    body = htmlToText(body.replace(/<v[^>]*>/g, '').replace(/<\/v>/g, ''))
    const prefixed = body.match(/^([A-ZÀ-Ý][\wÀ-ÿ .'-]{0,30}):\s+(.*)$/)
    if (!speaker && prefixed) {
      speaker = prefixed[1]
      body = prefixed[2]
    }
    if (body) cues.push({ start, end: Number.isFinite(end) ? end : undefined, text: body, speaker })
  }
  return cues
}

interface JsonSegment {
  startTime?: number
  endTime?: number
  body?: string
  speaker?: string
}

/** Regroupe les petits segments (souvent quelques mots) en blocs d'environ 30 secondes, par intervenant. */
export function mergeCues(cues: Cue[], span = 30): Cue[] {
  const out: Cue[] = []
  for (const c of cues) {
    const last = out.at(-1)
    if (last && last.speaker === c.speaker && c.start - last.start < span) {
      last.text = `${last.text} ${c.text}`.replace(/\s+/g, ' ')
      last.end = c.end ?? last.end
    } else out.push({ ...c })
  }
  return out
}

export function parseTranscript(body: string, contentType = ''): Cue[] {
  const t = body.trimStart()
  if (t.startsWith('{') || t.startsWith('[') || contentType.includes('json')) {
    const json = JSON.parse(t) as { segments?: JsonSegment[] } | JsonSegment[]
    const segs = Array.isArray(json) ? json : json.segments ?? []
    return mergeCues(
      segs.filter((s) => s.body?.trim()).map((s) => ({ start: s.startTime ?? 0, end: s.endTime, text: s.body!.trim(), speaker: s.speaker || undefined }))
    )
  }
  if (t.startsWith('WEBVTT') || /\d{2}:\d{2}[.,]\d{3}\s*-->/.test(t)) return mergeCues(fromTimed(t))
  // HTML ou texte brut : pas d'horodatage, un segment par paragraphe.
  const plain = /<\w+/.test(t)
    ? t
        .split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
        .map((p) => htmlToText(p))
        .filter(Boolean)
    : t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return plain.map((text) => ({ start: -1, text }))
}
