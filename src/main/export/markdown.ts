import type { Highlight, Item, Source } from '@shared/types'
import { blockId, hostOf } from '@shared/util'
import { learnLink } from '@shared/links'

// Un document = un fichier Markdown. Tout ce qui précède le marqueur END est régénéré par Learn ;
// tout ce que l'utilisateur écrit après est conservé d'un export à l'autre.
// Les identifiants de bloc (^h-xxxx) et les commentaires %%learn:…%% préparent la synchro bidirectionnelle.
export const END_MARKER = '<!-- learn:end — tout ce qui suit est à toi : Learn ne le modifie jamais -->'
const END_RE = /<!-- learn:end[^>]*-->/

function yamlString(s: string): string {
  return JSON.stringify(s)
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split(/\n+/)
    .map((l) => `> ${l}`)
    .join('\n')
}

/** Ordre de lecture des couches : texte du flux, texte complet, puis chapitres ou pages dans l'ordre. */
function layerRank(layer: string): number {
  if (layer === 'feed') return -3
  if (layer === 'full') return -2
  if (layer === 'transcript') return -1
  const n = Number(layer.split(':')[1])
  return Number.isFinite(n) ? n : 1e9
}

function typeOf(item: Item, source?: Source): string {
  if (item.format) return item.format === 'pdf' ? 'pdf' : 'book'
  if (item.mediaType === 'youtube' || item.mediaType === 'video') return 'video'
  if (item.mediaType === 'audio') return 'podcast'
  switch (source?.kind) {
    case 'reddit':
    case 'forum':
      return 'discussion'
    case 'mastodon':
    case 'bluesky':
    case 'x':
      return 'post'
    case 'youtube':
      return 'video'
    case 'podcast':
      return 'podcast'
    default:
      return 'article'
  }
}

export function buildMarkdown(
  item: Item,
  source: Source | undefined,
  highlights: Highlight[],
  now = Date.now(),
  /** Titre d'une couche (« Chapitre 3 », « Page 12 ») pour regrouper les surlignages d'un livre. */
  labelFor: (layer: string) => string | undefined = () => undefined
): string {
  const tags = ['learn', ...item.tags.map((t) => t.replace(/\s+/g, '-'))]
  const front = [
    '---',
    `learn_id: ${item.id}`,
    `title: ${yamlString(item.title)}`,
    item.author ? `author: ${yamlString(item.author)}` : null,
    source && source.kind !== 'book' ? `source: ${yamlString(source.title)}` : null,
    item.url ? `url: ${item.url}` : null,
    `type: ${typeOf(item, source)}`,
    `published: ${isoDay(item.publishedAt)}`,
    `exported: ${isoDay(now)}`,
    `tags: [${tags.map((t) => yamlString(t)).join(', ')}]`,
    '---'
  ].filter((l): l is string => l !== null)

  const meta = [item.format ? item.format.toUpperCase() : (source?.title ?? hostOf(item.url)), item.author, new Date(item.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]
    .filter(Boolean)
    .join(' · ')

  const body: string[] = [`# ${item.title}`, '', `${item.url ? `[${meta}](${item.url})` : meta} · [Ouvrir dans Learn](${learnLink(item.id)})`, '']

  const sorted = [...highlights].sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.start - b.start)
  body.push('## Surlignages', '')
  if (!sorted.length) body.push('_Aucun surlignage pour l’instant._', '')
  let currentLabel: string | undefined
  for (const h of sorted) {
    const label = labelFor(h.layer)
    if (label && label !== currentLabel) body.push(`### ${label}`, '')
    currentLabel = label
    body.push(quoteBlock(h.quote), '', `^${blockId(h.id)}`, '')
    if (h.note.trim()) body.push(h.note.trim(), '')
    body.push(`%%learn:highlight id=${h.id} color=${h.color} layer=${h.layer} updated=${new Date(h.updatedAt).toISOString()}%%`, '')
  }
  return [...front, '', ...body, END_MARKER, ''].join('\n')
}

/** Fusionne avec un fichier existant : on garde ce que l'utilisateur a écrit après le marqueur de fin. */
export function mergeWithExisting(generated: string, existing: string | null): string | null {
  if (existing == null) return generated
  const m = existing.match(END_RE)
  if (!m || m.index === undefined) return null // fichier qui n'a pas été créé par Learn : on ne l'écrase pas
  const userPart = existing.slice(m.index + m[0].length)
  return generated.replace(/\n?$/, '').replace(END_RE, END_MARKER) + userPart
}

export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return cleaned || 'Sans titre'
}
