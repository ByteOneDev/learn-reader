// Lecture d'un fichier Markdown écrit par Learn (export/markdown.ts dans l'app) : métadonnées et
// surlignages, avec leur position dans le fichier. Fonctions pures, sans dépendance à Obsidian.

export interface LearnHighlight {
  id: string
  blockId: string
  quote: string
  note: string
  color: string
  layer: string
  /** Chapitre, page ou instant (titre ### qui précède), si le document en a. */
  label?: string
  /** Ligne (à partir de 0) de l'identifiant de bloc ^h-… : c'est là qu'on emmène l'utilisateur. */
  line: number
}

export interface LearnDoc {
  learnId: string
  title?: string
  url?: string
  type?: string
  author?: string
  highlights: LearnHighlight[]
}

const MARKER = /^%%learn:highlight id=(\S+) color=(\S+)(?: layer=(\S+))? updated=\S+%%\s*$/
const END = /<!-- learn:end[^>]*-->/

function unquote(v?: string): string | undefined {
  if (v === undefined) return undefined
  const t = v.trim()
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  return t
}

/** Titre de section sans lien Markdown : « [12:34](https://youtu.be/…) » → « 12:34 ». */
function plainLabel(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
}

export function parseLearnDoc(text: string): LearnDoc | null {
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') return null
  const fmEnd = lines.indexOf('---', 1)
  if (fmEnd === -1) return null
  const fm: Record<string, string> = {}
  for (const l of lines.slice(1, fmEnd)) {
    const m = l.match(/^([\w-]+):\s*(.*)$/)
    if (m) fm[m[1]] = m[2]
  }
  if (!fm.learn_id) return null
  const doc: LearnDoc = { learnId: fm.learn_id.trim(), title: unquote(fm.title), url: fm.url?.trim(), type: fm.type?.trim(), author: unquote(fm.author), highlights: [] }

  let label: string | undefined
  let quote: string[] = []
  let block: { id: string; line: number } | null = null
  let note: string[] = []
  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i]
    if (END.test(line)) break
    const heading = line.match(/^### (.+)$/)
    if (heading) {
      label = plainLabel(heading[1])
      continue
    }
    const marker = line.match(MARKER)
    if (marker && block) {
      doc.highlights.push({ id: marker[1], color: marker[2], layer: marker[3] ?? 'feed', blockId: block.id, line: block.line, quote: quote.join('\n'), note: note.join('\n').trim(), label })
      quote = []
      note = []
      block = null
      continue
    }
    const b = line.match(/^\^(h-[0-9a-z]+)\s*$/)
    if (b) {
      block = { id: b[1], line: i }
      continue
    }
    if (block) note.push(line)
    else if (line.startsWith('> ')) quote.push(line.slice(2))
    else if (line.trim() === '' && quote.length) continue
    else quote = []
  }
  return doc
}

/** Le surlignage dont la zone (de sa citation à son marqueur) contient la ligne donnée, sinon le plus proche avant. */
export function highlightAtLine(doc: LearnDoc, line: number): LearnHighlight | undefined {
  let best: LearnHighlight | undefined
  for (const h of doc.highlights) if (h.line - 3 <= line) best = h
  return best
}

export { learnLink } from '../../src/shared/links'
