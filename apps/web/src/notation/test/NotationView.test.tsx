import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

// ── VexFlow 전체 모킹 (jsdom에서 SVG layout 불가) ──────────────
// vi.mock 팩토리는 hoisting되므로 MockRenderer 등도 vi.hoisted()로 선언해야 TDZ 회피 가능

const { MockRenderer, MockStaveNote, MockDot, MockStaveTie, mockStaveTieInstance } = vi.hoisted(
  () => {
    const mockRendererInstance = {
      resize: vi.fn(),
      getContext: vi.fn().mockReturnValue({ setFont: vi.fn(), clear: vi.fn() }),
    }
    const MockRenderer = vi.fn().mockImplementation(() => mockRendererInstance)
    ;(MockRenderer as unknown as { Backends: { SVG: number } }).Backends = { SVG: 1 }

    const MockStaveNote = vi.fn().mockImplementation(() => ({}))

    const MockDot = { buildAndAttach: vi.fn() }

    const mockStaveTieInstance = {
      setContext: vi.fn().mockReturnThis(),
      draw: vi.fn(),
    }
    const MockStaveTie = vi.fn().mockImplementation(() => mockStaveTieInstance)

    return { MockRenderer, MockStaveNote, MockDot, MockStaveTie, mockStaveTieInstance }
  },
)

vi.mock('vexflow', () => ({
  Renderer: MockRenderer,
  Stave: vi.fn().mockImplementation(() => ({
    addClef: vi.fn().mockReturnThis(),
    addTimeSignature: vi.fn().mockReturnThis(),
    setContext: vi.fn().mockReturnThis(),
    draw: vi.fn(),
  })),
  Voice: vi.fn().mockImplementation(() => ({
    setStrict: vi.fn().mockReturnThis(),
    addTickables: vi.fn().mockReturnThis(),
    draw: vi.fn(),
  })),
  StaveNote: MockStaveNote,
  Formatter: vi.fn().mockImplementation(() => ({
    joinVoices: vi.fn().mockReturnThis(),
    format: vi.fn(),
  })),
  Dot: MockDot,
  StaveTie: MockStaveTie,
}))

import { NotationView } from '../NotationView'

// ── 테스트 ────────────────────────────────────────────────────

describe('NotationView', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('빈 트랙으로 크래시 없이 마운트되고 컨테이너가 렌더된다', () => {
    const { getByTestId } = render(<NotationView />)
    expect(getByTestId('notation-view')).toBeInTheDocument()
  })

  it('노트가 있는 트랙으로 크래시 없이 마운트된다', () => {
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    const { getByTestId } = render(<NotationView />)
    expect(getByTestId('notation-view')).toBeInTheDocument()
  })

  it('노트가 있는 트랙에서 VexFlow Renderer가 호출된다', () => {
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    render(<NotationView />)

    // useEffect는 동기적이므로 render 후 바로 확인 가능
    expect(MockRenderer).toHaveBeenCalled()
  })

  // H: dotted rest — Dot.buildAndAttach 스모크
  it('dotted rest 포함 트랙 렌더 시 Dot.buildAndAttach가 호출된다', () => {
    // ppq=480, 4/4: measure=1920 ticks
    // 노트 0(dur=480) + 노트 1200(dur=480) → gap 720 ticks = dotted-quarter rest (dots=1)
    const s = useStore.getState()
    let updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    updated = addNote(
      updated,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 1200, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    render(<NotationView />)

    expect(MockDot.buildAndAttach).toHaveBeenCalled()
  })

  // I: StaveTie 스모크
  it('타이 있는 두 마디 입력 시 StaveTie가 생성·draw된다', () => {
    // 노트 start=1800, dur=480: 마디 경계(1920)에서 분할 → tie='start'/'stop'
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 1800, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    render(<NotationView />)

    expect(MockStaveTie).toHaveBeenCalled()
    expect(mockStaveTieInstance.draw).toHaveBeenCalled()
  })

  // J: midiToOctave 규약 (MIDI 0 → 'c/-1', 현행 Math.max 클램프 제거 확인)
  it('MIDI 0 음표는 "c/-1" 키로 StaveNote를 생성한다 (midiToOctave 규약)', () => {
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 0, start: 0, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    render(<NotationView />)

    expect(MockStaveNote).toHaveBeenCalledWith(
      expect.objectContaining({ keys: expect.arrayContaining(['c/-1']) }),
    )
  })
})
