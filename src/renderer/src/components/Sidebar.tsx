import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  Headphones,
  Heart,
  Highlighter,
  AtSign,
  MessagesSquare,
  Rss,
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
import { useKeyLabel } from '../lib/shortcuts'

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function NavRow({ view, icon, label, badge, disabled, soon, error, onContext, trail }: {
  view?: View
  icon: ReactNode
  label: string
  /** Petit pictogramme à droite (type de média, dans le tri par catégorie). */
  trail?: ReactNode
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
      {trail && <span className="nav-trail">{trail}</span>}
      {soon && <span className="soon">{soon}</span>}
      {!!badge && (
        <motion.span key={badge} className="badge" initial={{ scale: 0.6, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
          {badge}
        </motion.span>
      )}
    </button>
  )
}

function Section({ id, title, children, onOpen, active }: { id: string; title: string; children: ReactNode; onOpen?: () => void; active?: boolean }): React.JSX.Element {
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
      {onOpen ? (
        // Titre cliquable (tri par catégorie) : le titre ouvre la timeline du thème, la flèche replie.
        <div className={`section-head split${open ? '' : ' closed'}${active ? ' active' : ''}`}>
          <button className="label" onClick={onOpen}>
            {title}
          </button>
          <button className="chev" onClick={toggle} aria-expanded={open} aria-label={title}>
            <ChevronDown size={18} />
          </button>
        </div>
      ) : (
        <button className={`section-head${open ? '' : ' closed'}`} onClick={toggle} aria-expanded={open}>
          <span className="label">{title}</span>
          <ChevronDown size={18} />
        </button>
      )}
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

/** Rang d'une catégorie : ordre du catalogue, puis les catégories personnelles, « Autres » en dernier. */
function categoryOrder(c: string): number {
  return c ? catalog.categories.findIndex((x) => x.id === c) + 1 || 50 : 99
}

/** Groupe de sources d'une même catégorie, repliable, comme un dossier de Reeder. */
type SectionId = Extract<View, { type: 'category' }>['section']

/** Types de sources de chaque section de la barre latérale. */
const SECTION_KINDS: Record<SectionId, SourceKind[]> = {
  all: ['rss', 'podcast', 'youtube', 'mastodon', 'bluesky', 'x', 'reddit', 'forum'],
  feeds: ['rss'],
  podcasts: ['podcast'],
  youtube: ['youtube'],
  social: ['mastodon', 'bluesky', 'x'],
  reddit: ['reddit'],
  forums: ['forum']
}

function CategoryGroup({ section, kinds, category, label, icon, children }: {
  section: SectionId
  kinds: SourceKind[]
  category: string
  label: string
  icon?: ReactNode
  children: ReactNode
}): React.JSX.Element {
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
  const active = view.type === 'category' && view.category === category && view.section === section
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
        <button className="cat-label" onClick={() => setView({ type: 'category', category, kinds, section })}>
          {icon ?? <Folder size={14} />} {label}
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
  const updateSettings = useApp((s) => s.updateSettings)
  const tagKey = useKeyLabel('tags')
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

  const plainRows = (list: Source[], withKind = false): ReactNode =>
    list.map((s) => (
      <NavRow
        key={s.id}
        view={{ type: 'source', sourceId: s.id }}
        icon={<SourceIcon source={s} />}
        trail={withKind ? <KindIcon kind={s.kind} /> : undefined}
        label={s.title}
        badge={unread(s.id)}
        error={s.error}
        onContext={(e) => {
          e.preventDefault()
          setMenu({ source: s, x: e.clientX, y: e.clientY })
        }}
      />
    ))

  /** Ordre des sections en tri par type, et dans une catégorie (sous-groupes). */
const TYPE_SECTIONS = ['podcasts', 'youtube', 'social', 'reddit', 'forums', 'feeds'] as const

function KindIcon({ kind }: { kind: SourceKind }): React.JSX.Element {
  const size = 13
  if (kind === 'podcast') return <Headphones size={size} />
  if (kind === 'youtube') return <Tv size={size} />
  if (kind === 'reddit' || kind === 'forum') return <MessagesSquare size={size} />
  if (kind === 'mastodon' || kind === 'bluesky' || kind === 'x') return <AtSign size={size} />
  return <Rss size={size} />
}

/** Sources regroupées par catégorie dès qu'il y en a plusieurs ; sans catégorie : « Autres », en dernier. */
  const sourceRows = (list: Source[], section: SectionId, kinds: SourceKind[]): ReactNode => {
    const groups = new Map<string, Source[]>()
    for (const s of list) groups.set(s.category ?? '', [...(groups.get(s.category ?? '') ?? []), s])
    if (groups.size <= 1) return plainRows(list)
    return [...groups.entries()]
      .sort(([a], [b]) => categoryOrder(a) - categoryOrder(b) || a.localeCompare(b))
      .map(([cat, items]) => (
        <CategoryGroup key={cat || '_'} section={section} kinds={kinds} category={cat} label={cat ? categoryLabel(cat, lang) : t.otherCategory}>
          {plainRows(items)}
        </CategoryGroup>
      ))
  }

  const social = byKind(SECTION_KINDS.social)
  const reddit = byKind(SECTION_KINDS.reddit)
  const forums = byKind(SECTION_KINDS.forums)
  const feeds = byKind(SECTION_KINDS.feeds)
  const podcasts = byKind(SECTION_KINDS.podcasts)
  const videos = byKind(SECTION_KINDS.youtube)
  const tags = Object.entries(counts?.tags ?? {})
  const grouping = settings?.sidebarGroup ?? 'type'
  const sectionTitle: Record<(typeof TYPE_SECTIONS)[number], string> = {
    podcasts: t.podcasts,
    youtube: t.youtube,
    social: t.social,
    reddit: t.reddit,
    forums: t.forums,
    feeds: t.feeds
  }
  const lists: Record<(typeof TYPE_SECTIONS)[number], Source[]> = { podcasts, youtube: videos, social, reddit, forums, feeds }

  /** Tri par type : une section par type de média, des dossiers par catégorie dedans. */
  const byTypeSections = (): ReactNode =>
    TYPE_SECTIONS.filter((id) => lists[id].length > 0).map((id) => (
      <Section key={id} id={id} title={sectionTitle[id]}>
        {sourceRows(lists[id], id, SECTION_KINDS[id])}
      </Section>
    ))

  /**
   * Tri par catégorie : une section par thème, tous médias confondus (le pictogramme indique le type).
   * Au-delà de 10 sources, elles se rangent en sous-dossiers par type.
   */
  const byCategorySections = (): ReactNode => {
    const all = byKind(SECTION_KINDS.all)
    const groups = new Map<string, Source[]>()
    for (const s of all) groups.set(s.category ?? '', [...(groups.get(s.category ?? '') ?? []), s])
    return [...groups.entries()]
      .sort(([a], [b]) => categoryOrder(a) - categoryOrder(b) || a.localeCompare(b))
      .map(([cat, list]) => {
        const label = cat ? categoryLabel(cat, lang) : t.otherCategory
        const target: View = { type: 'category', category: cat, kinds: SECTION_KINDS.all, section: 'all' }
        const body =
          list.length <= 10
            ? plainRows(list, true)
            : TYPE_SECTIONS.map((id) => {
                const sub = list.filter((s) => SECTION_KINDS[id].includes(s.kind))
                return sub.length ? (
                  <CategoryGroup key={id} section={id} kinds={SECTION_KINDS[id]} category={cat} label={sectionTitle[id]} icon={<KindIcon kind={SECTION_KINDS[id][0]} />}>
                    {plainRows(sub)}
                  </CategoryGroup>
                ) : null
              })
        return (
          <Section key={cat || '_'} id={`cat:${cat}`} title={label} onOpen={() => setView(target)} active={sameView(target, view)}>
            {body}
          </Section>
        )
      })
  }

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
          {!tags.length && <div className="nav-hint">{t.tagsHint(tagKey)}</div>}
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

        {byKind(SECTION_KINDS.all).length > 0 && (
          <div className="group-switch" role="radiogroup" aria-label={t.sortSources}>
            <span>{t.sortSources}</span>
            <div className="segmented small">
              {(['type', 'category'] as const).map((g) => (
                <button key={g} role="radio" aria-checked={grouping === g} className={grouping === g ? 'on' : ''} onClick={() => void updateSettings({ sidebarGroup: g })}>
                  {g === 'type' ? t.groupByType : t.groupByCategory}
                </button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={grouping} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
            {grouping === 'category' ? byCategorySections() : byTypeSections()}
          </motion.div>
        </AnimatePresence>
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
