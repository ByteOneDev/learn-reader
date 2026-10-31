// Liens learn:// : learn://open?item=<id>[&highlight=<id>] ouvre un document, ou un passage, dans Learn.

export function learnLink(itemId: string, highlightId?: string): string {
  return `learn://open?item=${encodeURIComponent(itemId)}${highlightId ? `&highlight=${encodeURIComponent(highlightId)}` : ''}`
}

export function parseLearnLink(url: string): { itemId: string; highlightId?: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'learn:' || (u.hostname || u.pathname.replace(/^\/+/, '')) !== 'open') return null
    const itemId = u.searchParams.get('item')
    if (!itemId) return null
    return { itemId, highlightId: u.searchParams.get('highlight') ?? undefined }
  } catch {
    return null
  }
}
