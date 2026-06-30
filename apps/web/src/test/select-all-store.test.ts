import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { addNote, createNote } from '@sculptone/score-model'

describe('selectAllInTrack', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('트랙에 3개 노트 → selectedNoteIds에 3개 id 모두 포함', () => {
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    const n3 = createNote({ pitch: 64, start: 720, duration: 120, velocity: 90 })
    let p = addNote(s.project, tid, n1)
    p = addNote(p, tid, n2)
    p = addNote(p, tid, n3)
    s.setProject(p)
    useStore.getState().selectAllInTrack()
    const ids = useStore.getState().selectedNoteIds
    expect(ids).toHaveLength(3)
    expect(ids).toContain(n1.id)
    expect(ids).toContain(n2.id)
    expect(ids).toContain(n3.id)
  })

  it('빈 트랙 → selectedNoteIds=[], selectedNoteId=null', () => {
    // 초기 트랙은 노트 없음
    useStore.getState().selectAllInTrack()
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  it('미러 불변식: selectedNoteId === selectedNoteIds[0] ?? null', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    useStore.getState().selectAllInTrack()
    const state = useStore.getState()
    expect(state.selectedNoteId).toBe(state.selectedNoteIds[0] ?? null)
  })

  it('반복 호출 → 동일 결과 (멱등성)', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    s.setProject(addNote(addNote(s.project, s.selectedTrackId, n1), s.selectedTrackId, n2))
    useStore.getState().selectAllInTrack()
    const first = [...useStore.getState().selectedNoteIds]
    useStore.getState().selectAllInTrack()
    const second = useStore.getState().selectedNoteIds
    expect(second).toEqual(first)
  })

  it('존재하지 않는 selectedTrackId → selectedNoteIds=[], selectedNoteId=null', () => {
    // selectedTrackId를 무효 값으로 강제 설정
    useStore.setState({ selectedTrackId: 'no-such-track' })
    useStore.getState().selectAllInTrack()
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })
})
