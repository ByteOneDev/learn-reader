import type { FetchFn } from '../feeds/fetcher'
import type { NotionBlock } from './convert'

// Client minimal de l'API Notion (version 2022-06-28, toujours acceptée) : file d'attente respectant
// la limite d'environ 3 requêtes par seconde, nouvelle tentative sur 429 / 5xx.

export const NOTION_VERSION = '2022-06-28'
const MIN_INTERVAL = 350

export class NotionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
  }
}

export interface NotionPage {
  id: string
  last_edited_time: string
  archived?: boolean
  in_trash?: boolean
  properties: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class NotionClient {
  private queue: Promise<unknown> = Promise.resolve()
  private last = 0

  constructor(
    private token: string,
    private fetchFn: FetchFn,
    private baseUrl = 'https://api.notion.com'
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + MIN_INTERVAL - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        this.last = Date.now()
        const res = await this.fetchFn(`${this.baseUrl}/v1${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        })
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const retry = Number(res.headers.get('retry-after') ?? 0)
          await new Promise((r) => setTimeout(r, retry ? retry * 1000 : 500 * 2 ** attempt))
          continue
        }
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) throw new NotionError(String(json.message ?? `Notion : HTTP ${res.status}`), res.status, json.code as string | undefined)
        return json as T
      }
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  me(): Promise<{ id: string; name?: string; bot?: { owner?: unknown } }> {
    return this.request('GET', '/users/me')
  }

  createDatabase(parentPageId: string, title: string, properties: Record<string, unknown>): Promise<{ id: string; url?: string }> {
    return this.request('POST', '/databases', { parent: { type: 'page_id', page_id: parentPageId }, title: [{ type: 'text', text: { content: title } }], properties })
  }

  createPage(databaseId: string, properties: Record<string, unknown>, children: NotionBlock[]): Promise<NotionPage> {
    return this.request('POST', '/pages', { parent: { database_id: databaseId }, properties, children })
  }

  updatePage(pageId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    return this.request('PATCH', `/pages/${pageId}`, { properties })
  }

  async queryDatabase(databaseId: string, editedSince?: string): Promise<NotionPage[]> {
    const out: NotionPage[] = []
    let cursor: string | undefined
    do {
      const r = await this.request<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>('POST', `/databases/${databaseId}/query`, {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        ...(editedSince ? { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: editedSince } } } : {})
      })
      out.push(...r.results)
      cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined
    } while (cursor)
    return out
  }

  async children(blockId: string): Promise<NotionBlock[]> {
    const out: NotionBlock[] = []
    let cursor: string | undefined
    do {
      const r = await this.request<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>(
        'GET',
        `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      )
      out.push(...r.results)
      cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined
    } while (cursor)
    return out
  }

  /** Ajoute des blocs (par lots de 100, limite de l'API), éventuellement après un bloc donné. */
  async append(parentId: string, children: NotionBlock[], after?: string): Promise<NotionBlock[]> {
    const created: NotionBlock[] = []
    for (let i = 0; i < children.length; i += 100) {
      const r = await this.request<{ results: NotionBlock[] }>('PATCH', `/blocks/${parentId}/children`, {
        children: children.slice(i, i + 100),
        ...(after ? { after } : {})
      })
      created.push(...r.results)
      after = r.results.at(-1)?.id ?? after
    }
    return created
  }

  updateBlock(blockId: string, body: Record<string, unknown>): Promise<NotionBlock> {
    return this.request('PATCH', `/blocks/${blockId}`, body)
  }

  deleteBlock(blockId: string): Promise<NotionBlock> {
    return this.request('DELETE', `/blocks/${blockId}`)
  }
}
