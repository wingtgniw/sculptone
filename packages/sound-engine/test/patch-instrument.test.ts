import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchToToneConfig, createInstrumentFromSound } from '../src/instrument'

// ── PatchInput 픽스처 ───────────────────────────────────────────

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
}

function makePatch(overrides: Partial<Omit<PatchLike, 'kind'>> = {}): PatchLike {
  return { kind: 'patch', engine: 'synth', envelope: BASE_ENV, ...overrides }
}

// ── patchToToneConfig — 순수 매핑 (완전 TDD) ───────────────────

describe('patchToToneConfig', () => {
  it('synth engine → toneClass: Synth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'synth' })).toneClass).toBe('Synth')
  })

  it('fm engine → toneClass: FMSynth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'fm' })).toneClass).toBe('FMSynth')
  })

  it('am engine → toneClass: AMSynth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'am' })).toneClass).toBe('AMSynth')
  })

  it('envelope 값이 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch())
    expect(cfg.envelope).toEqual(BASE_ENV)
  })

  it('filter 없으면 filter: null 반환', () => {
    expect(patchToToneConfig(makePatch()).filter).toBeNull()
  })

  it('filter 있으면 동일 값 반환', () => {
    const filter = { type: 'lowpass' as const, frequency: 2000, Q: 1.5 }
    expect(patchToToneConfig(makePatch({ filter })).filter).toEqual(filter)
  })

  it('effects 없으면 빈 배열 반환', () => {
    expect(patchToToneConfig(makePatch()).effects).toEqual([])
  })

  it('reverb effect가 그대로 전달된다', () => {
    const effects = [{ type: 'reverb' as const, wet: 0.3, decay: 2.5 }]
    expect(patchToToneConfig(makePatch({ effects })).effects).toEqual(effects)
  })

  it('delay effect가 그대로 전달된다', () => {
    const effects = [{ type: 'delay' as const, wet: 0.2, time: 0.25, feedback: 0.4 }]
    expect(patchToToneConfig(makePatch({ effects })).effects).toEqual(effects)
  })

  it('filter + reverb + delay 모두 있는 패치 — 전체 필드 정확히 매핑', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'bandpass', frequency: 800, Q: 2 },
      effects: [
        { type: 'reverb', wet: 0.4, decay: 3 },
        { type: 'delay', wet: 0.15, time: 0.125, feedback: 0.3 },
      ],
    })
    const cfg = patchToToneConfig(patch)
    expect(cfg.toneClass).toBe('FMSynth')
    expect(cfg.filter).toEqual({ type: 'bandpass', frequency: 800, Q: 2 })
    expect(cfg.effects).toHaveLength(2)
    expect(cfg.effects[0]).toEqual({ type: 'reverb', wet: 0.4, decay: 3 })
    expect(cfg.effects[1]).toEqual({ type: 'delay', wet: 0.15, time: 0.125, feedback: 0.3 })
  })
})

// ── createInstrumentFromSound — 스모크 (Tone 전체 mock) ─────────
// vi.mock 호이스팅 문제를 피하기 위해 vi.hoisted로 mock 객체를 먼저 정의한다.

const {
  MockPolySynth,
  mockPolyInstance,
  MockFilter,
  MockReverb,
  MockFeedbackDelay,
  mockDelayInstance,
} = vi.hoisted(() => {
  const mockPolyInstance = {
    set: vi.fn(),
    connect: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
  }
  const MockPolySynth = vi.fn().mockReturnValue(mockPolyInstance)
  const mockFilterInstance = {
    Q: { value: 0 },
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

  return {
    MockPolySynth,
    mockPolyInstance,
    MockFilter,
    mockFilterInstance,
    MockReverb,
    mockReverbInstance,
    MockFeedbackDelay,
    mockDelayInstance,
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
}))

describe('createInstrumentFromSound — 스모크 (Tone mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPolyInstance.toDestination.mockReturnThis()
  })

  it('preset sound → triggerAttackRelease와 dispose 메서드가 있는 객체 반환', () => {
    const inst = createInstrumentFromSound({ kind: 'preset', presetId: 'synth-lead' })
    expect(typeof inst.triggerAttackRelease).toBe('function')
    expect(typeof inst.dispose).toBe('function')
  })

  it('patch sound → PatchInstrument 반환(크래시 없음), PolySynth 생성자 호출됨', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'lowpass', frequency: 1000, Q: 1 },
      effects: [{ type: 'reverb', wet: 0.3, decay: 2 }],
    })
    const inst = createInstrumentFromSound(patch)
    expect(typeof inst.triggerAttackRelease).toBe('function')
    expect(typeof inst.dispose).toBe('function')
    expect(MockPolySynth).toHaveBeenCalled()
  })

  it('dispose() 호출 시 내부 PolySynth와 effect 노드가 모두 dispose됨', () => {
    const patch = makePatch({
      effects: [{ type: 'delay', wet: 0.2, time: 0.25, feedback: 0.4 }],
    })
    const inst = createInstrumentFromSound(patch)
    inst.dispose()
    expect(mockPolyInstance.dispose).toHaveBeenCalled()
    expect(mockDelayInstance.dispose).toHaveBeenCalled()
  })
})
