import { describe, it, expect } from 'vitest'
import { SoundSchema } from '../src/schema'
import { createDefaultPatch, createEmptyProject, createTrack } from '../src/factory'
import { addTrack } from '../src/operations'
import { updateTrackSound } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'
import type { Sound } from '../src/schema'

// ── 공통 픽스처 ─────────────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

const FULL_PATCH: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
  filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
  effects: [
    { type: 'reverb', wet: 0.3, decay: 2.5 },
    { type: 'delay', wet: 0.2, time: 0.25, feedback: 0.4 },
  ],
}

// ── SoundSchema — 스키마 유효성 ─────────────────────────────────

describe('SoundSchema — patch 확장 유효성', () => {
  it('기존 patch({engine, envelope}만)는 여전히 유효하다(하위호환)', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
    })
    expect(result.success).toBe(true)
  })

  it('filter가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      filter: { type: 'lowpass', frequency: 1000, Q: 1 },
    })
    expect(result.success).toBe(true)
  })

  it('effects(reverb)가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'am',
      envelope: BASE_ENV,
      effects: [{ type: 'reverb', wet: 0.4, decay: 2 }],
    })
    expect(result.success).toBe(true)
  })

  it('effects(delay)가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'fm',
      envelope: BASE_ENV,
      effects: [{ type: 'delay', wet: 0.3, time: 0.25, feedback: 0.5 }],
    })
    expect(result.success).toBe(true)
  })

  it('filter + effects(reverb + delay) 모두 있는 FULL_PATCH는 유효하다', () => {
    const result = SoundSchema.safeParse(FULL_PATCH)
    expect(result.success).toBe(true)
  })

  it('잘못된 filter.type("notch")은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      filter: { type: 'notch', frequency: 1000, Q: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('알 수 없는 effect.type("chorus")은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      effects: [{ type: 'chorus', wet: 0.5 }],
    })
    expect(result.success).toBe(false)
  })

  it('reverb.wet > 1은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      effects: [{ type: 'reverb', wet: 1.5, decay: 2 }],
    })
    expect(result.success).toBe(false)
  })

  it('filter.frequency <= 0은 거부된다(z.number().positive())', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      filter: { type: 'lowpass', frequency: -100, Q: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('delay.feedback > 1은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch',
      engine: 'synth',
      envelope: BASE_ENV,
      effects: [{ type: 'delay', wet: 0.3, time: 0.25, feedback: 1.2 }],
    })
    expect(result.success).toBe(false)
  })
})

// ── createDefaultPatch ─────────────────────────────────────────

describe('createDefaultPatch', () => {
  it('반환값이 SoundSchema를 통과한다', () => {
    expect(SoundSchema.safeParse(createDefaultPatch()).success).toBe(true)
  })

  it('kind가 patch이다', () => {
    expect(createDefaultPatch().kind).toBe('patch')
  })

  it('engine이 synth이다', () => {
    const p = createDefaultPatch()
    expect(p.kind === 'patch' && p.engine).toBe('synth')
  })

  it('filter와 effects는 undefined이다(기본값은 최소 패치)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.filter).toBeUndefined()
      expect(p.effects).toBeUndefined()
    } else {
      throw new Error('expected patch')
    }
  })
})

// ── serialize 라운드트립 ────────────────────────────────────────

function makeProjectWithSound(sound: Sound) {
  const t = createTrack('Synth')
  const p = addTrack(createEmptyProject('Test'), t)
  return updateTrackSound(p, t.id, sound)
}

describe('patch 확장 — serialize 라운드트립', () => {
  it('기존 patch({engine, envelope})는 무손실 라운드트립', () => {
    const sound: Sound = { kind: 'patch', engine: 'synth', envelope: BASE_ENV }
    const p = makeProjectWithSound(sound)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(sound)
  })

  it('filter 있는 patch는 무손실 라운드트립', () => {
    const sound: Sound = {
      kind: 'patch',
      engine: 'fm',
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
      filter: { type: 'highpass', frequency: 500, Q: 0.7 },
    }
    expect(
      deserializeProject(serializeProject(makeProjectWithSound(sound))).tracks[0]!.sound,
    ).toEqual(sound)
  })

  it('FULL_PATCH(filter + reverb + delay)는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(FULL_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(FULL_PATCH)
  })
})
