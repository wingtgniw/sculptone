import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from '../state/store'
import {
  addNote,
  createNote,
  createEmptyProject,
  createTrack,
  addTrack,
} from '@sculptone/score-model'

describe('multi-select store — selectedNoteIds', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  // ── 초기 상태 ──────────────────────────────────────────────

  it('초기 selectedNoteIds는 []이다', () => {
    expect(useStore.getState().selectedNoteIds).toEqual([])
  })

  // ── selectNote 호환 ────────────────────────────────────────

  it('selectNote(id) → selectedNoteIds=[id], selectedNoteId=id (미러)', () => {
    useStore.getState().selectNote('n1')
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual(['n1'])
    expect(s.selectedNoteId).toBe('n1')
  })

  it('selectNote(null) → selectedNoteIds=[], selectedNoteId=null', () => {
    useStore.getState().selectNote('n1')
    useStore.getState().selectNote(null)
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  // ── toggleNoteSelection ────────────────────────────────────

  it('toggleNoteSelection(id): 미선택 → 추가됨', () => {
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual(['n1'])
    expect(useStore.getState().selectedNoteId).toBe('n1')
  })

  it('toggleNoteSelection: 두 번 → 두 개 누적', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n2')
    expect(useStore.getState().selectedNoteIds).toEqual(['n1', 'n2'])
    expect(useStore.getState().selectedNoteId).toBe('n1') // 미러 = ids[0]
  })

  it('toggleNoteSelection: 이미 선택된 id → 제거됨', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n2')
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual(['n2'])
    expect(useStore.getState().selectedNoteId).toBe('n2')
  })

  it('toggleNoteSelection: 마지막 id 제거 → [], null', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── setSelectedNoteIds ─────────────────────────────────────

  it('setSelectedNoteIds(["a","b"]) → selectedNoteIds=["a","b"], selectedNoteId="a"', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    expect(useStore.getState().selectedNoteIds).toEqual(['a', 'b'])
    expect(useStore.getState().selectedNoteId).toBe('a')
  })

  it('setSelectedNoteIds([]) → [], null', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.getState().setSelectedNoteIds([])
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── clearNoteSelection ─────────────────────────────────────

  it('clearNoteSelection() → [], null', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b', 'c'])
    useStore.getState().clearNoteSelection()
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── selectTrack 부수효과 ────────────────────────────────────

  it('selectTrack() → selectedNoteIds 초기화', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.getState().selectTrack('t1')
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── replaceProject 부수효과 ────────────────────────────────

  it('replaceProject() → selectedNoteIds 초기화', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    const fresh = addTrack(createEmptyProject('Fresh'), createTrack('Piano'))
    useStore.getState().replaceProject(fresh)
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── undo/redo correctNoteIds ───────────────────────────────

  it('undo() 후 삭제된 노트가 selectedNoteIds에서 제거된다', () => {
    // history-store.test.ts 패턴 참조: vi.useFakeTimers()로 코얼레싱 방지
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)
    const s0 = useStore.getState()
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })

    // Step 1: 초기 project(노트 없음)이 history.past에 기록됨 (createHistory에서)
    // Step 2: 401ms 진행 후 노트가 있는 project를 새 undo 스텝으로 기록
    vi.advanceTimersByTime(401)
    const p1 = addNote(s0.project, s0.selectedTrackId, note)
    s0.setProject(p1)
    s0.setSelectedNoteIds([note.id])
    expect(useStore.getState().selectedNoteIds).toEqual([note.id])

    // undo → 원래 project(노트 없음)으로 돌아가며 correctNoteIds 적용
    useStore.getState().undo()
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()

    vi.useRealTimers()
  })

  // ── getInitialState 리셋 ───────────────────────────────────

  it('getInitialState()/setState(true) 리셋 후 selectedNoteIds=[]이다', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().selectedNoteIds).toEqual([])
  })
})

describe('multi-select store — clipboardNotes', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 clipboardNotes는 []이다', () => {
    expect(useStore.getState().clipboardNotes).toEqual([])
  })

  it('setClipboardNotes([n1,n2]) → clipboardNotes=[n1,n2], clipboardNote=n1', () => {
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    useStore.getState().setClipboardNotes([n1, n2])
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(2)
    expect(s.clipboardNotes[0]).toMatchObject({ pitch: 60 })
    expect(s.clipboardNote).toMatchObject({ pitch: 60 }) // 미러
  })

  it('setClipboardNotes([]) → clipboardNotes=[], clipboardNote=null', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNotes([n])
    useStore.getState().setClipboardNotes([])
    const s = useStore.getState()
    expect(s.clipboardNotes).toEqual([])
    expect(s.clipboardNote).toBeNull()
  })

  it('setClipboardNote(note) 호환: clipboardNotes=[note], clipboardNote=note', () => {
    const n = createNote({ pitch: 64, start: 240, duration: 120, velocity: 90 })
    useStore.getState().setClipboardNote(n)
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(1)
    expect(s.clipboardNotes[0]).toMatchObject({ pitch: 64 })
    expect(s.clipboardNote).toMatchObject({ pitch: 64 })
  })

  it('setClipboardNote(null) 호환: clipboardNotes=[], clipboardNote=null', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(n)
    useStore.getState().setClipboardNote(null)
    expect(useStore.getState().clipboardNotes).toEqual([])
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('getInitialState() 리셋 후 clipboardNotes=[]', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNotes([n])
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().clipboardNotes).toEqual([])
  })
})
