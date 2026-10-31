import { create } from 'zustand'
import type { Item } from '@shared/types'
import { useApp } from './store'

// Lecteur audio unique, indépendant de l'écran affiché : l'épisode continue pendant qu'on lit autre chose.

interface PlayerState {
  item: Item | null
  sourceTitle?: string
  playing: boolean
  time: number
  duration: number
  rate: number
  load(item: Item, sourceTitle?: string, play?: boolean): void
  toggle(): void
  seek(t: number): void
  skip(d: number): void
  setRate(r: number): void
  stop(): void
}

export const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2]

let audio: HTMLAudioElement | null = null
let lastSave = 0
let lastTick = 0

function save(force = false): void {
  const { item, time, duration } = usePlayer.getState()
  if (!item || (!force && Date.now() - lastSave < 5000)) return
  lastSave = Date.now()
  const progress = duration ? Math.min(1, time / duration) : 0
  void useApp.getState().api.savePosition(item.id, JSON.stringify({ t: Math.floor(time) }), progress)
  useApp.setState((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, progress } : i)) }))
}

function el(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('timeupdate', () => {
    if (Date.now() - lastTick < 250) return
    lastTick = Date.now()
    usePlayer.setState({ time: audio!.currentTime })
    save()
  })
  audio.addEventListener('durationchange', () => usePlayer.setState({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 0 }))
  audio.addEventListener('play', () => usePlayer.setState({ playing: true }))
  audio.addEventListener('pause', () => {
    usePlayer.setState({ playing: false })
    save(true)
  })
  audio.addEventListener('ended', () => {
    const { item } = usePlayer.getState()
    usePlayer.setState({ playing: false, time: 0 })
    if (item) void useApp.getState().patchItem(item.id, { read: true })
    save(true)
  })
  return audio
}

export const usePlayer = create<PlayerState>((set, get) => ({
  item: null,
  playing: false,
  time: 0,
  duration: 0,
  rate: 1,
  load(item, sourceTitle, play = true) {
    if (!item.mediaUrl || item.mediaType !== 'audio') return
    const a = el()
    if (get().item?.id !== item.id) {
      save(true)
      a.src = item.mediaUrl
      let start = 0
      try {
        start = item.position ? (JSON.parse(item.position) as { t?: number }).t ?? 0 : 0
      } catch {
        start = 0
      }
      // Épisode presque terminé : on reprend du début.
      if (item.duration && start > item.duration - 15) start = 0
      a.currentTime = start
      a.playbackRate = get().rate
      set({ item, sourceTitle, time: start, duration: item.duration ?? 0 })
    }
    if (play) void a.play().catch(() => set({ playing: false }))
  },
  toggle() {
    const a = el()
    if (!get().item) return
    if (a.paused) void a.play().catch(() => undefined)
    else a.pause()
  },
  seek(t) {
    const a = el()
    a.currentTime = Math.max(0, Math.min(t, get().duration || t))
    set({ time: a.currentTime })
    save(true)
  },
  skip(d) {
    get().seek(el().currentTime + d)
  },
  setRate(r) {
    el().playbackRate = r
    set({ rate: r })
  },
  stop() {
    save(true)
    el().pause()
    el().removeAttribute('src')
    set({ item: null, playing: false, time: 0, duration: 0 })
  }
}))
