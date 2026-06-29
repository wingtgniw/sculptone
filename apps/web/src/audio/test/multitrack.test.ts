import { describe, it, expect } from 'vitest'
import {
  audibleTrackIds,
  buildMultiSchedule,
  linearToDb,
} from '../multitrack'
import {
  createEmptyProject, createTrack, createNote,
  addTrack, addNote, updateTrackMixer,
} from '@sculptone/score-model'

// ── 테스트 픽스처 ──────────────────────────────────────────────

function makeProject() {
  const t1 = createTrack('Piano')
  const t2 = createTrack('Bass')
  const t3 = createTrack('Drums')
  let p = createEmptyProject('Test')
  p = addTrack(p, t1)
  p = addTrack(p, t2)
  p = addTrack(p, t3)
  // Piano: note at tick 0, 480t duration, pitch 60
  p = addNote(p, t1.id, createNote({ pitch: 60, start: 0,   duration: 480, velocity: 96 }))
  // Bass: note at tick 480, pitch 36
  p = addNote(p, t2.id, createNote({ pitch: 36, start: 480, duration: 960, velocity: 80 }))
  // Drums: no notes
  return { p, ids: { t1: t1.id, t2: t2.id, t3: t3.id } }
}

// ── audibleTrackIds ───────────────────────────────────────────

describe('audibleTrackIds', () => {
  it('솔로·뮤트 없음: 모든 트랙 반환', () => {
    const { p, ids } = makeProject()
    expect(audibleTrackIds(p)).toEqual([ids.t1, ids.t2, ids.t3])
  })

  it('뮤트된 트랙 제외', () => {
    const { p, ids } = makeProject()
    const muted = updateTrackMixer(p, ids.t2, { muted: true })
    expect(audibleTrackIds(muted)).toEqual([ids.t1, ids.t3])
  })

  it('솔로 트랙이 있으면 솔로 집합만 반환 (뮤트 재정의)', () => {
    const { p, ids } = makeProject()
    // t1 muted + t2 soloed → t2만 audible
    let q = updateTrackMixer(p, ids.t1, { muted: true })
    q = updateTrackMixer(q, ids.t2, { soloed: true })
    expect(audibleTrackIds(q)).toEqual([ids.t2])
  })

  it('여러 트랙 솔로: 솔로된 트랙 모두 반환', () => {
    const { p, ids } = makeProject()
    let q = updateTrackMixer(p, ids.t1, { soloed: true })
    q = updateTrackMixer(q, ids.t3, { soloed: true })
    expect(audibleTrackIds(q)).toEqual([ids.t1, ids.t3])
  })

  it('모든 트랙 뮤트: 빈 배열', () => {
    const { p, ids } = makeProject()
    let q = updateTrackMixer(p, ids.t1, { muted: true })
    q = updateTrackMixer(q, ids.t2, { muted: true })
    q = updateTrackMixer(q, ids.t3, { muted: true })
    expect(audibleTrackIds(q)).toEqual([])
  })

  it('트랙 없는 프로젝트: 빈 배열', () => {
    expect(audibleTrackIds(createEmptyProject('Empty'))).toEqual([])
  })
})

// ── buildMultiSchedule ────────────────────────────────────────

describe('buildMultiSchedule', () => {
  it('각 audible 트랙의 노트를 timeSec/durationSec으로 변환하며 trackId를 포함', () => {
    const { p, ids } = makeProject()
    const items = buildMultiSchedule(p, [ids.t1, ids.t2])
    // t1: pitch60, start 0 → 0s, dur 480t → 0.5s (120BPM ppq480)
    // t2: pitch36, start 480t → 0.5s, dur 960t → 1s
    expect(items).toHaveLength(2)
    const item1 = items.find((x) => x.trackId === ids.t1)!
    expect(item1.timeSec).toBeCloseTo(0)
    expect(item1.durationSec).toBeCloseTo(0.5)
    expect(item1.pitch).toBe(60)
    expect(item1.velocity).toBeCloseTo(96 / 127)
    const item2 = items.find((x) => x.trackId === ids.t2)!
    expect(item2.timeSec).toBeCloseTo(0.5)
    expect(item2.durationSec).toBeCloseTo(1)
    expect(item2.pitch).toBe(36)
  })

  it('audibleIds가 비어있으면 빈 배열 반환', () => {
    const { p } = makeProject()
    expect(buildMultiSchedule(p, [])).toEqual([])
  })

  it('노트 없는 트랙은 아이템 0개 기여', () => {
    const { p, ids } = makeProject()
    const items = buildMultiSchedule(p, [ids.t3])
    expect(items).toHaveLength(0)
  })

  it('여러 노트를 가진 트랙은 모두 포함', () => {
    const { p, ids } = makeProject()
    let q = addNote(p, ids.t1, createNote({ pitch: 62, start: 480, duration: 240, velocity: 64 }))
    const items = buildMultiSchedule(q, [ids.t1])
    expect(items).toHaveLength(2)
    expect(items.every((x) => x.trackId === ids.t1)).toBe(true)
  })
})

// ── linearToDb ────────────────────────────────────────────────

describe('linearToDb', () => {
  it('v=1 → 0dB', () => {
    expect(linearToDb(1)).toBeCloseTo(0)
  })
  it('v=0.5 → ≈ -6.02dB', () => {
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1)
  })
  it('v=0 → -Infinity', () => {
    expect(linearToDb(0)).toBe(-Infinity)
  })
  it('v<0 → -Infinity (방어)', () => {
    expect(linearToDb(-0.1)).toBe(-Infinity)
  })
  it('v=0.8 (기본 volume) → ≈ -1.94dB', () => {
    expect(linearToDb(0.8)).toBeCloseTo(-1.94, 1)
  })
})
