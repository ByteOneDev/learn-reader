import type { CatalogCategory, CatalogEntry } from './catalog'
import type { Lang, Source } from './types'

/** Catégories où l'orientation politique compte : on y propose de quoi rééquilibrer l'hémicycle. */
const POLITICAL = new Set(['politique', 'geopolitique'])

export interface SuggestionGroup {
  category: string
  /** Vrai si l'utilisateur a déjà des abonnements dans cette catégorie. */
  followed: boolean
  entries: CatalogEntry[]
}

/** Minuscules, sans accents ni ponctuation : « Le Monde — Santé » → « lemondesante ». */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Adresse comparable : sans protocole, « www. », ni barre finale. */
function urlKey(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/** Une source du catalogue est-elle déjà suivie ? Par adresse, subreddit, compte YouTube ou titre. */
export function isSubscribed(entry: CatalogEntry, sources: Source[]): boolean {
  const key = urlKey(entry.input)
  const title = normalize(entry.title)
  const sub = /^(?:https?:\/\/(?:www\.)?reddit\.com\/)?r\/([\w-]+)/i.exec(entry.input)?.[1]?.toLowerCase()
  const handle = /youtube\.com\/(@[\w.-]+)/i.exec(entry.input)?.[1]?.toLowerCase() ?? (/^@[\w.-]+$/.test(entry.input) ? entry.input.toLowerCase() : undefined)
  return sources.some((s) => {
    if (urlKey(s.url) === key || (s.siteUrl && urlKey(s.siteUrl) === key)) return true
    if (title && normalize(s.title) === title) return true
    if (sub && s.kind === 'reddit' && new RegExp(`/r/${sub}(?:[/.]|$)`, 'i').test(s.url)) return true
    if (handle && s.kind === 'youtube' && `${s.siteUrl ?? ''} ${s.url}`.toLowerCase().includes(handle)) return true
    return false
  })
}

/** Alterne les types (site, vidéo, podcast, forum…) pour éviter cinq chaînes YouTube d'affilée. */
function interleaveKinds(list: CatalogEntry[]): CatalogEntry[] {
  const buckets = new Map<string, CatalogEntry[]>()
  for (const e of list) buckets.set(e.kind, [...(buckets.get(e.kind) ?? []), e])
  const queues = [...buckets.values()]
  const out: CatalogEntry[] = []
  for (let i = 0; out.length < list.length; i++) for (const q of queues) if (q[i]) out.push(q[i])
  return out
}

/** Nombre de sources suivies par orientation (−3 … +3), toutes catégories confondues. */
function leaningCounts(sources: Source[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const s of sources) if (s.leaning !== undefined) m.set(s.leaning, (m.get(s.leaning) ?? 0) + 1)
  return m
}

function rank(list: CatalogEntry[], category: string, lang: Lang, sources: Source[]): CatalogEntry[] {
  const leanings = POLITICAL.has(category) ? leaningCounts(sources) : null
  const sorted = [...list].sort(
    (a, b) =>
      Number(b.lang === lang) - Number(a.lang === lang) ||
      // Politique : d'abord les orientations les moins représentées dans ce que tu lis déjà.
      (leanings ? (leanings.get(a.leaning ?? 99) ?? 0) - (leanings.get(b.leaning ?? 99) ?? 0) : 0) ||
      Number(b.preselected) - Number(a.preselected)
  )
  // Langue d'abord, puis alternance des types à l'intérieur de chaque langue.
  const mine = sorted.filter((e) => e.lang === lang)
  const others = sorted.filter((e) => e.lang !== lang)
  return leanings ? [...mine, ...others] : [...interleaveKinds(mine), ...interleaveKinds(others)]
}

/**
 * Sources conseillées dans la fenêtre d'ajout : pour chaque catégorie suivie (la plus suivie d'abord),
 * des sources du catalogue pas encore abonnées. Les autres catégories suivent, marquées `followed: false`.
 * Sans aucun abonnement, toutes les catégories sont proposées avec leurs incontournables.
 */
export function suggestSources(opts: {
  categories: CatalogCategory[]
  entries: CatalogEntry[]
  sources: Source[]
  lang: Lang
  perCategory?: number
}): SuggestionGroup[] {
  const { categories, entries, lang, perCategory = 5 } = opts
  const sources = opts.sources.filter((s) => s.kind !== 'book' && s.url !== 'learn:links')
  const counts = new Map<string, number>()
  for (const s of sources) if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  const order = categories.map((c) => c.id)
  return order
    .map((category) => {
      const free = entries.filter((e) => e.category === category && !isSubscribed(e, sources))
      return { category, followed: counts.has(category), entries: rank(free, category, lang, sources).slice(0, perCategory) }
    })
    .filter((g) => g.entries.length)
    .sort((a, b) => (counts.get(b.category) ?? 0) - (counts.get(a.category) ?? 0) || order.indexOf(a.category) - order.indexOf(b.category))
}

/** Recherche dans le catalogue pendant la frappe : titre ou nom de catégorie, sources pas encore suivies. */
export function searchCatalog(opts: { query: string; categories: CatalogCategory[]; entries: CatalogEntry[]; sources: Source[]; lang: Lang; limit?: number }): CatalogEntry[] {
  const q = normalize(opts.query)
  if (q.length < 2) return []
  const cats = new Set(opts.categories.filter((c) => normalize(c.fr).includes(q) || normalize(c.en).includes(q) || c.id.includes(q)).map((c) => c.id))
  const hits = opts.entries.filter((e) => (normalize(e.title).includes(q) || cats.has(e.category)) && !isSubscribed(e, opts.sources))
  return hits
    .sort(
      (a, b) =>
        Number(normalize(b.title).startsWith(q)) - Number(normalize(a.title).startsWith(q)) ||
        Number(normalize(b.title).includes(q)) - Number(normalize(a.title).includes(q)) ||
        Number(b.lang === opts.lang) - Number(a.lang === opts.lang) ||
        Number(b.preselected) - Number(a.preselected)
    )
    .slice(0, opts.limit ?? 8)
}
