import type { BoardData, BoardEdge, BoardNode } from './types'

// Mise en page automatique d'une mind map : arbre horizontal, la racine à gauche, les enfants
// empilés à droite et centrés sur leur parent. Les nœuds non reliés forment d'autres arbres, en dessous.

export const NODE_WIDTH = 260
const COLUMN_GAP = 90
const ROW_GAP = 22

/** Hauteur estimée d'un nœud d'après la longueur de son texte (assez juste pour éviter les chevauchements). */
export function nodeHeight(n: BoardNode): number {
  const text = n.kind === 'note' ? (n.text ?? '') : (n.quote ?? n.text ?? '')
  const lines = Math.min(8, Math.max(1, Math.ceil(text.length / 34) + (text.match(/\n/g)?.length ?? 0)))
  return (n.kind === 'note' ? 34 : 64) + lines * 19
}

export function findRoot(data: BoardData): BoardNode | undefined {
  const targets = new Set(data.edges.map((e) => e.to))
  return data.nodes.find((n) => n.root) ?? data.nodes.find((n) => !targets.has(n.id)) ?? data.nodes[0]
}

/** Arbre de lecture : enfants de chaque nœud, en suivant les liens depuis la racine (sans cycles). */
export function childrenMap(data: BoardData, rootId: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const adj = new Map<string, BoardEdge[]>()
  for (const e of data.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e])
    adj.set(e.to, [...(adj.get(e.to) ?? []), { ...e, from: e.to, to: e.from }])
  }
  const seen = new Set([rootId])
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    const kids: string[] = []
    // Les liens sortants d'abord, puis les entrants : la direction choisie par l'utilisateur prime.
    const edges = (adj.get(id) ?? []).sort((a, b) => Number(data.edges.includes(b)) - Number(data.edges.includes(a)))
    for (const e of edges) {
      if (seen.has(e.to)) continue
      seen.add(e.to)
      kids.push(e.to)
      queue.push(e.to)
    }
    out.set(id, kids)
  }
  return out
}

export function layoutMindmap(data: BoardData): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const placed = new Set<string>()
  let top = 0

  const layoutTree = (rootId: string): void => {
    const kids = childrenMap(data, rootId)
    const height = new Map<string, number>()
    const measure = (id: string): number => {
      const own = nodeHeight(byId.get(id)!)
      const children = kids.get(id) ?? []
      const sub = children.reduce((a, c) => a + measure(c), 0) + Math.max(0, children.length - 1) * ROW_GAP
      const h = Math.max(own, sub)
      height.set(id, h)
      return h
    }
    const total = measure(rootId)
    const place = (id: string, depth: number, y0: number): void => {
      const own = nodeHeight(byId.get(id)!)
      const h = height.get(id)!
      pos.set(id, { x: depth * (NODE_WIDTH + COLUMN_GAP), y: Math.round(y0 + (h - own) / 2) })
      placed.add(id)
      let y = y0 + (h - ((kids.get(id) ?? []).reduce((a, c) => a + height.get(c)!, 0) + Math.max(0, (kids.get(id) ?? []).length - 1) * ROW_GAP)) / 2
      for (const c of kids.get(id) ?? []) {
        place(c, depth + 1, y)
        y += height.get(c)! + ROW_GAP
      }
    }
    place(rootId, 0, top)
    top += total + ROW_GAP * 4
  }

  const root = findRoot(data)
  if (root) layoutTree(root.id)
  for (const n of data.nodes) if (!placed.has(n.id)) layoutTree(n.id)
  return pos
}
