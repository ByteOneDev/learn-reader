import { describe, expect, it } from 'vitest'
import { buildMarkdown, END_MARKER, mergeWithExisting, safeFileName } from '../src/main/export/markdown'
import type { Highlight, Item, Source } from '../src/shared/types'
import { blockId } from '../src/shared/util'

const item: Item = {
  id: 'i_1',
  sourceId: 's_1',
  guid: 'g',
  url: 'https://revue.example/chappe',
  title: 'Le télégraphe Chappe : premier réseau ?',
  author: 'Hugo Bernard',
  publishedAt: Date.parse('2026-10-29T10:00:00Z'),
  fetchedAt: 0,
  read: true,
  later: false,
  bookmarked: false,
  favorite: false,
  tags: ['Histoire', 'réseau informatique']
}
const source: Source = { id: 's_1', kind: 'rss', title: 'Revue', url: 'https://revue.example/feed', createdAt: 0 }
const hl = (id: string, start: number, quote: string, note = ''): Highlight => ({
  id,
  itemId: 'i_1',
  color: 'yellow',
  quote,
  prefix: '',
  suffix: '',
  start,
  end: start + quote.length,
  note,
  layer: 'feed',
  createdAt: 0,
  updatedAt: Date.parse('2026-10-30T08:00:00Z')
})

describe('export Markdown', () => {
  const md = buildMarkdown(item, source, [hl('h_b', 50, 'Second passage', '**Important** : à relier au cours de réseau.'), hl('h_a', 10, 'Premier passage')], Date.parse('2026-10-30T00:00:00Z'))

  it('produit un frontmatter exploitable par Obsidian', () => {
    expect(md.startsWith('---\nlearn_id: i_1\ntitle: "Le télégraphe Chappe : premier réseau ?"\n')).toBe(true)
    expect(md).toContain('tags: ["learn", "Histoire", "réseau-informatique"]')
    expect(md).toContain('url: https://revue.example/chappe')
    expect(md).toContain('published: 2026-10-29')
  })

  it('range les surlignages dans l’ordre du texte, avec identifiants de bloc et notes', () => {
    expect(md.indexOf('Premier passage')).toBeLessThan(md.indexOf('Second passage'))
    expect(md).toContain(`> Second passage\n\n^${blockId('h_b')}\n\n**Important** : à relier au cours de réseau.`)
    expect(md).toContain('%%learn:highlight id=h_b color=yellow updated=2026-10-30T08:00:00.000Z%%')
    expect(md.trimEnd().endsWith(END_MARKER)).toBe(true)
  })

  it('conserve les notes écrites dans Obsidian après le marqueur', () => {
    const existing = md + '\n## Mes réflexions\n\nÀ comparer avec le réseau ARPANET.\n'
    const regenerated = buildMarkdown(item, source, [hl('h_a', 10, 'Premier passage', 'Nouvelle note')])
    const merged = mergeWithExisting(regenerated, existing)!
    expect(merged).toContain('Nouvelle note')
    expect(merged).not.toContain('Second passage')
    expect(merged.endsWith('\n## Mes réflexions\n\nÀ comparer avec le réseau ARPANET.\n')).toBe(true)
  })

  it('n’écrase jamais un fichier qui n’a pas été créé par Learn', () => {
    expect(mergeWithExisting(md, '# Ma propre note\n')).toBeNull()
  })

  it('produit des noms de fichiers sûrs', () => {
    expect(safeFileName('Pourquoi ? / Comment : « réseau » #1')).toBe('Pourquoi Comment « réseau » 1')
    expect(safeFileName('???')).toBe('Sans titre')
  })
})
