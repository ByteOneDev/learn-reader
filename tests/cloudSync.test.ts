import { describe, expect, it } from 'vitest'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import { CloudSync, itemKey } from '../src/main/cloud/cloudSync'

// Faux Supabase : authentification par mot de passe, fonction learn_push (la version la plus récente gagne),
// lecture incrémentale par server_at. Suffisant pour faire dialoguer deux appareils.
function fakeSupabase() {
  const users = new Map<string, { id: string; password: string }>()
  const rows = new Map<string, { kind: string; key: string; data: unknown; deleted: boolean; updated_at: number; device?: string; server_at: string; user: string }>()
  let clock = Date.parse('2026-11-04T10:00:00Z')
  const tick = (): string => new Date((clock += 10)).toISOString()
  const tokens = new Map<string, string>()
  const session = (id: string, email: string): Record<string, unknown> => {
    const t = `tok_${id}_${tokens.size}`
    tokens.set(t, id)
    return { access_token: t, refresh_token: `ref_${id}`, expires_in: 3600, user: { id, email } }
  }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (u.pathname === '/auth/v1/signup') {
      const id = `u_${users.size + 1}`
      users.set(body.email, { id, password: body.password })
      return json(session(id, body.email))
    }
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') return json(session(String(body.refresh_token).slice(4), 'x'))
      const user = users.get(body.email)
      if (!user || user.password !== body.password) return json({ error_description: 'Invalid login credentials' }, 400)
      return json(session(user.id, body.email))
    }
    const auth = (init?.headers as Record<string, string>)?.Authorization?.replace('Bearer ', '')
    const user = auth && tokens.get(auth)
    if (!user) return json({ message: 'JWT expired' }, 401)
    if (u.pathname === '/rest/v1/rpc/learn_push') {
      let written = 0
      for (const r of body.records) {
        const id = `${user}|${r.kind}|${r.key}`
        const prev = rows.get(id)
        if (prev && !(r.updated_at > prev.updated_at)) continue
        rows.set(id, { ...r, user, server_at: tick() })
        written++
      }
      return json(written)
    }
    if (u.pathname === '/rest/v1/learn_records') {
      const after = (u.searchParams.get('server_at') ?? 'gt.1970').slice(3)
      const limit = Number(u.searchParams.get('limit') ?? 1000)
      const list = [...rows.values()].filter((r) => r.user === user && r.server_at > after).sort((a, b) => a.server_at.localeCompare(b.server_at)).slice(0, limit)
      return json(list.map(({ user: _u, ...r }) => r))
    }
    return json({ message: 'not found' }, 404)
  }
  return { fetchFn, rows }
}

const RSS = (n: number): string => `<?xml version="1.0"?><rss version="2.0"><channel><title>Revue</title><link>https://r.example/</link>
${Array.from({ length: n }, (_, i) => `<item><title>Article ${i + 1}</title><link>https://r.example/${i + 1}</link><guid>g${i + 1}</guid></item>`).join('')}</channel></rss>`

const box = { encrypt: (s: string) => `b64:${Buffer.from(s).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(4), 'base64').toString() }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function device(server: ReturnType<typeof fakeSupabase>, items: number) {
  const store = await openDatabase(null)
  const core = new LearnCore(store, async () => new Response(RSS(items)))
  const cloud = new CloudSync(core, server.fetchFn, box)
  return { store, core, cloud }
}

const ACCOUNT = { url: 'https://projet.supabase.co', anonKey: 'anon', email: 'moi@exemple.fr', password: 'secret123' }

describe('synchronisation entre appareils (Supabase)', () => {
  it('fait passer abonnements, marques, surlignages et boards d’un appareil à l’autre', async () => {
    const server = fakeSupabase()
    const A = await device(server, 3)
    // A : un abonnement, un article gardé et tagué, un surlignage, un board.
    const source = await A.core.addSource({ input: 'https://r.example/feed.xml', category: 'tech' })
    const art = A.store.findItemByGuid(source.id, 'g2')!
    A.store.updateItem(art.id, { later: true, tags: ['réseau'] })
    const h = A.core.addHighlight({ itemId: art.id, color: 'green', quote: 'un passage', prefix: '', suffix: '', start: 0, end: 10, note: 'à creuser', layer: 'feed' })
    const board = A.core.createBoard('Idées', 'mindmap')
    const status = await A.cloud.connect({ ...ACCOUNT, create: true })
    expect(status).toMatchObject({ connected: true, pending: 0, email: ACCOUNT.email })
    expect(server.rows.size).toBe(4)

    // B : un autre ordinateur, même compte, flux pas encore téléchargé.
    const B = await device(server, 3)
    await B.cloud.connect(ACCOUNT)
    const src = B.store.findSourceByUrl(source.url)!
    expect(src).toMatchObject({ title: 'Revue', category: 'tech' })
    const twin = B.store.findItemByGuid(src.id, 'g2')!
    expect(twin).toMatchObject({ title: 'Article 2', later: true, tags: ['réseau'] })
    expect(B.store.getHighlight(h.id)).toMatchObject({ itemId: twin.id, note: 'à creuser', color: 'green' })
    expect(B.store.getBoard(board.id)?.title).toBe('Idées')
    // Le flux arrive ensuite sur B : pas de doublon, l'état est conservé.
    await B.core.refresh()
    expect(B.store.listItems({ view: { type: 'source', sourceId: src.id } })).toHaveLength(3)
    expect(B.store.findItemByGuid(src.id, 'g2')).toMatchObject({ id: twin.id, later: true })
  })

  it('garde la modification la plus récente, et propage les suppressions', async () => {
    const server = fakeSupabase()
    const A = await device(server, 2)
    const source = await A.core.addSource({ input: 'https://r.example/feed.xml' })
    const a1 = A.store.findItemByGuid(source.id, 'g1')!
    const h = A.core.addHighlight({ itemId: a1.id, color: 'yellow', quote: 'x', prefix: '', suffix: '', start: 0, end: 1, note: '', layer: 'feed' })
    await A.cloud.connect({ ...ACCOUNT, create: true })
    const B = await device(server, 2)
    await B.cloud.connect(ACCOUNT)
    const b1 = B.store.findItemByGuid(B.store.findSourceByUrl(source.url)!.id, 'g1')!

    // A met en favori, puis B retire le favori plus tard : B gagne, partout.
    A.store.updateItem(a1.id, { favorite: true })
    A.cloud.touchItem(a1.id)
    await sleep(5)
    B.store.updateItem(b1.id, { favorite: false, bookmarked: true })
    B.cloud.touchItem(b1.id)
    await A.cloud.sync()
    await B.cloud.sync()
    await A.cloud.sync()
    expect(A.store.getItem(a1.id)).toMatchObject({ favorite: false, bookmarked: true })
    expect(B.store.getItem(b1.id)).toMatchObject({ favorite: false, bookmarked: true })

    // A supprime le surlignage : il disparaît sur B.
    A.store.removeHighlight(h.id)
    A.cloud.touchHighlight(h.id, a1.id)
    await A.cloud.sync()
    await B.cloud.sync()
    expect(B.store.getHighlight(h.id)).toBeUndefined()

    // A se désabonne : B aussi (les articles annotés ou marqués passent dans « Liens »).
    A.core.removeSource(source.id)
    A.cloud.touchSource(source.url)
    await A.cloud.sync()
    await B.cloud.sync()
    expect(B.store.findSourceByUrl(source.url)).toBeUndefined()
    expect(B.store.listItems({ view: { type: 'links' } }).map((i) => i.title)).toContain('Article 1')
  })

  it('refuse un mauvais mot de passe sans rien casser', async () => {
    const server = fakeSupabase()
    const A = await device(server, 1)
    await A.cloud.connect({ ...ACCOUNT, create: true })
    const B = await device(server, 1)
    await expect(B.cloud.connect({ ...ACCOUNT, password: 'faux' })).rejects.toThrow(/Invalid login/)
    expect(B.cloud.status().connected).toBe(false)
    expect(itemKey('https://a/feed', 'g')).toContain('g')
  })
})
