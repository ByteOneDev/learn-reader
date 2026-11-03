import { fetchText, type FetchFn } from '../feeds/fetcher'
import { discoverFeeds, parseFeed, type ParsedFeed, type ParsedItem } from '../feeds/parse'

// Vidéos YouTube de l'année en cours. Le flux RSS d'une chaîne ne donne que ses 15 dernières vidéos ;
// avec une clé d'API YouTube (gratuite), on remonte toute l'année via la playlist « uploads » de la
// chaîne : 1 unité de quota par page de 50 vidéos, sur 10 000 par jour.

export function startOfYear(now = Date.now()): number {
  return new Date(new Date(now).getFullYear(), 0, 1).getTime()
}

/** Playlist à parcourir : « uploads » de la chaîne (UC… → UU…) ou playlist suivie. */
export function uploadsPlaylist(feedUrl: string): string | undefined {
  try {
    const u = new URL(feedUrl)
    const playlist = u.searchParams.get('playlist_id')
    if (playlist) return playlist
    const channel = u.searchParams.get('channel_id')
    return channel?.startsWith('UC') ? `UU${channel.slice(2)}` : undefined
  } catch {
    return undefined
  }
}

interface PlaylistItem {
  snippet?: { title?: string; description?: string; videoOwnerChannelTitle?: string; thumbnails?: Record<string, { url?: string }> }
  contentDetails?: { videoId?: string; videoPublishedAt?: string }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Toutes les vidéos de la playlist publiées depuis `since`, au plus `maxPages` pages de 50. */
export async function fetchYearVideos(fetchFn: FetchFn, apiKey: string, playlistId: string, since: number, maxPages = 20): Promise<ParsedItem[]> {
  const out: ParsedItem[] = []
  let token: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}${token ? `&pageToken=${token}` : ''}`
    const res = await fetchFn(url, { headers: { Accept: 'application/json' } })
    const json = (await res.json().catch(() => ({}))) as { items?: PlaylistItem[]; nextPageToken?: string; error?: { message?: string } }
    if (!res.ok) throw new Error(`API YouTube : ${json.error?.message ?? `HTTP ${res.status}`}`)
    let older = false
    for (const it of json.items ?? []) {
      const id = it.contentDetails?.videoId
      const published = Date.parse(it.contentDetails?.videoPublishedAt ?? '')
      if (!id || !Number.isFinite(published)) continue // vidéo privée ou supprimée
      if (published < since) {
        older = true
        continue
      }
      const sn = it.snippet ?? {}
      const thumbs = sn.thumbnails ?? {}
      const description = sn.description ?? ''
      out.push({
        guid: `yt:video:${id}`,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: sn.title ?? '',
        author: sn.videoOwnerChannelTitle,
        summary: description.slice(0, 320) || undefined,
        contentHtml: description ? `<p>${esc(description).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : undefined,
        imageUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url,
        publishedAt: published,
        mediaUrl: `https://www.youtube.com/watch?v=${id}`,
        mediaType: 'youtube'
      })
    }
    // La playlist « uploads » est triée de la plus récente à la plus ancienne : on s'arrête à l'année précédente.
    if (older || !json.nextPageToken) break
    token = json.nextPageToken
  }
  return out
}

// ── Récupération robuste d'une chaîne ─────────────────────────────────────
// 1. Page de chaîne (@pseudo, /c/, /user/) : en Europe, YouTube redirige d'abord vers sa page de
//    consentement aux cookies, sans lien vers le flux. On présente un consentement déjà donné, et on lit
//    l'identifiant UC… directement dans la page.
// 2. Flux RSS : il renvoie parfois des 404 ou 500 passagers ; un second essai suffit souvent.
// 3. En dernier recours, avec une clé d'API : la playlist « uploads » (1 unité de quota par chaîne).

export const YOUTUBE_CONSENT_COOKIE = 'SOCS=CAI; CONSENT=YES+cb'

export function isYoutubePage(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)youtube\.com$/.test(u.hostname) && !u.pathname.startsWith('/feeds/')
  } catch {
    return false
  }
}

/** Identifiant de chaîne (UC…) lu dans le HTML d'une page YouTube. */
export function channelIdFromHtml(html: string): string | undefined {
  const patterns = [
    /<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/,
    /"channelId":"(UC[\w-]{22})"/
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return m[1]
  }
  return undefined
}

export const channelFeedUrl = (id: string): string => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Nom d'une chaîne par l'API (1 unité), quand elle n'a encore rien publié cette année. */
async function channelTitle(fetchFn: FetchFn, apiKey: string, channelId: string): Promise<string | undefined> {
  try {
    const res = await fetchFn(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${encodeURIComponent(apiKey)}`)
    const json = (await res.json()) as { items?: { snippet?: { title?: string } }[] }
    return json.items?.[0]?.snippet?.title
  } catch {
    return undefined
  }
}

export async function fetchYoutubeFeed(fetchFn: FetchFn, url: string, apiKey?: string): Promise<{ feed: ParsedFeed; feedUrl: string; viaApi?: boolean }> {
  let feedUrl = url
  if (isYoutubePage(url)) {
    const { body, url: finalUrl } = await fetchText(fetchFn, url, {
      Cookie: YOUTUBE_CONSENT_COOKIE,
      Accept: 'text/html',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
    })
    const id = channelIdFromHtml(body)
    const discovered = discoverFeeds(body, finalUrl)[0]
    if (id) feedUrl = channelFeedUrl(id)
    else if (discovered) feedUrl = discovered
    else throw new Error('Chaîne YouTube introuvable à cette adresse')
  }
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { body, url: finalUrl } = await fetchText(fetchFn, feedUrl)
      return { feed: parseFeed(body, finalUrl), feedUrl }
    } catch (e) {
      lastError = e as Error
      if (attempt === 0) await sleep(1500)
    }
  }
  const playlist = uploadsPlaylist(feedUrl)
  const key = apiKey?.trim()
  if (key && playlist) {
    const items = await fetchYearVideos(fetchFn, key, playlist, startOfYear(), 1)
    const channelId = new URL(feedUrl).searchParams.get('channel_id')
    const title = items[0]?.author ?? (channelId ? await channelTitle(fetchFn, key, channelId) : undefined) ?? 'YouTube'
    return {
      feed: { title, siteUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : undefined, youtube: true, items },
      feedUrl,
      viaApi: true
    }
  }
  throw new Error(
    `YouTube ne fournit pas le flux de cette chaîne en ce moment (${lastError?.message ?? 'erreur'}). ` +
      'Avec une clé d’API YouTube (Réglages → Vidéos YouTube), Learn passe par l’API à la place.'
  )
}
