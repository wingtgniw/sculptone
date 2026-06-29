import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'

// Tone 전체 모킹
let mockSeconds = 0
const mockTransport = {
  bpm: { value: 120 },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  scheduleOnce: vi.fn(),
  get seconds() { return mockSeconds },
}
vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: () => mockTransport,
  Frequency: (n: number) => ({ toNote: () => `note${n}` }),
}))

// sound-engine 모킹: createInstrument → 스파이 객체 반환
const mockDispose = vi.fn()
const mockTrigger = vi.fn()
vi.mock('@sculptone/sound-engine', () => ({
  createInstrument: vi.fn(() => ({
    triggerAttackRelease: mockTrigger,
    volume: { value: 0 },
    dispose: mockDispose,
  })),
  descriptorToToneSpec: vi.fn(() => ({ kind: 'synth', toneClass: 'Synth' })),
  getPreset: vi.fn((id: string) => ({ id, label: id, kind: 'synth', source: 'Synth' })),
}))

import { createInstrument } from '@sculptone/sound-engine'
import { useAudio } from '../useAudio'
import { createTrack, addTrack, updateTrackSound } from '@sculptone/score-model'

describe('useAudio — 멀티트랙 instrument 관리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
    mockTransport.start.mockClear()
    mockTransport.stop.mockClear()
    mockTransport.cancel.mockClear()
    mockTransport.schedule.mockClear()
    mockTransport.scheduleOnce.mockClear()
  })

  it('play() 호출 시 프로젝트의 모든 트랙에 대해 instrument가 생성된다', async () => {
    // 초기: 트랙 1개(Piano)
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    // 1개 트랙 → createInstrument 1회
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('두 번째 play()는 preset이 바뀌지 않으면 instrument를 재생성하지 않는다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    await act(async () => { result.current.play() })
    // 두 번 재생해도 createInstrument는 1회만
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('프리셋 변경 후 play() 시 해당 트랙 instrument가 dispose + 재생성된다', async () => {
    const { result } = renderHook(() => useAudio())
    // 첫 play — instrument 생성
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 프리셋 변경
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const updated = updateTrackSound(s.project, trackId, { kind: 'preset', presetId: 'synth-lead' })
    act(() => { s.setProject(updated) })

    // 두 번째 play — 변경된 트랙의 instrument dispose + 재생성
    await act(async () => { result.current.play() })
    expect(mockDispose).toHaveBeenCalledTimes(1)
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('트랙 추가 후 play() 시 신규 트랙 instrument도 생성된다', async () => {
    // 먼저 한 번 play (기존 트랙 instrument 생성)
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 트랙 추가
    const s = useStore.getState()
    const newTrack = createTrack('Bass')
    act(() => { s.setProject(addTrack(s.project, newTrack)) })

    // 두 번째 play — 신규 트랙 instrument 추가 생성
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('stop()은 transport.stop과 cancel을 호출한다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    act(() => { result.current.stop() })
    expect(mockTransport.stop).toHaveBeenCalled()
  })

  it('getSeconds()는 엔진이 없으면 0을 반환한다', () => {
    const { result } = renderHook(() => useAudio())
    expect(result.current.getSeconds()).toBe(0)
  })

  it('녹음 중이 아니면 노트 없는 프로젝트 play 시 transport.start를 호출하지 않는다', async () => {
    // 기본 프로젝트: Piano 트랙, 노트 0개 → endSec 0, 비-keepAlive
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(mockTransport.start).not.toHaveBeenCalled()
  })

  it('녹음 중이면 노트 없는 트랙이어도 keepAlive로 transport.start를 호출한다', async () => {
    const { result } = renderHook(() => useAudio())
    act(() => { useStore.getState().setRecording(true) })
    await act(async () => { result.current.play() })
    expect(mockTransport.start).toHaveBeenCalledTimes(1)
  })

  it('stop()은 transport.stop 호출 직전 위치를 recordStopSec로 스냅샷한다', async () => {
    const { result } = renderHook(() => useAudio())
    act(() => { useStore.getState().setRecording(true) })
    await act(async () => { result.current.play() })
    // 재생 진행: transport가 1.7s 위치
    mockSeconds = 1.7
    act(() => { result.current.stop() })
    expect(useStore.getState().recordStopSec).toBeCloseTo(1.7)
  })
})
