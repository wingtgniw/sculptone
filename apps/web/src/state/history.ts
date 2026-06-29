/** 스냅샷 기반 히스토리. T = 상태 스냅샷 타입(예: Project). */
export type History<T> = {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

const DEFAULT_CAP = 100

/** 초기 히스토리 생성. past/future는 비어있다. */
export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/**
 * 새 상태를 히스토리에 기록한다.
 *
 * - `coalesce: true`: present만 교체하고 past에 push하지 않는다(드래그 연속 편집).
 * - `cap` (기본 100): past 최대 깊이. 초과 시 가장 오래된 항목을 제거한다.
 * - 항상 future를 클리어한다(새 편집 분기).
 */
export function record<T>(
  h: History<T>,
  next: T,
  opts?: { coalesce?: boolean; cap?: number },
): History<T> {
  if (opts?.coalesce) {
    return { past: h.past, present: next, future: [] }
  }
  const cap = opts?.cap ?? DEFAULT_CAP
  const newPast = [...h.past, h.present]
  const trimmedPast = newPast.length > cap ? newPast.slice(newPast.length - cap) : newPast
  return { past: trimmedPast, present: next, future: [] }
}

/**
 * 한 단계 실행 취소.
 * past가 비어있으면 히스토리를 그대로(동일 참조) 반환한다.
 */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  const previous = h.past[h.past.length - 1]!
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
  }
}

/**
 * 한 단계 다시 실행.
 * future가 비어있으면 히스토리를 그대로(동일 참조) 반환한다.
 */
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const next = h.future[0]!
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
  }
}

/** past가 비어있지 않으면 undo 가능. */
export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0
}

/** future가 비어있지 않으면 redo 가능. */
export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0
}
