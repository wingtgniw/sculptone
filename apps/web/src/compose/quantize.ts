export const QUANTIZE_DIVISIONS = [4, 8, 16, 32] as const

// division: 음표 분할(1/n). 1/16 → denom 16. ticks = ppq * 4 / denom.
export function divisionToTicks(denom: number, ppq: number): number {
  return (ppq * 4) / denom
}

// grid=0 이면 스냅하지 않음(자유 입력).
export function snap(tick: number, gridTicks: number): number {
  if (gridTicks <= 0) return tick
  return Math.round(tick / gridTicks) * gridTicks
}
