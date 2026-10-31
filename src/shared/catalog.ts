import raw from './catalog.json'
import type { Lang, SourceKind } from './types'

export interface CatalogCategory {
  id: string
  fr: string
  en: string
  icon: string
}

export interface CatalogEntry {
  id: string
  category: string
  lang: Lang
  kind: SourceKind
  title: string
  /** Entrée passée à la résolution de source : URL de flux, `r/sub`, `@compte@instance`, `@handle.bsky`… */
  input: string
  preselected: boolean
  /** Orientation politique indicative, de −3 (gauche radicale) à +3 (droite radicale). */
  leaning?: number
  /** Propriétaire connu lors de la constitution du catalogue (2025), à vérifier. */
  owner?: string
}

export const catalog = raw as { version: number; note: string; categories: CatalogCategory[]; entries: CatalogEntry[] }

export const LEANING_LABELS: Record<Lang, Record<number, string>> = {
  fr: {
    [-3]: 'Gauche radicale',
    [-2]: 'Gauche',
    [-1]: 'Centre gauche',
    0: 'Centre',
    1: 'Centre droit',
    2: 'Droite',
    3: 'Droite radicale'
  },
  en: {
    [-3]: 'Far left',
    [-2]: 'Left',
    [-1]: 'Lean left',
    0: 'Center',
    1: 'Lean right',
    2: 'Right',
    3: 'Far right'
  }
}
