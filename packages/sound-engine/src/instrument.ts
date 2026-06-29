import * as Tone from 'tone'
import type { PresetDescriptor } from './types'

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
