import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import { NotionSync } from '../src/main/notion/notionSync'
import { blocksToNote, mdToRichText, noteToBlocks, notionId, richTextToMd } from '../src/main/notion/convert'
import { FakeNotion } from './fixtures/fakeNotion'

const box = { encrypt: (s: string) => `x:${[...s].reverse().join('')}`, decrypt: (s: string) => [...s.slice(2)].reverse().join('') }

describe('conversion Markdown ↔ Notion', () => {
  it('garde gras, italique, code et liens', () => {
    const md = 'Lien avec le **modèle OSI**, voir *Tanenbaum*, `tcpdump` et [RFC 791](https://www.rfc-editor.org/rfc/rfc791).'
    const rt = mdToRichText(md)
    expect(rt.find((r) => r.annotations?.bold)?.text.content).toBe('modèle OSI')
    expect(rt.find((r) => r.text.link)?.text.link?.url).toBe('https://www.rfc-editor.org/rfc/rfc791')
    expect(richTextToMd(rt)).toBe(md)
  })

  it('découpe une note en paragraphes et la reconstitue', () => {
    const note = 'Premier paragraphe.\n\nSecond, avec _italique_.'
    expect(blocksToNote(noteToBlocks(note))).toBe('Premier paragraphe.\n\nSecond, avec *italique*.')
    expect(noteToBlocks('   ')).toEqual([])
  })

  it('coupe les textes de plus de 2 000 caractères', () => {
    const rt = mdToRichText('a'.repeat(4500))
    expect(rt.map((r) => r.text.content.length)).toEqual([2000, 2000, 500])
  })

  it('extrait un identifiant de page d’une URL Notion', () => {
    expect(notionId('https://www.notion.so/moi/Lectures-0123456789abcdef0123456789abcdef?pvs=4')).toBe('01234567-89ab-cdef-0123-456789abcdef')
    expect(notionId('01234567-89ab-cdef-0123-456789abcdef')).toBe('01234567-89ab-cdef-0123-456789abcdef')
    expect(notionId('https://example.com')).toBeNull()
  })
})

describe('synchronisation Notion', async () => {
  const fake = new FakeNotion()
  beforeAll(() => fake.start())
  afterAll(() => fake.stop())

  const store = await openDatabase(null)
  const core = new LearnCore(store, async () => {
    throw new Error('hors ligne')
  })
  const now = Date.now()
  store.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://r.example/feed', createdAt: now })
  store.insertItems([{ id: 'i1', sourceId: 's', guid: 'g', url: 'https://r.example/chappe', title: 'Le télégraphe Chappe', author: 'Hugo', publishedAt: now, fetchedAt: now }])
  store.updateItem('i1', { tags: ['Histoire', 'réseau informatique'] })
  const base = { itemId: 'i1', prefix: '', suffix: '', layer: 'feed' }
  const h1 = core.addHighlight({ ...base, color: 'yellow', quote: 'Premier passage', start: 0, end: 15, note: 'Note **importante**' })
  const h2 = core.addHighlight({ ...base, color: 'green', quote: 'Troisième passage', start: 50, end: 67, note: '' })
  let notion: NotionSync
  let pageId = ''

  it('refuse un jeton invalide et garde le bon jeton chiffré, hors des réglages', async () => {
    notion = new NotionSync(core, (u, i) => fetch(u, i), box, () => {}, fake.url)
    await expect(notion.connect('mauvais')).rejects.toThrow('API token is invalid.')
    expect(await notion.connect(fake.token)).toBe('Espace de test')
    expect(store.getSecret('notion')).toBe(box.encrypt(fake.token))
    expect(JSON.stringify(store.getSettings())).not.toContain(fake.token)
    expect(notion.status()).toMatchObject({ connected: true, workspace: 'Espace de test' })
  })

  it('crée la base Learn dans la page indiquée', async () => {
    await notion.createDatabase('https://www.notion.so/Lectures-0123456789abcdef0123456789abcdef')
    const [db] = [...fake.databases.values()]
    expect(db.parent).toEqual({ type: 'page_id', page_id: '01234567-89ab-cdef-0123-456789abcdef' })
    expect(Object.keys(db.properties)).toEqual(['Name', 'Auteur', 'Type', 'Source', 'URL', 'Tags', 'Learn ID'])
    expect(store.getSettings().notionDatabaseId).toBe(db.id)
  })

  it('crée une page par document, une citation par surlignage, la note en dessous', async () => {
    const r = await notion.pushItem('i1')
    expect(r.created).toBe(true)
    pageId = r.pageId
    const page = fake.pages.get(pageId)!
    expect(page.properties.Name.title[0].plain_text).toBe('Le télégraphe Chappe')
    expect(page.properties.Tags.multi_select.map((t: { name: string }) => t.name)).toEqual(['Histoire', 'réseau informatique'])
    expect(page.properties['Learn ID'].rich_text[0].plain_text).toBe('i1')
    expect(page.properties.URL.url).toBe('https://r.example/chappe')
    expect(fake.quotes(pageId)).toEqual([
      expect.objectContaining({ text: 'Premier passage', color: 'yellow_background', note: 'Note importante' }),
      expect.objectContaining({ text: 'Troisième passage', color: 'green_background', note: '' })
    ])
  })

  it('n’envoie que ce qui a changé, et insère au bon endroit', async () => {
    const h3 = core.addHighlight({ ...base, color: 'blue', quote: 'Deuxième passage', start: 30, end: 46, note: 'Au milieu' })
    store.updateHighlight(h1.id, { note: 'Note modifiée dans Learn' })
    store.updateHighlight(h2.id, { color: 'pink' })
    fake.requests.length = 0
    expect((await notion.pushItem('i1')).created).toBe(false)
    expect(fake.quotes(pageId).map((q) => [q.text, q.color, q.note])).toEqual([
      ['Premier passage', 'yellow_background', 'Note modifiée dans Learn'],
      ['Deuxième passage', 'blue_background', 'Au milieu'],
      ['Troisième passage', 'pink_background', '']
    ])
    // Aucune recréation de page, aucune réécriture des citations inchangées.
    expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/pages')).toHaveLength(0)
    store.removeHighlight(h3.id)
    await notion.pushItem('i1')
    expect(fake.quotes(pageId).map((q) => q.text)).toEqual(['Premier passage', 'Troisième passage'])
  })

  it('reprend dans Learn une note, une couleur et des tags modifiés dans Notion', async () => {
    const [q1, q2] = fake.quotes(pageId)
    fake.setNote(q1.id, [[{ text: { content: 'Réécrite dans ' } }, { text: { content: 'Notion' }, annotations: { bold: true } }], [{ text: { content: 'Second paragraphe' } }]])
    fake.blocks.get(q2.id)!.data.color = 'purple_background'
    fake.pages.get(pageId)!.properties.Tags.multi_select = [{ name: 'Histoire' }, { name: 'Télécoms' }]
    fake.touchPage(pageId)
    const reports = await notion.pull()
    expect(reports).toEqual([expect.objectContaining({ itemId: 'i1', updated: 2, tagsChanged: true })])
    const hs = Object.fromEntries(store.listHighlights('i1').map((h) => [h.id, h]))
    expect(hs[h1.id].note).toBe('Réécrite dans **Notion**\n\nSecond paragraphe')
    expect(hs[h2.id].color).toBe('purple')
    expect([...store.getItem('i1')!.tags].sort()).toEqual(['Histoire', 'Télécoms'])
    expect(await notion.pull()).toEqual([]) // stable
  })

  it('supprime dans Learn une citation supprimée dans Notion', async () => {
    const [, q2] = fake.quotes(pageId)
    fake.blocks.get(q2.id)!.archived = true
    fake.touchPage(pageId)
    expect(await notion.pull()).toEqual([expect.objectContaining({ removed: 1 })])
    expect(store.listHighlights('i1').map((h) => h.id)).toEqual([h1.id])
  })

  it('garde les deux versions en cas de conflit et les renvoie dans Notion', async () => {
    store.updateHighlight(h1.id, { note: 'Version Learn' })
    const [q1] = fake.quotes(pageId)
    fake.setNote(q1.id, [[{ text: { content: 'Version Notion' } }]])
    fake.touchPage(pageId)
    expect(await notion.pull()).toEqual([expect.objectContaining({ conflicts: 1 })])
    const note = store.listHighlights('i1')[0].note
    expect(note).toContain('Version Learn')
    expect(note).toContain('Version Notion')
    expect(fake.quotes(pageId)[0].note).toContain('Version modifiée dans Notion')
  })

  it('réessaie après une limite de débit (429)', async () => {
    fake.rateLimitNext = 2
    store.updateHighlight(h1.id, { note: 'Après limitation' })
    await notion.pushItem('i1')
    expect(fake.quotes(pageId)[0].note).toBe('Après limitation')
  })

  it('recrée la page si elle a été supprimée dans Notion', async () => {
    fake.pages.get(pageId)!.archived = true
    const r = await notion.pushItem('i1')
    expect(r.created).toBe(true)
    expect(r.pageId).not.toBe(pageId)
    expect(fake.quotes(r.pageId).map((q) => q.text)).toEqual(['Premier passage'])
  })

  it('indique le chapitre ou la page pour les livres', async () => {
    store.insertSource({ id: 'lib', kind: 'book', title: 'Bibliothèque', url: 'learn:library', createdAt: now })
    store.insertItems([{ id: 'pdf1', sourceId: 'lib', guid: 'p', title: 'Cours réseau', publishedAt: now, fetchedAt: now, format: 'pdf' }])
    core.addHighlight({ itemId: 'pdf1', color: 'yellow', quote: 'Le modèle OSI', prefix: '', suffix: '', start: 0, end: 13, note: '', layer: 'p:4' })
    const r = await notion.pushItem('pdf1')
    expect(fake.quotes(r.pageId)[0].text).toBe('Page 5 · Le modèle OSI')
    expect(fake.pages.get(r.pageId)!.properties.Type.select.name).toBe('pdf')
  })

  it('se déconnecte en oubliant le jeton', () => {
    notion.disconnect()
    expect(store.getSecret('notion')).toBeUndefined()
    expect(notion.status().connected).toBe(false)
  })
})
