import { XMLParser } from 'fast-xml-parser'
import { decodeEntities, htmlToText, truncate } from '@shared/util'
import { parseDuration } from '@shared/media'
import type { MediaType } from '@shared/types'

export interface ParsedItem {
  guid: string
  url?: string
  title: string
  author?: string
  summary?: string
  contentHtml?: string
  imageUrl?: string
  publishedAt?: number
  mediaUrl?: string
  mediaType?: MediaType
  duration?: number
  transcriptUrl?: string
}

export interface ParsedFeed {
  title: string
  siteUrl?: string
  iconUrl?: string
  /** Flux de podcast (espace de noms iTunes ou épisodes audio). */
  podcast?: boolean
  /** Flux d'une chaîne ou d'une playlist YouTube. */
  youtube?: boolean
  items: ParsedItem[]
}

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'media:content', 'media:thumbnail', 'enclosure', 'category', 'author', 'podcast:transcript'])

// Formats de transcription, du plus riche au plus pauvre (horodatage d'abord).
const TRANSCRIPT_TYPES = ['text/vtt', 'application/x-subrip', 'application/srt', 'application/json', 'text/html', 'text/plain']

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ARRAY_TAGS.has(name)
})

type Node = Record<string, unknown> | string | undefined

function text(n: unknown): string {
  if (n == null) return ''
  if (typeof n === 'string') return n
  if (typeof n === 'number') return String(n)
  if (Array.isArray(n)) return text(n[0])
  if (typeof n === 'object') {
    const o = n as Record<string, unknown>
    if ('#text' in o) return text(o['#text'])
    if ('name' in o) return text(o.name)
  }
  return ''
}

function attr(n: unknown, name: string): string | undefined {
  if (n && typeof n === 'object' && !Array.isArray(n)) {
    const v = (n as Record<string, unknown>)['@_' + name]
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

function arr(n: unknown): Node[] {
  if (n == null) return []
  return (Array.isArray(n) ? n : [n]) as Node[]
}

function parseDate(s: string): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

function absolutize(href: string | undefined, base?: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).href
  } catch {
    return undefined
  }
}

export function firstImage(html?: string, base?: string): string | undefined {
  if (!html) return undefined
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m ? absolutize(decodeEntities(m[1]), base) : undefined
}

function mediaImage(it: Record<string, unknown>, base?: string): string | undefined {
  for (const key of ['media:thumbnail', 'media:content']) {
    for (const m of arr(it[key])) {
      const url = attr(m, 'url')
      const medium = attr(m, 'medium')
      const type = attr(m, 'type')
      if (url && (key === 'media:thumbnail' || medium === 'image' || type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url))) {
        return absolutize(url, base)
      }
    }
  }
  const group = it['media:group'] as Record<string, unknown> | undefined
  if (group) {
    const thumb = arr(group['media:thumbnail'])[0]
    if (attr(thumb, 'url')) return absolutize(attr(thumb, 'url'), base)
  }
  for (const e of arr(it.enclosure)) {
    const url = attr(e, 'url')
    if (url && (attr(e, 'type') ?? '').startsWith('image/')) return absolutize(url, base)
  }
  const itunes = it['itunes:image']
  if (attr(itunes, 'href')) return absolutize(attr(itunes, 'href'), base)
  return undefined
}

/** Épisode : fichier audio ou vidéo joint, durée iTunes, transcription Podcasting 2.0. */
function mediaOf(it: Record<string, unknown>, base?: string): Pick<ParsedItem, 'mediaUrl' | 'mediaType' | 'duration' | 'transcriptUrl'> {
  const out: Pick<ParsedItem, 'mediaUrl' | 'mediaType' | 'duration' | 'transcriptUrl'> = {}
  const candidates = [...arr(it.enclosure), ...arr(it['media:content'])]
  for (const e of candidates) {
    const url = attr(e, 'url')
    const type = (attr(e, 'type') ?? '').toLowerCase()
    const kind: MediaType | undefined =
      type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i.test(url ?? '') ? 'audio' : type.startsWith('video/') || /\.(mp4|m4v|mov|webm)(\?|$)/i.test(url ?? '') ? 'video' : undefined
    if (url && kind) {
      out.mediaUrl = absolutize(url, base)
      out.mediaType = kind
      break
    }
  }
  out.duration = parseDuration(text(it['itunes:duration']))
  const transcripts = arr(it['podcast:transcript'])
    .map((t) => ({ url: attr(t, 'url'), type: (attr(t, 'type') ?? '').toLowerCase() }))
    .filter((t) => t.url)
    .sort((a, b) => (TRANSCRIPT_TYPES.indexOf(a.type) + 1 || 99) - (TRANSCRIPT_TYPES.indexOf(b.type) + 1 || 99))
  if (transcripts[0]) out.transcriptUrl = absolutize(transcripts[0].url, base)
  return out
}

function finishItem(p: ParsedItem): ParsedItem {
  const summarySource = p.summary || p.contentHtml || ''
  const plain = htmlToText(summarySource)
  p.summary = plain ? truncate(plain, 320) : undefined
  // Mastodon, Bluesky : pas de titre, on prend le début du message.
  if (!p.title) p.title = plain ? truncate(plain, 110) : p.url ?? 'Sans titre'
  p.title = htmlToText(p.title)
  if (!p.imageUrl) p.imageUrl = firstImage(p.contentHtml, p.url)
  p.guid = p.guid || p.url || `${p.title}|${p.publishedAt ?? ''}`
  return p
}

function parseRss(channel: Record<string, unknown>, items: Node[], feedUrl: string): ParsedFeed {
  const siteUrl = absolutize(text(arr(channel.link).find((l) => typeof l === 'string' || !attr(l, 'href')) ?? channel.link), feedUrl)
  const image = channel.image as Record<string, unknown> | undefined
  const parsed = items.map((n) => {
      const it = (n ?? {}) as Record<string, unknown>
      const link = arr(it.link)
        .map((l) => (typeof l === 'string' ? l : attr(l, 'href') ?? text(l)))
        .find(Boolean)
      const url = absolutize(link, siteUrl ?? feedUrl)
      const contentHtml = text(it['content:encoded']) || text(it.description) || undefined
      const guidNode = it.guid
      const author = text(it['dc:creator']) || text(it.author) || undefined
      return finishItem({
        guid: text(guidNode) || url || '',
        url,
        title: text(it.title),
        author,
        summary: text(it.description) || undefined,
        contentHtml,
        imageUrl: mediaImage(it, url ?? feedUrl),
        publishedAt: parseDate(text(it.pubDate) || text(it['dc:date']) || text(it.published)),
        ...mediaOf(it, url ?? feedUrl)
      })
    })
  const audio = parsed.filter((p) => p.mediaType === 'audio').length
  const itunesImage = attr(channel['itunes:image'], 'href')
  return {
    title: htmlToText(text(channel.title)) || siteUrl || feedUrl,
    siteUrl,
    iconUrl: absolutize(itunesImage, feedUrl) ?? (image ? absolutize(text(image.url), feedUrl) : undefined),
    podcast: audio > 0 && (audio >= parsed.length / 2 || !!itunesImage || 'itunes:author' in channel),
    items: parsed
  }
}

function atomLink(links: Node[], rel = 'alternate'): string | undefined {
  const all = links.filter((l) => l && typeof l === 'object')
  const match = all.find((l) => (attr(l, 'rel') ?? 'alternate') === rel && (!attr(l, 'type') || attr(l, 'type') === 'text/html'))
  return attr(match ?? all.find((l) => (attr(l, 'rel') ?? 'alternate') === rel), 'href')
}

function parseAtom(feed: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const siteUrl = absolutize(atomLink(arr(feed.link)), feedUrl)
  return {
    title: htmlToText(text(feed.title)) || siteUrl || feedUrl,
    siteUrl,
    youtube: 'yt:channelId' in feed || 'yt:playlistId' in feed || /youtube\.com\/feeds\//.test(feedUrl),
    iconUrl: absolutize(text(feed.icon) || text(feed.logo) || undefined, feedUrl),
    items: arr(feed.entry).map((n) => {
      const it = (n ?? {}) as Record<string, unknown>
      const url = absolutize(atomLink(arr(it.link)), siteUrl ?? feedUrl)
      const contentHtml = text(it.content) || undefined
      const author = arr(it.author).map((a) => text((a as Record<string, unknown>)?.name ?? a)).filter(Boolean).join(', ')
      // YouTube : identifiant de la vidéo et description dans media:group.
      const videoId = text(it['yt:videoId'])
      const group = (it['media:group'] ?? {}) as Record<string, unknown>
      const description = text(group['media:description'])
      const youtube = videoId
        ? {
            mediaUrl: `https://www.youtube.com/watch?v=${videoId}`,
            mediaType: 'youtube' as const,
            contentHtml: description ? `<p>${description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : undefined
          }
        : {}
      return finishItem({
        guid: text(it.id) || url || '',
        url,
        title: text(it.title),
        author: author || undefined,
        summary: text(it.summary) || description || undefined,
        contentHtml: contentHtml ?? (text(it.summary) || undefined),
        imageUrl: mediaImage(it, url ?? feedUrl),
        publishedAt: parseDate(text(it.published) || text(it.updated)),
        ...mediaOf(it, url ?? feedUrl),
        ...youtube
      })
    })
  }
}

interface JsonFeedItem {
  id?: string | number
  url?: string
  title?: string
  content_html?: string
  content_text?: string
  summary?: string
  image?: string
  banner_image?: string
  date_published?: string
  date_modified?: string
  author?: { name?: string }
  authors?: { name?: string }[]
}

function parseJsonFeed(json: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const siteUrl = typeof json.home_page_url === 'string' ? json.home_page_url : undefined
  const items = Array.isArray(json.items) ? (json.items as JsonFeedItem[]) : []
  return {
    title: typeof json.title === 'string' ? json.title : feedUrl,
    siteUrl,
    iconUrl: typeof json.icon === 'string' ? json.icon : typeof json.favicon === 'string' ? json.favicon : undefined,
    items: items.map((it) =>
      finishItem({
        guid: String(it.id ?? it.url ?? ''),
        url: absolutize(it.url, siteUrl ?? feedUrl),
        title: it.title ?? '',
        author: it.authors?.map((a) => a.name).filter(Boolean).join(', ') || it.author?.name,
        summary: it.summary,
        contentHtml: it.content_html ?? (it.content_text ? `<p>${it.content_text.replace(/</g, '&lt;')}</p>` : undefined),
        imageUrl: it.image ?? it.banner_image,
        publishedAt: parseDate(it.date_published ?? it.date_modified ?? '')
      })
    )
  }
}

export class NotAFeedError extends Error {}

/** Analyse un flux RSS 2.0, RSS 1.0 (RDF), Atom ou JSON Feed. */
export function parseFeed(body: string, feedUrl: string): ParsedFeed {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof json.version === 'string' && json.version.includes('jsonfeed')) return parseJsonFeed(json, feedUrl)
    throw new NotAFeedError('JSON reçu, mais ce n’est pas un JSON Feed')
  }
  if (/^<!doctype html|^<html/i.test(trimmed)) throw new NotAFeedError('Page HTML, pas un flux')

  const doc = parser.parse(body) as Record<string, unknown>
  const rss = doc.rss as Record<string, unknown> | undefined
  if (rss?.channel) {
    const channel = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Record<string, unknown>
    return parseRss(channel, arr(channel.item), feedUrl)
  }
  if (doc.feed) return parseAtom(doc.feed as Record<string, unknown>, feedUrl)
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined
  if (rdf) {
    const channel = (rdf.channel ?? {}) as Record<string, unknown>
    return parseRss(channel, arr(rdf.item), feedUrl)
  }
  throw new NotAFeedError('Format de flux non reconnu')
}

/** Cherche les flux annoncés dans une page HTML (<link rel="alternate" type="application/rss+xml">). */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  const out: string[] = []
  const re = /<link\b[^>]*>/gi
  for (const tag of html.match(re) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue
    if (!/type=["']?application\/(rss|atom|feed)\+(xml|json)|type=["']?application\/json/i.test(tag)) continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    const abs = absolutize(href ? decodeEntities(href) : undefined, pageUrl)
    if (abs && !out.includes(abs)) out.push(abs)
  }
  return out
}

/** Icônes déclarées par une page, de la plus grande à la plus petite. */
export function discoverIcons(html: string, pageUrl: string): string[] {
  const found: { href: string; size: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    if (!/(^|\s)(icon|apple-touch-icon|shortcut icon)(\s|$)/.test(rel) && !rel.includes('icon')) continue
    const href = absolutize(decodeEntities(tag.match(/href=["']([^"']+)["']/i)?.[1] ?? ''), pageUrl)
    if (!href) continue
    const sizes = tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1]
    const size = sizes ? Number(sizes) : rel.includes('apple-touch') ? 180 : 32
    found.push({ href, size })
  }
  return found.sort((a, b) => b.size - a.size).map((f) => f.href)
}
