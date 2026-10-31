import { describe, expect, it } from 'vitest'
import { Epub, resolvePath } from '../src/main/books/epub'
import { makeEpub } from './fixtures/makeEpub'

describe('EPUB', () => {
  it('résout les chemins internes', () => {
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a.png')).toBe('OEBPS/images/a.png')
    expect(resolvePath('OEBPS/content.opf', 'text/ch1.xhtml#x')).toBe('OEBPS/text/ch1.xhtml')
    expect(resolvePath('OEBPS/text/ch1.xhtml', 'ma%20page.xhtml')).toBe('OEBPS/text/ma page.xhtml')
  })

  for (const version of [3, 2] as const) {
    describe(`EPUB ${version}`, () => {
      const book = new Epub(makeEpub(version))

      it('lit les métadonnées et la couverture', () => {
        expect(book.meta.title).toBe('Une brève histoire des réseaux')
        expect(book.meta.author).toBe('Inès Moreau')
        expect(book.meta.language).toBe('fr')
        expect(book.meta.cover?.startsWith('data:image/png;base64,')).toBe(true)
      })

      it('suit la spine en ignorant les pages hors lecture linéaire', () => {
        expect(book.meta.spine.map((s) => s.href)).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml'])
      })

      it('lit la table des matières hiérarchique', () => {
        expect(book.meta.toc).toEqual([
          { title: 'Le temps des relais', chapter: 0, anchor: undefined, depth: 0 },
          { title: 'Les codes', chapter: 0, anchor: 'codes', depth: 1 },
          { title: 'Naissance des protocoles', chapter: 1, anchor: undefined, depth: 0 }
        ])
        expect(book.chapterTitle(1)).toBe('Naissance des protocoles')
      })
    })
  }

  it('prépare un chapitre pour le lecteur : images intégrées, liens et ancres réécrits', () => {
    const book = new Epub(makeEpub(3))
    const { html } = book.chapter(0)
    expect(html).toContain('Les tours Chappe relayaient des signaux.')
    expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(2) // l'image et la couverture SVG
    expect(html).not.toContain('<svg')
    expect(html).toContain('href="#ch1~tcp"')
    expect(html).toContain('href="#ch0~codes"')
    expect(html).toContain('id="ch0~codes"')
    expect(html).toContain('href="https://fr.wikipedia.org/wiki/Chappe"')
    expect(html).not.toContain('<head>')
    expect(book.chapter(1).html).toContain('id="ch1~tcp"')
  })

  it('refuse un fichier qui n’est pas un EPUB', () => {
    expect(() => new Epub(new Uint8Array([1, 2, 3]))).toThrow()
  })
})
