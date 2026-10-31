import type { Highlight, HighlightColor } from '@shared/types'
import type { SyncBase } from '../db'

// Fusion à trois voies entre Learn et une copie distante (fichier Obsidian, page Notion),
// à partir de l'état de la dernière synchronisation (la base).

export interface RemoteHighlight {
  note: string
  color: HighlightColor
}

export interface MergeResult {
  patches: { id: string; note?: string; color?: HighlightColor }[]
  removals: string[]
  conflicts: number
  /** Learn détient quelque chose que la copie distante n'a pas : il faudra la réécrire. */
  needsPush: boolean
  tags?: string[]
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

export function threeWayMerge(
  learn: Highlight[],
  remote: Map<string, RemoteHighlight>,
  base: SyncBase,
  tags: { learn: string[]; remote: string[]; known: string[] },
  conflictLabel: string
): MergeResult {
  const out: MergeResult = { patches: [], removals: [], conflicts: 0, needsPush: false }
  for (const h of learn) {
    const inRemote = remote.get(h.id)
    const before = base.highlights[h.id]
    const learnNote = h.note.trim()
    if (!inRemote) {
      // Présent lors de la dernière synchro, absent maintenant : supprimé à distance.
      // Sauf s'il a été modifié dans Learn depuis : Learn l'emporte et le réécrira.
      if (before && before.note === learnNote && before.color === h.color) out.removals.push(h.id)
      else out.needsPush = true
      continue
    }
    const patch: { id: string; note?: string; color?: HighlightColor } = { id: h.id }
    if (inRemote.note !== (before?.note ?? learnNote) && inRemote.note !== learnNote) {
      if (!before || before.note === learnNote) patch.note = inRemote.note
      else {
        // Modifiée des deux côtés : on garde les deux versions, rien n'est perdu.
        patch.note = `${learnNote}\n\n---\n*${conflictLabel}*\n\n${inRemote.note}`
        out.conflicts++
        out.needsPush = true
      }
    }
    if (inRemote.color !== (before?.color ?? h.color) && inRemote.color !== h.color) patch.color = inRemote.color
    if (patch.note === undefined && inRemote.note !== learnNote) out.needsPush = true
    if (patch.color === undefined && inRemote.color !== h.color) out.needsPush = true
    if (patch.note !== undefined || patch.color !== undefined) out.patches.push(patch)
  }

  // Tags : on retrouve l'orthographe de Learn quand la copie distante a remplacé les espaces par des tirets.
  const remoteTags = tags.remote.map((t) => tags.known.find((k) => k === t || k.replace(/\s+/g, '-') === t) ?? t)
  if (!same(remoteTags, base.tags) && !same(remoteTags, tags.learn)) {
    const merge = !same(tags.learn, base.tags)
    out.tags = merge ? [...new Set([...tags.learn, ...remoteTags])] : remoteTags
    if (merge) out.needsPush = true
  } else if (!same(remoteTags, tags.learn)) out.needsPush = true
  return out
}
