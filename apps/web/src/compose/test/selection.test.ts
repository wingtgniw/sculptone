import { describe, it, expect } from 'vitest'
import { notesInRect } from '../selection'
import type { SelectionRect } from '../selection'
import type { Note } from '@sculptone/score-model'

// ── 헬퍼 ────────────────────────────────────────────────────
let seq = 0
function makeNote(start: number, duration: number, pitch: number, id?: string): Note {
  return { id: id ?? `n${++seq}`, pitch, start, duration, velocity: 100 }
}

// ── notesInRect ──────────────────────────────────────────────

describe('notesInRect', () => {
  const R: SelectionRect = { startTick: 240, endTick: 720, pitchLow: 60, pitchHigh: 72 }

  // ── 빈 입력 ────────────────────────────────────────────────

  it('빈 notes 배열 → []', () => {
    expect(notesInRect([], R)).toEqual([])
  })

  // ── 틱 범위 제외 케이스 ───────────────────────────────────

  it('노트가 rect 이전에 완전히 끝남(end <= startTick) → []', () => {
    // note: start=0, duration=240 → end=240, rect.startTick=240
    // 240 > 240 is false → 제외
    const n = makeNote(0, 240, 65)
    expect(notesInRect([n], R)).toEqual([])
  })

  it('노트가 rect 이후에 시작(start >= endTick) → []', () => {
    // note: start=720, rect.endTick=720 → 720 < 720 is false → 제외
    const n = makeNote(720, 240, 65)
    expect(notesInRect([n], R)).toEqual([])
  })

  // ── 틱 범위 포함 케이스 ───────────────────────────────────

  it('노트가 rect에 완전 포함(start=300, end=600) → [id]', () => {
    const n = makeNote(300, 300, 65, 'full')
    expect(notesInRect([n], R)).toEqual(['full'])
  })

  it('노트가 왼쪽에서 부분 겹침(start=100, end=400) → 포함', () => {
    // 100 < 720 AND 100+300=400 > 240 → 포함
    const n = makeNote(100, 300, 65, 'left')
    expect(notesInRect([n], R)).toEqual(['left'])
  })

  it('노트가 오른쪽에서 부분 겹침(start=600, end=900) → 포함', () => {
    // 600 < 720 AND 600+300=900 > 240 → 포함
    const n = makeNote(600, 300, 65, 'right')
    expect(notesInRect([n], R)).toEqual(['right'])
  })

  it('노트가 rect를 완전히 감싸는 경우(start=0, end=960) → 포함', () => {
    // 0 < 720 AND 0+960=960 > 240 → 포함
    const n = makeNote(0, 960, 65, 'span')
    expect(notesInRect([n], R)).toEqual(['span'])
  })

  // ── 틱 경계 exclusive 케이스 ─────────────────────────────

  it('note.start === rect.endTick (끝 경계 exclusive) → []', () => {
    // start=720 → 720 < 720 is false → 제외
    const n = makeNote(720, 120, 65)
    expect(notesInRect([n], R)).toEqual([])
  })

  it('note.start + duration === rect.startTick (왼쪽 경계 exclusive) → []', () => {
    // start=0, duration=240 → end=240, 240 > 240 is false → 제외
    const n = makeNote(0, 240, 65)
    expect(notesInRect([n], R)).toEqual([])
  })

  // ── 피치 범위 케이스 ─────────────────────────────────────

  it('pitch < pitchLow → []', () => {
    const n = makeNote(300, 240, 59) // 59 < 60
    expect(notesInRect([n], R)).toEqual([])
  })

  it('pitch > pitchHigh → []', () => {
    const n = makeNote(300, 240, 73) // 73 > 72
    expect(notesInRect([n], R)).toEqual([])
  })

  it('pitch === pitchLow (하한 inclusive) → 포함', () => {
    const n = makeNote(300, 240, 60, 'low')
    expect(notesInRect([n], R)).toEqual(['low'])
  })

  it('pitch === pitchHigh (상한 inclusive) → 포함', () => {
    const n = makeNote(300, 240, 72, 'high')
    expect(notesInRect([n], R)).toEqual(['high'])
  })

  // ── 복수 노트 ───────────────────────────────────────────

  it('복수 노트 일부만 포함 → 올바른 subset, 순서 유지', () => {
    const a = makeNote(300, 240, 65, 'a') // IN
    const b = makeNote(0, 100, 65, 'b') // OUT (end=100 <= 240)
    const c = makeNote(500, 120, 65, 'c') // IN
    const d = makeNote(300, 240, 59, 'd') // OUT (pitch=59 < 60)
    expect(notesInRect([a, b, c, d], R)).toEqual(['a', 'c'])
  })

  // ── 퇴화 rect (startTick === endTick) ────────────────────

  it('degenerate rect(startTick===endTick=480): 해당 틱을 걸치는 노트만 포함', () => {
    const R2: SelectionRect = { startTick: 480, endTick: 480, pitchLow: 0, pitchHigh: 127 }
    // note: start=0, dur=960 → 0 < 480 AND 960 > 480 → 포함
    const a = makeNote(0, 960, 65, 'span')
    // note: start=480, dur=240 → 480 < 480 is false → 제외 (start가 정확히 endTick)
    const b = makeNote(480, 240, 65, 'at')
    // note: start=0, dur=480 → end=480, 480 > 480 is false → 제외
    const c = makeNote(0, 480, 65, 'touch')
    expect(notesInRect([a, b, c], R2)).toEqual(['span'])
  })
})
