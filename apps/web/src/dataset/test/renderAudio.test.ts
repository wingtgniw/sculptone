import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
} from '@sculptone/score-model'

// ── 호이스팅된 mock 변수 (vi.mock factory에서 참조 가능) ─────────────────────
const {
  mockOffline,
  mockFrequency,
  mockTriggerAttackRelease,
  mockCreateInstrumentFromSound,
  mockAudioBuffer,
} = vi.hoisted(() => {
  const mockAudioBuffer = {
    numberOfChannels: 2,
    length: 88200, // 2sec at 44100
    sampleRate: 44100,
    duration: 2.0,
    getChannelData: () => new Float32Array(88200),
  }

  const mockTriggerAttackRelease = vi.fn()
  const mockInstrument = {
    triggerAttackRelease: mockTriggerAttackRelease,
    volume: { value: 0 },
    dispose: vi.fn(),
  }

  const mockOffline = vi.fn(
    async (
      callback: () => Promise<void>,
      _duration?: number,
      _channels?: number,
      _sampleRate?: number,
    ) => {
      await callback()
      return { get: () => mockAudioBuffer }
    },
  )

  const mockFrequency = vi.fn((_pitch: number, _unit: string) => ({
    toNote: () => 'C4',
  }))

  const mockCreateInstrumentFromSound = vi.fn(() => mockInstrument)

  return {
    mockOffline,
    mockFrequency,
    mockTriggerAttackRelease,
    mockCreateInstrumentFromSound,
    mockAudioBuffer,
  }
})

// ── Tone mock ─────────────────────────────────────────────────────────────────
vi.mock('tone', () => ({
  Offline: mockOffline,
  Frequency: mockFrequency,
}))

// ── createInstrumentFromSound mock ────────────────────────────────────────────
vi.mock('@sculptone/sound-engine', () => ({
  createInstrumentFromSound: mockCreateInstrumentFromSound,
}))

import { renderProjectAudio, computeRenderTailSec, RENDER_TAIL_SEC } from '../renderAudio'

describe('renderProjectAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOffline.mockImplementation(
      async (
        callback: () => Promise<void>,
        _duration?: number,
        _channels?: number,
        _sampleRate?: number,
      ) => {
        await callback()
        return { get: () => mockAudioBuffer }
      },
    )
    mockCreateInstrumentFromSound.mockImplementation(() => ({
      triggerAttackRelease: mockTriggerAttackRelease,
      volume: { value: 0 },
      dispose: vi.fn(),
    }))
  })

  it('Tone.Offline이 sampleRate 옵션과 함께 호출된다', async () => {
    const p = createEmptyProject('T')
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockOffline).toHaveBeenCalledOnce()
    // Offline(callback, durationSec, channels, sampleRate)
    const [, , channels, sr] = mockOffline.mock.calls[0]!
    expect(channels).toBe(2)
    expect(sr).toBe(44100)
  })

  it('AudioBuffer를 반환한다 (ToneAudioBuffer.get() 결과)', async () => {
    const p = createEmptyProject('T')
    const result = await renderProjectAudio(p, { sampleRate: 44100 })
    expect(result).toBe(mockAudioBuffer)
  })

  it('트랙당 createInstrumentFromSound가 호출된다', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockCreateInstrumentFromSound).toHaveBeenCalledOnce()
  })

  it('노트 수만큼 triggerAttackRelease가 호출된다', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = addNote(p, track.id, createNote({ pitch: 64, start: 480, duration: 480, velocity: 80 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(2)
  })

  it('빈 프로젝트(노트 없음)도 AudioBuffer를 반환한다 (무음)', async () => {
    const p = createEmptyProject('Empty')
    const result = await renderProjectAudio(p, { sampleRate: 44100 })
    expect(result).toBe(mockAudioBuffer)
    // triggerAttackRelease는 호출되지 않아야 함
    expect(mockTriggerAttackRelease).not.toHaveBeenCalled()
  })

  it('durationSec = contentEndSec + RENDER_TAIL_SEC (>= RENDER_TAIL_SEC)', async () => {
    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    // 120BPM ppq480: start=480ticks=0.5sec, duration=480ticks=0.5sec → contentEnd=1.0sec
    p = addNote(p, track.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    await renderProjectAudio(p, { sampleRate: 44100 })
    // Offline의 두 번째 인수(durationSec)가 1.0 + RENDER_TAIL_SEC(2.0) = 3.0
    const [, durationSec] = mockOffline.mock.calls[0]!
    expect(durationSec as number).toBeCloseTo(3.0)
  })

  // Fix A: reverb ready를 노트 스케줄 전에 await하는지 확인
  it('리버브 ready Promise를 노트 스케줄 전에 await한다', async () => {
    const callOrder: string[] = []

    // Promise.resolve().then(cb): cb는 마이크로태스크로 예약됨 — await ready 후에 resolve
    const readyPromise = Promise.resolve().then(() => {
      callOrder.push('ready')
    })

    mockCreateInstrumentFromSound.mockReturnValueOnce({
      triggerAttackRelease: vi.fn(() => {
        callOrder.push('schedule')
      }),
      volume: { value: 0 },
      dispose: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ready: readyPromise as any,
    } as any)

    const track = createTrack('Piano')
    let p = addTrack(createEmptyProject('T'), track)
    p = addNote(p, track.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))

    await renderProjectAudio(p, { sampleRate: 44100 })

    // Fix A 적용 후: ready가 resolve된 뒤 schedule이 호출돼야 함
    expect(callOrder).toEqual(['ready', 'schedule'])
  })
})

// Fix C: computeRenderTailSec 단위 테스트
describe('computeRenderTailSec', () => {
  it('reverb decay=3인 가청 트랙이 있으면 tail >= 3.5 (decay + 0.5)', () => {
    const reverbTrack = {
      ...createTrack('Reverb'),
      sound: {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        effects: [{ type: 'reverb' as const, wet: 0.5, decay: 3 }],
      },
    }
    const project = addTrack(createEmptyProject('T'), reverbTrack)
    const tail = computeRenderTailSec(project, [reverbTrack.id])
    expect(tail).toBeGreaterThanOrEqual(3.5)
  })

  it('reverb가 없으면 RENDER_TAIL_SEC (2.0) 그대로', () => {
    const track = createTrack('Piano')
    const project = addTrack(createEmptyProject('T'), track)
    const tail = computeRenderTailSec(project, [track.id])
    expect(tail).toBe(RENDER_TAIL_SEC)
  })

  it('preset 트랙은 reverb 없음으로 취급해 RENDER_TAIL_SEC 반환', () => {
    const track = createTrack('Preset')
    const project = addTrack(createEmptyProject('T'), track)
    const tail = computeRenderTailSec(project, [track.id])
    expect(tail).toBe(RENDER_TAIL_SEC)
  })

  it('reverb decay=1.0 → tail = max(2.0, 1.5) = 2.0', () => {
    const track = {
      ...createTrack('SmallReverb'),
      sound: {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        effects: [{ type: 'reverb' as const, wet: 0.3, decay: 1.0 }],
      },
    }
    const project = addTrack(createEmptyProject('T'), track)
    const tail = computeRenderTailSec(project, [track.id])
    expect(tail).toBe(RENDER_TAIL_SEC) // max(2.0, 1.5) = 2.0
  })
})
