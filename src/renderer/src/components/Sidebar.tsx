import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  Headphones,
  Heart,
  Highlighter,
  Layers,
  Link2,
  Network,
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
      {!!badge && <span className="badge">{badge}</span>}
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

export default function Sidebar(): React.JSX.Element {
  const t = useT()
  const sources = useApp((s) => s.sources)
  const counts = useApp((s) => s.counts)
  const view = useApp((s) => s.view)
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const setDialog = useApp((s) => s.setDialog)
  const api = useApp((s) => s.api)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const toast = useApp((s) => s.toast)
  const [menu, setMenu] = useState<{ source: Source; x: number; y: number } | null>(null)

  const unread = (id: string): number | undefined => (settings?.showUnread ? counts?.unreadBySource[id] : undefined)
  const byKind = (kinds: SourceKind[]): Source[] => sources.filter((s) => kinds.includes(s.kind))

  const sourceRows = (list: Source[]): ReactNode =>
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

  const social = byKind(['mastodon', 'bluesky', 'x'])
  const reddit = byKind(['reddit'])
  const forums = byKind(['forum'])
  const feeds = byKind(['rss', 'youtube', 'podcast'])
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
        <NavRow icon={<Headphones size={19} />} label={t.audio} disabled soon={t.soon} />
        <NavRow icon={<Tv size={19} />} label={t.video} disabled soon={t.soon} />
        <NavRow view={{ type: 'library' }} icon={<BookOpen size={19} />} label={t.library} badge={counts?.library} />
        <NavRow icon={<Network size={19} />} label={t.boards} disabled soon={t.soon} />

        <Section id="saved" title={t.saved}>
          <NavRow view={{ type: 'links' }} icon={<Link2 size={19} />} label={t.links} badge={counts?.links} />
          <NavRow view={{ type: 'later' }} icon={<Layers size={19} />} label={t.later} badge={counts?.later} />
          <NavRow view={{ type: 'bookmarks' }} icon={<Bookmark size={19} />} label={t.bookmarks} badge={counts?.bookmarks} />
          <NavRow view={{ type: 'favorites' }} icon={<Heart size={19} />} label={t.favorites} badge={counts?.favorites} />
          <NavRow view={{ type: 'highlights' }} icon={<Highlighter size={19} />} label={t.highlights} badge={counts?.highlights} />
          {tags.map(([tag, n]) => (
            <NavRow key={tag} view={{ type: 'tag', tag }} icon={<Tag size={19} />} label={tag} badge={n} />
          ))}
          <button className="nav-row" onClick={() => setDialog('balance')}>
            <Scale size={19} />
            <span className="label">{t.balanceNav}</span>
          </button>
        </Section>

        {social.length > 0 && (
          <Section id="social" title={t.social}>
            {sourceRows(social)}
          </Section>
        )}
        {reddit.length > 0 && (
          <Section id="reddit" title={t.reddit}>
            {sourceRows(reddit)}
          </Section>
        )}
        {forums.length > 0 && (
          <Section id="forums" title={t.forums}>
            {sourceRows(forums)}
          </Section>
        )}
        {feeds.length > 0 && (
          <Section id="feeds" title={t.feeds}>
            {sourceRows(feeds)}
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
      </AnimatePresence>
    </aside>
  )
}
