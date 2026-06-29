// P1: 샘플러/신스 프리셋 디스크립터(순수 데이터). 실제 Tone.js 인스턴스화는 재생 계획(P1 슬라이스 4)에서.
export type PresetKind = 'sampler' | 'synth'

export interface PresetDescriptor {
  id: string
  label: string
  kind: PresetKind
  // sampler: 샘플 베이스 URL 또는 식별자(후속 계획에서 사용). synth: Tone synth 타입명.
  source: string
}
