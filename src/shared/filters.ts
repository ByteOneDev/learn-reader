// Filtres d'articles : par source (garder seulement / masquer ce qui contient certains mots, Shorts YouTube)
// et globaux (mots masqués partout). Un article filtré est masqué, jamais supprimé : on peut le réafficher.

export type FilterField = 'title' | 'categories' | 'author' | 'summary'

export interface SourceFilter {
  /** hide : masquer ce qui correspond ; keep : ne garder que ce qui correspond. */
  mode: 'hide' | 'keep'
  terms: string[]
  fields: FilterField[]
  /** YouTube : masquer les Shorts. */
  hideShorts?: boolean
}

export interface FilterableItem {
  title: string
  author?: string
  summary?: string
  categories?: string[]
  short?: boolean
}

export const DEFAULT_FILTER: SourceFilter = { mode: 'hide', terms: [], fields: ['title', 'categories'] }

/** Minuscules, sans accents : « Échecs » et « echecs » se valent. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Le terme apparaît-il comme mot (ou groupe de mots) dans le texte ? « art » ne trouve pas « article ». */
export function containsTerm(text: string, term: string): boolean {
  const t = normalize(term.trim())
  if (!t) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, 'u').test(normalize(text))
}

function fieldText(item: FilterableItem, field: FilterField): string {
  if (field === 'categories') return (item.categories ?? []).join(' | ')
  return item[field] ?? ''
}

/** L'article passe-t-il les filtres ? (false = masqué) */
export function itemPasses(item: FilterableItem, filter: SourceFilter | null | undefined, globalTerms: string[] = []): boolean {
  if (globalTerms.some((term) => containsTerm(item.title, term) || containsTerm(item.summary ?? '', term))) return false
  if (!filter) return true
  if (filter.hideShorts && item.short) return false
  const terms = filter.terms.filter((t) => t.trim())
  if (!terms.length) return true
  const fields = filter.fields.length ? filter.fields : DEFAULT_FILTER.fields
  const match = terms.some((term) => fields.some((f) => containsTerm(fieldText(item, f), term)))
  return filter.mode === 'keep' ? match : !match
}

/** Le filtre fait-il quelque chose ? (sinon on l'efface) */
export function filterIsActive(f: SourceFilter | null | undefined): f is SourceFilter {
  return !!f && (!!f.hideShorts || f.terms.some((t) => t.trim()))
}

/** Une vidéo YouTube est-elle un Short ? Le flux pointe alors vers /shorts/, ou le titre l'annonce. */
export function looksLikeShort(url: string | undefined, title: string): boolean {
  return !!url?.includes('/shorts/') || /#shorts?\b/i.test(title)
}
