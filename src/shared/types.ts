// Modèle de données partagé entre le processus principal, le preload et l'interface.
// Ce modèle est volontairement indépendant d'Electron : la future app native réutilisera la même base.

export type Lang = 'fr' | 'en'

export type SourceKind =
  | 'rss' // RSS / Atom / JSON Feed classique
  | 'reddit'
  | 'mastodon'
  | 'bluesky'
  | 'forum' // Discourse, Lemmy, phpBB, Hacker News…
  | 'x' // via une passerelle RSS fournie par l'utilisateur
  | 'youtube' // emplacement prévu
  | 'podcast' // emplacement prévu
  | 'links' // articles enregistrés à la main
  | 'book' // bibliothèque : EPUB et PDF importés

export interface Source {
  id: string
  kind: SourceKind
  title: string
  /** Adresse du flux (ou pseudo-adresse `learn:links` pour les liens enregistrés). */
  url: string
  siteUrl?: string
  /** Icône mise en cache sous forme de data URL, pour ne pas dépendre d'un service tiers. */
  icon?: string
  category?: string
  lang?: Lang
  createdAt: number
  lastFetchedAt?: number
  error?: string
  /** Orientation politique indicative héritée du catalogue (−3 … +3). */
  leaning?: number
  /** Propriétaire du média, tel que connu lors de la constitution du catalogue. */
  owner?: string
}

export type BookFormat = 'epub' | 'pdf'

export interface TocEntry {
  title: string
  /** Index du chapitre (EPUB) ou numéro de page à partir de 0 (PDF). */
  chapter: number
  anchor?: string
  depth: number
}

export interface Item {
  id: string
  sourceId: string
  guid: string
  url?: string
  title: string
  author?: string
  /** Texte brut court, pour la carte de la liste. */
  summary?: string
  /** HTML du flux (non nettoyé : l'interface le passe dans DOMPurify avant affichage). */
  contentHtml?: string
  /** HTML extrait de la page complète (mode lecture). */
  fullHtml?: string
  imageUrl?: string
  publishedAt: number
  fetchedAt: number
  read: boolean
  later: boolean
  bookmarked: boolean
  favorite: boolean
  tags: string[]
  highlightCount?: number
  /** Livres uniquement. */
  format?: BookFormat
  /** Position de lecture, ex. `{"chapter":3,"scroll":0.42}` (EPUB) ou `{"page":12}` (PDF). */
  position?: string
  /** Avancement de 0 à 1. */
  progress?: number
  readAt?: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/**
 * Surlignage ancré sur le texte de l'article.
 * Deux repères, comme dans le modèle W3C Web Annotation :
 * - position (start/end) dans le texte brut du contenu affiché ;
 * - citation exacte avec contexte (prefix/suffix), pour se réancrer si le contenu bouge.
 */
export interface Highlight {
  id: string
  itemId: string
  color: HighlightColor
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
  /** Note en Markdown. */
  note: string
  /**
   * Contenu sur lequel le surlignage a été posé : `feed` (texte du flux), `full` (texte complet),
   * `ch:<n>` (chapitre d'un EPUB) ou `p:<n>` (page d'un PDF, à partir de 0).
   */
  layer: string
  createdAt: number
  updatedAt: number
}

export type View =
  | { type: 'home' }
  | { type: 'later' }
  | { type: 'bookmarks' }
  | { type: 'favorites' }
  | { type: 'links' }
  | { type: 'library' }
  | { type: 'highlights' }
  | { type: 'tag'; tag: string }
  | { type: 'kind'; kind: SourceKind }
  | { type: 'source'; sourceId: string }

export interface ItemQuery {
  view: View
  search?: string
  unreadOnly?: boolean
  limit?: number
  offset?: number
}

export interface Counts {
  later: number
  bookmarks: number
  favorites: number
  links: number
  library: number
  highlights: number
  tags: Record<string, number>
  unreadBySource: Record<string, number>
  unreadTotal: number
}

export type Theme = 'system' | 'dark' | 'light'

export interface Settings {
  onboarded: boolean
  language: Lang
  theme: Theme
  /** Le nouveau Reeder n'affiche pas de compteurs de non-lus : désactivé par défaut. */
  showUnread: boolean
  refreshMinutes: number
  readerFont: 'sans' | 'serif'
  readerSize: number
  obsidianVault?: string
  obsidianFolder: string
  /** Synchronisation automatique dans les deux sens avec le coffre Obsidian. */
  obsidianSync?: boolean
  /** Modèle d'adresse pour X, ex. `https://rsshub.mondomaine.fr/twitter/user/{user}`. */
  xBridge?: string
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  language: 'fr',
  theme: 'system',
  showUnread: false,
  refreshMinutes: 30,
  readerFont: 'sans',
  readerSize: 18,
  obsidianFolder: 'Learn'
}

export interface NewSource {
  input: string
  kind?: SourceKind
  title?: string
  category?: string
  lang?: Lang
  leaning?: number
  owner?: string
}

export interface BalanceEntry {
  sourceId: string
  title: string
  leaning: number
  owner?: string
  reads: number
}

export interface ReadingBalance {
  days: number
  entries: BalanceEntry[]
  /** Articles lus dans des sources sans orientation (hors politique). */
  otherReads: number
}

export interface ResolvedInput {
  kind: SourceKind
  url: string
  title?: string
  siteUrl?: string
}

export interface RefreshResult {
  sources: number
  newItems: number
  errors: { sourceId: string; title: string; error: string }[]
}

export interface ExportResult {
  path: string
}

export type LearnEvent =
  | { type: 'refresh-started' }
  | { type: 'refresh-finished'; result: RefreshResult }
  | { type: 'items-changed' }
  | { type: 'highlights-changed'; itemId: string; message?: string }
  | { type: 'menu'; action: 'add-source' | 'settings' | 'refresh' }

/** API exposée à l'interface par le preload (window.learn). Toutes les méthodes passent par IPC. */
export interface LearnAPI {
  platform: string
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  listSources(): Promise<Source[]>
  resolveInput(input: string): Promise<ResolvedInput>
  addSource(source: NewSource): Promise<Source>
  addSources(sources: NewSource[]): Promise<{ added: Source[]; failed: { input: string; error: string }[] }>
  updateSource(id: string, patch: Partial<Pick<Source, 'title' | 'category'>>): Promise<Source>
  removeSource(id: string): Promise<void>

  listItems(query: ItemQuery): Promise<Item[]>
  getItem(id: string): Promise<Item | null>
  updateItem(id: string, patch: Partial<Pick<Item, 'read' | 'later' | 'bookmarked' | 'favorite' | 'tags'>>): Promise<Item>
  markAllRead(view: View): Promise<void>
  extractFullText(id: string): Promise<Item>
  saveLink(url: string): Promise<Item>
  counts(): Promise<Counts>
  allTags(): Promise<string[]>

  listHighlights(itemId?: string): Promise<Highlight[]>
  addHighlight(h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>): Promise<Highlight>
  updateHighlight(id: string, patch: Partial<Pick<Highlight, 'color' | 'note'>>): Promise<Highlight>
  removeHighlight(id: string): Promise<void>

  refresh(sourceId?: string): Promise<RefreshResult>

  /** Ouvre le sélecteur de fichiers (paths absent) ou importe les fichiers donnés. */
  importBooks(paths?: string[]): Promise<{ added: Item[]; failed: { file: string; error: string }[] }>
  /** Chemin d'un fichier déposé par glisser-déposer (Electron uniquement). */
  pathForFile?(file: File): string
  bookToc(itemId: string): Promise<TocEntry[]>
  bookChapter(itemId: string, index: number): Promise<{ html: string; title?: string; count: number }>
  readBookFile(itemId: string): Promise<Uint8Array>
  savePosition(itemId: string, position: string, progress: number): Promise<void>
  updateBook(itemId: string, patch: Partial<Pick<Item, 'title' | 'author' | 'imageUrl'>>): Promise<Item>
  readingBalance(days: number): Promise<ReadingBalance>

  chooseFolder(): Promise<string | null>
  exportToObsidian(itemId: string): Promise<ExportResult>
  exportAllToObsidian(): Promise<{ count: number; folder: string }>
  markdownFor(itemId: string): Promise<string>
  importOpml(): Promise<{ added: number; failed: number } | null>
  exportOpml(): Promise<string | null>
  openExternal(url: string): Promise<void>

  onEvent(cb: (e: LearnEvent) => void): () => void
}

/** Liste des méthodes invoquables, partagée par le preload et le processus principal. */
export const API_METHODS = [
  'getSettings',
  'updateSettings',
  'listSources',
  'resolveInput',
  'addSource',
  'addSources',
  'updateSource',
  'removeSource',
  'listItems',
  'getItem',
  'updateItem',
  'markAllRead',
  'extractFullText',
  'saveLink',
  'counts',
  'allTags',
  'listHighlights',
  'addHighlight',
  'updateHighlight',
  'removeHighlight',
  'refresh',
  'importBooks',
  'bookToc',
  'bookChapter',
  'readBookFile',
  'savePosition',
  'updateBook',
  'readingBalance',
  'chooseFolder',
  'exportToObsidian',
  'exportAllToObsidian',
  'markdownFor',
  'importOpml',
  'exportOpml',
  'openExternal'
] as const satisfies readonly Exclude<keyof LearnAPI, 'platform' | 'onEvent' | 'pathForFile'>[]

export type ApiMethod = (typeof API_METHODS)[number]
