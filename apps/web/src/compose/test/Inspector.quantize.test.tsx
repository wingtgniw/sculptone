import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { Inspector } from '../Inspector'

describe('Inspector Quantize button smoke', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('1개 선택 → Quantize 버튼 렌더', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeInTheDocument()
  })

  it('2개 선택 → Quantize 버튼 렌더', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    let p = addNote(s.project, s.selectedTrackId, n1)
    p = addNote(p, s.selectedTrackId, n2)
    s.setProject(p)
    s.setSelectedNoteIds([n1.id, n2.id])
    render(<Inspector />)
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeInTheDocument()
  })

  it('Quantize 버튼 클릭 → 선택 노트 start가 gridTicks 배수로 스냅된다', () => {
    // quantizeDenom=16(기본), ppq=480 → gridTicks = 480*4/16 = 120
    // start=130 → round(130/120)*120 = round(1.083)*120 = 1*120 = 120
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 130, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Quantize' }))
    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes.find((nn) => nn.id === n.id)!.start).toBe(120)
  })

  it('0개 선택 → Quantize 버튼 없음', () => {
    render(<Inspector />)
    expect(screen.queryByRole('button', { name: 'Quantize' })).toBeNull()
  })
})
