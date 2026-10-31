import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, List } from 'lucide-react'
import type { TocEntry } from '@shared/types'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { sanitizeBook } from '../../lib/sanitize'
import ArticleContent from '../ArticleContent'
import TocPanel from './TocPanel'
import { parsePosition, typing, usePositionSaver, type BookViewProps } from './common'

export default function EpubView({ item, highlights, scrollRef, navRef, onOrphans, onMouseUp, onClick }: BookViewProps): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const serif = useApp((s) => s.settings?.readerFont === 'serif')
  const start = useMemo(() => parsePosition(item.position), [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [chapter, setChapter] = useState(start.chapter ?? 0)
  const [data, setData] = useState<{ index: number; html: string; title?: string; count: number } | null>(null)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const restoreScroll = useRef<number | null>(start.scroll ?? null)
  const pendingAnchor = useRef<string | null>(null)
  const waiters = useRef<(() => void)[]>([])
  const save = usePositionSaver(item.id)

  const layer = `ch:${chapter}`
  const html = useMemo(() => (data ? sanitizeBook(data.html) : ''), [data])
  const layerHighlights = useMemo(() => highlights.filter((h) => h.layer === layer), [highlights, layer])
  const count = data?.count ?? 0

  useEffect(() => {
    void api.bookToc(item.id).then(setToc)
  }, [api, item.id])

  useEffect(() => {
    let alive = true
    api
      .bookChapter(item.id, chapter)
      .then((d) => alive && setData({ ...d, index: chapter }))
      .catch((e: Error) => toast(e.message, 'error'))
    return () => {
      alive = false
    }
  }, [api, item.id, chapter, toast])

  // Après l'insertion du chapitre (effet de ArticleContent, exécuté avant celui-ci) : position de lecture.
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!data || !sc || data.index !== chapter) return
    if (pendingAnchor.current) {
      document.getElementById(pendingAnchor.current)?.scrollIntoView()
      pendingAnchor.current = null
    } else if (restoreScroll.current != null) {
      const frac = restoreScroll.current
      restoreScroll.current = null
      // Les images se chargent après coup : on repositionne une seconde fois.
      const apply = (): void => {
        sc.scrollTop = frac * (sc.scrollHeight - sc.clientHeight)
      }
      apply()
      setTimeout(apply, 250)
    } else sc.scrollTop = 0
    waiters.current.splice(0).forEach((w) => w())
  }, [data, chapter, scrollRef])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || !count) return
    const onScroll = (): void => {
      const max = sc.scrollHeight - sc.clientHeight
      const frac = max > 0 ? sc.scrollTop / max : 1
      save({ chapter, scroll: Math.round(frac * 1000) / 1000 }, (chapter + frac) / count)
    }
    onScroll()
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [scrollRef, chapter, count]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (index: number, anchor?: string): Promise<void> => {
    if (index < 0 || (count && index >= count)) return Promise.resolve()
    if (index === chapter && data?.index === chapter) {
      if (anchor) document.getElementById(`ch${index}~${anchor}`)?.scrollIntoView({ behavior: 'smooth' })
      return Promise.resolve()
    }
    pendingAnchor.current = anchor ? `ch${index}~${anchor}` : null
    restoreScroll.current = null
    setChapter(index)
    return new Promise((r) => waiters.current.push(r))
  }

  navRef.current = {
    current: () => layer,
    goTo: (l) => (l.startsWith('ch:') ? go(Number(l.slice(3))) : Promise.resolve())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') void go(chapter + 1)
      else if (e.key === 'ArrowLeft') void go(chapter - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onContentClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#ch"]')
    if (a) {
      e.preventDefault()
      const m = a.getAttribute('href')!.match(/^#ch(\d+)(?:~(.+))?$/)
      if (m) void go(Number(m[1]), m[2])
      return
    }
    onClick(e)
  }

  const chapterTitle = data?.title ?? toc.find((e) => e.chapter === chapter)?.title ?? `${t.chapter} ${chapter + 1}`
  const progress = Math.round((item.progress ?? 0) * 100)

  return (
    <div className="book">
      <div className="book-bar">
        <button className="tb-btn" onClick={() => setTocOpen(!tocOpen)} aria-pressed={tocOpen} title={t.toc}>
          <List size={16} /> {t.toc}
        </button>
        <span className="book-bar-title">{chapterTitle}</span>
        <span className="book-bar-meta">
          {count ? `${t.chapter} ${chapter + 1} ${t.of} ${count}` : ''} · {t.readPercent(progress)}
        </span>
        <div className="book-progress" aria-hidden>
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>

      {!data && <div className="book-loading">{t.loadingBook}</div>}
      {data && (
        <motion.article
          key={chapter}
          className="article book-article"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {chapter === 0 && (
            <div className="book-head">
              <div className="book-head-title">{item.title}</div>
              {item.author && <div className="book-head-author">{item.author}</div>}
            </div>
          )}
          <ArticleContent
            contentRef={contentRef}
            html={html}
            layer={layer}
            highlights={layerHighlights}
            serif={serif}
            onOrphans={onOrphans}
            onMouseUp={onMouseUp}
            onClick={onContentClick}
          />
          <nav className="chapter-nav">
            <button className="btn" disabled={chapter === 0} onClick={() => void go(chapter - 1)}>
              <ChevronLeft size={16} /> {t.previous}
            </button>
            <button className="btn" disabled={!count || chapter >= count - 1} onClick={() => void go(chapter + 1)}>
              {t.nextChapter} <ChevronRight size={16} />
            </button>
          </nav>
        </motion.article>
      )}

      {scrollRef.current?.parentElement &&
        createPortal(
          <AnimatePresence>
            {tocOpen && (
              <TocPanel
                toc={toc}
                current={chapter}
                onClose={() => setTocOpen(false)}
                onPick={(e) => {
                  setTocOpen(false)
                  void go(e.chapter, e.anchor)
                }}
              />
            )}
          </AnimatePresence>,
          scrollRef.current.parentElement
        )}
    </div>
  )
}
