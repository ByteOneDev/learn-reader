import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { ftsQuery, snippetParts, HIT_OPEN, HIT_CLOSE } from '../src/shared/search'

describe('recherche plein texte', async () => {
  const store = await openDatabase(null)
  const now = Date.now()
  store.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://r.example/feed', createdAt: now })
  store.insertSource({ id: 's2', kind: 'rss', title: 'Réseaux', url: 'https://n.example/feed', createdAt: now })
  store.insertItems([
    { id: 'a', sourceId: 's', guid: 'a', title: 'Les échecs selon Carlsen', summary: 'Une partie mémorable', contentHtml: '<p>Le <b>roque</b> long</p>', publishedAt: now - 1000, fetchedAt: now },
    { id: 'b', sourceId: 's2', guid: 'b', title: 'Routage BGP', summary: 'Sécuriser Internet', publishedAt: now, fetchedAt: now },
    { id: 'c', sourceId: 's', guid: 'c', title: 'Divers', summary: 'On y parle de Carlsen en passant', publishedAt: now + 1000, fetchedAt: now }
  ])

  it('construit une requête sûre, en préfixes', () => {
    expect(ftsQuery('Échecs  carl')).toBe('échecs* carl*')
    expect(ftsQuery('"OR" -(*)')).toBe('or*')
    expect(ftsQuery('  ')).toBeNull()
  })

  it('trouve sans accents ni majuscules, dans le texte du flux, titres d’abord', () => {
    const r = store.search('ECHECS')
    expect(r.items.map((x) => x.item.id)).toEqual(['a'])
    expect(store.search('roque').items.map((x) => x.item.id)).toEqual(['a'])
    // « Carlsen » : le titre qui contient le mot passe devant l'article plus récent.
    expect(store.search('carl').items.map((x) => x.item.id)).toEqual(['a', 'c'])
    const parts = snippetParts(r.items[0].snippet)
    expect(parts.some((p) => p.hit && /échecs/i.test(p.text))).toBe(true)
  })

  it('suit le texte complet récupéré ensuite et les suppressions', () => {
    store.updateItem('b', { fullHtml: '<article><p>Le protocole <em>RPKI</em> valide les annonces.</p></article>' })
    expect(store.search('rpki').items.map((x) => x.item.id)).toEqual(['b'])
    expect(store.listItems({ view: { type: 'home' }, search: 'rpki' }).map((i) => i.id)).toEqual(['b'])
    store.removeSource('s2')
    expect(store.search('rpki').items).toEqual([])
  })

  it('cherche dans les surlignages et les notes', () => {
    store.insertHighlight({ id: 'h1', itemId: 'a', color: 'yellow', quote: 'une ouverture audacieuse', prefix: '', suffix: '', start: 0, end: 10, note: 'à revoir avant le tournoi', layer: 'feed', createdAt: now, updatedAt: now })
    expect(store.search('tournoi').highlights.map((h) => h.highlight.id)).toEqual(['h1'])
    expect(store.search('audacieuse').highlights[0].itemTitle).toBe('Les échecs selon Carlsen')
  })

  it('transforme un extrait HTML en segments de texte brut', () => {
    expect(snippetParts(`…<p>Le ${HIT_OPEN}roque${HIT_CLOSE} &amp; la <b>partie</b>`)).toEqual([
      { text: '… Le ', hit: false },
      { text: 'roque', hit: true },
      { text: ' & la partie', hit: false }
    ])
  })
})
