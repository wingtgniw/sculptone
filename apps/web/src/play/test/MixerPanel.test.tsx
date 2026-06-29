import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { MixerPanel } from '../MixerPanel'
import { createTrack, addTrack } from '@sculptone/score-model'

describe('MixerPanel', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('각 트랙의 이름과 볼륨 슬라이더가 렌더된다', () => {
    render(<MixerPanel />)
    // 초기: Piano 트랙 1개
    expect(screen.getByText('Piano')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /piano volume/i })).toBeInTheDocument()
  })

  it('볼륨 슬라이더 변경 시 updateTrackMixer가 적용된다', () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const slider = screen.getByRole('slider', { name: /piano volume/i })
    // range input은 fireEvent.change로 직접 값 변경 (userEvent pointer 대신)
    fireEvent.change(slider, { target: { value: '0.5' } })
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.volume).toBeCloseTo(0.5)
  })

  it('Mute 버튼 클릭 시 muted가 토글된다', async () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const muteBtn = screen.getByRole('button', { name: /piano mute/i })
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(muteBtn)
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.muted).toBe(true)
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('Solo 버튼 클릭 시 soloed가 토글된다', async () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const soloBtn = screen.getByRole('button', { name: /piano solo/i })
    await userEvent.click(soloBtn)
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.soloed).toBe(true)
  })

  it('여러 트랙이 있으면 모두 렌더된다', () => {
    const s = useStore.getState()
    const t2 = createTrack('Bass')
    s.setProject(addTrack(s.project, t2))
    render(<MixerPanel />)
    expect(screen.getByText('Piano')).toBeInTheDocument()
    expect(screen.getByText('Bass')).toBeInTheDocument()
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })
})
