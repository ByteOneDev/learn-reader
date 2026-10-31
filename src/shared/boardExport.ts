import type { Board, BoardData, BoardNode, HighlightColor } from './types'
import { childrenMap, findRoot, nodeHeight, NODE_WIDTH } from './boardLayout'

// Exports d'un board : OPML (importé par MindNode, OmniOutliner…), FreeMind .mm (MindNode, XMind,
// Freeplane…) et SVG (aussi converti en PDF par l'app). Fonctions pures, testées sans DOM.

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function nodeText(n: BoardNode): string {
  if (n.kind === 'note') return (n.text ?? '').trim()
  if (n.kind === 'source') return n.itemTitle ?? ''
  return `« ${(n.quote ?? '').trim()} »${n.itemTitle ? ` — ${n.itemTitle}` : ''}`
}

interface TreeNode {
  node: BoardNode
  label?: string
  children: TreeNode[]
}

/** Le board vu comme une forêt : l'arbre de la racine, puis les groupes non reliés. */
export function boardForest(board: Board): TreeNode[] {
  const byId = new Map(board.data.nodes.map((n) => [n.id, n]))
  const labelOf = new Map(board.data.edges.flatMap((e) => (e.label ? [[`${e.from}>${e.to}`, e.label] as const, [`${e.to}>${e.from}`, e.label] as const] : [])))
  const seen = new Set<string>()
  const build = (id: string, parent: string | null, kids: Map<string, string[]>): TreeNode => {
    seen.add(id)
    return { node: byId.get(id)!, label: parent ? labelOf.get(`${parent}>${id}`) : undefined, children: (kids.get(id) ?? []).map((c) => build(c, id, kids)) }
  }
  const out: TreeNode[] = []
  const root = findRoot(board.data)
  if (root) out.push(build(root.id, null, childrenMap(board.data, root.id)))
  for (const n of board.data.nodes) if (!seen.has(n.id)) out.push(build(n.id, null, childrenMap(board.data, n.id)))
  return out
}

/** OPML 2.0 : un niveau par profondeur de la mind map ; les liens nommés deviennent un préfixe. */
export function boardToOpml(board: Board): string {
  const line = (t: TreeNode, depth: number): string => {
    const text = `${t.label ? `(${t.label}) ` : ''}${nodeText(t.node)}`
    const pad = '  '.repeat(depth + 2)
    if (!t.children.length) return `${pad}<outline text="${xml(text)}"/>`
    return `${pad}<outline text="${xml(text)}">\n${t.children.map((c) => line(c, depth + 1)).join('\n')}\n${pad}</outline>`
  }
  const forest = boardForest(board)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xml(board.title)}</title></head>\n  <body>\n${forest.map((t) => line(t, 0)).join('\n')}\n  </body>\n</opml>\n`
}

const FM_COLOR: Record<HighlightColor, string> = { yellow: '#fde68a', green: '#a7f3d0', blue: '#bfdbfe', pink: '#fbcfe8', purple: '#ddd6fe' }

/** FreeMind (.mm) : arbre unique (les groupes non reliés deviennent des branches d'une racine au nom du board). */
export function boardToFreeMind(board: Board): string {
  const node = (t: TreeNode, depth: number): string => {
    const pad = '  '.repeat(depth + 1)
    const color = t.node.color && t.node.kind !== 'note' ? ` BACKGROUND_COLOR="${FM_COLOR[t.node.color]}"` : ''
    const label = t.label ? `${pad}  <attribute NAME="lien" VALUE="${xml(t.label)}"/>\n` : ''
    const kids = t.children.map((c) => node(c, depth + 1)).join('\n')
    return `${pad}<node TEXT="${xml(nodeText(t.node))}"${color}>\n${label}${kids ? kids + '\n' : ''}${pad}</node>`
  }
  const forest = boardForest(board)
  const body = forest.length === 1 ? node(forest[0], 0) : `  <node TEXT="${xml(board.title)}">\n${forest.map((t) => node(t, 1)).join('\n')}\n  </node>`
  return `<map version="1.0.1">\n${body}\n</map>\n`
}

/** Découpe un texte en lignes d'environ `max` caractères (approximation suffisante pour un export). */
export function wrap(text: string, max = 34): string[] {
  const out: string[] = []
  for (const para of text.split(/\n+/)) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (line && (line + ' ' + word).length > max) {
        out.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line) out.push(line)
  }
  return out.slice(0, 9)
}

const DOT: Record<HighlightColor, string> = { yellow: '#facc15', green: '#34d399', blue: '#60a5fa', pink: '#f472b6', purple: '#a78bfa' }

/** Dessin vectoriel du board, sur fond clair (pour l'impression et le PDF). */
export function boardToSvg(board: Board): { svg: string; width: number; height: number } {
  const nodes = board.data.nodes
  const pad = 40
  if (!nodes.length) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><text x="20" y="60" font-family="sans-serif">${xml(board.title)}</text></svg>`, width: 400, height: 120 }
  const box = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y, w: NODE_WIDTH, h: nodeHeight(n) }]))
  const minX = Math.min(...nodes.map((n) => n.x)) - pad
  const minY = Math.min(...nodes.map((n) => n.y)) - pad - 40
  const maxX = Math.max(...[...box.values()].map((b) => b.x + b.w)) + pad
  const maxY = Math.max(...[...box.values()].map((b) => b.y + b.h)) + pad
  const width = Math.ceil(maxX - minX)
  const height = Math.ceil(maxY - minY)
  const parts: string[] = []
  parts.push(`<text x="${pad}" y="${pad}" font-size="20" font-weight="800" fill="#111">${xml(board.title)}</text>`)
  for (const e of board.data.edges) {
    const a = box.get(e.from)
    const b = box.get(e.to)
    if (!a || !b) continue
    const x1 = a.x + a.w - minX
    const y1 = a.y + a.h / 2 - minY
    const x2 = b.x - minX
    const y2 = b.y + b.h / 2 - minY
    const dx = Math.max(40, Math.abs(x2 - x1) / 2)
    parts.push(`<path d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" fill="none" stroke="#9ca3af" stroke-width="1.6"/>`)
    if (e.label) parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-size="11" font-style="italic" font-weight="700" fill="#6b7280">${xml(e.label)}</text>`)
  }
  for (const n of nodes) {
    const b = box.get(n.id)!
    const x = b.x - minX
    const y = b.y - minY
    const note = n.kind === 'note'
    parts.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="12" fill="${n.root ? '#ecfdf5' : '#ffffff'}" stroke="${n.root ? '#10b981' : '#e5e7eb'}" stroke-width="${n.root ? 2 : 1}"/>`)
    if (!note) parts.push(`<rect x="${x}" y="${y + 6}" width="4" height="${b.h - 12}" rx="2" fill="${n.color ? DOT[n.color] : '#9ca3af'}"/>`)
    const lines = wrap(note ? n.text ?? '' : n.kind === 'source' ? n.itemTitle ?? '' : n.quote ?? '')
    lines.forEach((l, i) => parts.push(`<text x="${x + 16}" y="${y + 24 + i * 19}" font-size="${note ? 14 : 13}" font-weight="${note ? 700 : 400}" fill="#111827">${xml(l)}</text>`))
    if (!note && n.kind !== 'source' && n.itemTitle) parts.push(`<text x="${x + 16}" y="${y + b.h - 12}" font-size="10.5" font-weight="600" fill="#6b7280">${xml(n.itemTitle.slice(0, 44))}</text>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"><rect width="100%" height="100%" fill="#fafafa"/>${parts.join('')}</svg>`
  return { svg, width, height }
}

type SketchEl = { link?: string | null; isDeleted?: boolean; containerId?: string | null }

/** Taille affichée dans la barre latérale : nœuds, ajouts en attente, et cartes liées d'un schéma. */
export function boardSize(data: BoardData): number {
  const linked = (data.sketch?.elements ?? []).filter((e) => {
    const el = e as SketchEl
    return !el.isDeleted && !!el.link
  }).length
  return data.nodes.length + (data.pending?.length ?? 0) + linked
}

/** Le board cite-t-il ce document ? (nœud, ajout en attente, ou lien learn:// d'un élément de schéma) */
export function boardCitesItem(data: BoardData, itemId: string): boolean {
  if (data.nodes.some((n) => n.itemId === itemId) || data.pending?.some((n) => n.itemId === itemId)) return true
  const needle = `item=${encodeURIComponent(itemId)}`
  return (data.sketch?.elements ?? []).some((e) => {
    const el = e as SketchEl
    return !el.isDeleted && typeof el.link === 'string' && el.link.startsWith('learn://') && (el.link.includes(`${needle}&`) || el.link.endsWith(needle))
  })
}
