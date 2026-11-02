import { describe, expect, it } from 'vitest'

import { isGestureOn, WheelTracker } from '../src/renderer/src/lib/wheel'

const wheel = (deltaX: number, deltaY: number): WheelEvent => ({ deltaX, deltaY }) as WheelEvent

describe('gestes au trackpad', () => {
  it('verrouille l’axe au début du geste et le termine après une pause', async () => {
    const ends: { axis: string | null; dx: number }[] = []
    const t = new WheelTracker((x) => ends.push({ axis: x.axis, dx: x.dx }), 30)
    t.push(wheel(8, 1))
    t.push(wheel(10, 6)) // un peu de vertical ensuite : l'axe reste horizontal
    expect(t.axis).toBe('x')
    await new Promise((r) => setTimeout(r, 60))
    expect(ends).toEqual([{ axis: 'x', dx: 18 }])
    t.push(wheel(1, -12))
    expect(t.axis).toBe('y')
  })

  it('un défilement en diagonale reste vertical', () => {
    const t = new WheelTracker(() => {}, 30)
    t.push(wheel(5, 6))
    expect(t.axis).toBe('y')
    t.end()
  })

  it('respecte les gestes désactivés dans les réglages', () => {
    expect(isGestureOn({ cardSwipe: false }, 'cardSwipe')).toBe(false)
    expect(isGestureOn({ cardSwipe: false }, 'pullRefresh')).toBe(true)
    expect(isGestureOn(undefined, 'pinchZoom')).toBe(true)
  })
})
