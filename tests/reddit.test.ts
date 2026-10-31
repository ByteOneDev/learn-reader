import { describe, expect, it } from 'vitest'
import { fetchText, REDDIT_USER_AGENT } from '../src/main/feeds/fetcher'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import { friendlyError } from '../src/renderer/src/lib/errors'

const RSS = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>r/tui</title><entry><id>t3_1</id><title>Bonjour</title><link href="https://www.reddit.com/r/tui/1"/></entry></feed>'

describe('Reddit et limite de requêtes', () => {
  it('s’identifie auprès de Reddit et réessaie après un 429', async () => {
    const calls: { ua: string; at: number }[] = []
    const fetchFn = async (_u: string, init?: RequestInit): Promise<Response> => {
      calls.push({ ua: (init?.headers as Record<string, string>)['User-Agent'], at: Date.now() })
      return calls.length === 1 ? new Response('', { status: 429, headers: { 'retry-after': '1' } }) : new Response(RSS)
    }
    const r = await fetchText(fetchFn, 'https://www.reddit.com/r/tui/.rss')
    expect(r.body).toContain('Bonjour')
    expect(calls).toHaveLength(2)
    expect(calls[0].ua).toBe(REDDIT_USER_AGENT)
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(900)
  }, 15_000)

  it('s’abonne quand même si Reddit refuse encore, sans perdre l’abonnement', async () => {
    const store = await openDatabase(null)
    const core = new LearnCore(store, async () => new Response('', { status: 429, headers: { 'retry-after': '0' } }))
    const s = await core.addSource({ input: 'https://www.reddit.com/r/tui/' })
    expect(s).toMatchObject({ kind: 'reddit', title: 'r/tui', url: 'https://www.reddit.com/r/tui/.rss' })
    expect(s.error).toMatch(/Limite de requêtes/)
    expect(store.listSources()).toHaveLength(1)
  }, 30_000)

  it('affiche des erreurs lisibles', () => {
    expect(friendlyError("Error invoking remote method 'learn:addSource': Error: HTTP 429")).toMatch(/limite le nombre de requêtes/)
    expect(friendlyError("Error invoking remote method 'learn:addSource': Error: Aucun flux trouvé à cette adresse")).toBe('Aucun flux trouvé à cette adresse')
    expect(friendlyError('HTTP 418')).toBe('Erreur du site (HTTP 418).')
  })
})
