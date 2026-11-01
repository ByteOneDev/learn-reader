import { discoverFeeds, discoverIcons, NotAFeedError, parseFeed, type ParsedFeed } from './parse'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export const USER_AGENT = 'Mozilla/5.0 (compatible; Learn/0.1; +https://github.com/ByteOneDev/learn-reader)'
// Reddit exige un User-Agent descriptif et limite fortement les clients anonymes ou génériques.
export const REDDIT_USER_AGENT = 'desktop:dev.byteone.learn:v0.10 (RSS reader; +https://github.com/ByteOneDev/learn-reader)'
const TIMEOUT_MS = 20_000
// Les flux de podcasts avec des centaines d'épisodes dépassent souvent 10 Mo.
const MAX_BYTES = 40 * 1024 * 1024
// Certains sites (protection anti-robots) refusent un client qui se présente comme un lecteur RSS.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

/** Erreur HTTP avec son statut, pour réagir finement (429, 404…). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message = `HTTP ${status}`
  ) {
    super(message)
  }
}

function isReddit(url: string): boolean {
  try {
    return /(^|\.)reddit\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

// Requêtes vers Reddit espacées (au plus une toutes les 2 s), même pendant une actualisation en parallèle.
let redditQueue: Promise<void> = Promise.resolve()
const REDDIT_SPACING = 2000
function redditSlot(): Promise<void> {
  const slot = redditQueue.then(() => new Promise<void>((r) => setTimeout(r, REDDIT_SPACING)))
  const mine = redditQueue
  redditQueue = slot
  return mine
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Délai demandé par le serveur (Retry-After, ou x-ratelimit-reset de Reddit), borné. */
function retryDelay(res: Response, attempt: number): number {
  const ra = Number(res.headers.get('retry-after'))
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  const s = Number.isFinite(ra) && ra > 0 ? ra : Number.isFinite(reset) && reset > 0 ? reset : 2 * (attempt + 1)
  return Math.min(s, 12) * 1000
}

export async function fetchText(fetchFn: FetchFn, url: string, headers: Record<string, string> = {}): Promise<{ body: string; contentType: string; url: string }> {
  const reddit = isReddit(url)
  let asBrowser = false
  for (let attempt = 0; ; attempt++) {
    if (reddit) await redditSlot()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': reddit ? REDDIT_USER_AGENT : asBrowser ? BROWSER_USER_AGENT : USER_AGENT,
          ...(asBrowser ? { 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' } : {}),
          Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
          ...headers
        },
        signal: ctrl.signal,
        redirect: 'follow'
      })
      // Trop de requêtes : on attend le délai demandé, deux fois au plus.
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const wait = retryDelay(res, attempt)
        clearTimeout(timer)
        await sleep(wait)
        continue
      }
      // Refus d'un « robot » : un seul nouvel essai en se présentant comme un navigateur.
      if (!reddit && !asBrowser && [401, 403, 405, 406, 429, 503].includes(res.status)) {
        clearTimeout(timer)
        asBrowser = true
        continue
      }
      if (!res.ok) throw new HttpError(res.status)
      const len = Number(res.headers.get('content-length') ?? 0)
      if (len > MAX_BYTES) throw new Error('Réponse trop volumineuse')
      const body = await res.text()
      if (body.length > MAX_BYTES) throw new Error('Réponse trop volumineuse')
      return { body, contentType: res.headers.get('content-type') ?? '', url: res.url || url }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Délai dépassé')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Télécharge et analyse un flux. Si l'adresse est une page HTML, on cherche le flux qu'elle annonce
 * (découverte automatique) et on renvoie l'adresse réelle du flux.
 */
export async function fetchFeed(fetchFn: FetchFn, url: string): Promise<{ feed: ParsedFeed; feedUrl: string }> {
  const { body, url: finalUrl } = await fetchText(fetchFn, url)
  try {
    return { feed: parseFeed(body, finalUrl), feedUrl: finalUrl }
  } catch (e) {
    if (!(e instanceof NotAFeedError)) throw e
    const candidates = discoverFeeds(body, finalUrl)
    if (!candidates.length) throw new Error('Aucun flux trouvé à cette adresse')
    const second = await fetchText(fetchFn, candidates[0])
    return { feed: parseFeed(second.body, second.url), feedUrl: second.url }
  }
}

/** Récupère l'icône d'un site et la renvoie en data URL (mise en cache locale, pas de service tiers). */
export async function fetchIcon(fetchFn: FetchFn, siteUrl: string, hint?: string): Promise<string | undefined> {
  const candidates: string[] = []
  if (hint) candidates.push(hint)
  try {
    const { body, url } = await fetchText(fetchFn, siteUrl, { Accept: 'text/html' })
    candidates.push(...discoverIcons(body, url))
  } catch {
    /* page inaccessible : on tente /favicon.ico */
  }
  try {
    candidates.push(new URL('/favicon.ico', siteUrl).href)
  } catch {
    return undefined
  }
  for (const c of candidates) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 10_000)
      const res = await fetchFn(c, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal }).finally(() => clearTimeout(timer))
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !(type.startsWith('image/') || c.endsWith('.ico'))) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 64 || buf.length > 200_000) continue
      const mime = type.startsWith('image/') ? type.split(';')[0] : 'image/x-icon'
      if (mime === 'image/svg+xml') continue // les SVG peuvent embarquer du script : on les ignore
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      /* candidat suivant */
    }
  }
  return undefined
}
