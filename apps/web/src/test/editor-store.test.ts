import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('editor store', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('초기 selectedTrackId는 첫 트랙, selectedNoteId는 null', () => {
    const s = useStore.getState()
    expect(s.selectedTrackId).toBe(s.project.tracks[0]!.id)
    expect(s.selectedNoteId).toBeNull()
  })
  it('기본 quantizeDenom은 16, isPlaying false', () => {
    const s = useStore.getState()
    expect(s.quantizeDenom).toBe(16)
    expect(s.isPlaying).toBe(false)
  })
  it('selectTrack / selectNote / setQuantizeDenom / setPlaying 동작', () => {
    const { selectNote, selectTrack, setQuantizeDenom, setPlaying } = useStore.getState()
    selectNote('n1'); expect(useStore.getState().selectedNoteId).toBe('n1')
    // selectTrack은 트랙을 갱신하면서 노트 선택을 초기화한다(부수효과)
    selectTrack('track-x')
    expect(useStore.getState().selectedTrackId).toBe('track-x')
    expect(useStore.getState().selectedNoteId).toBeNull()
    setQuantizeDenom(8); expect(useStore.getState().quantizeDenom).toBe(8)
    setPlaying(true); expect(useStore.getState().isPlaying).toBe(true)
  })
})
