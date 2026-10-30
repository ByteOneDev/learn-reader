import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildOpml, parseOpml } from '../src/main/opml'

describe('OPML', () => {
  it('lit un export Reeder avec dossiers', () => {
    const feeds = parseOpml(readFileSync(new URL('./fixtures/feeds.opml', import.meta.url), 'utf8'))
    expect(feeds).toEqual([
      { url: 'https://www.numerama.com/feed/', title: 'Numerama', siteUrl: 'https://www.numerama.com', category: 'Tech' },
      { url: 'https://www.reddit.com/r/linux/.rss', title: 'r/linux', siteUrl: undefined, category: 'Tech' },
      { url: 'https://solo.example/feed', title: 'Sans dossier', siteUrl: undefined, category: undefined }
    ])
  })

  it('aller-retour sans perte', () => {
    const xml = buildOpml([
      { id: '1', kind: 'rss', title: 'A & B', url: 'https://a.example/feed?x=1&y=2', category: 'Tech', createdAt: 0 },
      { id: '2', kind: 'rss', title: 'Seul', url: 'https://b.example/feed', createdAt: 0 },
      { id: '3', kind: 'links', title: 'Liens', url: 'learn:links', createdAt: 0 }
    ])
    expect(parseOpml(xml)).toEqual([
      { url: 'https://a.example/feed?x=1&y=2', title: 'A & B', siteUrl: undefined, category: 'Tech' },
      { url: 'https://b.example/feed', title: 'Seul', siteUrl: undefined, category: undefined }
    ])
  })
})
