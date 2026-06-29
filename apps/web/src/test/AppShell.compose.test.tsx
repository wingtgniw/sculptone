import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../state/store'
import { AppShell } from '../shell/AppShell'

vi.mock('../audio/useAudio', () => ({ useAudio: () => ({ play: vi.fn(), stop: vi.fn(), getSeconds: () => 0 }) }))

describe('AppShell compose mode', () => {
  beforeEach(() => { useStore.setState({ activeMode: 'compose' }) })
  it('Compose 모드에서 피아노 롤과 트랙 패널, 재생 버튼이 보인다', () => {
    render(<AppShell />)
    expect(screen.getByTestId('pianoroll')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piano/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
  })
})
