import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpenText,
  Bookmark,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileDown,
  Heart,
  Highlighter,
  Layers,
  Link as LinkIcon,
  Maximize2,
  Minimize2,
  Share,
  Tag
} from 'lucide-react'
import { contextOf } from '@shared/anchor'
import type { Highlight, HighlightColor } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { fullDate } from '../lib/time'
import { sanitize } from '../lib/sanitize'
import { plainText, selectionOffsets } from '../lib/highlightDom'
import SourceIcon from './SourceIcon'
import Popover from './Popover'
import TagEditor from './TagEditor'
import HighlightsPanel from './HighlightsPanel'
import { HighlightMenu, type PendingSelection } from './HighlightMenu'
import ArticleContent from './ArticleContent'
import EpubView from './books/EpubView'
import PdfView from './books/PdfView'
import type { BookNav } from './books/common'
import type { Dict } from '../lib/i18n'

export function layerLabel(layer: string, t: Dict): string {
  const [kind, n] = layer.split(':')
  if (kind === 'p') return `${t.page} ${Number(n) + 1}`
  if (kind === 'ch') return `${t.chapter} ${Number(n) + 1}`
  return layer === 'full' ? t.fullText : t.feedText
}

export const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

type Anchor = { x: number; y: number; bottom: number }

export default function Reader(): React.JSX.Element {
  const t = useT()
  const item = useApp((s) => s.item)
  const sources = useApp((s) => s.sources)
  const highlights = useApp((s) => s.highlights)
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const extracting = useApp((s) => s.extracting)
  const patchItem = useApp((s) => s.patchItem)
  const addHighlight = useApp((s) => s.addHighlight)
  const select = useApp((s) => s.select)
  const panelOpen = useApp((s) => s.panelOpen)
  const togglePanel = useApp((s) => s.togglePanel)
  const focusMode = useApp((s) => s.focusMode)
  const toggleFocus = useApp((s) => s.toggleFocus)
  const settings = useApp((s) => s.settings)
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const lang = settings?.language ?? 'fr'

  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<BookNav | null>(null)
  const [orphans, setOrphans] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [active, setActive] = useState<{ id: string; anchor: Anchor; edit?: boolean } | null>(null)
  const [tagAnchor, setTagAnchor] = useState<Anchor | null>(null)
  const [shareAnchor, setShareAnchor] = useState<Anchor | null>(null)
  const [heroOk, setHeroOk] = useState(true)

  const source = sources.find((s) => s.id === item?.sourceId)
  const layer = mode === 'full' && item?.fullHtml ? 'full' : 'feed'
  const rawHtml = layer === 'full' ? item?.fullHtml : item?.contentHtml
  const html = useMemo(() => sanitize(rawHtml ?? (item?.summary ? `<p>${item.summary}</p>` : '')), [rawHtml, item?.summary])
  const layerHighlights = useMemo(() => highlights.filter((h) => h.layer === layer), [highlights, layer])
  const showHero = !!item?.imageUrl && heroOk && !html.includes(item.imageUrl.split('?')[0])

  useEffect(() => {
    setPending(null)
    setActive(null)
    setHeroOk(true)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [item?.id])

  // La sélection appartient à une « couche » : le contenu de l'article, un chapitre ou une page de PDF.
  const onMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed || !item) return
    const range = sel.getRangeAt(0)
    const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const root = startEl?.closest('[data-layer]') as HTMLElement | null
    if (!root || !root.contains(range.endContainer)) return
    const off = selectionOffsets(root, sel)
    if (!off) return
    const rect = range.getBoundingClientRect()
    const text = plainText(root)
    setActive(null)
    setPending({
      layer: root.dataset.layer!,
      start: off.start,
      end: off.end,
      quote: off.text,
      ...contextOf(text, off.start, off.end),
      anchor: { x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom }
    })
  }, [item])

  const onClickContent = (e: React.MouseEvent): void => {
    const mark = (e.target as HTMLElement).closest('mark.hl') as HTMLElement | null
    if (!mark || !window.getSelection()?.isCollapsed) return
    const r = mark.getBoundingClientRect()
    setPending(null)
    setActive({ id: mark.dataset.hl!, anchor: { x: r.left + r.width / 2, y: r.top, bottom: r.bottom } })
  }

  const createHighlight = async (color: HighlightColor, withNote = false): Promise<Highlight | null> => {
    if (!pending || !item) return null
    const h = await addHighlight({
      itemId: item.id,
      color,
      quote: pending.quote,
      prefix: pending.prefix,
      suffix: pending.suffix,
      start: pending.start,
      end: pending.end,
      note: '',
      layer: pending.layer
    })
    window.getSelection()?.removeAllRanges()
    const anchor = pending.anchor
    setPending(null)
    if (withNote) setActive({ id: h.id, anchor, edit: true })
    return h
  }

  const scrollToHighlight = (id: string): void => {
    const mark = scrollRef.current?.querySelector(`mark[data-hl="${id}"]`) as HTMLElement | null
    if (!mark) return
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const all = scrollRef.current?.querySelectorAll(`mark[data-hl="${id}"]`)
    all?.forEach((m) => {
      m.classList.remove('flash')
      void (m as HTMLElement).offsetWidth
      m.classList.add('flash')
    })
  }

  const exportObsidian = async (): Promise<void> => {
    if (!item) return
    try {
      if (!settings?.obsidianVault) {
        const folder = await api.chooseFolder()
        if (!folder) return
        await useApp.getState().updateSettings({ obsidianVault: folder })
      }
      const r = await api.exportToObsidian(item.id)
      toast(`${t.exported} · ${r.path.split(/[\\/]/).slice(-2).join('/')}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const anchorOf = (e: React.MouseEvent): Anchor => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top, bottom: r.bottom }
  }

  if (!item) {
    return (
      <main className="reader">
        <div className="reader-top drag" />
        <div className="reader-empty">
          <div>
            <BookOpenText size={42} strokeWidth={1.4} />
            <div className="big">{t.emptyReader}</div>
            <div className="kbd">{t.emptyReaderHint}</div>
          </div>
        </div>
      </main>
    )
  }

  const activeHighlight = active ? highlights.find((h) => h.id === active.id) : undefined

  return (
    <main className="reader">
      <div className="reader-top drag">
        <button className="round-btn" onClick={() => (focusMode ? toggleFocus(false) : void select(null))} aria-label={t.back} title={t.back}>
          <ChevronLeft size={19} />
        </button>
        <span className="spacer" />
        <div className="pill">
          <button onClick={(e) => setTagAnchor(anchorOf(e))} title={t.tagsLabel} aria-label={t.tagsLabel} className={item.tags.length ? 'on' : ''}>
            <Tag size={17} />
          </button>
          <button onClick={() => void patchItem(item.id, { later: !item.later })} className={item.later ? 'on' : ''} title={`${t.later} (l)`} aria-pressed={item.later}>
            <Layers size={17} />
          </button>
          <button
            onClick={() => void patchItem(item.id, { bookmarked: !item.bookmarked })}
            className={item.bookmarked ? 'on' : ''}
            title={`${t.bookmarks} (b)`}
            aria-pressed={item.bookmarked}
          >
            <motion.span key={String(item.bookmarked)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} style={{ display: 'grid' }}>
              <Bookmark size={17} fill={item.bookmarked ? 'currentColor' : 'none'} />
            </motion.span>
          </button>
          <button onClick={() => void patchItem(item.id, { favorite: !item.favorite })} className={item.favorite ? 'on' : ''} title={`${t.favorites} (f)`} aria-pressed={item.favorite}>
            <motion.span key={String(item.favorite)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }} style={{ display: 'grid' }}>
              <Heart size={17} fill={item.favorite ? 'currentColor' : 'none'} />
            </motion.span>
          </button>
        </div>
        <div className="pill">
          <button onClick={() => toggleFocus()} className={focusMode ? 'on' : ''} title={`${t.focus} (z)`} aria-pressed={focusMode}>
            {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={() => togglePanel()} className={panelOpen ? 'on' : ''} title={`${t.highlightsOf} (h)`} aria-pressed={panelOpen}>
            <Highlighter size={17} />
          </button>
          <button onClick={(e) => setShareAnchor(anchorOf(e))} title={t.exportObsidian} aria-label={t.exportObsidian}>
            <Share size={17} />
          </button>
        </div>
      </div>
      {extracting && <div className="loading-bar" />}

      <div className={`reader-scroll${item.format === 'pdf' ? ' pdf-scroll' : ''}`} ref={scrollRef}>
        {item.format === 'epub' && (
          <EpubView key={item.id} item={item} highlights={highlights} scrollRef={scrollRef} navRef={navRef} onOrphans={setOrphans} onMouseUp={onMouseUp} onClick={onClickContent} />
        )}
        {item.format === 'pdf' && (
          <PdfView key={item.id} item={item} highlights={highlights} scrollRef={scrollRef} navRef={navRef} onOrphans={setOrphans} onMouseUp={onMouseUp} onClick={onClickContent} />
        )}
        {!item.format && (
        <motion.article
            key={item.id}
            className="article"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="article-source">
              <SourceIcon source={source} />
              {source?.title}
            </div>
            <h1 className="title">{item.title}</h1>
            <div className="byline">
              {[item.author, fullDate(item.publishedAt, lang)].filter(Boolean).join(' · ')}
            </div>
            {item.tags.length > 0 && (
              <div className="article-tags">
                {item.tags.map((tag) => (
                  <span key={tag} className="tag-chip" style={{ paddingRight: 10 }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {item.url && (
              <div className="mode-switch" role="tablist">
                {(['feed', 'full'] as const).map((m) => (
                  <button key={m} className={layer === m ? 'on' : ''} onClick={() => void setMode(m)} role="tab" aria-selected={layer === m}>
                    {layer === m && <motion.span layoutId="mode-bg" className="mode-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span>{m === 'feed' ? t.feedText : extracting ? t.loadingFullText : t.fullText}</span>
                  </button>
                ))}
              </div>
            )}
            {showHero && <img className="hero" src={item.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setHeroOk(false)} />}
            <ArticleContent
              contentRef={contentRef}
              html={html}
              layer={layer}
              highlights={layerHighlights}
              serif={settings?.readerFont === 'serif'}
              onOrphans={setOrphans}
              onMouseUp={onMouseUp}
              onClick={onClickContent}
            />
          </motion.article>
        )}
      </div>

      <AnimatePresence>
        {panelOpen && (
          <HighlightsPanel
            key="panel"
            highlights={highlights}
            orphans={orphans}
            current={item.format ? navRef.current?.current() : layer}
            labelFor={(l) => layerLabel(l, t)}
            onJump={async (h) => {
              if (item.format) {
                await navRef.current?.goTo(h.layer)
                setTimeout(() => scrollToHighlight(h.id), 120)
                return
              }
              if (h.layer !== layer) void setMode(h.layer as 'feed' | 'full')
              setTimeout(() => scrollToHighlight(h.id), h.layer !== layer ? 300 : 0)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pending && (
          <HighlightMenu
            key="pending"
            selection={pending}
            onClose={() => setPending(null)}
            onCreate={(color, withNote) => void createHighlight(color, withNote)}
          />
        )}
        {active && activeHighlight && (
          <HighlightMenu key={`active-${active.id}`} highlight={activeHighlight} anchor={active.anchor} startEditing={active.edit} onClose={() => setActive(null)} />
        )}
        {tagAnchor && (
          <Popover key="tags" anchor={tagAnchor} placement="below" onClose={() => setTagAnchor(null)}>
            <TagEditor tags={item.tags} onChange={(tags) => void patchItem(item.id, { tags })} />
          </Popover>
        )}
        {shareAnchor && (
          <Popover key="share" anchor={{ ...shareAnchor, x: shareAnchor.x - 90 }} placement="below" onClose={() => setShareAnchor(null)} className="menu">
            <button
              onClick={() => {
                setShareAnchor(null)
                void exportObsidian()
              }}
            >
              <FileDown size={15} /> {t.exportObsidian}
            </button>
            <button
              onClick={async () => {
                setShareAnchor(null)
                await navigator.clipboard.writeText(await api.markdownFor(item.id))
                toast(t.copied)
              }}
            >
              <Copy size={15} /> {t.copyMarkdown}
            </button>
            {item.url && (
              <>
                <div className="sep" />
                <button
                  onClick={async () => {
                    setShareAnchor(null)
                    await navigator.clipboard.writeText(item.url!)
                    toast(t.copied)
                  }}
                >
                  <LinkIcon size={15} /> {t.copyLink}
                </button>
                <button
                  onClick={() => {
                    setShareAnchor(null)
                    void api.openExternal(item.url!)
                  }}
                >
                  <ExternalLink size={15} /> {t.openInBrowser}
                </button>
              </>
            )}
          </Popover>
        )}
      </AnimatePresence>
    </main>
  )
}
