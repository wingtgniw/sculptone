import { describe, it, expect } from 'vitest'
import {
  velocityToHeight,
  computeVelocityFromDrag,
  computeGroupVelocityDelta,
  VELOCITY_LANE_HEIGHT,
} from '../velocity'

// ── velocityToHeight ─────────────────────────────────────────

describe('velocityToHeight', () => {
  it('velocity=0 → 0', () => {
    expect(velocityToHeight(0, 80)).toBe(0)
  })

  it('velocity=127 → laneHeight (80)', () => {
    expect(velocityToHeight(127, 80)).toBe(80)
  })

  it('velocity=64 → Math.round(64*80/127) = Math.round(40.31) = 40', () => {
    // 64*80/127 = 5120/127 ≈ 40.315... → round = 40
    expect(velocityToHeight(64, 80)).toBe(40)
  })

  it('velocity=100, laneHeight=100 → Math.round(100*100/127)=Math.round(78.74)=79', () => {
    expect(velocityToHeight(100, 100)).toBe(79)
  })

  it('velocity=1 → Math.round(1*80/127) = Math.round(0.63) = 1 (최소 가시성 아님, 스펙 단순화)', () => {
    // round(0.63)=1 — not 0; velocity=1은 최솟값 이상이므로 1px 이상
    expect(velocityToHeight(1, 80)).toBe(1)
  })

  it('laneHeight 파라미터 다양화: velocity=127, laneHeight=100 → 100', () => {
    expect(velocityToHeight(127, 100)).toBe(100)
  })

  it('VELOCITY_LANE_HEIGHT 상수가 양수 정수다', () => {
    expect(VELOCITY_LANE_HEIGHT).toBeGreaterThan(0)
    expect(Number.isInteger(VELOCITY_LANE_HEIGHT)).toBe(true)
  })
})

// ── computeVelocityFromDrag ───────────────────────────────────

describe('computeVelocityFromDrag', () => {
  const H = 80 // laneHeight

  it('dy=0 → origVelocity 그대로 (움직임 없음)', () => {
    expect(computeVelocityFromDrag(64, 0, H)).toBe(64)
  })

  it('dy<0 (위로 드래그) → velocity 증가', () => {
    // dy=-80 (전체 레인 위로) → delta = round(80*127/80) = round(127) = 127
    // newVel = min(127, max(0, 64+127)) = 127
    const result = computeVelocityFromDrag(64, -80, H)
    expect(result).toBeGreaterThan(64)
  })

  it('dy>0 (아래로 드래그) → velocity 감소', () => {
    const result = computeVelocityFromDrag(64, 40, H)
    expect(result).toBeLessThan(64)
  })

  it('상한 클램프: origVelocity=100, dy=-80(full up) → 127', () => {
    // delta = 127 → 100+127=227 → clamp(0,127)=127
    expect(computeVelocityFromDrag(100, -80, H)).toBe(127)
  })

  it('하한 클램프: origVelocity=20, dy=80(full down) → 0', () => {
    // delta = -127 → 20-127=-107 → clamp(0,127)=0
    expect(computeVelocityFromDrag(20, 80, H)).toBe(0)
  })

  it('반환값은 정수다', () => {
    const result = computeVelocityFromDrag(50, 13, H)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('dy=-laneHeight(full-up): vel=0 → 127', () => {
    // delta = round(80*127/80) = 127; 0+127=127
    expect(computeVelocityFromDrag(0, -80, H)).toBe(127)
  })

  it('dy=laneHeight(full-down): vel=127 → 0', () => {
    // delta = -127; 127-127=0
    expect(computeVelocityFromDrag(127, 80, H)).toBe(0)
  })
})

// ── computeGroupVelocityDelta ─────────────────────────────────

describe('computeGroupVelocityDelta', () => {
  it('빈 배열 → 0', () => {
    expect(computeGroupVelocityDelta([], 50)).toBe(0)
  })

  it('단일 원소 배열은 단일 clamp와 같다', () => {
    // vel=[64], rawDelta=100 → max delta=127-64=63 → clamp=63
    expect(computeGroupVelocityDelta([64], 100)).toBe(63)
  })

  it('rawDelta가 모든 노트를 127 이하로 유지 → 원본 반환', () => {
    // vels=[60,80], rawDelta=10 → max delta = 127-80=47 → 10 ≤ 47 → return 10
    expect(computeGroupVelocityDelta([60, 80], 10)).toBe(10)
  })

  it('rawDelta가 최대치 노트를 초과 → 클램프', () => {
    // vels=[60,80], rawDelta=50 → max delta=127-80=47 → 50 clamp to 47
    expect(computeGroupVelocityDelta([60, 80], 50)).toBe(47)
  })

  it('음수 rawDelta가 최솟값 노트를 0 미만으로 → 클램프', () => {
    // vels=[20,80], rawDelta=-30 → min delta=0-20=-20 → -30 clamp to -20
    expect(computeGroupVelocityDelta([20, 80], -30)).toBe(-20)
  })

  it('min=0 노트 포함: 음수 delta 불가', () => {
    // vels=[0,60], rawDelta=-10 → min delta=0-0=0 → clamp(-10, 0, ...) = 0
    expect(computeGroupVelocityDelta([0, 60], -10)).toBe(0)
  })

  it('max=127 노트 포함: 양수 delta 불가', () => {
    // vels=[60,127], rawDelta=10 → max delta=127-127=0 → clamp(10, ..., 0) = 0
    expect(computeGroupVelocityDelta([60, 127], 10)).toBe(0)
  })

  it('rawDelta=0 → 0', () => {
    expect(computeGroupVelocityDelta([40, 80], 0)).toBe(0)
  })

  it('단일=그룹 일관성: 단일 노트 그룹은 단일 clamp와 동일', () => {
    // 단일 드래그에서 clamp: min(127-vel, max(-vel, rawDelta))
    // 그룹(단일 원소): 동일 공식
    const vel = 90
    const rawDelta = -100 // → clamp to -90
    expect(computeGroupVelocityDelta([vel], rawDelta)).toBe(-90)
  })
})
