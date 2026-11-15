import { useMemo, useState } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { catalog, type CatalogEntry } from '@shared/catalog'
import { searchCatalog, suggestSources } from '@shared/suggest'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import { LEAN_COLORS } from '../onboarding/Hemicycle'
import { categoryLabel } from './Sidebar'
import KindIcon from './KindIcon'

type RowState = 'adding' | 'added' | { error: string }

/**
 * Fenêtre d'ajout › Flux : sources conseillées d'après les catégories déjà suivies (champ vide),
 * ou sources du catalogue qui correspondent à ce qui est tapé. Abonnement en un clic, fenêtre ouverte.
 */
export default function SuggestedSources({ query }: { query: string }): React.JSX.Element | null {
  const t = useT()
  const api = useApp((s) => s.api)
  const lang = useApp((s) => s.settings?.language ?? 'fr')
  const reloadMeta = useApp((s) => s.reloadMeta)
  const toast = useApp((s) => s.toast)
  // Photo des abonnements à l'ouverture : une source ajoutée reste affichée (cochée) au lieu de disparaître.
  const [sources] = useState(() => useApp.getState().sources)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [more, setMore] = useState(false)

  const groups = useMemo(() => suggestSources({ categories: catalog.categories, entries: catalog.entries, sources, lang }), [sources, lang])
  const matches = useMemo(() => searchCatalog({ query, categories: catalog.categories, entries: catalog.entries, sources, lang }), [query, sources, lang])

  const add = async (e: CatalogEntry): Promise<void> => {
    if (rows[e.id] === 'adding' || rows[e.id] === 'added') return
    setRows((r) => ({ ...r, [e.id]: 'adding' }))
    try {
      await api.addSource({ input: e.input, kind: e.kind, title: e.title, category: e.category, lang: e.lang, leaning: e.leaning, owner: e.owner })
      setRows((r) => ({ ...r, [e.id]: 'added' }))
      toast(`${t.add} : ${e.title}`)
      void reloadMeta()
    } catch (err) {
      setRows((r) => ({ ...r, [e.id]: { error: (err as Error).message } }))
    }
  }

  const row = (e: CatalogEntry): React.JSX.Element => {
    const state = rows[e.id]
    return (
      <div key={e.id} className="suggest-row">
        <span className="suggest-kind" title={t.kinds[e.kind]}>
          <KindIcon kind={e.kind} />
        </span>
        <span className="suggest-text">
          <span className="t">
            {e.title}
            {e.leaning !== undefined && <i className="lean-dot" style={{ background: LEAN_COLORS[e.leaning] }} />}
          </span>
          {typeof state === 'object' ? <span className="error-text">{state.error}</span> : <span className="a">{t.kinds[e.kind]}{e.lang !== lang ? ` · ${e.lang.toUpperCase()}` : ''}</span>}
        </span>
        <button
          type="button"
          className={`suggest-add${state === 'added' ? ' done' : ''}`}
          disabled={state === 'adding' || state === 'added'}
          onClick={() => void add(e)}
          aria-label={`${t.add} ${e.title}`}
          title={state === 'added' ? t.suggestAdded : t.add}
        >
          {state === 'added' ? <Check size={15} /> : state === 'adding' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
        </button>
      </div>
    )
  }

  if (query.trim()) {
    if (!matches.length) return null
    return (
      <div className="suggest">
        <div className="suggest-head">{t.suggestFromCatalog}</div>
        <div className="suggest-scroll short">
          <div className="suggest-list">{matches.map(row)}</div>
        </div>
      </div>
    )
  }

  const followed = groups.filter((g) => g.followed)
  const others = groups.filter((g) => !g.followed)
  // Aucun abonnement (ou tout le catalogue de tes catégories déjà suivi) : on montre directement le reste.
  const shown = followed.length ? (more ? [...followed, ...others] : followed) : others
  if (!shown.length) return <p className="hint suggest-empty">{t.suggestNone}</p>
  return (
    <div className="suggest">
      <div className="suggest-head">{followed.length ? t.suggestForYou : t.suggestStart}</div>
      <div className="suggest-scroll">
        {shown.map((g) => (
          <div key={g.category} className="suggest-group">
            <div className="suggest-cat">{categoryLabel(g.category, lang)}</div>
            <div className="suggest-list">{g.entries.map(row)}</div>
          </div>
        ))}
        {followed.length > 0 && others.length > 0 && !more && (
          <button type="button" className="suggest-more" onClick={() => setMore(true)}>
            {t.suggestMore}
          </button>
        )}
      </div>
    </div>
  )
}
