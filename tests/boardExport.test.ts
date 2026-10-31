import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'
import { boardToFreeMind, boardToOpml, boardToSvg, wrap } from '../src/shared/boardExport'
import type { Board } from '../src/shared/types'

const board: Board = {
  id: 'b',
  title: 'Confiance & réseaux',
  mode: 'mindmap',
  createdAt: 0,
  updatedAt: 0,
  data: {
    nodes: [
      { id: 'r', kind: 'note', text: 'Pourquoi la confiance ?', x: 0, y: 100, root: true },
      { id: 'h', kind: 'highlight', highlightId: 'h1', quote: 'croyaient sur parole', color: 'pink', itemTitle: 'BGP', x: 350, y: 0 },
      { id: 'n', kind: 'note', text: 'Contre-exemple : <RPKI>', x: 700, y: 0 },
      { id: 'seul', kind: 'note', text: 'Idée isolée', x: 0, y: 400 }
    ],
    edges: [
      { id: '1', from: 'r', to: 'h', label: 'soutient' },
      { id: '2', from: 'h', to: 'n' }
    ]
  }
}
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => n === 'outline' || n === 'node' })

describe('exports de mind maps', () => {
  it('OPML : l’arbre de la racine, les liens nommés en préfixe, les groupes isolés à part', () => {
    const opml = boardToOpml(board)
    expect(XMLValidator.validate(opml)).toBe(true)
    const body = parser.parse(opml).opml.body
    expect(body.outline.map((o: { text: string }) => o.text)).toEqual(['Pourquoi la confiance ?', 'Idée isolée'])
    const child = body.outline[0].outline[0]
    expect(child.text).toBe('(soutient) « croyaient sur parole » — BGP')
    expect(child.outline[0].text).toBe('Contre-exemple : <RPKI>')
    expect(parser.parse(opml).opml.head.title).toBe('Confiance & réseaux')
  })

  it('FreeMind : une seule racine (le titre) quand il y a plusieurs groupes, couleurs des surlignages', () => {
    const mm = boardToFreeMind(board)
    expect(XMLValidator.validate(mm)).toBe(true)
    const root = parser.parse(mm).map.node[0]
    expect(root.TEXT).toBe('Confiance & réseaux')
    expect(root.node.map((n: { TEXT: string }) => n.TEXT)).toEqual(['Pourquoi la confiance ?', 'Idée isolée'])
    const quote = root.node[0].node[0]
    expect(quote.BACKGROUND_COLOR).toBe('#fbcfe8')
    expect(quote.attribute.VALUE).toBe('soutient')
  })

  it('SVG : document valide qui contient tous les nœuds et les étiquettes de liens', () => {
    const { svg, width, height } = boardToSvg(board)
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(width).toBeGreaterThan(900)
    expect(height).toBeGreaterThan(400)
    for (const t of ['Pourquoi la confiance ?', 'croyaient sur parole', 'Contre-exemple : &lt;RPKI&gt;', 'soutient', 'Confiance &amp; réseaux']) expect(svg).toContain(t)
  })

  it('découpe les textes en lignes', () => {
    expect(wrap('un deux trois quatre cinq six sept huit neuf dix onze douze', 20)).toEqual(['un deux trois quatre', 'cinq six sept huit', 'neuf dix onze douze'])
  })
})
