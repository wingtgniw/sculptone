import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

describe('PianoRoll', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    s.setProject(addNote(s.project, tid, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })))
  })
  it('현재 트랙의 노트를 data-note 요소로 렌더한다', () => {
    render(<PianoRoll />)
    expect(screen.getAllByTestId('note')).toHaveLength(1)
  })
  it('노트 위치가 geometry 계산과 일치한다(start0,pitch60)', () => {
    render(<PianoRoll />)
    const el = screen.getByTestId('note') as HTMLElement
    expect(el.style.left).toBe('0px')
    // pitch 60, PITCH_HIGH 84 → y=(84-60)*24=576
    expect(el.style.top).toBe('576px')
  })
})
