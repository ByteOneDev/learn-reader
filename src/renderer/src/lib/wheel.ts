// Gestes au trackpad. Le navigateur les reçoit comme une suite d'événements « wheel » : on verrouille
// l'axe au début (un défilement vertical ne devient jamais un balayage), on cumule, et le geste se
// termine après une courte pause (doigts levés et inertie épuisée). Module pur, sans état d'interface.

export const GESTURES = ['pullRefresh', 'cardSwipe', 'readerSwipe', 'pinchZoom', 'imageZoom'] as const
export type GestureName = (typeof GESTURES)[number]

/** Geste activé selon les réglages (tous le sont par défaut). */
export function isGestureOn(gestures: Partial<Record<GestureName, boolean>> | undefined, name: GestureName): boolean {
  return gestures?.[name] !== false
}

export class WheelTracker {
  axis: 'x' | 'y' | null = null
  dx = 0
  dy = 0
  events = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onEnd: (t: WheelTracker) => void,
    private readonly idle = 150
  ) {}

  push(e: WheelEvent): void {
    this.events++
    this.dx += e.deltaX
    this.dy += e.deltaY
    if (!this.axis && Math.abs(this.dx) + Math.abs(this.dy) > 6) this.axis = Math.abs(this.dx) > Math.abs(this.dy) * 1.4 ? 'x' : 'y'
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.end(), this.idle)
  }

  end(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.onEnd(this)
    this.axis = null
    this.dx = 0
    this.dy = 0
    this.events = 0
  }
}

/** La cible est-elle dans un élément qui défile lui-même horizontalement (code, tableau, PDF zoomé) ? */
export function inHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}
