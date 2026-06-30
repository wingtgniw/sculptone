import type { Note } from '@sculptone/score-model'

/**
 * 박스 선택 사각형. 틱 좌표(수평)와 MIDI 피치(수직)로 정의한다.
 */
export interface SelectionRect {
  /** 선택 시작 틱 (반개구간의 시작; 이후 노트가 겹쳐야 포함). */
  startTick: number
  /** 선택 종료 틱 (반개구간의 끝; 정확히 이 틱에서 시작하는 노트는 제외). */
  endTick: number
  /** 포함할 최저 MIDI 피치 (inclusive). */
  pitchLow: number
  /** 포함할 최고 MIDI 피치 (inclusive). */
  pitchHigh: number
}

/**
 * `rect`와 겹치는 노트의 id 목록을 반환한다. 입력 `notes` 배열 순서를 유지한다.
 *
 * 겹침 판정:
 * - 틱: `note.start < rect.endTick` AND `note.start + note.duration > rect.startTick`
 *   (반개구간 [startTick, endTick) 겹침 — 부분 겹침 포함, 끝 경계 exclusive)
 * - 피치: `note.pitch >= rect.pitchLow` AND `note.pitch <= rect.pitchHigh` (폐구간)
 */
export function notesInRect(notes: Note[], rect: SelectionRect): string[] {
  return notes
    .filter(
      (n) =>
        n.start < rect.endTick &&
        n.start + n.duration > rect.startTick &&
        n.pitch >= rect.pitchLow &&
        n.pitch <= rect.pitchHigh,
    )
    .map((n) => n.id)
}
