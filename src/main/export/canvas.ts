import type { Board, BoardNode, HighlightColor } from '@shared/types'
import { childrenMap, findRoot, nodeHeight, NODE_WIDTH } from '@shared/boardLayout'
import { blockId } from '@shared/util'

// Export d'un board au format JSON Canvas (https://jsoncanvas.org), lu nativement par Obsidian Canvas.
// Un surlignage dont le document est exporté devient un nœud « fichier » pointant sur son bloc (^h-…).

const CANVAS_COLOR: Record<HighlightColor, string> = { pink: '1', yellow: '3', green: '4', blue: '5', purple: '6' }

export interface CanvasNode {
  id: string
  type: 'text' | 'file'
  x: number
  y: number
  width: number
  height: number
  text?: string
  file?: string
  subpath?: string
  color?: string
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide: 'right'
  toSide: 'left'
  label?: string
}

function quoteText(n: BoardNode): string {
  const quote = (n.quote ?? '').trim().split(/\n+/).map((l) => `> ${l}`).join('\n')
  return [quote, n.itemTitle ? `— *${n.itemTitle}*` : ''].filter(Boolean).join('\n\n')
}

/** `docPath(itemId)` renvoie le chemin du fichier du document dans le coffre (relatif), s'il existe. */
export function buildCanvas(board: Board, docPath: (itemId: string) => string | undefined): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = board.data.nodes.map((n): CanvasNode => {
    const base = { id: n.id, x: Math.round(n.x), y: Math.round(n.y), width: NODE_WIDTH, height: nodeHeight(n) }
    const color = n.color ? CANVAS_COLOR[n.color] : undefined
    if (n.kind === 'highlight' && n.itemId && n.highlightId) {
      const file = docPath(n.itemId)
      if (file) return { ...base, type: 'file', file, subpath: `#^${blockId(n.highlightId)}`, color }
    }
    if (n.kind === 'source' && n.itemId) {
      const file = docPath(n.itemId)
      if (file) return { ...base, type: 'file', file }
    }
    if (n.kind === 'note') return { ...base, type: 'text', text: n.text ?? '' }
    return { ...base, type: 'text', text: n.kind === 'source' ? `**${n.itemTitle ?? ''}**` : quoteText(n), color }
  })
  const edges = board.data.edges.map((e): CanvasEdge => ({ id: e.id, fromNode: e.from, toNode: e.to, fromSide: 'right', toSide: 'left', ...(e.label ? { label: e.label } : {}) }))
  return { nodes, edges }
}

/** Plan Markdown d'un board (liste imbriquée depuis la racine), pratique pour Notion ou une note. */
export function boardOutline(board: Board): string {
  const byId = new Map(board.data.nodes.map((n) => [n.id, n]))
  const labelOf = new Map(board.data.edges.flatMap((e) => (e.label ? [[`${e.from}>${e.to}`, e.label] as const, [`${e.to}>${e.from}`, e.label] as const] : [])))
  const lines: string[] = [`# ${board.title}`, '']
  const text = (n: BoardNode): string => {
    if (n.kind === 'note') return (n.text ?? '').replace(/\n+/g, ' ')
    if (n.kind === 'source') return `**${n.itemTitle ?? ''}**`
    return `« ${(n.quote ?? '').replace(/\n+/g, ' ')} »${n.itemTitle ? ` — *${n.itemTitle}*` : ''}`
  }
  const seen = new Set<string>()
  const walk = (id: string, depth: number, parent: string | null, kids: Map<string, string[]>): void => {
    seen.add(id)
    const label = parent ? labelOf.get(`${parent}>${id}`) : undefined
    lines.push(`${'  '.repeat(depth)}- ${label ? `(*${label}*) ` : ''}${text(byId.get(id)!)}`)
    for (const c of kids.get(id) ?? []) walk(c, depth + 1, id, kids)
  }
  const root = findRoot(board.data)
  if (root) walk(root.id, 0, null, childrenMap(board.data, root.id))
  for (const n of board.data.nodes) if (!seen.has(n.id)) walk(n.id, 0, null, childrenMap(board.data, n.id))
  return lines.join('\n') + '\n'
}
