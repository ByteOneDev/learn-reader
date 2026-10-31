import { mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LearnCore } from '../src/main/core'
import { openDatabase } from '../src/main/db'
import { ObsidianSync } from '../src/main/sync/obsidianSync'
import { parseLearnFile } from '../src/main/sync/obsidianParse'
import type { LearnEvent } from '../src/shared/types'

const noFetch = async (): Promise<Response> => {
  throw new Error('réseau désactivé')
}

async function setup() {
  const vault = mkdtempSync(join(tmpdir(), 'learn-vault-'))
  const store = await openDatabase(null)
  const events: LearnEvent[] = []
  const core = new LearnCore(store, noFetch, (e) => events.push(e))
  store.updateSettings({ obsidianVault: vault, obsidianFolder: 'Learn', obsidianSync: true })
  const now = Date.now()
  store.insertSource({ id: 's', kind: 'rss', title: 'Revue', url: 'https://r.example/feed', createdAt: now })
  store.insertItems([{ id: 'i1', sourceId: 's', guid: 'g1', title: 'Le télégraphe Chappe', publishedAt: now, fetchedAt: now }])
  store.updateItem('i1', { tags: ['Histoire', 'réseau informatique'] })
  const base = { itemId: 'i1', prefix: '', suffix: '', layer: 'feed' }
  const a = core.addHighlight({ ...base, color: 'yellow', quote: 'Premier passage', start: 0, end: 15, note: 'Note A' })
  const b = core.addHighlight({ ...base, color: 'green', quote: 'Second passage', start: 20, end: 34, note: '' })
  const sync = new ObsidianSync(core, (e) => events.push(e))
  const { path } = core.exportToObsidian('i1')
  return { vault, store, core, sync, path, a, b, events }
}

const edit = (path: string, fn: (s: string) => string): void => writeFileSync(path, fn(readFileSync(path, 'utf8')))

describe('lecture d’un fichier Learn', () => {
  it('extrait notes, couleurs et tags', async () => {
    const { path, a, b } = await setup()
    const parsed = parseLearnFile(readFileSync(path, 'utf8'))!
    expect(parsed.learnId).toBe('i1')
    expect(parsed.tags).toEqual(['Histoire', 'réseau-informatique'])
    expect(parsed.highlights.get(a.id)).toEqual({ note: 'Note A', color: 'yellow' })
    expect(parsed.highlights.get(b.id)).toEqual({ note: '', color: 'green' })
  })

  it('ignore un fichier qui n’a pas la structure Learn', () => {
    expect(parseLearnFile('# Une note à moi\n')).toBeNull()
    expect(parseLearnFile('---\nlearn_id: x\n---\n# Sans marqueur de fin\n')).toBeNull()
  })
})

describe('Obsidian → Learn', () => {
  it('ne réagit pas à ses propres écritures', async () => {
    const { sync, path } = await setup()
    expect(sync.handleFile(path)).toBeNull()
  })

  it('reprend une note modifiée et une note ajoutée dans Obsidian', async () => {
    const { sync, path, store, a, b } = await setup()
    edit(path, (s) =>
      s
        .replace('Note A', 'Note A, complétée dans **Obsidian**\n\nAvec un second paragraphe.')
        .replace(`%%learn:highlight id=${b.id}`, `Nouvelle note écrite dans Obsidian\n\n%%learn:highlight id=${b.id}`)
    )
    expect(sync.handleFile(path)).toMatchObject({ updated: 2, removed: 0, conflicts: 0 })
    const notes = Object.fromEntries(store.listHighlights('i1').map((h) => [h.id, h.note]))
    expect(notes[a.id]).toBe('Note A, complétée dans **Obsidian**\n\nAvec un second paragraphe.')
    expect(notes[b.id]).toBe('Nouvelle note écrite dans Obsidian')
    expect(sync.handleFile(path)).toBeNull() // l'état est stable
  })

  it('change la couleur et supprime un surlignage retiré du fichier', async () => {
    const { sync, path, store, a, b } = await setup()
    edit(path, (s) => {
      s = s.replace(`id=${a.id} color=yellow`, `id=${a.id} color=pink`)
      const start = s.indexOf('> Second passage')
      const end = s.indexOf('%%', s.indexOf(`id=${b.id}`)) + 2
      return s.slice(0, start) + s.slice(end + 1)
    })
    expect(sync.handleFile(path)).toMatchObject({ updated: 1, removed: 1 })
    expect(store.listHighlights('i1').map((h) => [h.id, h.color])).toEqual([[a.id, 'pink']])
  })

  it('reprend les tags en gardant l’orthographe de Learn', async () => {
    const { sync, path, store } = await setup()
    edit(path, (s) => s.replace('tags: ["learn", "Histoire", "réseau-informatique"]', 'tags: ["learn", "réseau-informatique", "Télécoms"]'))
    expect(sync.handleFile(path)).toMatchObject({ tagsChanged: true })
    expect([...store.getItem('i1')!.tags].sort()).toEqual(['Télécoms', 'réseau informatique'].sort())
  })

  it('garde les deux versions quand une note a changé des deux côtés', async () => {
    const { sync, path, store, a } = await setup()
    store.updateHighlight(a.id, { note: 'Version Learn' })
    edit(path, (s) => s.replace('Note A', 'Version Obsidian'))
    expect(sync.handleFile(path)).toMatchObject({ conflicts: 1 })
    const note = store.listHighlights('i1').find((h) => h.id === a.id)!.note
    expect(note).toContain('Version Learn')
    expect(note).toContain('Version Obsidian')
    expect(readFileSync(path, 'utf8')).toContain('Version modifiée dans Obsidian')
  })

  it('ne supprime pas un surlignage modifié dans Learn entre-temps', async () => {
    const { sync, path, store, a } = await setup()
    store.updateHighlight(a.id, { note: 'Modifiée dans Learn' })
    edit(path, (s) => s.replace(/> Premier passage[\s\S]*?%%learn:highlight[^\n]*\n/, ''))
    expect(sync.handleFile(path)).toMatchObject({ removed: 0 })
    expect(store.listHighlights('i1').some((h) => h.id === a.id)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('Modifiée dans Learn')
  })

  it('suit un fichier renommé dans Obsidian et préserve les notes de l’utilisateur', async () => {
    const { sync, path, vault, store, core, a } = await setup()
    const renamed = join(vault, 'Learn', 'Chappe — mes notes.md')
    renameSync(path, renamed)
    edit(renamed, (s) => s + '\n## Réflexions\n\nÀ relier à ARPANET.\n')
    sync.handleFile(renamed)
    store.updateHighlight(a.id, { note: 'Encore une modification' })
    expect(core.exportToObsidian('i1').path).toBe(renamed)
    const text = readFileSync(renamed, 'utf8')
    expect(text).toContain('Encore une modification')
    expect(text.endsWith('## Réflexions\n\nÀ relier à ARPANET.\n')).toBe(true)
  })

  it('rattrape au démarrage ce qui a changé pendant que l’app était fermée', async () => {
    const { sync, path, store, a } = await setup()
    edit(path, (s) => s.replace('Note A', 'Écrit pendant que Learn était fermé'))
    const reports = sync.reconcile()
    expect(reports[0]).toMatchObject({ updated: 1 })
    expect(store.listHighlights('i1').find((h) => h.id === a.id)!.note).toBe('Écrit pendant que Learn était fermé')
  })
})

describe('surveillance du dossier', () => {
  it('rattrape une modification même sans événement du système (contrôle périodique)', async () => {
    const { sync, path, store, a } = await setup()
    sync.restart()
    try {
      // On coupe fs.watch pour ne garder que le contrôle périodique.
      ;(sync as unknown as { watcher: { close(): void } | null }).watcher?.close()
      ;(sync as unknown as { watcher: null }).watcher = null
      await new Promise((r) => setTimeout(r, 50))
      edit(path, (s) => s.replace('Note A', 'Vue par le contrôle périodique'))
      const deadline = Date.now() + 12000
      while (Date.now() < deadline && store.listHighlights('i1').find((h) => h.id === a.id)!.note !== 'Vue par le contrôle périodique') {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(store.listHighlights('i1').find((h) => h.id === a.id)!.note).toBe('Vue par le contrôle périodique')
    } finally {
      sync.stop()
    }
  }, 20_000)

  it('applique une modification faite dans Obsidian sans action de l’utilisateur', async () => {
    const { sync, path, store, a, events } = await setup()
    sync.restart()
    try {
      edit(path, (s) => s.replace('Note A', 'Tapée dans Obsidian'))
      const deadline = Date.now() + 12000
      while (Date.now() < deadline && store.listHighlights('i1').find((h) => h.id === a.id)!.note !== 'Tapée dans Obsidian') {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(store.listHighlights('i1').find((h) => h.id === a.id)!.note).toBe('Tapée dans Obsidian')
      expect(events.some((e) => e.type === 'highlights-changed' && e.message?.startsWith('Obsidian → Learn'))).toBe(true)
    } finally {
      sync.stop()
    }
  }, 20_000)

  it('réécrit le fichier peu après une modification dans Learn', async () => {
    const { sync, path, store, a } = await setup()
    sync.restart()
    try {
      store.updateHighlight(a.id, { note: 'Changée dans Learn' })
      sync.touch('i1')
      const deadline = Date.now() + 12000
      while (Date.now() < deadline && !readFileSync(path, 'utf8').includes('Changée dans Learn')) await new Promise((r) => setTimeout(r, 100))
      expect(readFileSync(path, 'utf8')).toContain('Changée dans Learn')
    } finally {
      sync.stop()
    }
  }, 20_000)
})
