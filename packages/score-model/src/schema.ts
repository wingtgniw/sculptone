import { z } from 'zod'

// 음색: P1은 preset만 사용. patch 변형은 P2 forward-compat(스키마만 선반영).
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
