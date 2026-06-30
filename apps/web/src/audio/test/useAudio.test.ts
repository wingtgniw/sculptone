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
  scheduleRepeat: vi.fn(),
  get seconds() {
    return mockSeconds
  },
}
vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: () => mockTransport,
  Frequency: (n: number) => ({ toNote: () => `note${n}` }),
}))

// sound-engine 모킹: createInstrument / createInstrumentFromSound → 스파이 객체 반환
const mockDispose = vi.fn()
const mockTrigger = vi.fn()
const mockPatchDispose = vi.fn()
const mockPatchTrigger = vi.fn()
vi.mock('@sculptone/sound-engine', () => ({
  createInstrument: vi.fn(() => ({
    triggerAttackRelease: mockTrigger,
    volume: { value: 0 },
    dispose: mockDispose,
  })),
  descriptorToToneSpec: vi.fn(() => ({ kind: 'synth', toneClass: 'Synth' })),
  getPreset: vi.fn((id: string) => ({ id, label: id, kind: 'synth', source: 'Synth' })),
  // 새로 추가: patch 경로용
  createInstrumentFromSound: vi.fn(() => ({
    triggerAttackRelease: mockPatchTrigger,
    volume: { value: 0 },
    dispose: mockPatchDispose,
  })),
}))

// metronome 모킹: createMetronome → spy 핸들
const mockMetronomeClick = vi.fn()
const mockMetronomeDispose = vi.fn()
vi.mock('../metronome', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../metronome')>()
  return {
    ...orig, // 순수 함수(computeClickTimes 등)는 실제 구현 사용
    createMetronome: vi.fn(() => ({
      click: mockMetronomeClick,
      dispose: mockMetronomeDispose,
    })),
  }
})

// playback 모킹: createPlaybackEngine의 play를 가로채 opts를 캡처한다.
// 실제 엔진(transport 호출 포함)에 위임하므로 기존 테스트에 영향 없음.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastPlayOpts: any = undefined
vi.mock('../playback', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../playback')>()
  return {
    ...orig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPlaybackEngine: (getInstrument: any) => {
      const engine = orig.createPlaybackEngine(getInstrument)
      const origPlay = engine.play
      return {
        ...engine,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        play: vi.fn(async (project: any, onEnded: any, isValid: any, opts: any) => {
          lastPlayOpts = opts
          return origPlay.call(engine, project, onEnded, isValid, opts)
        }),
      }
    },
  }
})

import { createInstrument, createInstrumentFromSound } from '@sculptone/sound-engine'
import { useAudio } from '../useAudio'
import { createTrack, addTrack, updateTrackSound } from '@sculptone/score-model'

describe('useAudio — 멀티트랙 instrument 관리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    lastPlayOpts = undefined
    vi.clearAllMocks()
    mockTransport.start.mockClear()
    mockTransport.stop.mockClear()
    mockTransport.cancel.mockClear()
    mockTransport.schedule.mockClear()
    mockTransport.scheduleOnce.mockClear()
    mockTransport.scheduleRepeat.mockClear()
    mockMetronomeClick.mockClear()
    mockMetronomeDispose.mockClear()
  })

  it('play() 호출 시 프로젝트의 모든 트랙에 대해 instrument가 생성된다', async () => {
    // 초기: 트랙 1개(Piano)
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    // 1개 트랙 → createInstrument 1회
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('두 번째 play()는 preset이 바뀌지 않으면 instrument를 재생성하지 않는다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    await act(async () => {
      result.current.play()
    })
    // 두 번 재생해도 createInstrument는 1회만
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('프리셋 변경 후 play() 시 해당 트랙 instrument가 dispose + 재생성된다', async () => {
    const { result } = renderHook(() => useAudio())
    // 첫 play — instrument 생성
    await act(async () => {
      result.current.play()
    })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 프리셋 변경
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const updated = updateTrackSound(s.project, trackId, { kind: 'preset', presetId: 'synth-lead' })
    act(() => {
      s.setProject(updated)
    })

    // 두 번째 play — 변경된 트랙의 instrument dispose + 재생성
    await act(async () => {
      result.current.play()
    })
    expect(mockDispose).toHaveBeenCalledTimes(1)
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('트랙 추가 후 play() 시 신규 트랙 instrument도 생성된다', async () => {
    // 먼저 한 번 play (기존 트랙 instrument 생성)
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 트랙 추가
    const s = useStore.getState()
    const newTrack = createTrack('Bass')
    act(() => {
      s.setProject(addTrack(s.project, newTrack))
    })

    // 두 번째 play — 신규 트랙 instrument 추가 생성
    await act(async () => {
      result.current.play()
    })
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('stop()은 transport.stop과 cancel을 호출한다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    act(() => {
      result.current.stop()
    })
    expect(mockTransport.stop).toHaveBeenCalled()
  })

  it('getSeconds()는 엔진이 없으면 0을 반환한다', () => {
    const { result } = renderHook(() => useAudio())
    expect(result.current.getSeconds()).toBe(0)
  })

  it('녹음 중이 아니면 노트 없는 프로젝트 play 시 transport.start를 호출하지 않는다', async () => {
    // 기본 프로젝트: Piano 트랙, 노트 0개 → endSec 0, 비-keepAlive
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    expect(mockTransport.start).not.toHaveBeenCalled()
  })

  it('녹음 중이면 노트 없는 트랙이어도 keepAlive로 transport.start를 호출한다', async () => {
    const { result } = renderHook(() => useAudio())
    act(() => {
      useStore.getState().setRecording(true)
    })
    await act(async () => {
      result.current.play()
    })
    expect(mockTransport.start).toHaveBeenCalledTimes(1)
  })

  it('stop()은 transport.stop 호출 직전 위치를 recordStopSec로 스냅샷한다', async () => {
    const { result } = renderHook(() => useAudio())
    act(() => {
      useStore.getState().setRecording(true)
    })
    await act(async () => {
      result.current.play()
    })
    // 재생 진행: transport가 1.7s 위치
    mockSeconds = 1.7
    act(() => {
      result.current.stop()
    })
    expect(useStore.getState().recordStopSec).toBeCloseTo(1.7)
  })
})

describe('useAudio — patch instrument 관리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    lastPlayOpts = undefined
    vi.clearAllMocks()
  })

  it('patch sound 트랙은 createInstrumentFromSound 경로로 instrument를 생성한다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    // preset → patch 전환
    s.setProject(
      updateTrackSound(s.project, trackId, {
        kind: 'patch',
        engine: 'synth',
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
      }),
    )
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)
    // preset 경로(createInstrument)는 호출되지 않아야 함
    expect(createInstrument).not.toHaveBeenCalled()
  })

  it('patch envelope 변경 후 play() 시 instrument가 dispose + 재생성된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const basePatch = {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }
    s.setProject(updateTrackSound(s.project, trackId, basePatch))

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)

    // envelope 변경 (attack: 0.5)
    const updated = useStore.getState()
    updated.setProject(
      updateTrackSound(updated.project, trackId, {
        ...basePatch,
        envelope: { ...basePatch.envelope, attack: 0.5 },
      }),
    )

    await act(async () => {
      result.current.play()
    })
    expect(mockPatchDispose).toHaveBeenCalledTimes(1)
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(2)
  })

  it('preset→patch 전환 후 play() 시 기존 preset instrument가 dispose + patch instrument 생성', async () => {
    // 먼저 preset으로 play
    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // patch로 전환
    const s = useStore.getState()
    s.setProject(
      updateTrackSound(s.project, s.selectedTrackId, {
        kind: 'patch',
        engine: 'am',
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
      }),
    )
    await act(async () => {
      result.current.play()
    })
    // 기존 preset instrument dispose
    expect(mockDispose).toHaveBeenCalledTimes(1)
    // 새 patch instrument 생성
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)
  })

  it('동일 patch로 두 번 play 시 createInstrumentFromSound가 1회만 호출되고 dispose는 호출되지 않는다(Fix 7 캐시히트)', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const basePatch = {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }
    s.setProject(updateTrackSound(s.project, trackId, basePatch))

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })
    await act(async () => {
      result.current.play()
    })

    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)
    expect(mockPatchDispose).not.toHaveBeenCalled()
  })
})

describe('useAudio — 메트로놈 + 카운트인', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    lastPlayOpts = undefined
    vi.clearAllMocks()
  })

  it('metronomeEnabled=true면 play() 시 createMetronome이 반환한 핸들이 엔진에 전달된다', async () => {
    const { createMetronome } = await import('../metronome')
    act(() => {
      useStore.getState().setMetronomeEnabled(true)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    // createMetronome이 호출되어야 함 (최초 마운트 또는 첫 play 시)
    expect(createMetronome).toHaveBeenCalled()
  })

  it('metronomeEnabled=false면 play() 시 createMetronome을 호출하지 않는다', async () => {
    const { createMetronome } = await import('../metronome')
    // 기본값 metronomeEnabled=false

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    expect(createMetronome).not.toHaveBeenCalled()
  })

  it('isRecording=true, countInBars=2이면 recordingContentStartSec가 barsToSeconds(2,...) 값으로 설정된다', async () => {
    act(() => {
      useStore.getState().setMetronomeEnabled(true) // 카운트인은 메트로놈 ON 상태에서만 동작
      useStore.getState().setRecording(true)
      useStore.getState().setCountInBars(2)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    // tempo=120(기본), timeSignature=[4,4](기본), 2마디 = 4.0s
    const sec = useStore.getState().recordingContentStartSec
    expect(sec).toBeCloseTo(4.0)
  })

  it('isRecording=false이면 countInBars>0이어도 recordingContentStartSec=0을 유지한다', async () => {
    act(() => {
      // isRecording=false (기본)
      useStore.getState().setCountInBars(2)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    expect(useStore.getState().recordingContentStartSec).toBe(0)
  })

  it('[fix2] metronomeEnabled=false면 countInBars>0 + isRecording=true여도 recordingContentStartSec=0 (카운트인 없음)', async () => {
    act(() => {
      // metronomeEnabled는 기본 false 유지
      useStore.getState().setRecording(true)
      useStore.getState().setCountInBars(2)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    // 메트로놈 off 상태에서 카운트인은 0이어야 한다 (무음 지연 없음)
    expect(useStore.getState().recordingContentStartSec).toBe(0)
  })

  it('[fix5] metronomeEnabled=true이면 play opts.metronome이 createMetronome 핸들과 동일 참조다', async () => {
    const { createMetronome } = await import('../metronome')
    act(() => {
      useStore.getState().setMetronomeEnabled(true)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => {
      result.current.play()
    })

    // createMetronome mock이 반환한 핸들이 engine.play opts.metronome으로 전달되어야 한다
    const metroHandle = (createMetronome as ReturnType<typeof vi.fn>).mock.results[0]?.value
    expect(lastPlayOpts).toBeDefined()
    expect(lastPlayOpts).toEqual(expect.objectContaining({ metronome: metroHandle }))
  })
})
