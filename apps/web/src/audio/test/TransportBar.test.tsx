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

  it('녹음 버튼이 렌더된다 (aria-label="녹음")', () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByRole('button', { name: '녹음' })).toBeInTheDocument()
  })

  it('녹음 버튼 클릭 시 isRecording이 true가 된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    expect(useStore.getState().isRecording).toBe(true)
  })

  it('두 번 클릭 시 isRecording이 false로 토글된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('isRecording=true 시 REC 배지가 표시된다', () => {
    useStore.getState().setRecording(true)
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByText('REC')).toBeInTheDocument()
  })
})
