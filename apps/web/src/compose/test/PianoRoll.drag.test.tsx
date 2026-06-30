import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

/**
 * jsdom 제약 메모:
 * - getBoundingClientRect() 는 항상 { left:0, top:0, ... } 반환.
 *   따라서 clientX 자체가 롤 내 상대 좌표처럼 동작한다.
 * - jsdom 25에서 fireEvent.pointerDown({ clientX }) 가 clientX를 설정하지 못하는
 *   문제(read-only 속성)로 인해, Object.defineProperty로 직접 설정하는 헬퍼를 사용한다.
 * - setPointerCapture 는 미구현 → try/catch로 무시.
 * - pointermove/pointerup 은 컨테이너 div에 직접 발사해 핸들러 경로 검증.
 * - 정확한 수치(start 값 등)는 drag.ts 순수 함수 테스트가 보장.
 *   스모크는 "드래그 후 값이 변화하는가" 여부만 검증한다.
 */

/** jsdom 25 우회: PointerEvent 생성자가 clientX를 지원하지 않으므로 defineProperty로 주입. */
function firePointerEvent(
  el: Element,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperty(e, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(e, 'clientY', { value: clientY, configurable: true })
  Object.defineProperty(e, 'pointerId', { value: pointerId, configurable: true })
  el.dispatchEvent(e)
}

describe('PianoRoll drag smoke', () => {
  let noteId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const note = createNote({ pitch: 60, start: 240, duration: 480, velocity: 100 })
    noteId = note.id
    s.setProject(addNote(s.project, tid, note))
    s.selectNote(note.id)
  })

  it('노트 본체를 threshold 초과 드래그하면 start가 증가한다', () => {
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // pointerdown → pointermove(dx=50, > threshold=3) → pointerup
    act(() => {
      firePointerEvent(noteEl, 'pointerdown', 100, 200)
      firePointerEvent(container, 'pointermove', 150, 200)
      firePointerEvent(container, 'pointerup', 150, 200)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // dx=50px > 3px → 드래그 발생; pxToTicks(50, 480)=500tick → snap(740,120)=720 > 240
    expect(track.notes[0]!.start).toBeGreaterThan(240)
  })

  it('리사이즈 핸들을 threshold 초과 드래그하면 duration이 증가한다', () => {
    render(<PianoRoll />)
    const handle = screen.getByTestId('note-resize-handle')
    const container = screen.getByTestId('pianoroll')

    // dx=48px = 1박 → pxToTicks(48,480)=480tick → snap(960,120)=960 > 480
    act(() => {
      firePointerEvent(handle, 'pointerdown', 100, 200)
      firePointerEvent(container, 'pointermove', 148, 200)
      firePointerEvent(container, 'pointerup', 148, 200)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes[0]!.duration).toBeGreaterThan(480)
  })

  it('3px 미만 이동(클릭)이면 드래그 없이 노트만 선택된다', () => {
    // 선택을 먼저 비운다
    act(() => {
      useStore.getState().selectNote(null)
    })
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // dx=1px < threshold=3px → moved=false → selectNote 호출
    act(() => {
      firePointerEvent(noteEl, 'pointerdown', 100, 200)
      firePointerEvent(container, 'pointermove', 101, 200)
      firePointerEvent(container, 'pointerup', 101, 200)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // 선택됨
    expect(useStore.getState().selectedNoteId).toBe(noteId)
    // start는 변경되지 않음
    expect(track.notes[0]!.start).toBe(240)
  })

  it('노트 위 pointerdown은 컨테이너 노트 생성을 트리거하지 않는다', () => {
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')

    // note 위에서 pointerdown → stopPropagation → 컨테이너 handleGridPointerDown 실행 안 됨
    act(() => {
      firePointerEvent(noteEl, 'pointerdown', 100, 200)
      firePointerEvent(noteEl, 'pointerup', 100, 200)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // 기존 1개 노트만 존재 (새 노트 생성 없음)
    expect(track.notes).toHaveLength(1)
  })

  // ── Fix #1 회귀: 드래그 시 pointerdown에서 즉시 선택 ────────────────

  it('노트 A 선택 상태에서 B를 드래그하면 selectedNoteId가 B로 바뀐다 (Fix #1)', () => {
    // 두 번째 노트 B 추가
    let noteBId: string
    act(() => {
      const s = useStore.getState()
      const tid = s.selectedTrackId
      const noteB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
      noteBId = noteB.id
      s.setProject(addNote(s.project, tid, noteB))
    })

    render(<PianoRoll />)
    // beforeEach에서 A(noteId)가 이미 선택됨
    expect(useStore.getState().selectedNoteId).toBe(noteId)

    // notes[0] = A(start=240), notes[1] = B(start=480) (addNote 순서)
    const notes = screen.getAllByTestId('note')
    const noteElB = notes[1]!
    const container = screen.getByTestId('pianoroll')

    // B를 threshold 초과 드래그
    act(() => {
      firePointerEvent(noteElB, 'pointerdown', 200, 200)
      firePointerEvent(container, 'pointermove', 250, 200)
      firePointerEvent(container, 'pointerup', 250, 200)
    })

    // pointerdown에서 선택이 B로 전환되어야 한다
    expect(useStore.getState().selectedNoteId).toBe(noteBId!)
  })

  // ── Fix #2 회귀: 좁은 노트에서 핸들 폭이 w/2 이하인지 ───────────────

  it('좁은 노트(1/32)에서 리사이즈 핸들 폭이 노트 폭의 절반 이하다 (Fix #2)', () => {
    // 스토어 재초기화 후 좁은 노트 추가
    act(() => {
      useStore.setState(useStore.getInitialState(), true)
      const s = useStore.getState()
      const tid = s.selectedTrackId
      // duration=60 ticks, ppq=480 → width = 60 * (48/480) = 6px; Math.max(4,6)=6px
      // 핸들: Math.min(6, 6/2) = Math.min(6, 3) = 3px  (고정 6px이면 실패)
      const narrowNote = createNote({ pitch: 60, start: 0, duration: 60, velocity: 100 })
      s.setProject(addNote(s.project, tid, narrowNote))
    })

    render(<PianoRoll />)
    const handle = screen.getByTestId('note-resize-handle') as HTMLElement
    const noteEl = screen.getByTestId('note') as HTMLElement

    const noteWidth = parseFloat(noteEl.style.width)
    const handleWidth = parseFloat(handle.style.width)

    expect(handleWidth).toBeLessThanOrEqual(noteWidth / 2)
    // 클램프가 실제로 적용됐는지 확인 (unclamped 6px보다 작아야 함)
    expect(handleWidth).toBeLessThan(6)
  })

  // ── Fix #3 회귀: endEdit으로 생성↔드래그가 별도 undo 스텝이 됨 ──────

  it('생성 후 즉시 드래그해도 undo 1회가 드래그만 되돌리고 노트는 남는다 (Fix #3)', () => {
    // beforeEach에서 노트가 추가된 후 _lastEditAt > 0.
    // 실제 그리드 클릭의 pointerup → endEdit()이 경계를 닫는 것을 시뮬레이션.
    act(() => {
      useStore.getState().endEdit()
    })

    const beforePastLen = useStore.getState().history.past.length

    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // threshold를 넘는 드래그
    act(() => {
      firePointerEvent(noteEl, 'pointerdown', 100, 200)
      firePointerEvent(container, 'pointermove', 150, 200)
      firePointerEvent(container, 'pointerup', 150, 200)
    })

    // 드래그가 별도 undo 스텝이어야 한다
    expect(useStore.getState().history.past.length).toBe(beforePastLen + 1)

    // undo 1회: 이동만 취소, 노트는 여전히 존재
    act(() => {
      useStore.getState().undo()
    })

    const tid = useStore.getState().selectedTrackId
    const notes = useStore.getState().project.tracks.find((t) => t.id === tid)!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(240) // 원래 위치로 복구
  })

  // ── Fix #6 스모크: 수직 드래그로 pitch가 변한다 ─────────────────────

  it('수직 드래그(dy=2레인, clientX 고정)로 노트 pitch가 감소한다 (Fix #6)', () => {
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    const initialPitch = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!.notes[0]!.pitch // 60 (beforeEach에서 설정)

    // dy=48px (laneHeight=24 × 2레인) 아래로 이동, clientX 고정
    // pxToSemitones(48, 24) = -2 → pitch = 60 - 2 = 58
    act(() => {
      firePointerEvent(noteEl, 'pointerdown', 100, 200)
      firePointerEvent(container, 'pointermove', 100, 248) // clientX=100 고정, clientY +48
      firePointerEvent(container, 'pointerup', 100, 248)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes[0]!.pitch).toBeLessThan(initialPitch)
  })
})
