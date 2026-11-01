import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Atom, BookOpen, Check, Cpu, FolderOpen, Gamepad2, Globe, HeartPulse, Landmark, Scroll, TrendingUp, Trophy, Upload, X, Zap } from 'lucide-react'
import { catalog, type CatalogEntry } from '@shared/catalog'
import type { Lang, NewSource } from '@shared/types'
import { useApp, type SubscribeReport } from '../lib/store'
import { subscribeAll } from '../lib/subscribe'
import { dictionaries } from '../lib/i18n'
import Hemicycle, { LEAN_COLORS } from './Hemicycle'

const ICONS: Record<string, typeof Cpu> = {
  cpu: Cpu,
  landmark: Landmark,
  atom: Atom,
  'trending-up': TrendingUp,
  globe: Globe,
  scroll: Scroll,
  trophy: Trophy,
  'book-open': BookOpen,
  'heart-pulse': HeartPulse,
  'gamepad-2': Gamepad2
}

type Step = 'welcome' | 'language' | 'categories' | 'sources' | 'extras'

const slide = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 40 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -40 })
}

export default function Onboarding({ mode, onClose }: { mode: 'first' | 'catalog'; onClose(): void }): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const api = useApp((s) => s.api)
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useApp((s) => s.toast)
  const showReport = useApp((s) => s.showReport)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const loadItems = useApp((s) => s.loadItems)

  const steps: Step[] = mode === 'first' ? ['welcome', 'language', 'categories', 'sources', 'extras'] : ['categories', 'sources']
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const [lang, setLang] = useState<Lang>(settings.language ?? (navigator.language.startsWith('fr') ? 'fr' : 'en'))
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [vault, setVault] = useState(settings.obsidianVault)
  const t = dictionaries[lang]
  const step = steps[index]

  const entries = useMemo(() => catalog.entries.filter((e) => e.lang === lang && cats.has(e.category)), [lang, cats])

  const go = (delta: 1 | -1): void => {
    if (steps[index + delta] === 'sources') {
      // Pré-coche la sélection de départ des nouvelles catégories, sans écraser les choix déjà faits.
      setSelected((prev) => {
        const next = new Set(prev)
        for (const e of entries) if (e.preselected && !touched.has(e.id)) next.add(e.id)
        for (const id of prev) if (!entries.some((e) => e.id === id)) next.delete(id)
        return next
      })
    }
    setDir(delta)
    setIndex(index + delta)
  }

  const toggle = (id: string): void => {
    setTouched((s) => new Set(s).add(id))
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const subscribe = async (): Promise<SubscribeReport> => {
    const list: NewSource[] = entries
      .filter((e) => selected.has(e.id))
      .map((e) => ({ input: e.input, kind: e.kind, title: e.title, category: e.category, lang: e.lang, leaning: e.leaning, owner: e.owner }))
    setProgress({ done: 0, total: list.length })
    const report = await subscribeAll(api, list, (done) => setProgress({ done, total: list.length }))
    setProgress(null)
    return report
  }

  const finish = async (): Promise<void> => {
    let report: SubscribeReport
    if (mode === 'first') {
      await updateSettings({ language: lang })
      report = await subscribe()
      await updateSettings({ onboarded: true, obsidianVault: vault })
    } else {
      report = await subscribe()
      onClose()
    }
    await reloadMeta()
    await loadItems(true)
    // Échecs : un bilan qui reste affiché, avec le motif de chacun (un message éphémère passait inaperçu).
    if (report.failed.length) showReport(report)
    else if (report.added) toast(t.subscribedCount(report.added))
  }

  const canNext = step !== 'categories' || cats.size > 0
  const isLast = index === steps.length - 1

  const sourceOption = (e: CatalogEntry): React.JSX.Element => {
    const on = selected.has(e.id)
    return (
      <button key={e.id} className={`src-option${on ? ' on' : ''}`} onClick={() => toggle(e.id)} role="checkbox" aria-checked={on} title={e.title}>
        <span className={`checkbox${on ? ' on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
        {e.leaning !== undefined && <i className="lean-dot" style={{ background: LEAN_COLORS[e.leaning] }} />}
        <span className="t">{e.title}</span>
        {e.niche && <span className="niche">{t.niche}</span>}
        <span className="k">{t.kinds[e.kind]}</span>
      </button>
    )
  }

  return (
    <motion.div className="onboarding" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.3 }}>
      <div className="onb-drag drag" />
      {mode === 'catalog' && (
        <button className="round-btn" style={{ position: 'fixed', top: 18, right: 18, zIndex: 33 }} onClick={onClose} aria-label={t.close}>
          <X size={17} />
        </button>
      )}
      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={step}
          className={`onb-step${step === 'welcome' || step === 'language' ? ' center' : ''}`}
          custom={dir}
          variants={slide}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        >
          {step === 'welcome' && (
            <>
              <motion.div className="logo" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}>
                <Zap size={44} fill="currentColor" />
              </motion.div>
              <h1>{t.welcomeTitle}</h1>
              <p className="lead">{t.welcomeText}</p>
              <button className="btn primary" style={{ height: 46, padding: '0 26px', fontSize: 16 }} onClick={() => go(1)}>
                {t.start}
              </button>
            </>
          )}

          {step === 'language' && (
            <>
              <h2>{t.chooseLanguage}</h2>
              <p className="lead">{t.chooseLanguageHint}</p>
              <div className="lang-grid">
                {(
                  [
                    ['fr', '🇫🇷', 'Français', 'Médias francophones'],
                    ['en', '🇬🇧', 'English', 'English-language outlets']
                  ] as const
                ).map(([code, flag, name, sub]) => (
                  <button key={code} className={`choice${lang === code ? ' on' : ''}`} onClick={() => setLang(code)} aria-pressed={lang === code}>
                    <div className="flag">{flag}</div>
                    <div className="name">{name}</div>
                    <div className="sub">{sub}</div>
                    {lang === code && (
                      <motion.span className="check" layoutId="lang-check">
                        <Check size={14} strokeWidth={3} />
                      </motion.span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'categories' && (
            <>
              <h2>{t.chooseCategories}</h2>
              <p className="lead">{t.chooseCategoriesHint}</p>
              <div className="cat-grid">
                {catalog.categories.map((c, i) => {
                  const Icon = ICONS[c.icon] ?? Globe
                  const on = cats.has(c.id)
                  const count = catalog.entries.filter((e) => e.category === c.id && e.lang === lang).length
                  return (
                    <motion.button
                      key={c.id}
                      className={`choice${on ? ' on' : ''}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() =>
                        setCats((s) => {
                          const n = new Set(s)
                          if (n.has(c.id)) n.delete(c.id)
                          else n.add(c.id)
                          return n
                        })
                      }
                      aria-pressed={on}
                    >
                      <Icon size={26} className="cat-icon" />
                      <div className="name">{c[lang]}</div>
                      <div className="sub">{count} sources</div>
                      {on && (
                        <motion.span className="check" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                          <Check size={14} strokeWidth={3} />
                        </motion.span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            </>
          )}

          {step === 'sources' && (
            <>
              <h2>{t.chooseSources}</h2>
              <p className="lead">{t.chooseSourcesHint}</p>
              {catalog.categories
                .filter((c) => cats.has(c.id))
                .map((c) => {
                  const Icon = ICONS[c.icon] ?? Globe
                  const list = entries.filter((e) => e.category === c.id)
                  const political = list.filter((e) => e.leaning !== undefined)
                  const others = list.filter((e) => e.leaning === undefined)
                  return (
                    <section key={c.id} className="src-group">
                      <h3>
                        <Icon size={20} style={{ color: 'var(--accent)' }} /> {c[lang]}
                      </h3>
                      {political.length > 0 && <Hemicycle entries={political} selected={selected} onToggle={toggle} lang={lang} />}
                      <div className="src-grid">{(political.length ? [...political, ...others] : list).map(sourceOption)}</div>
                    </section>
                  )
                })}
            </>
          )}

          {step === 'extras' && (
            <>
              <h2>{t.finish}</h2>
              <p className="lead">{t.selected(selected.size)}</p>
              <div className="extras">
                <div className="extra-card">
                  {t.importHint}
                  <button
                    className="btn"
                    onClick={async () => {
                      const r = await api.importOpml()
                      if (r) toast(`OPML : +${r.added}${r.failed ? ` · ${t.errorsCount(r.failed)}` : ''}`, r.failed ? 'error' : 'ok')
                    }}
                  >
                    <Upload size={16} /> {t.importOpml}
                  </button>
                </div>
                <div className="extra-card">
                  {t.vaultHint}
                  <button
                    className="btn"
                    onClick={async () => {
                      const f = await api.chooseFolder()
                      if (f) setVault(f)
                    }}
                  >
                    <FolderOpen size={16} /> {vault ? vault.split(/[\\/]/).pop() : t.chooseVault}
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {step !== 'welcome' && (
        <div className="onb-footer">
          <button className="btn" onClick={() => (index === 0 ? onClose() : go(-1))} disabled={!!progress || (index === 0 && mode === 'first')}>
            {t.back}
          </button>
          <div className="progress" aria-hidden>
            {steps.map((s, i) => (
              <span key={s} className={i === index ? 'on' : ''} />
            ))}
          </div>
          <button className="btn primary" disabled={!canNext || !!progress} onClick={() => (isLast ? void finish() : go(1))}>
            {progress ? t.subscribing(progress.done, progress.total) : isLast ? t.finish : step === 'sources' ? `${t.next} · ${t.selected(selected.size)}` : t.next}
          </button>
        </div>
      )}
    </motion.div>
  )
}
