import { describe, it, expect } from 'vitest'
import { SoundSchema } from '../src/schema'
import { createDefaultPatch, createEmptyProject, createTrack } from '../src/factory'
import { addTrack, updateTrackSound } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'
import type { Sound } from '../src/schema'

// ── 공통 픽스처 ─────────────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: BASE_ENV,
}

const WITH_OSC: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: BASE_ENV,
  oscillator: { type: 'square', detune: 100 },
}

const WITH_LFO: Sound = {
  kind: 'patch',
  engine: 'am',
  envelope: BASE_ENV,
  lfo: { target: 'filter', rate: 2, depth: 0.5 },
}

const FULL_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: BASE_ENV,
  filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
  effects: [{ type: 'reverb', wet: 0.3, decay: 2.5 }],
  oscillator: { type: 'sawtooth', detune: -50 },
  lfo: { target: 'amplitude', rate: 5, depth: 0.8 },
}

// ── SoundSchema — 스키마 유효성 ─────────────────────────────────

describe('SoundSchema — oscillator/lfo 확장 유효성', () => {
  it('기존 patch(filter/effects 없음)는 oscillator/lfo 없이도 유효하다(하위호환)', () => {
    expect(SoundSchema.safeParse(BASE_PATCH).success).toBe(true)
  })

  it('oscillator(type/detune) 추가된 patch는 유효하다', () => {
    expect(SoundSchema.safeParse(WITH_OSC).success).toBe(true)
  })

  it('lfo(target/rate/depth) 추가된 patch는 유효하다', () => {
    expect(SoundSchema.safeParse(WITH_LFO).success).toBe(true)
  })

  it('oscillator + lfo + filter + effects 모두 있는 FULL_PATCH는 유효하다', () => {
    expect(SoundSchema.safeParse(FULL_PATCH).success).toBe(true)
  })

  it('oscillator.type이 triangle인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'triangle', detune: 0 },
    }).success).toBe(true)
  })

  it('oscillator.detune가 음수(-1200)인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'sine', detune: -1200 },
    }).success).toBe(true)
  })

  it('잘못된 oscillator.type("noise")은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'noise', detune: 0 },
    }).success).toBe(false)
  })

  it('lfo.target이 pitch인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'pitch', rate: 1, depth: 0.3 },
    }).success).toBe(true)
  })

  it('lfo.target이 amplitude인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'amplitude', rate: 0.5, depth: 1 },
    }).success).toBe(true)
  })

  it('잘못된 lfo.target("volume")은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'volume', rate: 1, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.rate <= 0은 거부된다(z.number().positive())', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: 0, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.rate 음수는 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: -1, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.depth > 1은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: 1, depth: 1.5 },
    }).success).toBe(false)
  })

  it('lfo.depth < 0은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'pitch', rate: 1, depth: -0.1 },
    }).success).toBe(false)
  })
})

// ── createDefaultPatch — oscillator/lfo 기본값 ──────────────────

describe('createDefaultPatch — oscillator/lfo 미설정 확인', () => {
  it('반환값이 SoundSchema를 통과한다', () => {
    expect(SoundSchema.safeParse(createDefaultPatch()).success).toBe(true)
  })

  it('oscillator는 undefined이다(최소 패치 유지)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.oscillator).toBeUndefined()
    } else {
      throw new Error('expected patch')
    }
  })

  it('lfo는 undefined이다(최소 패치 유지)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.lfo).toBeUndefined()
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

describe('oscillator/lfo — serialize 라운드트립', () => {
  it('oscillator 없는 기존 patch는 무손실 라운드트립(하위호환)', () => {
    const p = makeProjectWithSound(BASE_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(BASE_PATCH)
  })

  it('oscillator 있는 patch는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(WITH_OSC)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(WITH_OSC)
  })

  it('lfo 있는 patch는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(WITH_LFO)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(WITH_LFO)
  })

  it('FULL_PATCH(oscillator + lfo + filter + reverb)는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(FULL_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(FULL_PATCH)
  })
})
