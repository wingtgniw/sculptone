import { describe, it, expect } from 'vitest'
import {
  createHistory,
  record,
  undo,
  redo,
  canUndo,
  canRedo,
  type History,
} from '../state/history'

// ── createHistory ────────────────────────────────────────────

describe('createHistory', () => {
  it('present를 인수로 받아 past=[], future=[]인 히스토리를 반환한다', () => {
    const h = createHistory(42)
    expect(h.present).toBe(42)
    expect(h.past).toEqual([])
    expect(h.future).toEqual([])
  })
})

// ── canUndo / canRedo ────────────────────────────────────────

describe('canUndo', () => {
  it('초기 히스토리는 canUndo=false이다', () => {
    expect(canUndo(createHistory('x'))).toBe(false)
  })
  it('record 후 canUndo=true이다', () => {
    const h = record(createHistory('a'), 'b')
    expect(canUndo(h)).toBe(true)
  })
})

describe('canRedo', () => {
  it('초기 히스토리는 canRedo=false이다', () => {
    expect(canRedo(createHistory('x'))).toBe(false)
  })
  it('undo 후 canRedo=true이다', () => {
    const h = undo(record(createHistory('a'), 'b'))
    expect(canRedo(h)).toBe(true)
  })
})

// ── record ───────────────────────────────────────────────────

describe('record', () => {
  it('present를 past에 push하고 present=next, future=[]로 설정한다', () => {
    const h = record(createHistory('a'), 'b')
    expect(h.past).toEqual(['a'])
    expect(h.present).toBe('b')
    expect(h.future).toEqual([])
  })

  it('두 번 record 시 past.length=2이고 최신 항목이 끝에 있다', () => {
    const h = record(record(createHistory('a'), 'b'), 'c')
    expect(h.past).toEqual(['a', 'b'])
    expect(h.present).toBe('c')
  })

  it('record는 기존 future를 클리어한다', () => {
    // a → b → undo → c (undo 후 새 분기)
    const withFuture = undo(record(createHistory('a'), 'b'))
    expect(withFuture.future).toHaveLength(1) // 'b'가 future에
    const branched = record(withFuture, 'c')
    expect(branched.future).toEqual([]) // future 클리어됨
    expect(branched.past).toEqual(['a'])
    expect(branched.present).toBe('c')
  })

  it('coalesce=true: present만 교체하고 past는 그대로이다', () => {
    const h0 = record(createHistory('a'), 'b')         // past=['a'], present='b'
    const hC = record(h0, 'b2', { coalesce: true })    // 코얼레싱
    expect(hC.past).toEqual(['a'])                      // past 불변
    expect(hC.present).toBe('b2')
    expect(hC.future).toEqual([])
  })

  it('coalesce=true: future도 클리어된다', () => {
    // a → b → undo(future=['b']) → 코얼레싱 record
    const withFuture = undo(record(createHistory('a'), 'b'))
    const hC = record(withFuture, 'a2', { coalesce: true })
    expect(hC.future).toEqual([])
  })

  it('coalesce=false(명시): 정상 push와 동일하게 동작한다', () => {
    const h = record(createHistory('a'), 'b', { coalesce: false })
    expect(h.past).toEqual(['a'])
    expect(h.present).toBe('b')
  })

  it('cap: past가 cap을 초과하면 가장 오래된 항목을 제거한다', () => {
    // cap=3: a→b→c→d 기록 시 past=['b','c','d'], present='d+1'
    let h: History<string> = createHistory('a')
    h = record(h, 'b', { cap: 3 })  // past=['a']
    h = record(h, 'c', { cap: 3 })  // past=['a','b']
    h = record(h, 'd', { cap: 3 })  // past=['a','b','c']
    h = record(h, 'e', { cap: 3 })  // cap 초과 → past=['b','c','d']
    expect(h.past).toHaveLength(3)
    expect(h.past[0]).toBe('b')      // 'a'가 제거됨
    expect(h.past[2]).toBe('d')
    expect(h.present).toBe('e')
  })

  it('cap=1: past는 항상 최신 1개만 유지한다', () => {
    let h: History<number> = createHistory(0)
    h = record(h, 1, { cap: 1 })
    h = record(h, 2, { cap: 1 })
    h = record(h, 3, { cap: 1 })
    expect(h.past).toHaveLength(1)
    expect(h.past[0]).toBe(2)
    expect(h.present).toBe(3)
  })
})

// ── undo ─────────────────────────────────────────────────────

describe('undo', () => {
  it('past의 마지막을 present로, 기존 present를 future 앞에 삽입한다', () => {
    const h = undo(record(createHistory('a'), 'b'))
    expect(h.past).toEqual([])
    expect(h.present).toBe('a')
    expect(h.future).toEqual(['b'])
  })

  it('연속 undo: 두 번 undo 시 처음 상태로 돌아간다', () => {
    let h = record(record(createHistory('a'), 'b'), 'c')
    h = undo(h)  // present='b', past=['a'], future=['c']
    h = undo(h)  // present='a', past=[], future=['b','c']
    expect(h.present).toBe('a')
    expect(h.past).toEqual([])
    expect(h.future).toEqual(['b', 'c'])
  })

  it('past가 비어있을 때 undo는 히스토리를 그대로 반환한다(no-op)', () => {
    const h = createHistory('a')
    const after = undo(h)
    expect(after).toBe(h)  // 동일 참조 (no-op)
  })
})

// ── redo ─────────────────────────────────────────────────────

describe('redo', () => {
  it('future의 첫 항목을 present로, 기존 present를 past 끝에 추가한다', () => {
    const h = redo(undo(record(createHistory('a'), 'b')))
    expect(h.present).toBe('b')
    expect(h.past).toEqual(['a'])
    expect(h.future).toEqual([])
  })

  it('연속 redo: undo 두 번 후 redo 두 번으로 원래 상태 복원', () => {
    let h = record(record(createHistory('a'), 'b'), 'c')
    h = undo(undo(h))  // present='a', future=['b','c']
    h = redo(h)        // present='b', future=['c']
    h = redo(h)        // present='c', future=[]
    expect(h.present).toBe('c')
    expect(h.past).toEqual(['a', 'b'])
    expect(h.future).toEqual([])
  })

  it('future가 비어있을 때 redo는 히스토리를 그대로 반환한다(no-op)', () => {
    const h = createHistory('a')
    const after = redo(h)
    expect(after).toBe(h)  // 동일 참조 (no-op)
  })
})
