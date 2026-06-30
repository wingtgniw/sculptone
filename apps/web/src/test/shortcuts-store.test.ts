import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('shortcuts store — showShortcuts', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 showShortcuts는 false이다', () => {
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('setShowShortcuts(true) → showShortcuts=true', () => {
    useStore.getState().setShowShortcuts(true)
    expect(useStore.getState().showShortcuts).toBe(true)
  })

  it('setShowShortcuts(false) → showShortcuts=false', () => {
    useStore.getState().setShowShortcuts(true)
    useStore.getState().setShowShortcuts(false)
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('toggleShortcuts() — false에서 true로 전환된다', () => {
    expect(useStore.getState().showShortcuts).toBe(false)
    useStore.getState().toggleShortcuts()
    expect(useStore.getState().showShortcuts).toBe(true)
  })

  it('toggleShortcuts() — true에서 false로 전환된다', () => {
    useStore.getState().setShowShortcuts(true)
    useStore.getState().toggleShortcuts()
    expect(useStore.getState().showShortcuts).toBe(false)
  })
})
