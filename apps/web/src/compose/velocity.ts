/**
 * 벨로시티 레인 상수 및 순수 헬퍼 함수.
 *
 * 이 모듈은 DOM/React에 의존하지 않는다. 모든 함수는 순수(pure)하고 불변이다.
 */

/** 벨로시티 레인의 고정 높이(px). velocity=127 → 전체 높이, velocity=0 → 0. */
export const VELOCITY_LANE_HEIGHT = 80

/**
 * MIDI velocity(0..127)를 레인 내 막대 높이(px)로 변환한다.
 *
 * - velocity=0   → 0
 * - velocity=127 → laneHeight
 * - 중간값은 선형 비례 후 정수 반올림.
 */
export function velocityToHeight(velocity: number, laneHeight: number): number {
  return Math.round((velocity * laneHeight) / 127)
}

/**
 * 단일 노트 velocity 드래그 결과를 계산한다.
 *
 * - dy < 0 (위로 드래그) → velocity 증가.
 * - dy > 0 (아래로 드래그) → velocity 감소.
 * - laneHeight px 전체가 0~127에 매핑된다.
 * - 반환값은 clamp(0, 127) 후 정수.
 *
 * @param origVelocity - 드래그 시작 시 스냅샷된 velocity (pointerdown 시점)
 * @param dy           - clientY 총 델타 (e.clientY - startY). 누적이 아닌 총 델타.
 * @param laneHeight   - 레인 높이(px). 이 px 전체가 0~127 범위에 대응.
 */
export function computeVelocityFromDrag(
  origVelocity: number,
  dy: number,
  laneHeight: number,
): number {
  const delta = Math.round((-dy * 127) / laneHeight)
  return Math.max(0, Math.min(127, origVelocity + delta))
}

/**
 * 멀티 선택 velocity 드래그의 그룹 델타를 계산한다.
 *
 * - 모든 선택 노트가 0..127에 머물도록 rawDelta를 균일 클램프한다.
 * - clamp(rawDelta, 0 - minVelocity, 127 - maxVelocity)
 * - 빈 배열 → 0.
 * - 반환된 delta는 각 노트에 대해 `origVel + delta`를 적용해도 0..127을 보장한다.
 *
 * @param origVelocities - grab 시점에 스냅샷된 선택 노트들의 velocity 배열
 * @param rawDelta       - 드래그로 산출된 velocity delta (정수 권장)
 */
export function computeGroupVelocityDelta(
  origVelocities: ReadonlyArray<number>,
  rawDelta: number,
): number {
  if (origVelocities.length === 0) return 0
  const minVel = Math.min(...origVelocities)
  const maxVel = Math.max(...origVelocities)
  return Math.min(127 - maxVel, Math.max(0 - minVel, rawDelta)) // 0-minVel: -0 방지 표현 유지
}
