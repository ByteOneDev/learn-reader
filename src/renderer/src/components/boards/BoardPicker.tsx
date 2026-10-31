import { LayoutGrid, Network, PenTool, Plus } from 'lucide-react'
import type { NewBoardNode } from '@shared/types'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'

/** Menu « Envoyer au board » : liste des boards, ou création d'un nouveau. */
export default function BoardPicker({ node, onDone }: { node: NewBoardNode; onDone(): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const boards = useApp((s) => s.boards)
  const toast = useApp((s) => s.toast)
  const reloadBoards = useApp((s) => s.reloadBoards)
  const send = async (boardId: string, title: string): Promise<void> => {
    onDone()
    try {
      await api.addToBoard(boardId, node)
      await reloadBoards()
      toast(t.addedToBoard(title))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="menu">
      {boards.map((b) => (
        <button key={b.id} onClick={() => void send(b.id, b.title)}>
          {b.mode === 'sketch' ? <PenTool size={15} /> : b.mode === 'canvas' ? <LayoutGrid size={15} /> : <Network size={15} />} {b.title}
        </button>
      ))}
      {boards.length > 0 && <div className="sep" />}
      <button
        onClick={async () => {
          const b = await api.createBoard(node.itemTitle ?? t.boardUntitled, 'mindmap')
          await send(b.id, b.title)
        }}
      >
        <Plus size={15} /> {t.newBoard}
      </button>
    </div>
  )
}
