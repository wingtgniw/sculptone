import { describe, it, expect } from 'vitest'
import { barTicks, duplicateNoteParams, pasteNoteParams } from '../clipboard'

// ── barTicks ─────────────────────────────────────────────────────

describe('barTicks', () => {
  it('4/4, ppq=480 → 1920 틱 (480 × 4)', () => {
    expect(barTicks(480, [4, 4])).toBe(1920)
  })

  it('3/4, ppq=480 → 1440 틱 (480 × 3)', () => {
    expect(barTicks(480, [3, 4])).toBe(1440)
  })

  it('6/8, ppq=480 → 1440 틱 (480 × 4 × 6 / 8)', () => {
    // 6/8: 6 eighth notes = 6 × (ppq/2) = 3 × ppq
    expect(barTicks(480, [6, 8])).toBe(1440)
  })

  it('ppq=240, 4/4 → 960 틱', () => {
    expect(barTicks(240, [4, 4])).toBe(960)
  })
})

// ── duplicateNoteParams ─────────────────────────────────────────

describe('duplicateNoteParams', () => {
  const note = { id: 'n1', pitch: 60, start: 480, duration: 240, velocity: 100 }

  it('start = note.start + barTicksValue', () => {
    const r = duplicateNoteParams(note, 1920)
    // 480 + 1920 = 2400
    expect(r.start).toBe(2400)
  })

  it('pitch는 원본과 동일하다', () => {
    const r = duplicateNoteParams(note, 1920)
    expect(r.pitch).toBe(60)
  })

  it('duration은 원본과 동일하다', () => {
    const r = duplicateNoteParams(note, 1920)
    expect(r.duration).toBe(240)
  })

  it('velocity는 원본과 동일하다', () => {
    const r = duplicateNoteParams(note, 1920)
    expect(r.velocity).toBe(100)
  })

  it('note.start=0 이어도 start >= 0으로 클램프된다 (방어적)', () => {
    const r = duplicateNoteParams({ ...note, start: 0 }, 1920)
    expect(r.start).toBeGreaterThanOrEqual(0)
    expect(r.start).toBe(1920)
  })

  it('반환값에 id 필드가 없다 (Omit<Note,"id">)', () => {
    const r = duplicateNoteParams(note, 1920)
    expect('id' in r).toBe(false)
  })
})

// ── pasteNoteParams ──────────────────────────────────────────────

describe('pasteNoteParams', () => {
  const GRID = 120 // divisionToTicks(16, 480) = 480*4/16 = 120
  const clip = { id: 'c1', pitch: 64, start: 100, duration: 480, velocity: 80 }

  it('anchorTick이 그리드 경계면 그대로 사용된다', () => {
    // snap(240, 120) = 240
    const r = pasteNoteParams(clip, 240, GRID)
    expect(r.start).toBe(240)
  })

  it('anchorTick이 그리드 사이면 가장 가까운 그리드로 스냅된다', () => {
    // snap(181, 120) = round(1.508)*120 = 2*120 = 240
    const r = pasteNoteParams(clip, 181, GRID)
    expect(r.start).toBe(240)
  })

  it('grid=0 이면 스냅 없이 anchorTick을 그대로 사용한다', () => {
    const r = pasteNoteParams(clip, 77, 0)
    expect(r.start).toBe(77)
  })

  it('anchorTick이 음수이면 max(0, snap(...))으로 0에 클램프된다', () => {
    // snap(-90, 120) = round(-0.75)*120 = -1*120 = -120 → max(0, -120) = 0
    // (anchorTick=-50 이면 snap=-0이라 Math.max 클램프를 실제로 거치지 않음)
    const r = pasteNoteParams(clip, -90, GRID)
    expect(r.start).toBeGreaterThanOrEqual(0)
    expect(r.start).toBe(0)
  })

  it('pitch는 clipNote에서 온다 (origNote pitch 무시)', () => {
    const r = pasteNoteParams(clip, 240, GRID)
    expect(r.pitch).toBe(64)
  })

  it('duration은 clipNote에서 온다', () => {
    const r = pasteNoteParams(clip, 240, GRID)
    expect(r.duration).toBe(480)
  })

  it('velocity는 clipNote에서 온다', () => {
    const r = pasteNoteParams(clip, 240, GRID)
    expect(r.velocity).toBe(80)
  })

  it('반환값에 id 필드가 없다 (Omit<Note,"id">)', () => {
    const r = pasteNoteParams(clip, 240, GRID)
    expect('id' in r).toBe(false)
  })
})
