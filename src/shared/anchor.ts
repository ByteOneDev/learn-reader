// Ancrage des surlignages par citation (inspiré du TextQuoteSelector du W3C).
// Fonctions pures : testées sans DOM, utilisées par l'interface.

export const CONTEXT_LENGTH = 32

export function contextOf(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH)
  }
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Retrouve la position d'une citation dans un texte.
 * 1. La position mémorisée correspond encore : on la garde.
 * 2. Sinon on compare toutes les occurrences selon le contexte avant/après, puis la distance à l'ancienne position.
 */
export function findQuote(
  text: string,
  anchor: { quote: string; prefix: string; suffix: string; start: number }
): { start: number; end: number } | null {
  const { quote, prefix, suffix, start } = anchor
  if (!quote) return null
  if (text.slice(start, start + quote.length) === quote) return { start, end: start + quote.length }

  let best: { start: number; score: number } | null = null
  let from = 0
  for (;;) {
    const at = text.indexOf(quote, from)
    if (at === -1) break
    const before = text.slice(Math.max(0, at - prefix.length), at)
    const after = text.slice(at + quote.length, at + quote.length + suffix.length)
    const score =
      commonSuffixLength(before, prefix) * 2 +
      commonPrefixLength(after, suffix) * 2 -
      Math.abs(at - start) / Math.max(1, text.length)
    if (!best || score > best.score) best = { start: at, score }
    from = at + 1
  }
  return best ? { start: best.start, end: best.start + quote.length } : null
}
