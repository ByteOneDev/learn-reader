import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { buildMarkdown } from '../src/main/export/markdown'
import { highlightAtLine, parseLearnDoc } from '../obsidian-plugin/src/parse'
import { learnLink, parseLearnLink } from '../src/shared/links'
import type { Highlight, Item } from '../src/shared/types'

const item: Item = {
  id: 'i_42',
  sourceId: 'lib',
  guid: 'g',
  title: 'Une brève histoire des réseaux',
  author: 'Inès Moreau',
  publishedAt: Date.parse('2026-10-01'),
  fetchedAt: 0,
  read: true,
  later: false,
  bookmarked: false,
  favorite: false,
  tags: ['Histoire'],
  format: 'epub'
}
const hl = (id: string, layer: string, start: number, quote: string, note = '', color: Highlight['color'] = 'yellow'): Highlight => ({ id, itemId: 'i_42', color, quote, prefix: '', suffix: '', start, end: start + quote.length, note, layer, createdAt: 0, updatedAt: 0 })
const labels: Record<string, string> = { 'ch:0': 'Le temps des relais', 'ch:2': 'Naissance des protocoles', 't:65': '[1:05](https://youtu.be/abcdefghijk?t=65)' }
const md =
  buildMarkdown(
    item,
    undefined,
    [hl('h_b', 'ch:2', 10, 'TCP garantit la livraison', 'Note sur **TCP**\n\nDeux paragraphes', 'blue'), hl('h_a', 'ch:0', 5, 'Les tours Chappe\nrelayaient des signaux'), hl('h_c', 't:65', 65, 'Câbles sous-marins')],
    0,
    (l) => labels[l]
  ) + '\n## Mes notes\n\n> Une citation à moi\n'

describe('extension Obsidian : lecture des fichiers Learn', () => {
  const doc = parseLearnDoc(md)!

  it('lit les métadonnées', () => {
    expect(doc).toMatchObject({ learnId: 'i_42', title: 'Une brève histoire des réseaux', type: 'book', author: 'Inès Moreau' })
  })

  it('retrouve chaque surlignage, avec sa citation, sa note, sa couleur, son chapitre et sa ligne', () => {
    expect(doc.highlights.map((h) => [h.id, h.label, h.quote, h.note, h.color])).toEqual([
      ['h_a', 'Le temps des relais', 'Les tours Chappe\nrelayaient des signaux', '', 'yellow'],
      ['h_b', 'Naissance des protocoles', 'TCP garantit la livraison', 'Note sur **TCP**\n\nDeux paragraphes', 'blue'],
      ['h_c', '1:05', 'Câbles sous-marins', '', 'yellow']
    ])
    const lines = md.split('\n')
    for (const h of doc.highlights) expect(lines[h.line]).toBe(`^${h.blockId}`)
  })

  it('ignore ce que l’utilisateur a écrit après le marqueur de fin', () => {
    expect(doc.highlights).toHaveLength(3)
  })

  it('trouve le surlignage sous le curseur', () => {
    const b = doc.highlights[1]
    expect(highlightAtLine(doc, b.line + 2)?.id).toBe('h_b')
    expect(highlightAtLine(doc, 0)).toBeUndefined()
  })

  it('refuse un fichier qui n’est pas un export Learn', () => {
    expect(parseLearnDoc('# Note\n')).toBeNull()
    expect(parseLearnDoc('---\ntitle: x\n---\n')).toBeNull()
  })

  it('contient un lien « Ouvrir dans Learn »', () => {
    expect(md).toContain('[Ouvrir dans Learn](learn://open?item=i_42)')
  })
})

describe('liens learn://', () => {
  it('aller-retour', () => {
    expect(parseLearnLink(learnLink('i_42', 'h_b'))).toEqual({ itemId: 'i_42', highlightId: 'h_b' })
    expect(parseLearnLink(learnLink('i 42'))).toEqual({ itemId: 'i 42', highlightId: undefined })
    expect(parseLearnLink('learn://autre?item=x')).toBeNull()
    expect(parseLearnLink('https://open?item=x')).toBeNull()
    expect(parseLearnLink('pas une adresse')).toBeNull()
  })
})

describe('extension Obsidian : main.js compilé dans un faux Obsidian', () => {
  execFileSync('node', ['obsidian-plugin/build.mjs'], { stdio: 'pipe' })
  const { document, HTMLElement } = parseHTML('<!doctype html><html><body></body></html>')
  // Extensions DOM d'Obsidian utilisées par le plugin.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.empty = function (this: HTMLElement) {
    this.innerHTML = ''
  }
  proto.addClass = function (this: HTMLElement, c: string) {
    this.classList.add(c)
  }
  proto.createEl = function (this: HTMLElement, tag: string, o: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
    const el = document.createElement(tag)
    if (o.cls) el.className = o.cls
    if (o.text) el.textContent = o.text
    for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v)
    this.appendChild(el)
    return el
  }
  proto.createDiv = function (this: HTMLElement, o: object) {
    return (this as unknown as { createEl(t: string, o: object): HTMLElement }).createEl('div', o)
  }

  const opened: string[] = []
  const commands: Record<string, { checkCallback?(c: boolean): boolean; editorCheckCallback?(c: boolean, ed: unknown, ctx: unknown): boolean; callback?(): void }> = {}
  const file = { path: 'Learn/Une brève histoire des réseaux.md', basename: 'Une brève histoire des réseaux', extension: 'md', stat: { mtime: 1 } }
  const app = {
    workspace: {
      getActiveFile: () => file,
      on: () => ({}),
      getLeaf: () => ({ openFile: async (_f: unknown, st: { eState?: { line?: number } }) => opened.push(`open:${st?.eState?.line}`) }),
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: async () => {}
    },
    vault: { on: () => ({}), cachedRead: async () => md, getMarkdownFiles: () => [file] },
    metadataCache: { on: () => ({}), getFileCache: () => ({ frontmatter: { learn_id: 'i_42', title: 'Une brève histoire des réseaux', type: 'book' }, blocks: { 'h-1': {}, 'h-2': {} } }) }
  }
  class Base {
    app = app
    contentEl = document.createElement('div')
    registerEvent(): void {}
    constructor(public leaf?: unknown) {}
  }
  class MarkdownView {}
  const fakeObsidian = {
    Plugin: class extends Base {
      async loadData() {
        return null
      }
      async saveData() {}
      registerView() {}
      addRibbonIcon() {}
      addCommand(c: { id: string }) {
        commands[c.id] = c as never
      }
      addSettingTab() {}
    },
    ItemView: Base,
    PluginSettingTab: Base,
    Setting: class {},
    Notice: class {
      constructor(m: string) {
        opened.push(`notice:${m}`)
      }
    },
    TFile: Object,
    MarkdownView,
    setIcon: () => {}
  }
  const load = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load
  ;(Module as unknown as { _load: unknown })._load = (r: string, ...a: unknown[]) => (r === 'obsidian' ? fakeObsidian : load(r, ...a))
  ;(globalThis as Record<string, unknown>).window = { open: (u: string) => opened.push(u) }
  const req = createRequire(import.meta.url)
  const Plugin = (req('../obsidian-plugin/dist/learn-reader/main.js') as { default: new (...a: unknown[]) => { onload(): Promise<void> } }).default

  it('se charge et enregistre ses commandes', async () => {
    await new Plugin(app, {}).onload()
    expect(Object.keys(commands).sort()).toEqual(['open-in-learn', 'open-passage-in-learn', 'show-panel'])
    expect(commands['open-in-learn'].checkCallback!(false)).toBe(true)
    expect(opened.at(-1)).toBe('learn://open?item=i_42')
  })

  it('ouvre dans Learn le passage sous le curseur', () => {
    const line = parseLearnDoc(md)!.highlights[1].line
    const editor = { getValue: () => md, getCursor: () => ({ line }) }
    const ctx = Object.assign(new MarkdownView(), { file })
    expect(commands['open-passage-in-learn'].editorCheckCallback!(false, editor, ctx)).toBe(true)
    expect(opened.at(-1)).toBe('learn://open?item=i_42&highlight=h_b')
  })

  it('affiche le panneau des surlignages et va au passage', async () => {
    // La vue n'est pas exportée : on la récupère via registerView.
    let factory: ((leaf: unknown) => { onOpen(): Promise<void>; contentEl: HTMLElement }) | undefined
    const p = new Plugin(app, {}) as unknown as { registerView(t: string, f: typeof factory): void; onload(): Promise<void> }
    p.registerView = (_t, f) => (factory = f)
    await p.onload()
    const view = factory!({})
    await view.onOpen()
    const el = view.contentEl
    expect(el.querySelector('.learn-title')?.textContent).toBe('Une brève histoire des réseaux')
    expect(Array.from(el.querySelectorAll('.learn-label')).map((l) => l.textContent)).toEqual(['Le temps des relais', 'Naissance des protocoles', '1:05'])
    expect(el.querySelectorAll('.learn-hl')).toHaveLength(3)
    expect(el.querySelector('.learn-hl.learn-blue .learn-note')?.textContent).toBe('Note sur **TCP**\n\nDeux paragraphes')
    ;(el.querySelectorAll('.learn-hl')[1] as unknown as { onclick(): void }).onclick()
    await new Promise((r) => setTimeout(r, 0))
    expect(opened.at(-1)).toBe(`open:${parseLearnDoc(md)!.highlights[1].line}`)
  })
})
