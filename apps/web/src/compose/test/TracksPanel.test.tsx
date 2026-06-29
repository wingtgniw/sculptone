import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { TracksPanel } from '../TracksPanel'

describe('TracksPanel', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('트랙 목록을 렌더하고 현재 트랙을 aria-current로 표시', () => {
    render(<TracksPanel />)
    const row = screen.getByRole('button', { name: /Piano/ })
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('+ Add Track 버튼이 있고 클릭 시 트랙이 추가된다', async () => {
    render(<TracksPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    expect(s.project.tracks).toHaveLength(2)
    // 새 트랙이 선택된다
    expect(s.selectedTrackId).toBe(s.project.tracks[1]!.id)
  })

  it('신규 트랙 이름은 "Track N" 형식이다', async () => {
    render(<TracksPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    expect(s.project.tracks[1]!.name).toBe('Track 2')
  })

  it('트랙이 1개일 때 삭제 버튼은 비활성(disabled)', () => {
    render(<TracksPanel />)
    // 삭제 버튼은 aria-label="트랙 삭제" 또는 "delete track"
    const del = screen.getByRole('button', { name: /delete track/i })
    expect(del).toBeDisabled()
  })

  it('트랙이 2개일 때 삭제 버튼 클릭 시 선택된 트랙이 삭제된다', async () => {
    render(<TracksPanel />)
    // 트랙 추가
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    const secondTrackId = s.project.tracks[1]!.id
    // 두 번째 트랙 선택
    await userEvent.click(screen.getByRole('button', { name: /Track 2/ }))
    // 삭제
    await userEvent.click(screen.getByRole('button', { name: /delete track/i }))
    const s2 = useStore.getState()
    expect(s2.project.tracks).toHaveLength(1)
    expect(s2.project.tracks.find((t) => t.id === secondTrackId)).toBeUndefined()
    // selectedTrackId가 첫 트랙으로 재선택됨
    expect(s2.selectedTrackId).toBe(s2.project.tracks[0]!.id)
  })

  it('트랙 삭제 후 다시 추가해도 이름이 중복되지 않는다', async () => {
    render(<TracksPanel />)
    const add = () => userEvent.click(screen.getByRole('button', { name: /add track/i }))
    // Track 2, Track 3 추가 (각 추가 시 새 트랙이 선택됨)
    await add() // -> Track 2
    await add() // -> Track 3
    // 중간 트랙(Track 2)을 선택 후 삭제
    await userEvent.click(screen.getByRole('button', { name: /Track 2/ }))
    await userEvent.click(screen.getByRole('button', { name: /delete track/i }))
    // 다시 추가 — 구버그(length+1)라면 Track 3 중복 발생
    await add()
    const names = useStore.getState().project.tracks.map((t) => t.name)
    // 마지막 추가 트랙은 Track 4여야 하고 전체 이름이 유일해야 함
    expect(names[names.length - 1]).toBe('Track 4')
    expect(new Set(names).size).toBe(names.length)
  })

  it('프리셋 드롭다운에서 변경 시 해당 트랙의 sound가 갱신된다', async () => {
    render(<TracksPanel />)
    const trackId = useStore.getState().selectedTrackId
    const select = screen.getByRole('combobox', { name: /preset/i })
    await userEvent.selectOptions(select, 'synth-lead')
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.sound).toEqual({ kind: 'preset', presetId: 'synth-lead' })
  })
})
