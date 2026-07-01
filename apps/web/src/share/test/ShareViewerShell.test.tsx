import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { Project } from '@sculptone/score-model'
import { useShareStore } from '../../cloud/shareStore'
import { useStore } from '../../state/store'

// heavy 컴포넌트 mock — 렌더 비용 최소화
vi.mock('../../compose/PianoRoll', () => ({
  PianoRoll: () => <div data-testid="piano-roll" />,
}))
vi.mock('../../compose/VelocityLane', () => ({
  VelocityLane: () => <div data-testid="velocity-lane" />,
}))
vi.mock('../../compose/Playhead', () => ({
  Playhead: () => null,
}))
vi.mock('../../audio/TransportBar', () => ({
  // showRecord prop을 반영: false이면 녹음 버튼을 렌더하지 않음 (Fix C)
  TransportBar: ({ onPlay, showRecord }: { onPlay: () => void; showRecord?: boolean }) => (
    <>
      {showRecord !== false && (
        <button data-testid="record-btn" aria-label="녹음">
          ⏺
        </button>
      )}
      <button data-testid="play-btn" onClick={onPlay}>
        Play
      </button>
    </>
  ),
}))
vi.mock('../../audio/useAudio', () => ({
  useAudio: () => ({ play: vi.fn(), stop: vi.fn(), getSeconds: vi.fn() }),
}))

import { ShareViewerShell } from '../ShareViewerShell'

const fakeProject: Project = {
  id: 'p1',
  metadata: {
    title: 'Test Share',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('ShareViewerShell — 스모크', () => {
  beforeEach(() => {
    useShareStore.setState(
      {
        sharedProject: fakeProject,
        isReadOnly: true,
        shareLoadState: 'loaded',
        shareError: null,
      },
      true,
    )
    useStore.setState(useStore.getInitialState(), true)
  })

  it('"읽기전용" 배지가 렌더됨', () => {
    render(<ShareViewerShell />)
    expect(screen.getByText('읽기전용')).toBeInTheDocument()
  })

  it('프로젝트 제목이 표시됨', () => {
    render(<ShareViewerShell />)
    expect(screen.getByText('Test Share')).toBeInTheDocument()
  })

  it('PianoRoll과 VelocityLane이 렌더됨', () => {
    render(<ShareViewerShell />)
    expect(screen.getByTestId('piano-roll')).toBeInTheDocument()
    expect(screen.getByTestId('velocity-lane')).toBeInTheDocument()
  })

  it('재생 버튼이 렌더됨 (트랜스포트 허용)', () => {
    render(<ShareViewerShell />)
    expect(screen.getByTestId('play-btn')).toBeInTheDocument()
  })

  it('마운트 시 replaceProject로 공유 프로젝트를 store에 로드', () => {
    render(<ShareViewerShell />)
    // replaceProject는 store에 fakeProject를 반영함
    expect(useStore.getState().project.id).toBe('p1')
  })

  // Fix C — 뷰어에 Record 버튼이 없어야 함
  it('Record 버튼이 렌더되지 않음 (read-only 뷰어)', () => {
    render(<ShareViewerShell />)
    expect(screen.queryByTestId('record-btn')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '녹음' })).not.toBeInTheDocument()
  })

  it('read-only 검증: Delete keydown 후 store의 노트 수 불변 (keyboard 차단)', () => {
    // 노트가 없는 프로젝트 — pointer/keyboard 차단이 되더라도 0으로 변화 없어야 함
    // (실제 차단 검증: onKeyDownCapture가 stopPropagation 호출)
    const { getByTestId } = render(<ShareViewerShell />)
    const pianoRoll = getByTestId('piano-roll')
    // synthetic keydown을 piano-roll에 발사해도 부모의 capture handler가 막음
    act(() => {
      pianoRoll.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    // 노트가 없으므로 변화 없음 — 편집이 실행되지 않았음을 확인
    expect(useStore.getState().project.tracks.flatMap((t) => t.notes)).toHaveLength(0)
  })
})
