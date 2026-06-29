import * as Tone from 'tone'
import type { PresetDescriptor } from './types'
import { getPreset } from './presets'

// ── 기존 ToneSpec / createInstrument (하위호환 유지) ───────────

export type ToneSpec =
  | { kind: 'sampler'; source: string }
  | { kind: 'synth'; toneClass: 'Synth' | 'AMSynth' | 'FMSynth' }

// 순수: 프리셋 디스크립터 → Tone 생성 스펙
export function descriptorToToneSpec(d: PresetDescriptor): ToneSpec {
  if (d.kind === 'sampler') return { kind: 'sampler', source: d.source }
  const cls = d.source === 'AMSynth' ? 'AMSynth' : d.source === 'FMSynth' ? 'FMSynth' : 'Synth'
  return { kind: 'synth', toneClass: cls }
}

// 비순수(스모크): 스펙 → 실제 Tone 악기. sampler는 P2에서 샘플 URL 매핑 확장 예정이라
// 지금은 합성 폴리신스로 폴백한다(소리는 나되 음색 정밀도는 후속).
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

// ── 신규: patch 지원 타입 ──────────────────────────────────────
// score-model에 의존하지 않음(구조적 타이핑으로 Sound patch 변형과 호환).

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass'
  frequency: number
  Q: number
}

export interface ReverbConfig { type: 'reverb'; wet: number; decay: number }
export interface DelayConfig  { type: 'delay'; wet: number; time: number; feedback: number }
export type EffectConfig = ReverbConfig | DelayConfig

export interface PatchInput {
  engine: 'synth' | 'fm' | 'am'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter?: FilterConfig
  effects?: EffectConfig[]
}

export interface TonePatchConfig {
  toneClass: 'Synth' | 'AMSynth' | 'FMSynth'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter: FilterConfig | null
  effects: EffectConfig[]
}

export interface PatchInstrument {
  triggerAttackRelease: (note: string, duration: number, time?: number, velocity?: number) => void
  volume: { value: number }
  dispose: () => void
}

// sound.kind를 포함한 유니온 (createInstrumentFromSound 시그니처용)
export type SoundInput =
  | { kind: 'preset'; presetId: string }
  | ({ kind: 'patch' } & PatchInput)

// ── 신규: patchToToneConfig (순수 — Tone 의존 없음) ────────────

const ENGINE_TO_TONE: Record<PatchInput['engine'], TonePatchConfig['toneClass']> = {
  synth: 'Synth',
  fm: 'FMSynth',
  am: 'AMSynth',
}

/**
 * patch 데이터 → Tone 설정 객체로 변환한다 (순수 함수, Tone 의존 없음).
 * - filter 없으면 null 반환.
 * - effects 없으면 빈 배열 반환.
 */
export function patchToToneConfig(patch: PatchInput): TonePatchConfig {
  return {
    toneClass: ENGINE_TO_TONE[patch.engine],
    envelope: { ...patch.envelope },
    filter: patch.filter ? { ...patch.filter } : null,
    effects: (patch.effects ?? []).map((fx) => ({ ...fx })),
  }
}

// ── 신규: createInstrumentFromSound (Tone 체인 구성) ───────────

/**
 * sound 종류에 따라 Tone 악기를 생성한다.
 * - preset → 기존 createInstrument 경로.
 * - patch  → PolySynth + [Filter] + [Reverb/Delay...] 체인.
 *
 * Tone 체인: poly → filter? → reverb? → delay? → destination
 * dispose()는 poly와 모든 effect node를 정리한다.
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

  // patch 경로
  const cfg = patchToToneConfig(sound)
  const classMap = {
    Synth: Tone.Synth,
    AMSynth: Tone.AMSynth,
    FMSynth: Tone.FMSynth,
  } as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = new Tone.PolySynth(classMap[cfg.toneClass] as any)
  poly.set({ envelope: cfg.envelope })

  const nodes: Tone.ToneAudioNode[] = []

  if (cfg.filter) {
    const f = new Tone.Filter(cfg.filter.frequency, cfg.filter.type)
    f.Q.value = cfg.filter.Q
    nodes.push(f)
  }

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

  // 체인 연결
  if (nodes.length > 0) {
    poly.connect(nodes[0]!)
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i]!.connect(nodes[i + 1]!)
    }
    nodes[nodes.length - 1]!.toDestination()
  } else {
    poly.toDestination()
  }

  return {
    triggerAttackRelease(note, duration, time, velocity) {
      poly.triggerAttackRelease(note, duration, time, velocity)
    },
    volume: poly.volume as unknown as { value: number },
    dispose() {
      poly.dispose()
      for (const n of nodes) n.dispose()
    },
  }
}
