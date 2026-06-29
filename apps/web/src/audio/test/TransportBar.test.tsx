import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { TransportBar } from '../TransportBar'

describe('TransportBar', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })
  it('재생 버튼 클릭 시 onPlay 호출 + isPlaying true', async () => {
    const onPlay = vi.fn()
    render(<TransportBar onPlay={onPlay} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '재생' }))
    expect(onPlay).toHaveBeenCalled()
    expect(useStore.getState().isPlaying).toBe(true)
  })
  it('정지 버튼 클릭 시 onStop 호출 + isPlaying false', async () => {
    const onStop = vi.fn()
    useStore.getState().setPlaying(true)
    render(<TransportBar onPlay={() => {}} onStop={onStop} />)
    await userEvent.click(screen.getByRole('button', { name: '정지' }))
    expect(onStop).toHaveBeenCalled()
    expect(useStore.getState().isPlaying).toBe(false)
  })
})
