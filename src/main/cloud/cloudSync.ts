import type { Board, CloudStatus, Item, LearnEvent, Source } from '@shared/types'
import type { SourceFilter } from '@shared/filters'
import { uid } from '@shared/util'
import type { CloudKind } from '../db'
import { LINKS_SOURCE_URL, type LearnCore } from '../core'
import type { FetchFn } from '../feeds/fetcher'
import type { SecretBox } from '../notion/notionSync'

// Synchronisation entre appareils par Supabase (bêta).
//
// - Chaque modification locale est notée (table cloud_state) puis envoyée par paquets à la fonction
//   learn_push, qui ne garde que la version la plus récente de chaque élément.
// - La relève ne demande que ce qui a changé sur le serveur depuis la dernière fois (server_at).
// - Un même article n'a pas le même identifiant sur deux appareils : il est désigné par l'adresse de son
//   flux et son identifiant dans le flux (guid). Surlignages et boards gardent leur identifiant.
// - Ce qui voyage : abonnements, marques, tags, position de lecture, surlignages et notes, boards. Pas le
//   texte des articles (chaque appareil le récupère lui-même), ni les livres.

const PUSH_DELAY = 3000
const POLL_MS = 60_000
const PAGE = 1000
const ORDER: Record<CloudKind, number> = { source: 0, item: 1, highlight: 2, board: 3 }
const SEP = '\u001f'

interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  email: string
}

interface RemoteRecord {
  kind: CloudKind
  key: string
  data: Record<string, unknown>
  deleted: boolean
  updated_at: number
  device?: string
  server_at: string
}

interface ItemPayload {
  sourceUrl: string
  guid: string
  url?: string
  title: string
  publishedAt: number
  imageUrl?: string
  read: boolean
  later: boolean
  bookmarked: boolean
  favorite: boolean
  tags: string[]
  position?: string
  progress?: number
}

export const itemKey = (sourceUrl: string, guid: string): string => `${sourceUrl}${SEP}${guid}`
const splitItemKey = (key: string): [string, string] => {
  const i = key.indexOf(SEP)
  return [key.slice(0, i), key.slice(i + 1)]
}

export class CloudSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<CloudStatus> | null = null
  private lastError: string | undefined

  constructor(
    private core: LearnCore,
    private fetchFn: FetchFn,
    private box: SecretBox,
    private emit: (e: LearnEvent) => void = () => {}
  ) {}

  // ── Compte ────────────────────────────────────────────────────────────────

  private get store() {
    return this.core.store
  }

  private config(): { url: string; anonKey: string } | null {
    const s = this.store.getSettings()
    return s.cloudUrl && s.cloudAnonKey ? { url: s.cloudUrl.replace(/\/+$/, ''), anonKey: s.cloudAnonKey } : null
  }

  private session(): Session | null {
    const sealed = this.store.getSecret('cloud')
    if (!sealed) return null
    try {
      return JSON.parse(this.box.decrypt(sealed)) as Session
    } catch {
      return null
    }
  }

  private saveSession(s: Session | null): void {
    this.store.setSecret('cloud', s ? this.box.encrypt(JSON.stringify(s)) : undefined)
  }

  status(): CloudStatus {
    const s = this.store.getSettings()
    const session = this.session()
    return {
      connected: !!session && !!this.config(),
      email: session?.email ?? s.cloudEmail,
      url: s.cloudUrl,
      lastSync: s.cloudLastSync,
      pending: this.store.cloudDirty(10_000).length,
      error: this.lastError
    }
  }

  private async auth(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const c = this.config()
    if (!c) throw new Error('Renseigne d’abord l’adresse et la clé du projet Supabase')
    const res = await this.fetchFn(`${c.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: c.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(String(json.error_description ?? json.msg ?? json.message ?? `Supabase : HTTP ${res.status}`))
    return json
  }

  private toSession(json: Record<string, unknown>, email: string): Session {
    const user = json.user as { id?: string; email?: string } | undefined
    if (!json.access_token || !json.refresh_token || !user?.id) {
      throw new Error('Compte créé : confirme ton adresse avec l’e-mail de Supabase, puis connecte-toi')
    }
    return {
      accessToken: String(json.access_token),
      refreshToken: String(json.refresh_token),
      expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
      userId: user.id,
      email: user.email ?? email
    }
  }

  /** Connexion (ou création du compte), puis premier envoi de tout ce qui existe sur cet appareil. */
  async connect(opts: { url: string; anonKey: string; email: string; password: string; create?: boolean }): Promise<CloudStatus> {
    const previous = this.store.getSettings()
    this.store.updateSettings({ cloudUrl: opts.url.trim(), cloudAnonKey: opts.anonKey.trim(), cloudEmail: opts.email.trim() })
    const email = opts.email.trim()
    const json = opts.create ? await this.auth('signup', { email, password: opts.password }) : await this.auth('token?grant_type=password', { email, password: opts.password })
    const session = this.toSession(json, email)
    // Autre compte que la dernière fois : tout repart de zéro.
    if (this.session()?.userId !== session.userId || previous.cloudUrl !== opts.url.trim()) {
      this.store.cloudReset()
      this.store.updateSettings({ cloudLastPull: undefined, cloudLastSync: undefined })
    }
    this.saveSession(session)
    if (!this.store.getSettings().cloudDevice) this.store.updateSettings({ cloudDevice: uid('d_') })
    this.markEverything()
    this.restart()
    return this.sync()
  }

  disconnect(): CloudStatus {
    this.stop()
    this.saveSession(null)
    this.lastError = undefined
    return this.status()
  }

  private async token(): Promise<string> {
    const s = this.session()
    if (!s) throw new Error('Connecte-toi d’abord à la synchronisation')
    if (Date.now() < s.expiresAt - 60_000) return s.accessToken
    const json = await this.auth('token?grant_type=refresh_token', { refresh_token: s.refreshToken })
    const next = this.toSession(json, s.email)
    this.saveSession(next)
    return next.accessToken
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const c = this.config()!
    const res = await this.fetchFn(`${c.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: c.anonKey, Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(`Synchronisation : ${json.message ?? `HTTP ${res.status}`}`)
    }
    return res
  }

  // ── Modifications locales ─────────────────────────────────────────────────

  private schedulePush(): void {
    if (!this.timer) return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => void this.sync().catch(() => undefined), PUSH_DELAY)
  }

  touchItem(itemId: string): void {
    const item = this.store.getItem(itemId)
    const source = item && this.store.getSource(item.sourceId)
    if (!item || !source) return
    this.store.cloudTouch('item', itemKey(source.url, item.guid))
    this.schedulePush()
  }

  /** À appeler avec l'adresse : après une suppression, la source n'existe plus. */
  touchSource(url: string): void {
    this.store.cloudTouch('source', url)
    this.schedulePush()
  }

  touchHighlight(id: string, itemId: string): void {
    this.store.cloudTouch('highlight', id)
    this.touchItem(itemId)
  }

  touchBoard(id: string): void {
    this.store.cloudTouch('board', id)
    this.schedulePush()
  }

  /** Premier envoi : abonnements, articles annotés ou marqués (et lus ces 30 derniers jours), surlignages, boards. */
  private markEverything(): void {
    const at = Date.now()
    for (const s of this.store.listSources()) if (s.kind !== 'book') this.store.cloudTouch('source', s.url, at)
    const since = at - 30 * 24 * 3600_000
    for (const it of this.store.cloudCandidates(since)) this.store.cloudTouch('item', itemKey(it.sourceUrl, it.guid), at)
    for (const h of this.store.listHighlights()) this.store.cloudTouch('highlight', h.id, at)
    for (const b of this.store.listBoards()) this.store.cloudTouch('board', b.id, at)
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────

  private itemPayload(item: Item, source: Source): ItemPayload {
    return {
      sourceUrl: source.url,
      guid: item.guid,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      imageUrl: item.imageUrl?.startsWith('data:') ? undefined : item.imageUrl,
      read: item.read,
      later: item.later,
      bookmarked: item.bookmarked,
      favorite: item.favorite,
      tags: item.tags,
      position: item.position,
      progress: item.progress
    }
  }

  /** L'état local d'un élément, tel qu'il part vers le serveur (null : supprimé). */
  private payload(kind: CloudKind, key: string): Record<string, unknown> | null {
    if (kind === 'source') {
      const s = this.store.findSourceByUrl(key)
      return s ? { url: s.url, kind: s.kind, title: s.title, siteUrl: s.siteUrl, category: s.category, lang: s.lang, leaning: s.leaning, owner: s.owner, filter: s.filter } : null
    }
    if (kind === 'item') {
      const [url, guid] = splitItemKey(key)
      const source = this.store.findSourceByUrl(url)
      const item = source && this.store.findItemByGuid(source.id, guid)
      return source && item ? { ...this.itemPayload(item, source) } : null
    }
    if (kind === 'highlight') {
      const h = this.store.getHighlight(key)
      const item = h && this.store.getItem(h.itemId)
      const source = item && this.store.getSource(item.sourceId)
      if (!h || !item || !source) return null
      return { itemKey: itemKey(source.url, item.guid), itemTitle: item.title, itemUrl: item.url, color: h.color, quote: h.quote, prefix: h.prefix, suffix: h.suffix, start: h.start, end: h.end, note: h.note, layer: h.layer, createdAt: h.createdAt }
    }
    const b = this.store.getBoard(key)
    return b ? { title: b.title, mode: b.mode, data: b.data, createdAt: b.createdAt } : null
  }

  private async push(): Promise<number> {
    const device = this.store.getSettings().cloudDevice
    let sent = 0
    for (;;) {
      const dirty = this.store.cloudDirty(200)
      if (!dirty.length) return sent
      const records = dirty.map((d) => {
        const data = this.payload(d.kind, d.key)
        return { kind: d.kind, key: d.key, data: data ?? {}, deleted: !data, updated_at: d.updatedAt, device }
      })
      await this.rest('rpc/learn_push', { method: 'POST', body: JSON.stringify({ records }) })
      for (const d of dirty) this.store.cloudMarkSynced(d.kind, d.key, d.updatedAt)
      sent += dirty.length
    }
  }

  // ── Relève ────────────────────────────────────────────────────────────────

  private async pull(): Promise<number> {
    let applied = 0
    for (;;) {
      const since = this.store.getSettings().cloudLastPull
      // Petit recouvrement : deux écritures dans la même milliseconde ne se perdent pas (les doublons sont ignorés).
      const after = since ? new Date(Date.parse(since) - 2000).toISOString() : '1970-01-01T00:00:00Z'
      const res = await this.rest(`learn_records?select=kind,key,data,deleted,updated_at,device,server_at&server_at=gt.${encodeURIComponent(after)}&order=server_at.asc&limit=${PAGE}`)
      const rows = (await res.json()) as RemoteRecord[]
      const fresh = rows.filter((r) => r.updated_at > (this.store.cloudUpdatedAt(r.kind, r.key) ?? -1))
      fresh.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.updated_at - b.updated_at)
      for (const r of fresh) {
        try {
          if (this.apply(r)) applied++
          this.store.cloudSetRemote(r.kind, r.key, r.updated_at)
        } catch {
          /* enregistrement illisible : ignoré, le reste passe */
        }
      }
      const last = rows.at(-1)?.server_at
      if (last && last !== since) this.store.updateSettings({ cloudLastPull: last })
      if (rows.length < PAGE || !last || last === since) return applied
    }
  }

  /** Applique ici une version venue d'un autre appareil. */
  private apply(r: RemoteRecord): boolean {
    const store = this.store
    if (r.kind === 'source') {
      const local = store.findSourceByUrl(r.key)
      if (r.deleted) {
        if (local) this.core.removeSource(local.id)
        return !!local
      }
      const d = r.data as Partial<Source> & { url: string; filter?: SourceFilter }
      if (!local) {
        store.insertSource({ id: uid('s_'), kind: d.kind ?? 'rss', title: d.title ?? d.url, url: d.url, siteUrl: d.siteUrl, category: d.category, lang: d.lang, leaning: d.leaning, owner: d.owner, createdAt: Date.now() })
      } else store.updateSource(local.id, { title: d.title ?? local.title, category: d.category, leaning: d.leaning, owner: d.owner })
      const source = store.findSourceByUrl(r.key)!
      if (JSON.stringify(source.filter ?? null) !== JSON.stringify(d.filter ?? null)) this.core.setSourceFilter(source.id, d.filter ?? null)
      return true
    }
    if (r.kind === 'item') {
      if (r.deleted) return false
      const d = r.data as unknown as ItemPayload
      const item = this.ensureItem(d.sourceUrl, d.guid, d.title, d.url, d.publishedAt, d.imageUrl)
      if (!item) return false
      store.updateItem(item.id, { read: d.read, later: d.later, bookmarked: d.bookmarked, favorite: d.favorite, tags: d.tags ?? [] })
      if (d.position) store.savePosition(item.id, d.position, d.progress ?? 0)
      return true
    }
    if (r.kind === 'highlight') {
      const local = store.getHighlight(r.key)
      if (r.deleted) {
        if (local) store.removeHighlight(r.key)
        return !!local
      }
      const d = r.data as { itemKey: string; itemTitle?: string; itemUrl?: string } & Record<string, unknown>
      if (local) {
        store.updateHighlight(r.key, { color: d.color as never, note: String(d.note ?? '') })
        return true
      }
      const [url, guid] = splitItemKey(d.itemKey)
      const item = this.ensureItem(url, guid, d.itemTitle ?? '', d.itemUrl, Date.now())
      if (!item) return false
      const now = Date.now()
      store.insertHighlight({
        id: r.key,
        itemId: item.id,
        color: (d.color as never) ?? 'yellow',
        quote: String(d.quote ?? ''),
        prefix: String(d.prefix ?? ''),
        suffix: String(d.suffix ?? ''),
        start: Number(d.start ?? 0),
        end: Number(d.end ?? 0),
        note: String(d.note ?? ''),
        layer: String(d.layer ?? 'feed'),
        createdAt: Number(d.createdAt ?? now),
        updatedAt: now
      })
      return true
    }
    // Boards
    const local = store.getBoard(r.key)
    if (r.deleted) {
      if (local) store.deleteBoard(r.key)
      return !!local
    }
    const d = r.data as Pick<Board, 'title' | 'mode' | 'data'> & { createdAt?: number }
    if (local) store.updateBoard(r.key, { title: d.title, mode: d.mode, data: d.data })
    else store.insertBoard({ id: r.key, title: d.title, mode: d.mode, data: d.data, createdAt: d.createdAt ?? Date.now(), updatedAt: Date.now() })
    return true
  }

  /** L'article d'un autre appareil : retrouvé ici, ou recréé (titre, adresse) si le flux ne le propose plus. */
  private ensureItem(sourceUrl: string, guid: string, title: string, url: string | undefined, publishedAt: number, imageUrl?: string): Item | null {
    const store = this.store
    // Lien enregistré sur un autre appareil : la section « Liens » est créée ici au besoin.
    const source = store.findSourceByUrl(sourceUrl) ?? (sourceUrl === LINKS_SOURCE_URL ? this.core.linksSourcePublic() : undefined)
    if (!source) return null
    const found = store.findItemByGuid(source.id, guid)
    if (found) return found
    // Livre absent de cet appareil : pas d'entrée sans fichier.
    if (source.kind === 'book') return null
    const now = Date.now()
    store.insertItems([{ id: uid('i_'), sourceId: source.id, guid, url, title: title || url || 'Sans titre', imageUrl, publishedAt: Math.min(publishedAt || now, now), fetchedAt: now }])
    return store.findItemByGuid(source.id, guid)
  }

  // ── Cycle ─────────────────────────────────────────────────────────────────

  /** Envoie puis relève ; un seul passage à la fois. */
  sync(): Promise<CloudStatus> {
    if (this.running) return this.running
    this.running = (async () => {
      try {
        if (!this.status().connected) return this.status()
        await this.push()
        const applied = await this.pull()
        this.lastError = undefined
        this.store.updateSettings({ cloudLastSync: Date.now() })
        if (applied) {
          this.emit({ type: 'items-changed' })
          this.emit({ type: 'boards-changed' })
        }
      } catch (e) {
        this.lastError = (e as Error).message
      }
      const status = this.status()
      this.emit({ type: 'cloud-status', status })
      return status
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  restart(): void {
    this.stop()
    if (!this.status().connected) return
    this.timer = setInterval(() => void this.sync(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
  }
}
