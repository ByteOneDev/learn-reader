import { describe, expect, it } from 'vitest'
import { channelIdFromHtml, fetchYoutubeFeed, isYoutubePage } from '../src/main/media/youtube'

const FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<yt:channelId>UCsXVk37bltHxD1rDPwtNM8Q</yt:channelId><title>Kurzgesagt</title>
<entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>Vidéo</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>${new Date().toISOString()}</published></entry></feed>`
const ID = 'UCsXVk37bltHxD1rDPwtNM8Q'

describe('chaînes YouTube', () => {
  it('lit l’identifiant de chaîne dans une page, et distingue page et flux', () => {
    expect(channelIdFromHtml(`<meta itemprop="identifier" content="${ID}">`)).toBe(ID)
    expect(channelIdFromHtml(`..."externalId":"${ID}",...`)).toBe(ID)
    expect(channelIdFromHtml('<html>consent</html>')).toBeUndefined()
    expect(isYoutubePage('https://www.youtube.com/@kurzgesagt')).toBe(true)
    expect(isYoutubePage(`https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`)).toBe(false)
  })

  it('passe par la page de la chaîne avec le consentement, puis par son flux', async () => {
    const calls: { url: string; cookie?: string }[] = []
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, cookie: (init?.headers as Record<string, string>)?.Cookie })
      return url.includes('/@') ? new Response(`<html><meta itemprop="identifier" content="${ID}"></html>`) : new Response(FEED)
    }
    const r = await fetchYoutubeFeed(fetchFn, 'https://www.youtube.com/@kurzgesagt')
    expect(r.feedUrl).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`)
    expect(r.feed.items).toHaveLength(1)
    expect(calls[0].cookie).toContain('SOCS=CAI')
  })

  it('réessaie le flux, puis passe par l’API YouTube si une clé est fournie', async () => {
    const urls: string[] = []
    const fetchFn = async (url: string): Promise<Response> => {
      urls.push(url)
      if (url.includes('feeds/videos.xml')) return new Response('', { status: 404 })
      return new Response(
        JSON.stringify({ items: [{ snippet: { title: 'Par l’API', videoOwnerChannelTitle: 'Kurzgesagt' }, contentDetails: { videoId: 'xyz', videoPublishedAt: new Date().toISOString() } }] })
      )
    }
    const r = await fetchYoutubeFeed(fetchFn, `https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`, 'CLE')
    expect(r.viaApi).toBe(true)
    expect(r.feed.title).toBe('Kurzgesagt')
    expect(r.feed.items[0]).toMatchObject({ guid: 'yt:video:xyz', title: 'Par l’API' })
    expect(urls.filter((u) => u.includes('feeds/videos.xml'))).toHaveLength(2)
    expect(urls.some((u) => u.includes('playlistId=UUsXVk37bltHxD1rDPwtNM8Q'))).toBe(true)
    // Sans clé : un message qui dit quoi faire.
    await expect(fetchYoutubeFeed(fetchFn, `https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`)).rejects.toThrow(/clé d’API YouTube/)
  }, 15_000)
})
