import { describe, it, expect } from 'vitest'
import { pxToTicks, pxToSemitones, computeMove, computeResize, computeGroupMove } from '../drag'
import { PITCH_LOW, PITCH_HIGH, LANE_HEIGHT, PX_PER_BEAT } from '../geometry'

const PPQ = 480
const GRID = 120 // divisionToTicks(16, 480) = 480*4/16 = 120

// ── pxToTicks ────────────────────────────────────────────────

describe('pxToTicks', () => {
  it('1박(PX_PER_BEAT px) = PPQ 틱', () => {
    expect(pxToTicks(PX_PER_BEAT, PPQ)).toBeCloseTo(PPQ)
  })

  it('음수 px → 음수 틱 (왼쪽 드래그)', () => {
    expect(pxToTicks(-PX_PER_BEAT, PPQ)).toBeCloseTo(-PPQ)
  })

  it('0 → 0', () => {
    expect(pxToTicks(0, PPQ)).toBe(0)
  })
})

// ── pxToSemitones ────────────────────────────────────────────

describe('pxToSemitones', () => {
  it('1 레인 아래(+laneHeight) → -1 반음 (낮은 피치)', () => {
    expect(pxToSemitones(LANE_HEIGHT, LANE_HEIGHT)).toBe(-1)
  })

  it('1 레인 위(-laneHeight) → +1 반음 (높은 피치)', () => {
    expect(pxToSemitones(-LANE_HEIGHT, LANE_HEIGHT)).toBe(1)
  })

  it('0 → 0 (수직 이동 없음)', () => {
    expect(pxToSemitones(0, LANE_HEIGHT)).toBe(0)
  })

  it('0.4 레인 아래 → 반올림 0 (반음 경계 미만)', () => {
    expect(pxToSemitones(LANE_HEIGHT * 0.4, LANE_HEIGHT)).toBe(0)
  })

  it('0.6 레인 아래 → 반올림 -1 (반음 경계 초과)', () => {
    expect(pxToSemitones(LANE_HEIGHT * 0.6, LANE_HEIGHT)).toBe(-1)
  })

  // Fix #4 — round-half-away-from-zero 대칭 검증 (dy=±12, laneHeight=24 = 정확히 0.5 레인)
  it('±0.5 레인 경계(dy=+12, laneHeight=24) → -1 반음 (round-half-away-from-zero)', () => {
    // Math.round(0.5) = 1 이므로 양수 방향은 기존과 동일. 대칭 보장 확인.
    expect(pxToSemitones(12, 24)).toBe(-1)
  })

  it('±0.5 레인 경계(dy=-12, laneHeight=24) → +1 반음 (round-half-away-from-zero)', () => {
    // Math.round(-0.5) = 0 (JS 기존 동작) → 구 코드에서 0 반환. Fix #4 후 +1 반환.
    expect(pxToSemitones(-12, 24)).toBe(1)
  })
})

// ── computeMove ──────────────────────────────────────────────

describe('computeMove', () => {
  const note = { start: 240, pitch: 60 }

  it('기본 이동: deltaTicks=GRID, deltaSemitones=-1 → start·pitch 변경', () => {
    const r = computeMove(note, GRID, -1, GRID)
    // snap(240+120, 120) = 360
    expect(r.start).toBe(360)
    // 60 - 1 = 59
    expect(r.pitch).toBe(59)
  })

  it('start는 0 미만으로 클램프된다 (큰 음수 delta)', () => {
    const r = computeMove(note, -9999, 0, GRID)
    expect(r.start).toBe(0)
  })

  it('pitch는 PITCH_LOW 미만으로 내려가지 않는다', () => {
    const r = computeMove({ start: 0, pitch: PITCH_LOW }, 0, -10, GRID)
    expect(r.pitch).toBe(PITCH_LOW)
  })

  it('pitch는 PITCH_HIGH를 초과하지 않는다', () => {
    const r = computeMove({ start: 0, pitch: PITCH_HIGH }, 0, +10, GRID)
    expect(r.pitch).toBe(PITCH_HIGH)
  })

  it('gridTicks=0: 스냅 없이 자유 이동', () => {
    const r = computeMove({ start: 100, pitch: 60 }, 37, 0, 0)
    expect(r.start).toBe(137)
  })

  it('정확히 그리드 경계(360 = 3×GRID): 스냅 유지', () => {
    const r = computeMove({ start: 0, pitch: 60 }, 360, 0, GRID)
    expect(r.start).toBe(360)
  })

  it('양자화 반올림: 1.5그리드(180) → 상위 그리드(240)', () => {
    // snap(0+180, 120) = round(1.5)*120 = 2*120 = 240
    const r = computeMove({ start: 0, pitch: 60 }, 180, 0, GRID)
    expect(r.start).toBe(240)
  })

  it('pitch와 start 동시 변경(통합)', () => {
    const r = computeMove({ start: 480, pitch: 70 }, -GRID, 2, GRID)
    // snap(480-120, 120) = snap(360, 120) = 360
    expect(r.start).toBe(360)
    // 70 + 2 = 72, within range
    expect(r.pitch).toBe(72)
  })
})

// ── computeResize ────────────────────────────────────────────

describe('computeResize', () => {
  const note = { duration: 480 }

  it('기본 리사이즈: delta=GRID → duration 증가', () => {
    const r = computeResize(note, GRID, GRID)
    // snap(480+120, 120) = 600
    expect(r.duration).toBe(600)
  })

  it('최소 1그리드(gridTicks > 0) 보장 (큰 음수 delta)', () => {
    const r = computeResize(note, -9999, GRID)
    // snap(480-9999, 120) 은 음수 → max(120, 음수) = 120
    expect(r.duration).toBe(GRID)
  })

  it('gridTicks=0: 최소 1틱 보장 (큰 음수 delta)', () => {
    const r = computeResize({ duration: 1 }, -9999, 0)
    // snap(-9998, 0) = -9998 → max(1, -9998) = 1
    expect(r.duration).toBe(1)
  })

  it('gridTicks=0: 스냅 없이 자유 리사이즈', () => {
    const r = computeResize({ duration: 100 }, 37, 0)
    // snap(137, 0) = 137 → max(1, 137) = 137
    expect(r.duration).toBe(137)
  })

  it('양자화 반올림: 1.508그리드 오버 → 상위 그리드', () => {
    // snap(480+181, 120) = snap(661, 120) = round(5.508)*120 = 6*120 = 720
    const r = computeResize({ duration: 480 }, 181, GRID)
    expect(r.duration).toBe(720)
  })

  it('소폭 감소(delta 음수): gridTicks 이상 보장', () => {
    // snap(480-180, 120) = snap(300, 120) = round(2.5)*120 = 3*120 = 360
    // max(120, 360) = 360
    const r = computeResize({ duration: 480 }, -180, GRID)
    expect(r.duration).toBe(360)
  })
})

// ── computeGroupMove ──────────────────────────────────────────

describe('computeGroupMove', () => {
  const GRID = 120 // divisionToTicks(16, 480)

  // ── 빈 배열 ────────────────────────────────────────────────

  it('빈 originNotes → { tickDelta:0, pitchDelta:0 }', () => {
    const r = computeGroupMove([], 500, 3, GRID)
    expect(r.tickDelta).toBe(0)
    expect(r.pitchDelta).toBe(0)
  })

  // ── 틱 스냅 ────────────────────────────────────────────────

  it('rawTickDelta=130, grid=120 → snap(130,120)=120 → tickDelta=120', () => {
    const notes = [{ start: 240, pitch: 60 }]
    // snap(130, 120) = round(130/120)*120 = round(1.083)*120 = 1*120 = 120
    const r = computeGroupMove(notes, 130, 0, GRID)
    expect(r.tickDelta).toBe(120)
  })

  it('rawTickDelta=180(1.5 grid) → snap(180,120)=240 (round-half-up)', () => {
    // snap(180, 120) = round(1.5)*120 = 2*120 = 240
    const notes = [{ start: 0, pitch: 60 }]
    const r = computeGroupMove(notes, 180, 0, GRID)
    expect(r.tickDelta).toBe(240)
  })

  it('gridTicks=0: 스냅 없이 rawTickDelta 그대로', () => {
    const notes = [{ start: 240, pitch: 60 }]
    const r = computeGroupMove(notes, 77, 0, 0)
    expect(r.tickDelta).toBe(77)
  })

  // ── tick 그룹 클램프 ────────────────────────────────────────

  it('start=0 노트 포함: 음수 tickDelta 불가(클램프)', () => {
    const notes = [
      { start: 0, pitch: 60 },
      { start: 480, pitch: 62 },
    ]
    // rawTickDelta=-120, snap(-120,120)=-120 → max(-120, -0) = 0
    const r = computeGroupMove(notes, -120, 0, GRID)
    expect(r.tickDelta).toBe(0)
  })

  it('start=240 최소: tickDelta >= -240 (왼쪽으로 최대 240틱)', () => {
    const notes = [
      { start: 240, pitch: 60 },
      { start: 960, pitch: 62 },
    ]
    // rawTickDelta=-9999, snap=-9999/0=-…, max(snap, -240)=-240 (grid=0로 테스트)
    const r = computeGroupMove(notes, -9999, 0, 0)
    expect(r.tickDelta).toBe(-240)
  })

  // ── pitch 그룹 클램프 ───────────────────────────────────────

  it('pitch=PITCH_LOW 노트 포함: 음수 pitchDelta 불가(클램프)', () => {
    // 하단 노트가 이미 PITCH_LOW → 더 내려갈 수 없다 (PITCH_LOW - PITCH_LOW = 0)
    const notes = [
      { start: 0, pitch: PITCH_LOW },
      { start: 0, pitch: 60 },
    ]
    const r = computeGroupMove(notes, 0, -5, GRID)
    expect(r.pitchDelta).toBe(0)
  })

  it('pitch=PITCH_HIGH 노트 포함: 양수 pitchDelta 불가(클램프)', () => {
    // 상단 노트가 이미 PITCH_HIGH → 더 올라갈 수 없다 (PITCH_HIGH - PITCH_HIGH = 0)
    const notes = [
      { start: 0, pitch: 60 },
      { start: 0, pitch: PITCH_HIGH },
    ]
    const r = computeGroupMove(notes, 0, 3, GRID)
    expect(r.pitchDelta).toBe(0)
  })

  it('pitchDelta 클램프: minPitch=60, maxPitch=72 → delta range [PITCH_LOW-60, PITCH_HIGH-72]=[-24..12]', () => {
    // [PITCH_LOW-60, PITCH_HIGH-72] = [36-60, 84-72] = [-24, 12]
    const notes = [
      { start: 0, pitch: 60 },
      { start: 0, pitch: 72 },
    ]
    const rUp = computeGroupMove(notes, 0, 20, GRID)
    expect(rUp.pitchDelta).toBe(12) // 클램프: PITCH_HIGH - 72 = 12
    const rDown = computeGroupMove(notes, 0, -30, GRID)
    expect(rDown.pitchDelta).toBe(-24) // 클램프: PITCH_LOW - 60 = -24
    const rOk = computeGroupMove(notes, 0, 5, GRID)
    expect(rOk.pitchDelta).toBe(5) // 클램프 없음
  })

  it('group-move: 상단 노트가 PITCH_HIGH 초과하지 않음 (가시 범위 클램프)', () => {
    // notes at 70 and 80; rawDelta=+20 → new: min(PITCH_HIGH-80, 20) = min(4, 20) = 4
    const notes = [
      { start: 0, pitch: 70 },
      { start: 0, pitch: 80 },
    ]
    const r = computeGroupMove(notes, 0, 20, GRID)
    expect(r.pitchDelta).toBe(PITCH_HIGH - 80) // 4
  })

  it('group-move: 하단 노트가 PITCH_LOW 미만으로 못 감 (가시 범위 클램프)', () => {
    // notes at 40 and 60; rawDelta=-10 → new: max(PITCH_LOW-40, -10) = max(-4, -10) = -4
    const notes = [
      { start: 0, pitch: 40 },
      { start: 0, pitch: 60 },
    ]
    const r = computeGroupMove(notes, 0, -10, GRID)
    expect(r.pitchDelta).toBe(PITCH_LOW - 40) // -4
  })

  // ── 통합: tick + pitch 동시 ─────────────────────────────────

  it('tick과 pitch 동시 이동 및 클램프', () => {
    const notes = [
      { start: 120, pitch: 60 },
      { start: 240, pitch: 70 },
    ]
    // rawTickDelta=130 → snap=120, clamp max(-120, -120)=-120 실제 minStart=120이므로 OK
    // rawPitchDelta=-100 → clamp(-100, PITCH_LOW-60=-24, PITCH_HIGH-70=14) → -24
    const r = computeGroupMove(notes, 130, -100, GRID)
    expect(r.tickDelta).toBe(120)
    expect(r.pitchDelta).toBe(-24)
  })
})
