import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../shell/AppShell'
import { useStore } from '../state/store'

describe('AppShell', () => {
  beforeEach(() => {
    useStore.setState({ activeMode: 'compose' })
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
})
