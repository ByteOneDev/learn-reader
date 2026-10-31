import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeName, pickPodcast } from '../src/main/feeds/podcastSearch'
import { resolveInput } from '../src/main/feeds/resolve'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'

const results = [
  { title: 'Choses à Savoir', feedUrl: 'https://a.example/rss' },
  { title: 'Choses à Savoir TECH', feedUrl: 'https://b.example/rss' },
  { title: 'Choses à Savoir SANTÉ', feedUrl: 'https://c.example/rss' }
]

describe('recherche de podcasts', () => {
  it('normalise les noms (accents, ponctuation, casse)', () => {
    expect(normalizeName('ÊTRE ÉTUDIANT — Le Podcast')).toBe('etre etudiant le podcast')
  })

  it('préfère le nom exact, puis le nom inclus, puis le premier résultat', () => {
    expect(pickPodcast(results, 'choses a savoir tech')?.feedUrl).toBe('https://b.example/rss')
    expect(pickPodcast(results, 'Savoir SANTÉ')?.feedUrl).toBe('https://c.example/rss')
    expect(pickPodcast(results, 'Rien à voir')?.feedUrl).toBe('https://a.example/rss')
    expect(pickPodcast([], 'x')).toBeUndefined()
  })

  it('accepte « podcast:Nom » comme entrée', () => {
    expect(resolveInput('podcast:Choses à Savoir TECH')).toEqual({ kind: 'podcast', url: 'podcast:Choses à Savoir TECH', title: 'Choses à Savoir TECH' })
    expect(() => resolveInput('podcast:  ')).toThrow()
  })

  it('s’abonne à un podcast par son nom, sans doublon', async () => {
    const calls: string[] = []
    const fetchFn = async (url: string): Promise<Response> => {
      calls.push(url)
      if (url.startsWith('https://itunes.apple.com/search')) {
        return new Response(JSON.stringify({ results: [{ collectionName: 'Autre', feedUrl: 'https://autre.example/rss' }, { collectionName: "Entrez dans l'Histoire", artistName: 'RTL', feedUrl: 'https://podcast.example/feed.xml' }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'https://podcast.example/feed.xml') return new Response(readFileSync(new URL('./fixtures/podcast.xml', import.meta.url), 'utf8'))
      return new Response('not found', { status: 404 })
    }
    const store = await openDatabase(null)
    const core = new LearnCore(store, fetchFn)
    const s = await core.addSource({ input: "podcast:Entrez dans l'Histoire", kind: 'podcast' })
    expect(s).toMatchObject({ kind: 'podcast', url: 'https://podcast.example/feed.xml' })
    expect(calls[0]).toContain('term=Entrez%20dans%20l\'Histoire')
    expect((await core.addSource({ input: "podcast:Entrez dans l'Histoire" })).id).toBe(s.id)
    expect(store.listSources()).toHaveLength(1)
  })
})
