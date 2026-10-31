import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { LearnEvent } from '@shared/types'
import { hashText, type LearnCore } from '../core'
import { parseLearnFile } from './obsidianParse'
import { threeWayMerge } from './merge'

const EXPORT_DELAY = 1200
const FILE_DELAY = 900

export interface SyncReport {
  itemId: string
  updated: number
  removed: number
  conflicts: number
  tagsChanged: boolean
}

/**
 * Synchronisation bidirectionnelle avec un coffre Obsidian.
 *
 * - Learn → Obsidian : chaque modification d'un document (surlignage, note, couleur, tags) réécrit son
 *   fichier peu après.
 * - Obsidian → Learn : le dossier Learn du coffre est surveillé ; une note modifiée, un surlignage supprimé,
 *   une couleur ou des tags changés dans Obsidian sont appliqués dans Learn.
 *
 * La dernière version synchronisée (sync_state) sert de base à une fusion à trois voies : on sait ainsi
 * qui a modifié quoi. Si une même note a changé des deux côtés, les deux versions sont conservées.
 */
export class ObsidianSync {
  private watcher: FSWatcher | null = null
  private dir: string | null = null
  private exportTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private fileTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private core: LearnCore,
    private emit: (e: LearnEvent) => void = () => {}
  ) {}

  get running(): boolean {
    return this.watcher !== null
  }

  /** Démarre (ou redémarre) selon les réglages ; rattrape d'abord ce qui a changé pendant que l'app était fermée. */
  restart(): void {
    this.stop()
    const s = this.core.store.getSettings()
    const dir = this.core.obsidianDir()
    if (!s.obsidianSync || !dir) return
    mkdirSync(dir, { recursive: true })
    this.dir = dir
    this.reconcile()
    try {
      this.watcher = watch(dir, (_event, name) => {
        if (name && String(name).endsWith('.md')) this.scheduleFile(join(dir, String(name)))
      })
      this.watcher.on('error', () => this.stop())
    } catch {
      this.watcher = null
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    for (const t of [...this.exportTimers.values(), ...this.fileTimers.values()]) clearTimeout(t)
    this.exportTimers.clear()
    this.fileTimers.clear()
  }

  /** Lecture des fichiers puis export de tous les documents annotés. */
  reconcile(): SyncReport[] {
    const dir = this.dir ?? this.core.obsidianDir()
    const reports: SyncReport[] = []
    if (dir && existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md')) continue
        const r = this.handleFile(join(dir, name))
        if (r) reports.push(r)
      }
    }
    const ids = new Set([...this.core.store.itemsWithHighlights(), ...this.core.store.syncedItems()])
    for (const id of ids) {
      try {
        this.core.exportToObsidian(id)
      } catch {
        /* document supprimé entre-temps */
      }
    }
    return reports
  }

  /** À appeler après toute modification d'un document dans Learn. */
  touch(itemId: string): void {
    if (!this.running) return
    clearTimeout(this.exportTimers.get(itemId))
    this.exportTimers.set(
      itemId,
      setTimeout(() => {
        this.exportTimers.delete(itemId)
        try {
          this.core.exportToObsidian(itemId)
        } catch {
          /* coffre indisponible : on réessaiera à la prochaine modification */
        }
      }, EXPORT_DELAY)
    )
  }

  private scheduleFile(path: string): void {
    clearTimeout(this.fileTimers.get(path))
    this.fileTimers.set(
      path,
      setTimeout(() => {
        this.fileTimers.delete(path)
        const r = this.handleFile(path)
        if (r && (r.updated || r.removed || r.tagsChanged)) {
          const parts = [r.updated && `${r.updated} modifié${r.updated > 1 ? 's' : ''}`, r.removed && `${r.removed} supprimé${r.removed > 1 ? 's' : ''}`, r.tagsChanged && 'tags']
          const message = `Obsidian → Learn : ${parts.filter(Boolean).join(', ')}${r.conflicts ? ` · ${r.conflicts} conflit${r.conflicts > 1 ? 's' : ''} conservé${r.conflicts > 1 ? 's' : ''}` : ''}`
          this.emit({ type: 'highlights-changed', itemId: r.itemId, message })
          this.emit({ type: 'items-changed' })
        }
      }, FILE_DELAY)
    )
  }

  /** Applique dans Learn les changements faits dans un fichier ; renvoie null si rien à faire. */
  handleFile(path: string): SyncReport | null {
    if (!existsSync(path)) return null // fichier supprimé ou renommé : on ne supprime jamais rien pour ça
    const text = readFileSync(path, 'utf8')
    const parsed = parseLearnFile(text)
    if (!parsed) return null
    const { store } = this.core
    const itemId = parsed.learnId
    const item = store.getItem(itemId)
    if (!item) return null
    const state = store.getSyncState(itemId)
    const hash = hashText(text)
    if (state?.hash === hash && state.path === path) return null // notre propre écriture, ou rien de neuf

    const base = state?.base ?? { tags: item.tags, highlights: {} }
    const merge = threeWayMerge(
      store.listHighlights(itemId),
      parsed.highlights,
      base,
      { learn: item.tags, remote: parsed.tags, known: store.allTags() },
      'Version modifiée dans Obsidian :'
    )
    for (const id of merge.removals) store.removeHighlight(id)
    for (const { id, ...patch } of merge.patches) store.updateHighlight(id, patch)
    if (merge.tags) store.updateItem(itemId, { tags: merge.tags })
    const report: SyncReport = {
      itemId,
      updated: merge.patches.length,
      removed: merge.removals.length,
      conflicts: merge.conflicts,
      tagsChanged: !!merge.tags
    }
    // Le fichier n'est réécrit que si Learn détient quelque chose qu'il ne contient pas : on évite ainsi
    // de recharger le fichier sous les doigts de quelqu'un qui tape dans Obsidian.
    const needsExport = merge.needsPush

    if (needsExport) {
      // On mémorise d'abord le chemin (fichier éventuellement renommé), puis Learn réécrit l'état fusionné.
      store.setSyncState({ itemId, path, hash, base, syncedAt: Date.now() })
      this.core.exportToObsidian(itemId)
    } else {
      // Learn et le fichier disent la même chose : c'est la nouvelle base.
      store.setSyncState({ itemId, path, hash, base: this.core.syncSnapshot(itemId), syncedAt: Date.now() })
    }
    return report
  }
}
