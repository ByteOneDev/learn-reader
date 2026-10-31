import DOMPurify from 'dompurify'

// Le HTML des flux et des pages vient d'Internet : on ne garde que la mise en forme de lecture.
const purify = DOMPurify()

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy')
    node.setAttribute('referrerpolicy', 'no-referrer')
    node.removeAttribute('width')
    node.removeAttribute('height')
  }
})

export function sanitize(html: string): string {
  return purify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta', 'svg', 'math', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'class', 'id'],
    ALLOW_DATA_ATTR: false
  })
}

/** Variante pour les chapitres d'EPUB : on garde les identifiants (déjà préfixés par Learn) pour les renvois internes. */
export function sanitizeBook(html: string): string {
  return purify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta', 'svg', 'math', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'class'],
    ALLOW_DATA_ATTR: false
  })
}
