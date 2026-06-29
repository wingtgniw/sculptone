import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../state/store'
import { AppShell } from '../shell/AppShell'

vi.mock('../audio/useAudio', () => ({ useAudio: () => ({ play: vi.fn(), stop: vi.fn(), getSeconds: () => 0 }) }))
const useAutosaveMock = vi.hoisted(() => vi.fn())
vi.mock('../io/useAutosave', () => ({ useAutosave: useAutosaveMock }))
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

describe('AppShell compose mode', () => {
  beforeEach(() => { useStore.setState({ activeMode: 'compose' }) })
  it('Compose 모드에서 피아노 롤과 트랙 패널, 재생 버튼이 보인다', () => {
    render(<AppShell />)
    expect(screen.getByTestId('pianoroll')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piano/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
  })
  it('Compose 모드 툴바에 FileMenu가 통합되어 보인다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export midi/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import midi/i })).toBeInTheDocument()
  })
  it('AppShell 마운트 시 useAutosave가 호출된다', () => {
    render(<AppShell />)
    expect(useAutosaveMock).toHaveBeenCalled()
  })
})
