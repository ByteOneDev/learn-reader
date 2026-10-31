import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { Highlight, Item } from '@shared/types'
import { useApp } from '../../lib/store'

/** Ce que le lecteur peut demander à une vue de livre : aller à une couche (chapitre, page). */
export interface BookNav {
  goTo(layer: string): Promise<void>
  current(): string
}

export interface BookViewProps {
  item: Item
  highlights: Highlight[]
  scrollRef: RefObject<HTMLDivElement | null>
  navRef: MutableRefObject<BookNav | null>
  onOrphans(ids: Set<string>): void
  onMouseUp(): void
  onClick(e: React.MouseEvent): void
}

export interface Position {
  chapter?: number
  scroll?: number
  page?: number
  /** Épisodes et vidéos : instant en secondes. */
  t?: number
}

export function parsePosition(p?: string): Position {
  try {
    return p ? (JSON.parse(p) as Position) : {}
  } catch {
    return {}
  }
}

/** Sauvegarde la position de lecture sans inonder l'IPC (au plus une écriture toutes les 700 ms). */
export function usePositionSaver(itemId: string): (pos: Position, progress: number) => void {
  const api = useApp((s) => s.api)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef<{ pos: Position; progress: number } | null>(null)
  const flush = (): void => {
    if (!last.current) return
    const { pos, progress } = last.current
    last.current = null
    void api.savePosition(itemId, JSON.stringify(pos), progress)
    // On met aussi la liste à jour, pour la barre de progression des cartes.
    useApp.setState((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, progress, position: JSON.stringify(pos) } : i)) }))
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      flush()
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (pos, progress) => {
    last.current = { pos, progress }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }
}

export function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}
