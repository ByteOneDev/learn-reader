import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnectEnd
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileDown, Highlighter, LayoutGrid, MoreHorizontal, Copy, Plus, Trash2, Wand2 } from 'lucide-react'
import type { Board, BoardData, BoardMode, BoardNode, HighlightWithItem } from '@shared/types'
import { layoutMindmap, NODE_WIDTH } from '@shared/boardLayout'
import { uid } from '@shared/util'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import Popover from '../Popover'
import HighlightPicker from './HighlightPicker'
import { BoardActionsContext, nodeTypes, type FlowNode } from './BoardNodes'

const EDGE_STYLE = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }

function toFlow(data: BoardData, lost: Set<string>): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: n.kind === 'note' ? 'note' : 'quote',
      position: { x: n.x, y: n.y },
      data: { node: n, lost: !!n.highlightId && lost.has(n.highlightId) }
    })),
    edges: data.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label, ...EDGE_STYLE }))
  }
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): BoardData {
  return {
    nodes: nodes.map((n) => ({ ...n.data.node, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(e.label ? { label: String(e.label) } : {}) }))
  }
}

function Canvas({ board }: { board: Board }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  const settings = useApp((s) => s.settings)
  const reloadBoards = useApp((s) => s.reloadBoards)
  const setView = useApp((s) => s.setView)
  const openHighlight = useApp((s) => s.openHighlight)
  const select = useApp((s) => s.select)
  const flow = useReactFlow<FlowNode, Edge>()

  const [title, setTitle] = useState(board.title)
  const [mode, setMode] = useState<BoardMode>(board.mode)
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [ready, setReady] = useState(false)
  const [picker, setPicker] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; bottom: number } | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [animating, setAnimating] = useState(false)
  const lastSaved = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Chargement : on rafraîchit les citations depuis les surlignages actuels, et on repère ceux qui ont disparu.
  useEffect(() => {
    let alive = true
    void api.allHighlights().then((all) => {
      if (!alive) return
      const live = new Map(all.map((h) => [h.id, h]))
      const lost = new Set<string>()
      const data = structuredClone(board.data)
      for (const n of data.nodes) {
        if (!n.highlightId) continue
        const h = live.get(n.highlightId)
        if (h) Object.assign(n, { quote: h.quote, color: h.color, itemTitle: h.itemTitle })
        else lost.add(n.highlightId)
      }
      const f = toFlow(data, lost)
      lastSaved.current = JSON.stringify(board.data)
      setNodes(f.nodes)
      setEdges(f.edges)
      setReady(true)
      requestAnimationFrame(() => flow.fitView({ padding: 0.2, maxZoom: 1.1 }))
    })
    return () => {
      alive = false
    }
  }, [board.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sauvegarde automatique, regroupée.
  const save = useCallback(
    (patch: Partial<Pick<Board, 'title' | 'mode' | 'data'>>) => {
      void api.saveBoard(board.id, patch).then(() => reloadBoards())
    },
    [api, board.id, reloadBoards]
  )
  useEffect(() => {
    if (!ready) return
    const data = fromFlow(nodes, edges)
    const json = JSON.stringify(data)
    if (json === lastSaved.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      lastSaved.current = json
      save({ data })
    }, 500)
  }, [nodes, edges, ready, save])
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const flush = async (): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const data = fromFlow(flow.getNodes(), flow.getEdges())
    lastSaved.current = JSON.stringify(data)
    await api.saveBoard(board.id, { data, title, mode })
  }

  const relayout = useCallback(
    (ns: FlowNode[] = flow.getNodes(), es: Edge[] = flow.getEdges()) => {
      const pos = layoutMindmap(fromFlow(ns, es))
      setAnimating(true)
      setNodes(ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })))
      setTimeout(() => {
        setAnimating(false)
        flow.fitView({ padding: 0.2, maxZoom: 1.1, duration: 400 })
      }, 380)
    },
    [flow, setNodes]
  )

  /** Ajoute des nœuds : en mind map, enfants du nœud sélectionné (ou de la racine) puis rangement. */
  const addNodes = (items: Omit<BoardNode, 'id' | 'x' | 'y'>[]): void => {
    const current = flow.getNodes()
    const selected = current.find((n) => n.selected)
    const root = current.find((n) => n.data.node.root) ?? current[0]
    const parent = selected ?? root
    const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const created: FlowNode[] = items.map((it, i) => {
      const id = uid('n_')
      const node: BoardNode = { ...it, id, x: center.x - NODE_WIDTH / 2 + i * 30, y: center.y + i * 30, root: !current.length && i === 0 }
      return { id, type: node.kind === 'note' ? 'note' : 'quote', position: { x: node.x, y: node.y }, data: { node }, selected: false }
    })
    const newEdges: Edge[] =
      mode === 'mindmap'
        ? created.flatMap((n, i) => {
            const from = parent?.id ?? (i > 0 ? created[0].id : undefined)
            return from && from !== n.id ? [{ id: uid('e_'), source: from, target: n.id, ...EDGE_STYLE }] : []
          })
        : []
    const ns = [...current.map((n) => ({ ...n, selected: false })), ...created]
    const es = [...flow.getEdges(), ...newEdges]
    setNodes(ns)
    setEdges(es)
    if (mode === 'mindmap') setTimeout(() => relayout(ns, es), 30)
  }

  const fromHighlight = (h: HighlightWithItem): Omit<BoardNode, 'id' | 'x' | 'y'> => ({
    kind: 'highlight',
    highlightId: h.id,
    itemId: h.itemId,
    layer: h.layer,
    quote: h.quote,
    color: h.color,
    itemTitle: h.itemTitle
  })

  const actions = useMemo(
    () => ({
      updateNode: (id: string, patch: Partial<BoardNode>) =>
        setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n))),
      openSource: (n: BoardNode) => {
        if (!n.itemId) return
        if (n.highlightId) void openHighlight(n.itemId, n.highlightId, n.layer ?? 'feed')
        else {
          setView({ type: 'highlights' })
          void select(n.itemId)
        }
      }
    }),
    [setNodes, openHighlight, setView, select]
  )

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, id: uid('e_'), ...EDGE_STYLE }, es)), [setEdges])

  /** Lien tiré depuis un point et relâché dans le vide : nouvelle note à cet endroit, déjà reliée. */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || state.toNode || !state.fromNode) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const fromTarget = state.fromHandle?.type === 'target'
      const from = state.fromNode.id
      // Relâché sur le corps d'une autre carte : on relie simplement les deux.
      const onto = (document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node') as HTMLElement | null)?.dataset.id
      if (onto && onto !== from) {
        setEdges((es) => addEdge({ id: uid('e_'), source: fromTarget ? onto : from, target: fromTarget ? from : onto, ...EDGE_STYLE }, es))
        return
      }
      const pos = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY })
      const id = uid('n_')
      const node: BoardNode = { id, kind: 'note', text: '', x: Math.round(fromTarget ? pos.x - NODE_WIDTH : pos.x), y: Math.round(pos.y - 26) }
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'note', position: { x: node.x, y: node.y }, data: { node }, selected: true }])
      setEdges((es) => [...es, { id: uid('e_'), source: fromTarget ? id : from, target: fromTarget ? from : id, ...EDGE_STYLE }])
    },
    [flow, setNodes, setEdges]
  )

  const switchMode = (m: BoardMode): void => {
    setMode(m)
    save({ mode: m })
    if (m === 'mindmap') relayout()
  }

  const colorMode = theme === 'system' ? 'system' : theme
  const exclude = new Set(nodes.map((n) => n.data.node.highlightId).filter((x): x is string => !!x))

  return (
    <BoardActionsContext.Provider value={actions}>
      <div className={`board${animating ? ' animating' : ''}`}>
        <div className="board-top drag">
          <input
            className="board-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== board.title && save({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Titre du board"
          />
          <div className="segmented">
            <button className={mode === 'mindmap' ? 'on' : ''} onClick={() => switchMode('mindmap')}>
              {t.mindmap}
            </button>
            <button className={mode === 'canvas' ? 'on' : ''} onClick={() => switchMode('canvas')}>
              {t.canvas}
            </button>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={() => addNodes([{ kind: 'note', text: '' }])}>
            <Plus size={16} /> {t.addNote}
          </button>
          <button className="btn" onClick={() => setPicker(true)}>
            <Highlighter size={16} /> {t.addHighlights}
          </button>
          {mode === 'mindmap' ? (
            <button className="btn" onClick={() => relayout()} title={t.autoLayout}>
              <Wand2 size={16} /> {t.autoLayout}
            </button>
          ) : (
            <button className="btn" onClick={() => relayout()} title={t.autoLayout}>
              <LayoutGrid size={16} /> {t.autoLayout}
            </button>
          )}
          <button
            className="round-btn"
            aria-label="Menu"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ x: r.left - 80, y: r.top, bottom: r.bottom })
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="board-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onEdgeClick={(e, edge) => setEdgeMenu({ id: edge.id, x: e.clientX, y: e.clientY })}
            colorMode={colorMode}
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={EDGE_STYLE}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {ready && nodes.length === 0 && <div className="board-empty">{t.boardEmpty}</div>}
          <div className="board-hint">{t.boardHint}</div>
        </div>
      </div>

      {picker && (
        <HighlightPicker
          exclude={exclude}
          onClose={() => setPicker(false)}
          onPick={(list) => {
            setPicker(false)
            addNodes(list.map(fromHighlight))
          }}
        />
      )}

      <AnimatePresence>
        {menu && (
          <Popover key="menu" anchor={menu} placement="below" onClose={() => setMenu(null)} className="menu">
            <button
              onClick={async () => {
                setMenu(null)
                try {
                  if (!settings?.obsidianVault) {
                    const f = await api.chooseFolder()
                    if (!f) return
                    await useApp.getState().updateSettings({ obsidianVault: f })
                  }
                  await flush()
                  const r = await api.exportBoardToObsidian(board.id)
                  toast(`${t.boardExported} · ${r.path.split(/[\\/]/).slice(-2).join('/')}`)
                } catch (e) {
                  toast((e as Error).message, 'error')
                }
              }}
            >
              <FileDown size={15} /> {t.exportCanvas}
            </button>
            <button
              onClick={async () => {
                setMenu(null)
                await flush()
                await navigator.clipboard.writeText(await api.boardMarkdown(board.id))
                toast(t.copied)
              }}
            >
              <Copy size={15} /> {t.copyOutline}
            </button>
            <div className="sep" />
            <button
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                setMenu(null)
                if (!window.confirm(t.confirmDeleteBoard)) return
                await api.deleteBoard(board.id)
                await reloadBoards()
                setView({ type: 'home' })
              }}
            >
              <Trash2 size={15} /> {t.deleteBoard}
            </button>
          </Popover>
        )}
        {edgeMenu && (
          <Popover key="edge" anchor={{ x: edgeMenu.x, y: edgeMenu.y, bottom: edgeMenu.y }} placement="below" onClose={() => setEdgeMenu(null)} className="menu">
            <div className="hint" style={{ padding: '4px 10px 6px' }}>
              {t.linkLabel}
            </div>
            {[...t.edgeLabels, ''].map((label) => (
              <button
                key={label || 'none'}
                onClick={() => {
                  setEdges((es) => es.map((e) => (e.id === edgeMenu.id ? { ...e, label: label || undefined } : e)))
                  setEdgeMenu(null)
                }}
              >
                {label || t.noLabel}
              </button>
            ))}
            <div className="sep" />
            <button
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setEdges((es) => es.filter((e) => e.id !== edgeMenu.id))
                setEdgeMenu(null)
              }}
            >
              <Trash2 size={15} /> {t.delete}
            </button>
          </Popover>
        )}
      </AnimatePresence>
    </BoardActionsContext.Provider>
  )
}

export default function BoardView({ boardId }: { boardId: string }): React.JSX.Element {
  const api = useApp((s) => s.api)
  const [board, setBoard] = useState<Board | null>(null)
  useEffect(() => {
    let alive = true
    setBoard(null)
    void api.getBoard(boardId).then((b) => alive && setBoard(b))
    return () => {
      alive = false
    }
  }, [api, boardId])
  if (!board) return <main className="board" />
  return (
    <ReactFlowProvider key={board.id}>
      <Canvas board={board} />
    </ReactFlowProvider>
  )
}
