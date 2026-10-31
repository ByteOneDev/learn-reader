import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { parseHTML } from 'linkedom'
import type { TocEntry } from '@shared/types'

// Un EPUB est un zip de pages XHTML. Plutôt que d'afficher le livre dans une iframe avec ses propres
// styles, on en extrait les chapitres pour les afficher dans le lecteur de Learn : même typographie,
// mêmes thèmes, même système de surlignage que pour les articles.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif'
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: true,
  isArray: (name) => ['item', 'itemref', 'navPoint', 'meta', 'creator', 'title'].includes(name)
})

export interface SpineItem {
  href: string
  title?: string
}

export interface EpubMeta {
  title: string
  author?: string
  language?: string
  cover?: string
  spine: SpineItem[]
  toc: TocEntry[]
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i + 1)
}

/** Résout un chemin relatif à l'intérieur du zip (« ../images/a.png » depuis « OEBPS/text/ch1.xhtml »). */
export function resolvePath(base: string, rel: string): string {
  const [path] = rel.split('#')
  const parts = (path.startsWith('/') ? path.slice(1) : dirname(base) + path).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return decodeURIComponent(out.join('/'))
}

function text(n: unknown): string {
  if (n == null) return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n).trim()
  if (Array.isArray(n)) return text(n[0])
  if (typeof n === 'object' && '#text' in (n as Record<string, unknown>)) return text((n as Record<string, unknown>)['#text'])
  return ''
}

export class Epub {
  readonly meta: EpubMeta
  private files: Record<string, Uint8Array>
  private opfPath: string

  constructor(data: Uint8Array) {
    this.files = unzipSync(data)
    const container = this.text('META-INF/container.xml')
    const rootfile = container.match(/full-path=["']([^"']+)["']/)?.[1]
    if (!rootfile) throw new Error('EPUB invalide : container.xml sans rootfile')
    this.opfPath = rootfile
    this.meta = this.readOpf()
  }

  private file(path: string): Uint8Array | undefined {
    if (this.files[path]) return this.files[path]
    // Certains EPUB ont une casse incohérente entre le manifeste et le zip.
    const lower = path.toLowerCase()
    const key = Object.keys(this.files).find((k) => k.toLowerCase() === lower)
    return key ? this.files[key] : undefined
  }

  private text(path: string): string {
    const f = this.file(path)
    if (!f) throw new Error(`EPUB invalide : fichier manquant ${path}`)
    return strFromU8(f)
  }

  private dataUrl(path: string): string | undefined {
    const f = this.file(path)
    const mime = MIME[path.split('.').pop()?.toLowerCase() ?? '']
    if (!f || !mime || f.length > MAX_IMAGE_BYTES) return undefined
    return `data:${mime};base64,${Buffer.from(f).toString('base64')}`
  }

  private readOpf(): EpubMeta {
    const opf = xml.parse(this.text(this.opfPath)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const pkg = opf.package ?? {}
    const md = pkg.metadata ?? {}
    const items: Record<string, any>[] = pkg.manifest?.item ?? [] // eslint-disable-line @typescript-eslint/no-explicit-any
    const byId = new Map(items.map((i) => [i['@_id'] as string, i]))
    const href = (i: Record<string, unknown>): string => resolvePath(this.opfPath, i['@_href'] as string)

    const spine: SpineItem[] = (pkg.spine?.itemref ?? [])
      .filter((r: Record<string, unknown>) => r['@_linear'] !== 'no')
      .map((r: Record<string, unknown>) => byId.get(r['@_idref'] as string))
      .filter((i: unknown): i is Record<string, unknown> => !!i && /html/.test(String((i as Record<string, unknown>)['@_media-type'])))
      .map((i: Record<string, unknown>) => ({ href: href(i) }))

    // Couverture : EPUB 3 (properties="cover-image") ou EPUB 2 (<meta name="cover">).
    let coverItem = items.find((i) => String(i['@_properties'] ?? '').split(/\s+/).includes('cover-image'))
    if (!coverItem) {
      const coverId = (md.meta ?? []).find((m: Record<string, unknown>) => m['@_name'] === 'cover')?.['@_content']
      coverItem = coverId ? byId.get(coverId) : items.find((i) => /cover/i.test(i['@_id']) && /^image\//.test(i['@_media-type']))
    }

    const meta: EpubMeta = {
      title: text(md.title) || 'Sans titre',
      author: (md.creator ?? []).map(text).filter(Boolean).join(', ') || undefined,
      language: text(md.language) || undefined,
      cover: coverItem ? this.dataUrl(href(coverItem)) : undefined,
      spine,
      toc: []
    }

    const nav = items.find((i) => String(i['@_properties'] ?? '').split(/\s+/).includes('nav'))
    const ncxId = pkg.spine?.['@_toc']
    const ncx = ncxId ? byId.get(ncxId) : items.find((i) => i['@_media-type'] === 'application/x-dtbncx+xml')
    try {
      if (nav) meta.toc = this.readNav(href(nav), spine)
      if (!meta.toc.length && ncx) meta.toc = this.readNcx(href(ncx), spine)
    } catch {
      meta.toc = []
    }
    for (const entry of meta.toc) {
      const s = spine[entry.chapter]
      if (s && !s.title) s.title = entry.title
    }
    return meta
  }

  private chapterIndex(path: string, spine: SpineItem[] = this.meta.spine): number {
    return spine.findIndex((s) => s.href === path)
  }

  private readNav(path: string, spine: SpineItem[]): TocEntry[] {
    const { document } = parseHTML(this.text(path))
    const navs = Array.from(document.querySelectorAll('nav')) as Element[]
    const toc = navs.find((n) => /toc/.test(n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '')) ?? navs[0]
    if (!toc) return []
    const out: TocEntry[] = []
    const walk = (ol: Element | null, depth: number): void => {
      if (!ol) return
      for (const li of Array.from(ol.children) as Element[]) {
        if (li.tagName.toLowerCase() !== 'li') continue
        const a = li.querySelector('a, span')
        const href = a?.getAttribute('href')
        const target = href ? resolvePath(path, href) : ''
        const chapter = target ? this.chapterIndex(target, spine) : -1
        const title = (a?.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (title && chapter >= 0) out.push({ title, chapter, anchor: href?.split('#')[1], depth })
        walk(li.querySelector(':scope > ol'), depth + 1)
      }
    }
    walk(toc.querySelector('ol'), 0)
    return out
  }

  private readNcx(path: string, spine: SpineItem[]): TocEntry[] {
    const doc = xml.parse(this.text(path)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: TocEntry[] = []
    const walk = (points: Record<string, any>[] | undefined, depth: number): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const p of points ?? []) {
        const src = p.content?.['@_src'] as string | undefined
        const chapter = src ? this.chapterIndex(resolvePath(path, src), spine) : -1
        const title = text(p.navLabel?.text)
        if (title && chapter >= 0) out.push({ title, chapter, anchor: src?.split('#')[1], depth })
        walk(p.navPoint, depth + 1)
      }
    }
    walk(doc.ncx?.navMap?.navPoint, 0)
    return out
  }

  /**
   * HTML d'un chapitre, prêt pour le lecteur : images intégrées en data URL, liens internes réécrits
   * en `#ch<index>` ou `#ch<index>~<ancre>`, identifiants préfixés pour éviter toute collision.
   * Le HTML est encore nettoyé par DOMPurify côté interface.
   */
  chapter(index: number): { html: string; title?: string } {
    const item = this.meta.spine[index]
    if (!item) throw new Error('Chapitre introuvable')
    const { document } = parseHTML(this.text(item.href))
    const body = document.body ?? document.documentElement

    // Couvertures en SVG (<svg><image xlink:href>) → <img>, le SVG n'étant pas autorisé à l'affichage.
    for (const svg of Array.from(body.querySelectorAll('svg')) as Element[]) {
      const image = svg.querySelector('image')
      const src = image?.getAttribute('xlink:href') ?? image?.getAttribute('href')
      if (src) {
        const img = document.createElement('img')
        img.setAttribute('src', src)
        svg.replaceWith(img)
      } else svg.remove()
    }
    for (const img of Array.from(body.querySelectorAll('img[src]')) as Element[]) {
      const src = img.getAttribute('src')!
      if (/^data:/.test(src)) continue
      const data = /^https?:/.test(src) ? undefined : this.dataUrl(resolvePath(item.href, src))
      if (data) img.setAttribute('src', data)
      else img.remove()
    }
    for (const a of Array.from(body.querySelectorAll('a[href]')) as Element[]) {
      const href = a.getAttribute('href')!
      if (/^(https?|mailto):/i.test(href)) continue
      const [path, anchor] = href.split('#')
      const target = path ? this.chapterIndex(resolvePath(item.href, path)) : index
      if (target < 0) a.removeAttribute('href')
      else a.setAttribute('href', `#ch${target}${anchor ? `~${anchor}` : ''}`)
    }
    for (const el of Array.from(body.querySelectorAll('[id]')) as Element[]) el.setAttribute('id', `ch${index}~${el.getAttribute('id')}`)
    return { html: body.innerHTML, title: item.title }
  }

  chapterTitle(index: number): string {
    return this.meta.spine[index]?.title ?? `Chapitre ${index + 1}`
  }
}
