import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote, createEmptyProject } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

/**
 * jsdom 25에서 PointerEvent.shiftKey / clientX 등이 read-only 속성이어서
 * fireEvent 이니셜라이저로 설정되지 않는다. Object.defineProperty로 주입한다.
 * (PianoRoll.drag.test.tsx의 firePointerEvent 패턴 확장)
 */
function firePointerEvent(
  el: Element,
  type: string,
  options: {
    clientX?: number
    clientY?: number
    pointerId?: number
    shiftKey?: boolean
  } = {},
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  if (options.clientX !== undefined)
    Object.defineProperty(e, 'clientX', { value: options.clientX, configurable: true })
  if (options.clientY !== undefined)
    Object.defineProperty(e, 'clientY', { value: options.clientY, configurable: true })
  if (options.pointerId !== undefined)
    Object.defineProperty(e, 'pointerId', { value: options.pointerId, configurable: true })
  if (options.shiftKey !== undefined)
    Object.defineProperty(e, 'shiftKey', { value: options.shiftKey, configurable: true })
  el.dispatchEvent(e)
}

describe('PianoRoll multi-select smoke', () => {
  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, tid, nA)
    p = addNote(p, tid, nB)
    s.setProject(p)
    act(() => {
      s.selectNote(nA.id)
    })
  })

  it('Shift+클릭으로 두 번째 노트를 추가 선택한다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElB = notes[1]!

    // Shift+pointerdown on note B — Object.defineProperty 패턴으로 shiftKey 주입
    act(() => {
      firePointerEvent(noteElB, 'pointerdown', { clientX: 200, clientY: 100, shiftKey: true })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(2)
  })

  it('선택된 두 노트를 Delete로 모두 삭제한다', () => {
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    act(() => {
      const e = new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' })
      grid.dispatchEvent(e)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes).toHaveLength(0)
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  it('Delete 키 시 선택 없으면 no-op', () => {
    act(() => {
      useStore.getState().clearNoteSelection()
    })
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    const before = useStore.getState().project

    act(() => {
      const e = new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' })
      grid.dispatchEvent(e)
    })

    expect(useStore.getState().project).toBe(before)
  })

  it('Shift+이미 선택된 노트 클릭 → 토글(제거)', () => {
    // A, B 모두 선택
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElA = notes[0]!

    // Shift+pointerdown on A → removes A
    act(() => {
      firePointerEvent(noteElA, 'pointerdown', { clientX: 10, clientY: 100, shiftKey: true })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).not.toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(1)
  })

  it('Shift+빈 그리드 드래그: box select 후 올바른 노트들이 선택된다', () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    // shiftKey=true → box select 시작
    act(() => {
      firePointerEvent(grid, 'pointerdown', { clientX: 0, clientY: 0, shiftKey: true })
      firePointerEvent(grid, 'pointermove', { clientX: 9999, clientY: 9999 })
      firePointerEvent(grid, 'pointerup', { clientX: 9999, clientY: 9999 })
    })

    const s = useStore.getState()
    // 두 노트 모두 선택됨
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
  })

  // ── Fix B 스모크: pointercancel → boxSel 오버레이 정리 ──────

  it('박스선택 시작 후 pointercancel 시 box-select-overlay가 정리된다 (Fix B 스모크)', () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(grid, 'pointerdown', { clientX: 0, clientY: 0, shiftKey: true })
      firePointerEvent(grid, 'pointermove', { clientX: 100, clientY: 100 })
    })

    expect(screen.queryByTestId('box-select-overlay')).not.toBeNull()

    act(() => {
      firePointerEvent(grid, 'pointercancel', { clientX: 100, clientY: 100 })
    })

    expect(screen.queryByTestId('box-select-overlay')).toBeNull()
  })

  // ── Fix C: 리사이즈 핸들 Shift+pointerdown → toggleNoteSelection ──

  it('리사이즈 핸들에서 Shift+pointerdown → toggleNoteSelection, selectNote 호출 없음 (Fix C)', () => {
    // [A, B] 선택 상태로 설정
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })

    // 노트 C 추가
    let noteCId: string
    act(() => {
      const s = useStore.getState()
      const nC = createNote({ pitch: 64, start: 960, duration: 480, velocity: 100 })
      noteCId = nC.id
      s.setProject(addNote(s.project, s.selectedTrackId, nC))
    })

    render(<PianoRoll />)
    const handles = screen.getAllByTestId('note-resize-handle')
    const handleC = handles[2]! // 세 번째 노트 C의 리사이즈 핸들

    // Shift+pointerdown on C's resize handle
    act(() => {
      firePointerEvent(handleC, 'pointerdown', { clientX: 200, clientY: 100, shiftKey: true })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toContain(noteAId) // A는 여전히 선택됨
    expect(s.selectedNoteIds).toContain(noteBId) // B는 여전히 선택됨
    expect(s.selectedNoteIds).toContain(noteCId!) // C가 추가됨
    expect(s.selectedNoteIds).toHaveLength(3)
  })

  // ── Fix D: 다중 Delete 후 _lastEditAt=0 ──────────────────────

  it('다중 Delete 후 _lastEditAt이 0이다 (Fix D)', () => {
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })

    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    act(() => {
      const e = new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' })
      grid.dispatchEvent(e)
    })

    // Fix D 이후: trailing endEdit() → _lastEditAt === 0
    expect(useStore.getState()._lastEditAt).toBe(0)
  })

  // ── Fix E: 0-트랙 프로젝트 빈 그리드 클릭 유령선택 방지 ────

  it('0-트랙 프로젝트에서 빈 그리드 클릭 시 유령 선택이 발생하지 않는다 (Fix E)', () => {
    act(() => {
      useStore.getState().replaceProject(createEmptyProject('Empty'))
    })

    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    const beforeProject = useStore.getState().project

    act(() => {
      firePointerEvent(grid, 'pointerdown', { clientX: 100, clientY: 100 })
    })

    // Fix E 이후: if (!track) return → selectedNoteIds 변경 없음
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().project).toBe(beforeProject)
  })

  it('일반(non-shift) 클릭으로 단일 선택 시 selectedNoteIds=[id]', () => {
    // A, B 모두 선택된 상태에서 일반 클릭 → 단일 선택
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElA = notes[0]!
    const grid = screen.getByTestId('pianoroll')

    // 일반 pointerdown (no shift) → selectNote(A)
    act(() => {
      firePointerEvent(noteElA, 'pointerdown', { clientX: 10, clientY: 100, shiftKey: false })
      firePointerEvent(grid, 'pointerup', { clientX: 10, clientY: 100 })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([noteAId])
    expect(s.selectedNoteId).toBe(noteAId)
  })
})
