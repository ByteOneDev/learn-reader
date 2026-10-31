import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'

// Serveur Notion simulé (API 2022-06-28), juste ce qu'utilise Learn : utilisateurs, bases, pages,
// requêtes, blocs (lecture, ajout avec `after`, modification, suppression). Il vérifie les en-têtes,
// la forme des requêtes, et sait renvoyer un 429 pour tester les nouvelles tentatives.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FakeBlock {
  id: string
  type: string
  data: Json
  children: string[]
  archived: boolean
}

export class FakeNotion {
  server!: Server
  url = ''
  token = 'secret_test'
  requests: { method: string; path: string }[] = []
  rateLimitNext = 0
  databases = new Map<string, Json>()
  pages = new Map<string, Json & { children: string[] }>()
  blocks = new Map<string, FakeBlock>()
  private clock = Date.parse('2026-10-31T10:00:00Z')

  private now(): string {
    this.clock += 60_000
    return new Date(this.clock).toISOString()
  }

  /** Simule une modification faite par l'utilisateur dans Notion (après notre dernière relève). */
  touchPage(pageId: string): void {
    this.pages.get(pageId)!.last_edited_time = new Date(Date.now() + 60_000).toISOString()
  }

  private richText(rt: Json[] = []): Json[] {
    return rt.map((r) => ({ type: 'text', text: r.text, annotations: { bold: false, italic: false, code: false, color: 'default', ...(r.annotations ?? {}) }, plain_text: r.text.content, href: r.text.link?.url ?? null }))
  }

  private createBlock(b: Json): string {
    if (b.object && b.object !== 'block') throw new Error('bloc invalide')
    const id = randomUUID()
    const content = { ...b[b.type] }
    const kids: Json[] = content.children ?? []
    delete content.children
    if (content.rich_text) content.rich_text = this.richText(content.rich_text)
    this.blocks.set(id, { id, type: b.type, data: content, children: kids.map((k) => this.createBlock(k)), archived: false })
    return id
  }

  blockJson(id: string): Json {
    const b = this.blocks.get(id)!
    return { object: 'block', id, type: b.type, has_children: b.children.some((c) => !this.blocks.get(c)!.archived), archived: b.archived, [b.type]: b.data }
  }

  childrenOf(parentId: string): string[] {
    const list = this.pages.get(parentId)?.children ?? this.blocks.get(parentId)?.children ?? []
    return list.filter((id) => !this.blocks.get(id)!.archived)
  }

  private handle(method: string, path: string, body: Json): [number, Json] {
    let m: RegExpMatchArray | null
    if (method === 'GET' && path === '/v1/users/me') return [200, { object: 'user', id: 'bot', name: 'Espace de test', type: 'bot' }]
    if (method === 'POST' && path === '/v1/databases') {
      if (body.parent?.type !== 'page_id' || !body.properties?.Name?.title) return [400, { code: 'validation_error', message: 'body failed validation' }]
      const id = randomUUID()
      this.databases.set(id, { id, ...body })
      return [200, { object: 'database', id, url: `https://www.notion.so/${id.replace(/-/g, '')}` }]
    }
    if (method === 'POST' && path === '/v1/pages') {
      if (!this.databases.has(body.parent?.database_id)) return [404, { code: 'object_not_found', message: 'Could not find database' }]
      if ((body.children ?? []).length > 100) return [400, { code: 'validation_error', message: 'children too long' }]
      const id = randomUUID()
      const page = { object: 'page', id, parent: body.parent, properties: this.props(body.properties), last_edited_time: this.now(), archived: false, children: (body.children ?? []).map((c: Json) => this.createBlock(c)) }
      this.pages.set(id, page)
      return [200, this.pageJson(id)]
    }
    if ((m = path.match(/^\/v1\/pages\/([\w-]+)$/)) && method === 'PATCH') {
      const page = this.pages.get(m[1])
      if (!page) return [404, { code: 'object_not_found', message: 'Could not find page' }]
      if (page.archived) return [400, { code: 'validation_error', message: "Can't edit block that is archived." }]
      Object.assign(page.properties, this.props(body.properties))
      page.last_edited_time = this.now()
      return [200, this.pageJson(m[1])]
    }
    if ((m = path.match(/^\/v1\/databases\/([\w-]+)\/query$/)) && method === 'POST') {
      const since = body.filter?.last_edited_time?.on_or_after
      const results = [...this.pages.keys()]
        .filter((id) => this.pages.get(id)!.parent.database_id === m![1] && !this.pages.get(id)!.archived)
        .filter((id) => !since || this.pages.get(id)!.last_edited_time >= since)
        .map((id) => this.pageJson(id))
      return [200, { object: 'list', results, has_more: false, next_cursor: null }]
    }
    if ((m = path.match(/^\/v1\/blocks\/([\w-]+)\/children$/))) {
      const parent = m[1]
      if (!this.pages.has(parent) && !this.blocks.has(parent)) return [404, { code: 'object_not_found', message: 'Could not find block' }]
      if (method === 'GET') return [200, { object: 'list', results: this.childrenOf(parent).map((id) => this.blockJson(id)), has_more: false, next_cursor: null }]
      if (method === 'PATCH') {
        if ((body.children ?? []).length > 100) return [400, { code: 'validation_error', message: 'children too long' }]
        const list = this.pages.get(parent)?.children ?? this.blocks.get(parent)!.children
        const created = (body.children as Json[]).map((c) => this.createBlock(c))
        if (body.after) {
          const at = list.indexOf(body.after)
          if (at === -1) return [400, { code: 'validation_error', message: 'after block not found' }]
          list.splice(at + 1, 0, ...created)
        } else list.push(...created)
        this.bumpPageOf(parent)
        return [200, { object: 'list', results: created.map((id) => this.blockJson(id)) }]
      }
    }
    if ((m = path.match(/^\/v1\/blocks\/([\w-]+)$/))) {
      const b = this.blocks.get(m[1])
      if (!b || b.archived) return [404, { code: 'object_not_found', message: 'Could not find block' }]
      if (method === 'DELETE') {
        b.archived = true
        return [200, this.blockJson(b.id)]
      }
      if (method === 'PATCH') {
        const content = body[b.type]
        if (!content) return [400, { code: 'validation_error', message: 'type mismatch' }]
        if (content.rich_text) b.data.rich_text = this.richText(content.rich_text)
        if (content.color) b.data.color = content.color
        return [200, this.blockJson(b.id)]
      }
    }
    return [404, { code: 'invalid_request_url', message: `Unknown ${method} ${path}` }]
  }

  private bumpPageOf(blockOrPage: string): void {
    const p = this.pages.get(blockOrPage)
    if (p) p.last_edited_time = this.now()
  }

  private props(p: Json = {}): Json {
    const out: Json = {}
    for (const [k, v] of Object.entries(p)) {
      if (v.title) out[k] = { type: 'title', title: this.richText(v.title) }
      else if (v.rich_text) out[k] = { type: 'rich_text', rich_text: this.richText(v.rich_text) }
      else if ('url' in v) out[k] = { type: 'url', url: v.url }
      else if (v.select) out[k] = { type: 'select', select: v.select }
      else if (v.multi_select) out[k] = { type: 'multi_select', multi_select: v.multi_select.map((x: Json) => ({ name: x.name })) }
    }
    return out
  }

  pageJson(id: string): Json {
    const p = this.pages.get(id)!
    return { object: 'page', id, parent: p.parent, properties: p.properties, last_edited_time: p.last_edited_time, archived: p.archived }
  }

  /** Blocs de premier niveau d'une page, sous une forme lisible pour les tests. */
  quotes(pageId: string): { id: string; text: string; color: string; note: string }[] {
    return this.childrenOf(pageId)
      .map((id) => this.blocks.get(id)!)
      .filter((b) => b.type === 'quote')
      .map((b) => ({
        id: b.id,
        text: b.data.rich_text.map((r: Json) => r.plain_text).join(''),
        color: b.data.color,
        note: this.childrenOf(b.id)
          .map((c) => this.blocks.get(c)!.data.rich_text.map((r: Json) => r.plain_text).join(''))
          .join('\n\n')
      }))
  }

  setNote(quoteId: string, paragraphs: Json[][]): void {
    const b = this.blocks.get(quoteId)!
    for (const c of b.children) this.blocks.get(c)!.archived = true
    b.children = paragraphs.map((rt) => this.createBlock({ type: 'paragraph', paragraph: { rich_text: rt } }))
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const path = req.url ?? '/'
        this.requests.push({ method: req.method ?? 'GET', path })
        const reply = (status: number, json: Json): void => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(json))
        }
        if (req.headers.authorization !== `Bearer ${this.token}`) return reply(401, { code: 'unauthorized', message: 'API token is invalid.' })
        if (req.headers['notion-version'] !== '2022-06-28') return reply(400, { code: 'missing_version', message: 'Notion-Version header failed validation' })
        if (this.rateLimitNext > 0) {
          this.rateLimitNext--
          res.setHeader('Retry-After', '0')
          return reply(429, { code: 'rate_limited', message: 'Rate limited' })
        }
        try {
          const [status, json] = this.handle(req.method ?? 'GET', path.split('?')[0], raw ? JSON.parse(raw) : {})
          reply(status, json)
        } catch (e) {
          reply(400, { code: 'validation_error', message: (e as Error).message })
        }
      })
    })
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()))
    const a = this.server.address()
    this.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  }

  stop(): void {
    this.server.close()
  }
}
