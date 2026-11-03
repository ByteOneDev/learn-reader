import { describe, expect, it } from 'vitest'
import { containsTerm, filterIsActive, itemPasses, looksLikeShort } from '../src/shared/filters'

const item = { title: 'Les échecs et l’IA : Carlsen bat Stockfish', author: 'Claire', summary: 'Un article sur les bons plans', categories: ['Échecs', 'Tech'] }

describe('filtres d’articles', () => {
  it('cherche des mots entiers, sans tenir compte des accents ni des majuscules', () => {
    expect(containsTerm(item.title, 'ECHECS')).toBe(true)
    expect(containsTerm(item.title, 'carlsen bat')).toBe(true)
    expect(containsTerm('Un article', 'art')).toBe(false)
    expect(containsTerm('C++ moderne', 'c++')).toBe(true)
  })

  it('masque ou garde selon les champs choisis', () => {
    expect(itemPasses(item, { mode: 'hide', terms: ['bons plans'], fields: ['title'] })).toBe(true)
    expect(itemPasses(item, { mode: 'hide', terms: ['bons plans'], fields: ['summary'] })).toBe(false)
    expect(itemPasses(item, { mode: 'keep', terms: ['tech'], fields: ['categories'] })).toBe(true)
    expect(itemPasses(item, { mode: 'keep', terms: ['sport'], fields: ['categories'] })).toBe(false)
    expect(itemPasses(item, { mode: 'keep', terms: [], fields: ['categories'] })).toBe(true)
  })

  it('applique les mots masqués partout et les Shorts', () => {
    expect(itemPasses(item, null, ['stockfish'])).toBe(false)
    expect(itemPasses({ title: 'Vidéo', short: true }, { mode: 'hide', terms: [], fields: [], hideShorts: true })).toBe(false)
    expect(filterIsActive({ mode: 'hide', terms: [' '], fields: [] })).toBe(false)
    expect(looksLikeShort('https://www.youtube.com/shorts/abc', 'x')).toBe(true)
    expect(looksLikeShort('https://www.youtube.com/watch?v=abc', 'Mon astuce #shorts')).toBe(true)
    expect(looksLikeShort('https://www.youtube.com/watch?v=abc', 'Vidéo longue')).toBe(false)
  })
})

import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'

describe('filtres dans Learn', async () => {
  const store = await openDatabase(null)
  const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Tech</title><link>https://t.example/</link>
    <item><title>Nouveau processeur</title><link>https://t.example/1</link><guid>1</guid><category>Matériel</category></item>
    <item><title>Les bons plans du jour</title><link>https://t.example/2</link><guid>2</guid><category>Bons plans</category></item>
    <item><title>Sponsorisé : un VPN</title><link>https://t.example/3</link><guid>3</guid></item></channel></rss>`
  const core = new LearnCore(store, async () => new Response(RSS))
  const source = await core.addSource({ input: 'https://t.example/feed.xml' })
  const titles = (showHidden = false): string[] => store.listItems({ view: { type: 'source', sourceId: source.id }, showHidden }).map((i) => i.title).sort()

  it('garde les catégories du flux et masque sans supprimer', () => {
    expect(store.listItems({ view: { type: 'source', sourceId: source.id } }).find((i) => i.title.startsWith('Nouveau'))?.categories).toEqual(['Matériel'])
    const r = core.setSourceFilter(source.id, { mode: 'hide', terms: ['bons plans'], fields: ['categories'] })
    expect(r).toEqual({ total: 3, hidden: 1 })
    expect(titles()).toEqual(['Nouveau processeur', 'Sponsorisé : un VPN'])
    expect(titles(true)).toHaveLength(3)
    // Ce qu'on a mis de côté reste visible dans « Plus tard ».
    const bp = store.listItems({ view: { type: 'source', sourceId: source.id }, showHidden: true }).find((i) => i.title.includes('bons plans'))!
    store.updateItem(bp.id, { later: true })
    expect(store.listItems({ view: { type: 'later' } }).map((i) => i.id)).toContain(bp.id)
  })

  it('applique les mots masqués partout, puis retire un filtre', () => {
    store.updateSettings({ hiddenTerms: ['sponsorisé'] })
    core.applyGlobalFilter()
    expect(titles()).toEqual(['Nouveau processeur'])
    store.updateSettings({ hiddenTerms: [] })
    core.setSourceFilter(source.id, null)
    expect(store.getSource(source.id)?.filter).toBeUndefined()
    expect(titles()).toHaveLength(3)
  })

  it('prévisualise un filtre « garder seulement » avec les catégories du flux', () => {
    const p = core.previewSourceFilter(source.id, { mode: 'keep', terms: ['matériel'], fields: ['categories'] })
    expect(p).toMatchObject({ total: 3, hidden: 2 })
    expect(p.categories.map((c) => c.name).sort()).toEqual(['Bons plans', 'Matériel'])
  })
})
