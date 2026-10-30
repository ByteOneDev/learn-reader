import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import type { LearnEvent } from '../src/shared/types'

// Intégration de bout en bout : vrai serveur HTTP local, vraie base SQLite (sql.js), vrai pipeline.
const fx = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let server: Server
let base = ''
let rssBody = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/rss') {
      res.setHeader('Content-Type', 'application/rss+xml')
      res.end(rssBody)
    } else if (url === '/atom') {
      res.setHeader('Content-Type', 'application/atom+xml')
      res.end(fx('atom.xml'))
    } else if (url === '/page' || url === '/chappe') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(fx('article.html').replace('/feed.xml', '/rss'))
    } else if (url === '/favicon.ico' || url === '/favicon.png') {
      res.setHeader('Content-Type', 'image/png')
      res.end(Buffer.concat([PNG, Buffer.alloc(80)]))
    } else {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  rssBody = fx('rss2.xml').replace(/https:\/\/journal\.example/g, base)
})

afterAll(() => {
  server.close()
})

describe('LearnCore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'learn-'))
  const dbFile = join(dir, 'learn.sqlite')
  const events: LearnEvent[] = []
  const store = await openDatabase(dbFile)
  const core = new LearnCore(store, (url, init) => fetch(url, init), (e) => events.push(e))

  it('s’abonne à un flux et importe ses articles', async () => {
    const s = await core.addSource({ input: `${base}/rss`, category: 'tech' })
    expect(s).toMatchObject({ kind: 'rss', title: 'Journal & Réseaux', category: 'tech' })
    const items = store.listItems({ view: { type: 'home' } })
    expect(items.map((i) => i.title)).toEqual(['BGP : le routage d’Internet enfin sécurisé ?', 'Deuxième article'])
    expect(events.some((e) => e.type === 'items-changed')).toBe(true)
  })

  it('découvre le flux depuis une page HTML et ignore les doublons', async () => {
    const again = await core.addSource({ input: `${base}/page` })
    expect(again.url).toBe(`${base}/rss`)
    expect(store.listSources()).toHaveLength(1)
  })

  it('récupère l’icône du site en data URL', async () => {
    await new Promise((r) => setTimeout(r, 200))
    expect(store.listSources()[0].icon?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('actualise sans doublons et compte les nouveautés', async () => {
    let r = await core.refresh()
    expect(r).toMatchObject({ sources: 1, newItems: 0, errors: [] })
    rssBody = rssBody.replace('<item>', `<item><title>Tout neuf</title><link>${base}/neuf</link><guid>neuf</guid><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item><item>`)
    r = await core.refresh()
    expect(r.newItems).toBe(1)
    expect(store.listItems({ view: { type: 'home' } })[0].title).toBe('Tout neuf')
  })

  it('signale une source en erreur sans bloquer les autres', async () => {
    await core.addSource({ input: `${base}/atom`, kind: 'forum' })
    const s = store.listSources().find((x) => x.kind === 'forum')!
    store.updateSource(s.id, {})
    // On casse l'adresse à la main pour simuler un flux disparu.
    ;(store as unknown as { run(sql: string, p: unknown[]): void }).run('UPDATE sources SET url = ? WHERE id = ?', [`${base}/disparu`, s.id])
    const r = await core.refresh()
    expect(r.errors).toEqual([{ sourceId: s.id, title: 'Le forum', error: 'HTTP 404' }])
    expect(store.getSource(s.id)?.error).toBe('HTTP 404')
  })

  it('gère les marques, tags et vues', () => {
    const [first] = store.listItems({ view: { type: 'home' } })
    store.updateItem(first.id, { later: true, favorite: true, tags: ['Réseau', 'Histoire', 'Réseau'] })
    expect(store.listItems({ view: { type: 'later' } }).map((i) => i.id)).toEqual([first.id])
    expect(store.listItems({ view: { type: 'tag', tag: 'Histoire' } })).toHaveLength(1)
    expect(store.getItem(first.id)?.tags).toEqual(['Histoire', 'Réseau'])
    expect(store.counts()).toMatchObject({ later: 1, favorites: 1, tags: { Histoire: 1, Réseau: 1 } })
    expect(store.listItems({ view: { type: 'home' }, search: 'BGP' })).toHaveLength(1)
  })

  it('extrait le texte complet d’une page (mode lecture)', async () => {
    const item = store.listItems({ view: { type: 'home' } }).find((i) => i.title.startsWith('BGP'))!
    store.updateItem(item.id, {})
    ;(store as unknown as { run(sql: string, p: unknown[]): void }).run('UPDATE items SET url = ? WHERE id = ?', [`${base}/chappe`, item.id])
    const full = await core.extractFullText(item.id)
    expect(full.fullHtml).toContain('télégraphe optique entre Paris et Lille')
    expect(full.fullHtml).toContain(`href="${base}/suite"`)
    expect(full.fullHtml).toContain(`src="${base}/images/tour.jpg"`)
    expect(full.fullHtml).not.toContain('Accueil')
  })

  it('enregistre un lien à lire plus tard', async () => {
    const saved = await core.saveLink(`${base}/chappe`)
    expect(saved).toMatchObject({ later: true })
    expect(saved.title).toContain('Chappe')
    expect(store.listItems({ view: { type: 'links' } })).toHaveLength(1)
    expect(store.listItems({ view: { type: 'home' } }).some((i) => i.id === saved.id)).toBe(false)
  })

  it('surligne, annote et exporte vers Obsidian en préservant les notes de l’utilisateur', () => {
    const item = store.listItems({ view: { type: 'home' } }).find((i) => i.title.startsWith('BGP'))!
    const h = core.addHighlight({ itemId: item.id, color: 'green', quote: 'premier réseau de données', prefix: '', suffix: '', start: 10, end: 35, note: '', layer: 'full' })
    store.updateHighlight(h.id, { note: 'Lien avec le **modèle OSI**' })
    const vault = join(dir, 'vault')
    store.updateSettings({ obsidianVault: vault, obsidianFolder: 'Learn' })

    const { path } = core.exportToObsidian(item.id)
    expect(path).toBe(join(vault, 'Learn', 'BGP le routage d’Internet enfin sécurisé.md'))
    const first = readFileSync(path, 'utf8')
    expect(first).toContain('> premier réseau de données')
    expect(first).toContain('Lien avec le **modèle OSI**')

    writeFileSync(path, first + '\n## Mes notes\n\nÀ creuser.\n')
    store.updateHighlight(h.id, { note: 'Note modifiée' })
    core.exportToObsidian(item.id)
    const second = readFileSync(path, 'utf8')
    expect(second).toContain('Note modifiée')
    expect(second).not.toContain('modèle OSI')
    expect(second.endsWith('## Mes notes\n\nÀ creuser.\n')).toBe(true)

    // Un fichier homonyme qui n'appartient pas à Learn n'est jamais écrasé.
    const other = store.listItems({ view: { type: 'links' } })[0]
    writeFileSync(join(vault, 'Learn', `${other.title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()}.md`), 'à moi\n')
    const out = core.exportToObsidian(other.id)
    expect(out.path.endsWith(' (2).md')).toBe(true)
  })

  it('exporte et réimporte les abonnements en OPML', async () => {
    const xml = core.exportOpml()
    expect(xml).toContain(`xmlUrl="${base}/rss"`)
    expect(xml).not.toContain('learn:links')
  })

  it('persiste la base sur disque et la rouvre à l’identique', async () => {
    store.flush()
    const reopened = await openDatabase(dbFile)
    expect(reopened.listSources().map((s) => s.title).sort()).toEqual(store.listSources().map((s) => s.title).sort())
    expect(reopened.listHighlights()).toHaveLength(1)
    expect(reopened.getSettings().obsidianFolder).toBe('Learn')
  })

  it('se désabonne sans perdre le travail : les articles annotés passent dans « Liens »', () => {
    const s = store.listSources().find((x) => x.kind === 'rss')!
    const before = store.listItems({ view: { type: 'source', sourceId: s.id } })
    const kept = before.filter((i) => i.later || i.favorite || i.bookmarked || i.tags.length || i.highlightCount)
    expect(kept.length).toBeGreaterThan(0)
    expect(before.length).toBeGreaterThan(kept.length)
    core.removeSource(s.id)
    expect(store.getSource(s.id)).toBeUndefined()
    expect(store.listHighlights()).toHaveLength(1)
    const links = store.listItems({ view: { type: 'links' }, limit: 500 }).map((i) => i.id)
    for (const k of kept) expect(links).toContain(k.id)
    // Les articles sans marque ont bien été supprimés en cascade (clés étrangères actives après flush).
    for (const i of before.filter((x) => !kept.includes(x))) expect(store.getItem(i.id)).toBeNull()
  })
})
