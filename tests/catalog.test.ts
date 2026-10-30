import { describe, expect, it } from 'vitest'
import { catalog } from '../src/shared/catalog'
import { resolveInput } from '../src/main/feeds/resolve'

describe('catalogue', () => {
  it('a des identifiants uniques et des entrées valides', () => {
    const ids = catalog.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of catalog.entries) {
      expect(catalog.categories.some((c) => c.id === e.category)).toBe(true)
      expect(() => resolveInput(e.input)).not.toThrow()
    }
  })

  it('propose au moins une source pré-cochée par catégorie et par langue', () => {
    for (const c of catalog.categories) {
      for (const lang of ['fr', 'en'] as const) {
        expect(catalog.entries.some((e) => e.category === c.id && e.lang === lang && e.preselected), `${c.id}/${lang}`).toBe(true)
      }
    }
  })

  it('couvre tout le spectre politique, à gauche comme à droite, dans les deux langues', () => {
    for (const lang of ['fr', 'en'] as const) {
      const leanings = new Set(catalog.entries.filter((e) => e.lang === lang && e.leaning !== undefined).map((e) => e.leaning))
      for (const l of [-3, -2, -1, 0, 1, 2, 3]) expect(leanings.has(l), `${lang} ${l}`).toBe(true)
      const pre = catalog.entries.filter((e) => e.lang === lang && e.leaning !== undefined && e.preselected)
      expect(pre.some((e) => e.leaning! < 0) && pre.some((e) => e.leaning! > 0)).toBe(true)
    }
  })

  it('n’attribue une orientation politique qu’à la catégorie Politique', () => {
    expect(catalog.entries.filter((e) => e.leaning !== undefined).every((e) => e.category === 'politique')).toBe(true)
  })
})
