import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Bookmark, BookPlus, Check, CheckCheck, Filter, Headphones, Heart, Highlighter, Layers, PanelLeft, Play, RefreshCw, Search, Tv, X } from 'lucide-react'
import { formatTime } from '@shared/media'
import { categoryLabel } from './Sidebar'
import { dictionaries } from '../lib/i18n'
import type { Item, Source, View } from '@shared/types'
import { useApp } from '../lib/store'
import { useT, type Dict } from '../lib/i18n'
import { relativeTime } from '../lib/time'
import SourceIcon from './SourceIcon'
import { gestureOn, WheelTracker } from '../lib/gestures'

const PULL_THRESHOLD = 110
const SWIPE_THRESHOLD = 90

interface SwipeState {
  top: number
  height: number
  offset: number
  later: boolean
  read: boolean
}

/**
 * Gestes de la liste au trackpad :
 * - deux doigts vers le bas, déjà tout en haut : tirer pour actualiser ;
 * - deux doigts à l'horizontale sur une carte : ← plus tard, → lu / non lu.
 */
function useListGestures(scrollRef: React.RefObject<HTMLDivElement | null>): { pull: number; swipe: SwipeState | null } {
  const [pull, setPull] = useState(0)
  const [swipe, setSwipe] = useState<SwipeState | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let card: HTMLElement | null = null
    let offset = 0
    let pulled = 0
    let cooldown = 0
    const tracker = new WheelTracker(() => {
      if (card) {
        const c = card
        c.style.transition = 'transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)'
        c.style.transform = ''
        setTimeout(() => c.classList.remove('swiping'), 340)
        const s = useApp.getState()
        const item = s.items.find((i) => i.id === c.dataset.id)
        if (item && Math.abs(offset) >= SWIPE_THRESHOLD) {
          if (offset < 0) void s.patchItem(item.id, { later: !item.later })
          else void s.patchItem(item.id, { read: !item.read })
        }
        card = null
        offset = 0
        setSwipe(null)
      }
      if (pulled > 0) {
        if (pulled >= PULL_THRESHOLD && Date.now() > cooldown) {
          cooldown = Date.now() + 1500
          void useApp.getState().refresh()
        }
        pulled = 0
        setPull(0)
      }
    })
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return
      tracker.push(e)
      if (tracker.axis === 'x' && gestureOn('cardSwipe')) {
        if (!card) {
          const found = (e.target as HTMLElement).closest<HTMLElement>('.card[data-id]')
          if (!found || found.classList.contains('book-card')) return
          card = found
          card.classList.add('swiping')
          card.style.transition = 'none'
        }
        e.preventDefault()
        // Les doigts vers la gauche poussent la carte vers la gauche.
        offset = Math.max(-170, Math.min(170, -tracker.dx))
        card.style.transform = `translateX(${offset}px)`
        const item = useApp.getState().items.find((i) => i.id === card!.dataset.id)
        setSwipe({ top: card.offsetTop, height: card.offsetHeight, offset, later: !!item?.later, read: !!item?.read })
      } else if (tracker.axis === 'y' && gestureOn('pullRefresh') && el.scrollTop <= 0 && (e.deltaY < 0 || pulled > 0)) {
        pulled = Math.max(0, pulled - e.deltaY)
        setPull(pulled)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollRef])
  return { pull, swipe }
}

const SOCIAL = new Set(['mastodon', 'bluesky', 'x'])

function viewTitle(view: View, t: Dict, sources: Source[]): [string, string] {
  switch (view.type) {
    case 'home':
      return [t.home, t.allFeeds]
    case 'later':
      return [t.later, t.saved]
    case 'bookmarks':
      return [t.bookmarks, t.saved]
    case 'favorites':
      return [t.favorites, t.saved]
    case 'links':
      return [t.links, t.saved]
    case 'library':
      return [t.library, 'EPUB · PDF']
    case 'highlights':
      return [t.highlights, t.saved]
    case 'tag':
      return [view.tag, t.tagsLabel]
    case 'kind':
      if (view.kind === 'podcast') return [t.audio, t.podcasts]
      if (view.kind === 'youtube') return [t.video, t.youtube]
      return [t.kinds[view.kind] ?? view.kind, t.feeds]
    case 'category':
      return [view.category ? categoryLabel(view.category, t === dictionaries.en ? 'en' : 'fr') : t.otherCategory, view.section === 'all' ? t.allMedia : t[view.section]]
    case 'source': {
      const s = sources.find((x) => x.id === view.sourceId)
      return [s?.title ?? '', s ? t.kinds[s.kind] : '']
    }
    default:
      return ['', '']
  }
}

const Card = memo(function Card({ item, index, source, selected, beforeSelected, showUnread, lang, onSelect }: {
  index: number
  item: Item
  source?: Source
  selected: boolean
  beforeSelected: boolean
  showUnread: boolean
  lang: 'fr' | 'en'
  onSelect(id: string): void
}) {
  const social = source && SOCIAL.has(source.kind)
  const [imgOk, setImgOk] = useState(true)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  if (item.format) {
    const pct = Math.round((item.progress ?? 0) * 100)
    return (
      <button
        ref={ref}
        className={`card book-card${selected ? ' selected' : ''}${beforeSelected ? ' before-selected' : ''}`}
        onClick={() => onSelect(item.id)}
        data-id={item.id}
        style={{ ['--i' as string]: Math.min(index, 14) }}
      >
        {selected && <motion.div layoutId="card-selected" className="card-selected-bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
        <div className="book-card-row">
          {item.imageUrl && imgOk ? (
            <img className="book-cover" src={item.imageUrl} alt="" draggable={false} onError={() => setImgOk(false)} />
          ) : (
            <div className="book-cover placeholder">
              <span>{item.title}</span>
            </div>
          )}
          <div className="book-card-info">
            <div className="card-title">{item.title}</div>
            {item.author && <div className="book-card-author">{item.author}</div>}
            <div className="book-card-meta">
              <span className="chip">{item.format.toUpperCase()}</span>
              {!!item.highlightCount && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Highlighter size={13} /> {item.highlightCount}
                </span>
              )}
              {item.favorite && <Heart size={13} className="flag-on" />}
            </div>
            <div className="book-card-progress">
              <div className="bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <span>{pct} %</span>
            </div>
          </div>
        </div>
      </button>
    )
  }

  return (
    <button
      ref={ref}
      className={`card${selected ? ' selected' : ''}${beforeSelected ? ' before-selected' : ''}${item.read && !selected ? ' read' : ''}${item.hidden ? ' filtered' : ''}`}
      onClick={() => onSelect(item.id)}
      data-id={item.id}
      style={{ ['--i' as string]: Math.min(index, 14) }}
    >
      {selected && <motion.div layoutId="card-selected" className="card-selected-bg" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
      <div className="card-head">
        <SourceIcon source={source} size="lg" />
        <div className="meta">
          <div className="src">{source?.title ?? ''}</div>
          {item.author && <div className="author">{item.author}</div>}
        </div>
        <div className="time">
          {showUnread && !item.read && <span className="unread-dot" />}
          {relativeTime(item.publishedAt, lang)}
        </div>
      </div>
      <div className="card-body">
        {!social && <div className="card-title">{item.title}</div>}
        <div className="card-row">
          {item.summary && (
            <div className="card-excerpt" style={social ? ({ color: 'var(--text)', '--lines': 6 } as React.CSSProperties) : undefined}>
              {item.summary}
            </div>
          )}
          {item.imageUrl && imgOk && (
            <span className="card-thumb-wrap">
              <img className="card-thumb" src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setImgOk(false)} />
              {item.mediaType && (
                <span className="thumb-play">
                  <Play size={14} fill="currentColor" />
                </span>
              )}
            </span>
          )}
        </div>
        {item.mediaType && (
          <div className="card-media">
            {item.mediaType === 'audio' ? <Headphones size={13} /> : <Tv size={13} />}
            {item.duration ? formatTime(item.duration) : null}
            {!!item.progress && item.progress < 0.98 && (
              <span className="bar">
                <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </span>
            )}
          </div>
        )}
        {(item.later || item.bookmarked || item.favorite || !!item.highlightCount || item.tags.length > 0) && (
          <div className="card-flags">
            {item.later && <Layers size={13} className="flag-on" />}
            {item.bookmarked && <Bookmark size={13} className="flag-on" />}
            {item.favorite && <Heart size={13} className="flag-on" />}
            {!!item.highlightCount && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Highlighter size={13} /> {item.highlightCount}
              </span>
            )}
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="card-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
})

export default function Timeline(): React.JSX.Element {
  const t = useT()
  const items = useApp((s) => s.items)
  const sources = useApp((s) => s.sources)
  const view = useApp((s) => s.view)
  const selectedId = useApp((s) => s.selectedId)
  const select = useApp((s) => s.select)
  const hasMore = useApp((s) => s.hasMore)
  const loading = useApp((s) => s.loading)
  const loadItems = useApp((s) => s.loadItems)
  const refreshing = useApp((s) => s.refreshing)
  const refresh = useApp((s) => s.refresh)
  const settings = useApp((s) => s.settings)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const setSearch = useApp((s) => s.setSearch)
  const api = useApp((s) => s.api)
  const importBooks = useApp((s) => s.importBooks)

  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { pull, swipe } = useListGestures(scrollRef)

  // « N nouveaux » : des articles sont arrivés au-dessus pendant qu'on lisait plus bas dans la liste.
  const [fresh, setFresh] = useState(0)
  const knownIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    const before = knownIds.current
    const firstKnown = items.findIndex((i) => before.has(i.id))
    if (before.size && firstKnown > 0 && (scrollRef.current?.scrollTop ?? 0) > 150) setFresh((n) => n + firstKnown)
    knownIds.current = new Set(items.map((i) => i.id))
  }, [items])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      if (el.scrollTop < 60) setFresh(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const [title, subtitle] = viewTitle(view, t, sources)
  const showHidden = useApp((s) => s.showHidden)
  const setShowHidden = useApp((s) => s.setShowHidden)
  const filteredSource = view.type === 'source' ? sources.find((x) => x.id === view.sourceId && x.filter) : undefined
  const selectedIndex = items.findIndex((i) => i.id === selectedId)
  // Fonction stable : les cartes (mémoïsées) ne se redessinent que si leur propre contenu change.
  const onSelect = useCallback((id: string) => void select(id), [select])

  useEffect(() => {
    const h = setTimeout(() => setSearch(q), 220)
    return () => clearTimeout(h)
  }, [q, setSearch])

  useEffect(() => {
    const onFocus = (): void => {
      setSearching(true)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    window.addEventListener('learn:focus-search', onFocus)
    return () => window.removeEventListener('learn:focus-search', onFocus)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    knownIds.current = new Set()
    setFresh(0)
    setQ('')
    setSearching(false)
  }, [view])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) void loadItems()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, loadItems])

  return (
    <section className="list" aria-label={title}>
      <div className="list-top drag">
        {!sidebarOpen && (
          <button className="round-btn" onClick={toggleSidebar} aria-label="Sidebar" style={api.platform === 'darwin' ? { marginLeft: 72 } : undefined}>
            <PanelLeft size={17} />
          </button>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          {searching ? (
            <motion.div
              key="search"
              className="search-box"
              style={{ flex: 1 }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            >
              <Search size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
              <input
                ref={inputRef}
                value={q}
                placeholder={t.searchPlaceholder}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQ('')
                    setSearching(false)
                  }
                }}
              />
              <button
                onClick={() => {
                  setQ('')
                  setSearching(false)
                }}
                aria-label={t.close}
              >
                <X size={15} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="title" style={{ display: 'flex', flex: 1, minWidth: 0, gap: 8, alignItems: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="list-title">
                <div style={{ minWidth: 0 }}>
                  <div className="t1">{title}</div>
                  <div className="t2">{subtitle}</div>
                </div>
                <button className="up" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Haut">
                  <ArrowUp size={13} />
                </button>
              </div>
              <span className="spacer" />
              {settings?.showUnread && (
                <button
                  className="round-btn"
                  title={t.markAllRead}
                  aria-label={t.markAllRead}
                  onClick={() => void api.markAllRead(view).then(() => useApp.getState().reloadMeta().then(() => loadItems(true)))}
                >
                  <CheckCheck size={17} />
                </button>
              )}
              {view.type === 'library' && (
                <button className="round-btn" onClick={() => void importBooks()} title={t.importBooks} aria-label={t.importBooks}>
                  <BookPlus size={17} />
                </button>
              )}
              <button className="round-btn" onClick={() => void refresh()} title={t.refresh} aria-label={t.refresh} disabled={refreshing}>
                <motion.span
                  style={{ display: 'grid' }}
                  animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
                  transition={refreshing ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : { duration: 0 }}
                >
                  <RefreshCw size={16} />
                </motion.span>
              </button>
              <button
                className="round-btn"
                onClick={() => {
                  setSearching(true)
                  setTimeout(() => inputRef.current?.focus(), 50)
                }}
                title={t.search}
                aria-label={t.search}
              >
                <Search size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {fresh > 0 && (
          <motion.button
            className="fresh-pill"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            onClick={() => {
              scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
              setFresh(0)
            }}
          >
            <ArrowUp size={14} /> {t.newAbove(fresh)}
          </motion.button>
        )}
      </AnimatePresence>
      {filteredSource && (
        <div className="filter-bar">
          <Filter size={13} />
          <span>{t.filterActive}</span>
          <button className="link-btn" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? t.hideFiltered : t.showFiltered}
          </button>
          <button className="link-btn" onClick={() => useApp.getState().openFilter(filteredSource.id)}>
            {t.filtersMenu}
          </button>
        </div>
      )}
      <div className="list-scroll" ref={scrollRef}>
        {pull > 0 && (
          <div className={`pull-indicator${pull >= PULL_THRESHOLD ? ' armed' : ''}`} style={{ height: Math.min(pull, 150) * 0.55 }}>
            <RefreshCw size={17} style={{ transform: `rotate(${pull * 2.4}deg)` }} />
            <span>{pull >= PULL_THRESHOLD ? t.releaseToRefresh : t.pullToRefresh}</span>
          </div>
        )}
        {swipe && (
          <div
            className={`swipe-bg ${swipe.offset < 0 ? 'later' : 'read'}${Math.abs(swipe.offset) >= SWIPE_THRESHOLD ? ' armed' : ''}`}
            style={{ top: swipe.top, height: swipe.height }}
          >
            {swipe.offset < 0 ? (
              <span className="right">
                <Layers size={18} /> {swipe.later ? t.swipeUnlater : t.later}
              </span>
            ) : (
              <span className="left">
                <Check size={18} /> {swipe.read ? t.swipeUnread : t.swipeRead}
              </span>
            )}
          </div>
        )}
        {items.length === 0 && !loading && <div className="list-empty">{view.type === 'library' ? t.emptyLibrary : t.emptyList}</div>}
        {items.map((item, i) => (
          <Card
            key={item.id}
            index={i}
            item={item}
            source={sourceMap.get(item.sourceId)}
            selected={item.id === selectedId}
            beforeSelected={i === selectedIndex - 1}
            showUnread={!!settings?.showUnread}
            lang={settings?.language ?? 'fr'}
            onSelect={onSelect}
          />
        ))}
        <div ref={sentinel} style={{ height: 1 }} />
      </div>
    </section>
  )
}
