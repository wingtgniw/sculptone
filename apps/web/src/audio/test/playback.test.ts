import { describe, it, expect, vi, beforeEach } from 'vitest'

// 살아있는 Tone 모킹: schedule/scheduleOnce가 콜백을 즉시 실행한다.
const transport = {
  bpm: { value: 120 },
  loop: false, // NEW
  loopStart: 0, // NEW
  loopEnd: 0, // NEW
  setLoopPoints: vi.fn(), // NEW
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn((cb: (t: number) => void, time: number) => {
    cb(time)
  }),
  scheduleOnce: vi.fn((cb: (t: number) => void, time: number) => {
    cb(time)
  }),
  scheduleRepeat: vi.fn(),
  get seconds() {
    return 0
  },
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
import {
  createEmptyProject,
  createTrack,
  createNote,
  addTrack,
  addNote,
} from '@sculptone/score-model'
import type { MetronomeHandle } from '../metronome'

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
    transport.scheduleRepeat.mockClear()
  })

  it('재생 시 stop을 먼저 호출하고 노트를 트리거하며 종료 시 onEnded를 호출한다', async () => {
    const triggerAttackRelease = vi.fn()
    // 새 시그니처: getInstrument 콜백 + volume 필드
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine((tid) =>
      tid === t.id ? { triggerAttackRelease, volume: { value: 0 } } : null,
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
    p = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === t2.id ? { ...t, mixer: { ...t.mixer, muted: true } } : t,
      ),
    }

    // 모든 트랙에 유효 instrument 반환 → audible 필터만이 유일한 차별 요인
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: triggerAR,
      volume: { value: 0 },
    }))
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
    p = {
      ...p,
      tracks: p.tracks.map((tr) =>
        tr.id === t.id ? { ...tr, mixer: { ...tr.mixer, volume: 0.5 } } : tr,
      ),
    }
    const engine = createPlaybackEngine(() => piano)
    await engine.play(p)
    expect(piano.volume.value).toBeCloseTo(linearToDb(0.5))
  })

  it('재생할 노트가 없으면 transport.start를 호출하지 않고 즉시 onEnded', async () => {
    const t = createTrack('Piano') // 노트 없음
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded)
    expect(transport.start).not.toHaveBeenCalled()
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('keepAlive 모드: 노트가 없어도 transport.start를 호출하고 자동종료(scheduleOnce)/onEnded를 등록하지 않는다', async () => {
    const t = createTrack('Piano') // 노트 없음
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded, undefined, { keepAlive: true })
    // 빈 트랙이어도 transport는 시작되어 Stop 전까지 유지된다
    expect(transport.start).toHaveBeenCalledTimes(1)
    // 자동종료를 등록하지 않는다 → 녹음 중 즉시 종료 방지
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('keepAlive 모드: 노트가 있어도 자동종료(scheduleOnce)를 등록하지 않고 transport.start만 호출한다', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded, undefined, { keepAlive: true })
    expect(transport.start).toHaveBeenCalledTimes(1)
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('isValid가 false면(레이스) stop/schedule/transport.start를 호출하지 않는다', async () => {
    const triggerAR = vi.fn()
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: triggerAR,
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()
    await engine.play(p, onEnded, () => false)
    expect(transport.stop).not.toHaveBeenCalled()
    expect(transport.schedule).not.toHaveBeenCalled()
    expect(transport.start).not.toHaveBeenCalled()
    expect(triggerAR).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })
})

describe('createPlaybackEngine.play — 메트로놈', () => {
  beforeEach(() => {
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
    transport.scheduleRepeat.mockClear()
  })

  it('metronome 옵션이 있으면 노트 외에 클릭 이벤트도 스케줄된다 (4/4 1마디)', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    // duration: 1920ticks = 1마디(4박 × 480ticks) at 120BPM, ppq=480 → 2.0s
    // tempo=120, ppq=480: 1마디=2s, 4박
    // transport 모킹의 bpm.value는 play()에서 설정됨
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 1920, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, {
      metronome,
      countInDurationSec: 0,
    })

    // 비-keepAlive 경로: 개별 schedule 호출로 클릭 스케줄
    // schedule mock이 cb(time)을 즉시 실행하므로 clickSpy가 바로 호출됨
    // 4/4 1마디(0..2s) → 4박: 0.0(accent), 0.5, 1.0, 1.5
    // ※ computeClickTimes에서 Math.ceil(-ε) = -0이 될 수 있으므로 closeTo로 비교
    expect(clickSpy.mock.calls).toHaveLength(4)
    expect(clickSpy.mock.calls[0]).toEqual([expect.closeTo(0), true])
    expect(clickSpy.mock.calls[1]).toEqual([expect.closeTo(0.5), false])
    expect(clickSpy.mock.calls[2]).toEqual([expect.closeTo(1.0), false])
    expect(clickSpy.mock.calls[3]).toEqual([expect.closeTo(1.5), false])
  })

  it('카운트인 오프셋이 있으면 노트 스케줄이 countInDurationSec만큼 밀린다', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    // 노트 start=0 → timeSec=0 (no countIn이면 0.0에 스케줄)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))

    const engine = createPlaybackEngine((tid) =>
      tid === t.id ? { triggerAttackRelease: vi.fn(), volume: { value: 0 } } : null,
    )

    const countInDurationSec = 2.0
    await engine.play(p, undefined, undefined, { keepAlive: true, metronome, countInDurationSec })

    // 스케줄된 콜백 중 note 스케줄의 시간은 countInDurationSec + 0 = 2.0이어야 함
    // transport.schedule: vi.fn((cb, time) => { cb(time) }) → 각 call의 args[1]이 예약 시간
    const scheduleTimes = (transport.schedule.mock.calls as [unknown, number][]).map(([, t]) => t)
    // 노트 스케줄 time = timeSec + countInDurationSec = 0 + 2.0 = 2.0
    expect(scheduleTimes).toContain(2.0)
  })

  it('카운트인 중 클릭이 0..countInDurationSec에 스케줄된다', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t) // 노트 없음

    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const countInDurationSec = 2.0

    await engine.play(p, undefined, undefined, { keepAlive: true, metronome, countInDurationSec })

    // keepAlive=true → scheduleRepeat로 t=0부터 박 간격 무한 클릭 스케줄
    // (카운트인~콘텐츠 구간을 단일 연속 스트림으로 처리 — stop() 호출 전까지 유지)
    expect(transport.scheduleRepeat).toHaveBeenCalledTimes(1)
    const repeatArgs = (transport.scheduleRepeat.mock.calls as [unknown, number, number][])[0]!
    // interval = beatDurationSec(120BPM) = 0.5s
    expect(repeatArgs[1]).toBeCloseTo(60 / 120)
    // startTime = 0 (카운트인 첫 박부터)
    expect(repeatArgs[2]).toBe(0)
  })

  it('keepAlive + metronome: scheduleRepeat로 클릭이 무한 스케줄되고 schedule 클릭 없음', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t) // 노트 없음
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, { keepAlive: true, metronome })

    // keepAlive 경로: scheduleRepeat 1회 (무한 클릭)
    expect(transport.scheduleRepeat).toHaveBeenCalledTimes(1)
    // 개별 schedule로 클릭이 등록되지 않아야 함 (노트도 없으므로 schedule 0회)
    expect(transport.schedule).not.toHaveBeenCalled()
  })

  it('getSeconds()는 transport.seconds 게터를 통해 현재 위치(초)를 반환한다', () => {
    const engine = createPlaybackEngine(() => null)
    expect(engine.getSeconds()).toBe(0)
  })

  it('metronome 없이 호출 시 기존 동작과 동일 (클릭 스케줄 없음)', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p)

    // metronome 없으면 schedule 호출 횟수 = 노트 수 + scheduleOnce(종료) = 1+1이므로
    // schedule 1회(노트), scheduleOnce 1회(종료)
    expect(transport.schedule).toHaveBeenCalledTimes(1)
    expect(transport.scheduleOnce).toHaveBeenCalledTimes(1)
  })
})

describe('createPlaybackEngine.play — 루프 모드', () => {
  beforeEach(() => {
    transport.loop = false
    transport.loopStart = 0
    transport.loopEnd = 0
    transport.setLoopPoints.mockClear()
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
    transport.scheduleRepeat.mockClear()
  })

  it('loopEnabled=true → transport.loop=true 및 setLoopPoints(startSec, endSec) 호출', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    // ppq=480, tempo=120 → loopStartTicks=0 → 0s, loopEndTicks=1920 → 2.0s
    await engine.play(p, undefined, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    expect(transport.loop).toBe(true)
    expect(transport.setLoopPoints).toHaveBeenCalledWith(expect.closeTo(0), expect.closeTo(2.0))
  })

  it('loopEnabled=true → scheduleOnce(자동종료) 미등록, transport.start는 호출됨', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()

    await engine.play(p, onEnded, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    // 루프 모드는 자동종료 없이 무한 반복
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(transport.start).toHaveBeenCalledTimes(1)
  })

  it('녹음 가드: keepAlive=true이면 loopEnabled=true여도 transport.loop=false', async () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, {
      keepAlive: true,
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    // 녹음 중에는 루프 비활성 — 녹음 타이밍 보호
    expect(transport.loop).toBe(false)
    expect(transport.setLoopPoints).not.toHaveBeenCalled()
  })

  it('loopEnabled=false(기본) → transport.loop=false, 기존 동작 불변', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()

    await engine.play(p, onEnded)

    expect(transport.loop).toBe(false)
    expect(transport.setLoopPoints).not.toHaveBeenCalled()
    // 기존 경로: scheduleOnce로 자동종료
    expect(transport.scheduleOnce).toHaveBeenCalledTimes(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('[fix1] loopEnabled=true + loopStartTicks=960(>0) → transport.start가 (undefined, loopStartSec)로 호출된다', async () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    // ppq=480, tempo=120: loopStartTicks=960 → loopStartSec = 960/480*(60/120) = 1.0s
    await engine.play(p, undefined, undefined, {
      loopEnabled: true,
      loopStartTicks: 960,
      loopEndTicks: 1920,
    })

    // loopStart>0 이면 transport.start(undefined, loopStartSec)로 offset 전달해야 한다
    expect(transport.start).toHaveBeenCalledWith(undefined, expect.closeTo(1.0))
  })

  it('loopEnabled=true + metronome → scheduleRepeat(연속 클릭), schedule 클릭 없음', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
      metronome,
    })

    // 루프 모드 메트로놈 = keepAlive와 동일하게 scheduleRepeat 사용 (무한 반복)
    expect(transport.scheduleRepeat).toHaveBeenCalledTimes(1)
    // 개별 schedule로 클릭이 등록되지 않아야 함 (노트도 없으므로 schedule 0회)
    expect(transport.schedule).not.toHaveBeenCalled()
  })
})
