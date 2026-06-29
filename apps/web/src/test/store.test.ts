import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('store', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 모드는 compose이고 프로젝트가 1개 트랙으로 시작한다', () => {
    const s = useStore.getState()
    expect(s.activeMode).toBe('compose')
    expect(s.project.tracks).toHaveLength(1)
    expect(s.project.tracks[0]!.name).toBe('Piano')
  })

  it('setMode는 활성 모드를 바꾼다', () => {
    useStore.getState().setMode('play')
    expect(useStore.getState().activeMode).toBe('play')
  })

  it('recordStopSec 기본값은 0이고 setRecordStopSec로 갱신된다', () => {
    expect(useStore.getState().recordStopSec).toBe(0)
    useStore.getState().setRecordStopSec(2.5)
    expect(useStore.getState().recordStopSec).toBe(2.5)
  })
})
