import { snap } from './quantize'

export interface LoopRegion {
  loopStart: number
  loopEnd: number
}

/**
 * 루프 구간 불변식 정규화.
 * - 양단 >= 0 클램프
 * - loopStart < loopEnd 보장 (end <= start이면 end = start + max(1, minDuration))
 *
 * @param start        시작 틱 (임의 값 가능)
 * @param end          종료 틱 (임의 값 가능)
 * @param minDuration  최소 구간 폭(틱). 기본 1.
 */
export function normalizeLoop(start: number, end: number, minDuration: number = 1): LoopRegion {
  const s = Math.max(0, start)
  let e = Math.max(0, end)
  if (e <= s) {
    e = s + Math.max(1, minDuration)
  }
  return { loopStart: s, loopEnd: e }
}

/**
 * 드래그로 새 루프 구간을 그린다.
 * startTick, endTick은 방향 무관. 그리드 스냅 후 normalizeLoop 적용.
 *
 * @param minDuration  최소 구간 폭(틱). normalizeLoop에 전달. 기본 1.
 *                     LoopStrip에서 grid 단위(최소 1그리드)로 전달한다.
 */
export function computeLoopDrawRegion(
  startTick: number,
  endTick: number,
  gridTicks: number,
  minDuration: number = 1,
): LoopRegion {
  const a = snap(Math.max(0, startTick), gridTicks)
  const b = snap(Math.max(0, endTick), gridTicks)
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return normalizeLoop(lo, hi, minDuration)
}

/**
 * 루프 구간 전체 이동.
 * duration(origEnd - origStart)을 보존하고, start가 0 미만이 되면 클램프.
 *
 * @param origStart   드래그 시작 시의 loopStartTicks 스냅샷
 * @param origEnd     드래그 시작 시의 loopEndTicks 스냅샷
 * @param deltaTicks  x 이동량(틱 단위, 부호 있음)
 * @param gridTicks   양자화 그리드(0이면 스냅 없음)
 */
export function computeLoopMove(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
): LoopRegion {
  const duration = origEnd - origStart
  const newStart = Math.max(0, snap(origStart + deltaTicks, gridTicks))
  return { loopStart: newStart, loopEnd: newStart + duration }
}

/**
 * 루프 시작점 리사이즈 드래그.
 * end - minDuration 이상으로 클램프하여 구간이 사라지지 않도록 한다.
 */
export function computeLoopResizeStart(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
  minDuration: number = 1,
): LoopRegion {
  const rawStart = snap(origStart + deltaTicks, gridTicks)
  const maxStart = origEnd - Math.max(1, minDuration)
  const loopStart = Math.max(0, Math.min(rawStart, maxStart))
  return { loopStart, loopEnd: origEnd }
}

/**
 * 루프 종료점 리사이즈 드래그.
 * start + minDuration 이상으로 클램프하여 구간이 사라지지 않도록 한다.
 */
export function computeLoopResizeEnd(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
  minDuration: number = 1,
): LoopRegion {
  const rawEnd = snap(origEnd + deltaTicks, gridTicks)
  const minEnd = origStart + Math.max(1, minDuration)
  const loopEnd = Math.max(minEnd, rawEnd)
  return { loopStart: origStart, loopEnd }
}
