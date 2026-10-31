import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  Headphones,
  Heart,
  Highlighter,
  LayoutGrid,
  Layers,
  Link2,
  Network,
  PenTool,
  Folder,
  Plus,
  RefreshCw,
  Scale,
  Settings as SettingsIcon,
  Tag,
  Trash2,
  Tv,
  Zap
} from 'lucide-react'
import type { Source, SourceKind, View } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import SourceIcon from './SourceIcon'
import { catalog } from '@shared/catalog'
import Popover from './Popover'

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function NavRow({ view, icon, label, badge, disabled, soon, error, onContext }: {
  view?: View
  icon: ReactNode
  label: string
  badge?: number
  disabled?: boolean
  soon?: string
  error?: string
  onContext?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const current = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const active = !!view && sameView(view, current)
  return (
    <button
      className={`nav-row${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onClick={() => view && !disabled && setView(view)}
      onContextMenu={onContext}
      title={error ?? label}
      aria-current={active ? 'page' : undefined}
    >
      {active && <motion.div layoutId="nav-active" className="nav-active-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      {icon}
      <span className="label">{label}</span>
      {error && <span className="error-dot" />}
      {soon && <span className="soon">{soon}</span>}
      {!!badge && (
        <motion.span key={badge} className="badge" initial={{ scale: 0.6, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
          {badge}
        </motion.span>
      )}
    </button>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`section:${id}`) !== 'closed'
    } catch {
      return true
    }
  })
  const toggle = (): void => {
    setOpen(!open)
    try {
      localStorage.setItem(`section:${id}`, open ? 'closed' : 'open')
    } catch {
      /* stockage indisponible : on ne mémorise pas */
    }
  }
  return (
    <div>
      <button className={`section-head${open ? '' : ' closed'}`} onClick={toggle} aria-expanded={open}>
        <span className="label">{title}</span>
        <ChevronDown size={18} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="section-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Nom affiché d'une catégorie : celles du catalogue sont traduites, les dossiers OPML gardés tels quels. */
export function categoryLabel(id: string, lang: 'fr' | 'en'): string {
  const c = catalog.categories.find((x) => x.id === id)
  return c ? c[lang] : id
}

/** Groupe de sources d'une même catégorie, repliable, comme un dossier de Reeder. */
function CategoryGroup({ section, category, label, children }: { section: string; category: string; label: string; children: ReactNode }): React.JSX.Element {
  const key = `group:${section}:${category}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'closed'
    } catch {
      return true
    }
  })
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const active = view.type === 'category' && view.category === category
  return (
    <div className="cat-group">
      <div className={`cat-head${active ? ' active' : ''}`}>
        <button
          className={`cat-chevron${open ? '' : ' closed'}`}
          onClick={() => {
            setOpen(!open)
            try {
              localStorage.setItem(key, open ? 'closed' : 'open')
            } catch {
              /* stockage indisponible */
            }
          }}
          aria-expanded={open}
          aria-label={label}
        >
          <ChevronDown size={14} />
        </button>
        <button className="cat-label" onClick={() => setView({ type: 'category', category })}>
          <Folder size={14} /> {label}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="section-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Sidebar(): React.JSX.Element {
  const t = useT()
  const sources = useApp((s) => s.sources)
  const counts = useApp((s) => s.counts)
  const boards = useApp((s) => s.boards)
  const createBoard = useApp((s) => s.createBoard)
  const view = useApp((s) => s.view)
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const setDialog = useApp((s) => s.setDialog)
  const api = useApp((s) => s.api)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const toast = useApp((s) => s.toast)
  const [menu, setMenu] = useState<{ source: Source; x: number; y: number } | null>(null)
  const [catMenu, setCatMenu] = useState<{ source: Source; x: number; y: number } | null>(null)
  const [boardMenu, setBoardMenu] = useState<{ x: number; y: number } | null>(null)
  const [newCat, setNewCat] = useState('')
  const lang = settings?.language ?? 'fr'
  const knownCategories = [...new Set([...catalog.categories.map((c) => c.id), ...sources.map((s) => s.category).filter((c): c is string => !!c)])]
  const setCategory = async (source: Source, category: string | undefined): Promise<void> => {
    setCatMenu(null)
    setNewCat('')
    await api.updateSource(source.id, { category })
    await reloadMeta()
  }

  const unread = (id: string): number | undefined => (settings?.showUnread ? counts?.unreadBySource[id] : undefined)
  const byKind = (kinds: SourceKind[]): Source[] => sources.filter((s) => kinds.includes(s.kind))

  const plainRows = (list: Source[]): ReactNode =>
    list.map((s) => (
      <NavRow
        key={s.id}
        view={{ type: 'source', sourceId: s.id }}
        icon={<SourceIcon source={s} />}
        label={s.title}
        badge={unread(s.id)}
        error={s.error}
        onContext={(e) => {
          e.preventDefault()
          setMenu({ source: s, x: e.clientX, y: e.clientY })
        }}
      />
    ))

  /** Sources regroupées par catégorie dès qu'il y en a plusieurs ; sans catégorie : « Autres », en dernier. */
  const sourceRows = (list: Source[], section: string): ReactNode => {
    const groups = new Map<string, Source[]>()
    for (const s of list) groups.set(s.category ?? '', [...(groups.get(s.category ?? '') ?? []), s])
    if (groups.size <= 1) return plainRows(list)
    const order = (c: string): number => (c ? catalog.categories.findIndex((x) => x.id === c) + 1 || 50 : 99)
    return [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([cat, items]) => (
        <CategoryGroup key={cat || '_'} section={section} category={cat} label={cat ? categoryLabel(cat, lang) : t.otherCategory}>
          {plainRows(items)}
        </CategoryGroup>
      ))
  }

  const social = byKind(['mastodon', 'bluesky', 'x'])
  const reddit = byKind(['reddit'])
  const forums = byKind(['forum'])
  const feeds = byKind(['rss'])
  const podcasts = byKind(['podcast'])
  const videos = byKind(['youtube'])
  const tags = Object.entries(counts?.tags ?? {})

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <button className="round-btn" onClick={() => setDialog('settings')} title={t.settings} aria-label={t.settings}>
          <SettingsIcon size={17} />
        </button>
        <button className="round-btn" onClick={() => setDialog('add')} title={t.addSource} aria-label={t.addSource}>
          <Plus size={19} />
        </button>
      </div>
      <nav className="sidebar-scroll">
        <button className={`home-card${view.type === 'home' ? ' active' : ''}`} onClick={() => setView({ type: 'home' })}>
          <Zap size={22} fill="currentColor" />
          <span style={{ flex: 1 }}>
            <div className="t1">{t.home}</div>
            <div className="t2">{t.allFeeds}</div>
          </span>
          {settings?.showUnread && !!counts?.unreadTotal && <span className="badge" style={{ fontSize: 12, color: 'var(--text-2)' }}>{counts.unreadTotal}</span>}
        </button>
        <NavRow view={{ type: 'kind', kind: 'podcast' }} icon={<Headphones size={19} />} label={t.audio} />
        <NavRow view={{ type: 'kind', kind: 'youtube' }} icon={<Tv size={19} />} label={t.video} />
        <NavRow view={{ type: 'library' }} icon={<BookOpen size={19} />} label={t.library} badge={counts?.library} />

        <Section id="saved" title={t.saved}>
          <NavRow view={{ type: 'links' }} icon={<Link2 size={19} />} label={t.links} badge={counts?.links} />
          <NavRow view={{ type: 'later' }} icon={<Layers size={19} />} label={t.later} badge={counts?.later} />
          <NavRow view={{ type: 'bookmarks' }} icon={<Bookmark size={19} />} label={t.bookmarks} badge={counts?.bookmarks} />
          <NavRow view={{ type: 'favorites' }} icon={<Heart size={19} />} label={t.favorites} badge={counts?.favorites} />
          <NavRow view={{ type: 'highlights' }} icon={<Highlighter size={19} />} label={t.highlights} badge={counts?.highlights} />
          <button className="nav-row" onClick={() => setDialog('balance')}>
            <Scale size={19} />
            <span className="label">{t.balanceNav}</span>
          </button>
        </Section>

        <Section id="tags" title={t.tagsLabel}>
          {tags.map(([tag, n]) => (
            <NavRow key={tag} view={{ type: 'tag', tag }} icon={<Tag size={19} />} label={tag} badge={n} />
          ))}
          {!tags.length && <div className="nav-hint">{t.tagsHint}</div>}
        </Section>

        <Section id="boards" title={t.boards}>
          {boards.map((b) => (
            <NavRow
              key={b.id}
              view={{ type: 'board', boardId: b.id }}
              icon={b.mode === 'sketch' ? <PenTool size={18} /> : b.mode === 'canvas' ? <LayoutGrid size={18} /> : <Network size={19} />}
              label={b.title}
              badge={b.nodeCount || undefined}
            />
          ))}
          <button
            className="nav-row"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setBoardMenu({ x: r.left + 24, y: r.bottom })
            }}
          >
            <Plus size={19} />
            <span className="label" style={{ color: 'var(--text-2)' }}>{t.newBoard}</span>
          </button>
        </Section>

        {podcasts.length > 0 && (
          <Section id="podcasts" title={t.podcasts}>
            {sourceRows(podcasts, 'podcasts')}
          </Section>
        )}
        {videos.length > 0 && (
          <Section id="youtube" title={t.youtube}>
            {sourceRows(videos, 'videos')}
          </Section>
        )}
        {social.length > 0 && (
          <Section id="social" title={t.social}>
            {sourceRows(social, 'social')}
          </Section>
        )}
        {reddit.length > 0 && (
          <Section id="reddit" title={t.reddit}>
            {sourceRows(reddit, 'reddit')}
          </Section>
        )}
        {forums.length > 0 && (
          <Section id="forums" title={t.forums}>
            {sourceRows(forums, 'forums')}
          </Section>
        )}
        {feeds.length > 0 && (
          <Section id="feeds" title={t.feeds}>
            {sourceRows(feeds, 'feeds')}
          </Section>
        )}
      </nav>

      <AnimatePresence>
        {menu && (
          <Popover anchor={{ x: menu.x + 110, y: menu.y, bottom: menu.y }} placement="below" onClose={() => setMenu(null)} className="menu">
            <button
              onClick={() => {
                void api.refresh(menu.source.id).then(() => {
                  void reloadMeta()
                  void useApp.getState().loadItems(true)
                })
                setMenu(null)
              }}
            >
              <RefreshCw size={15} /> {t.refresh}
            </button>
            <button
              onClick={() => {
                setCatMenu(menu)
                setMenu(null)
              }}
            >
              <Folder size={15} /> {t.changeCategory}
            </button>
            <div className="sep" />
            <button
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                const s = menu.source
                setMenu(null)
                void api.removeSource(s.id).then(() => {
                  toast(`${t.removeSource} : ${s.title}`)
                  if (view.type === 'source' && view.sourceId === s.id) setView({ type: 'home' })
                  void reloadMeta()
                })
              }}
            >
              <Trash2 size={15} /> {t.removeSource}
            </button>
          </Popover>
        )}
        {catMenu && (
          <Popover key="cat" anchor={{ x: catMenu.x + 110, y: catMenu.y, bottom: catMenu.y }} placement="below" onClose={() => setCatMenu(null)} className="menu">
            <div className="hint" style={{ padding: '4px 10px 6px' }}>
              {catMenu.source.title}
            </div>
            {knownCategories.map((c) => (
              <button key={c} onClick={() => void setCategory(catMenu.source, c)} className={catMenu.source.category === c ? 'on' : ''}>
                <Folder size={15} /> {categoryLabel(c, lang)}
              </button>
            ))}
            <button onClick={() => void setCategory(catMenu.source, undefined)}>{t.otherCategory}</button>
            <div className="sep" />
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (newCat.trim()) void setCategory(catMenu.source, newCat.trim())
              }}
              style={{ padding: '2px 6px 4px' }}
            >
              <input className="text-input" style={{ height: 32 }} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t.newCategory} autoFocus />
            </form>
          </Popover>
        )}
        {boardMenu && (
          <Popover key="boards" anchor={{ x: boardMenu.x + 110, y: boardMenu.y, bottom: boardMenu.y }} placement="below" onClose={() => setBoardMenu(null)} className="menu">
            {(
              [
                ['mindmap', <Network key="m" size={15} />, t.newMindmap],
                ['canvas', <LayoutGrid key="c" size={15} />, t.newCanvas],
                ['sketch', <PenTool key="s" size={15} />, t.newSketch]
              ] as const
            ).map(([mode, icon, label]) => (
              <button
                key={mode}
                onClick={() => {
                  setBoardMenu(null)
                  void createBoard(mode)
                }}
              >
                {icon} {label}
              </button>
            ))}
          </Popover>
        )}
      </AnimatePresence>
    </aside>
  )
}
