import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { Inspector } from '../Inspector'

describe('Inspector multi-select', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('0개 선택 → "노트를 선택하세요" 표시', () => {
    render(<Inspector />)
    expect(screen.getByText('노트를 선택하세요')).toBeInTheDocument()
  })

  it('2개 선택 → "2개 노트 선택됨" 표시', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    let p = addNote(s.project, s.selectedTrackId, n1)
    p = addNote(p, s.selectedTrackId, n2)
    s.setProject(p)
    s.setSelectedNoteIds([n1.id, n2.id])
    render(<Inspector />)
    expect(screen.getByText('2개 노트 선택됨')).toBeInTheDocument()
  })

  it('1개 선택 → 단일 노트 velocity 슬라이더 표시', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })
})
