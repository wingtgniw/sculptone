import { describe, it, expect } from 'vitest'
import {
  normalizeLoop,
  computeLoopDrawRegion,
  computeLoopMove,
  computeLoopResizeStart,
  computeLoopResizeEnd,
} from '../loop'

// PPQ=480 기준 상수: GRID = ppq*4/16 = 480*4/16 = 120
const GRID = 120 // 1/16음표 = divisionToTicks(16, 480) = 120

// ── normalizeLoop ─────────────────────────────────────────────

describe('normalizeLoop', () => {
  it('start < end이면 그대로 반환한다', () => {
    expect(normalizeLoop(0, 480)).toEqual({ loopStart: 0, loopEnd: 480 })
  })

  it('start === end이면 end = start + 1로 보정한다 (기본 minDuration=1)', () => {
    const r = normalizeLoop(240, 240)
    expect(r.loopStart).toBe(240)
    expect(r.loopEnd).toBe(241)
  })

  it('start > end이면 end = start + 1로 보정한다', () => {
    const r = normalizeLoop(480, 240)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBe(481)
  })

  it('음수 start는 0으로 클램프된다', () => {
    const r = normalizeLoop(-100, 480)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('음수 end는 0으로 클램프되고 start+1로 보정된다', () => {
    const r = normalizeLoop(0, -100)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(1)
  })

  it('음수 start와 end 모두: loopStart=0, loopEnd=1', () => {
    const r = normalizeLoop(-200, -100)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(1)
  })

  it('minDuration=GRID: start===end이면 end = start + GRID', () => {
    const r = normalizeLoop(480, 480, GRID)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBe(480 + GRID)
  })
})

// ── computeLoopDrawRegion ─────────────────────────────────────

describe('computeLoopDrawRegion', () => {
  it('startTick < endTick: 그대로 정렬됨', () => {
    // snap(0, 120)=0, snap(480, 120)=480
    const r = computeLoopDrawRegion(0, 480, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('startTick > endTick: 역방향 드래그도 정상 처리 (swap)', () => {
    const r = computeLoopDrawRegion(480, 0, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('그리드 스냅 적용: 틱이 그리드 사이이면 가장 가까운 그리드로', () => {
    // snap(50, 120) = 0, snap(430, 120) = 480
    const r = computeLoopDrawRegion(50, 430, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('gridTicks=0: 스냅 없이 자유 구간', () => {
    const r = computeLoopDrawRegion(37, 953, 0)
    expect(r.loopStart).toBe(37)
    expect(r.loopEnd).toBe(953)
  })

  it('start === end (점 드래그): normalizeLoop가 end를 보정', () => {
    const r = computeLoopDrawRegion(240, 240, GRID)
    expect(r.loopStart).toBe(240)
    expect(r.loopEnd).toBeGreaterThan(240)
  })

  it('[fix3] minDuration=GRID: start===end이면 end = start + GRID (최소 1그리드 폭)', () => {
    const r = computeLoopDrawRegion(480, 480, GRID, GRID)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBe(480 + GRID)
  })
})

// ── computeLoopMove ───────────────────────────────────────────

describe('computeLoopMove', () => {
  it('오른쪽 이동: start·end가 deltaTicks만큼 증가하고 duration 보존', () => {
    const r = computeLoopMove(240, 720, GRID, GRID)
    // snap(240+120, 120)=360; end=360+(720-240)=360+480=840
    expect(r.loopStart).toBe(360)
    expect(r.loopEnd).toBe(840)
    expect(r.loopEnd - r.loopStart).toBe(480)
  })

  it('왼쪽 이동: start가 음수가 되면 0으로 클램프, 폭 보존', () => {
    // origStart=0, origEnd=480, delta=-200 → snap(0-200,120)=snap(-200,120)=-240 → max(0,...)=0
    const r = computeLoopMove(0, 480, -200, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('gridTicks=0: 스냅 없이 자유 이동, duration 보존', () => {
    const r = computeLoopMove(0, 500, 37, 0)
    expect(r.loopStart).toBe(37)
    expect(r.loopEnd).toBe(537)
  })

  it('큰 음수 delta에서도 start >= 0 보장', () => {
    const r = computeLoopMove(120, 600, -9999, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480) // 폭 480 보존
  })
})

// ── computeLoopResizeStart ────────────────────────────────────

describe('computeLoopResizeStart', () => {
  it('시작점을 오른쪽으로 축소: newStart 증가, end 불변', () => {
    // origStart=0, origEnd=960, delta=+120 → snap(0+120,120)=120 < 960-1=959 → OK
    const r = computeLoopResizeStart(0, 960, 120, GRID)
    expect(r.loopStart).toBe(120)
    expect(r.loopEnd).toBe(960)
  })

  it('시작점을 왼쪽으로 확장: newStart 감소', () => {
    // origStart=480, origEnd=960, delta=-120 → snap(360,120)=360
    const r = computeLoopResizeStart(480, 960, -120, GRID)
    expect(r.loopStart).toBe(360)
    expect(r.loopEnd).toBe(960)
  })

  it('시작점이 end - minDuration을 초과하면 클램프: 최소 폭 보장', () => {
    // origStart=0, origEnd=480, delta=+9999 → newStart=snap(9999,120) → 매우 큰 값
    // clamp: min(newStart, 480-1) = 479 (minDuration 기본 1)
    const r = computeLoopResizeStart(0, 480, 9999, GRID)
    expect(r.loopStart).toBeLessThan(480)
    expect(r.loopEnd).toBe(480)
  })

  it('시작점이 0 미만이 되면 0으로 클램프', () => {
    const r = computeLoopResizeStart(120, 960, -9999, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(960)
  })
})

// ── computeLoopResizeEnd ──────────────────────────────────────

describe('computeLoopResizeEnd', () => {
  it('종료점을 오른쪽으로 확장: newEnd 증가, start 불변', () => {
    const r = computeLoopResizeEnd(0, 480, 120, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(600)
  })

  it('종료점을 왼쪽으로 축소: newEnd 감소', () => {
    // origEnd=960, delta=-120 → snap(840,120)=840 > 0+1=1 → OK
    const r = computeLoopResizeEnd(0, 960, -120, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(840)
  })

  it('종료점이 start + minDuration 미만이 되면 클램프: 최소 폭 보장', () => {
    // origStart=480, origEnd=960, delta=-9999 → newEnd 매우 작음 → clamp to 480+1=481
    const r = computeLoopResizeEnd(480, 960, -9999, GRID)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBeGreaterThan(480)
  })

  it('gridTicks=0: 스냅 없이 자유 리사이즈', () => {
    const r = computeLoopResizeEnd(0, 480, 37, 0)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(517)
  })
})
