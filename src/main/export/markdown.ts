import type { Highlight, Item, Source } from '@shared/types'
import { blockId, hostOf } from '@shared/util'

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

function typeOf(source?: Source): string {
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

export function buildMarkdown(item: Item, source: Source | undefined, highlights: Highlight[], now = Date.now()): string {
  const tags = ['learn', ...item.tags.map((t) => t.replace(/\s+/g, '-'))]
  const front = [
    '---',
    `learn_id: ${item.id}`,
    `title: ${yamlString(item.title)}`,
    item.author ? `author: ${yamlString(item.author)}` : null,
    source ? `source: ${yamlString(source.title)}` : null,
    item.url ? `url: ${item.url}` : null,
    `type: ${typeOf(source)}`,
    `published: ${isoDay(item.publishedAt)}`,
    `exported: ${isoDay(now)}`,
    `tags: [${tags.map((t) => yamlString(t)).join(', ')}]`,
    '---'
  ].filter((l): l is string => l !== null)

  const meta = [source?.title ?? hostOf(item.url), item.author, new Date(item.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]
    .filter(Boolean)
    .join(' · ')

  const body: string[] = [`# ${item.title}`, '', item.url ? `[${meta}](${item.url})` : meta, '']

  const sorted = [...highlights].sort((a, b) => (a.layer === b.layer ? a.start - b.start : a.layer === 'feed' ? -1 : 1))
  body.push('## Surlignages', '')
  if (!sorted.length) body.push('_Aucun surlignage pour l’instant._', '')
  for (const h of sorted) {
    body.push(quoteBlock(h.quote), '', `^${blockId(h.id)}`, '')
    if (h.note.trim()) body.push(h.note.trim(), '')
    body.push(`%%learn:highlight id=${h.id} color=${h.color} updated=${new Date(h.updatedAt).toISOString()}%%`, '')
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
