import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from '../state/store'
import {
  addNote,
  addTrack,
  createNote,
  createTrack,
  createEmptyProject,
} from '@sculptone/score-model'

// ── 픽스처 ────────────────────────────────────────────────────

function withNote() {
  const s = useStore.getState()
  const tid = s.selectedTrackId
  return addNote(s.project, tid, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
}

// ── 초기 히스토리 상태 ────────────────────────────────────────

describe('초기 히스토리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('history.past=[], history.future=[], _lastEditAt=0이다', () => {
    const s = useStore.getState()
    expect(s.history.past).toEqual([])
    expect(s.history.future).toEqual([])
    expect(s._lastEditAt).toBe(0)
  })

  it('history.present가 초기 project와 동일 참조이다', () => {
    const s = useStore.getState()
    expect(s.history.present).toBe(s.project)
  })
})

// ── setProject → 히스토리 record ─────────────────────────────

describe('setProject 히스토리 record', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('setProject 호출 시 history.past.length가 1 증가하고 present=새 project이다', () => {
    const p1 = withNote()
    useStore.getState().setProject(p1)
    const s = useStore.getState()
    expect(s.history.past).toHaveLength(1)
    expect(s.history.present).toBe(p1)
    expect(s.project).toBe(p1)
  })

  it('setProject 두 번 호출 시 400ms 이내면 두 번째가 코얼레싱된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1) // _lastEditAt = T (fake now)
    // 시간 이동 없음 → Date.now() 동일 → 0ms 차이 < 400ms → 코얼레싱
    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    expect(s.project).toBe(p2)
    // 코얼레싱: past.length는 1 그대로 (p2가 p1을 교체)
    expect(s.history.past).toHaveLength(1)

    vi.useRealTimers()
  })

  it('setProject 두 번 호출 시 400ms 초과이면 코얼레싱하지 않는다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1)

    vi.advanceTimersByTime(401) // 400ms 초과

    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    expect(s.history.past).toHaveLength(2)
    expect(s.history.present).toBe(p2)

    vi.useRealTimers()
  })

  it('_lastEditAt=0 초기 상태에서 첫 setProject는 코얼레싱하지 않는다', () => {
    // fake timers로 Date.now()=0이 되도록 강제
    vi.useFakeTimers({ now: 0 })
    useStore.setState(useStore.getInitialState(), true) // _lastEditAt=0 리셋
    expect(useStore.getState()._lastEditAt).toBe(0)

    const p1 = withNote()
    useStore.getState().setProject(p1)

    // 0 - 0 = 0 < 400 となるが _lastEditAt=0 Guard により코얼레싱하지 않아야 함
    const s = useStore.getState()
    expect(s.history.past).toHaveLength(1) // 코얼레싱 아님

    vi.useRealTimers()
  })
})

// ── replaceProject → 히스토리 리셋 ───────────────────────────

describe('replaceProject 히스토리 리셋', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('replaceProject는 history를 createHistory(project)로 리셋하고 _lastEditAt=0으로 초기화한다', () => {
    // 히스토리 쌓기
    useStore.getState().setProject(withNote())
    expect(useStore.getState().history.past).toHaveLength(1)

    // 새 프로젝트로 교체
    const fresh = addTrack(createEmptyProject('Fresh'), createTrack('Bass'))
    useStore.getState().replaceProject(fresh)
    const s = useStore.getState()
    expect(s.history.past).toEqual([])
    expect(s.history.future).toEqual([])
    expect(s.history.present).toBe(fresh)
    expect(s._lastEditAt).toBe(0)
    expect(s.project).toBe(fresh)
    expect(s.selectedTrackId).toBe(fresh.tracks[0]!.id)
    expect(s.selectedNoteId).toBeNull()
  })
})

// ── undo ─────────────────────────────────────────────────────

describe('undo 액션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('undo()는 이전 project를 복원한다', () => {
    const originalProject = useStore.getState().project
    const p1 = withNote()
    useStore.getState().setProject(p1)
    expect(useStore.getState().project).toBe(p1)

    useStore.getState().undo()
    expect(useStore.getState().project).toBe(originalProject)
    expect(useStore.getState().history.past).toHaveLength(0)
    expect(useStore.getState().history.future).toHaveLength(1)
  })

  it('undo() 시 selectedTrackId가 복원된 project에 없으면 첫 트랙으로 보정된다', () => {
    const s = useStore.getState()
    const firstTrackId = s.selectedTrackId // Piano 트랙 id

    // t2를 추가하고 선택 → 이것이 undo 대상 편집
    const t2 = createTrack('Bass')
    s.setProject(addTrack(s.project, t2)) // past=[project0], present=p1(t2 포함)
    s.selectTrack(t2.id)
    expect(useStore.getState().selectedTrackId).toBe(t2.id)

    // undo → project0(t2 없음)으로 복원 → selectedTrackId가 firstTrackId로 보정된다
    useStore.getState().undo()
    const after = useStore.getState()
    // t2가 복원된 project(project0)에 없으므로 첫 트랙(Piano)으로 보정됨
    expect(after.selectedTrackId).toBe(firstTrackId)
    expect(after.project.tracks.find((t) => t.id === firstTrackId)).toBeDefined()
    expect(after.project.tracks.find((t) => t.id === t2.id)).toBeUndefined()
  })

  it('undo() 시 selectedNoteId가 복원된 project에 없으면 null로 보정된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const s = useStore.getState()
    const tid = s.selectedTrackId
    // 노트 추가
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const p1 = addNote(s.project, tid, note)
    s.setProject(p1)
    s.selectNote(note.id)
    expect(useStore.getState().selectedNoteId).toBe(note.id)

    // 코얼레싱 방지: 401ms 진행 후 별도 undo 단계로 기록
    vi.advanceTimersByTime(401)

    // 노트 제거
    const p2 = { ...p1, tracks: p1.tracks.map((t) => (t.id === tid ? { ...t, notes: [] } : t)) }
    useStore.getState().setProject(p2)

    // undo → p1(note 있음) → selectedNoteId 유지
    useStore.getState().undo()
    expect(useStore.getState().project).toBe(p1)
    expect(useStore.getState().selectedNoteId).toBe(note.id) // 보정 불필요, 노트 존재

    // 다시 undo → original(note 없음) → selectedNoteId=null 보정
    useStore.getState().undo()
    expect(useStore.getState().selectedNoteId).toBeNull()

    vi.useRealTimers()
  })

  it('canUndo=false일 때 undo()는 no-op이다', () => {
    const before = useStore.getState()
    useStore.getState().undo()
    const after = useStore.getState()
    expect(after.project).toBe(before.project)
    expect(after.history).toBe(before.history)
  })
})

// ── undo/redo 직후 setProject 코얼레싱 방지 ──────────────────

describe('undo/redo 직후 setProject 코얼레싱 방지', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('undo() 직후(시간 경과 없이) setProject는 코얼레싱하지 않아 별도 undo 단계가 된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1)
    // past=[initial], present=p1
    expect(useStore.getState().history.past).toHaveLength(1)

    // undo: present=initial, future=[p1], _lastEditAt=0
    useStore.getState().undo()
    expect(useStore.getState().history.past).toHaveLength(0)

    // 시간 경과 없이 바로 setProject(p2)
    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    // _lastEditAt=0 덕분에 코얼레싱하지 않아 past.length=1, canUndo=true
    expect(s.history.past).toHaveLength(1)
    expect(s.history.past.length > 0).toBe(true) // canUndo

    vi.useRealTimers()
  })

  it('redo() 직후(시간 경과 없이) setProject는 코얼레싱하지 않아 별도 undo 단계가 된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1)
    useStore.getState().undo()
    useStore.getState().redo()
    // redo 후 _lastEditAt=0

    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    // 코얼레싱하지 않아 past.length >= 1
    expect(s.history.past.length > 0).toBe(true)

    vi.useRealTimers()
  })
})

// ── undo/redo 선택 불변식 유지 (Fix A) ───────────────────────

describe('undo/redo 선택 불변식 유지 (Fix A)', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('undo() 후 head(A)가 사라지고 B만 남을 때 selectedNoteId === B.id 불변식 유지', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const s = useStore.getState()
    const tid = s.selectedTrackId

    // Step 1: 노트 B를 별도 history step으로 추가
    const noteB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    const p1 = addNote(s.project, tid, noteB)
    s.setProject(p1)

    // 코얼레싱 방지
    vi.advanceTimersByTime(401)

    // Step 2: 노트 A를 추가하고 [A, B] 선택 (head=A)
    const noteA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const p2 = addNote(p1, tid, noteA)
    s.setProject(p2)
    s.setSelectedNoteIds([noteA.id, noteB.id]) // head = A

    expect(useStore.getState().selectedNoteIds).toEqual([noteA.id, noteB.id])
    expect(useStore.getState().selectedNoteId).toBe(noteA.id)

    // Step 3: undo → A가 제거되고 B만 남음
    useStore.getState().undo()

    const afterUndo = useStore.getState()
    // correctNoteIds로 A가 필터링되고 B만 남음
    expect(afterUndo.selectedNoteIds).toEqual([noteB.id])
    // 불변식: selectedNoteId === selectedNoteIds[0] (= B.id), null이 아님
    expect(afterUndo.selectedNoteId).toBe(noteB.id)

    vi.useRealTimers()
  })

  it('redo() 후 selectedNoteId가 ids[0]와 동기화된다 (redo 대칭)', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const s = useStore.getState()
    const tid = s.selectedTrackId

    // history: [initial] → [B 있음]
    const noteB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    const p1 = addNote(s.project, tid, noteB)
    s.setProject(p1)

    // undo → [initial]으로
    useStore.getState().undo()

    // desync 상태 시뮬레이션: selectedNoteIds=[noteB.id] but selectedNoteId=null
    // (old buggy code가 남길 수 있는 상태)
    useStore.setState({ selectedNoteIds: [noteB.id], selectedNoteId: null })

    // redo → [B 있음]으로
    useStore.getState().redo()

    const afterRedo = useStore.getState()
    // B가 project에 존재하므로 ids=[B.id]
    expect(afterRedo.selectedNoteIds).toEqual([noteB.id])
    // 불변식: selectedNoteId === ids[0] (= B.id), null이 아님
    expect(afterRedo.selectedNoteId).toBe(noteB.id)

    vi.useRealTimers()
  })
})

// ── Fix 2: correctNoteIds — 존재하는 id 순서 보존 + 비존재 id 제거 ──────

describe('correctNoteIds 동작 (undo/redo를 통해 검증)', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('undo 후 selectedNoteIds에서 존재하지 않는 id는 제거되고 존재하는 id는 순서대로 유지된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const s = useStore.getState()
    const tid = s.selectedTrackId

    // Step 1: n1 추가 (past=[init], present=p1)
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const p1 = addNote(s.project, tid, n1)
    s.setProject(p1)

    vi.advanceTimersByTime(401)

    // Step 2: n2 추가 (past=[init, p1], present=p2)
    const n2 = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    const p2 = addNote(p1, tid, n2)
    useStore.getState().setProject(p2)

    // 순서 섞어 선택: head=n2, tail=n1
    useStore.getState().setSelectedNoteIds([n2.id, n1.id])
    expect(useStore.getState().selectedNoteIds).toEqual([n2.id, n1.id])

    // undo → p1 (n2 없음)
    // correctNoteIds(p1, [n2.id, n1.id]) → n2 제거, n1 보존 → [n1.id]
    useStore.getState().undo()

    expect(useStore.getState().selectedNoteIds).toEqual([n1.id])
    expect(useStore.getState().selectedNoteId).toBe(n1.id)

    vi.useRealTimers()
  })
})

// ── redo ─────────────────────────────────────────────────────

describe('redo 액션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('redo()는 undo 이전 project를 재적용한다', () => {
    const p1 = withNote()
    useStore.getState().setProject(p1)
    useStore.getState().undo()
    expect(useStore.getState().project).not.toBe(p1)

    useStore.getState().redo()
    expect(useStore.getState().project).toBe(p1)
    expect(useStore.getState().history.future).toHaveLength(0)
  })

  it('canRedo=false일 때 redo()는 no-op이다', () => {
    const before = useStore.getState()
    useStore.getState().redo()
    const after = useStore.getState()
    expect(after.project).toBe(before.project)
    expect(after.history).toBe(before.history)
  })
})
