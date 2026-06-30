import * as Tone from 'tone'
import type { PresetDescriptor } from './types'
import { getPreset } from './presets'

// ── 기존 ToneSpec / createInstrument (하위호환 유지) ───────────

export type ToneSpec =
  | { kind: 'sampler'; source: string }
  | { kind: 'synth'; toneClass: 'Synth' | 'AMSynth' | 'FMSynth' }

export function descriptorToToneSpec(d: PresetDescriptor): ToneSpec {
  if (d.kind === 'sampler') return { kind: 'sampler', source: d.source }
  const cls = d.source === 'AMSynth' ? 'AMSynth' : d.source === 'FMSynth' ? 'FMSynth' : 'Synth'
  return { kind: 'synth', toneClass: cls }
}

export function createInstrument(spec: ToneSpec): Tone.PolySynth {
  switch (spec.kind) {
    case 'synth': {
      const map = { Synth: Tone.Synth, AMSynth: Tone.AMSynth, FMSynth: Tone.FMSynth } as const
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Tone.PolySynth(map[spec.toneClass] as any).toDestination()
    }
    case 'sampler':
    default:
      return new Tone.PolySynth(Tone.Synth).toDestination()
  }
}

// ── patch 지원 타입 ────────────────────────────────────────────
// score-model에 의존하지 않음(구조적 타이핑으로 Sound patch 변형과 호환).

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass'
  frequency: number
  Q: number
}

export interface ReverbConfig {
  type: 'reverb'
  wet: number
  decay: number
}
export interface DelayConfig {
  type: 'delay'
  wet: number
  time: number
  feedback: number
}
export type EffectConfig = ReverbConfig | DelayConfig

/** 오실레이터 파형 설정. type: 기본 파형 4종. detune: 정적 cents 오프셋. */
export interface OscillatorConfig {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle'
  detune: number // cents
}

/**
 * LFO 모듈레이션 설정.
 * - target: 변조 대상 파라미터.
 * - rate: Hz(>0).
 * - depth: 0..1 정규화 깊이(target별 범위 계산은 createInstrumentFromSound에서 수행).
 */
export interface LFOConfig {
  target: 'filter' | 'pitch' | 'amplitude'
  rate: number // Hz
  depth: number // 0..1
}

export interface PatchInput {
  engine: 'synth' | 'fm' | 'am'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter?: FilterConfig
  effects?: EffectConfig[]
  oscillator?: OscillatorConfig
  lfo?: LFOConfig
}

export interface TonePatchConfig {
  toneClass: 'Synth' | 'AMSynth' | 'FMSynth'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter: FilterConfig | null
  effects: EffectConfig[]
  /** 항상 정의됨. 미설정 시 기본값 { type:'sine', detune:0 }. */
  oscillator: OscillatorConfig
  /** 미설정 시 null. */
  lfo: LFOConfig | null
}

export interface PatchInstrument {
  triggerAttackRelease: (note: string, duration: number, time?: number, velocity?: number) => void
  volume: { value: number }
  dispose: () => void
}

export type SoundInput = { kind: 'preset'; presetId: string } | ({ kind: 'patch' } & PatchInput)

// ── patchToToneConfig (순수 — Tone 의존 없음) ──────────────────

const ENGINE_TO_TONE: Record<PatchInput['engine'], TonePatchConfig['toneClass']> = {
  synth: 'Synth',
  fm: 'FMSynth',
  am: 'AMSynth',
}

const DEFAULT_OSCILLATOR: OscillatorConfig = { type: 'sine', detune: 0 }

/**
 * patch 데이터 → Tone 설정 객체로 변환한다 (순수 함수, Tone 의존 없음).
 * - oscillator 미설정 → 기본값 { type:'sine', detune:0 }.
 * - lfo 미설정 → null.
 * - filter 미설정 → null.
 * - effects 미설정 → 빈 배열.
 */
export function patchToToneConfig(patch: PatchInput): TonePatchConfig {
  return {
    toneClass: ENGINE_TO_TONE[patch.engine],
    envelope: { ...patch.envelope },
    filter: patch.filter ? { ...patch.filter } : null,
    effects: (patch.effects ?? []).map((fx) => ({ ...fx })),
    oscillator: patch.oscillator ? { ...patch.oscillator } : { ...DEFAULT_OSCILLATOR },
    lfo: patch.lfo ? { ...patch.lfo } : null,
  }
}

// ── createInstrumentFromSound (Tone 체인 구성) ─────────────────

/**
 * sound 종류에 따라 Tone 악기를 생성한다.
 * - preset → 기존 createInstrument 경로.
 * - patch  → PolySynth + oscillator 설정 + [Filter] + [Effects] + [Gain(amplitude)] → destination.
 *            LFO 있으면 체인 구성 후 타겟에 배선.
 *
 * LFO depth → 오디오 범위 매핑:
 *   filter  : baseFreq × (1−depth) .. baseFreq × (1+depth), 클램프 20..20000 Hz
 *   pitch   : −depth×1200 .. +depth×1200 cents (최대 ±1 옥타브)
 *   amplitude: (1−depth) .. 1 gain
 *
 * dispose()는 lfoInstance, poly, 모든 node를 정리한다.
 */
export function createInstrumentFromSound(
  sound: SoundInput,
  getPresetFn: (id: string) => PresetDescriptor | undefined = getPreset,
): PatchInstrument {
  if (sound.kind === 'preset') {
    const desc = getPresetFn(sound.presetId) ?? getPresetFn('acoustic-piano')!
    const poly = createInstrument(descriptorToToneSpec(desc))
    return poly as unknown as PatchInstrument
  }

  // ── patch 경로 ──────────────────────────────────────────────

  const cfg = patchToToneConfig(sound)
  const classMap = {
    Synth: Tone.Synth,
    AMSynth: Tone.AMSynth,
    FMSynth: Tone.FMSynth,
  } as const

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = new Tone.PolySynth(classMap[cfg.toneClass] as any)
  poly.set({ envelope: cfg.envelope })

  // 오실레이터 파형 적용 (Tone v15: OmitSourceOptions가 oscillator에서 detune을 제거하므로 별도 set 호출)
  poly.set({ oscillator: { type: cfg.oscillator.type } as any })
  // detune은 MonophonicOptions 최상위 필드로 설정
  if (cfg.oscillator.detune !== 0) {
    poly.set({ detune: cfg.oscillator.detune })
  }

  // ── 노드 배열 구성 (체인 연결 전) ──────────────────────────

  const nodes: Tone.ToneAudioNode[] = []
  let filterNode: Tone.Filter | null = null

  // Filter
  if (cfg.filter) {
    filterNode = new Tone.Filter(cfg.filter.frequency, cfg.filter.type)
    filterNode.Q.value = cfg.filter.Q
    nodes.push(filterNode)
  }

  // Effects
  for (const fx of cfg.effects) {
    if (fx.type === 'reverb') {
      const r = new Tone.Reverb(Math.max(fx.decay, 0.001))
      r.wet.value = fx.wet
      nodes.push(r)
    } else if (fx.type === 'delay') {
      const d = new Tone.FeedbackDelay(fx.time, fx.feedback)
      d.wet.value = fx.wet
      nodes.push(d)
    }
  }

  // Amplitude LFO용 Gain 노드 — 체인 연결 전에 nodes에 추가해야 toDestination()에 포함됨
  let ampGainNode: Tone.Gain | null = null
  if (cfg.lfo?.target === 'amplitude') {
    ampGainNode = new Tone.Gain(1)
    nodes.push(ampGainNode)
  }

  // ── 체인 연결 ───────────────────────────────────────────────

  if (nodes.length > 0) {
    poly.connect(nodes[0]!)
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i]!.connect(nodes[i + 1]!)
    }
    nodes[nodes.length - 1]!.toDestination()
  } else {
    poly.toDestination()
  }

  // ── LFO 배선 (체인 연결 후) ─────────────────────────────────

  let lfoInstance: Tone.LFO | null = null

  if (cfg.lfo) {
    const { target, rate, depth } = cfg.lfo

    if (target === 'filter' && filterNode) {
      // filterNode.frequency에 LFO 연결 (filter가 있을 때만)
      const baseFreq = cfg.filter?.frequency ?? 2000
      const minFreq = Math.max(20, baseFreq * (1 - depth))
      const maxFreq = Math.min(20000, baseFreq * (1 + depth))
      lfoInstance = new Tone.LFO({ frequency: rate, min: minFreq, max: maxFreq })
      lfoInstance.connect(filterNode.frequency)
      lfoInstance.start()
    } else if (target === 'pitch') {
      // Tone v15 PolySynth에는 detune Signal이 없으므로 존재 시에만 LFO 연결 (no-op 가드)
      const detuneSignal = (poly as unknown as { detune?: Tone.Signal }).detune
      if (detuneSignal) {
        const maxCents = depth * 1200
        lfoInstance = new Tone.LFO({ frequency: rate, min: -maxCents, max: maxCents })
        lfoInstance.connect(detuneSignal)
        lfoInstance.start()
      }
    } else if (target === 'amplitude' && ampGainNode) {
      // ampGainNode.gain Param에 LFO 연결
      const minGain = Math.max(0, 1 - depth)
      lfoInstance = new Tone.LFO({ frequency: rate, min: minGain, max: 1 })
      lfoInstance.connect(ampGainNode.gain)
      lfoInstance.start()
    }
    // target='filter' + filterNode===null → no-op (LFO 생성하지 않음)
  }

  // ── PatchInstrument 반환 ─────────────────────────────────────

  return {
    triggerAttackRelease(note, duration, time, velocity) {
      poly.triggerAttackRelease(note, duration, time, velocity)
    },
    volume: poly.volume as unknown as { value: number },
    dispose() {
      lfoInstance?.dispose()
      poly.dispose()
      for (const n of nodes) n.dispose()
    },
  }
}
