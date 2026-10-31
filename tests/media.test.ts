import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { parseFeed } from '../src/main/feeds/parse'
import { resolveInput } from '../src/main/feeds/resolve'
import { parseTranscript } from '../src/main/media/transcript'
import { formatTime, parseDuration, timeLink, youtubeId } from '../src/shared/media'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'

const fx = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

describe('temps et liens', () => {
  it('lit et écrit des durées', () => {
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('45:10')).toBe(2710)
    expect(parseDuration('2710')).toBe(2710)
    expect(parseDuration('n/a')).toBeUndefined()
    expect(formatTime(754)).toBe('12:34')
    expect(formatTime(3723)).toBe('1:02:03')
  })

  it('reconnaît les vidéos YouTube et crée des liens horodatés', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe('abcdefghijk')
    expect(youtubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(timeLink('https://www.youtube.com/watch?v=abcdefghijk', 754.6, 'youtube')).toBe('https://youtu.be/abcdefghijk?t=754')
    expect(timeLink('https://cdn.example/ep.mp3', 60, 'audio')).toBe('https://cdn.example/ep.mp3#t=60')
  })
})

describe('flux de podcasts et de vidéos', () => {
  it('lit un podcast : fichier audio, durée, meilleure transcription, pochette', () => {
    const feed = parseFeed(fx('podcast.xml'), 'https://podcast.example/feed.xml')
    expect(feed.podcast).toBe(true)
    expect(feed.iconUrl).toBe('https://podcast.example/cover.jpg')
    expect(feed.items[0]).toMatchObject({
      title: 'Le télégraphe Chappe',
      mediaUrl: 'https://cdn.example/ep42.mp3',
      mediaType: 'audio',
      duration: 3723,
      transcriptUrl: 'https://podcast.example/ep42.vtt'
    })
    expect(feed.items[1]).toMatchObject({ mediaUrl: 'https://podcast.example/media/ep43.m4a', mediaType: 'audio', duration: 2710 })
  })

  it('n’identifie pas un blog ordinaire comme podcast', () => {
    expect(parseFeed(fx('rss2.xml'), 'https://journal.example/rss').podcast).toBe(false)
  })

  it('lit une chaîne YouTube : vidéo, miniature, description', () => {
    const feed = parseFeed(fx('youtube.xml'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q')
    expect(feed.youtube).toBe(true)
    expect(feed.items[0]).toMatchObject({
      mediaType: 'youtube',
      mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      imageUrl: 'https://i2.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      summary: 'Cables under the sea & routers. Second paragraph.'
    })
    expect(feed.items[0].contentHtml).toBe('<p>Cables under the sea &amp; routers.</p><p>Second paragraph.</p>')
  })

  it('résout les adresses YouTube', () => {
    expect(resolveInput('https://www.youtube.com/@kurzgesagt')).toMatchObject({ kind: 'youtube', url: 'https://www.youtube.com/@kurzgesagt' })
    expect(resolveInput('https://www.youtube.com/@kurzgesagt/videos').url).toBe('https://www.youtube.com/@kurzgesagt')
    expect(resolveInput('https://www.youtube.com/playlist?list=PL123')).toMatchObject({ kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=PL123' })
    expect(resolveInput('https://www.youtube.com/c/HugoDecrypte').url).toBe('https://www.youtube.com/c/HugoDecrypte')
  })
})

describe('transcriptions', () => {
  it('lit le WebVTT avec intervenants et regroupe les segments', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:04.000
<v Lorànt>Bienvenue dans cet épisode.

00:00:04.000 --> 00:00:08.000
<v Lorànt>On parle du télégraphe.

00:01:05.500 --> 00:01:09.000
<v Invitée>Et des réseaux modernes.`
    expect(parseTranscript(vtt)).toEqual([
      { start: 0, end: 8, text: 'Bienvenue dans cet épisode. On parle du télégraphe.', speaker: 'Lorànt' },
      { start: 65.5, end: 69, text: 'Et des réseaux modernes.', speaker: 'Invitée' }
    ])
  })

  it('lit le SRT', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nAlice: Bonjour\n\n2\n00:01:00,000 --> 00:01:02,000\nBob: Salut'
    expect(parseTranscript(srt)).toEqual([
      { start: 1, end: 3, text: 'Bonjour', speaker: 'Alice' },
      { start: 60, end: 62, text: 'Salut', speaker: 'Bob' }
    ])
  })

  it('lit le JSON Podcasting 2.0', () => {
    const json = JSON.stringify({ version: '1.0.0', segments: [{ speaker: 'A', startTime: 0.5, endTime: 1, body: 'Un' }, { speaker: 'A', startTime: 1, endTime: 2, body: 'deux' }] })
    expect(parseTranscript(json, 'application/json')).toEqual([{ start: 0.5, end: 2, text: 'Un deux', speaker: 'A' }])
  })

  it('lit le HTML et le texte sans horodatage', () => {
    expect(parseTranscript('<p>Premier.</p><p>Second.</p>')).toEqual([
      { start: -1, text: 'Premier.' },
      { start: -1, text: 'Second.' }
    ])
  })
})

describe('sources médias dans Learn', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/feed.xml') return res.end(fx('podcast.xml'))
    if (req.url === '/yt.xml') return res.end(fx('youtube.xml'))
    if (req.url === '/chaine') {
      res.setHeader('Content-Type', 'text/html')
      return res.end('<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/yt.xml"></head><body></body></html>')
    }
    if (req.url === '/ep42.vtt') return res.end('WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nBonjour.')
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const a = server.address()
  const base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  const store = await openDatabase(null)
  const core = new LearnCore(store, (u, i) => fetch(u, i))

  it('classe un podcast comme tel et garde les infos des épisodes', async () => {
    const s = await core.addSource({ input: `${base}/feed.xml` })
    expect(s.kind).toBe('podcast')
    const ep = store.listItems({ view: { type: 'kind', kind: 'podcast' } }).find((i) => i.guid === 'ep-42')!
    expect(ep).toMatchObject({ mediaType: 'audio', duration: 3723, mediaUrl: 'https://cdn.example/ep42.mp3' })
  })

  it('classe une chaîne YouTube trouvée depuis sa page', async () => {
    const s = await core.addSource({ input: `${base}/chaine` })
    expect(s).toMatchObject({ kind: 'youtube', title: 'Kurzgesagt – In a Nutshell' })
  })

  it('télécharge la transcription une fois, puis la sert depuis la base', async () => {
    const ep = store.listItems({ view: { type: 'kind', kind: 'podcast' } }).find((i) => i.guid === 'ep-42')!
    store.updateItem(ep.id, {})
    ;(store as unknown as { run(s: string, p: unknown[]): void }).run('UPDATE items SET transcript_url = ? WHERE id = ?', [`${base}/ep42.vtt`, ep.id])
    expect(await core.transcript(ep.id)).toEqual([{ start: 10, end: 12, text: 'Bonjour.' }])
    server.close()
    expect(await core.transcript(ep.id)).toEqual([{ start: 10, end: 12, text: 'Bonjour.' }])
  })

  it('exporte les moments notés avec leur horodatage', () => {
    const ep = store.listItems({ view: { type: 'kind', kind: 'podcast' } }).find((i) => i.guid === 'ep-42')!
    core.addHighlight({ itemId: ep.id, color: 'yellow', quote: 'Bonjour.', prefix: '', suffix: '', start: 754, end: 754, note: 'À retenir', layer: 't:754' })
    const md = core.markdownFor(ep.id)
    expect(md).toContain('type: podcast')
    expect(md).toContain('### 12:34')
    const video = store.listItems({ view: { type: 'kind', kind: 'youtube' } })[0]
    core.addHighlight({ itemId: video.id, color: 'yellow', quote: 'Câbles', prefix: '', suffix: '', start: 65, end: 65, note: '', layer: 't:65' })
    expect(core.markdownFor(video.id)).toContain('### [1:05](https://youtu.be/abcdefghijk?t=65)')
  })
})
