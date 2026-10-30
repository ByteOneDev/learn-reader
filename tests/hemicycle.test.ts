import { describe, expect, it } from 'vitest'
import { hemicycleSeats, initials } from '../src/renderer/src/onboarding/hemicycleLayout'

describe('hémicycle', () => {
  it('place exactement un siège par média, de gauche à droite', () => {
    for (const n of [1, 5, 9, 14, 16, 24]) {
      const seats = hemicycleSeats(n)
      expect(seats).toHaveLength(n)
      for (let i = 1; i < seats.length; i++) expect(seats[i].angle).toBeLessThanOrEqual(seats[i - 1].angle)
    }
  })

  it('abrège les titres sans ambiguïté', () => {
    expect(initials("L'Humanité")).toBe('Hu')
    expect(initials("L'Express")).toBe('Ex')
    expect(initials('Le Figaro — Politique')).toBe('Fi')
    expect(initials('franceinfo — Politique')).toBe('Fr')
    expect(initials('Le Monde diplomatique')).toBe('MD')
    expect(initials('Valeurs actuelles')).toBe('VA')
    expect(initials('The Guardian — Politics')).toBe('Gu')
  })
})
