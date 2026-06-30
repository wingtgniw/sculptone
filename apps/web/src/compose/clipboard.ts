import type { Note } from '@sculptone/score-model'
import { snap } from './quantize'

/**
 * 1마디(bar)에 해당하는 틱 수를 반환한다.
 *
 * 공식: ppq × 4 × numerator / denominator
 *
 * 예:
 *   4/4, ppq=480 → 480 × 4 × 4 / 4 = 1920
 *   3/4, ppq=480 → 480 × 4 × 3 / 4 = 1440
 *   6/8, ppq=480 → 480 × 4 × 6 / 8 = 1440
 */
export function barTicks(ppq: number, timeSignature: [number, number]): number {
  const [num, denom] = timeSignature
  return (ppq * 4 * num) / denom
}

/**
 * 복제(duplicate) 노트의 파라미터를 반환한다.
 *
 * - start = max(0, note.start + barTicksValue)  — 1마디 뒤에 배치 (방어적 클램프)
 * - pitch, duration, velocity = 원본 노트와 동일
 * - id는 반환하지 않는다 — 호출부에서 createNote()로 새 id를 할당한다.
 */
export function duplicateNoteParams(note: Note, barTicksValue: number): Omit<Note, 'id'> {
  return {
    pitch: note.pitch,
    start: Math.max(0, note.start + barTicksValue),
    duration: note.duration,
    velocity: note.velocity,
  }
}

/**
 * 붙여넣기(paste) 노트의 파라미터를 반환한다.
 *
 * - start = max(0, snap(anchorTick, gridTicks))
 *   anchorTick: 재생 헤드 위치(틱). 정지 시 0.
 *   gridTicks <= 0 이면 스냅 없이 anchorTick 그대로 사용.
 * - pitch, duration, velocity = clipNote에서 복사.
 * - id는 반환하지 않는다 — 호출부에서 createNote()로 새 id를 할당한다.
 */
export function pasteNoteParams(
  clipNote: Note,
  anchorTick: number,
  gridTicks: number,
): Omit<Note, 'id'> {
  return {
    pitch: clipNote.pitch,
    start: Math.max(0, snap(anchorTick, gridTicks)),
    duration: clipNote.duration,
    velocity: clipNote.velocity,
  }
}

/**
 * 여러 노트 붙여넣기(paste) 파라미터를 반환한다.
 *
 * - clipNotes를 start 기준 오름차순 정렬한다.
 * - 첫 번째 노트 start를 origin으로 삼아 앵커에 정박: anchoredStart = max(0, snap(anchorTick, gridTicks)).
 * - 각 노트: start = max(0, anchoredStart + (note.start - origin))
 *   → 상대 위치가 보존되며 모든 start >= 0이 보장된다.
 * - gridTicks <= 0 이면 스냅 없이 anchorTick 그대로.
 * - 빈 배열 → 빈 배열.
 * - id는 반환하지 않음 — 호출부에서 createNote()로 새 id를 할당한다.
 */
export function pasteNotesParams(
  clipNotes: Note[],
  anchorTick: number,
  gridTicks: number,
): Omit<Note, 'id'>[] {
  if (clipNotes.length === 0) return []
  const sorted = [...clipNotes].sort((a, b) => a.start - b.start)
  const origin = sorted[0]!.start
  const anchoredStart = Math.max(0, snap(anchorTick, gridTicks))
  return sorted.map((n) => ({
    pitch: n.pitch,
    start: Math.max(0, anchoredStart + (n.start - origin)),
    duration: n.duration,
    velocity: n.velocity,
  }))
}

/**
 * 여러 노트 복제(duplicate) 파라미터를 반환한다.
 *
 * - 각 노트: start = max(0, note.start + barTicksValue)
 * - pitch, duration, velocity = 원본과 동일.
 * - 입력 순서를 유지한다 (정렬 없음 — 호출부가 이미 원하는 순서로 전달).
 * - 빈 배열 → 빈 배열.
 * - id는 반환하지 않음 — 호출부에서 createNote()로 새 id를 할당한다.
 */
export function duplicateNotesParams(notes: Note[], barTicksValue: number): Omit<Note, 'id'>[] {
  return notes.map((n) => ({
    pitch: n.pitch,
    start: Math.max(0, n.start + barTicksValue),
    duration: n.duration,
    velocity: n.velocity,
  }))
}
