import { createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { ExternalLink } from 'lucide-react'
import type { BoardNode } from '@shared/types'
import { NODE_WIDTH } from '@shared/boardLayout'
import { useT } from '../../lib/i18n'

export interface BoardActions {
  updateNode(id: string, patch: Partial<BoardNode>): void
  openSource(node: BoardNode): void
}

export const BoardActionsContext = createContext<BoardActions>({ updateNode: () => {}, openSource: () => {} })

export type FlowNodeData = { node: BoardNode; lost?: boolean }
export type FlowNode = Node<FlowNodeData>

function Handles(): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </>
  )
}

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useT()
  const { updateNode } = useContext(BoardActionsContext)
  const [editing, setEditing] = useState(!data.node.text)
  const [text, setText] = useState(data.node.text ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) setTimeout(() => ref.current?.focus(), 30)
  }, [editing])
  useEffect(() => setText(data.node.text ?? ''), [data.node.text])
  const commit = (): void => {
    setEditing(false)
    if (text !== data.node.text) updateNode(id, { text })
  }
  return (
    <div className={`bnode bnode-note${selected ? ' selected' : ''}${data.node.root ? ' root' : ''}`} style={{ width: NODE_WIDTH }} onDoubleClick={() => setEditing(true)}>
      <Handles />
      {editing ? (
        <textarea
          ref={ref}
          className="nodrag nowheel"
          value={text}
          placeholder={t.newIdea}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            if (e.key === 'Escape') commit()
            e.stopPropagation()
          }}
        />
      ) : (
        <div className="bnode-text">{data.node.text || <span className="hint">{t.newIdea}</span>}</div>
      )}
    </div>
  )
})

export const QuoteNode = memo(function QuoteNode({ data, selected }: NodeProps<FlowNode>) {
  const t = useT()
  const { openSource } = useContext(BoardActionsContext)
  const n = data.node
  return (
    <div
      className={`bnode bnode-quote${selected ? ' selected' : ''}${n.kind === 'excerpt' ? ' excerpt' : ''}${n.root ? ' root' : ''}`}
      style={{ width: NODE_WIDTH, ['--c' as string]: n.color ? `var(--dot-${n.color})` : 'var(--text-3)' }}
    >
      <Handles />
      {n.kind === 'source' ? <div className="bnode-source-title">{n.itemTitle}</div> : <div className="bnode-quote-text">{n.quote}</div>}
      <div className="bnode-foot">
        <span className="bnode-item">{data.lost ? t.lostSource : n.kind === 'source' ? '' : n.itemTitle}</span>
        {n.itemId && !data.lost && (
          <button className="nodrag" onClick={() => openSource(n)} title={t.openSource} aria-label={t.openSource}>
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    </div>
  )
})

export const nodeTypes = { note: NoteNode, quote: QuoteNode }
