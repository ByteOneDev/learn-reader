import { describe, expect, it } from 'vitest'
import { contextOf, findQuote } from '../src/shared/anchor'

const text = 'Le chat dort. Le chien court. Le chat mange. Fin.'

describe('ancrage par citation', () => {
  it('garde la position si elle correspond encore', () => {
    const start = text.indexOf('Le chat mange')
    expect(findQuote(text, { quote: 'Le chat', start, ...contextOf(text, start, start + 7) })).toEqual({ start, end: start + 7 })
  })

  it('se réancre grâce au contexte quand le texte a bougé', () => {
    const start = text.indexOf('Le chat mange')
    const anchor = { quote: 'Le chat', start, ...contextOf(text, start, start + 7) }
    const moved = 'Intro ajoutée. ' + text
    expect(findQuote(moved, anchor)).toEqual({ start: start + 15, end: start + 22 })
  })

  it('distingue deux occurrences par leur contexte', () => {
    const first = 0
    const anchor = { quote: 'Le chat', start: 999, ...contextOf(text, first, first + 7) }
    expect(findQuote(text, anchor)?.start).toBe(0)
  })

  it('renvoie null si la citation a disparu', () => {
    expect(findQuote(text, { quote: 'licorne', prefix: '', suffix: '', start: 0 })).toBeNull()
  })
})
