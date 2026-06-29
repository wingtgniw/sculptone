import { describe, it, expect, vi, beforeEach } from 'vitest'

// 살아있는 Tone 모킹: schedule/scheduleOnce가 콜백을 즉시 실행한다.
const transport = {
  bpm: { value: 120 },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn((cb: (t: number) => void, time: number) => { cb(time) }),
  scheduleOnce: vi.fn((cb: (t: number) => void, time: number) => { cb(time) }),
  get seconds() { return 0 },
}

vi.mock('tone', () => {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    getTransport: () => transport,
    Frequency: (n: number, _u: string) => ({ toNote: () => `pitch${n}` }),
  }
})

import { buildSchedule, createPlaybackEngine } from '../playback'
import { linearToDb } from '../multitrack'
import { createEmptyProject, createTrack, createNote, addTrack, addNote } from '@sculptone/score-model'

describe('buildSchedule', () => {
  it('각 노트를 시작 초(seconds)로 변환해 스케줄 항목을 만든다', () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const items = buildSchedule(p, t.id)
    expect(items).toHaveLength(1)
    // 120BPM ppq480: start 480tick = 0.5s, duration 480tick = 0.5s
    expect(items[0]!.timeSec).toBeCloseTo(0.5)
    expect(items[0]!.durationSec).toBeCloseTo(0.5)
    expect(items[0]!.pitch).toBe(60)
  })

  it('velocity를 0..1로 정규화하고 노트 2개를 순서대로 매핑한다', () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    p = addNote(p, t.id, createNote({ pitch: 67, start: 960, duration: 240, velocity: 64 }))
    const items = buildSchedule(p, t.id)
    expect(items).toHaveLength(2)
    // 첫 노트
    expect(items[0]!.pitch).toBe(60)
    expect(items[0]!.timeSec).toBeCloseTo(0.5)
    expect(items[0]!.durationSec).toBeCloseTo(0.5)
    expect(items[0]!.velocity).toBeCloseTo(100 / 127)
    // 둘째 노트
    expect(items[1]!.pitch).toBe(67)
    expect(items[1]!.timeSec).toBeCloseTo(1.0)
    expect(items[1]!.durationSec).toBeCloseTo(0.25)
    expect(items[1]!.velocity).toBeCloseTo(64 / 127)
  })
})

describe('createPlaybackEngine.play', () => {
  beforeEach(() => {
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
  })

  it('재생 시 stop을 먼저 호출하고 노트를 트리거하며 종료 시 onEnded를 호출한다', async () => {
    const triggerAttackRelease = vi.fn()
    // 새 시그니처: getInstrument 콜백 + volume 필드
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine((tid) =>
      tid === t.id ? { triggerAttackRelease, volume: { value: 0 } } : null
    )
    const onEnded = vi.fn()

    // 새 시그니처: play(project, onEnded?) — trackId 없음
    await engine.play(p, onEnded)

    // stop이 악기 트리거보다 먼저 호출되어야 한다
    expect(transport.stop).toHaveBeenCalled()
    expect(transport.stop.mock.invocationCallOrder[0]!).toBeLessThan(
      triggerAttackRelease.mock.invocationCallOrder[0]!,
    )
    // 스케줄된 콜백이 즉시 실행되어 악기를 트리거
    expect(triggerAttackRelease).toHaveBeenCalledWith('pitch60', 0.5, 0.5, 100 / 127)
    // onEnded 호출
    expect(transport.scheduleOnce).toHaveBeenCalled()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('muted 트랙의 노트는 스케줄되지 않는다 (양 트랙 모두 유효 instrument)', async () => {
    const triggerAR = vi.fn()
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    p = addNote(p, t2.id, createNote({ pitch: 36, start: 0, duration: 480, velocity: 80 }))
    // t2 muted
    p = { ...p, tracks: p.tracks.map((t) => t.id === t2.id ? { ...t, mixer: { ...t.mixer, muted: true } } : t) }

    // 모든 트랙에 유효 instrument 반환 → audible 필터만이 유일한 차별 요인
    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: triggerAR, volume: { value: 0 } }))
    await engine.play(p)
    // audible은 Piano 1개뿐 → schedule/triggerAR 각 1회 (mute 필터 제거 시 2회로 FAIL)
    expect(transport.schedule).toHaveBeenCalledTimes(1)
    expect(triggerAR).toHaveBeenCalledTimes(1)
  })

  it('재생 시 트랙 볼륨(기본 0.8)이 linearToDb로 instrument에 적용된다', async () => {
    const piano = { triggerAttackRelease: vi.fn(), volume: { value: 999 } }
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => piano)
    await engine.play(p)
    expect(piano.volume.value).toBeCloseTo(linearToDb(t.mixer.volume))
  })

  it('재생 시 임의 볼륨(0.5)도 linearToDb로 적용된다 (상수 우연통과 배제)', async () => {
    const piano = { triggerAttackRelease: vi.fn(), volume: { value: 999 } }
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    p = { ...p, tracks: p.tracks.map((tr) => tr.id === t.id ? { ...tr, mixer: { ...tr.mixer, volume: 0.5 } } : tr) }
    const engine = createPlaybackEngine(() => piano)
    await engine.play(p)
    expect(piano.volume.value).toBeCloseTo(linearToDb(0.5))
  })

  it('재생할 노트가 없으면 transport.start를 호출하지 않고 즉시 onEnded', async () => {
    const t = createTrack('Piano') // 노트 없음
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: vi.fn(), volume: { value: 0 } }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded)
    expect(transport.start).not.toHaveBeenCalled()
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('isValid가 false면(레이스) stop/schedule/transport.start를 호출하지 않는다', async () => {
    const triggerAR = vi.fn()
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: triggerAR, volume: { value: 0 } }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded, () => false)
    expect(transport.stop).not.toHaveBeenCalled()
    expect(transport.schedule).not.toHaveBeenCalled()
    expect(transport.start).not.toHaveBeenCalled()
    expect(triggerAR).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })
})
