import { describe, it, expect } from 'vitest'
import { pxToTicks, pxToSemitones, computeMove, computeResize } from '../drag'
import { PITCH_LOW, PITCH_HIGH, LANE_HEIGHT, PX_PER_BEAT } from '../geometry'

const PPQ = 480
const GRID = 120  // divisionToTicks(16, 480) = 480*4/16 = 120

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
