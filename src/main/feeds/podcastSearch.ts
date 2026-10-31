import type { FetchFn } from './fetcher'
import { USER_AGENT } from './fetcher'

// Recherche de podcasts par nom dans l'annuaire public d'Apple Podcasts (API iTunes Search, sans clé).
// Elle donne l'adresse officielle du flux RSS : plus besoin de la connaître pour s'abonner.

export interface PodcastResult {
  title: string
  author?: string
  feedUrl: string
  artwork?: string
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function searchPodcasts(fetchFn: FetchFn, term: string, country = 'FR'): Promise<PodcastResult[]> {
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=12&country=${country}&term=${encodeURIComponent(term.trim())}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`Recherche de podcasts : HTTP ${res.status}`)
    const json = (await res.json()) as { results?: { collectionName?: string; artistName?: string; feedUrl?: string; artworkUrl600?: string }[] }
    return (json.results ?? [])
      .filter((r) => r.feedUrl && r.collectionName)
      .map((r) => ({ title: r.collectionName!, author: r.artistName, feedUrl: r.feedUrl!, artwork: r.artworkUrl600 }))
  } finally {
    clearTimeout(timer)
  }
}

/** Le résultat dont le nom correspond le mieux (exact, puis inclus, puis premier). */
export function pickPodcast(results: PodcastResult[], name: string): PodcastResult | undefined {
  const n = normalizeName(name)
  return (
    results.find((r) => normalizeName(r.title) === n) ??
    results.find((r) => normalizeName(r.title).includes(n) || n.includes(normalizeName(r.title))) ??
    results[0]
  )
}
