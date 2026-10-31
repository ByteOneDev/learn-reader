import { useLayoutEffect, type RefObject } from 'react'
import type { Highlight } from '@shared/types'
import { applyHighlights } from '../lib/highlightDom'

/** Contenu de l'article, monté une fois par article : géré à la main (et non par React) pour y insérer les <mark>. */
export default function ArticleContent({ contentRef, html, layer, highlights, serif, onOrphans, onMouseUp, onClick }: {
  contentRef: RefObject<HTMLDivElement | null>
  html: string
  layer: string
  highlights: Highlight[]
  serif: boolean
  onOrphans(ids: Set<string>): void
  onMouseUp(): void
  onClick(e: React.MouseEvent): void
}): React.JSX.Element {
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.innerHTML = html // déjà nettoyé par DOMPurify (lib/sanitize)
    onOrphans(applyHighlights(el, highlights))
    // Image introuvable : on la masque (et sa figure si elle était seule) plutôt qu'un cadre vide.
    // Petite image (icône, logo) : affichée à sa taille, sans le débordement réservé aux photos.
    for (const img of Array.from(el.querySelectorAll('img'))) {
      const settle = (): void => {
        if (img.naturalWidth && img.naturalWidth < 360) img.classList.add('small')
      }
      if (img.complete) settle()
      img.addEventListener('load', settle, { once: true })
      img.addEventListener(
        'error',
        () => {
          const fig = img.closest('figure')
          if (fig && fig.querySelectorAll('img').length === 1) fig.style.display = 'none'
          else img.style.display = 'none'
        },
        { once: true }
      )
    }
  }, [contentRef, html, highlights, onOrphans])
  return <div ref={contentRef} data-layer={layer} className={`content${serif ? ' serif' : ''}`} onMouseUp={onMouseUp} onClick={onClick} />
}
