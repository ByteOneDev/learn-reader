import type { FetchFn } from '../feeds/fetcher'
import type { ParsedItem } from '../feeds/parse'

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
