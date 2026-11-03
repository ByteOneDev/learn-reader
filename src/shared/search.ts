import { decodeEntities } from './util'

// Recherche plein texte : la saisie devient une requête FTS (chaque mot en préfixe, tous requis), et les
// extraits renvoyés par SQLite deviennent des segments à afficher, sans jamais injecter de HTML.

/** Marqueurs d'extrait (caractères de contrôle : absents des textes). */
export const HIT_OPEN = '\u0001'
export const HIT_CLOSE = '\u0002'

/** « échecs carl » → `échecs* carl*` ; null si rien de cherchable. */
export function ftsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8)
  return tokens.length ? tokens.map((t) => `${t}*`).join(' ') : null
}

export interface SnippetPart {
  text: string
  hit: boolean
}

/** Extrait SQLite (balises HTML possibles, marqueurs de correspondance) → segments de texte brut. */
export function snippetParts(raw: string): SnippetPart[] {
  const plain = decodeEntities(
    raw
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      // Balise coupée en début ou fin d'extrait.
      .replace(/^[^<]*?>/, '')
      .replace(/<[^>]*$/, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
  const parts: SnippetPart[] = []
  let hit = false
  let buf = ''
  for (const ch of plain) {
    if (ch === HIT_OPEN || ch === HIT_CLOSE) {
      if (buf) parts.push({ text: buf, hit })
      buf = ''
      hit = ch === HIT_OPEN
    } else buf += ch
  }
  if (buf) parts.push({ text: buf, hit })
  return parts
}
