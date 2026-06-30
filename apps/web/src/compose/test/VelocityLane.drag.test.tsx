import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { VelocityLane } from '../VelocityLane'

/**
 * jsdom 25: PointerEvent.clientY は read-only.
 * Object.defineProperty로 주입. (PianoRoll.drag.test.tsx 헬퍼 재사용 패턴)
 */
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

describe('VelocityLane drag smoke', () => {
  let noteAId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const nA = createNote({ pitch: 60, start: 240, duration: 480, velocity: 64 })
    noteAId = nA.id
    s.setProject(addNote(s.project, tid, nA))
    act(() => {
      s.selectNote(nA.id)
    })
  })

  // ── 단일 드래그 ───────────────────────────────────────────

  it('위로 드래그(dy<0)하면 velocity가 증가한다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    // pointerdown on bar, pointermove up (-40px), pointerup
    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    expect(vel).toBeGreaterThan(64)
  })

  it('아래로 드래그(dy>0)하면 velocity가 감소한다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 240) // dy=+40
      firePointerEvent(lane, 'pointerup', 50, 240)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    expect(vel).toBeLessThan(64)
  })

  it('같은 clientY로 두 번째 move는 첫 번째와 동일 결과 (origVelocity 스냅샷, 누적 없음)', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40
    })
    const velAfterFirst = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity

    act(() => {
      firePointerEvent(lane, 'pointermove', 50, 160) // 동일 clientY
      firePointerEvent(lane, 'pointerup', 50, 160)
    })
    const velAfterSecond = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity

    // 누적 없으면 동일
    expect(velAfterSecond).toBe(velAfterFirst)
  })

  // ── 다중 선택 드래그 ──────────────────────────────────────

  it('다중 선택 드래그: 잡은 노트가 선택 집합에 포함 → 두 노트 모두 velocity 변경', () => {
    let noteBId: string
    act(() => {
      const s = useStore.getState()
      const nB = createNote({ pitch: 62, start: 720, duration: 480, velocity: 80 })
      noteBId = nB.id
      s.setProject(addNote(s.project, s.selectedTrackId, nB))
      s.setSelectedNoteIds([noteAId, nB.id])
    })

    render(<VelocityLane />)
    const bars = screen.getAllByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    // bars[0] = nA (start=240)
    act(() => {
      firePointerEvent(bars[0]!, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40 → increase
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const s = useStore.getState()
    const tid = s.selectedTrackId
    const track = s.project.tracks.find((t) => t.id === tid)!
    const velA = track.notes.find((n) => n.id === noteAId)!.velocity
    const velB = track.notes.find((n) => n.id === noteBId)!.velocity

    // 두 노트 모두 증가
    expect(velA).toBeGreaterThan(64)
    expect(velB).toBeGreaterThan(80)
  })

  // ── pointercancel → dragVelRef 초기화 ────────────────────

  it('pointercancel 후 이후 pointermove가 velocity를 변경하지 않는다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointercancel', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 100) // drag ref가 없으므로 무시
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // velocity 변경 없음 (64 유지)
    expect(track.notes.find((n) => n.id === noteAId)!.velocity).toBe(64)
  })

  // ── Fix: dy=0 가드 → velocity 불변 + 불필요한 undo 스텝 미생성 ──────────

  it('dy=0 pointermove(순수 수평)는 velocity를 변경하지 않고 undo 스텝을 생성하지 않는다', () => {
    // _lastEditAt=0인 상태(가장 취약한 케이스: coalesce 없이 첫 record)
    act(() => {
      useStore.getState().endEdit()
    })
    const pastLenBefore = useStore.getState().history.past.length

    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    // pointerdown → pointermove(clientX만 변경, clientY 동일=dy=0) → pointerup
    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 100, 200) // dy=0
      firePointerEvent(lane, 'pointerup', 100, 200)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    // velocity 불변
    expect(vel).toBe(64)
    // 불필요한 undo 스텝 미생성
    expect(useStore.getState().history.past.length).toBe(pastLenBefore)
  })

  it('dy≠0 pointermove는 기존대로 velocity 변경 + undo 스텝을 생성한다 (dy=0 가드 회귀)', () => {
    act(() => {
      useStore.getState().endEdit()
    })
    const pastLenBefore = useStore.getState().history.past.length

    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    // velocity 증가
    expect(vel).toBeGreaterThan(64)
    // undo 스텝 생성됨
    expect(useStore.getState().history.past.length).toBeGreaterThan(pastLenBefore)
  })

  // ── Fix 3: isDragging 플래그 set/clear 검증 ────────────────────────────

  it('velocity bar pointerdown 시 isDragging=true, pointerup 후 isDragging=false (reset 보장)', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
    })
    expect(useStore.getState().isDragging).toBe(true)

    act(() => {
      firePointerEvent(lane, 'pointerup', 50, 200)
    })
    expect(useStore.getState().isDragging).toBe(false)
  })

  it('VelocityLane pointercancel 시 isDragging=false로 리셋된다 (stuck 방지)', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
    })
    expect(useStore.getState().isDragging).toBe(true)

    act(() => {
      firePointerEvent(lane, 'pointercancel', 50, 200)
    })
    expect(useStore.getState().isDragging).toBe(false)
  })

  // ── endEdit 호출: undo 스텝 생성 ─────────────────────────

  it('pointerup 후 undo를 호출하면 velocity가 원래 값으로 복구된다', () => {
    // endEdit()이 올바르게 호출됐는지는 undo 동작으로 검증
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      useStore.getState().endEdit() // 직전 스텝 경계 닫기
    })

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // velocity 증가
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const velAfterDrag = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity
    expect(velAfterDrag).toBeGreaterThan(64)

    act(() => {
      useStore.getState().undo()
    })

    const velAfterUndo = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity
    expect(velAfterUndo).toBe(64)
  })
})
