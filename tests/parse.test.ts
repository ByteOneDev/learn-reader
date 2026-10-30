import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { discoverFeeds, discoverIcons, NotAFeedError, parseFeed } from '../src/main/feeds/parse'

const fx = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseFeed', () => {
  it('lit un flux RSS 2.0 avec content:encoded, auteur et image média', () => {
    const feed = parseFeed(fx('rss2.xml'), 'https://journal.example/rss')
    expect(feed.title).toBe('Journal & Réseaux')
    expect(feed.siteUrl).toBe('https://journal.example/')
    expect(feed.items).toHaveLength(2)
    const [a, b] = feed.items
    expect(a.title).toBe('BGP : le routage d’Internet enfin sécurisé ?')
    expect(a.guid).toBe('bgp-2026')
    expect(a.author).toBe('Claire Martin')
    expect(a.url).toBe('https://journal.example/bgp')
    expect(a.contentHtml).toContain('<a href="/lien">')
    expect(a.imageUrl).toBe('https://cdn.example/bgp-large.jpg')
    expect(a.summary).toBe('Un résumé court.')
    expect(a.publishedAt).toBe(Date.parse('2026-10-29T16:49:00Z'))
    expect(b.imageUrl).toBe('https://cdn.example/deux.png')
    expect(b.guid).toBe('https://journal.example/deux')
    expect(b.summary).toBe('Texte simple & échappé deux fois.')
  })

  it('lit un flux Atom', () => {
    const feed = parseFeed(fx('atom.xml'), 'https://forum.example/feed.atom')
    expect(feed.title).toBe('Le forum')
    expect(feed.siteUrl).toBe('https://forum.example/')
    expect(feed.iconUrl).toBe('https://forum.example/favicon.png')
    const [e] = feed.items
    expect(e.url).toBe('https://forum.example/news/noyau')
    expect(e.author).toBe('Inès')
    expect(e.contentHtml).toBe('<p>Les nouveautés du noyau.</p>')
    expect(e.guid).toBe('tag:forum.example,2026:1')
  })

  it('donne un titre aux messages sans titre (Mastodon, Bluesky)', () => {
    const feed = parseFeed(fx('mastodon.xml'), 'https://mastodon.example/@exemple.rss')
    const [p] = feed.items
    expect(p.title.startsWith('Lecture du jour : un fil passionnant')).toBe(true)
    expect(p.imageUrl).toBe('https://mastodon.example/media/1.jpg')
    expect(feed.iconUrl).toBe('https://mastodon.example/avatar.png')
  })

  it('lit un flux RSS 1.0 (RDF)', () => {
    const feed = parseFeed(fx('rdf.xml'), 'https://rdf.example/rss')
    expect(feed.title).toBe('Vieux flux RDF')
    expect(feed.items[0].title).toBe('Un article RDF')
    expect(feed.items[0].publishedAt).toBe(Date.parse('2026-10-01T12:00:00Z'))
  })

  it('lit un JSON Feed', () => {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Blog JSON',
      home_page_url: 'https://json.example/',
      items: [{ id: '1', url: 'https://json.example/1', title: 'Bonjour', content_html: '<p>Salut</p>', date_published: '2026-10-02T00:00:00Z', authors: [{ name: 'A' }] }]
    })
    const feed = parseFeed(json, 'https://json.example/feed.json')
    expect(feed.title).toBe('Blog JSON')
    expect(feed.items[0]).toMatchObject({ guid: '1', title: 'Bonjour', author: 'A', summary: 'Salut' })
  })

  it('refuse une page HTML', () => {
    expect(() => parseFeed(fx('article.html'), 'https://x.example/')).toThrow(NotAFeedError)
  })
})

describe('découverte', () => {
  it('trouve les flux et icônes annoncés par une page', () => {
    expect(discoverFeeds(fx('article.html'), 'https://revue.example/chappe')).toEqual(['https://revue.example/feed.xml'])
    expect(discoverIcons(fx('article.html'), 'https://revue.example/chappe')).toEqual(['https://revue.example/favicon.ico'])
  })
})
