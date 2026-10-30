import { findQuote } from '@shared/anchor'
import type { Highlight } from '@shared/types'

// Passage entre la sélection du navigateur et des positions dans le texte brut du contenu.

function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

export function plainText(root: Node): string {
  return textNodes(root)
    .map((t) => t.data)
    .join('')
}

/** Position d'un point (nœud, décalage) dans le texte brut de `root`. */
function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

export function selectionOffsets(root: HTMLElement, sel: Selection): { start: number; end: number; text: string } | null {
  if (!sel.rangeCount || sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.commonAncestorContainer)) return null
  const start = offsetOf(root, r.startContainer, r.startOffset)
  const end = offsetOf(root, r.endContainer, r.endOffset)
  const text = plainText(root).slice(start, end)
  if (!text.trim()) return null
  // On retire les espaces de bord pour une citation propre.
  const lead = text.length - text.trimStart().length
  const trail = text.length - text.trimEnd().length
  return { start: start + lead, end: end - trail, text: text.trim() }
}

/** Enveloppe [start, end) dans des <mark>, en découpant les nœuds texte traversés. */
function wrapRange(root: HTMLElement, start: number, end: number, h: Highlight): void {
  let pos = 0
  for (const node of textNodes(root)) {
    const len = node.data.length
    const nodeStart = pos
    pos += len
    if (pos <= start || nodeStart >= end) continue
    const from = Math.max(0, start - nodeStart)
    const to = Math.min(len, end - nodeStart)
    if (to <= from || !node.data.slice(from, to).trim()) continue
    let target = node
    if (from > 0) target = target.splitText(from)
    if (to - from < target.data.length) target.splitText(to - from)
    const mark = document.createElement('mark')
    mark.className = `hl hl-${h.color}${h.note.trim() ? ' hl-noted' : ''}`
    mark.dataset.hl = h.id
    target.parentNode?.insertBefore(mark, target)
    mark.appendChild(target)
  }
}

/** Applique les surlignages au contenu ; renvoie les ids qu'on n'a pas pu réancrer. */
export function applyHighlights(root: HTMLElement, highlights: Highlight[]): Set<string> {
  const text = plainText(root)
  const orphans = new Set<string>()
  const placed = highlights
    .map((h) => ({ h, pos: findQuote(text, h) }))
    .filter((p) => {
      if (!p.pos) orphans.add(p.h.id)
      return !!p.pos
    })
    // De la fin vers le début : les positions restent valides pendant qu'on découpe.
    .sort((a, b) => b.pos!.start - a.pos!.start)
  for (const { h, pos } of placed) wrapRange(root, pos!.start, pos!.end, h)
  return orphans
}
