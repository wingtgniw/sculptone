import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

/**
 * jsdom 25: PointerEvent.clientX / shiftKey 는 read-only.
 * Object.defineProperty로 주입. (PianoRoll.multiselect.test.tsx 패턴 재사용)
 */
function firePointerEvent(
  el: Element,
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number; shiftKey?: boolean } = {},
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  if (opts.clientX !== undefined)
    Object.defineProperty(e, 'clientX', { value: opts.clientX, configurable: true })
  if (opts.clientY !== undefined)
    Object.defineProperty(e, 'clientY', { value: opts.clientY, configurable: true })
  if (opts.pointerId !== undefined)
    Object.defineProperty(e, 'pointerId', { value: opts.pointerId, configurable: true })
  if (opts.shiftKey !== undefined)
    Object.defineProperty(e, 'shiftKey', { value: opts.shiftKey, configurable: true })
  el.dispatchEvent(e)
}

describe('PianoRoll group-move smoke', () => {
  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    // nA: start=0, pitch=60 / nB: start=480, pitch=62
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, tid, nA)
    p = addNote(p, tid, nB)
    s.setProject(p)
    // 두 노트 모두 선택 (group-move 조건)
    act(() => {
      s.setSelectedNoteIds([nA.id, nB.id])
    })
  })

  // ── 핵심: 두 노트 동시 이동 ─────────────────────────────────

  it('group-move: threshold 초과 드래그 시 두 노트 모두 start가 증가한다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // nA를 잡고 오른쪽으로 dx=100px 드래그
    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const nA = track.notes.find((n) => n.id === noteAId)!
    const nB = track.notes.find((n) => n.id === noteBId)!

    // 두 노트 모두 오른쪽으로 이동
    expect(nA.start).toBeGreaterThan(0)
    expect(nB.start).toBeGreaterThan(480)
    // 상대 오프셋 보존: nB.start - nA.start == 480
    expect(nB.start - nA.start).toBe(480)
  })

  // ── 누적 없음 (절대 계산 검증) ──────────────────────────────

  it('group-move: 같은 clientX에서 두 번째 move는 첫 번째와 동일 결과 (누적 없음)', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
    })
    const startAfterFirstMove = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.start

    act(() => {
      // 같은 clientX=110에서 한 번 더 move
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const startAfterSecondMove = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.start

    // 누적이 없으면 두 move의 결과가 동일해야 함
    expect(startAfterSecondMove).toBe(startAfterFirstMove)
  })

  // ── 드래그 후 다중 선택 유지 ────────────────────────────────

  it('group-move 완료 후 selectedNoteIds가 유지된다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(2)
  })

  // ── 클릭(threshold 미만)은 단일 선택으로 전환 ───────────────

  it('group-move click (threshold 미만): 클릭 노트로 단일 선택 전환', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 11, clientY: 200 }) // dx=1 < threshold=3
      firePointerEvent(container, 'pointerup', { clientX: 11, clientY: 200 })
    })

    const s = useStore.getState()
    // moved=false → selectNote(noteAId) → 단일 선택
    expect(s.selectedNoteId).toBe(noteAId)
    expect(s.selectedNoteIds).toEqual([noteAId])
  })

  // ── Fix 1 회귀: 드래그 중 Delete 키는 노트를 삭제하지 않음 ─────

  it('group-move 드래그 중 Delete 키는 노트를 삭제하지 않는다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      // threshold 초과 드래그 시작 (dragRef.current 설정됨)
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      // 드래그 중 Delete 디스패치 — 무시되어야 함
      fireEvent.keyDown(container, { key: 'Delete' })
      // 드래그 종료
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    // dragRef.current 가드로 인해 노트 2개 모두 유지되어야 한다
    expect(track.notes).toHaveLength(2)
  })

  it('드래그 없이 Delete 키는 선택 노트를 모두 삭제한다 (기존 동작 회귀)', () => {
    render(<PianoRoll />)
    const container = screen.getByTestId('pianoroll')

    act(() => {
      fireEvent.keyDown(container, { key: 'Delete' })
    })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    // 드래그 없이 Delete → 선택된 노트 2개 모두 삭제
    expect(track.notes).toHaveLength(0)
  })

  // ── Fix 3 회귀: pointercancel 후 endEdit 호출 확인 ──────────────

  it('group-move 후 pointercancel 시 _lastEditAt이 0으로 리셋된다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      // 드래그 시작 + threshold 초과 → setProject 호출 → _lastEditAt > 0
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      // pointercancel → handleDragRelease (endEdit 없으면 _lastEditAt > 0 유지됨)
      firePointerEvent(container, 'pointercancel', { clientX: 110, clientY: 200 })
    })

    // handleDragRelease가 endEdit()을 호출해야 _lastEditAt === 0
    expect(useStore.getState()._lastEditAt).toBe(0)
  })

  // ── 미선택 노트 드래그 → 기존 단일 경로 (회귀) ──────────────

  it('미선택 노트 드래그: 기존 단일 이동 경로, A·B는 그대로', () => {
    let noteCId: string
    act(() => {
      const s = useStore.getState()
      const nC = createNote({ pitch: 64, start: 960, duration: 480, velocity: 100 })
      noteCId = nC.id
      s.setProject(addNote(s.project, s.selectedTrackId, nC))
      // A, B는 선택 유지, C는 미선택
    })

    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')
    // notes[2] = nC (추가 순서 기준)
    const noteElC = notes[2]!

    act(() => {
      firePointerEvent(noteElC, 'pointerdown', { clientX: 100, clientY: 100 })
      firePointerEvent(container, 'pointermove', { clientX: 200, clientY: 100 })
      firePointerEvent(container, 'pointerup', { clientX: 200, clientY: 100 })
    })

    // C가 단일 선택됨 (A, B 선택 해제)
    const s = useStore.getState()
    expect(s.selectedNoteId).toBe(noteCId!)
    expect(s.selectedNoteIds).toEqual([noteCId!])

    // A, B는 이동하지 않음
    const tid = s.selectedTrackId
    const track = s.project.tracks.find((t) => t.id === tid)!
    expect(track.notes.find((n) => n.id === noteAId)!.start).toBe(0)
    expect(track.notes.find((n) => n.id === noteBId)!.start).toBe(480)
  })
})
