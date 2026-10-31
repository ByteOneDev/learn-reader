import './excalidrawSetup'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, FONT_FAMILY, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { FileDown, Highlighter, Link2, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Board, BoardData, HighlightColor, Item, NewBoardNode } from '@shared/types'
import { learnLink, parseLearnLink } from '@shared/links'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import Popover from '../Popover'
import HighlightPicker from './HighlightPicker'
import DocPicker from './DocPicker'

// Board « Schéma » : un canevas Excalidraw. Les surlignages, extraits et documents y entrent comme des
// cartes (rectangle + texte) qui portent un lien learn:// vers leur source ; le lien se suit en un clic.

type Sketch = NonNullable<BoardData['sketch']>
type Elements = readonly { id: string; version: number; isDeleted: boolean; link?: string | null; x: number; y: number; width: number; height: number }[]

const FILL: Record<HighlightColor, string> = { yellow: '#ffec99', green: '#b2f2bb', blue: '#a5d8ff', pink: '#fcc2d7', purple: '#d0bfff' }
const CARD_WIDTH = 320

/**
 * État d'affichage conservé : fond, grille, style courant. Le reste (outil actif, sélection, position de la vue…)
 * n'a pas à survivre : à l'ouverture, la vue se recentre sur le dessin.
 */
function keptAppState(a: Record<string, unknown>): Record<string, unknown> {
  const { viewBackgroundColor, gridSize, gridModeEnabled, currentItemFontFamily, currentItemStrokeColor } = a
  return { viewBackgroundColor, gridSize, gridModeEnabled, currentItemFontFamily, currentItemStrokeColor }
}

const versionOf = (els: Elements): string => `${els.length}:${els.reduce((s, e) => s + e.version, 0)}`

const CARD_FONT = 16

/** Carte Excalidraw pour un ajout venu du lecteur, avec un lien vers la source. Excalidraw replie le texte. */
export function cardSkeleton(node: NewBoardNode, x: number, y: number): ExcalidrawElementSkeleton {
  const title = node.itemTitle ?? ''
  const body = node.kind === 'source' ? title : node.kind === 'note' ? node.text ?? '' : `« ${(node.quote ?? '').trim()} »`
  const text = node.kind !== 'source' && node.kind !== 'note' && title ? `${body}\n\n— ${title}` : body
  return {
    type: 'rectangle',
    x,
    y,
    width: CARD_WIDTH,
    height: 60,
    backgroundColor: node.color ? FILL[node.color] : node.kind === 'source' ? '#e9ecef' : '#fff9db',
    fillStyle: 'solid',
    strokeWidth: 1,
    roundness: { type: 3 },
    link: node.itemId ? learnLink(node.itemId, node.highlightId) : null,
    customData: { learn: { itemId: node.itemId, highlightId: node.highlightId } },
    label: { text, fontSize: CARD_FONT, fontFamily: FONT_FAMILY.Nunito, textAlign: 'left', verticalAlign: 'middle' }
  } as ExcalidrawElementSkeleton
}

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export default function SketchView({ board }: { board: Board }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const settings = useApp((s) => s.settings)
  const boards = useApp((s) => s.boards)
  const reloadBoards = useApp((s) => s.reloadBoards)
  const setView = useApp((s) => s.setView)
  const openLink = useApp((s) => s.openLink)
  const [title, setTitle] = useState(board.title)
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const [picker, setPicker] = useState<'highlights' | 'docs' | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; bottom: number } | null>(null)
  const lastVersion = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ingesting = useRef(false)

  const dark = settings?.theme === 'dark' || (settings?.theme !== 'light' && systemDark())
  const lang = settings?.language === 'en' ? 'en' : 'fr-FR'

  const snapshot = useCallback((): BoardData | null => {
    if (!excalidraw) return null
    const elements = excalidraw.getSceneElements()
    const files = excalidraw.getFiles()
    // On ne garde que les images encore utilisées.
    const used = new Set(elements.flatMap((e) => ('fileId' in e && e.fileId ? [e.fileId] : [])))
    const sketch: Sketch = {
      elements: [...elements],
      appState: keptAppState(excalidraw.getAppState() as unknown as Record<string, unknown>),
      files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id as never)))
    }
    return { nodes: [], edges: [], sketch, pending: [] }
  }, [excalidraw])

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const data = snapshot()
    if (!data) return
    lastVersion.current = versionOf(data.sketch!.elements as Elements)
    await api.saveBoard(board.id, { data })
  }, [api, board.id, snapshot])

  // Sauvegarde différée : onChange se déclenche aussi pour un simple défilement.
  const onChange = useCallback(
    (elements: Elements) => {
      if (ingesting.current) return
      const v = versionOf(elements)
      if (v === lastVersion.current) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void flush().then(() => reloadBoards())
      }, 700)
    },
    [flush, reloadBoards]
  )
  useEffect(
    () => () => {
      // En quittant le board, on enregistre ce qui attendait encore.
      if (saveTimer.current) void flush()
    },
    [flush]
  )

  /** Place des cartes à droite du dessin (ou en haut à gauche s'il est vide) et les montre. */
  const insert = useCallback(
    async (nodes: NewBoardNode[]) => {
      if (!excalidraw || !nodes.length) return
      // Le texte est mesuré à la création : la police doit déjà être là, sinon il déborde de la carte.
      await document.fonts.load(`${CARD_FONT}px Nunito`).catch(() => undefined)
      const current = excalidraw.getSceneElements() as unknown as Elements
      const right = current.length ? Math.max(...current.map((e) => e.x + e.width)) + 80 : 0
      const top = current.length ? Math.min(...current.map((e) => e.y)) : 0
      // Converties une à une : chaque carte se place sous la précédente, une fois sa hauteur connue.
      let y = top
      const created = nodes.flatMap((n) => {
        const els = convertToExcalidrawElements([cardSkeleton(n, right, y)], { regenerateIds: true })
        y += Math.max(...els.map((e) => e.height)) + 24
        return els
      })
      excalidraw.updateScene({ elements: [...excalidraw.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
      excalidraw.scrollToContent(created, { fitToViewport: true, animate: true, viewportZoomFactor: 0.45 })
    },
    [excalidraw]
  )

  // Ajouts faits depuis le lecteur (« Board » sur un passage) : ils deviennent des cartes à l'ouverture,
  // et aussi pendant que le schéma est ouvert.
  const ingest = useCallback(async () => {
    if (!excalidraw || ingesting.current) return
    const fresh = await api.getBoard(board.id)
    const pending = fresh?.data.pending ?? []
    if (!pending.length) return
    ingesting.current = true
    try {
      await insert(pending)
      ingesting.current = false
      await flush()
      toast(t.sketchInserted(pending.length))
    } finally {
      ingesting.current = false
    }
  }, [api, board.id, excalidraw, flush, insert, toast, t])
  useEffect(() => {
    void ingest()
  }, [ingest, boards])

  useEffect(() => {
    if (excalidraw) lastVersion.current = versionOf((board.data.sketch?.elements ?? []) as Elements)
  }, [excalidraw, board.data.sketch])

  const onLinkOpen = useCallback(
    (element: { link: string | null }, event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent<HTMLCanvasElement> }>) => {
      const link = element.link
      if (!link) return
      event.preventDefault()
      const parsed = parseLearnLink(link)
      if (parsed) {
        void flush().then(() => openLink(parsed.itemId, parsed.highlightId))
      } else if (/^https?:\/\//i.test(link)) void api.openExternal(link)
    },
    [api, flush, openLink]
  )

  const exportAs = async (format: 'excalidraw' | 'png'): Promise<void> => {
    setMenu(null)
    if (!excalidraw) return
    const name = (title.trim() || t.boardUntitled).replace(/[\\/:*?"<>|]/g, '-')
    try {
      const elements = excalidraw.getSceneElements()
      const appState = excalidraw.getAppState()
      const files = excalidraw.getFiles()
      const data =
        format === 'excalidraw'
          ? serializeAsJSON(elements, appState, files, 'local')
          : new Uint8Array(await (await exportToBlob({ elements, appState: { ...appState, exportBackground: true, exportScale: 2 }, files, mimeType: 'image/png' })).arrayBuffer())
      const path = await api.saveFile(`${name}.${format}`, data)
      if (path) toast(`${t.exportedTo} ${path.split(/[\\/]/).pop()}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const initial = board.data.sketch
  return (
    <div className="board sketch-board">
      <div className="board-top drag">
        <input
          className="board-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== board.title) void api.saveBoard(board.id, { title: title.trim() }).then(() => reloadBoards())
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Titre du board"
        />
        <span className="board-kind">{t.sketch}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setPicker('highlights')} disabled={!excalidraw}>
          <Highlighter size={16} /> {t.addHighlights}
        </button>
        <button className="btn" onClick={() => setPicker('docs')} disabled={!excalidraw}>
          <Link2 size={16} /> {t.linkDocument}
        </button>
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
      <div className="board-canvas sketch-canvas">
        <Excalidraw
          excalidrawAPI={setExcalidraw}
          initialData={{
            elements: (initial?.elements ?? []) as never,
            appState: { ...(initial?.appState ?? {}), theme: dark ? 'dark' : 'light' } as never,
            files: (initial?.files ?? {}) as never,
            scrollToContent: true
          }}
          theme={dark ? 'dark' : 'light'}
          langCode={lang}
          onChange={(els) => onChange(els as unknown as Elements)}
          onLinkOpen={onLinkOpen as never}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: false } }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
        <div className="board-hint">{t.sketchHint}</div>
      </div>

      {picker === 'highlights' && (
        <HighlightPicker
          exclude={new Set()}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            setPicker(null)
            void insert(list.map((h) => ({ kind: 'highlight', highlightId: h.id, itemId: h.itemId, layer: h.layer, quote: h.quote, color: h.color, itemTitle: h.itemTitle })))
          }}
        />
      )}
      {picker === 'docs' && (
        <DocPicker
          onClose={() => setPicker(null)}
          onPick={(item: Item) => {
            setPicker(null)
            void insert([{ kind: 'source', itemId: item.id, itemTitle: item.title }])
          }}
        />
      )}

      <AnimatePresence>
        {menu && (
          <Popover key="menu" anchor={menu} placement="below" onClose={() => setMenu(null)} className="menu">
            <button onClick={() => void exportAs('png')}>
              <FileDown size={15} /> {t.exportPng}
            </button>
            <button onClick={() => void exportAs('excalidraw')}>
              <FileDown size={15} /> {t.exportExcalidraw}
            </button>
            <div className="sep" />
            <button
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                setMenu(null)
                if (!window.confirm(t.confirmDeleteBoard)) return
                if (saveTimer.current) clearTimeout(saveTimer.current)
                saveTimer.current = null
                await api.deleteBoard(board.id)
                await reloadBoards()
                setView({ type: 'home' })
              }}
            >
              <Trash2 size={15} /> {t.deleteBoard}
            </button>
          </Popover>
        )}
      </AnimatePresence>
    </div>
  )
}
