import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'

// Une base telle que la laissait la v0.14 (avant la recherche plein texte et le hors ligne), avec des données :
// la nouvelle version doit l'ouvrir, construire l'index et tout retrouver.
describe('mise à niveau d’une base existante', () => {
  it('ouvre une base v0.14 remplie et indexe son contenu', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'learn-mig-')), 'learn.sqlite')
    const fresh = await openDatabase(file)
    const now = Date.now()
    fresh.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://r.example/feed', createdAt: now })
    fresh.insertItems([{ id: 'a', sourceId: 's', guid: 'a', title: 'Les échecs de Carlsen', summary: 'Partie mémorable', publishedAt: now, fetchedAt: now }])
    fresh.insertHighlight({ id: 'h', itemId: 'a', color: 'green', quote: 'ouverture audacieuse', prefix: '', suffix: '', start: 0, end: 5, note: '', layer: 'feed', createdAt: now, updatedAt: now })
    fresh.close()

    // On ramène la base à l'état v0.14 : sans index ni colonne hors ligne (version de schéma 8).
    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(file))
    db.run(`DROP TRIGGER items_fts_ai; DROP TRIGGER items_fts_au; DROP TRIGGER items_fts_bu; DROP TRIGGER items_fts_bd;
            DROP TRIGGER highlights_fts_ai; DROP TRIGGER highlights_fts_au; DROP TRIGGER highlights_fts_bu; DROP TRIGGER highlights_fts_bd;
            DROP TABLE items_fts; DROP TABLE highlights_fts; ALTER TABLE items DROP COLUMN offline_at; PRAGMA user_version = 8;`)
    writeFileSync(file, Buffer.from(db.export()))
    db.close()

    const store = await openDatabase(file)
    expect(store.search('echecs').items.map((x) => x.item.id)).toEqual(['a'])
    expect(store.search('audacieuse').highlights.map((x) => x.highlight.id)).toEqual(['h'])
    expect(store.getItem('a')?.offlineAt).toBeUndefined()
    expect(store.listItems({ view: { type: 'home' } })).toHaveLength(1)
    store.close()
  })
})
