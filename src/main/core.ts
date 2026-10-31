import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { BookFormat, Highlight, Item, LearnEvent, NewSource, RefreshResult, ResolvedInput, Source, TocEntry } from '@shared/types'
import { hostOf, uid } from '@shared/util'
import { fetchArticle } from './article'
import { Epub } from './books/epub'
import type { Store } from './db'
import { buildMarkdown, mergeWithExisting, safeFileName } from './export/markdown'
import { fetchFeed, fetchIcon, type FetchFn } from './feeds/fetcher'
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

    const { feed, feedUrl } = await fetchFeed(this.fetchFn, resolved.url)
    const again = feedUrl !== resolved.url ? this.store.findSourceByUrl(feedUrl) : undefined
    if (again) return again

    const siteUrl = resolved.siteUrl ?? feed.siteUrl
    const source = this.store.insertSource({
      id: uid('s_'),
      kind: resolved.kind,
      title: n.title ?? (resolved.kind === 'rss' || resolved.kind === 'forum' ? feed.title : resolved.title ?? feed.title),
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

  /** Nom lisible d'une « couche » de surlignage : chapitre d'un EPUB, page d'un PDF. */
  layerLabel(item: Item, layer: string): string | undefined {
    const [kind, n] = layer.split(':')
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

  /** Écrit (ou met à jour) le fichier Markdown d'un document dans le coffre Obsidian. */
  exportToObsidian(itemId: string): { path: string } {
    const settings = this.store.getSettings()
    if (!settings.obsidianVault) throw new Error('Choisis d’abord ton coffre Obsidian dans les Réglages')
    const item = this.store.getItem(itemId)
    if (!item) throw new Error('Article introuvable')
    const dir = join(settings.obsidianVault, settings.obsidianFolder || 'Learn')
    mkdirSync(dir, { recursive: true })
    const generated = this.markdownFor(itemId)

    const base = safeFileName(item.title)
    for (let n = 0; n < 50; n++) {
      const path = join(dir, `${base}${n ? ` (${n + 1})` : ''}.md`)
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
      // Un fichier existant n'est réutilisé que s'il appartient à ce document.
      if (existing !== null && !existing.includes(`learn_id: ${item.id}\n`)) continue
      const merged = mergeWithExisting(generated, existing)
      if (merged === null) continue
      writeFileSync(path, merged, 'utf8')
      return { path }
    }
    throw new Error('Impossible de trouver un nom de fichier libre')
  }

  exportAllToObsidian(): { count: number; folder: string } {
    const ids = this.store.itemsWithHighlights()
    for (const id of ids) this.exportToObsidian(id)
    const s = this.store.getSettings()
    return { count: ids.length, folder: join(s.obsidianVault ?? '', s.obsidianFolder) }
  }

  importOpml(xml: string): Promise<{ added: Source[]; failed: { input: string; error: string }[] }> {
    return this.addSources(parseOpml(xml).map((f) => ({ input: f.url, title: f.title, category: f.category })))
  }

  exportOpml(): string {
    return buildOpml(this.store.listSources())
  }
}

async function pool<T>(list: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) await fn(list[i++])
  })
  await Promise.all(workers)
}
