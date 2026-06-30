import { z } from 'zod'

const FilterSchema = z.object({
  type: z.enum(['lowpass', 'highpass', 'bandpass']),
  frequency: z.number().positive(),
  Q: z.number().nonnegative(),
})

const EffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reverb'),
    wet: z.number().min(0).max(1),
    decay: z.number().positive(),
  }),
  z.object({
    type: z.literal('delay'),
    wet: z.number().min(0).max(1),
    time: z.number().positive(),
    feedback: z.number().min(0).max(1),
  }),
])

// 오실레이터 파형·detune (4종 기본 파형; detune 단위: cents)
const OscillatorSchema = z.object({
  type: z.enum(['sine', 'square', 'sawtooth', 'triangle']),
  detune: z.number(), // cents — 범위 미제한(UI가 -1200..1200 강제)
})

// LFO 모듈레이션 (타겟·rate(Hz)·depth(0..1))
const LFOSchema = z.object({
  target: z.enum(['filter', 'pitch', 'amplitude']),
  rate: z.number().positive(), // Hz, >0
  depth: z.number().min(0).max(1),
})

// 음색: preset(프리셋 참조) 또는 patch(커스텀 신스 패치).
// filter/effects/oscillator/lfo는 옵셔널(하위호환).
export const SoundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), presetId: z.string() }),
  z.object({
    kind: z.literal('patch'),
    engine: z.enum(['synth', 'fm', 'am']),
    envelope: z.object({
      attack: z.number().nonnegative(),
      decay: z.number().nonnegative(),
      sustain: z.number().min(0).max(1),
      release: z.number().nonnegative(),
    }),
    filter: FilterSchema.optional(),
    effects: z.array(EffectSchema).optional(),
    oscillator: OscillatorSchema.optional(),
    lfo: LFOSchema.optional(),
  }),
])

export const NoteSchema = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127),
  start: z.number().nonnegative(),     // ticks (절대)
  duration: z.number().positive(),     // ticks
  velocity: z.number().int().min(0).max(127),
})

export const MixerSchema = z.object({
  volume: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
  muted: z.boolean(),
  soloed: z.boolean(),
})

export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  sound: SoundSchema,
  mixer: MixerSchema,
  notes: z.array(NoteSchema),
})

export const TransportSchema = z.object({
  ppq: z.number().int().positive(),
  tempo: z.number().positive(),
  timeSignature: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  key: z.string(),
})

export const ProjectSchema = z.object({
  id: z.string(),
  metadata: z.object({
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  transport: TransportSchema,
  tracks: z.array(TrackSchema),
})

export type Sound = z.infer<typeof SoundSchema>
export type Note = z.infer<typeof NoteSchema>
export type Mixer = z.infer<typeof MixerSchema>
export type Track = z.infer<typeof TrackSchema>
export type Transport = z.infer<typeof TransportSchema>
export type Project = z.infer<typeof ProjectSchema>
