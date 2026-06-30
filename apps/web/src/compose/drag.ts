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

/**
 * 그룹 이동 드래그: 선택 노트 전체에 적용할 { tickDelta, pitchDelta }를 계산한다.
 *
 * **스냅**: rawTickDelta를 grid 단위로 스냅(delta 자체를 스냅 → 그룹이 grid 배수로 이동).
 *           gridTicks <= 0 이면 스냅 없음.
 * **그룹 클램프**:
 *   - tick: 모든 노트의 start >= 0 보장 → tickDelta >= -min(originNotes[*].start)
 *   - pitch: 가시 범위 PITCH_LOW..PITCH_HIGH 유지 → pitchDelta ∈ [PITCH_LOW-minPitch, PITCH_HIGH-maxPitch]
 * **빈 배열**: { tickDelta:0, pitchDelta:0 } 반환.
 *
 * 호출측(PianoRoll)에서 이 함수의 반환값으로 각 노트의 새 위치를
 * origNotes[id].start + tickDelta, origNotes[id].pitch + pitchDelta 로 절대 계산한다.
 */
export function computeGroupMove(
  originNotes: ReadonlyArray<{ start: number; pitch: number }>,
  rawTickDelta: number,
  rawPitchDelta: number,
  gridTicks: number,
): { tickDelta: number; pitchDelta: number } {
  if (originNotes.length === 0) return { tickDelta: 0, pitchDelta: 0 }

  // tick: delta를 grid로 스냅, 그룹 클램프
  const snappedTick = snap(rawTickDelta, gridTicks)
  const minStart = Math.min(...originNotes.map((n) => n.start))
  const tickDelta = Math.max(snappedTick, 0 - minStart) // 0-minStart: -0 방지

  // pitch: 스냅 없음(반음 단위 정수), 그룹 클램프 (가시 범위 PITCH_LOW..PITCH_HIGH)
  const minPitch = Math.min(...originNotes.map((n) => n.pitch))
  const maxPitch = Math.max(...originNotes.map((n) => n.pitch))
  const pitchDelta = Math.min(PITCH_HIGH - maxPitch, Math.max(PITCH_LOW - minPitch, rawPitchDelta)) // PITCH_LOW-minPitch: -0 방지

  return { tickDelta, pitchDelta }
}
