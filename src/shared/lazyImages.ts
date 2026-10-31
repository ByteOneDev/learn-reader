// Images en chargement différé (« lazy loading ») : beaucoup de sites (WordPress, Medium, médias)
// mettent dans `src` une image factice (SVG vide aux bonnes dimensions, GIF d'un pixel) et la vraie
// adresse dans un attribut `data-*`, remplacé par JavaScript au défilement. Sans ce script, on obtient
// un cadre vide. On récupère ici la vraie image. Fonctions DOM standard : navigateur et linkedom.

const SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'data-large-file', 'data-url', 'data-hi-res-src', 'data-actualsrc', 'data-lazyload', 'data-echo']
const SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset', 'data-original-set']

/** `src` qui n'est pas la vraie image : absent, data: (SVG vide, GIF transparent) ou image « placeholder ». */
export function isPlaceholder(src: string | null | undefined): boolean {
  if (!src || !src.trim()) return true
  const s = src.trim()
  if (s.startsWith('data:')) return true
  return /(^|[/_.-])(blank|spacer|placeholder|lazy|transparent|pixel|grey|gray|loading)[^/]*\.(gif|png|svg|jpe?g|webp)(\?|$)/i.test(s)
}

/** SVG intégré sans aucun contenu dessiné : le rectangle vide des chargeurs différés. */
export function isEmptySvg(src: string): boolean {
  if (!src.startsWith('data:image/svg')) return false
  let svg = src.slice(src.indexOf(',') + 1)
  try {
    svg = /;base64,/.test(src) ? atob(svg) : decodeURIComponent(svg)
  } catch {
    return false
  }
  return /<svg[^>]*?(\/>|>\s*<\/svg>)\s*$/i.test(svg.trim())
}

/** Première adresse d'un srcset, ou la plus grande si les largeurs sont indiquées. */
export function bestFromSrcset(srcset: string): string | undefined {
  const parts = srcset
    .split(/,\s+(?=\S)/)
    .map((p) => p.trim().split(/\s+/))
    .filter((p) => p[0] && !p[0].startsWith('data:'))
  if (!parts.length) return undefined
  const width = (d?: string): number => (d && /^\d+w$/.test(d) ? parseInt(d, 10) : 0)
  return parts.sort((a, b) => width(b[1]) - width(a[1]))[0][0]
}

function absolute(url: string, base?: string): string {
  try {
    return base ? new URL(url, base).href : url
  } catch {
    return url
  }
}

/** Remplace les images factices par les vraies, et rend les adresses absolues. Renvoie le nombre d'images réparées. */
export function fixLazyImages(root: ParentNode, base?: string): number {
  let fixed = 0
  const doc = (root as Node).ownerDocument ?? (root as unknown as Document)

  // <noscript><img …></noscript> : la version sans JavaScript contient souvent la vraie image.
  for (const ns of Array.from(root.querySelectorAll('noscript'))) {
    // Selon l'analyseur, le contenu de <noscript> est du texte brut ou de vrais éléments.
    const html = ns.textContent ?? ''
    const inner = ns.querySelector('img')?.getAttribute('src')
    const m = inner ? [inner, inner] : html.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)
    const prev = ns.previousElementSibling
    if (m && prev?.tagName === 'IMG' && isPlaceholder(prev.getAttribute('src'))) {
      prev.setAttribute('src', m[1])
      fixed++
    } else if (m && !prev?.matches?.('img')) {
      const img = doc.createElement('img')
      img.setAttribute('src', m[1])
      ns.replaceWith(img)
      fixed++
      continue
    }
    ns.remove()
  }

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    const lazySrc = SRC_ATTRS.map((a) => img.getAttribute(a)).find((v) => v && !v.startsWith('data:'))
    const lazySet = SRCSET_ATTRS.map((a) => img.getAttribute(a)).find(Boolean)
    if (lazySet) img.setAttribute('srcset', lazySet)
    if (isPlaceholder(src)) {
      // <picture><source srcset> : la vraie image peut être dans une source.
      const pictureSet = img.parentElement?.tagName === 'PICTURE' ? Array.from(img.parentElement.querySelectorAll('source')).map((s) => s.getAttribute('srcset') ?? s.getAttribute('data-srcset')).find(Boolean) : undefined
      const real = lazySrc ?? (lazySet ? bestFromSrcset(lazySet) : undefined) ?? (img.getAttribute('srcset') ? bestFromSrcset(img.getAttribute('srcset')!) : undefined) ?? (pictureSet ? bestFromSrcset(pictureSet) : undefined)
      if (real) {
        img.setAttribute('src', real)
        fixed++
      } else if (src && isEmptySvg(src)) {
        img.remove() // cadre vide sans vraie image derrière : on l'enlève plutôt que d'afficher un rectangle blanc
        continue
      }
    }
    // srcset factice (data:) : on le retire pour que le navigateur utilise src.
    const set = img.getAttribute('srcset')
    if (set && set.trim().startsWith('data:')) img.removeAttribute('srcset')
    if (base) {
      const s = img.getAttribute('src')
      if (s && !s.startsWith('data:')) img.setAttribute('src', absolute(s, base))
      const ss = img.getAttribute('srcset')
      if (ss)
        img.setAttribute(
          'srcset',
          ss
            .split(/,\s+(?=\S)/)
            .map((p) => {
              const [u, d] = p.trim().split(/\s+/, 2)
              return [absolute(u, base), d].filter(Boolean).join(' ')
            })
            .join(', ')
        )
    }
    img.removeAttribute('loading')
  }
  // Les liens relatifs aussi, sinon ils pointent vers l'app elle-même.
  if (base) for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href')!
    if (!href.startsWith('#') && !/^[a-z]+:/i.test(href)) a.setAttribute('href', absolute(href, base))
  }
  return fixed
}
