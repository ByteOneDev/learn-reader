import { useApp } from './store'
import { isGestureOn, type GestureName } from './wheel'

export { GESTURES, inHorizontalScroller, WheelTracker, type GestureName } from './wheel'

/** Geste activé ? (tous le sont par défaut ; désactivables dans Réglages → Gestes) */
export function gestureOn(name: GestureName): boolean {
  return isGestureOn(useApp.getState().settings?.gestures, name)
}
