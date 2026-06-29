import { describe, it, expect } from 'vitest'
import { divisionToTicks, snap, QUANTIZE_DIVISIONS } from '../quantize'

describe('quantize', () => {
  it('1/16 division → ppq/4 ticks (ppq480 → 120)', () => {
    expect(divisionToTicks(16, 480)).toBe(120)
  })
  it('1/4 division → ppq ticks', () => {
    expect(divisionToTicks(4, 480)).toBe(480)
  })
  it('snap은 가장 가까운 그리드로 반올림', () => {
    expect(snap(130, 120)).toBe(120)
    expect(snap(190, 120)).toBe(240)
  })
  it('snap(grid=0)은 그대로(자유 입력)', () => {
    expect(snap(137, 0)).toBe(137)
  })
  it('QUANTIZE_DIVISIONS에 16 포함', () => {
    expect(QUANTIZE_DIVISIONS).toContain(16)
  })
})
