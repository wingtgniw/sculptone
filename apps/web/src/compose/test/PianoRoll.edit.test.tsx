import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { PianoRoll } from '../PianoRoll'

describe('PianoRoll editing', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('빈 그리드 클릭 시 현재 트랙에 노트가 생성된다', async () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    await userEvent.pointer({ target: grid, coords: { clientX: 0, clientY: 0 } as any, keys: '[MouseLeft]' })
    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes.length).toBeGreaterThanOrEqual(1)
  })

  it('노트 클릭 시 해당 노트가 선택된다', async () => {
    // 먼저 노트 하나 만들기
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    await userEvent.pointer({ target: grid, coords: { clientX: 10, clientY: 10 } as any, keys: '[MouseLeft]' })
    const tid = useStore.getState().selectedTrackId
    const created = useStore.getState().project.tracks.find((t) => t.id === tid)!.notes[0]!
    // 선택을 비운 뒤 클릭해야 클릭이 실제로 선택을 갱신하는지 검증할 수 있다
    act(() => { useStore.getState().selectNote(null) })
    expect(useStore.getState().selectedNoteId).toBeNull()
    const note = screen.getAllByTestId('note')[0]!
    await userEvent.click(note)
    expect(useStore.getState().selectedNoteId).toBe(created.id)
  })

  it('Delete 키로 선택된 노트를 삭제한다', async () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    await userEvent.pointer({ target: grid, coords: { clientX: 10, clientY: 10 } as any, keys: '[MouseLeft]' })
    const tid = useStore.getState().selectedTrackId
    expect(useStore.getState().project.tracks.find((t) => t.id === tid)!.notes.length).toBe(1)
    expect(useStore.getState().selectedNoteId).not.toBeNull()

    fireEvent.keyDown(grid, { key: 'Delete' })

    expect(useStore.getState().project.tracks.find((t) => t.id === tid)!.notes.length).toBe(0)
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  it('선택된 노트가 없으면 삭제 키가 프로젝트를 변경하지 않는다', () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    act(() => { useStore.getState().selectNote(null) })
    const before = useStore.getState().project

    fireEvent.keyDown(grid, { key: 'Backspace' })

    expect(useStore.getState().project).toBe(before)
  })
})
