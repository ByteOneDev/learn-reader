import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { List, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Highlight, TocEntry } from '@shared/types'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { applyHighlights } from '../../lib/highlightDom'
import TocPanel from './TocPanel'
import { parsePosition, typing, usePositionSaver, type BookViewProps } from './common'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const asset = (dir: string): string => new URL(`pdfjs/${dir}/`, document.baseURI).href

interface PageProps {
  doc: PDFDocumentProxy
  index: number
  scale: number
  size: { width: number; height: number }
  highlights: Highlight[]
  root: HTMLElement | null
  onOrphans(page: number, ids: string[]): void
  onReady(page: number): void
  onMouseUp(): void
  onClick(e: React.MouseEvent): void
}

/** Une page : rendue quand elle approche de l'écran, avec sa couche texte (sélectionnable et surlignable). */
const PdfPage = memo(function PdfPage({ doc, index, scale, size, highlights, root, onOrphans, onReady, onMouseUp, onClick }: PageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [textReady, setTextReady] = useState(0)
  const content = useRef<{ text: Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>; viewport: pdfjs.PageViewport } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !root) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { root, rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let task: RenderTask | null = null
    let cancelled = false
    void (async () => {
      const page = await doc.getPage(index + 1)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current!
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      task = page.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      // Un rendu annulé (zoom, démontage) rejette sa promesse : c'est attendu.
      task.promise.catch(() => undefined)
      const text = await page.getTextContent()
      if (cancelled) return
      content.current = { text, viewport }
      setTextReady((n) => n + 1)
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, index, scale, visible])

  // Couche texte reconstruite à chaque changement de surlignages : les <mark> sont posés dessus.
  useEffect(() => {
    const div = textRef.current
    const c = content.current
    if (!div || !c || !textReady) return
    let cancelled = false
    div.replaceChildren()
    const layer = new pdfjs.TextLayer({ textContentSource: c.text, container: div, viewport: c.viewport })
    layer
      .render()
      .then(() => {
        if (cancelled) return
        const orphans = applyHighlights(div, highlights)
        onOrphans(index, [...orphans])
        onReady(index)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      layer.cancel()
    }
  }, [textReady, highlights, index, onOrphans, onReady])

  return (
    <div
      ref={ref}
      className="pdf-page"
      data-page={index}
      style={{ width: size.width * scale, height: size.height * scale, ['--total-scale-factor' as string]: scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div ref={textRef} className="textLayer" data-layer={`p:${index}`} onMouseUp={onMouseUp} onClick={onClick} />
      <span className="pdf-page-num">{index + 1}</span>
    </div>
  )
})

export default function PdfView({ item, highlights, scrollRef, navRef, onOrphans, onMouseUp, onClick }: BookViewProps): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const start = useMemo(() => parsePosition(item.position), [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([])
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(start.page ?? 0)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const orphanMap = useRef(new Map<number, string[]>())
  const readyWaiters = useRef(new Map<number, () => void>())
  const restored = useRef(false)
  const save = usePositionSaver(item.id)

  useEffect(() => setRoot(scrollRef.current), [scrollRef])

  // Ouverture du document, tailles des pages, plan (table des matières), couverture et titre.
  useEffect(() => {
    let alive = true
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    void (async () => {
      try {
        const data = await api.readBookFile(item.id)
        if (!alive) return
        task = pdfjs.getDocument({
          data,
          cMapUrl: asset('cmaps'),
          cMapPacked: true,
          standardFontDataUrl: asset('standard_fonts'),
          wasmUrl: asset('wasm'),
          enableXfa: false
        })
        const loaded = await task.promise
        if (!alive) return
        const dims: { width: number; height: number }[] = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 })
          dims.push({ width: vp.width, height: vp.height })
        }
        if (!alive) return
        setSizes(dims)
        setDoc(loaded)
        void outline(loaded).then((o) => alive && setToc(o))
        void enrichMetadata(loaded)
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    })()
    return () => {
      alive = false
      void task?.destroy()
    }
  }, [api, item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const enrichMetadata = async (d: PDFDocumentProxy): Promise<void> => {
    const patch: { title?: string; author?: string; imageUrl?: string } = {}
    try {
      const meta = await d.getMetadata()
      const info = meta.info as { Title?: string; Author?: string }
      if (info.Title?.trim() && info.Title.trim().length > 3 && !/^untitled|^microsoft word/i.test(info.Title)) patch.title = info.Title.trim()
      if (info.Author?.trim() && !item.author) patch.author = info.Author.trim()
    } catch {
      /* pas de métadonnées */
    }
    if (!item.imageUrl) {
      const p1 = await d.getPage(1)
      const vp = p1.getViewport({ scale: 360 / p1.getViewport({ scale: 1 }).width })
      const canvas = document.createElement('canvas')
      canvas.width = vp.width
      canvas.height = vp.height
      await p1.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport: vp }).promise
      patch.imageUrl = canvas.toDataURL('image/jpeg', 0.82)
    }
    if (patch.title && patch.title === item.title) delete patch.title
    if (Object.keys(patch).length) {
      const updated = await api.updateBook(item.id, patch)
      useApp.setState((s) => ({
        items: s.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
        item: s.item?.id === item.id ? { ...s.item, title: updated.title, author: updated.author, imageUrl: updated.imageUrl } : s.item
      }))
    }
  }

  const outline = async (d: PDFDocumentProxy): Promise<TocEntry[]> => {
    const out: TocEntry[] = []
    const walk = async (nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null, depth: number): Promise<void> => {
      for (const n of nodes ?? []) {
        try {
          const dest = typeof n.dest === 'string' ? await d.getDestination(n.dest) : n.dest
          const ref = dest?.[0]
          const index = ref && typeof ref === 'object' ? await d.getPageIndex(ref) : typeof ref === 'number' ? ref : -1
          if (index >= 0) out.push({ title: n.title, chapter: index, depth })
        } catch {
          /* destination invalide */
        }
        await walk(n.items, depth + 1)
      }
    }
    await walk(await d.getOutline(), 0)
    return out
  }

  // Largeur disponible → échelle « ajustée à la largeur », multipliée par le zoom.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const ro = new ResizeObserver(() => setWidth(sc.clientWidth))
    ro.observe(sc)
    return () => ro.disconnect()
  }, [scrollRef])
  const baseWidth = sizes[0]?.width ?? 612
  const scale = Math.max(0.3, Math.min(5, ((Math.min(width, 1100) - 64) / baseWidth) * zoom))

  const pageEl = (i: number): HTMLElement | null => scrollRef.current?.querySelector(`.pdf-page[data-page="${i}"]`) ?? null

  // Restaure la page de lecture une fois la mise en page connue.
  useEffect(() => {
    if (!doc || restored.current) return
    restored.current = true
    requestAnimationFrame(() => pageEl(start.page ?? 0)?.scrollIntoView())
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || !doc) return
    const onScroll = (): void => {
      const mid = sc.scrollTop + sc.clientHeight * 0.35
      let current = 0
      for (const el of Array.from(sc.querySelectorAll<HTMLElement>('.pdf-page'))) {
        if (el.offsetTop <= mid) current = Number(el.dataset.page)
        else break
      }
      setPage(current)
      save({ page: current }, (current + 1) / doc.numPages)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [doc, scrollRef]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPageOrphans = useMemo(
    () => (p: number, ids: string[]) => {
      orphanMap.current.set(p, ids)
      onOrphans(new Set([...orphanMap.current.values()].flat()))
    },
    [onOrphans]
  )
  const onReady = useMemo(
    () => (p: number) => {
      readyWaiters.current.get(p)?.()
      readyWaiters.current.delete(p)
    },
    []
  )

  const goToPage = (i: number): Promise<void> => {
    const el = pageEl(i)
    if (!el) return Promise.resolve()
    el.scrollIntoView()
    return new Promise((resolve) => {
      readyWaiters.current.set(i, resolve)
      setTimeout(resolve, 2500)
    })
  }

  navRef.current = {
    current: () => `p:${page}`,
    goTo: (l) => (l.startsWith('p:') ? goToPage(Number(l.slice(2))) : Promise.resolve())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e) || e.altKey) return
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) setZoom((z) => Math.min(4, z * 1.2))
      else if ((e.metaKey || e.ctrlKey) && e.key === '-') setZoom((z) => Math.max(0.4, z / 1.2))
      else if (e.metaKey || e.ctrlKey) return
      else if (e.key === 'ArrowRight') void goToPage(page + 1)
      else if (e.key === 'ArrowLeft') void goToPage(page - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const byPage = useMemo(() => {
    const m = new Map<number, Highlight[]>()
    for (const h of highlights) {
      if (!h.layer.startsWith('p:')) continue
      const p = Number(h.layer.slice(2))
      m.set(p, [...(m.get(p) ?? []), h])
    }
    return m
  }, [highlights])

  const total = doc?.numPages ?? 0
  const readerEl = scrollRef.current?.parentElement

  return (
    <div className="book">
      <div className="book-bar">
        <button className="tb-btn" onClick={() => setTocOpen(!tocOpen)} aria-pressed={tocOpen} title={t.toc}>
          <List size={16} /> {t.toc}
        </button>
        <span className="book-bar-title">{item.title}</span>
        <span className="book-bar-meta">{total ? `${t.page} ${page + 1} ${t.of} ${total}` : t.loadingBook}</span>
        <button className="tb-btn" onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))} title={t.zoomOut} aria-label={t.zoomOut}>
          <ZoomOut size={16} />
        </button>
        <button className="tb-btn" onClick={() => setZoom(1)} title={t.fitWidth} aria-label={t.fitWidth}>
          <Maximize2 size={15} />
        </button>
        <button className="tb-btn" onClick={() => setZoom((z) => Math.min(4, z * 1.2))} title={t.zoomIn} aria-label={t.zoomIn}>
          <ZoomIn size={16} />
        </button>
        <div className="book-progress" aria-hidden>
          <div style={{ width: `${total ? ((page + 1) / total) * 100 : 0}%` }} />
        </div>
      </div>

      {!doc && <div className="book-loading">{t.loadingBook}</div>}
      <div className="pdf-pages">
        {doc &&
          sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={doc}
              index={i}
              scale={scale}
              size={size}
              highlights={byPage.get(i) ?? EMPTY}
              root={root}
              onOrphans={onPageOrphans}
              onReady={onReady}
              onMouseUp={onMouseUp}
              onClick={onClick}
            />
          ))}
      </div>

      {readerEl &&
        createPortal(
          <AnimatePresence>
            {tocOpen && (
              <TocPanel
                toc={toc}
                current={page}
                onClose={() => setTocOpen(false)}
                onPick={(e) => {
                  setTocOpen(false)
                  void goToPage(e.chapter)
                }}
              />
            )}
          </AnimatePresence>,
          readerEl
        )}
    </div>
  )
}

const EMPTY: Highlight[] = []
