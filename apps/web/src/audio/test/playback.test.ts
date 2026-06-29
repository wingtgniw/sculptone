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
    const engine = createPlaybackEngine({ triggerAttackRelease })
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const onEnded = vi.fn()

    await engine.play(p, t.id, onEnded)

    // 위치 리셋을 위해 stop이 악기 트리거보다 먼저 호출되어야 한다
    expect(transport.stop).toHaveBeenCalled()
    expect(transport.stop.mock.invocationCallOrder[0]!).toBeLessThan(
      triggerAttackRelease.mock.invocationCallOrder[0]!,
    )
    // 스케줄된 콜백이 즉시 실행되어 악기를 (음이름, dur, time, 정규화 velocity)로 트리거
    expect(triggerAttackRelease).toHaveBeenCalledWith('pitch60', 0.5, 0.5, 100 / 127)
    // endSec > 0 이므로 종료 콜백이 등록되고 실행되어 onEnded 호출
    expect(transport.scheduleOnce).toHaveBeenCalled()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})
