import { describe, it, expect } from 'vitest'
import { recordedEventsToNotes, stepInsert } from '../recording'
import type { RawMidiEvent, RecordingContext } from '../recording'

// ── 공통 컨텍스트 ─────────────────────────────────────────────
// 120BPM, ppq=480 → 1tick = 1/480 박자, 1박 = 0.5s, 1/16 = 30ticks
const CTX_DEFAULT: RecordingContext = {
  ppq: 480,
  tempo: 120,
  quantizeDenom: 16,
  endSec: 4.0,
}

// ── recordedEventsToNotes ─────────────────────────────────────

describe('recordedEventsToNotes', () => {
  it('단일 noteon+noteoff → 피치·시작·길이·벨로시티 정확', () => {
    // noteon at 0s pitch60 vel96, noteoff at 0.5s → duration 0.5s
    // start=0s → 0 ticks → snap(0, 120)=0
    // duration=0.5s → (0.5 * 120 / 60) * 480 = 480 ticks at 120bpm ppq480
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 96, timeSec: 0.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.start).toBe(0)       // snap(0, 120)=0
    expect(notes[0]!.duration).toBe(480)   // 0.5s = 480 ticks at 120bpm ppq480
    expect(notes[0]!.velocity).toBe(96)
  })

  it('다른 피치 2개 노트 → 각각 독립적으로 매칭', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },
      { kind: 'noteon',  pitch: 64, velocity: 70, timeSec: 0.1 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
      { kind: 'noteoff', pitch: 64, velocity: 0,  timeSec: 0.6 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(2)
    const n60 = notes.find((n) => n.pitch === 60)!
    const n64 = notes.find((n) => n.pitch === 64)!
    expect(n60.velocity).toBe(80)
    expect(n64.velocity).toBe(70)
  })

  it('dangling noteon → endSec까지 지속으로 마감', () => {
    // noteon at 0s, no matching noteoff → closed at endSec=4.0s
    // duration = (4.0 * 120 / 60) * 480 = 3840 ticks
    const events: RawMidiEvent[] = [
      { kind: 'noteon', pitch: 60, velocity: 100, timeSec: 0.0 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, endSec: 4.0 })
    expect(notes).toHaveLength(1)
    expect(notes[0]!.duration).toBe(3840) // 4.0s at 120bpm ppq480
  })

  it('dangling noteon이 endSec와 같은 시점 → duration<=0으로 제외', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon', pitch: 60, velocity: 100, timeSec: 0.0 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, endSec: 0.0 })
    expect(notes).toHaveLength(0)
  })

  it('dangling noteoff (매칭 noteon 없음) → 스킵', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteoff', pitch: 60, velocity: 0, timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(0)
  })

  it('양자화 적용: start가 1/16 그리드에 스냅된다', () => {
    // 1/16 at 120bpm ppq480 = divisionToTicks(16,480) = 480*4/16 = 120 ticks
    // noteon at 0.04s → secondsToTicks(0.04, 480, 120) = 0.04*120/60*480 = 38.4 ticks
    // snap(38.4, 120) = round(38.4/120)*120 = 0*120 = 0
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.04 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.54 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(0) // 38ticks → snap to 0
  })

  it('양자화 적용: start가 가장 가까운 1/16에 스냅된다 (오른쪽)', () => {
    // noteon at 0.07s → ticks = 0.07*120/60*480 = 67.2 → snap(67.2,120) = 120
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.07 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.57 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes[0]!.start).toBe(120) // snap to next 1/16 grid
  })

  it('quantizeDenom=0 → 스냅 없이 raw ticks', () => {
    // noteon at 0.04s → ticks = 38.4 → Math.round = 38 (실제 구현은 snap(t,0)=t)
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.04 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.54 },
    ]
    const ctx: RecordingContext = { ...CTX_DEFAULT, quantizeDenom: 0 }
    const notes = recordedEventsToNotes(events, ctx)
    // snap(38.4, 0) = 38.4 → secondsToTicks 결과 그대로 (소수 발생 → Math.round로 정수화)
    // 38 ticks (Math.round(38.4))
    expect(notes[0]!.start).toBe(38)
  })

  it('최소 duration 보장: noteon과 noteoff가 동시에 → duration=1 tick', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.5 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    // duration=0 → clamped to 1
    expect(notes[0]!.duration).toBeGreaterThanOrEqual(1)
  })

  it('velocity는 noteon의 값을 보존한다', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 42, timeSec: 0.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes[0]!.velocity).toBe(42)
  })

  it('결과가 start(ticks) 오름차순으로 정렬된다', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 64, velocity: 80, timeSec: 0.5 },  // start: 240 ticks
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },  // start: 0 ticks
      { kind: 'noteoff', pitch: 64, velocity: 0,  timeSec: 1.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(2)
    expect(notes[0]!.pitch).toBe(60)  // start=0 → 먼저
    expect(notes[1]!.pitch).toBe(64)  // start=240 → 나중
  })

  it('동일 pitch의 빠른 연타: FIFO 순서로 매칭', () => {
    // 첫 번째 noteon-noteoff 쌍, 그 다음 두 번째 쌍
    // 120BPM ppq480 → 1s = 960ticks, quantizeDenom=0(스냅 없음)
    // FIFO: noteon1(0.0s)+noteoff1(0.5s) → start=0, duration=480, vel=80
    //       noteon2(0.3s)+noteoff2(0.8s) → start=288, duration=480, vel=70
    // LIFO: noteon1(0.0s)+noteoff2(0.8s) → start=0, duration=768, vel=80  ← 다름
    //       noteon2(0.3s)+noteoff1(0.5s) → start=288, duration=192, vel=70 ← 다름
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },
      { kind: 'noteon',  pitch: 60, velocity: 70, timeSec: 0.3 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.8 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, quantizeDenom: 0 })
    expect(notes).toHaveLength(2)
    // 첫 noteon(vel=80, t=0.0s)이 첫 noteoff(t=0.5s)와 매칭
    expect(notes[0]!.start).toBe(0)      // 0.0s * 960 = 0 ticks
    expect(notes[0]!.duration).toBe(480) // 0.5s * 960 = 480 ticks (LIFO이면 768)
    expect(notes[0]!.velocity).toBe(80)
    // 둘째 noteon(vel=70, t=0.3s)이 둘째 noteoff(t=0.8s)와 매칭
    expect(notes[1]!.start).toBe(288)    // 0.3s * 960 = 288 ticks
    expect(notes[1]!.duration).toBe(480) // 0.5s * 960 = 480 ticks (LIFO이면 192)
    expect(notes[1]!.velocity).toBe(70)
  })

  it('이벤트 없음 → 빈 배열', () => {
    expect(recordedEventsToNotes([], CTX_DEFAULT)).toEqual([])
  })
})

// ── stepInsert ────────────────────────────────────────────────

describe('stepInsert', () => {
  it('커서를 gridTicks만큼 전진시킨다', () => {
    expect(stepInsert(480, 120)).toBe(600)
  })

  it('커서 0에서 시작해도 전진한다', () => {
    expect(stepInsert(0, 480)).toBe(480)
  })
})
