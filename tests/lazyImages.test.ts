import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { bestFromSrcset, fixLazyImages, isPlaceholder } from '../src/shared/lazyImages'
import { extractArticle } from '../src/main/article'

const SVG = `data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='675'%3E%3C/svg%3E`

function run(body: string, base = 'https://blog.example/2026/10/article/'): Document {
  const { document } = parseHTML(`<!doctype html><html><body>${body}</body></html>`)
  fixLazyImages(document, base)
  return document as unknown as Document
}

describe('images en chargement différé', () => {
  it('reconnaît les images factices', () => {
    expect(isPlaceholder(SVG)).toBe(true)
    expect(isPlaceholder('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(true)
    expect(isPlaceholder('/wp-content/plugins/lazy/blank.gif')).toBe(true)
    expect(isPlaceholder('')).toBe(true)
    expect(isPlaceholder('https://cdn.example/photo-chappe.jpg')).toBe(false)
  })

  it('WordPress : SVG vide dans src, vraie image dans data-lazy-src', () => {
    const d = run(`<figure><img src="${SVG}" data-lazy-src="https://blog.example/wp-content/uploads/vent.jpg" data-lazy-srcset="https://blog.example/v-300.jpg 300w, https://blog.example/v-1200.jpg 1200w"><figcaption>Daydream Notes // Source : Delcourt</figcaption></figure>`)
    const img = d.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://blog.example/wp-content/uploads/vent.jpg')
    expect(img.getAttribute('srcset')).toBe('https://blog.example/v-300.jpg 300w, https://blog.example/v-1200.jpg 1200w')
  })

  it('data-src relatif, rendu absolu', () => {
    const img = run(`<img src="data:image/gif;base64,R0lGOD" data-src="../images/tour.jpg">`).querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://blog.example/2026/10/images/tour.jpg')
  })

  it('srcset seul : on prend la plus grande', () => {
    expect(bestFromSrcset('a.jpg 320w, b.jpg 1024w, c.jpg 640w')).toBe('b.jpg')
    const img = run(`<img data-srcset="/s.jpg 400w, /l.jpg 1600w">`).querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://blog.example/l.jpg')
  })

  it('<picture> : la source est utilisée quand l’image est factice', () => {
    const img = run(`<picture><source srcset="https://cdn.example/p.webp 1x" type="image/webp"><img src="${SVG}"></picture>`).querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn.example/p.webp')
  })

  it('<noscript> : la version sans JavaScript remplace l’image factice', () => {
    const d = run(`<img src="${SVG}" class="lazy"><noscript><img src="https://cdn.example/vrai.jpg"></noscript>`)
    expect(Array.from(d.querySelectorAll('img')).map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/vrai.jpg'])
    expect(d.querySelector('noscript')).toBeNull()
  })

  it('retire un cadre SVG vide sans vraie image derrière, garde les vraies images', () => {
    const d = run(`<img src="${SVG}"><img src="/ok.png">`)
    expect(Array.from(d.querySelectorAll('img')).map((i) => i.getAttribute('src'))).toEqual(['https://blog.example/ok.png'])
  })

  it('garde une vraie illustration SVG intégrée', () => {
    const drawn = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4" cx="5" cy="5"/></svg>')}`
    expect(run(`<img src="${drawn}">`).querySelectorAll('img')).toHaveLength(1)
  })

  it('rend les liens relatifs absolus, sans toucher aux ancres', () => {
    const d = run(`<a href="/autre-article">x</a><a href="#note">y</a><a href="mailto:a@b.c">z</a>`)
    expect(Array.from(d.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['https://blog.example/autre-article', '#note', 'mailto:a@b.c'])
  })

  it('le texte complet extrait garde les vraies images', () => {
    const para = '<p>Le Vent se lève est un roman de Tatsuo Hori, publié en 1938, ensuite adapté au cinéma par Hayao Miyazaki, sous le titre Le vent se lève, sorti en 2013. ' + 'Une phrase de remplissage pour atteindre la longueur minimale. '.repeat(6) + '</p>'
    const html = `<html><head><title>Article</title></head><body><article><h1>Le vent se lève</h1>${para}<figure><img src="${SVG}" data-lazy-src="/wp-content/uploads/vent.jpg" width="1200" height="675"><figcaption>Daydream Notes // Source : Delcourt</figcaption></figure>${para}</article></body></html>`
    const ex = extractArticle(html, 'https://daydream.example/vent/')!
    expect(ex.contentHtml).toContain('src="https://daydream.example/wp-content/uploads/vent.jpg"')
    expect(ex.contentHtml).not.toContain('data:image/svg')
  })
})
