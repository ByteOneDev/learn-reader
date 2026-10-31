import { useEffect, useRef, useState } from 'react'
import { Copy, MessageSquarePlus, Network, Trash2 } from 'lucide-react'
import type { Highlight, HighlightColor } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import Popover from './Popover'
import BoardPicker from './boards/BoardPicker'
import type { NewBoardNode } from '@shared/types'

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

export interface PendingSelection {
  layer: string
  start: number
  end: number
  quote: string
  prefix: string
  suffix: string
  anchor: { x: number; y: number; bottom: number }
}

type Props =
  | { selection: PendingSelection; onCreate(color: HighlightColor, withNote: boolean): void; onClose(): void; highlight?: undefined; anchor?: undefined; startEditing?: undefined }
  | { highlight: Highlight; anchor: { x: number; y: number; bottom: number }; startEditing?: boolean; onClose(): void; selection?: undefined; onCreate?: undefined }

/** Barre flottante : couleurs, note, copie ; pour une nouvelle sélection ou un surlignage existant. */
export function HighlightMenu(props: Props): React.JSX.Element {
  const t = useT()
  const updateHighlight = useApp((s) => s.updateHighlight)
  const removeHighlight = useApp((s) => s.removeHighlight)
  const toast = useApp((s) => s.toast)
  const existing = props.highlight
  const [editing, setEditing] = useState(!!props.startEditing)
  const [note, setNote] = useState(existing?.note ?? '')
  const [boardMenu, setBoardMenu] = useState(false)
  const item = useApp((s) => s.item)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const anchor = existing ? props.anchor! : props.selection!.anchor

  useEffect(() => {
    if (editing) setTimeout(() => taRef.current?.focus(), 30)
  }, [editing])

  const saveNote = (): void => {
    if (existing && note !== existing.note) void updateHighlight(existing.id, { note })
  }

  const close = (): void => {
    saveNote()
    props.onClose()
  }

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(existing ? existing.quote : props.selection!.quote)
    toast(t.copied)
    props.onClose()
  }

  // Nœud de board : le surlignage lui-même, ou un simple extrait (passage non surligné).
  const boardNode: NewBoardNode = existing
    ? { kind: 'highlight', highlightId: existing.id, itemId: existing.itemId, layer: existing.layer, quote: existing.quote, color: existing.color, itemTitle: item?.title }
    : { kind: 'excerpt', itemId: item?.id, layer: props.selection!.layer, start: props.selection!.start, quote: props.selection!.quote, itemTitle: item?.title }

  if (boardMenu) {
    return (
      <Popover anchor={anchor} onClose={props.onClose}>
        <BoardPicker node={boardNode} onDone={props.onClose} />
      </Popover>
    )
  }

  if (editing || (existing && existing.note)) {
    return (
      <Popover anchor={anchor} placement="below" onClose={close}>
        <div className="note-editor">
          <div className="hl-toolbar" style={{ marginBottom: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-dot${existing?.color === c ? ' on' : ''}`}
                onClick={() => existing && void updateHighlight(existing.id, { color: c })}
                aria-label={c}
              >
                <span style={{ background: `var(--dot-${c})` }} />
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="tb-btn" onClick={() => setBoardMenu(true)} title={t.sendToBoard} aria-label={t.sendToBoard}>
              <Network size={15} />
            </button>
            <button className="tb-btn" onClick={() => void copy()} title={t.copy}>
              <Copy size={15} />
            </button>
            <button
              className="tb-btn danger"
              onClick={() => {
                if (existing) void removeHighlight(existing.id)
                props.onClose()
              }}
              title={t.delete}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <textarea
            ref={taRef}
            value={note}
            placeholder={t.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close()
            }}
          />
          <div className="row">
            <span className="hint">Markdown · ⌘/Ctrl + Entrée</span>
            <button className="btn primary" style={{ height: 30 }} onClick={close}>
              OK
            </button>
          </div>
        </div>
      </Popover>
    )
  }

  return (
    <Popover anchor={anchor} onClose={props.onClose}>
      <div className="hl-toolbar">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`color-dot${existing?.color === c ? ' on' : ''}`}
            onClick={() => {
              if (existing) {
                void updateHighlight(existing.id, { color: c })
                props.onClose()
              } else props.onCreate!(c, false)
            }}
            aria-label={c}
            title={c}
          >
            <span style={{ background: `var(--dot-${c})` }} />
          </button>
        ))}
        <span className="tb-sep" />
        <button
          className="tb-btn"
          onClick={() => {
            if (existing) setEditing(true)
            else props.onCreate!('yellow', true)
          }}
        >
          <MessageSquarePlus size={15} /> {t.note}
        </button>
        <button className="tb-btn" onClick={() => setBoardMenu(true)} title={t.sendToBoard} aria-label={t.sendToBoard}>
          <Network size={15} /> {t.sendToBoard}
        </button>
        <button className="tb-btn" onClick={() => void copy()} title={t.copy} aria-label={t.copy}>
          <Copy size={15} />
        </button>
        {existing && (
          <button
            className="tb-btn danger"
            onClick={() => {
              void removeHighlight(existing.id)
              props.onClose()
            }}
            title={t.delete}
            aria-label={t.delete}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </Popover>
  )
}
