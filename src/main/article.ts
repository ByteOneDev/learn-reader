import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { fetchText, type FetchFn } from './feeds/fetcher'
import { firstImage } from './feeds/parse'
import { fixLazyImages } from '@shared/lazyImages'

export interface Extracted {
  title?: string
  byline?: string
  contentHtml: string
  excerpt?: string
  imageUrl?: string
  siteName?: string
}

/** Extrait l'article principal d'une page HTML (mode lecture), avec des liens et images absolus. */
export function extractArticle(html: string, pageUrl: string): Extracted | null {
  const { document } = parseHTML(html)
  // Avant Readability : sinon les images en chargement différé restent des cadres vides.
  fixLazyImages(document, pageUrl)
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined

  const reader = new Readability(document as unknown as Document, { charThreshold: 300, keepClasses: false })
  const article = reader.parse()
  if (!article?.content) return null

  const { document: frag } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`)
  for (const el of Array.from(frag.querySelectorAll('[src], [href], [srcset]')) as Element[]) {
    for (const name of ['src', 'href']) {
      const v = el.getAttribute(name)
      if (!v) continue
      try {
        el.setAttribute(name, new URL(v, pageUrl).href)
      } catch {
        el.removeAttribute(name)
      }
    }
    const srcset = el.getAttribute('srcset')
    if (srcset) {
      const fixed = srcset
        .split(',')
        .map((part) => {
          const [u, d] = part.trim().split(/\s+/, 2)
          try {
            return [new URL(u, pageUrl).href, d].filter(Boolean).join(' ')
          } catch {
            return ''
          }
        })
        .filter(Boolean)
        .join(', ')
      el.setAttribute('srcset', fixed)
    }
  }
  const contentHtml = frag.body.innerHTML
  return {
    title: article.title ?? undefined,
    byline: article.byline ?? undefined,
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    contentHtml,
    imageUrl: ogImage ? new URL(ogImage, pageUrl).href : firstImage(contentHtml, pageUrl)
  }
}

export async function fetchArticle(fetchFn: FetchFn, url: string): Promise<Extracted> {
  const { body, url: finalUrl } = await fetchText(fetchFn, url, { Accept: 'text/html,application/xhtml+xml' })
  const extracted = extractArticle(body, finalUrl)
  if (!extracted) throw new Error("Impossible d'extraire le texte de cette page")
  return extracted
}
