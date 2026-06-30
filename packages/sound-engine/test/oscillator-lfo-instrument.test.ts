import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchToToneConfig, createInstrumentFromSound } from '../src/instrument'

// ── 픽스처 타입 ────────────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

type PatchLike = {
  kind: 'patch'
  engine: 'synth' | 'fm' | 'am'
  envelope: typeof BASE_ENV
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; Q: number }
  effects?: Array<
    | { type: 'reverb'; wet: number; decay: number }
    | { type: 'delay'; wet: number; time: number; feedback: number }
  >
  oscillator?: { type: 'sine' | 'square' | 'sawtooth' | 'triangle'; detune: number }
  lfo?: { target: 'filter' | 'pitch' | 'amplitude'; rate: number; depth: number }
}

function makePatch(overrides: Partial<Omit<PatchLike, 'kind'>> = {}): PatchLike {
  return { kind: 'patch', engine: 'synth', envelope: BASE_ENV, ...overrides }
}

// ── patchToToneConfig — oscillator/lfo 순수 매핑 (완전 TDD) ────

describe('patchToToneConfig — oscillator 매핑', () => {
  it('oscillator 없으면 기본값 { type:"sine", detune:0 } 반환', () => {
    expect(patchToToneConfig(makePatch()).oscillator).toEqual({ type: 'sine', detune: 0 })
  })

  it('oscillator.type이 square이면 square 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'square', detune: 0 } })).oscillator.type,
    ).toBe('square')
  })

  it('oscillator.type이 sawtooth이면 sawtooth 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sawtooth', detune: 0 } })).oscillator.type,
    ).toBe('sawtooth')
  })

  it('oscillator.type이 triangle이면 triangle 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'triangle', detune: 0 } })).oscillator.type,
    ).toBe('triangle')
  })

  it('oscillator.detune 양수(100 cents)가 그대로 전달된다', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sine', detune: 100 } })).oscillator.detune,
    ).toBe(100)
  })

  it('oscillator.detune 음수(-50 cents)가 그대로 전달된다', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sine', detune: -50 } })).oscillator.detune,
    ).toBe(-50)
  })
})

describe('patchToToneConfig — lfo 매핑', () => {
  it('lfo 없으면 lfo: null 반환', () => {
    expect(patchToToneConfig(makePatch()).lfo).toBeNull()
  })

  it('lfo.target="filter"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'filter', rate: 2, depth: 0.5 } }))
    expect(cfg.lfo?.target).toBe('filter')
  })

  it('lfo.target="pitch"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'pitch', rate: 1, depth: 0.3 } }))
    expect(cfg.lfo?.target).toBe('pitch')
  })

  it('lfo.target="amplitude"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'amplitude', rate: 5, depth: 0.8 } }))
    expect(cfg.lfo?.target).toBe('amplitude')
  })

  it('lfo.rate와 depth가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'filter', rate: 3.5, depth: 0.7 } }))
    expect(cfg.lfo?.rate).toBe(3.5)
    expect(cfg.lfo?.depth).toBe(0.7)
  })

  it('기존 필드(toneClass/envelope/filter/effects)는 oscillator/lfo 추가 후에도 정상 매핑', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'lowpass', frequency: 2000, Q: 1 },
      effects: [{ type: 'reverb', wet: 0.3, decay: 2 }],
      oscillator: { type: 'sawtooth', detune: -100 },
      lfo: { target: 'amplitude', rate: 4, depth: 0.6 },
    })
    const cfg = patchToToneConfig(patch)
    expect(cfg.toneClass).toBe('FMSynth')
    expect(cfg.envelope).toEqual(BASE_ENV)
    expect(cfg.filter).toEqual({ type: 'lowpass', frequency: 2000, Q: 1 })
    expect(cfg.effects).toHaveLength(1)
    expect(cfg.oscillator).toEqual({ type: 'sawtooth', detune: -100 })
    expect(cfg.lfo).toEqual({ target: 'amplitude', rate: 4, depth: 0.6 })
  })
})

// ── createInstrumentFromSound — oscillator/LFO 스모크 (Tone mock) ─
// vi.mock 호이스팅 문제를 피하기 위해 vi.hoisted로 mock 객체를 먼저 정의한다.

const {
  MockPolySynth,
  mockPolyInstance,
  MockFilter,
  mockFilterInstance,
  MockReverb,
  MockFeedbackDelay,
  MockLFO,
  mockLFOInstance,
  MockGain,
  mockGainInstance,
} = vi.hoisted(() => {
  const mockPolyInstance = {
    set: vi.fn(),
    connect: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    // detune Signal 없음 — 실제 Tone v15 PolySynth 반영(detune Signal 미존재)
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
  }
  const MockPolySynth = vi.fn().mockReturnValue(mockPolyInstance)

  const mockFilterInstance = {
    Q: { value: 0 },
    frequency: { value: 2000 }, // Signal<'frequency'> — LFO filter target용
    connect: vi.fn(),
    toDestination: vi.fn(),
    dispose: vi.fn(),
  }
  const MockFilter = vi.fn().mockReturnValue(mockFilterInstance)

  const mockReverbInstance = {
    wet: { value: 0 },
    connect: vi.fn(),
    toDestination: vi.fn(),
    dispose: vi.fn(),
  }
  const MockReverb = vi.fn().mockReturnValue(mockReverbInstance)

  const mockDelayInstance = {
    wet: { value: 0 },
    connect: vi.fn(),
    toDestination: vi.fn(),
    dispose: vi.fn(),
  }
  const MockFeedbackDelay = vi.fn().mockReturnValue(mockDelayInstance)

  const mockLFOInstance = {
    connect: vi.fn().mockReturnThis(),
    start: vi.fn().mockReturnThis(),
    dispose: vi.fn(),
    frequency: { value: 0 },
  }
  const MockLFO = vi.fn().mockReturnValue(mockLFOInstance)

  const mockGainInstance = {
    gain: { value: 1 }, // Param<'gain'> — LFO amplitude target용
    connect: vi.fn(),
    toDestination: vi.fn(),
    dispose: vi.fn(),
  }
  const MockGain = vi.fn().mockReturnValue(mockGainInstance)

  return {
    MockPolySynth,
    mockPolyInstance,
    MockFilter,
    mockFilterInstance,
    MockReverb,
    mockReverbInstance: mockReverbInstance,
    MockFeedbackDelay,
    mockDelayInstance,
    MockLFO,
    mockLFOInstance,
    MockGain,
    mockGainInstance,
  }
})

vi.mock('tone', () => ({
  PolySynth: MockPolySynth,
  Synth: vi.fn(),
  AMSynth: vi.fn(),
  FMSynth: vi.fn(),
  Filter: MockFilter,
  Reverb: MockReverb,
  FeedbackDelay: MockFeedbackDelay,
  LFO: MockLFO,
  Gain: MockGain,
}))

describe('createInstrumentFromSound — oscillator/LFO 스모크 (Tone mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPolyInstance.toDestination.mockReturnThis()
    mockLFOInstance.connect.mockReturnThis()
    mockLFOInstance.start.mockReturnThis()
  })

  it('oscillator 설정 시 poly.set이 oscillator.type과 detune을 포함해 호출된다', () => {
    const patch = makePatch({ oscillator: { type: 'square', detune: 100 } })
    createInstrumentFromSound(patch)
    const calls = mockPolyInstance.set.mock.calls
    // Tone v15 조정: OmitSourceOptions가 oscillator에서 detune을 제거하므로
    // oscillator.type은 {oscillator:{type}} 형태로, detune은 {detune} 형태로 별도 호출됨
    const oscTypeCall = calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'object' && args[0] !== null && 'oscillator' in (args[0] as object),
    )
    expect(oscTypeCall).toBeDefined()
    const oscArg = (oscTypeCall![0] as { oscillator: { type: string } }).oscillator
    expect(oscArg.type).toBe('square')

    const detuneCall = calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'object' && args[0] !== null && 'detune' in (args[0] as object),
    )
    expect(detuneCall).toBeDefined()
    expect((detuneCall![0] as { detune: number }).detune).toBe(100)
  })

  it('lfo target="pitch": detune Signal 없으면 throw 없이 LFO를 생성/connect하지 않는다(no-op)', () => {
    // 실제 Tone v15 PolySynth에는 detune Signal이 없으므로, pitch LFO는 no-op이어야 한다.
    const patch = makePatch({ lfo: { target: 'pitch', rate: 2, depth: 0.5 } })
    expect(() => createInstrumentFromSound(patch)).not.toThrow()
    expect(MockLFO).not.toHaveBeenCalled()
    expect(mockLFOInstance.connect).not.toHaveBeenCalled()
  })

  it('lfo target="filter" + filter 있을 때 LFO가 filterNode.frequency에 connect된다', () => {
    const patch = makePatch({
      filter: { type: 'lowpass', frequency: 2000, Q: 1 },
      lfo: { target: 'filter', rate: 1, depth: 0.5 },
    })
    createInstrumentFromSound(patch)
    expect(MockLFO).toHaveBeenCalled()
    expect(mockLFOInstance.connect).toHaveBeenCalledWith(mockFilterInstance.frequency)
    expect(mockLFOInstance.start).toHaveBeenCalled()
  })

  it('lfo target="amplitude" 시 Tone.Gain이 생성되고 LFO가 gainNode.gain에 connect된다', () => {
    const patch = makePatch({ lfo: { target: 'amplitude', rate: 3, depth: 0.7 } })
    createInstrumentFromSound(patch)
    expect(MockGain).toHaveBeenCalled()
    expect(MockLFO).toHaveBeenCalled()
    expect(mockLFOInstance.connect).toHaveBeenCalledWith(mockGainInstance.gain)
    expect(mockLFOInstance.start).toHaveBeenCalled()
  })

  it('dispose() 호출 시 LFO도 dispose된다', () => {
    // pitch는 no-op이므로 amplitude 사용
    const patch = makePatch({ lfo: { target: 'amplitude', rate: 1, depth: 0.3 } })
    const inst = createInstrumentFromSound(patch)
    inst.dispose()
    expect(mockLFOInstance.dispose).toHaveBeenCalled()
    expect(mockPolyInstance.dispose).toHaveBeenCalled()
  })

  it('lfo target="filter" + filter 없음: throw 없이 LFO를 생성/connect하지 않는다(no-op)', () => {
    // filter 없는 패치에서 lfo.target="filter" → && filterNode 가드에 의해 no-op
    const patch = makePatch({ lfo: { target: 'filter', rate: 1, depth: 0.5 } })
    expect(() => createInstrumentFromSound(patch)).not.toThrow()
    expect(MockLFO).not.toHaveBeenCalled()
    expect(mockLFOInstance.connect).not.toHaveBeenCalled()
  })
})
