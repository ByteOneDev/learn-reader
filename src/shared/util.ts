export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

/** Identifiant de bloc Obsidian stable dérivé de l'id du surlignage : `^h-xxxxxx`. */
export function blockId(highlightId: string): string {
  let h = 0
  for (let i = 0; i < highlightId.length; i++) h = (Math.imul(31, h) + highlightId.charCodeAt(i)) | 0
  return 'h-' + (h >>> 0).toString(36).padStart(6, '0').slice(0, 7)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** HTML → texte brut compact, pour les extraits de la liste. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/?(p|div|li|ul|ol|h[1-6]|blockquote|tr|td|th|figure|figcaption|section|article|header|footer|img)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return (space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

export function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
