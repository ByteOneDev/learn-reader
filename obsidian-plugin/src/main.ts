import { ItemView, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, setIcon, type App, type WorkspaceLeaf } from 'obsidian'
import { highlightAtLine, learnLink, parseLearnDoc, type LearnDoc, type LearnHighlight } from './parse'

// Extension Obsidian de Learn : un panneau qui montre les surlignages et notes du document ouvert
// (exporté ou synchronisé par Learn), permet d'aller au passage ou de l'ouvrir dans Learn, et liste
// la bibliothèque Learn quand aucun document Learn n'est ouvert.

const VIEW = 'learn-highlights'

interface Settings {
  folder: string
}

const DEFAULTS: Settings = { folder: 'Learn' }

const TYPE_LABEL: Record<string, string> = {
  article: 'Article',
  book: 'Livre',
  pdf: 'PDF',
  post: 'Publication',
  discussion: 'Discussion',
  video: 'Vidéo',
  podcast: 'Podcast'
}

function openInLearn(itemId: string, highlightId?: string): void {
  window.open(learnLink(itemId, highlightId))
}

class LearnView extends ItemView {
  private file: TFile | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: LearnPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW
  }

  getDisplayText(): string {
    return 'Learn'
  }

  getIcon(): string {
    return 'highlighter'
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => void this.refresh()))
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f instanceof TFile && (f === this.file || f.path.startsWith(this.plugin.settings.folder + '/'))) void this.refresh()
      })
    )
    this.registerEvent(this.app.metadataCache.on('resolved', () => !this.file && void this.refresh()))
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const active = this.app.workspace.getActiveFile()
    // Quand on clique dans le panneau, le fichier actif ne change pas : on garde le dernier document Learn.
    if (active && active.extension === 'md') this.file = active
    const root = this.contentEl
    root.empty()
    root.addClass('learn-view')
    const doc = this.file ? parseLearnDoc(await this.app.vault.cachedRead(this.file)) : null
    if (doc && this.file) this.renderDoc(root, doc, this.file)
    else this.renderLibrary(root)
  }

  private renderDoc(root: HTMLElement, doc: LearnDoc, file: TFile): void {
    const head = root.createDiv({ cls: 'learn-head' })
    head.createDiv({ cls: 'learn-type', text: [TYPE_LABEL[doc.type ?? ''] ?? doc.type, doc.author].filter(Boolean).join(' · ') })
    head.createDiv({ cls: 'learn-title', text: doc.title ?? file.basename })
    const actions = head.createDiv({ cls: 'learn-actions' })
    const open = actions.createEl('button', { cls: 'mod-cta', text: 'Ouvrir dans Learn' })
    open.onclick = () => openInLearn(doc.learnId)
    if (doc.url) {
      const web = actions.createEl('button', { text: 'Source' })
      web.onclick = () => window.open(doc.url)
    }

    root.createDiv({ cls: 'learn-count', text: `${doc.highlights.length} surlignage${doc.highlights.length > 1 ? 's' : ''}` })
    if (!doc.highlights.length) root.createDiv({ cls: 'learn-empty', text: 'Aucun surlignage pour l’instant.' })

    let lastLabel: string | undefined
    for (const h of doc.highlights) {
      if (h.label && h.label !== lastLabel) root.createDiv({ cls: 'learn-label', text: h.label })
      lastLabel = h.label
      this.renderHighlight(root, doc, file, h)
    }
  }

  private renderHighlight(root: HTMLElement, doc: LearnDoc, file: TFile, h: LearnHighlight): void {
    const card = root.createDiv({ cls: `learn-hl learn-${h.color}` })
    card.createDiv({ cls: 'learn-quote', text: h.quote })
    if (h.note) card.createDiv({ cls: 'learn-note', text: h.note })
    const bar = card.createDiv({ cls: 'learn-hl-actions' })
    const go = bar.createEl('button', { attr: { 'aria-label': 'Aller au passage dans la note' } })
    setIcon(go, 'arrow-down-to-line')
    go.onclick = (e) => {
      e.stopPropagation()
      void this.app.workspace.getLeaf(false).openFile(file, { eState: { line: h.line } })
    }
    const learn = bar.createEl('button', { attr: { 'aria-label': 'Ouvrir ce passage dans Learn' } })
    setIcon(learn, 'external-link')
    learn.onclick = (e) => {
      e.stopPropagation()
      openInLearn(doc.learnId, h.id)
    }
    card.onclick = () => void this.app.workspace.getLeaf(false).openFile(file, { eState: { line: h.line } })
  }

  /** Aucun document Learn ouvert : la bibliothèque, du plus récent au plus ancien. */
  private renderLibrary(root: HTMLElement): void {
    const folder = this.plugin.settings.folder
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + '/') && this.app.metadataCache.getFileCache(f)?.frontmatter?.learn_id)
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
    const head = root.createDiv({ cls: 'learn-head' })
    head.createDiv({ cls: 'learn-type', text: `Dossier « ${folder} »` })
    head.createDiv({ cls: 'learn-title', text: 'Bibliothèque Learn' })
    if (!files.length) {
      root.createDiv({ cls: 'learn-empty', text: 'Aucun document exporté par Learn pour l’instant. Dans Learn : Réglages → Obsidian.' })
      return
    }
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f)
      const count = Object.keys(cache?.blocks ?? {}).filter((k) => k.startsWith('h-')).length
      const row = root.createDiv({ cls: 'learn-doc' })
      row.createDiv({ cls: 'learn-doc-title', text: String(cache?.frontmatter?.title ?? f.basename) })
      row.createDiv({ cls: 'learn-doc-meta', text: [TYPE_LABEL[cache?.frontmatter?.type] ?? cache?.frontmatter?.type, `${count} surlignage${count > 1 ? 's' : ''}`].filter(Boolean).join(' · ') })
      row.onclick = () => void this.app.workspace.getLeaf(false).openFile(f)
    }
  }
}

export default class LearnPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS }

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) }
    this.registerView(VIEW, (leaf) => new LearnView(leaf, this))
    this.addRibbonIcon('highlighter', 'Learn : surlignages', () => void this.showView())

    this.addCommand({ id: 'show-panel', name: 'Afficher le panneau des surlignages', callback: () => void this.showView() })
    this.addCommand({
      id: 'open-in-learn',
      name: 'Ouvrir ce document dans Learn',
      checkCallback: (checking) => {
        const id = this.activeLearnId()
        if (!id) return false
        if (!checking) openInLearn(id)
        return true
      }
    })
    this.addCommand({
      id: 'open-passage-in-learn',
      name: 'Ouvrir le passage sous le curseur dans Learn',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!(ctx instanceof MarkdownView) || !ctx.file) return false
        const doc = parseLearnDoc(editor.getValue())
        if (!doc) return false
        if (!checking) {
          const h = highlightAtLine(doc, editor.getCursor().line)
          if (h) openInLearn(doc.learnId, h.id)
          else new Notice('Aucun surlignage Learn à cet endroit.')
        }
        return true
      }
    })
    this.addSettingTab(new LearnSettingTab(this.app, this))
  }

  private activeLearnId(): string | undefined {
    const f = this.app.workspace.getActiveFile()
    const id = f ? this.app.metadataCache.getFileCache(f)?.frontmatter?.learn_id : undefined
    return id ? String(id) : undefined
  }

  async showView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW)[0]
    const leaf = existing ?? this.app.workspace.getRightLeaf(false)
    if (!leaf) return
    if (!existing) await leaf.setViewState({ type: VIEW, active: true })
    await this.app.workspace.revealLeaf(leaf)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) void (leaf.view as LearnView).refresh()
  }
}

class LearnSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: LearnPlugin
  ) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    new Setting(containerEl)
      .setName('Dossier Learn')
      .setDesc('Le dossier du coffre où Learn exporte tes documents (Réglages de Learn → Obsidian).')
      .addText((t) =>
        t
          .setPlaceholder('Learn')
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v.trim().replace(/\/+$/, '') || 'Learn'
            await this.plugin.saveSettings()
          })
      )
  }
}
