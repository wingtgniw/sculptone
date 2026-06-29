import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { createEmptyProject, createTrack, addTrack } from '@sculptone/score-model'

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

  it('replaceProject는 새 첫 트랙으로 selectedTrackId를 갱신하고 selectedNoteId를 null로 설정', () => {
    // 노트를 선택해 두고 다른 트랙을 가진 새 프로젝트로 교체
    useStore.getState().selectNote('some-note')
    const fresh = addTrack(createEmptyProject('Fresh'), createTrack('NewTrack'))
    useStore.getState().replaceProject(fresh)
    const s = useStore.getState()
    expect(s.project.id).toBe(fresh.id)
    expect(s.selectedTrackId).toBe(fresh.tracks[0]!.id)
    expect(s.selectedNoteId).toBeNull()
  })

  it('setProject는 선택 상태를 변경하지 않는다(인플레이스 편집 보호)', () => {
    const before = useStore.getState()
    const edited = { ...before.project }
    before.selectNote('keep-me')
    before.setProject(edited)
    const after = useStore.getState()
    expect(after.selectedTrackId).toBe(before.selectedTrackId)
    expect(after.selectedNoteId).toBe('keep-me')
  })

  it('초기 isRecording은 false이다', () => {
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('setRecording(true) → isRecording true, setRecording(false) → false', () => {
    useStore.getState().setRecording(true)
    expect(useStore.getState().isRecording).toBe(true)
    useStore.getState().setRecording(false)
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('초기 composeView는 "roll"이다', () => {
    expect(useStore.getState().composeView).toBe('roll')
  })

  it('setComposeView("score") → composeView가 "score"로 변경된다', () => {
    useStore.getState().setComposeView('score')
    expect(useStore.getState().composeView).toBe('score')
    useStore.getState().setComposeView('roll')
    expect(useStore.getState().composeView).toBe('roll')
  })
})
