import { describe, expect, it } from 'vitest'
import { embedImages, MAX_IMAGE_BYTES } from '../src/main/offline'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'

const PNG = Buffer.alloc(400, 7)
const fakeFetch = async (url: string): Promise<Response> => {
  if (url.endsWith('.svg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
  if (url.includes('huge')) return new Response(Buffer.alloc(MAX_IMAGE_BYTES + 10), { headers: { 'content-type': 'image/jpeg' } })
  if (url.match(/\.(png|jpg)$/)) return new Response(PNG, { headers: { 'content-type': 'image/png' } })
  if (url.includes('/article')) return new Response('<html><head><title>T</title></head><body><article><h1>Titre</h1><p>' + 'Un long texte. '.repeat(80) + '</p><img src="/img/a.png"></article></body></html>', { headers: { 'content-type': 'text/html' } })
  if (url.includes('/paywall')) return new Response('', { status: 403 })
  return new Response('', { status: 404 })
}

describe('lecture hors ligne', () => {
  it('intègre les images (sans SVG ni images trop lourdes) et ajoute l’image d’en-tête', async () => {
    const r = await embedImages(fakeFetch, '<p>x</p><img src="a.png" srcset="a-2x.png 2x"><img src="b.svg"><img src="huge.jpg">', 'https://s.example/post/', 'https://s.example/hero.jpg')
    expect(r.images).toBe(2)
    expect(r.html).toContain('data-learn-hero')
    expect(r.html.match(/data:image\/png;base64/g)).toHaveLength(2)
    expect(r.html).not.toContain('srcset')
    expect(r.html).toContain('b.svg')
    expect(r.html).toContain('huge.jpg')
  })

  it('prépare les articles gardés et ne réessaie pas en boucle une page inaccessible', async () => {
    const store = await openDatabase(null)
    const core = new LearnCore(store, fakeFetch)
    const now = Date.now()
    store.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://s.example/feed', createdAt: now })
    store.insertItems([
      { id: 'a', sourceId: 's', guid: 'a', url: 'https://s.example/article', title: 'Gardé', publishedAt: now, fetchedAt: now },
      { id: 'b', sourceId: 's', guid: 'b', url: 'https://s.example/paywall', title: 'Payant', publishedAt: now, fetchedAt: now },
      { id: 'c', sourceId: 's', guid: 'c', url: 'https://s.example/article', title: 'Pas gardé', publishedAt: now, fetchedAt: now }
    ])
    store.updateItem('a', { later: true })
    store.updateItem('b', { favorite: true })
    expect(await core.prepareOffline()).toBe(1)
    const a = store.getItem('a')!
    expect(a.offlineAt).toBeGreaterThan(0)
    expect(a.fullHtml).toContain('Un long texte')
    expect(a.fullHtml).toContain('data:image/png;base64')
    expect(store.getItem('b')!.offlineAt).toBe(0)
    expect(store.getItem('c')!.offlineAt).toBeUndefined()
    expect(store.offlineQueue()).toHaveLength(0)
    // Désactivé dans les réglages : rien n'est préparé.
    store.updateSettings({ offline: false })
    store.updateItem('c', { bookmarked: true })
    expect(await core.prepareOffline()).toBe(0)
  })
})
