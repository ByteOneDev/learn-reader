import { describe, expect, it } from 'vitest'
import { catalog } from '../src/shared/catalog'
import { isSubscribed, normalize, searchCatalog, suggestSources } from '../src/shared/suggest'
import type { Source } from '../src/shared/types'

const src = (p: Partial<Source>): Source => ({ id: p.title ?? p.url ?? 'x', kind: 'rss', title: '?', url: 'https://x/', createdAt: 0, ...p })
const base = { categories: catalog.categories, entries: catalog.entries, lang: 'fr' as const }

describe('sources conseillées', () => {
  it('reconnaît une source déjà suivie par adresse, subreddit, compte YouTube ou titre', () => {
    const numerama = catalog.entries.find((e) => e.id === 'fr-tech-numerama')!
    expect(isSubscribed(numerama, [src({ url: 'http://numerama.com/feed' })])).toBe(true)
    expect(isSubscribed(numerama, [src({ url: 'https://autre/feed', title: 'NUMERAMA' })])).toBe(true)
    expect(isSubscribed(numerama, [src({ url: 'https://autre/feed', title: 'Autre' })])).toBe(false)
    const reddit = catalog.entries.find((e) => e.kind === 'reddit')!
    const sub = /r\/([\w-]+)/.exec(reddit.input)![1]
    expect(isSubscribed(reddit, [src({ kind: 'reddit', title: 'x', url: `https://www.reddit.com/r/${sub}/.rss` })])).toBe(true)
    const yt = catalog.entries.find((e) => e.kind === 'youtube' && /@/.test(e.input))!
    const handle = /@[\w.-]+/.exec(yt.input)![0]
    expect(isSubscribed(yt, [src({ kind: 'youtube', title: 'x', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1', siteUrl: `https://www.youtube.com/${handle}` })])).toBe(true)
  })

  it('propose d’abord la catégorie la plus suivie, sans les sources déjà abonnées', () => {
    const tech = catalog.entries.filter((e) => e.category === 'tech' && e.lang === 'fr').slice(0, 3)
    const sources = [
      ...tech.map((e) => src({ title: e.title, url: e.input, category: 'tech' })),
      src({ title: 'Mon blog d’histoire', url: 'https://h/feed', category: 'histoire' })
    ]
    const groups = suggestSources({ ...base, sources })
    expect(groups[0]).toMatchObject({ category: 'tech', followed: true })
    expect(groups[1]).toMatchObject({ category: 'histoire', followed: true })
    expect(groups.slice(2).every((g) => !g.followed)).toBe(true)
    const shown = groups[0].entries.map((e) => e.id)
    expect(shown).toHaveLength(5)
    for (const e of tech) expect(shown).not.toContain(e.id)
    // Français d'abord, et pas cinq fois le même type de suite.
    expect(groups[0].entries[0].lang).toBe('fr')
    expect(new Set(groups[0].entries.map((e) => e.kind)).size).toBeGreaterThan(1)
  })

  it('rééquilibre la politique : l’orientation la moins lue passe devant', () => {
    const left = catalog.entries.filter((e) => e.category === 'politique' && (e.leaning ?? 0) < 0)
    const sources = left.map((e) => src({ title: e.title, url: e.input, category: 'politique', leaning: e.leaning }))
    const politics = suggestSources({ ...base, sources }).find((g) => g.category === 'politique')!
    expect(politics.entries.length).toBeGreaterThan(0)
    expect(politics.entries[0].leaning ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('sans aucun abonnement, montre toutes les catégories', () => {
    const groups = suggestSources({ ...base, sources: [] })
    expect(groups.length).toBe(catalog.categories.length)
    expect(groups.every((g) => !g.followed && g.entries.length > 0)).toBe(true)
  })

  it('cherche dans le catalogue par titre ou par catégorie, sans accents', () => {
    const micode = catalog.entries.find((e) => /micode/i.test(e.title))
    if (micode) expect(searchCatalog({ ...base, sources: [], query: 'mico' })[0].id).toBe(micode.id)
    const hist = searchCatalog({ ...base, sources: [], query: 'HISTOIRE' })
    expect(hist.length).toBeGreaterThan(0)
    expect(searchCatalog({ ...base, sources: [], query: 'sante' }).length).toBeGreaterThan(0)
    expect(searchCatalog({ ...base, sources: [], query: 'a' })).toEqual([])
    expect(normalize('Le Monde — Santé')).toBe('lemondesante')
  })
})
