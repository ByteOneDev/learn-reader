import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, relative, sep } from 'node:path'
import type { Board, BoardMode, BookFormat, Cue, Highlight, Item, LearnEvent, NewBoardNode, NewSource, RefreshResult, ResolvedInput, Source, TocEntry } from '@shared/types'
import { findRoot, layoutMindmap, nodeHeight, NODE_WIDTH } from '@shared/boardLayout'
import { hostOf, uid } from '@shared/util'
import { fetchArticle } from './article'
import { Epub } from './books/epub'
import type { Store, SyncBase } from './db'
import { buildMarkdown, mergeWithExisting, safeFileName } from './export/markdown'
import { boardOutline, buildCanvas } from './export/canvas'
import { fetchFeed, fetchIcon, fetchText, HttpError, type FetchFn } from './feeds/fetcher'
import { parseTranscript } from './media/transcript'
import { pickPodcast, searchPodcasts, type PodcastResult } from './feeds/podcastSearch'
import { formatTime, timeLink } from '@shared/media'
import { resolveInput } from './feeds/resolve'
import { buildOpml, parseOpml } from './opml'

export const LINKS_SOURCE_URL = 'learn:links'
export const LIBRARY_SOURCE_URL = 'learn:library'
const MAX_BOOK_BYTES = 500 * 1024 * 1024
const MAX_ITEMS_PER_FETCH = 200
const CONCURRENCY = 6
const PRUNE_AFTER_MS = 60 * 24 * 3600 * 1000

/**
 * Logique métier de Learn, sans dépendance à Electron : testable avec Node seul,
 * et réutilisable telle quelle par un autre hôte (serveur de synchro, CLI…).
 */
export class LearnCore {
  private refreshing: Promise<RefreshResult> | null = null
  private epubs = new Map<string, Epub>()

  constructor(
    readonly store: Store,
    private fetchFn: FetchFn,
    private emit: (e: LearnEvent) => void = () => {},
    /** Dossier où sont copiés les livres importés. */
    private libraryDir = ''
  ) {}

  // ── Sources ───────────────────────────────────────────────────────────────

  resolve(input: string): ResolvedInput {
    return resolveInput(input, { xBridge: this.store.getSettings().xBridge })
  }

  async addSource(n: NewSource): Promise<Source> {
    const resolved = this.resolve(n.input)
    // Le catalogue peut préciser le type (ex. un forum servi en Atom classique).
    if (n.kind && resolved.kind === 'rss') resolved.kind = n.kind
    const existing = this.store.findSourceByUrl(resolved.url)
    if (existing) {
      // Abonnement déjà présent (ex. import OPML) : on complète l'orientation venue du catalogue.
      if (n.leaning !== undefined && existing.leaning === undefined) return this.store.updateSource(existing.id, { leaning: n.leaning, owner: n.owner })
      return existing
    }

    if (resolved.url.startsWith('podcast:')) {
      const name = resolved.url.slice(8)
      const found = pickPodcast(await searchPodcasts(this.fetchFn, name), name)
      if (!found) throw new Error(`Podcast introuvable : ${name}`)
      resolved.url = found.feedUrl
      const known = this.store.findSourceByUrl(found.feedUrl)
      if (known) return known
    }
    let fetched: Awaited<ReturnType<typeof fetchFeed>>
    try {
      fetched = await fetchFeed(this.fetchFn, resolved.url)
    } catch (e) {
      // Limite de débit (Reddit surtout) : on s'abonne quand même, les articles viendront à la prochaine actualisation.
      if (e instanceof HttpError && e.status === 429 && resolved.kind !== 'rss') {
        const source = this.store.insertSource({
          id: uid('s_'),
          kind: resolved.kind,
          title: n.title ?? resolved.title ?? resolved.url,
          url: resolved.url,
          siteUrl: resolved.siteUrl,
          category: n.category,
          lang: n.lang,
          leaning: n.leaning,
          owner: n.owner,
          createdAt: Date.now(),
          error: 'Limite de requêtes atteinte : nouvel essai à la prochaine actualisation'
        })
        this.emit({ type: 'items-changed' })
        return source
      }
      throw e
    }
    const { feed, feedUrl } = fetched
    // Le contenu du flux tranche : podcast, chaîne YouTube (aussi quand on a collé l'adresse d'une page).
    if (feed.youtube) resolved.kind = 'youtube'
    else if (feed.podcast && (resolved.kind === 'rss' || resolved.kind === 'podcast')) resolved.kind = 'podcast'
    const again = feedUrl !== resolved.url ? this.store.findSourceByUrl(feedUrl) : undefined
    if (again) return again

    const siteUrl = resolved.siteUrl ?? feed.siteUrl
    const source = this.store.insertSource({
      id: uid('s_'),
      kind: resolved.kind,
      title: n.title ?? (['rss', 'forum', 'podcast', 'youtube'].includes(resolved.kind) ? feed.title : resolved.title ?? feed.title),
      url: feedUrl,
      siteUrl,
      category: n.category,
      lang: n.lang,
      leaning: n.leaning,
      owner: n.owner,
      createdAt: Date.now(),
      lastFetchedAt: Date.now()
    })
    this.storeItems(source, feed.items)
    void this.loadIcon(source, feed.iconUrl)
    this.emit({ type: 'items-changed' })
    return source
  }

  async addSources(list: NewSource[]): Promise<{ added: Source[]; failed: { input: string; error: string }[] }> {
    const added: Source[] = []
    const failed: { input: string; error: string }[] = []
    await pool(list, CONCURRENCY, async (n) => {
      try {
        added.push(await this.addSource(n))
      } catch (e) {
        failed.push({ input: n.title ?? n.input, error: (e as Error).message })
      }
    })
    return { added, failed }
  }

  private async loadIcon(source: Source, hint?: string): Promise<void> {
    const site = source.siteUrl ?? (source.url.startsWith('http') ? new URL(source.url).origin : undefined)
    if (!site) return
    try {
      const icon = await fetchIcon(this.fetchFn, site, hint)
      if (icon) {
        this.store.updateSource(source.id, { icon })
        this.emit({ type: 'items-changed' })
      }
    } catch {
      /* l'interface affiche une initiale à la place */
    }
  }

  private storeItems(source: Source, items: Awaited<ReturnType<typeof fetchFeed>>['feed']['items']): number {
    const now = Date.now()
    return this.store.insertItems(
      items.slice(0, MAX_ITEMS_PER_FETCH).map((p, i) => ({
        id: uid('i_'),
        sourceId: source.id,
        guid: p.guid,
        url: p.url,
        title: p.title,
        author: p.author,
        summary: p.summary,
        contentHtml: p.contentHtml,
        imageUrl: p.imageUrl,
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
        duration: p.duration,
        transcriptUrl: p.transcriptUrl,
        // Sans date, on garde l'ordre du flux.
        publishedAt: Math.min(p.publishedAt ?? now - i * 1000, now),
        fetchedAt: now
      }))
    )
  }

  // ── Actualisation ─────────────────────────────────────────────────────────

  refresh(sourceId?: string): Promise<RefreshResult> {
    if (this.refreshing && !sourceId) return this.refreshing
    const run = this.doRefresh(sourceId).finally(() => {
      if (!sourceId) this.refreshing = null
    })
    if (!sourceId) this.refreshing = run
    return run
  }

  private async doRefresh(sourceId?: string): Promise<RefreshResult> {
    this.emit({ type: 'refresh-started' })
    const sources = this.store.listSources().filter((s) => s.kind !== 'links' && (!sourceId || s.id === sourceId))
    const result: RefreshResult = { sources: sources.length, newItems: 0, errors: [] }
    await pool(sources, CONCURRENCY, async (s) => {
      try {
        const { feed } = await fetchFeed(this.fetchFn, s.url)
        result.newItems += this.storeItems(s, feed.items)
        this.store.updateSource(s.id, { lastFetchedAt: Date.now(), error: undefined })
        if (!s.icon) void this.loadIcon(s, feed.iconUrl)
      } catch (e) {
        const error = (e as Error).message
        this.store.updateSource(s.id, { lastFetchedAt: Date.now(), error })
        result.errors.push({ sourceId: s.id, title: s.title, error })
      }
    })
    if (!sourceId) this.store.prune(Date.now() - PRUNE_AFTER_MS)
    this.emit({ type: 'refresh-finished', result })
    this.emit({ type: 'items-changed' })
    return result
  }

  // ── Articles ──────────────────────────────────────────────────────────────

  async extractFullText(id: string): Promise<Item> {
    const item = this.store.getItem(id)
    if (!item?.url) throw new Error('Cet article n’a pas d’adresse web')
    const ex = await fetchArticle(this.fetchFn, item.url)
    return this.store.updateItem(id, { fullHtml: ex.contentHtml, imageUrl: item.imageUrl ?? ex.imageUrl, author: item.author ?? ex.byline })
  }

  private linksSource(): Source {
    return (
      this.store.findSourceByUrl(LINKS_SOURCE_URL) ??
      this.store.insertSource({ id: uid('s_'), kind: 'links', title: 'Liens enregistrés', url: LINKS_SOURCE_URL, createdAt: Date.now() })
    )
  }

  /** Enregistre une page web pour la lire plus tard (section « Liens »). */
  async saveLink(url: string): Promise<Item> {
    const normalized = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).href
    const source = this.linksSource()
    const ex = await fetchArticle(this.fetchFn, normalized)
    const id = uid('i_')
    const now = Date.now()
    this.store.insertItems([
      {
        id,
        sourceId: source.id,
        guid: normalized,
        url: normalized,
        title: ex.title || hostOf(normalized),
        author: ex.byline,
        summary: ex.excerpt,
        contentHtml: ex.contentHtml,
        imageUrl: ex.imageUrl,
        publishedAt: now,
        fetchedAt: now
      }
    ])
    const item = this.store.listItems({ view: { type: 'links' }, limit: 500 }).find((i) => i.guid === normalized)
    if (!item) throw new Error('Lien déjà enregistré')
    const saved = this.store.updateItem(item.id, { later: true })
    this.emit({ type: 'items-changed' })
    return saved
  }

  removeSource(id: string): void {
    const source = this.store.getSource(id)
    if (!source) return
    this.store.removeSource(id, source.kind === 'links' || source.kind === 'book' ? undefined : this.linksSource().id)
    this.emit({ type: 'items-changed' })
  }

  addHighlight(h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>): Highlight {
    const now = Date.now()
    return this.store.insertHighlight({ ...h, id: uid('h_'), createdAt: now, updatedAt: now })
  }

  // ── Bibliothèque ──────────────────────────────────────────────────────────

  private librarySource(): Source {
    return (
      this.store.findSourceByUrl(LIBRARY_SOURCE_URL) ??
      this.store.insertSource({ id: uid('s_'), kind: 'book', title: 'Bibliothèque', url: LIBRARY_SOURCE_URL, createdAt: Date.now() })
    )
  }

  /** Copie un EPUB ou un PDF dans la bibliothèque et l'ajoute à la liste. */
  importBook(file: string): Item {
    const ext = extname(file).toLowerCase().slice(1)
    if (ext !== 'epub' && ext !== 'pdf') throw new Error('Formats acceptés : EPUB et PDF')
    if (!this.libraryDir) throw new Error('Bibliothèque indisponible')
    const size = statSync(file).size
    if (size > MAX_BOOK_BYTES) throw new Error('Fichier trop volumineux (500 Mo maximum)')
    const format = ext as BookFormat
    const data = readFileSync(file)
    const guid = `${basename(file)}|${size}`
    const source = this.librarySource()
    const already = this.store.listItems({ view: { type: 'library' }, limit: 10_000 }).find((i) => i.guid === guid)
    if (already) return already

    let title = basename(file, extname(file)).replace(/[_]+/g, ' ').trim()
    let author: string | undefined
    let imageUrl: string | undefined
    let summary: string | undefined
    if (format === 'epub') {
      const epub = new Epub(new Uint8Array(data))
      title = epub.meta.title || title
      author = epub.meta.author
      imageUrl = epub.meta.cover
      summary = `${epub.meta.spine.length} chapitres`
    }

    const id = uid('i_')
    mkdirSync(this.libraryDir, { recursive: true })
    const dest = join(this.libraryDir, `${id}.${ext}`)
    copyFileSync(file, dest)
    const now = Date.now()
    this.store.insertItems([{ id, sourceId: source.id, guid, title, author, summary, imageUrl, publishedAt: now, fetchedAt: now, format, filePath: dest }])
    this.emit({ type: 'items-changed' })
    return this.store.getItem(id)!
  }

  importBooks(files: string[]): { added: Item[]; failed: { file: string; error: string }[] } {
    const added: Item[] = []
    const failed: { file: string; error: string }[] = []
    for (const f of files) {
      try {
        added.push(this.importBook(f))
      } catch (e) {
        failed.push({ file: basename(f), error: (e as Error).message })
      }
    }
    return { added, failed }
  }

  private epub(itemId: string): Epub {
    let e = this.epubs.get(itemId)
    if (!e) {
      const path = this.store.bookFile(itemId)
      if (!path || !existsSync(path)) throw new Error('Fichier du livre introuvable')
      e = new Epub(new Uint8Array(readFileSync(path)))
      // On garde les trois derniers livres ouverts en mémoire.
      if (this.epubs.size >= 3) this.epubs.delete(this.epubs.keys().next().value!)
      this.epubs.set(itemId, e)
    }
    return e
  }

  bookToc(itemId: string): TocEntry[] {
    const item = this.store.getItem(itemId)
    if (item?.format !== 'epub') return []
    const epub = this.epub(itemId)
    if (epub.meta.toc.length) return epub.meta.toc
    return epub.meta.spine.map((s, i) => ({ title: s.title ?? `Chapitre ${i + 1}`, chapter: i, depth: 0 }))
  }

  bookChapter(itemId: string, index: number): { html: string; title?: string; count: number } {
    const epub = this.epub(itemId)
    return { ...epub.chapter(index), count: epub.meta.spine.length }
  }

  readBookFile(itemId: string): Uint8Array {
    const path = this.store.bookFile(itemId)
    if (!path || !existsSync(path)) throw new Error('Fichier du livre introuvable')
    return new Uint8Array(readFileSync(path))
  }

  searchPodcasts(term: string): Promise<PodcastResult[]> {
    return searchPodcasts(this.fetchFn, term, this.store.getSettings().language === 'en' ? 'US' : 'FR')
  }

  /** Transcription d'un épisode : téléchargée une fois, puis lue depuis la base. */
  async transcript(itemId: string): Promise<Cue[] | null> {
    const cached = this.store.getTranscript(itemId)
    if (cached) return JSON.parse(cached) as Cue[]
    const item = this.store.getItem(itemId)
    if (!item?.transcriptUrl) return null
    const { body, contentType } = await fetchText(this.fetchFn, item.transcriptUrl, { Accept: 'text/vtt, application/x-subrip, application/json, text/html, text/plain' })
    const cues = parseTranscript(body, contentType)
    this.store.setTranscript(itemId, JSON.stringify(cues))
    return cues
  }

  /** Nom lisible d'une « couche » de surlignage : chapitre d'un EPUB, page d'un PDF, instant d'un épisode. */
  layerLabel(item: Item, layer: string): string | undefined {
    const [kind, n] = layer.split(':')
    if (kind === 't') {
      const link = timeLink(item.mediaUrl ?? item.url, Number(n), item.mediaType)
      return link && item.mediaType === 'youtube' ? `[${formatTime(Number(n))}](${link})` : formatTime(Number(n))
    }
    if (layer === 'transcript') return 'Transcription'
    if (kind === 'p') return `Page ${Number(n) + 1}`
    if (kind === 'ch' && item.format === 'epub') {
      try {
        return this.epub(item.id).chapterTitle(Number(n))
      } catch {
        return `Chapitre ${Number(n) + 1}`
      }
    }
    return undefined
  }

  // ── Export ────────────────────────────────────────────────────────────────

  markdownFor(itemId: string): string {
    const item = this.store.getItem(itemId)
    if (!item) throw new Error('Article introuvable')
    return buildMarkdown(item, this.store.getSource(item.sourceId), this.store.listHighlights(itemId), Date.now(), (layer) => this.layerLabel(item, layer))
  }

  obsidianDir(): string | null {
    const s = this.store.getSettings()
    return s.obsidianVault ? join(s.obsidianVault, s.obsidianFolder || 'Learn') : null
  }

  /** État de Learn pour un document, tel qu'il est écrit dans le fichier : base de la prochaine fusion. */
  syncSnapshot(itemId: string): SyncBase {
    const item = this.store.getItem(itemId)
    return {
      tags: item?.tags ?? [],
      highlights: Object.fromEntries(this.store.listHighlights(itemId).map((h) => [h.id, { note: h.note.trim(), color: h.color }]))
    }
  }

  /**
   * Écrit (ou met à jour) le fichier Markdown d'un document dans le coffre Obsidian.
   * Le fichier déjà associé au document est réutilisé, même s'il a été renommé dans Obsidian.
   */
  exportToObsidian(itemId: string): { path: string; written: boolean } {
    const dir = this.obsidianDir()
    if (!dir) throw new Error('Choisis d’abord ton coffre Obsidian dans les Réglages')
    const item = this.store.getItem(itemId)
    if (!item) throw new Error('Article introuvable')
    mkdirSync(dir, { recursive: true })
    const generated = this.markdownFor(itemId)
    const owns = (text: string | null): boolean => text !== null && text.includes(`learn_id: ${item.id}\n`)

    const known = this.store.getSyncState(itemId)?.path
    const base = safeFileName(item.title)
    const candidates = [
      ...(known && existsSync(known) ? [known] : []),
      ...Array.from({ length: 50 }, (_, n) => join(dir, `${base}${n ? ` (${n + 1})` : ''}.md`))
    ]
    for (const path of candidates) {
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
      // Un fichier existant n'est réutilisé que s'il appartient à ce document.
      if (existing !== null && !owns(existing)) continue
      const merged = mergeWithExisting(generated, existing)
      if (merged === null) continue
      const written = merged !== existing
      if (written) writeFileSync(path, merged, 'utf8')
      this.store.setSyncState({ itemId, path, hash: hashText(merged), base: this.syncSnapshot(itemId), syncedAt: Date.now() })
      return { path, written }
    }
    throw new Error('Impossible de trouver un nom de fichier libre')
  }

  exportAllToObsidian(): { count: number; folder: string } {
    const ids = this.store.itemsWithHighlights()
    for (const id of ids) this.exportToObsidian(id)
    const s = this.store.getSettings()
    return { count: ids.length, folder: join(s.obsidianVault ?? '', s.obsidianFolder) }
  }

  // ── Boards ────────────────────────────────────────────────────────────────

  createBoard(title: string, mode: BoardMode): Board {
    const now = Date.now()
    return this.store.insertBoard({ id: uid('b_'), title: title.trim() || 'Sans titre', mode, data: { nodes: [], edges: [] }, createdAt: now, updatedAt: now })
  }

  /**
   * Ajoute un nœud au board. En mind map, il devient un enfant de la racine (ou la racine du board vide)
   * et l'arbre est remis en page ; en canvas, il se place à droite du contenu existant.
   */
  addToBoard(boardId: string, node: NewBoardNode): Board {
    const board = this.store.getBoard(boardId)
    if (!board) throw new Error('Board introuvable')
    const data = structuredClone(board.data)
    if (node.highlightId && data.nodes.some((n) => n.highlightId === node.highlightId)) return board
    const id = uid('n_')
    const root = findRoot(data)
    if (board.mode === 'mindmap') {
      data.nodes.push({ ...node, id, x: 0, y: 0, root: !root })
      if (root) data.edges.push({ id: uid('e_'), from: root.id, to: id })
      for (const [nid, p] of layoutMindmap(data)) Object.assign(data.nodes.find((n) => n.id === nid)!, p)
    } else {
      const maxX = data.nodes.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH), -NODE_WIDTH - 40)
      const col = data.nodes.filter((n) => n.x >= maxX - NODE_WIDTH - 1)
      const y = col.length && col.length < 5 ? Math.max(...col.map((n) => n.y + nodeHeight(n))) + 30 : 0
      data.nodes.push({ ...node, id, x: col.length && col.length < 5 ? maxX - NODE_WIDTH : maxX + 40, y })
    }
    const updated = this.store.updateBoard(boardId, { data })
    this.emit({ type: 'boards-changed' })
    return updated
  }

  boardMarkdown(id: string): string {
    const board = this.store.getBoard(id)
    if (!board) throw new Error('Board introuvable')
    return boardOutline(board)
  }

  /** Écrit le board en JSON Canvas dans le coffre (dossier Boards) ; les documents liés sont exportés aussi. */
  exportBoardToObsidian(id: string): { path: string } {
    const board = this.store.getBoard(id)
    if (!board) throw new Error('Board introuvable')
    const dir = this.obsidianDir()
    const vault = this.store.getSettings().obsidianVault
    if (!dir || !vault) throw new Error('Choisis d’abord ton coffre Obsidian dans les Réglages')
    const paths = new Map<string, string | undefined>()
    const docPath = (itemId: string): string | undefined => {
      if (!paths.has(itemId)) {
        try {
          paths.set(itemId, relative(vault, this.exportToObsidian(itemId).path).split(sep).join('/'))
        } catch {
          paths.set(itemId, undefined)
        }
      }
      return paths.get(itemId)
    }
    const canvas = buildCanvas(board, docPath)
    const boardsDir = join(dir, 'Boards')
    mkdirSync(boardsDir, { recursive: true })
    const path = join(boardsDir, `${safeFileName(board.title)}.canvas`)
    writeFileSync(path, JSON.stringify(canvas, null, 2), 'utf8')
    return { path }
  }

  importOpml(xml: string): Promise<{ added: Source[]; failed: { input: string; error: string }[] }> {
    return this.addSources(parseOpml(xml).map((f) => ({ input: f.url, title: f.title, category: f.category })))
  }

  exportOpml(): string {
    return buildOpml(this.store.listSources())
  }
}

export function hashText(text: string): string {
  return createHash('sha1').update(text.replace(/\r\n/g, '\n')).digest('hex')
}

async function pool<T>(list: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) await fn(list[i++])
  })
  await Promise.all(workers)
}
