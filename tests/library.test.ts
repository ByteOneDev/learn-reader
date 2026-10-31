import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import { makeEpub } from './fixtures/makeEpub'

const noFetch = async (): Promise<Response> => {
  throw new Error('réseau désactivé')
}

describe('bibliothèque', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'learn-lib-'))
  const store = await openDatabase(null)
  const core = new LearnCore(store, noFetch, () => {}, join(dir, 'library'))
  const epubFile = join(dir, 'histoire-reseaux.epub')
  writeFileSync(epubFile, makeEpub(3))
  const pdfFile = join(dir, 'Notes_de_cours.pdf')
  writeFileSync(pdfFile, '%PDF-1.4\n%%EOF\n')

  it('importe un EPUB avec ses métadonnées et copie le fichier', () => {
    const book = core.importBook(epubFile)
    expect(book).toMatchObject({ title: 'Une brève histoire des réseaux', author: 'Inès Moreau', format: 'epub', progress: 0 })
    expect(book.imageUrl?.startsWith('data:image/png')).toBe(true)
    expect(existsSync(join(dir, 'library', `${book.id}.epub`))).toBe(true)
    expect(core.importBook(epubFile).id).toBe(book.id) // pas de doublon
  })

  it('importe un PDF en prenant le nom de fichier comme titre', () => {
    const r = core.importBooks([pdfFile, join(dir, 'image.png')])
    expect(r.added[0]).toMatchObject({ title: 'Notes de cours', format: 'pdf' })
    expect(r.failed).toEqual([{ file: 'image.png', error: 'Formats acceptés : EPUB et PDF' }])
    expect(Array.from(core.readBookFile(r.added[0].id))).toEqual(Array.from(readFileSync(pdfFile)))
  })

  it('range les livres dans la bibliothèque, pas dans l’accueil', () => {
    expect(store.listItems({ view: { type: 'library' } })).toHaveLength(2)
    expect(store.listItems({ view: { type: 'home' } })).toHaveLength(0)
    expect(store.counts().library).toBe(2)
  })

  it('sert la table des matières et les chapitres, et mémorise la position', () => {
    const book = store.listItems({ view: { type: 'library' } }).find((i) => i.format === 'epub')!
    expect(core.bookToc(book.id).map((e) => e.title)).toEqual(['Le temps des relais', 'Les codes', 'Naissance des protocoles'])
    expect(core.bookChapter(book.id, 1)).toMatchObject({ count: 2, title: 'Naissance des protocoles' })
    store.savePosition(book.id, JSON.stringify({ chapter: 1, scroll: 0.5 }), 0.75)
    expect(store.getItem(book.id)).toMatchObject({ position: '{"chapter":1,"scroll":0.5}', progress: 0.75 })
  })

  it('exporte les surlignages d’un livre regroupés par chapitre', () => {
    const book = store.listItems({ view: { type: 'library' } }).find((i) => i.format === 'epub')!
    const base = { itemId: book.id, color: 'yellow' as const, prefix: '', suffix: '', note: '' }
    core.addHighlight({ ...base, quote: 'TCP garantit', start: 0, end: 12, layer: 'ch:1' })
    core.addHighlight({ ...base, quote: 'Les tours Chappe', start: 20, end: 36, layer: 'ch:0' })
    core.addHighlight({ ...base, quote: 'relayaient', start: 40, end: 50, layer: 'ch:0' })
    const md = core.markdownFor(book.id)
    expect(md).toContain('type: book')
    const a = md.indexOf('### Le temps des relais')
    const b = md.indexOf('### Naissance des protocoles')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(md.indexOf('> Les tours Chappe')).toBeGreaterThan(a)
    expect(md.indexOf('> relayaient')).toBeLessThan(b)
    expect(md.indexOf('> TCP garantit')).toBeGreaterThan(b)
    expect(md.match(/### Le temps des relais/g)).toHaveLength(1)

    const pdf = store.listItems({ view: { type: 'library' } }).find((i) => i.format === 'pdf')!
    core.addHighlight({ ...base, itemId: pdf.id, quote: 'page douze', start: 0, end: 10, layer: 'p:11' })
    expect(core.markdownFor(pdf.id)).toContain('### Page 12')
  })
})

describe('bilan de lecture', async () => {
  const store = await openDatabase(null)
  const now = Date.now()
  for (const [id, leaning] of [
    ['g', -2],
    ['c', 0],
    ['d', 2]
  ] as const) {
    store.insertSource({ id, kind: 'rss', title: id, url: `https://${id}.example/feed`, leaning, createdAt: now })
  }
  store.insertSource({ id: 't', kind: 'rss', title: 'tech', url: 'https://t.example/feed', createdAt: now })
  const mk = (sourceId: string, n: number): void => {
    store.insertItems(Array.from({ length: n }, (_, k) => ({ id: `${sourceId}${k}`, sourceId, guid: `${sourceId}${k}`, title: 'x', publishedAt: now, fetchedAt: now })))
    for (let k = 0; k < n; k++) store.updateItem(`${sourceId}${k}`, { read: true })
  }
  mk('g', 3)
  mk('d', 1)
  mk('t', 4)

  it('compte les lectures par orientation sur la période', () => {
    const b = store.readingBalance(30)
    expect(b.entries.map((e) => [e.sourceId, e.reads])).toEqual([
      ['g', 3],
      ['c', 0],
      ['d', 1]
    ])
    expect(b.otherReads).toBe(4)
  })

  it('oublie la date de lecture quand on remet en non lu', () => {
    store.updateItem('g0', { read: false })
    expect(store.readingBalance(30).entries[0].reads).toBe(2)
  })
})

describe('migration', () => {
  it('met à niveau une base de la v0.1 sans perte', async () => {
    const SQL = await initSqlJs()
    const v1 = new SQL.Database()
    v1.run(`CREATE TABLE sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, site_url TEXT, icon TEXT, category TEXT, lang TEXT, created_at INTEGER NOT NULL, last_fetched_at INTEGER, error TEXT);
      CREATE TABLE items (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT, title TEXT NOT NULL, author TEXT, summary TEXT, content_html TEXT, full_html TEXT, image_url TEXT, published_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, later INTEGER NOT NULL DEFAULT 0, bookmarked INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, UNIQUE (source_id, guid));
      CREATE INDEX items_published ON items (published_at DESC);
      CREATE INDEX items_source ON items (source_id, published_at DESC);
      CREATE TABLE item_tags (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (item_id, tag));
      CREATE TABLE highlights (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, color TEXT NOT NULL, quote TEXT NOT NULL, prefix TEXT NOT NULL, suffix TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', layer TEXT NOT NULL DEFAULT 'feed', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
      INSERT INTO sources VALUES ('s', 'rss', 'Ancienne source', 'https://old.example/feed', NULL, NULL, NULL, NULL, 1, NULL, NULL);
      INSERT INTO items (id, source_id, guid, title, published_at, fetched_at, read) VALUES ('i', 's', 'g', 'Ancien article', 1, 1, 1);
      INSERT INTO highlights VALUES ('h', 'i', 'blue', 'q', '', '', 0, 1, 'note', 'feed', 1, 1);`)
    const file = join(mkdtempSync(join(tmpdir(), 'learn-mig-')), 'learn.sqlite')
    writeFileSync(file, Buffer.from(v1.export()))

    const store = await openDatabase(file)
    expect(store.getItem('i')).toMatchObject({ title: 'Ancien article', read: true, progress: 0, format: undefined })
    expect(store.listHighlights('i')[0]).toMatchObject({ note: 'note', layer: 'feed' })
    expect(store.listSources()[0]).toMatchObject({ title: 'Ancienne source', leaning: undefined })
    store.updateSource('s', { leaning: -1 })
    expect(store.readingBalance(30).entries[0].leaning).toBe(-1)
  })
})
