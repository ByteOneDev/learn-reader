import type { HighlightColor } from '@shared/types'

// Conversion entre le Markdown des notes de Learn et le « rich text » de l'API Notion.
// Pris en charge : **gras**, *italique* / _italique_, `code`, [lien](url), paragraphes.

export interface RichText {
  type: 'text'
  text: { content: string; link: { url: string } | null }
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; color?: string }
  plain_text?: string
}

export interface NotionBlock {
  object?: 'block'
  id?: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

const MAX_TEXT = 2000

export const NOTION_COLOR: Record<HighlightColor, string> = {
  yellow: 'yellow_background',
  green: 'green_background',
  blue: 'blue_background',
  pink: 'pink_background',
  purple: 'purple_background'
}

export function colorFromNotion(c: string | undefined): HighlightColor {
  const found = (Object.entries(NOTION_COLOR) as [HighlightColor, string][]).find(([, v]) => v === c || v.replace('_background', '') === c)
  return found?.[0] ?? 'yellow'
}

function chunk(content: string, annotations: RichText['annotations'], url?: string): RichText[] {
  const out: RichText[] = []
  for (let i = 0; i < content.length; i += MAX_TEXT) {
    out.push({ type: 'text', text: { content: content.slice(i, i + MAX_TEXT), link: url ? { url } : null }, ...(annotations ? { annotations } : {}) })
  }
  return out
}

/** Une ligne de Markdown → rich text. */
export function mdToRichText(md: string): RichText[] {
  const out: RichText[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])/g
  let last = 0
  for (const m of md.matchAll(re)) {
    if (m.index! > last) out.push(...chunk(md.slice(last, m.index), undefined))
    if (m[1] !== undefined) out.push(...chunk(m[1], { bold: true }))
    else if (m[2] !== undefined) out.push(...chunk(m[2], { code: true }))
    else if (m[3] !== undefined) out.push(...chunk(m[3], undefined, m[4]))
    else out.push(...chunk(m[5] ?? m[6], { italic: true }))
    last = m.index! + m[0].length
  }
  if (last < md.length) out.push(...chunk(md.slice(last), undefined))
  return out
}

export function richTextToMd(rt: RichText[] | undefined): string {
  return (rt ?? [])
    .map((r) => {
      let t = r.plain_text ?? r.text?.content ?? ''
      if (!t) return ''
      if (r.annotations?.code) t = `\`${t}\``
      if (r.annotations?.bold) t = `**${t}**`
      if (r.annotations?.italic) t = `*${t}*`
      const url = r.text?.link?.url
      if (url) t = `[${t}](${url})`
      return t
    })
    .join('')
}

/** Note Markdown → paragraphes Notion (un par bloc de texte séparé par une ligne vide). */
export function noteToBlocks(note: string): NotionBlock[] {
  return note
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: mdToRichText(p.trim()) } }))
}

export function blocksToNote(blocks: NotionBlock[]): string {
  return blocks
    .filter((b) => b.type === 'paragraph')
    .map((b) => richTextToMd((b.paragraph as { rich_text?: RichText[] })?.rich_text))
    .filter((p) => p.trim())
    .join('\n\n')
    .trim()
}

/** Bloc citation d'un surlignage, sa note en paragraphes enfants. Le libellé (chapitre, page) précède la citation. */
export function highlightToBlock(h: { quote: string; note: string; color: HighlightColor }, label?: string): NotionBlock {
  const rich: RichText[] = [...(label ? chunk(`${label} · `, { italic: true, color: 'gray' }) : []), ...chunk(h.quote, undefined)]
  const children = noteToBlocks(h.note)
  return { object: 'block', type: 'quote', quote: { rich_text: rich, color: NOTION_COLOR[h.color], ...(children.length ? { children } : {}) } }
}

/** Identifiant Notion (32 caractères hexadécimaux) extrait d'une URL ou d'un identifiant collé. */
export function notionId(input: string): string | null {
  const m = input.replace(/-/g, '').match(/([0-9a-f]{32})(?:\?|#|$|[^0-9a-f])/i)
  if (!m) return null
  const h = m[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
