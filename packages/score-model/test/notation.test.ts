import { describe, it, expect } from 'vitest'
import {
  ticksToDurationType,
  flattenToChords,
  splitAtBarlines,
  fillRests,
  trackToNotation,
  midiToOctave,
} from '../src/notation'

// ── 공통 상수 ──────────────────────────────────────────────────
const PPQ = 480
// 4/4 박자: measureTicks = 480 * 4 * 4 / 4 = 1920
const MEASURE_TICKS = 1920

// ────────────────────────────────────────────────────────────────
// C: midiToOctave (exported pure helper)
// ────────────────────────────────────────────────────────────────

describe('midiToOctave', () => {
  it('MIDI 60(C4) → octave 4', () => {
    expect(midiToOctave(60)).toBe(4)
  })

  it('MIDI 12(C0) → octave 0', () => {
    expect(midiToOctave(12)).toBe(0)
  })

  it('MIDI 0(C-1) → octave -1', () => {
    expect(midiToOctave(0)).toBe(-1)
  })
})

// ────────────────────────────────────────────────────────────────
// ticksToDurationType
// ────────────────────────────────────────────────────────────────

describe('ticksToDurationType', () => {
  it('whole (1920 ticks) → durationType:whole, dots:0', () => {
    const r = ticksToDurationType(1920, PPQ)
    expect(r.durationType).toBe('whole')
    expect(r.dots).toBe(0)
  })

  it('half (960) → half, dots:0', () => {
    const r = ticksToDurationType(960, PPQ)
    expect(r.durationType).toBe('half')
    expect(r.dots).toBe(0)
  })

  it('quarter (480) → quarter, dots:0', () => {
    const r = ticksToDurationType(480, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(0)
  })

  it('eighth (240) → eighth, dots:0', () => {
    const r = ticksToDurationType(240, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(0)
  })

  it('16th (120) → 16th, dots:0', () => {
    const r = ticksToDurationType(120, PPQ)
    expect(r.durationType).toBe('16th')
    expect(r.dots).toBe(0)
  })

  it('dotted-half (1440) → half, dots:1', () => {
    const r = ticksToDurationType(1440, PPQ)
    expect(r.durationType).toBe('half')
    expect(r.dots).toBe(1)
  })

  it('dotted-quarter (720) → quarter, dots:1', () => {
    const r = ticksToDurationType(720, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(1)
  })

  it('dotted-eighth (360) → eighth, dots:1', () => {
    const r = ticksToDurationType(360, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(1)
  })

  it('dotted-16th (180) → 16th, dots:1', () => {
    const r = ticksToDurationType(180, PPQ)
    expect(r.durationType).toBe('16th')
    expect(r.dots).toBe(1)
  })

  it('비표준(500) → 가장 가까운 quarter(480) 반환', () => {
    // |500-480|=20 vs |500-720|=220 → quarter
    const r = ticksToDurationType(500, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(0)
  })

  it('비표준(400) → 가장 가까운 dotted-eighth(360) 반환', () => {
    // |400-360|=40 vs |400-480|=80 → dotted-eighth
    const r = ticksToDurationType(400, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(1)
  })

  it('F: 등거리 타이브레이크(300) → 짧은 쪽 eighth(240) 우선', () => {
    // |300-240|=60(eighth) == |300-360|=60(dotted-eighth) → 짧은 쪽(eighth) 반환
    const r = ticksToDurationType(300, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(0)
  })

  it('F: 등거리 타이브레이크(1680) → 짧은 쪽 dotted-half(1440) 우선', () => {
    // |1680-1440|=240(dotted-half) == |1680-1920|=240(whole) → 짧은 쪽(dotted-half) 반환
    const r = ticksToDurationType(1680, PPQ)
    expect(r.durationType).toBe('half')
    expect(r.dots).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────
// flattenToChords
// ────────────────────────────────────────────────────────────────

describe('flattenToChords', () => {
  it('빈 배열 → []', () => {
    expect(flattenToChords([])).toEqual([])
  })

  it('단일 노트 → chord 1개', () => {
    const result = flattenToChords([{ pitch: 60, start: 0, duration: 480 }])
    expect(result).toHaveLength(1)
    expect(result[0]!.pitches).toEqual([60])
    expect(result[0]!.start).toBe(0)
    expect(result[0]!.duration).toBe(480)
  })

  it('같은 start 노트 2개 → 화음 pitches:[60,64]', () => {
    const result = flattenToChords([
      { pitch: 64, start: 0, duration: 480 },
      { pitch: 60, start: 0, duration: 480 },
    ])
    expect(result).toHaveLength(1)
    // pitch 오름차순 정렬
    expect(result[0]!.pitches).toEqual([60, 64])
  })

  it('같은 start 화음: 화음 end = max(note.end)', () => {
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 480 },
      { pitch: 64, start: 0, duration: 960 }, // longer note
    ])
    expect(result[0]!.duration).toBe(960) // max end = 960
  })

  it('비겹침 노트 2개 → chord 2개, 순서 보존', () => {
    const result = flattenToChords([
      { pitch: 64, start: 480, duration: 480 },
      { pitch: 60, start: 0, duration: 480 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]!.start).toBe(0)
    expect(result[1]!.start).toBe(480)
  })

  it('오버랩 노트: chord[0].duration이 chord[1].start까지 클리핑된다', () => {
    // note A: 0→960 (half), note B: 480→960 (quarter)
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 960 },
      { pitch: 64, start: 480, duration: 480 },
    ])
    expect(result).toHaveLength(2)
    // A는 480(B's start)까지 클리핑
    expect(result[0]!.duration).toBe(480)
    expect(result[1]!.duration).toBe(480)
  })

  it('인접 노트(A.end === B.start): 클리핑 없이 chord 2개 유지', () => {
    // note A: 0→1(duration 1), note B: 1→480
    // A.end=1 = B.start=1 → 오버랩 없음, 클리핑 안 됨
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 1 },
      { pitch: 64, start: 1, duration: 479 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]!.duration).toBe(1)
  })

  it('F: zero-duration 노트(duration:0) → flattenToChords에서 제외되어 []', () => {
    // duration=0 → end=start → chord.duration=0 → duration<=0 조건에 의해 제외
    const result = flattenToChords([{ pitch: 60, start: 0, duration: 0 }])
    expect(result).toHaveLength(0)
  })

  it('E: 같은 start + 같은 pitch 중복 → pitches dedup으로 [60] (not [60,60])', () => {
    // 동일 start, 동일 pitch 노트 2개 → 화음 그룹 pitch dedup 적용
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 480 },
      { pitch: 60, start: 0, duration: 480 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.pitches).toEqual([60])
    expect(result[0]!.pitches).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────
// splitAtBarlines
// ────────────────────────────────────────────────────────────────

describe('splitAtBarlines', () => {
  it('빈 배열 → []', () => {
    expect(splitAtBarlines([], MEASURE_TICKS)).toEqual([])
  })

  it('마디 내 단일 노트 → tie 없음, measure 1개에만 포함', () => {
    const chords = [{ start: 0, duration: 480, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(1)
    expect(measures[0]).toHaveLength(1)
    expect(measures[0]![0]!.tie).toBeUndefined()
  })

  it('마디를 넘는 노트 → tie:start (앞 마디), tie:stop (뒷 마디)', () => {
    // note: start=1680, duration=480 → crosses barline at 1920
    // portion in m0: 1680→1920 = 240 ticks, tie='start'
    // portion in m1: 1920→2160 = 240 ticks, tie='stop'
    const chords = [{ start: 1680, duration: 480, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(2)
    expect(measures[0]![0]!.duration).toBe(240)
    expect(measures[0]![0]!.tie).toBe('start')
    expect(measures[1]![0]!.start).toBe(1920)
    expect(measures[1]![0]!.duration).toBe(240)
    expect(measures[1]![0]!.tie).toBe('stop')
  })

  it('3개 마디에 걸친 노트 → start/startstop/stop', () => {
    // note: start=960, duration=3840 → ends at 4800
    // m0 (0-1920): start=960, dur=960, tie='start'
    // m1 (1920-3840): start=1920, dur=1920, tie='startstop'
    // m2 (3840-5760): start=3840, dur=960, tie='stop'
    const chords = [{ start: 960, duration: 3840, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(3)
    expect(measures[0]![0]!.tie).toBe('start')
    expect(measures[1]![0]!.tie).toBe('startstop')
    expect(measures[2]![0]!.tie).toBe('stop')
  })

  it('정확히 마디 경계에서 끝나는 노트 → tie 없음', () => {
    const chords = [{ start: 960, duration: 960, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    // 960+960=1920 = 마디 끝
    expect(measures).toHaveLength(1)
    expect(measures[0]![0]!.tie).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────
// fillRests
// ────────────────────────────────────────────────────────────────

describe('fillRests', () => {
  const MS = 0
  const ME = MEASURE_TICKS // 1920

  it('코드 없음 → 마디 전체를 whole rest로 채운다', () => {
    const els = fillRests([], MS, ME, PPQ)
    expect(els).toHaveLength(1)
    expect(els[0]!.kind).toBe('rest')
    expect(els[0]!.durationType).toBe('whole')
    expect((els[0] as { ticks: number }).ticks).toBe(1920)
  })

  it('박자 시작 quarter note → 앞 gap 없음, 뒤 dotted-half rest', () => {
    // chord at 0, dur=480
    const chords = [{ start: 0, duration: 480, pitches: [60] }]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(2)
    expect(els[0]!.kind).toBe('note')
    expect(els[0]!.durationType).toBe('quarter')
    expect(els[1]!.kind).toBe('rest')
    // trailing gap = 1920-480 = 1440 → dotted-half
    expect(els[1]!.durationType).toBe('half')
    expect(els[1]!.dots).toBe(1)
    expect((els[1] as { ticks: number }).ticks).toBe(1440)
  })

  it('마디 두 번째 박에 시작하는 노트 → quarter rest 앞에, half rest 뒤에', () => {
    // chord at 480, dur=480
    const chords = [{ start: 480, duration: 480, pitches: [60] }]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(3)
    expect(els[0]!.kind).toBe('rest')
    expect(els[0]!.durationType).toBe('quarter')
    expect(els[1]!.kind).toBe('note')
    expect(els[2]!.kind).toBe('rest')
    expect(els[2]!.durationType).toBe('half')
  })

  it('두 quarter 노트 연속 → 사이 gap 없음, 뒤 half rest', () => {
    const chords = [
      { start: 0, duration: 480, pitches: [60] },
      { start: 480, duration: 480, pitches: [64] },
    ]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(3) // note, note, rest(half)
    expect(els[0]!.kind).toBe('note')
    expect(els[1]!.kind).toBe('note')
    expect(els[2]!.kind).toBe('rest')
    expect(els[2]!.durationType).toBe('half')
  })

  it('타이 정보는 note element에 보존된다', () => {
    const chords = [{ start: 0, duration: 240, pitches: [60], tie: 'start' as const }]
    const els = fillRests(chords, MS, ME, PPQ)
    const noteEl = els.find((e) => e.kind === 'note')
    expect((noteEl as { tie?: string }).tie).toBe('start')
  })
})

// ────────────────────────────────────────────────────────────────
// trackToNotation (통합)
// ────────────────────────────────────────────────────────────────

const TRANSPORT_44 = {
  ppq: PPQ,
  tempo: 120,
  timeSignature: [4, 4] as [number, number],
  key: 'C',
}

describe('trackToNotation', () => {
  it('빈 트랙 → measures:[]', () => {
    const result = trackToNotation({ notes: [] }, TRANSPORT_44)
    expect(result.measures).toHaveLength(0)
  })

  it('단일 quarter 노트 → 1마디, 노트 + rest', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(1)
    const els = result.measures[0]!.elements
    expect(els[0]!.kind).toBe('note')
    expect((els[0] as { durationType: string }).durationType).toBe('quarter')
    expect((els[0] as { pitches: number[] }).pitches).toEqual([60])
    // trailing rest
    expect(els[1]!.kind).toBe('rest')
  })

  it('같은 start 2개 노트 → 화음 pitches:[60,64]', () => {
    const notes = [
      { pitch: 60, start: 0, duration: 480, id: '1', velocity: 96 },
      { pitch: 64, start: 0, duration: 480, id: '2', velocity: 80 },
    ]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    const el = result.measures[0]!.elements[0]!
    expect(el.kind).toBe('note')
    expect((el as { pitches: number[] }).pitches).toEqual([60, 64])
  })

  it('2마디에 걸친 노트 → 2마디 생성, tie 존재', () => {
    // note: start=1680, dur=480 → crosses barline at 1920
    const notes = [{ pitch: 60, start: 1680, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(2)
    // 마디 0 마지막 요소에 tie:'start'
    const m0 = result.measures[0]!.elements
    const tieStart = m0.find((e) => e.kind === 'note' && (e as { tie?: string }).tie === 'start')
    expect(tieStart).toBeDefined()
    // 마디 1 첫 요소에 tie:'stop'
    const m1 = result.measures[1]!.elements
    const tieStop = m1.find((e) => e.kind === 'note' && (e as { tie?: string }).tie === 'stop')
    expect(tieStop).toBeDefined()
  })

  it('오버랩 노트: 앞 노트 클리핑 후 두 별도 chord로 표시', () => {
    // note A: 0→960, note B: 480→960
    // After clip: A(0, dur=480), B(480, dur=480)
    const notes = [
      { pitch: 60, start: 0, duration: 960, id: '1', velocity: 96 },
      { pitch: 64, start: 480, duration: 480, id: '2', velocity: 80 },
    ]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    const els = result.measures[0]!.elements
    const noteEls = els.filter((e) => e.kind === 'note')
    expect(noteEls).toHaveLength(2)
    // 첫 노트는 pitch 60만 (A 단독)
    expect((noteEls[0] as { pitches: number[] }).pitches).toEqual([60])
    // 두 번째 노트는 pitch 64
    expect((noteEls[1] as { pitches: number[] }).pitches).toEqual([64])
  })

  it('두 번째 마디에만 노트 → 2마디 생성', () => {
    const notes = [{ pitch: 60, start: 1920, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(2)
    const m1 = result.measures[1]!.elements
    expect(m1.find((e) => e.kind === 'note')).toBeDefined()
  })
})
