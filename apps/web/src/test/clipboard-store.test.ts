import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { createNote } from '@sculptone/score-model'

describe('clipboard store — clipboardNote', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 clipboardNote는 null이다', () => {
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('setClipboardNote(note) → clipboardNote가 해당 노트로 설정된다', () => {
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(note)
    expect(useStore.getState().clipboardNote).toEqual(note)
  })

  it('setClipboardNote(null) → clipboardNote가 null로 초기화된다', () => {
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(note)
    useStore.getState().setClipboardNote(null)
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('getInitialState() / setState(true) 리셋 후 clipboardNote는 null이다', () => {
    const note = createNote({ pitch: 72, start: 480, duration: 240, velocity: 80 })
    useStore.getState().setClipboardNote(note)
    // beforeEach에서 이미 리셋됨을 확인하는 것이지만,
    // 명시적으로 다시 리셋해 격리를 이중 검증.
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().clipboardNote).toBeNull()
  })
})
