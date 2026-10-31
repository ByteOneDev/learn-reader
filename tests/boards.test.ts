import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutMindmap, nodeHeight, NODE_WIDTH } from '../src/shared/boardLayout'
import { boardOutline, buildCanvas } from '../src/main/export/canvas'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import type { Board, BoardData, BoardNode } from '../src/shared/types'
import { blockId } from '../src/shared/util'
import { learnLink } from '../src/shared/links'

const note = (id: string, text: string, extra: Partial<BoardNode> = {}): BoardNode => ({ id, kind: 'note', text, x: 0, y: 0, ...extra })

function overlaps(data: BoardData, pos: Map<string, { x: number; y: number }>): boolean {
  const boxes = data.nodes.map((n) => ({ ...pos.get(n.id)!, h: nodeHeight(n) }))
  return boxes.some((a, i) => boxes.some((b, j) => i < j && a.x < b.x + NODE_WIDTH && b.x < a.x + NODE_WIDTH && a.y < b.y + b.h && b.y < a.y + a.h))
}

describe('mise en page des mind maps', () => {
  const data: BoardData = {
    nodes: [
      note('r', 'Question centrale', { root: true }),
      note('a', 'Argument A, assez long pour tenir sur plusieurs lignes dans le nœud'),
      note('b', 'Argument B'),
      note('a1', 'Détail A1'),
      note('a2', 'Détail A2'),
      note('b1', 'Détail B1'),
      note('seul', 'Idée isolée')
    ],
    edges: [
      { id: '1', from: 'r', to: 'a' },
      { id: '2', from: 'r', to: 'b' },
      { id: '3', from: 'a', to: 'a1' },
      { id: '4', from: 'a2', to: 'a' }, // lien dans l'autre sens : suivi quand même
      { id: '5', from: 'b', to: 'b1' }
    ]
  }
  const pos = layoutMindmap(data)

  it('place chaque nœud, par colonnes de profondeur, sans chevauchement', () => {
    expect(pos.size).toBe(7)
    expect(pos.get('r')!.x).toBe(0)
    expect(pos.get('a')!.x).toBe(pos.get('b')!.x)
    expect(pos.get('a1')!.x).toBeGreaterThan(pos.get('a')!.x)
    expect(pos.get('a2')!.x).toBe(pos.get('a1')!.x)
    expect(overlaps(data, pos)).toBe(false)
  })

  it('range les nœuds isolés sous l’arbre principal', () => {
    const lowest = Math.max(...['r', 'a', 'b', 'a1', 'a2', 'b1'].map((id) => pos.get(id)!.y + nodeHeight(data.nodes.find((n) => n.id === id)!)))
    expect(pos.get('seul')!.y).toBeGreaterThan(lowest)
  })

  it('ne boucle pas sur un cycle', () => {
    const cyc: BoardData = { nodes: [note('x', 'x'), note('y', 'y')], edges: [{ id: '1', from: 'x', to: 'y' }, { id: '2', from: 'y', to: 'x' }] }
    expect(layoutMindmap(cyc).size).toBe(2)
  })
})

describe('export des boards', () => {
  const board: Board = {
    id: 'b',
    title: 'Confiance',
    mode: 'mindmap',
    createdAt: 0,
    updatedAt: 0,
    data: {
      nodes: [
        note('r', 'Pourquoi la confiance ?', { root: true, x: 0, y: 10.4 }),
        { id: 'h', kind: 'highlight', highlightId: 'h_1', itemId: 'i1', quote: 'croyaient sur parole', color: 'pink', itemTitle: 'BGP', x: 350, y: 0 },
        { id: 'e', kind: 'excerpt', itemId: 'i2', quote: 'ne comprenaient pas', itemTitle: 'Chappe', x: 350, y: 200 }
      ],
      edges: [
        { id: 'e1', from: 'r', to: 'h', label: 'soutient' },
        { id: 'e2', from: 'r', to: 'e' }
      ]
    }
  }

  it('produit un JSON Canvas qui pointe vers le bloc du surlignage', () => {
    const canvas = buildCanvas(board, (id) => (id === 'i1' ? 'Learn/BGP.md' : undefined))
    expect(canvas.nodes[0]).toMatchObject({ id: 'r', type: 'text', text: 'Pourquoi la confiance ?', y: 10, width: NODE_WIDTH })
    expect(canvas.nodes[1]).toMatchObject({ type: 'file', file: 'Learn/BGP.md', subpath: `#^${blockId('h_1')}`, color: '1' })
    expect(canvas.nodes[2]).toMatchObject({ type: 'text', text: '> ne comprenaient pas\n\n— *Chappe*' })
    expect(canvas.edges[0]).toEqual({ id: 'e1', fromNode: 'r', toNode: 'h', fromSide: 'right', toSide: 'left', label: 'soutient' })
    expect(canvas.edges[1]).not.toHaveProperty('label')
  })

  it('produit un plan Markdown', () => {
    expect(boardOutline(board)).toBe('# Confiance\n\n- Pourquoi la confiance ?\n  - (*soutient*) « croyaient sur parole » — *BGP*\n  - « ne comprenaient pas » — *Chappe*\n')
  })
})

describe('boards dans Learn', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'learn-boards-'))
  const store = await openDatabase(null)
  const core = new LearnCore(store, async () => {
    throw new Error('hors ligne')
  })
  store.updateSettings({ obsidianVault: vault, obsidianFolder: 'Learn' })
  const now = Date.now()
  store.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://r.example/feed', createdAt: now })
  store.insertItems([{ id: 'i1', sourceId: 's', guid: 'g', title: 'Le routage BGP', publishedAt: now, fetchedAt: now }])
  const h = core.addHighlight({ itemId: 'i1', color: 'green', quote: 'croyaient sur parole', prefix: '', suffix: '', start: 0, end: 20, note: '', layer: 'feed' })

  it('envoie des passages dans une mind map, reliés à la racine, sans doublon', () => {
    const board = core.createBoard('  ', 'mindmap')
    expect(board.title).toBe('Sans titre')
    core.addToBoard(board.id, { kind: 'note', text: 'Question' })
    core.addToBoard(board.id, { kind: 'highlight', highlightId: h.id, itemId: 'i1', quote: h.quote, color: 'green', itemTitle: 'Le routage BGP' })
    const b = core.addToBoard(board.id, { kind: 'highlight', highlightId: h.id, itemId: 'i1', quote: h.quote })
    expect(b.data.nodes).toHaveLength(2)
    expect(b.data.nodes[0].root).toBe(true)
    expect(b.data.edges).toEqual([expect.objectContaining({ from: b.data.nodes[0].id, to: b.data.nodes[1].id })])
    expect(b.data.nodes[1].x).toBeGreaterThan(b.data.nodes[0].x)
    expect(store.listBoards()[0]).toMatchObject({ id: board.id, nodeCount: 2 })
  })

  it('place les ajouts côte à côte en mode canvas', () => {
    const board = core.createBoard('Canvas', 'canvas')
    core.addToBoard(board.id, { kind: 'note', text: 'A' })
    const b = core.addToBoard(board.id, { kind: 'note', text: 'B' })
    expect(b.data.edges).toHaveLength(0)
    const [a, bb] = b.data.nodes
    expect(a.x !== bb.x || a.y !== bb.y).toBe(true)
  })

  it('exporte un board vers Obsidian Canvas, avec les documents liés', () => {
    const board = store.listBoards().find((x) => x.title === 'Sans titre')!
    const { path } = core.exportBoardToObsidian(board.id)
    expect(path).toBe(join(vault, 'Learn', 'Boards', 'Sans titre.canvas'))
    const canvas = JSON.parse(readFileSync(path, 'utf8'))
    const file = canvas.nodes.find((n: { type: string }) => n.type === 'file')
    expect(file).toMatchObject({ file: 'Learn/Le routage BGP.md', subpath: `#^${blockId(h.id)}` })
    expect(readFileSync(join(vault, 'Learn', 'Le routage BGP.md'), 'utf8')).toContain(`^${blockId(h.id)}`)
  })

  it('met en attente les ajouts destinés à un schéma Excalidraw, sans doublon', () => {
    const board = core.createBoard('Schéma', 'sketch')
    core.addToBoard(board.id, { kind: 'highlight', highlightId: h.id, itemId: 'i1', quote: h.quote, color: 'green' })
    const b = core.addToBoard(board.id, { kind: 'highlight', highlightId: h.id, itemId: 'i1', quote: h.quote })
    expect(b.mode).toBe('sketch')
    expect(b.data.nodes).toHaveLength(0)
    expect(b.data.pending).toHaveLength(1)
    expect(store.listBoards().find((x) => x.id === board.id)?.nodeCount).toBe(1)
  })

  it('retrouve les boards qui citent un document, y compris par un lien de schéma', () => {
    const sketch = core.createBoard('Dessin', 'sketch')
    store.updateBoard(sketch.id, {
      data: { nodes: [], edges: [], sketch: { elements: [{ id: 'r', type: 'rectangle', link: learnLink('i2', 'h9') }, { id: 'x', link: learnLink('i1'), isDeleted: true }] } }
    })
    const ids = (item: string): string[] => core.boardsForItem(item).map((b) => b.title).sort()
    expect(ids('i1')).toEqual(['Sans titre', 'Schéma'])
    expect(ids('i2')).toEqual(['Dessin'])
    // « i2 » ne doit pas correspondre à « i22 ».
    expect(ids('i22')).toEqual([])
  })

  it('ne purge jamais un document cité dans un board (vieil article lu, vidéo d’une année passée)', () => {
    const old = Date.now() - 400 * 24 * 3600_000
    store.insertSource({ id: 'yt', kind: 'youtube', title: 'Chaîne', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', createdAt: old })
    store.insertItems([
      { id: 'v1', sourceId: 'yt', guid: 'v1', title: 'Vidéo citée', publishedAt: old, fetchedAt: old },
      { id: 'v2', sourceId: 'yt', guid: 'v2', title: 'Vidéo oubliée', publishedAt: old, fetchedAt: old },
      { id: 'a1', sourceId: 's', guid: 'a1', title: 'Article cité', publishedAt: old, fetchedAt: old },
      { id: 'a2', sourceId: 's', guid: 'a2', title: 'Article oublié', publishedAt: old, fetchedAt: old }
    ])
    store.updateItem('a1', { read: true })
    store.updateItem('a2', { read: true })
    const b = core.createBoard('Cite', 'sketch')
    store.updateBoard(b.id, { data: { nodes: [], edges: [], sketch: { elements: [{ id: 'c', link: learnLink('v1') }] }, pending: [{ kind: 'source', itemId: 'a1' }] } })
    const cited = store.boardItemIds()
    store.prune(Date.now() - 30 * 24 * 3600_000, cited)
    store.pruneYoutubeBefore(Date.now() - 30 * 24 * 3600_000, cited)
    expect(store.getItem('v1')).toBeTruthy()
    expect(store.getItem('a1')).toBeTruthy()
    expect(store.getItem('v2')).toBeNull()
    expect(store.getItem('a2')).toBeNull()
  })

  it('limite une vue de catégorie à sa section de la barre latérale', () => {
    store.updateSource('s', { category: 'tech' })
    store.updateSource('yt', { category: 'tech' })
    const titles = (kinds: ('rss' | 'youtube')[], section: 'feeds' | 'youtube'): string[] =>
      store.listItems({ view: { type: 'category', category: 'tech', kinds, section } }).map((i) => i.sourceId)
    expect(new Set(titles(['rss'], 'feeds'))).toEqual(new Set(['s']))
    expect(new Set(titles(['youtube'], 'youtube'))).toEqual(new Set(['yt']))
  })

  it('supprime un board sans toucher aux surlignages', () => {
    for (const b of store.listBoards()) store.deleteBoard(b.id)
    expect(store.listBoards()).toHaveLength(0)
    expect(store.listHighlights('i1')).toHaveLength(1)
  })
})
