import { PITCH_LOW, PITCH_HIGH, PX_PER_BEAT } from './geometry'
import { snap } from './quantize'

/**
 * 픽셀 델타(수평) → 틱 델타.
 * PX_PER_BEAT(48px/박) 기준으로 변환한다.
 * 부호 보존: 오른쪽(+px) = 나중(+ticks), 왼쪽(-px) = 앞(-ticks).
 */
export function pxToTicks(dx: number, ppq: number): number {
  return dx / (PX_PER_BEAT / ppq)
}

/**
 * 픽셀 델타(수직) → 반음 델타.
 * 화면 아래(dy > 0) = 낮은 피치 = 음수 반음.
 * 반올림해 반음 단위로 반환한다.
 */
export function pxToSemitones(dy: number, laneHeight: number): number {
  // round-half-away-from-zero: +dy와 -dy 모두 대칭 처리(Math.round는 +0.5를 위로만 처리).
  const n = Math.sign(dy) * Math.round(Math.abs(dy) / laneHeight)
  return -n || 0
}

/**
 * 이동 드래그: 새 { start, pitch } 를 계산한다.
 *
 * - start = max(0, snap(note.start + deltaTicks, gridTicks))
 * - pitch = clamp(note.pitch + deltaSemitones, PITCH_LOW, PITCH_HIGH)
 *
 * gridTicks <= 0 이면 스냅 없이 자유 이동.
 * 피치 클램프 범위: geometry.PITCH_LOW(36, C2) .. PITCH_HIGH(84, C6) — 롤 가시 범위.
 */
export function computeMove(
  note: { start: number; pitch: number },
  deltaTicks: number,
  deltaSemitones: number,
  gridTicks: number,
): { start: number; pitch: number } {
  const start = Math.max(0, snap(note.start + deltaTicks, gridTicks))
  const pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, note.pitch + deltaSemitones))
  return { start, pitch }
}

/**
 * 리사이즈 드래그: 새 { duration } 을 계산한다.
 *
 * - minDuration = gridTicks > 0 ? gridTicks : 1  (최소 1그리드 또는 1틱)
 * - duration = max(minDuration, snap(note.duration + deltaTicks, gridTicks))
 *
 * gridTicks <= 0 이면 스냅 없이 자유 리사이즈.
 */
export function computeResize(
  note: { duration: number },
  deltaTicks: number,
  gridTicks: number,
): { duration: number } {
  const minDuration = gridTicks > 0 ? gridTicks : 1
  const duration = Math.max(minDuration, snap(note.duration + deltaTicks, gridTicks))
  return { duration }
}
