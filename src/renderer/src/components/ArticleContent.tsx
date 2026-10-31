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
  }, [contentRef, html, highlights, onOrphans])
  return <div ref={contentRef} data-layer={layer} className={`content${serif ? ' serif' : ''}`} onMouseUp={onMouseUp} onClick={onClick} />
}
