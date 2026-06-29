import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../shell/AppShell'
import { useStore } from '../state/store'

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
})
