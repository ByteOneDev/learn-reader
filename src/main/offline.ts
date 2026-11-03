import { parseHTML } from 'linkedom'
import type { FetchFn } from './feeds/fetcher'
import { USER_AGENT } from './feeds/fetcher'

// Lecture hors ligne : les images d'un article sont intégrées à son texte (data: URI), pour qu'il reste
// lisible sans réseau. Limites raisonnables : 12 images, 1,5 Mo chacune, 6 Mo par article ; pas de SVG
// (il peut embarquer du script).

export const MAX_IMAGES = 12
export const MAX_IMAGE_BYTES = 1_500_000
export const MAX_ARTICLE_BYTES = 6_000_000

/** Télécharge une image et la renvoie en data URI, ou undefined si elle ne convient pas. */
async function imageAsDataUri(fetchFn: FetchFn, url: string): Promise<{ uri: string; bytes: number } | undefined> {
  if (url.startsWith('data:')) return undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/*' }, signal: ctrl.signal })
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!res.ok || !type.startsWith('image/') || type === 'image/svg+xml') return undefined
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_IMAGE_BYTES) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_IMAGE_BYTES || buf.length < 100) return undefined
    return { uri: `data:${type};base64,${buf.toString('base64')}`, bytes: buf.length }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Intègre les images de `html` (adresses absolues, résolues depuis `base`). Les images trop lourdes ou au-delà
 * de la limite gardent leur adresse distante. L'image d'en-tête est ajoutée en tête si l'article ne la contient pas.
 */
export async function embedImages(fetchFn: FetchFn, html: string, base: string, heroUrl?: string): Promise<{ html: string; images: number }> {
  const { document } = parseHTML(`<!doctype html><html><body><div id="learn-root">${html}</div></body></html>`)
  const root = document.getElementById('learn-root')!
  if (heroUrl && !html.includes(heroUrl.split('?')[0])) {
    const img = document.createElement('img')
    img.setAttribute('src', heroUrl)
    img.setAttribute('alt', '')
    img.setAttribute('data-learn-hero', '')
    root.insertBefore(img, root.firstChild)
  }
  const imgs = [...root.querySelectorAll('img')].slice(0, MAX_IMAGES)
  let total = 0
  let images = 0
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src) continue
    let abs: string
    try {
      abs = new URL(src, base).href
    } catch {
      continue
    }
    if (!/^https?:/.test(abs)) continue
    const got = await imageAsDataUri(fetchFn, abs)
    if (!got || total + got.bytes > MAX_ARTICLE_BYTES) continue
    total += got.bytes
    images++
    img.setAttribute('src', got.uri)
    // Les variantes responsives pointeraient encore vers le réseau.
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
    img.removeAttribute('loading')
    // Adresses de chargement différé : elles remplaceraient l'image intégrée par la version distante.
    for (const a of [...img.getAttributeNames()]) if (a.startsWith('data-') && a !== 'data-learn-hero') img.removeAttribute(a)
  }
  for (const s of [...root.querySelectorAll('picture source')]) s.remove()
  return { html: root.innerHTML, images }
}
