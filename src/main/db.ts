import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SearchResults, Board, BoardSummary, Counts, Highlight, HighlightWithItem, Item, ItemQuery, ReadingBalance, Settings, Source, View } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { normalize, type SourceFilter } from '@shared/filters'
import { ftsQuery, HIT_CLOSE, HIT_OPEN } from '@shared/search'
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
  `ALTER TABLE sources ADD COLUMN backfilled_year INTEGER;`,
  // v0.14 : filtres (catégories du flux, Shorts YouTube, articles masqués sans être supprimés).
  `ALTER TABLE items ADD COLUMN categories TEXT;
   ALTER TABLE items ADD COLUMN short INTEGER;
   ALTER TABLE items ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sources ADD COLUMN filter TEXT;`,
  // v0.15 : recherche plein texte (FTS4, sans accents). L'index lit le texte dans les tables elles-mêmes
  // (« external content ») : rien n'est copié, et des déclencheurs le tiennent à jour.
  `CREATE VIRTUAL TABLE items_fts USING fts4(content="items", title, author, summary, content_html, full_html, tokenize=unicode61 "remove_diacritics=2");
   CREATE TRIGGER items_fts_bd BEFORE DELETE ON items BEGIN DELETE FROM items_fts WHERE docid = old.rowid; END;
   CREATE TRIGGER items_fts_bu BEFORE UPDATE OF title, author, summary, content_html, full_html ON items BEGIN DELETE FROM items_fts WHERE docid = old.rowid; END;
   CREATE TRIGGER items_fts_au AFTER UPDATE OF title, author, summary, content_html, full_html ON items BEGIN
     INSERT INTO items_fts (docid, title, author, summary, content_html, full_html) VALUES (new.rowid, new.title, new.author, new.summary, new.content_html, new.full_html); END;
   CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
     INSERT INTO items_fts (docid, title, author, summary, content_html, full_html) VALUES (new.rowid, new.title, new.author, new.summary, new.content_html, new.full_html); END;
   INSERT INTO items_fts (items_fts) VALUES ('rebuild');
   CREATE VIRTUAL TABLE highlights_fts USING fts4(content="highlights", quote, note, tokenize=unicode61 "remove_diacritics=2");
   CREATE TRIGGER highlights_fts_bd BEFORE DELETE ON highlights BEGIN DELETE FROM highlights_fts WHERE docid = old.rowid; END;
   CREATE TRIGGER highlights_fts_bu BEFORE UPDATE OF quote, note ON highlights BEGIN DELETE FROM highlights_fts WHERE docid = old.rowid; END;
   CREATE TRIGGER highlights_fts_au AFTER UPDATE OF quote, note ON highlights BEGIN INSERT INTO highlights_fts (docid, quote, note) VALUES (new.rowid, new.quote, new.note); END;
   CREATE TRIGGER highlights_fts_ai AFTER INSERT ON highlights BEGIN INSERT INTO highlights_fts (docid, quote, note) VALUES (new.rowid, new.quote, new.note); END;
   INSERT INTO highlights_fts (highlights_fts) VALUES ('rebuild');`,
  // v0.15 : lecture hors ligne (texte complet et images enregistrés).
  `ALTER TABLE items ADD COLUMN offline_at INTEGER;`,
  // v0.16 : synchronisation (Supabase). Date de dernière modification de chaque élément et état d'envoi.
  `CREATE TABLE IF NOT EXISTS cloud_state (
     kind TEXT NOT NULL, key TEXT NOT NULL, updated_at INTEGER NOT NULL, synced INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (kind, key)
   );
   CREATE INDEX IF NOT EXISTS cloud_state_dirty ON cloud_state (synced);`
]

export type CloudKind = 'source' | 'item' | 'highlight' | 'board'

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
      try {
        this.db.run(MIGRATIONS[v])
        this.db.run(`PRAGMA user_version = ${v + 1}`)
        this.db.run('COMMIT')
      } catch (e) {
        // Échec : la base reste à la version précédente, intacte, au lieu d'une transaction laissée ouverte.
        this.db.run('ROLLBACK')
        throw new Error(`Mise à jour de la base (étape ${v + 1}) impossible : ${(e as Error).message}`)
      }
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
      backfilledYear: (r.backfilled_year as number) ?? undefined,
      filter: r.filter ? (JSON.parse(r.filter as string) as SourceFilter) : undefined
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
      backfilledYear: 'backfilled_year',
      filter: 'filter'
    }
    const sets: string[] = []
    const vals: SqlValue[] = []
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) {
        sets.push(`${col} = ?`)
        const v = (patch as Record<string, unknown>)[k]
        vals.push((k === 'filter' ? (v ? JSON.stringify(v) : null) : (v ?? null)) as SqlValue)
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
      transcriptUrl: (r.transcript_url as string) ?? undefined,
      categories: r.categories ? (JSON.parse(r.categories as string) as string[]) : undefined,
      short: r.short == null ? undefined : !!r.short,
      hidden: !!r.hidden,
      offlineAt: (r.offline_at as number) ?? undefined
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
                                        media_url, media_type, duration, transcript_url, categories, short, hidden)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            it.transcriptUrl ?? null,
            it.categories?.length ? JSON.stringify(it.categories) : null,
            it.short == null ? null : it.short ? 1 : 0,
            it.hidden ? 1 : 0
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
    // Les filtres masquent dans les flux ; ce qu'on a gardé soi-même (plus tard, favoris…) reste visible.
    if (!q.showHidden && ['home', 'kind', 'source', 'category'].includes(q.view.type)) conds.push('i.hidden = 0')
    const fts = q.search ? ftsQuery(q.search) : null
    if (fts) {
      // Recherche plein texte : titre, auteur, résumé, texte du flux et texte complet, sans tenir compte des accents.
      conds.push('i.rowid IN (SELECT docid FROM items_fts WHERE items_fts MATCH ?)')
      vals.push(fts)
    }
    const rows = this.all(
      `SELECT i.id, i.source_id, i.guid, i.url, i.title, i.author, i.summary, i.image_url, i.published_at, i.fetched_at,
              i.read, i.later, i.bookmarked, i.favorite, i.format, i.position, i.progress, i.read_at,
              i.media_url, i.media_type, i.duration, i.transcript_url, i.categories, i.short, i.hidden, i.offline_at,
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

  /**
   * Recalcule les articles masqués d'une source (ou de toutes) après un changement de filtre.
   * `passes` décide pour chaque article ; seules les lignes qui changent sont écrites.
   */
  recomputeHidden(sourceId: string | null, passes: (it: Item, source: Source) => boolean): { total: number; hidden: number } {
    const sources = new Map(this.listSources().map((s) => [s.id, s]))
    const rows = this.all(
      `SELECT id, source_id, title, author, summary, categories, short, hidden FROM items WHERE ${sourceId ? 'source_id = ?' : '1'}`,
      sourceId ? [sourceId] : []
    )
    let hidden = 0
    this.transaction(() => {
      for (const r of rows) {
        const source = sources.get(r.source_id as string)
        if (!source) continue
        const it = this.toItem(r, [])
        const hide = !passes(it, source)
        if (hide) hidden++
        if (hide !== !!r.hidden) this.run('UPDATE items SET hidden = ? WHERE id = ?', [hide ? 1 : 0, r.id as string])
      }
    })
    return { total: rows.length, hidden }
  }

  /** Articles d'une source pour l'aperçu d'un filtre (les plus récents). */
  filterSample(sourceId: string, limit = 300): Item[] {
    return this.all('SELECT id, source_id, title, author, summary, categories, short, published_at FROM items WHERE source_id = ? ORDER BY published_at DESC LIMIT ?', [
      sourceId,
      limit
    ]).map((r) => this.toItem(r, []))
  }

  /** Articles gardés (plus tard, signets, favoris) pas encore prêts pour la lecture hors ligne. */
  offlineQueue(limit = 20): Item[] {
    return this.all(
      `SELECT i.* FROM items i JOIN sources s ON s.id = i.source_id
       WHERE (i.later = 1 OR i.bookmarked = 1 OR i.favorite = 1) AND i.offline_at IS NULL AND i.url IS NOT NULL
         AND i.format IS NULL AND i.media_type IS NULL AND s.kind NOT IN ('book', 'youtube', 'podcast')
       ORDER BY i.published_at DESC LIMIT ?`,
      [limit]
    ).map((r) => this.toItem(r, []))
  }

  /** Enregistre la version hors ligne (texte complet avec images) d'un article. */
  setOffline(id: string, fullHtml: string | undefined, ok = true): void {
    if (fullHtml !== undefined) this.run('UPDATE items SET full_html = ? WHERE id = ?', [fullHtml, id])
    // 0 : échec (page inaccessible, payante…) ; on ne réessaie pas à chaque actualisation.
    this.run('UPDATE items SET offline_at = ? WHERE id = ?', [ok ? Date.now() : 0, id])
  }

  // ── Synchronisation (Supabase) ────────────────────────────────────────────

  /** Modification locale d'un élément : à envoyer. */
  cloudTouch(kind: CloudKind, key: string, at = Date.now()): void {
    this.run(
      'INSERT INTO cloud_state (kind, key, updated_at, synced) VALUES (?, ?, ?, 0) ON CONFLICT(kind, key) DO UPDATE SET updated_at = MAX(excluded.updated_at, cloud_state.updated_at + 1), synced = 0',
      [kind, key, at]
    )
  }

  cloudDirty(limit = 500): { kind: CloudKind; key: string; updatedAt: number }[] {
    return this.all('SELECT kind, key, updated_at FROM cloud_state WHERE synced = 0 LIMIT ?', [limit]).map((r) => ({
      kind: r.kind as CloudKind,
      key: r.key as string,
      updatedAt: r.updated_at as number
    }))
  }

  /** Envoyé : seulement si rien n'a changé depuis (sinon il repartira au prochain envoi). */
  cloudMarkSynced(kind: CloudKind, key: string, updatedAt: number): void {
    this.run('UPDATE cloud_state SET synced = 1 WHERE kind = ? AND key = ? AND updated_at = ?', [kind, key, updatedAt])
  }

  cloudUpdatedAt(kind: CloudKind, key: string): number | undefined {
    return (this.one('SELECT updated_at FROM cloud_state WHERE kind = ? AND key = ?', [kind, key])?.updated_at as number) ?? undefined
  }

  /** Version venue d'un autre appareil, appliquée ici : déjà à jour, rien à renvoyer. */
  cloudSetRemote(kind: CloudKind, key: string, updatedAt: number): void {
    this.run('INSERT INTO cloud_state (kind, key, updated_at, synced) VALUES (?, ?, ?, 1) ON CONFLICT(kind, key) DO UPDATE SET updated_at = excluded.updated_at, synced = 1', [
      kind,
      key,
      updatedAt
    ])
  }

  /** Changement de compte : tout repart de zéro (chaque élément local sera renvoyé). */
  cloudReset(): void {
    this.run('DELETE FROM cloud_state')
  }

  /** Articles qui portent un état à synchroniser : marques, tags, surlignages, position, ou lus depuis `since`. */
  cloudCandidates(since: number): { sourceUrl: string; guid: string }[] {
    return this.all(
      `SELECT s.url AS source_url, i.guid FROM items i JOIN sources s ON s.id = i.source_id
       WHERE s.kind != 'book' AND (i.later = 1 OR i.bookmarked = 1 OR i.favorite = 1 OR i.position IS NOT NULL
         OR i.read_at >= ? OR i.id IN (SELECT item_id FROM item_tags) OR i.id IN (SELECT item_id FROM highlights))`,
      [since]
    ).map((r) => ({ sourceUrl: r.source_url as string, guid: r.guid as string }))
  }

  findItemByGuid(sourceId: string, guid: string): Item | null {
    const r = this.one('SELECT id FROM items WHERE source_id = ? AND guid = ?', [sourceId, guid])
    return r ? this.getItem(r.id as string) : null
  }

  getHighlight(id: string): Highlight | undefined {
    const r = this.one('SELECT * FROM highlights WHERE id = ?', [id])
    return r ? this.toHighlight(r) : undefined
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
      "SELECT source_id, COUNT(*) AS n FROM items WHERE read = 0 AND hidden = 0 AND source_id NOT IN (SELECT id FROM sources WHERE kind IN ('links', 'book')) GROUP BY source_id"
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

  /**
   * Recherche plein texte : articles (les titres qui correspondent d'abord, puis les plus récents) et
   * surlignages ou notes, avec un extrait autour des mots trouvés.
   */
  search(text: string, limit = 60): SearchResults {
    const q = ftsQuery(text)
    if (!q) return { items: [], highlights: [] }
    const rows = this.all(
      `SELECT i.id, i.source_id, i.guid, i.url, i.title, i.author, i.summary, i.image_url, i.published_at, i.fetched_at,
              i.read, i.later, i.bookmarked, i.favorite, i.format, i.position, i.progress, i.read_at,
              i.media_url, i.media_type, i.duration, i.transcript_url, i.categories, i.short, i.hidden,
              snippet(items_fts, '${HIT_OPEN}', '${HIT_CLOSE}', '…', -1, 14) AS snip,
              (SELECT COUNT(*) FROM highlights h WHERE h.item_id = i.id) AS highlight_count
       FROM items_fts JOIN items i ON i.rowid = items_fts.docid
       WHERE items_fts MATCH ?
       ORDER BY i.published_at DESC LIMIT 400`,
      [q]
    )
    const words = q.split(' ').map((w) => normalize(w.slice(0, -1)))
    const inTitle = (title: string): number => words.filter((w) => normalize(title).includes(w)).length
    const items = rows
      .map((r) => ({ item: this.toItem(r, []), snippet: r.snip as string }))
      .sort((a, b) => inTitle(b.item.title) - inTitle(a.item.title))
      .slice(0, limit)
    const highlights = this.all(
      `SELECT h.*, i.title AS item_title, snippet(highlights_fts, '${HIT_OPEN}', '${HIT_CLOSE}', '…', -1, 20) AS snip
       FROM highlights_fts JOIN highlights h ON h.rowid = highlights_fts.docid JOIN items i ON i.id = h.item_id
       WHERE highlights_fts MATCH ? ORDER BY h.updated_at DESC LIMIT ?`,
      [q, limit]
    ).map((r) => ({ highlight: this.toHighlight(r), itemTitle: r.item_title as string, snippet: r.snip as string }))
    return { items, highlights }
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
