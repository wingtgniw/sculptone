import { describe, it, expect } from 'vitest'
import { pasteNotesParams, duplicateNotesParams } from '../clipboard'
import type { Note } from '@sculptone/score-model'

let seq = 0
function n(start: number, pitch: number, duration = 480, velocity = 100): Note {
  return { id: `n${++seq}`, pitch, start, duration, velocity }
}

const GRID = 120 // divisionToTicks(16, 480) = 120

// ── pasteNotesParams ─────────────────────────────────────────

describe('pasteNotesParams', () => {
  it('빈 배열 → []', () => {
    expect(pasteNotesParams([], 240, GRID)).toEqual([])
  })

  it('단일 노트 → 기존 pasteNoteParams와 동일 결과 (start=anchoredSnap)', () => {
    const clip = n(100, 60, 480)
    // anchorTick=240, grid=120 → snap(240,120)=240
    const r = pasteNotesParams([clip], 240, GRID)
    expect(r).toHaveLength(1)
    expect(r[0]!.start).toBe(240)
    expect(r[0]!.pitch).toBe(60)
    expect(r[0]!.duration).toBe(480)
    expect('id' in r[0]!).toBe(false)
  })

  it('두 노트 상대 오프셋 유지: [start=0, start=480] anchorTick=240 → [240, 720]', () => {
    const clip = [n(0, 60), n(480, 62)]
    // origin=0, anchored=snap(240,120)=240
    // n0: 240+0=240, n1: 240+480=720
    const r = pasteNotesParams(clip, 240, GRID)
    expect(r).toHaveLength(2)
    expect(r[0]!.start).toBe(240)
    expect(r[1]!.start).toBe(720)
    expect(r[0]!.pitch).toBe(60)
    expect(r[1]!.pitch).toBe(62)
  })

  it('정렬 보장: 입력이 [start=480, start=0] 이어도 start 기준 정렬 후 처리', () => {
    const a = n(480, 62) // 나중에 입력
    const b = n(0, 60) // 먼저
    // origin = min(0,480) = 0, sorted=[b,a]
    // anchored=240; b→240, a→240+480=720
    const r = pasteNotesParams([a, b], 240, GRID)
    expect(r[0]!.start).toBe(240) // b(pitch=60)
    expect(r[1]!.start).toBe(720) // a(pitch=62)
    expect(r[0]!.pitch).toBe(60)
    expect(r[1]!.pitch).toBe(62)
  })

  it('anchorTick 스냅: tick=181, grid=120 → snap(181,120)=240', () => {
    // round(181/120)=round(1.508)=2, 2*120=240
    const r = pasteNotesParams([n(0, 60)], 181, GRID)
    expect(r[0]!.start).toBe(240)
  })

  it('anchorTick 음수 → max(0, snap(...)) 클램프', () => {
    // snap(-50,120)=0, max(0,0)=0
    const r = pasteNotesParams([n(0, 60)], -50, GRID)
    expect(r[0]!.start).toBeGreaterThanOrEqual(0)
    expect(r[0]!.start).toBe(0)
  })

  it('gridTicks=0: 스냅 없이 anchorTick 그대로', () => {
    const r = pasteNotesParams([n(0, 60)], 77, 0)
    expect(r[0]!.start).toBe(77)
  })

  it('오프셋이 음수여도 max(0,...) 클램프 보장', () => {
    // clip=[n(0,...), n(480,...)] anchorTick=0
    // origin=0, anchored=snap(0,120)=0
    // n0: max(0,0+0)=0, n1: max(0,0+480)=480
    const r = pasteNotesParams([n(0, 60), n(480, 62)], 0, GRID)
    expect(r[0]!.start).toBeGreaterThanOrEqual(0)
    expect(r[1]!.start).toBeGreaterThanOrEqual(0)
  })

  it('id 필드가 없다 (Omit<Note,"id">)', () => {
    const r = pasteNotesParams([n(0, 60)], 0, GRID)
    expect('id' in r[0]!).toBe(false)
  })
})

// ── duplicateNotesParams ─────────────────────────────────────

describe('duplicateNotesParams', () => {
  const BAR = 1920 // 4/4, ppq=480

  it('빈 배열 → []', () => {
    expect(duplicateNotesParams([], BAR)).toEqual([])
  })

  it('단일 노트 → 기존 duplicateNoteParams와 동일', () => {
    const r = duplicateNotesParams([n(480, 60)], BAR)
    expect(r).toHaveLength(1)
    expect(r[0]!.start).toBe(480 + 1920)
    expect(r[0]!.pitch).toBe(60)
    expect('id' in r[0]!).toBe(false)
  })

  it('여러 노트 → 각각 +barTicks 오프셋, 순서 유지', () => {
    const r = duplicateNotesParams([n(0, 60), n(480, 62)], BAR)
    expect(r[0]!.start).toBe(0 + 1920)
    expect(r[1]!.start).toBe(480 + 1920)
    expect(r[0]!.pitch).toBe(60)
    expect(r[1]!.pitch).toBe(62)
  })

  it('pitch, duration, velocity는 원본과 동일하다', () => {
    const src = n(0, 64, 240, 80)
    const r = duplicateNotesParams([src], BAR)
    expect(r[0]!.pitch).toBe(64)
    expect(r[0]!.duration).toBe(240)
    expect(r[0]!.velocity).toBe(80)
  })

  it('start=0이어도 start >= 0 보장', () => {
    const r = duplicateNotesParams([n(0, 60)], BAR)
    expect(r[0]!.start).toBe(1920)
    expect(r[0]!.start).toBeGreaterThanOrEqual(0)
  })

  it('음수 barTicks(방어적): start < 0이면 0으로 클램프', () => {
    // start=100, barTicks=-200 → max(0, 100-200)=max(0,-100)=0
    const r = duplicateNotesParams([n(100, 60)], -200)
    expect(r[0]!.start).toBe(0)
  })
})
