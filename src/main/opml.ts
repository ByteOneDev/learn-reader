import { XMLParser } from 'fast-xml-parser'
import type { Source } from '@shared/types'

export interface OpmlFeed {
  url: string
  title?: string
  siteUrl?: string
  category?: string
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (n) => n === 'outline' })

/** Lit un fichier OPML (export de Reeder, NetNewsWire, Feedly…). Les dossiers deviennent des catégories. */
export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parser.parse(xml) as { opml?: { body?: { outline?: unknown[] } } }
  const out: OpmlFeed[] = []
  const walk = (nodes: unknown[] | undefined, category?: string): void => {
    for (const n of nodes ?? []) {
      const o = n as Record<string, unknown>
      const url = (o['@_xmlUrl'] ?? o['@_xmlurl']) as string | undefined
      const title = (o['@_title'] ?? o['@_text']) as string | undefined
      if (url) out.push({ url, title, siteUrl: o['@_htmlUrl'] as string | undefined, category })
      if (Array.isArray(o.outline)) walk(o.outline, url ? category : title ?? category)
    }
  }
  walk(doc.opml?.body?.outline)
  return out
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildOpml(sources: Source[]): string {
  const groups = new Map<string, Source[]>()
  for (const s of sources) {
    if (s.kind === 'links') continue
    const key = s.category ?? ''
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const line = (s: Source, indent: string): string =>
    `${indent}<outline type="rss" text="${esc(s.title)}" title="${esc(s.title)}" xmlUrl="${esc(s.url)}"${s.siteUrl ? ` htmlUrl="${esc(s.siteUrl)}"` : ''}/>`
  const body: string[] = []
  for (const [cat, list] of groups) {
    if (!cat) body.push(...list.map((s) => line(s, '    ')))
    else body.push(`    <outline text="${esc(cat)}" title="${esc(cat)}">`, ...list.map((s) => line(s, '      ')), '    </outline>')
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Abonnements Learn</title></head>\n  <body>\n${body.join('\n')}\n  </body>\n</opml>\n`
}
