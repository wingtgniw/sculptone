import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useClipboard } from '../useClipboard'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

/**
 * useClipboard를 호출하는 최소 래퍼 컴포넌트.
 * getSeconds는 테스트에서 제어 가능한 값을 반환한다.
 */
function ClipboardWrapper({ getSeconds }: { getSeconds: () => number }) {
  useClipboard({ getSeconds })
  return null
}

describe('useClipboard', () => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modKey = isMac ? 'metaKey' : 'ctrlKey'

  let noteId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    // 트랙에 노트를 추가하고 선택한다.
    const s = useStore.getState()
    const note = createNote({ pitch: 60, start: 480, duration: 240, velocity: 100 })
    noteId = note.id
    s.setProject(addNote(s.project, s.selectedTrackId, note))
    act(() => {
      s.selectNote(note.id)
    })
  })

  it('Ctrl/Cmd+C: 선택된 노트가 clipboardNote에 저장된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNote).toMatchObject({ id: noteId, pitch: 60 })
  })

  it('Ctrl/Cmd+X: 노트가 clipboardNote에 저장되고 트랙에서 제거되며 selectedNoteId가 null이 된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    const state = useStore.getState()
    const tid = state.selectedTrackId
    const track = state.project.tracks.find((t) => t.id === tid)!
    expect(state.clipboardNote).toMatchObject({ pitch: 60 })
    expect(track.notes).toHaveLength(0)
    expect(state.selectedNoteId).toBeNull()
  })

  it('Ctrl/Cmd+V: clipboardNote에서 새 노트가 현재 anchorTick에 붙여넣어지고 선택된다', () => {
    // 먼저 복사
    const s = useStore.getState()
    const originalNote = s.project.tracks[0]!.notes[0]!
    act(() => {
      s.setClipboardNote(originalNote)
    })

    // getSeconds=0 → anchorTick=0, 4/4 ppq480 기준 grid=16th=120
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })

    const state2 = useStore.getState()
    const track = state2.project.tracks[0]!
    // 원본 1개 + 붙여넣기 1개 = 2개
    expect(track.notes).toHaveLength(2)
    // 새 노트가 선택됨
    const newNote = track.notes.find((n) => n.id !== noteId)!
    expect(state2.selectedNoteId).toBe(newNote.id)
    // start는 anchorTick(0)에 snap → 0
    expect(newNote.start).toBe(0)
    // pitch, duration, velocity는 clip에서
    expect(newNote.pitch).toBe(60)
    expect(newNote.duration).toBe(240)
  })

  it('Ctrl/Cmd+D: 선택된 노트를 1마디 뒤에 복제하고 새 노트가 선택된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })

    const state = useStore.getState()
    const track = state.project.tracks[0]!
    expect(track.notes).toHaveLength(2)
    const newNote = track.notes.find((n) => n.id !== noteId)!
    expect(state.selectedNoteId).toBe(newNote.id)
    // start = 480 + 1920(4/4 bar) = 2400
    expect(newNote.start).toBe(2400)
    expect(newNote.pitch).toBe(60)
    expect(newNote.duration).toBe(240)
  })

  it('INPUT 포커스 시 Ctrl/Cmd+C는 no-op이다 (입력 필드 가드)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'c', [modKey]: true, bubbles: true })
    expect(useStore.getState().clipboardNote).toBeNull()
    document.body.removeChild(input)
  })

  it('선택된 노트가 없으면 Ctrl/Cmd+C는 no-op이다', () => {
    act(() => {
      useStore.getState().selectNote(null)
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('clipboardNote가 null이면 Ctrl/Cmd+V는 no-op이다', () => {
    // clipboardNote는 null (초기 상태)
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })
    const track = useStore.getState().project.tracks[0]!
    // 노트 수 변화 없음
    expect(track.notes).toHaveLength(1)
  })

  // ── #3: 비-0 재생위치 배선 검증 ────────────────────────────────
  it('Ctrl/Cmd+V: getSeconds=0.5 → 붙여넣은 노트 start===480 (재생위치 배선 회귀)', () => {
    // ppq=480, tempo=120 → secondsToTicks(0.5)=480, grid=120 → snap(480,120)=480
    const s = useStore.getState()
    const originalNote = s.project.tracks[0]!.notes[0]!
    act(() => {
      s.setClipboardNote(originalNote)
    })

    render(<ClipboardWrapper getSeconds={() => 0.5} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })

    const state2 = useStore.getState()
    const track = state2.project.tracks[0]!
    expect(track.notes).toHaveLength(2)
    const newNote = track.notes.find((n) => n.id !== noteId)!
    expect(newNote.start).toBe(480)
  })

  // ── #4: 수식어 가드 테스트 ──────────────────────────────────────
  it('수식어 없는 bare "d" 키는 no-op이다 (노트 불변, clipboard null)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    const trackBefore = useStore.getState().project.tracks[0]!.notes.length
    fireEvent.keyDown(document.body, { key: 'd' })
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(trackBefore)
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('Ctrl/Cmd+Alt+"c" 조합은 no-op이다 (clipboard null)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true, altKey: true })
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('Ctrl/Cmd+Shift+"c" 조합은 no-op이다 (clipboard null)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true, shiftKey: true })
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  // ── #5: 기본상태 no-op (X/D, 노트 미선택) ─────────────────────
  it('선택된 노트가 없으면 Ctrl/Cmd+X는 no-op이다 (노트 불변)', () => {
    act(() => {
      useStore.getState().selectNote(null)
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    const track = useStore.getState().project.tracks[0]!
    expect(track.notes).toHaveLength(1)
  })

  it('선택된 노트가 없으면 Ctrl/Cmd+D는 no-op이다 (노트 불변)', () => {
    act(() => {
      useStore.getState().selectNote(null)
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })
    const track = useStore.getState().project.tracks[0]!
    expect(track.notes).toHaveLength(1)
  })

  // ── #6: endEdit undo 분리 검증 ────────────────────────────────
  it('Ctrl/Cmd+D: endEdit() 덕분에 직전 드래그와 별도 undo 스텝이 된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)

    // 드래그 시뮬레이션: setProject로 _lastEditAt을 방금으로 설정
    act(() => {
      const { project, selectedTrackId, setProject } = useStore.getState()
      const updatedProject = {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === selectedTrackId
            ? { ...t, notes: t.notes.map((n) => (n.id === noteId ? { ...n, start: 600 } : n)) }
            : t,
        ),
      }
      setProject(updatedProject)
    })

    // past 길이 캡처 (드래그 직후, D 전)
    const pastBefore = useStore.getState().history.past.length

    // Ctrl/Cmd+D: 내부 endEdit()으로 코얼레싱 방지 → 새 undo 스텝 생성
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })

    expect(useStore.getState().history.past.length).toBe(pastBefore + 1)

    // undo() → 복제만 취소, 직전 드래그 편집(start=600)은 유지
    act(() => {
      useStore.getState().undo()
    })
    const trackAfterUndo = useStore.getState().project.tracks[0]!
    expect(trackAfterUndo.notes).toHaveLength(1)
    expect(trackAfterUndo.notes[0]!.start).toBe(600)
  })

  // ── #1 회귀: e.repeat 가드 ────────────────────────────────────
  it('Ctrl/Cmd+D keydown repeat=true 시 노트가 추가되지 않는다 (홀드 캐스케이드 방지)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    const trackBefore = useStore.getState().project.tracks[0]!.notes.length
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true, repeat: true })
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(trackBefore)
  })

  it('Ctrl/Cmd+V keydown repeat=true 시 노트가 추가되지 않는다 (홀드 캐스케이드 방지)', () => {
    // 클립보드에 노트 설정
    const s = useStore.getState()
    act(() => {
      s.setClipboardNote(s.project.tracks[0]!.notes[0]!)
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    const trackBefore = useStore.getState().project.tracks[0]!.notes.length
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true, repeat: true })
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(trackBefore)
  })
})
