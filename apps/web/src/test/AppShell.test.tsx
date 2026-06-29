import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../shell/AppShell'
import { useStore } from '../state/store'
import { SoundDesignPanel } from '../sound/SoundDesignPanel'

vi.mock('../audio/useAudio', () => ({ useAudio: () => ({ play: () => {}, stop: () => {}, getSeconds: () => 0 }) }))
vi.mock('../io/useAutosave', () => ({ useAutosave: () => {} }))
vi.mock('../midi/useMidi', () => ({
  useMidi: () => ({
    devices: [],
    selectedDeviceId: null,
    selectDevice: () => {},
    isSupported: true,
    accessError: null,
  }),
}))
vi.mock('../midi/useRecording', () => ({
  useRecording: () => ({ handleMidiMessage: () => {} }),
}))
vi.mock('../notation/NotationView', () => ({
  NotationView: () => <div data-testid="notation-view" />,
}))
vi.mock('../sound/SoundDesignPanel', () => ({
  SoundDesignPanel: vi.fn(() => null),
}))

describe('AppShell', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('세 모드 탭을 렌더한다', () => {
    render(<AppShell />)
    expect(screen.getByRole('tab', { name: 'Compose' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Transcribe' })).toBeInTheDocument()
  })

  it('Play 탭 클릭 시 스토어 모드가 바뀐다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
    expect(useStore.getState().activeMode).toBe('play')
  })

  it('Transcribe 탭은 비활성이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('tab', { name: 'Transcribe' })).toBeDisabled()
  })

  it('Play 탭으로 전환 시 MixerPanel이 렌더된다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
    // MixerPanel은 "Mixer" 헤더 텍스트를 렌더함
    expect(screen.getByText(/mixer/i)).toBeInTheDocument()
  })

  it('Compose 모드 툴바에 Roll/Score 토글 버튼이 렌더된다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: 'Roll' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Score' })).toBeInTheDocument()
  })

  it('Score 버튼 클릭 시 NotationView가 렌더된다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('button', { name: 'Score' }))
    expect(screen.getByTestId('notation-view')).toBeInTheDocument()
  })

  it('Score 후 Roll 버튼 클릭 시 PianoRoll로 돌아온다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('button', { name: 'Score' }))
    await userEvent.click(screen.getByRole('button', { name: 'Roll' }))
    expect(screen.getByTestId('pianoroll')).toBeInTheDocument()
  })

  it('SoundDesignPanel이 AppShell과 함께 마운트된다', () => {
    render(<AppShell />)
    expect(vi.mocked(SoundDesignPanel)).toHaveBeenCalled()
  })

  it('Undo 버튼이 렌더되며 히스토리가 없을 때 disabled이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  })

  it('Redo 버튼이 렌더되며 히스토리가 없을 때 disabled이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeDisabled()
  })

  it('setProject 후 Undo 버튼이 활성화된다', () => {
    render(<AppShell />)
    act(() => {
      const s = useStore.getState()
      s.setProject({ ...s.project })
    })
    expect(screen.getByRole('button', { name: '실행 취소' })).not.toBeDisabled()
  })

  it('Ctrl+Z 키보드 단축키로 undo가 실행된다', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    // undo 가능 상태 확인
    expect(useStore.getState().history.past.length).toBe(1)
    // Ctrl+Z 발사
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(useStore.getState().project).toBe(originalProject)
  })

  it('input 포커스 시 Ctrl+Z는 undo를 실행하지 않는다(텍스트 편집 우선)', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    // DOM에 input 추가 후 포커스
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, bubbles: true })
    // undo 실행 안 됨 — project 변경 없음
    expect(useStore.getState().history.past.length).toBe(1)
    document.body.removeChild(input)
  })

  // Fix #4: textarea 포커스 가드
  it('textarea 포커스 시 Ctrl+Z는 undo를 실행하지 않는다(텍스트 편집 우선)', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true, bubbles: true })
    // undo 실행 안 됨
    expect(useStore.getState().history.past.length).toBe(1)
    document.body.removeChild(textarea)
  })

  // Fix #2: Ctrl+Shift+Z 대문자 'Z'로 redo 실행
  it('Ctrl+Shift+Z(대문자 Z) 키보드 단축키로 redo가 실행된다', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    act(() => {
      useStore.getState().undo()
    })
    // redo 가능 상태 확인
    expect(useStore.getState().history.future.length).toBe(1)
    // Ctrl+Shift+Z 발사 (Shift가 눌리면 key='Z' 대문자)
    fireEvent.keyDown(document.body, { key: 'Z', shiftKey: true, ctrlKey: true })
    expect(useStore.getState().history.future.length).toBe(0)
  })

  // Fix #5: Undo/Redo 버튼 onClick 배선 테스트
  it('setProject 후 실행 취소 버튼 클릭 시 project가 원복된다', async () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    expect(useStore.getState().history.past.length).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    expect(useStore.getState().project).toBe(originalProject)
  })

  it('undo 후 다시 실행 버튼 클릭 시 project가 재적용된다', async () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    const modifiedProject = { ...originalProject }
    act(() => {
      useStore.getState().setProject(modifiedProject)
    })
    act(() => {
      useStore.getState().undo()
    })
    expect(useStore.getState().project).toBe(originalProject)

    await userEvent.click(screen.getByRole('button', { name: '다시 실행' }))
    expect(useStore.getState().project).toBe(modifiedProject)
  })
})
