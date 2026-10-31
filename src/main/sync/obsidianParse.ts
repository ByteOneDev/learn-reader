import type { HighlightColor } from '@shared/types'

// Relit un fichier Markdown produit par Learn (voir export/markdown.ts) pour en extraire
// ce que l'utilisateur a pu modifier dans Obsidian : notes, couleurs, suppressions, tags.

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']
const MARKER_RE = /^%%learn:highlight id=(\S+) color=(\S+)(?: layer=\S+)? updated=\S+%%\s*$/
const END_RE = /<!-- learn:end[^>]*-->/

export interface ParsedHighlight {
  note: string
  color: HighlightColor
}

export interface ParsedLearnFile {
  learnId: string
  tags: string[]
  highlights: Map<string, ParsedHighlight>
}

function frontmatter(text: string): Record<string, string> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return null
  const out: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

/** Tags du frontmatter, formats `[a, "b c"]` ou liste YAML ; le tag technique « learn » est ignoré. */
function parseTags(text: string, raw: string | undefined): string[] {
  let tags: string[] = []
  if (raw && raw.startsWith('[')) {
    tags = raw
      .slice(1, raw.lastIndexOf(']'))
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
  } else {
    const block = text.match(/^tags:\s*\r?\n((?:\s*-\s*.+\r?\n)+)/m)
    if (block) tags = block[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, '').trim())
  }
  return [...new Set(tags.filter((t) => t && t !== 'learn'))]
}

/** Renvoie null si le fichier n'a pas (ou plus) la structure Learn : on ne touche alors à rien. */
export function parseLearnFile(text: string): ParsedLearnFile | null {
  const fm = frontmatter(text)
  const learnId = fm?.learn_id
  const end = text.search(END_RE)
  if (!learnId || end === -1) return null
  const managed = text.slice(0, end).split(/\r?\n/)
  const highlights = new Map<string, ParsedHighlight>()
  let noteLines: string[] | null = null
  for (const line of managed) {
    const marker = line.match(MARKER_RE)
    if (marker) {
      const color = COLORS.includes(marker[2] as HighlightColor) ? (marker[2] as HighlightColor) : 'yellow'
      highlights.set(marker[1], { note: (noteLines ?? []).join('\n').trim(), color })
      noteLines = null
      continue
    }
    if (/^\^h-[0-9a-z]+\s*$/.test(line)) {
      noteLines = []
      continue
    }
    if (noteLines) noteLines.push(line)
  }
  return { learnId, tags: parseTags(text, fm.tags), highlights }
}
