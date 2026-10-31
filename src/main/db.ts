import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Board, BoardSummary, Counts, Highlight, HighlightWithItem, Item, ItemQuery, ReadingBalance, Settings, Source, View } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { boardItemIds, boardSize } from '@shared/boardExport'

// SQLite compilé en WebAssembly (sql.js) : aucun module natif à recompiler pour Mac, Windows et Linux.
// La base vit en mémoire et est écrite sur disque (écriture atomique) peu après chaque modification.

const MIGRATIONS = [
  `CREATE TABLE sources (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
     site_url TEXT, icon TEXT, category TEXT, lang TEXT,
     created_at INTEGER NOT NULL, last_fetched_at INTEGER, error TEXT
   );
   CREATE TABLE items (
     id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
     guid TEXT NOT NULL, url TEXT, title TEXT NOT NULL, author TEXT, summary TEXT,
     content_html TEXT, full_html TEXT, image_url TEXT,
     published_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
     read INTEGER NOT NULL DEFAULT 0, later INTEGER NOT NULL DEFAULT 0,
     bookmarked INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
     UNIQUE (source_id, guid)
   );
   CREATE INDEX items_published ON items (published_at DESC);
   CREATE INDEX items_source ON items (source_id, published_at DESC);
   CREATE TABLE item_tags (
     item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, tag TEXT NOT NULL,
     PRIMARY KEY (item_id, tag)
   );
   CREATE TABLE highlights (
     id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     color TEXT NOT NULL, quote TEXT NOT NULL, prefix TEXT NOT NULL, suffix TEXT NOT NULL,
     start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
     layer TEXT NOT NULL DEFAULT 'feed', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX highlights_item ON highlights (item_id);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // v0.2 : bibliothèque (EPUB/PDF), position de lecture, date de lecture, orientation des sources.
  `ALTER TABLE items ADD COLUMN format TEXT;
   ALTER TABLE items ADD COLUMN file_path TEXT;
   ALTER TABLE items ADD COLUMN position TEXT;
   ALTER TABLE items ADD COLUMN progress REAL NOT NULL DEFAULT 0;
   ALTER TABLE items ADD COLUMN read_at INTEGER;
   CREATE INDEX items_read_at ON items (read_at);
   ALTER TABLE sources ADD COLUMN leaning INTEGER;
   ALTER TABLE sources ADD COLUMN owner TEXT;`,
  // v0.3 : état de la dernière synchronisation avec Obsidian, base de la fusion à trois voies.
  `CREATE TABLE sync_state (
     item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
     path TEXT NOT NULL, hash TEXT NOT NULL, base TEXT NOT NULL, synced_at INTEGER NOT NULL
   );`,
  // v0.4 : boards (mind maps et canvas). Le contenu (nœuds, liens) est un document JSON.
  `CREATE TABLE boards (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, data TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );`,
  // v0.5 : correspondance avec Notion (page du document, bloc de chaque surlignage, base de fusion).
  `CREATE TABLE notion_state (
     item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
     page_id TEXT NOT NULL, blocks TEXT NOT NULL, base TEXT NOT NULL, synced_at INTEGER NOT NULL
   );`,
  // v0.6 : podcasts et vidéos (fichier, type, durée, transcription mise en cache).
  `ALTER TABLE items ADD COLUMN media_url TEXT;
   ALTER TABLE items ADD COLUMN media_type TEXT;
   ALTER TABLE items ADD COLUMN duration INTEGER;
   ALTER TABLE items ADD COLUMN transcript_url TEXT;
   ALTER TABLE items ADD COLUMN transcript TEXT;`,
  // v0.10 : année déjà récupérée en entier pour une chaîne YouTube (avec une clé d'API).
  `ALTER TABLE sources ADD COLUMN backfilled_year INTEGER;`
]

export interface NotionState {
  itemId: string
  pageId: string
  /** id du surlignage → id du bloc citation ; `_intro` pour le paragraphe d'en-tête. */
  blocks: Record<string, string>
  base: SyncBase
  syncedAt: number
}

const SECRET_PREFIX = 'secret:'

export interface SyncBase {
  tags: string[]
  highlights: Record<string, { note: string; color: string }>
}

export interface SyncState {
  itemId: string
  path: string
  hash: string
  base: SyncBase
  syncedAt: number
}

type Row = Record<string, SqlValue>

export async function openDatabase(file: string | null, wasmBinary?: ArrayBuffer): Promise<Store> {
  const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : undefined)
  const data = file && existsSync(file) ? readFileSync(file) : undefined
  const db = new SQL.Database(data)
  return new Store(db, file)
}

export class Store {
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private db: Database,
    private file: string | null
  ) {
    db.run('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  // ── Infrastructure ────────────────────────────────────────────────────────

  private migrate(): void {
    const version = (this.one('PRAGMA user_version')?.user_version as number) ?? 0
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.run('BEGIN')
      this.db.run(MIGRATIONS[v])
      this.db.run(`PRAGMA user_version = ${v + 1}`)
      this.db.run('COMMIT')
    }
    if (version < MIGRATIONS.length) this.scheduleSave()
  }

  private all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: Row[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as Row)
      return rows
    } finally {
      stmt.free()
    }
  }

  private one(sql: string, params: SqlValue[] = []): Row | undefined {
    return this.all(sql, params)[0]
  }

  private run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params)
    this.scheduleSave()
    return this.db.getRowsModified()
  }

  transaction<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const out = fn()
      this.db.run('COMMIT')
      return out
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 800)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, Buffer.from(this.db.export()))
    renameSync(tmp, this.file)
    // export() rouvre la base en interne et réinitialise les PRAGMA : on réactive les clés étrangères.
    this.db.run('PRAGMA foreign_keys = ON')
  }

  close(): void {
    this.flush()
    this.db.close()
  }

  // ── Réglages ──────────────────────────────────────────────────────────────

  getSettings(): Settings {
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    // Les secrets (jeton Notion…) ne quittent jamais le processus principal.
    for (const r of this.all('SELECT key, value FROM settings')) if (!(r.key as string).startsWith(SECRET_PREFIX)) out[r.key as string] = JSON.parse(r.value as string)
    return out as unknown as Settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) this.run('DELETE FROM settings WHERE key = ?', [k])
        else this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)])
      }
    })
    return this.getSettings()
  }

  getSecret(name: string): string | undefined {
    const r = this.one('SELECT value FROM settings WHERE key = ?', [SECRET_PREFIX + name])
    return r ? (JSON.parse(r.value as string) as string) : undefined
  }

  setSecret(name: string, value: string | undefined): void {
    if (value === undefined) this.run('DELETE FROM settings WHERE key = ?', [SECRET_PREFIX + name])
    else this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [SECRET_PREFIX + name, JSON.stringify(value)])
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  private toSource(r: Row): Source {
    return {
      id: r.id as string,
      kind: r.kind as Source['kind'],
      title: r.title as string,
      url: r.url as string,
      siteUrl: (r.site_url as string) ?? undefined,
      icon: (r.icon as string) ?? undefined,
      category: (r.category as string) ?? undefined,
      lang: (r.lang as Source['lang']) ?? undefined,
      createdAt: r.created_at as number,
      lastFetchedAt: (r.last_fetched_at as number) ?? undefined,
      error: (r.error as string) ?? undefined,
      leaning: (r.leaning as number) ?? undefined,
      owner: (r.owner as string) ?? undefined,
      backfilledYear: (r.backfilled_year as number) ?? undefined
    }
  }

  listSources(): Source[] {
    return this.all('SELECT * FROM sources ORDER BY title COLLATE NOCASE').map((r) => this.toSource(r))
  }

  getSource(id: string): Source | undefined {
    const r = this.one('SELECT * FROM sources WHERE id = ?', [id])
    return r ? this.toSource(r) : undefined
  }

  findSourceByUrl(url: string): Source | undefined {
    const r = this.one('SELECT * FROM sources WHERE url = ?', [url])
    return r ? this.toSource(r) : undefined
  }

  insertSource(s: Source): Source {
    this.run(
      `INSERT INTO sources (id, kind, title, url, site_url, icon, category, lang, created_at, last_fetched_at, error, leaning, owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        s.kind,
        s.title,
        s.url,
        s.siteUrl ?? null,
        s.icon ?? null,
        s.category ?? null,
        s.lang ?? null,
        s.createdAt,
        s.lastFetchedAt ?? null,
        s.error ?? null,
        s.leaning ?? null,
        s.owner ?? null
      ]
    )
    return s
  }

  updateSource(id: string, patch: Partial<Source>): Source {
    const cols: Record<string, string> = {
      title: 'title',
      category: 'category',
      icon: 'icon',
      siteUrl: 'site_url',
      lastFetchedAt: 'last_fetched_at',
      error: 'error',
      leaning: 'leaning',
      owner: 'owner',
      backfilledYear: 'backfilled_year'
    }
    const sets: string[] = []
    const vals: SqlValue[] = []
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) {
        sets.push(`${col} = ?`)
        vals.push(((patch as Record<string, unknown>)[k] ?? null) as SqlValue)
      }
    }
    if (sets.length) this.run(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
    const s = this.getSource(id)
    if (!s) throw new Error('Source introuvable')
    return s
  }

  /**
   * Supprime une source. Les articles qui portent du travail de l'utilisateur (surlignages, tags, marques)
   * sont d'abord déplacés vers `keepInto` pour ne jamais être perdus.
   */
  removeSource(id: string, keepInto?: string): void {
    this.transaction(() => {
      if (keepInto) {
        this.run(
          `UPDATE OR IGNORE items SET source_id = ? WHERE source_id = ?
             AND (later = 1 OR bookmarked = 1 OR favorite = 1
                  OR id IN (SELECT item_id FROM highlights) OR id IN (SELECT item_id FROM item_tags))`,
          [keepInto, id]
        )
      }
      this.run('DELETE FROM sources WHERE id = ?', [id])
    })
  }

  // ── Articles ──────────────────────────────────────────────────────────────

  private toItem(r: Row, tags: string[]): Item {
    return {
      id: r.id as string,
      sourceId: r.source_id as string,
      guid: r.guid as string,
      url: (r.url as string) ?? undefined,
      title: r.title as string,
      author: (r.author as string) ?? undefined,
      summary: (r.summary as string) ?? undefined,
      contentHtml: (r.content_html as string) ?? undefined,
      fullHtml: (r.full_html as string) ?? undefined,
      imageUrl: (r.image_url as string) ?? undefined,
      publishedAt: r.published_at as number,
      fetchedAt: r.fetched_at as number,
      read: !!r.read,
      later: !!r.later,
      bookmarked: !!r.bookmarked,
      favorite: !!r.favorite,
      tags,
      highlightCount: (r.highlight_count as number) ?? 0,
      format: (r.format as Item['format']) ?? undefined,
      position: (r.position as string) ?? undefined,
      progress: (r.progress as number) ?? 0,
      readAt: (r.read_at as number) ?? undefined,
      mediaUrl: (r.media_url as string) ?? undefined,
      mediaType: (r.media_type as Item['mediaType']) ?? undefined,
      duration: (r.duration as number) ?? undefined,
      transcriptUrl: (r.transcript_url as string) ?? undefined
    }
  }

  private tagsFor(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (!ids.length) return map
    const rows = this.all(`SELECT item_id, tag FROM item_tags WHERE item_id IN (${ids.map(() => '?').join(',')}) ORDER BY tag`, ids)
    for (const r of rows) map.set(r.item_id as string, [...(map.get(r.item_id as string) ?? []), r.tag as string])
    return map
  }

  /** Insère les nouveaux articles ; renvoie le nombre réellement ajouté (les doublons sont ignorés). */
  insertItems(items: (Omit<Item, 'read' | 'later' | 'bookmarked' | 'favorite' | 'tags'> & { filePath?: string })[]): number {
    let added = 0
    this.transaction(() => {
      for (const it of items) {
        added += this.run(
          `INSERT OR IGNORE INTO items (id, source_id, guid, url, title, author, summary, content_html, image_url, published_at, fetched_at, format, file_path,
                                        media_url, media_type, duration, transcript_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.id,
            it.sourceId,
            it.guid,
            it.url ?? null,
            it.title,
            it.author ?? null,
            it.summary ?? null,
            it.contentHtml ?? null,
            it.imageUrl ?? null,
            it.publishedAt,
            it.fetchedAt,
            it.format ?? null,
            it.filePath ?? null,
            it.mediaUrl ?? null,
            it.mediaType ?? null,
            it.duration ?? null,
            it.transcriptUrl ?? null
          ]
        )
      }
    })
    return added
  }

  getTranscript(id: string): string | undefined {
    return (this.one('SELECT transcript FROM items WHERE id = ?', [id])?.transcript as string) ?? undefined
  }

  setTranscript(id: string, json: string): void {
    this.run('UPDATE items SET transcript = ? WHERE id = ?', [json, id])
  }

  bookFile(id: string): string | undefined {
    return (this.one('SELECT file_path FROM items WHERE id = ?', [id])?.file_path as string) ?? undefined
  }

  savePosition(id: string, position: string, progress: number): void {
    this.run('UPDATE items SET position = ?, progress = ? WHERE id = ?', [position, Math.max(0, Math.min(1, progress)), id])
  }

  private viewWhere(view: View): { where: string; params: SqlValue[] } {

    switch (view.type) {
      case 'home':
        return { where: "s.kind NOT IN ('links', 'book')", params: [] }
      case 'later':
        return { where: 'i.later = 1', params: [] }
      case 'bookmarks':
        return { where: 'i.bookmarked = 1', params: [] }
      case 'favorites':
        return { where: 'i.favorite = 1', params: [] }
      case 'links':
        return { where: "s.kind = 'links'", params: [] }
      case 'library':
        return { where: "s.kind = 'book'", params: [] }
      case 'highlights':
        return { where: 'EXISTS (SELECT 1 FROM highlights h WHERE h.item_id = i.id)', params: [] }
      case 'tag':
        return { where: 'EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag = ?)', params: [view.tag] }
      case 'kind':
        return { where: 's.kind = ?', params: [view.kind] }
      case 'source':
        return { where: 'i.source_id = ?', params: [view.sourceId] }
      case 'category':
        return {
          where: `s.category IS ? AND s.kind IN (${view.kinds.map(() => '?').join(', ') || "''"})`,
          params: [view.category || null, ...view.kinds]
        }
      default:
        throw new Error('Vue inconnue')
    }
  }

  listItems(q: ItemQuery): Item[] {
    const { where, params } = this.viewWhere(q.view)
    const conds = [where]
    const vals: SqlValue[] = [...params]
    if (q.unreadOnly) conds.push('i.read = 0')
    if (q.search?.trim()) {
      conds.push('(i.title LIKE ? OR i.summary LIKE ? OR i.author LIKE ?)')
      const like = `%${q.search.trim().replace(/[%_]/g, '')}%`
      vals.push(like, like, like)
    }
    const rows = this.all(
      `SELECT i.id, i.source_id, i.guid, i.url, i.title, i.author, i.summary, i.image_url, i.published_at, i.fetched_at,
              i.read, i.later, i.bookmarked, i.favorite, i.format, i.position, i.progress, i.read_at,
              i.media_url, i.media_type, i.duration, i.transcript_url,
              (SELECT COUNT(*) FROM highlights h WHERE h.item_id = i.id) AS highlight_count
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ${q.view.type === 'library' ? 'COALESCE(i.read_at, i.published_at)' : 'i.published_at'} DESC LIMIT ? OFFSET ?`,
      [...vals, q.limit ?? 100, q.offset ?? 0]
    )
    const tags = this.tagsFor(rows.map((r) => r.id as string))
    return rows.map((r) => this.toItem(r, tags.get(r.id as string) ?? []))
  }

  getItem(id: string): Item | null {
    const r = this.one('SELECT i.*, (SELECT COUNT(*) FROM highlights h WHERE h.item_id = i.id) AS highlight_count FROM items i WHERE i.id = ?', [id])
    if (!r) return null
    return this.toItem(r, this.tagsFor([id]).get(id) ?? [])
  }

  updateItem(
    id: string,
    patch: Partial<Pick<Item, 'read' | 'later' | 'bookmarked' | 'favorite' | 'tags' | 'fullHtml' | 'title' | 'imageUrl' | 'author' | 'summary'>>
  ): Item {
    this.transaction(() => {
      const cols: Record<string, string> = {
        read: 'read',
        later: 'later',
        bookmarked: 'bookmarked',
        favorite: 'favorite',
        fullHtml: 'full_html',
        title: 'title',
        imageUrl: 'image_url',
        author: 'author',
        summary: 'summary'
      }
      for (const [k, col] of Object.entries(cols)) {
        if (!(k in patch)) continue
        const v = (patch as Record<string, unknown>)[k]
        this.run(`UPDATE items SET ${col} = ? WHERE id = ?`, [typeof v === 'boolean' ? (v ? 1 : 0) : ((v ?? null) as SqlValue), id])
      }
      // Date de lecture : sert au bilan de lecture (et à trier la bibliothèque).
      if (patch.read === true) this.run('UPDATE items SET read_at = COALESCE(read_at, ?) WHERE id = ?', [Date.now(), id])
      if (patch.read === false) this.run('UPDATE items SET read_at = NULL WHERE id = ?', [id])
      if (patch.tags) {
        this.run('DELETE FROM item_tags WHERE item_id = ?', [id])
        for (const t of new Set(patch.tags.map((t) => t.trim()).filter(Boolean))) this.run('INSERT INTO item_tags (item_id, tag) VALUES (?, ?)', [id, t])
      }
    })
    const item = this.getItem(id)
    if (!item) throw new Error('Article introuvable')
    return item
  }

  markAllRead(view: View): void {
    const { where, params } = this.viewWhere(view)
    this.run(`UPDATE items SET read = 1 WHERE id IN (SELECT i.id FROM items i JOIN sources s ON s.id = i.source_id WHERE ${where})`, params)
  }

  /**
   * YouTube : on ne garde que les vidéos de l'année en cours. Au changement d'année, tout repart de zéro,
   * sauf les vidéos où l'utilisateur a laissé une trace (marque, tag, surlignage, note horodatée).
   */
  pruneYoutubeBefore(start: number, keep: Iterable<string> = []): number {
    const kept = [...keep]
    return this.run(
      `DELETE FROM items WHERE published_at < ? AND later = 0 AND bookmarked = 0 AND favorite = 0
         AND id NOT IN (SELECT item_id FROM highlights) AND id NOT IN (SELECT item_id FROM item_tags)
         ${kept.length ? `AND id NOT IN (${kept.map(() => '?').join(', ')})` : ''}
         AND source_id IN (SELECT id FROM sources WHERE kind = 'youtube')`,
      [start, ...kept]
    )
  }

  /** Documents cités dans au moins un board (à ne jamais purger). */
  boardItemIds(): Set<string> {
    const ids = new Set<string>()
    for (const r of this.all('SELECT data FROM boards')) for (const id of boardItemIds(JSON.parse(r.data as string) as Board['data'])) ids.add(id)
    return ids
  }

  /** Purge les vieux articles lus sans marque ni surlignage, pour garder une base légère. */
  prune(olderThan: number, keep: Iterable<string> = []): number {
    const kept = [...keep]
    return this.run(
      `DELETE FROM items WHERE published_at < ? AND read = 1 AND later = 0 AND bookmarked = 0 AND favorite = 0
         AND id NOT IN (SELECT item_id FROM highlights) AND id NOT IN (SELECT item_id FROM item_tags)
         ${kept.length ? `AND id NOT IN (${kept.map(() => '?').join(', ')})` : ''}
         AND source_id NOT IN (SELECT id FROM sources WHERE kind IN ('links', 'book'))`,
      [olderThan, ...kept]
    )
  }

  counts(): Counts {
    const n = (sql: string): number => (this.one(sql)?.n as number) ?? 0
    const tags: Record<string, number> = {}
    for (const r of this.all('SELECT tag, COUNT(*) AS n FROM item_tags GROUP BY tag ORDER BY tag COLLATE NOCASE')) tags[r.tag as string] = r.n as number
    const unreadBySource: Record<string, number> = {}
    let unreadTotal = 0
    for (const r of this.all(
      "SELECT source_id, COUNT(*) AS n FROM items WHERE read = 0 AND source_id NOT IN (SELECT id FROM sources WHERE kind IN ('links', 'book')) GROUP BY source_id"
    )) {
      unreadBySource[r.source_id as string] = r.n as number
      unreadTotal += r.n as number
    }
    return {
      later: n('SELECT COUNT(*) AS n FROM items WHERE later = 1'),
      bookmarks: n('SELECT COUNT(*) AS n FROM items WHERE bookmarked = 1'),
      favorites: n('SELECT COUNT(*) AS n FROM items WHERE favorite = 1'),
      links: n("SELECT COUNT(*) AS n FROM items i JOIN sources s ON s.id = i.source_id WHERE s.kind = 'links'"),
      library: n("SELECT COUNT(*) AS n FROM items i JOIN sources s ON s.id = i.source_id WHERE s.kind = 'book'"),
      highlights: n('SELECT COUNT(DISTINCT item_id) AS n FROM highlights'),
      tags,
      unreadBySource,
      unreadTotal
    }
  }

  /** Lectures des N derniers jours, par source politique (orientation connue) et pour le reste. */
  readingBalance(days: number): ReadingBalance {
    const since = Date.now() - days * 24 * 3600 * 1000
    const entries = this.all(
      `SELECT s.id, s.title, s.leaning, s.owner,
              (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.read_at >= ?) AS reads
       FROM sources s WHERE s.leaning IS NOT NULL ORDER BY s.leaning, s.title COLLATE NOCASE`,
      [since]
    ).map((r) => ({
      sourceId: r.id as string,
      title: r.title as string,
      leaning: r.leaning as number,
      owner: (r.owner as string) ?? undefined,
      reads: r.reads as number
    }))
    const otherReads =
      (this.one(
        `SELECT COUNT(*) AS n FROM items i JOIN sources s ON s.id = i.source_id
         WHERE i.read_at >= ? AND s.leaning IS NULL AND s.kind != 'book'`,
        [since]
      )?.n as number) ?? 0
    return { days, entries, otherReads }
  }

  allTags(): string[] {
    return this.all('SELECT DISTINCT tag FROM item_tags ORDER BY tag COLLATE NOCASE').map((r) => r.tag as string)
  }

  itemsWithHighlights(): string[] {
    return this.all('SELECT DISTINCT item_id FROM highlights').map((r) => r.item_id as string)
  }

  // ── Boards ────────────────────────────────────────────────────────────────

  private toBoard(r: Row): Board {
    return {
      id: r.id as string,
      title: r.title as string,
      mode: r.mode as Board['mode'],
      data: JSON.parse(r.data as string) as Board['data'],
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number
    }
  }

  listBoards(): BoardSummary[] {
    return this.all('SELECT id, title, mode, data, updated_at FROM boards ORDER BY updated_at DESC').map((r) => ({
      id: r.id as string,
      title: r.title as string,
      mode: r.mode as Board['mode'],
      nodeCount: boardSize(JSON.parse(r.data as string) as Board['data']),
      updatedAt: r.updated_at as number
    }))
  }

  getBoard(id: string): Board | null {
    const r = this.one('SELECT * FROM boards WHERE id = ?', [id])
    return r ? this.toBoard(r) : null
  }

  insertBoard(b: Board): Board {
    this.run('INSERT INTO boards (id, title, mode, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [b.id, b.title, b.mode, JSON.stringify(b.data), b.createdAt, b.updatedAt])
    return b
  }

  updateBoard(id: string, patch: Partial<Pick<Board, 'title' | 'mode' | 'data'>>): Board {
    const b = this.getBoard(id)
    if (!b) throw new Error('Board introuvable')
    const next = { ...b, ...patch, updatedAt: Date.now() }
    this.run('UPDATE boards SET title = ?, mode = ?, data = ?, updated_at = ? WHERE id = ?', [next.title, next.mode, JSON.stringify(next.data), next.updatedAt, id])
    return next
  }

  deleteBoard(id: string): void {
    this.run('DELETE FROM boards WHERE id = ?', [id])
  }

  allHighlights(): HighlightWithItem[] {
    return this.all('SELECT h.*, i.title AS item_title, i.format AS item_format FROM highlights h JOIN items i ON i.id = h.item_id ORDER BY h.updated_at DESC').map((r) => ({
      ...this.toHighlight(r),
      itemTitle: r.item_title as string,
      format: (r.item_format as HighlightWithItem['format']) ?? undefined
    }))
  }

  // ── Synchronisation ───────────────────────────────────────────────────────

  getSyncState(itemId: string): SyncState | undefined {
    const r = this.one('SELECT * FROM sync_state WHERE item_id = ?', [itemId])
    if (!r) return undefined
    return { itemId, path: r.path as string, hash: r.hash as string, base: JSON.parse(r.base as string) as SyncBase, syncedAt: r.synced_at as number }
  }

  setSyncState(s: SyncState): void {
    this.run(
      `INSERT INTO sync_state (item_id, path, hash, base, synced_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET path = excluded.path, hash = excluded.hash, base = excluded.base, synced_at = excluded.synced_at`,
      [s.itemId, s.path, s.hash, JSON.stringify(s.base), s.syncedAt]
    )
  }

  getNotionState(itemId: string): NotionState | undefined {
    const r = this.one('SELECT * FROM notion_state WHERE item_id = ?', [itemId])
    if (!r) return undefined
    return { itemId, pageId: r.page_id as string, blocks: JSON.parse(r.blocks as string), base: JSON.parse(r.base as string), syncedAt: r.synced_at as number }
  }

  setNotionState(s: NotionState): void {
    this.run(
      `INSERT INTO notion_state (item_id, page_id, blocks, base, synced_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET page_id = excluded.page_id, blocks = excluded.blocks, base = excluded.base, synced_at = excluded.synced_at`,
      [s.itemId, s.pageId, JSON.stringify(s.blocks), JSON.stringify(s.base), s.syncedAt]
    )
  }

  deleteNotionState(itemId: string): void {
    this.run('DELETE FROM notion_state WHERE item_id = ?', [itemId])
  }

  notionItems(): string[] {
    return this.all('SELECT item_id FROM notion_state').map((r) => r.item_id as string)
  }

  syncedItems(): string[] {
    return this.all('SELECT item_id FROM sync_state').map((r) => r.item_id as string)
  }

  // ── Surlignages ───────────────────────────────────────────────────────────

  private toHighlight(r: Row): Highlight {
    return {
      id: r.id as string,
      itemId: r.item_id as string,
      color: r.color as Highlight['color'],
      quote: r.quote as string,
      prefix: r.prefix as string,
      suffix: r.suffix as string,
      start: r.start_offset as number,
      end: r.end_offset as number,
      note: r.note as string,
      layer: r.layer as Highlight['layer'],
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number
    }
  }

  listHighlights(itemId?: string): Highlight[] {
    const rows = itemId
      ? this.all('SELECT * FROM highlights WHERE item_id = ? ORDER BY layer, start_offset', [itemId])
      : this.all('SELECT * FROM highlights ORDER BY updated_at DESC')
    return rows.map((r) => this.toHighlight(r))
  }

  insertHighlight(h: Highlight): Highlight {
    this.run(
      `INSERT INTO highlights (id, item_id, color, quote, prefix, suffix, start_offset, end_offset, note, layer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [h.id, h.itemId, h.color, h.quote, h.prefix, h.suffix, h.start, h.end, h.note, h.layer, h.createdAt, h.updatedAt]
    )
    return h
  }

  updateHighlight(id: string, patch: Partial<Pick<Highlight, 'color' | 'note'>>): Highlight {
    const now = Date.now()
    if (patch.color !== undefined) this.run('UPDATE highlights SET color = ?, updated_at = ? WHERE id = ?', [patch.color, now, id])
    if (patch.note !== undefined) this.run('UPDATE highlights SET note = ?, updated_at = ? WHERE id = ?', [patch.note, now, id])
    const r = this.one('SELECT * FROM highlights WHERE id = ?', [id])
    if (!r) throw new Error('Surlignage introuvable')
    return this.toHighlight(r)
  }

  removeHighlight(id: string): void {
    this.run('DELETE FROM highlights WHERE id = ?', [id])
  }
}
