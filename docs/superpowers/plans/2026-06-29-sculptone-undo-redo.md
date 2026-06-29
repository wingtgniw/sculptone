# Sculptone Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `setProject`(인플레이스 편집) 경유의 모든 변경을 자동으로 undoable하게 만드는 프로젝트 스냅샷 기반 히스토리를 구현한다. 사용자는 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z(또는 Ctrl+Y)로 노트 편집·트랙 편집·믹서 편집·녹음 커밋 등 모든 편집 액션을 취소/재실행할 수 있다. 346개 기존 테스트를 유지한다.

**Architecture:** 순수 히스토리 모듈(`history.ts`)을 완전 TDD로 검증한다. `store.ts`에 `history: History<Project>` 필드와 `_lastEditAt: number`(코얼레싱용, 리셋 가능)를 추가하고, 기존 `setProject`가 히스토리에 자동 record하도록 변경한다. `replaceProject`(New/Import/Load)는 히스토리를 리셋한다. `undo()`/`redo()` 액션을 store에 추가하고, `AppShell.tsx`에 전역 키보드 핸들러와 툴바 버튼을 연결한다. 기존 모든 편집 경로(`PianoRoll`, `Inspector`, `TracksPanel`, `MixerPanel`, `SoundDesignPanel`, `useRecording`, `PatchLibrary`)는 `setProject` 시그니처를 그대로 유지하므로 수정 불필요 — 자동으로 undoable이 된다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** `apps/web/src/state/store.ts`, `apps/web/src/shell/AppShell.tsx`, `apps/web/src/io/useAutosave.ts`, `docs/superpowers/plans/2026-06-29-sculptone-multitrack-mixer.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- 액션별 라벨(Undo "Add Note") / 히스토리 타임라인 UI
- 영속 히스토리(새로고침 후 복원)
- per-field 정밀 코얼레싱(슬라이더별 독립 그룹)
- selection / playback / view 변경의 undo (setProject 미경유이므로 대상 아님)
- 협업 충돌 머지
- 백엔드 / 클라우드

---

## 설계 근거

### 스냅샷 기반 히스토리

`Project`는 불변 연산 결과(매번 새 객체 참조)이므로 스냅샷 저장이 자연스럽다. 100단계 cap에서 각 스냅샷이 작은 Project 객체이면 메모리 부담이 낮다.

### setProject 단일 진입점

현재 모든 편집 경로(PianoRoll `addNote`/`removeNote`, Inspector `updateNote`, TracksPanel `addTrack`/`removeTrack`/`updateTrackSound`, MixerPanel `updateTrackMixer`, SoundDesignPanel `updateTrackSound`, `useRecording` 녹음 커밋, PatchLibrary `updateTrackSound`)가 `setProject(project)`를 통과한다. 이 진입점 하나만 히스토리 record를 추가하면 모든 편집이 자동으로 undoable이 된다. 기존 호출부 코드 변경 없음.

### replaceProject = 히스토리 리셋

`replaceProject`(New/Import/Load)는 새 문서의 기준선이 되므로 `createHistory(project)`로 past/future를 비운다. 이전 문서의 편집 히스토리가 새 문서로 넘어오지 않는다.

### 코얼레싱 (_lastEditAt in state)

연속 드래그(PianoRoll 노트 이동 등)는 매 mousemove마다 `setProject`를 호출한다. 직전 `setProject`로부터 `COALESCE_MS = 400ms` 이내 호출이면 `present`만 교체하고 `past`에 push하지 않는다(드래그 전체가 한 undo 단계).

`_lastEditAt: number`를 Zustand state에 포함시킨다 — 모듈 변수가 아닌 상태에 두어 `getInitialState()`와 `setState(getInitialState(), true)` 리셋 시 함께 초기화되므로 테스트 간 오염이 없다. `_lastEditAt = 0`일 때는 첫 `setProject`이므로 항상 코얼레싱하지 않는다(`Date.now() - 0` >> 400ms). 히스토리 모듈(`history.ts`)에는 boolean만 전달해 시간 의존 없이 단위 테스트.

### undo/redo 시 selection 보정

- `selectedTrackId`: 복원된 project에 해당 트랙이 없으면 `project.tracks[0]?.id ?? ''`
- `selectedNoteId`: 복원된 project의 어느 트랙에도 해당 노트가 없으면 `null`

재생 중 undo는 허용(단순화). playback/recording 상태는 건드리지 않는다.

### useAutosave와의 상호작용

`useAutosave`는 `useStore((s) => s.project)` 변경을 구독한다. undo/redo도 `project`를 바꾸므로 자동저장이 트리거된다. 추가 연동 불필요.

### 기존 테스트 호환

`setProject`가 이제 `history`와 `_lastEditAt`도 갱신하지만, `project`(= `history.present`)는 항상 인수 값으로 설정된다. 기존 테스트는 `project.tracks[0]!.notes` 등 project 데이터만 단언하므로 영향 없다. 코얼레싱이 발생해도 `present` 값은 항상 올바르다. `_lastEditAt`이 state에 있어 `getInitialState()` + `setState(true)` 리셋 시 0으로 초기화되므로, 테스트 간 오염도 없다.

---

## File Structure

```
apps/web/src/state/
  history.ts                    # NEW: 순수 히스토리 모듈 (History<T>, record/undo/redo/canUndo/canRedo)
  store.ts                      # MOD: history/_lastEditAt/undo/redo 추가, setProject/replaceProject 갱신

apps/web/src/test/
  history.test.ts               # NEW: history.ts 완전 TDD (19개)
  history-store.test.ts         # NEW: store 히스토리 통합 TDD (13개)
  AppShell.test.tsx             # MOD: Undo/Redo 버튼 + 키보드 테스트 추가 (5개)

apps/web/src/shell/
  AppShell.tsx                  # MOD: keydown 핸들러(useEffect) + 툴바 Undo/Redo 버튼
```

변경 없는 파일:
- `PianoRoll.tsx`, `Inspector.tsx`, `TracksPanel.tsx`, `MixerPanel.tsx`, `SoundDesignPanel.tsx`, `useRecording.ts`, `PatchLibrary.tsx` — setProject 시그니처 유지, 호출부 불변
- `useAutosave.ts` — project 변경 구독, undo/redo 후 자동저장 자연스럽게 트리거됨

---

## Task 1: state/history.ts — 순수 히스토리 모듈 (완전 TDD)

**Files:** Create `apps/web/src/state/history.ts`, `apps/web/src/test/history.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/history.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- history.test
```

Expected: FAIL — `'../state/history'` 모듈 없음.

- [ ] **Step 3: history.ts 구현**

Create `apps/web/src/state/history.ts`:
```ts
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
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- history.test
```

Expected: history.test.ts 16개 PASS. 기존 테스트 영향 없음.

---

## Task 2: state/store.ts — 히스토리 통합 + 기존 테스트 갱신

**Files:** Modify `apps/web/src/state/store.ts`, Create `apps/web/src/test/history-store.test.ts`

- [ ] **Step 1: history-store.test.ts 실패 테스트 작성**

Create `apps/web/src/test/history-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useStore } from '../state/store'
import { addNote, addTrack, createNote, createTrack, createEmptyProject } from '@sculptone/score-model'

// ── 픽스처 ────────────────────────────────────────────────────

function withNote() {
  const s = useStore.getState()
  const tid = s.selectedTrackId
  return addNote(s.project, tid, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
}

// ── 초기 히스토리 상태 ────────────────────────────────────────

describe('초기 히스토리', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('history.past=[], history.future=[], _lastEditAt=0이다', () => {
    const s = useStore.getState()
    expect(s.history.past).toEqual([])
    expect(s.history.future).toEqual([])
    expect(s._lastEditAt).toBe(0)
  })

  it('history.present가 초기 project와 동일 참조이다', () => {
    const s = useStore.getState()
    expect(s.history.present).toBe(s.project)
  })
})

// ── setProject → 히스토리 record ─────────────────────────────

describe('setProject 히스토리 record', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('setProject 호출 시 history.past.length가 1 증가하고 present=새 project이다', () => {
    const p1 = withNote()
    useStore.getState().setProject(p1)
    const s = useStore.getState()
    expect(s.history.past).toHaveLength(1)
    expect(s.history.present).toBe(p1)
    expect(s.project).toBe(p1)
  })

  it('setProject 두 번 호출 시 400ms 이내면 두 번째가 코얼레싱된다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1)  // _lastEditAt = T (fake now)
    // 시간 이동 없음 → Date.now() 동일 → 0ms 차이 < 400ms → 코얼레싱
    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    expect(s.project).toBe(p2)
    // 코얼레싱: past.length는 1 그대로 (p2가 p1을 교체)
    expect(s.history.past).toHaveLength(1)

    vi.useRealTimers()
  })

  it('setProject 두 번 호출 시 400ms 초과이면 코얼레싱하지 않는다', () => {
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)

    const p1 = withNote()
    useStore.getState().setProject(p1)

    vi.advanceTimersByTime(401)  // 400ms 초과

    const p2 = { ...p1 }
    useStore.getState().setProject(p2)

    const s = useStore.getState()
    expect(s.history.past).toHaveLength(2)
    expect(s.history.present).toBe(p2)

    vi.useRealTimers()
  })

  it('_lastEditAt=0 초기 상태에서 첫 setProject는 코얼레싱하지 않는다', () => {
    // fake timers로 Date.now()=0이 되도록 강제
    vi.useFakeTimers({ now: 0 })
    useStore.setState(useStore.getInitialState(), true)  // _lastEditAt=0 리셋
    expect(useStore.getState()._lastEditAt).toBe(0)

    const p1 = withNote()
    useStore.getState().setProject(p1)

    // 0 - 0 = 0 < 400 となるが _lastEditAt=0 Guard により코얼레싱하지 않아야 함
    const s = useStore.getState()
    expect(s.history.past).toHaveLength(1)  // 코얼레싱 아님

    vi.useRealTimers()
  })
})

// ── replaceProject → 히스토리 리셋 ───────────────────────────

describe('replaceProject 히스토리 리셋', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('replaceProject는 history를 createHistory(project)로 리셋하고 _lastEditAt=0으로 초기화한다', () => {
    // 히스토리 쌓기
    useStore.getState().setProject(withNote())
    expect(useStore.getState().history.past).toHaveLength(1)

    // 새 프로젝트로 교체
    const fresh = addTrack(createEmptyProject('Fresh'), createTrack('Bass'))
    useStore.getState().replaceProject(fresh)
    const s = useStore.getState()
    expect(s.history.past).toEqual([])
    expect(s.history.future).toEqual([])
    expect(s.history.present).toBe(fresh)
    expect(s._lastEditAt).toBe(0)
    expect(s.project).toBe(fresh)
    expect(s.selectedTrackId).toBe(fresh.tracks[0]!.id)
    expect(s.selectedNoteId).toBeNull()
  })
})

// ── undo ─────────────────────────────────────────────────────

describe('undo 액션', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('undo()는 이전 project를 복원한다', () => {
    const originalProject = useStore.getState().project
    const p1 = withNote()
    useStore.getState().setProject(p1)
    expect(useStore.getState().project).toBe(p1)

    useStore.getState().undo()
    expect(useStore.getState().project).toBe(originalProject)
    expect(useStore.getState().history.past).toHaveLength(0)
    expect(useStore.getState().history.future).toHaveLength(1)
  })

  it('undo() 시 selectedTrackId가 복원된 project에 없으면 첫 트랙으로 보정된다', () => {
    const s = useStore.getState()
    const firstTrackId = s.selectedTrackId   // Piano 트랙 id

    // t2를 추가하고 선택 → 이것이 undo 대상 편집
    const t2 = createTrack('Bass')
    s.setProject(addTrack(s.project, t2))    // past=[project0], present=p1(t2 포함)
    s.selectTrack(t2.id)
    expect(useStore.getState().selectedTrackId).toBe(t2.id)

    // undo → project0(t2 없음)으로 복원 → selectedTrackId가 firstTrackId로 보정된다
    useStore.getState().undo()
    const after = useStore.getState()
    // t2가 복원된 project(project0)에 없으므로 첫 트랙(Piano)으로 보정됨
    expect(after.selectedTrackId).toBe(firstTrackId)
    expect(after.project.tracks.find((t) => t.id === firstTrackId)).toBeDefined()
    expect(after.project.tracks.find((t) => t.id === t2.id)).toBeUndefined()
  })

  it('undo() 시 selectedNoteId가 복원된 project에 없으면 null로 보정된다', () => {
    const s = useStore.getState()
    const tid = s.selectedTrackId
    // 노트 추가
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const p1 = addNote(s.project, tid, note)
    s.setProject(p1)
    s.selectNote(note.id)
    expect(useStore.getState().selectedNoteId).toBe(note.id)

    // 노트 제거
    const p2 = { ...p1, tracks: p1.tracks.map((t) => t.id === tid ? { ...t, notes: [] } : t) }
    useStore.getState().setProject(p2)

    // undo → p1(note 있음) → selectedNoteId 유지
    useStore.getState().undo()
    expect(useStore.getState().project).toBe(p1)
    expect(useStore.getState().selectedNoteId).toBe(note.id)  // 보정 불필요, 노트 존재

    // 다시 undo → original(note 없음) → selectedNoteId=null 보정
    useStore.getState().undo()
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  it('canUndo=false일 때 undo()는 no-op이다', () => {
    const before = useStore.getState()
    useStore.getState().undo()
    const after = useStore.getState()
    expect(after.project).toBe(before.project)
    expect(after.history).toBe(before.history)
  })
})

// ── redo ─────────────────────────────────────────────────────

describe('redo 액션', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('redo()는 undo 이전 project를 재적용한다', () => {
    const p1 = withNote()
    useStore.getState().setProject(p1)
    useStore.getState().undo()
    expect(useStore.getState().project).not.toBe(p1)

    useStore.getState().redo()
    expect(useStore.getState().project).toBe(p1)
    expect(useStore.getState().history.future).toHaveLength(0)
  })

  it('canRedo=false일 때 redo()는 no-op이다', () => {
    const before = useStore.getState()
    useStore.getState().redo()
    const after = useStore.getState()
    expect(after.project).toBe(before.project)
    expect(after.history).toBe(before.history)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- history-store
```

Expected: FAIL — `history`, `_lastEditAt`, `undo`, `redo`가 store에 없음.

- [ ] **Step 3: store.ts 교체**

Replace `apps/web/src/state/store.ts`:
```ts
import { create } from 'zustand'
import {
  createEmptyProject, createTrack, addTrack, type Project,
} from '@sculptone/score-model'
import {
  createHistory, record, undo as historyUndo, redo as historyRedo,
  canUndo, canRedo, type History,
} from './history'

export type Mode = 'compose' | 'play' | 'transcribe'
export type ComposeView = 'roll' | 'score'

/** 직전 setProject 호출 이후 이 ms 이내 연속 호출이면 코얼레싱한다. */
const COALESCE_MS = 400

export interface AppState {
  activeMode: Mode
  project: Project
  /** 프로젝트 편집 히스토리. setProject로만 갱신된다. */
  history: History<Project>
  /**
   * 내부 전용: 마지막 setProject 호출 시각(ms).
   * state에 포함시켜 getInitialState()/setState(true) 리셋 시 0으로 초기화한다.
   * 외부에서 직접 변경하지 말 것.
   */
  _lastEditAt: number
  selectedTrackId: string
  selectedNoteId: string | null
  quantizeDenom: number
  isPlaying: boolean
  isRecording: boolean
  /** 마지막 stop() 시점의 transport 위치(초). 녹음 커밋 endSec 계산에 사용. */
  recordStopSec: number
  composeView: ComposeView
  /** 사운드 디자인 패널 열림 상태. null = 닫힘. */
  soundPanelTrackId: string | null
  setMode: (mode: Mode) => void
  /**
   * 인플레이스 편집용 — 선택 상태를 유지하고 히스토리에 record한다.
   * 직전 호출로부터 COALESCE_MS 이내 재호출 시 코얼레싱(drags 폭주 방지).
   */
  setProject: (project: Project) => void
  /**
   * 프로젝트 전체 교체용(New/Import/Load).
   * 히스토리를 새로 시작하고 선택을 새 첫 트랙으로 리셋한다.
   */
  replaceProject: (project: Project) => void
  /** 한 단계 실행 취소. canUndo=false이면 no-op. */
  undo: () => void
  /** 한 단계 다시 실행. canRedo=false이면 no-op. */
  redo: () => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
  setRecording: (recording: boolean) => void
  setRecordStopSec: (sec: number) => void
  setComposeView: (view: ComposeView) => void
  setSoundPanelTrackId: (id: string | null) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

const project0 = initialProject()

/**
 * selectedTrackId가 project에 없으면 첫 트랙 id(없으면 '')로 보정한다.
 * undo/redo 후 트랙이 사라졌을 때 사용.
 */
function correctTrackId(project: Project, trackId: string): string {
  if (project.tracks.some((t) => t.id === trackId)) return trackId
  return project.tracks[0]?.id ?? ''
}

/**
 * selectedNoteId가 project의 어느 트랙에도 없으면 null로 보정한다.
 * undo/redo 후 노트가 사라졌을 때 사용.
 */
function correctNoteId(project: Project, noteId: string | null): string | null {
  if (noteId === null) return null
  const exists = project.tracks.some((t) => t.notes.some((n) => n.id === noteId))
  return exists ? noteId : null
}

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: project0,
  history: createHistory(project0),
  _lastEditAt: 0,
  selectedTrackId: project0.tracks[0]!.id,
  selectedNoteId: null,
  quantizeDenom: 16,
  isPlaying: false,
  isRecording: false,
  recordStopSec: 0,
  composeView: 'roll',
  soundPanelTrackId: null,

  setMode: (mode) => set({ activeMode: mode }),

  setProject: (project) =>
    set((s) => {
      const now = Date.now()
      // _lastEditAt=0은 최초 호출이므로 코얼레싱하지 않는다.
      const coalesce = s._lastEditAt > 0 && now - s._lastEditAt < COALESCE_MS
      const newHistory = record(s.history, project, { coalesce })
      return { project, history: newHistory, _lastEditAt: now }
    }),

  replaceProject: (project) =>
    set({
      project,
      history: createHistory(project),
      _lastEditAt: 0,
      selectedTrackId: project.tracks[0]?.id ?? '',
      selectedNoteId: null,
    }),

  undo: () =>
    set((s) => {
      if (!canUndo(s.history)) return {}
      const newHistory = historyUndo(s.history)
      const project = newHistory.present
      return {
        history: newHistory,
        project,
        selectedTrackId: correctTrackId(project, s.selectedTrackId),
        selectedNoteId: correctNoteId(project, s.selectedNoteId),
      }
    }),

  redo: () =>
    set((s) => {
      if (!canRedo(s.history)) return {}
      const newHistory = historyRedo(s.history)
      const project = newHistory.present
      return {
        history: newHistory,
        project,
        selectedTrackId: correctTrackId(project, s.selectedTrackId),
        selectedNoteId: correctNoteId(project, s.selectedNoteId),
      }
    }),

  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setRecording: (recording) => set({ isRecording: recording }),
  setRecordStopSec: (sec) => set({ recordStopSec: sec }),
  setComposeView: (view) => set({ composeView: view }),
  setSoundPanelTrackId: (id) => set({ soundPanelTrackId: id }),
}))
```

- [ ] **Step 4: 기존 store 테스트 영향 점검 후 통과 확인**

```bash
pnpm --filter @sculptone/web test -- store history-store editor-store
```

Expected:
- `history.test.ts` 16개 PASS
- `history-store.test.ts` 9개 PASS
- `store.test.ts` 3개 PASS(기존 변경 없음 — `history`/`_lastEditAt` 필드가 추가됐지만 테스트는 이들을 단언하지 않음)
- `editor-store.test.ts` 9개 PASS

**기존 `editor-store.test.ts` 영향 상세:**
- `'setProject는 선택 상태를 변경하지 않는다'`: `setProject`가 이제 `history`/`_lastEditAt`도 갱신하지만 `selectedTrackId`/`selectedNoteId`는 건드리지 않음 → **PASS**
- `'replaceProject는 새 첫 트랙으로 selectedTrackId를 갱신'`: 이제 `history`도 리셋하지만 selection 보정 로직 동일 → **PASS**
- 나머지 7개: `history` 미사용 → **PASS**

**기존 `useRecording.test.ts` 영향:**
- `beforeEach: useStore.setState(useStore.getInitialState(), true)` → `_lastEditAt=0` 리셋 포함 → 코얼레싱 없음(첫 setProject는 항상 non-coalescing)
- 각 테스트 내 `setProject` 호출은 `project` 값을 올바르게 설정함(코얼레싱 여부와 무관하게 `present` = 인수 값) → **PASS**

**기존 `useAutosave.test.ts` 영향:**
- `vi.useFakeTimers()` 사용. `getInitialState()` 리셋으로 `_lastEditAt=0`. `Date.now()`(fake)는 실제 시간 기준으로 시작 → `T - 0 >> COALESCE_MS` → 코얼레싱 없음 → autosave 디바운스 동작 동일 → **PASS**

---

## Task 3: AppShell.tsx — 전역 키보드 핸들러 + 툴바 Undo/Redo 버튼

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`

- [ ] **Step 1: AppShell.test.tsx에 Undo/Redo 테스트 추가**

`apps/web/src/test/AppShell.test.tsx` 상단 import를 갱신:
```tsx
import { render, screen, act, fireEvent } from '@testing-library/react'
```

> `act`와 `fireEvent`를 기존 `render, screen` import에 추가. `userEvent`는 이미 있음.

파일 끝 `describe('AppShell', ...)` 블록 안에 5개 테스트 추가:

```tsx
  it('Undo 버튼이 렌더되며 히스토리가 없을 때 disabled이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeDisabled()
  })

  it('Redo 버튼이 렌더되며 히스토리가 없을 때 disabled이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeDisabled()
  })

  it('setProject 후 Undo 버튼이 활성화된다', () => {
    render(<AppShell />)
    act(() => {
      const s = useStore.getState()
      s.setProject({ ...s.project })
    })
    expect(screen.getByRole('button', { name: '실행 취소' })).not.toBeDisabled()
  })

  it('Ctrl+Z 키보드 단축키로 undo가 실행된다', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    // undo 가능 상태 확인
    expect(useStore.getState().history.past.length).toBe(1)
    // Ctrl+Z 발사
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(useStore.getState().project).toBe(originalProject)
  })

  it('input 포커스 시 Ctrl+Z는 undo를 실행하지 않는다(텍스트 편집 우선)', () => {
    render(<AppShell />)
    const originalProject = useStore.getState().project
    act(() => {
      useStore.getState().setProject({ ...originalProject })
    })
    // DOM에 input 추가 후 포커스
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true, bubbles: true })
    // undo 실행 안 됨 — project 변경 없음
    expect(useStore.getState().history.past.length).toBe(1)
    document.body.removeChild(input)
  })
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.test
```

Expected: 신규 5개 FAIL(Undo/Redo 버튼 없음, 키보드 핸들러 없음). 기존 8개는 PASS.

- [ ] **Step 3: AppShell.tsx 레퍼런스 구현으로 갱신**

Replace `apps/web/src/shell/AppShell.tsx`:
```tsx
import { type CSSProperties, useEffect } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'
import { FileMenu } from '../ui/FileMenu'
import { PianoRoll } from '../compose/PianoRoll'
import { TracksPanel } from '../compose/TracksPanel'
import { Inspector } from '../compose/Inspector'
import { Playhead } from '../compose/Playhead'
import { TransportBar } from '../audio/TransportBar'
import { useAudio } from '../audio/useAudio'
import { useAutosave } from '../io/useAutosave'
import { MixerPanel } from '../play/MixerPanel'
import { useMidi } from '../midi/useMidi'
import { useRecording } from '../midi/useRecording'
import { MidiDeviceSelect } from '../midi/MidiDeviceSelect'
import { NotationView } from '../notation/NotationView'
import { SoundDesignPanel } from '../sound/SoundDesignPanel'

const TABS = [
  { id: 'compose',    label: 'Compose' },
  { id: 'play',       label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

const undoBtnBase: CSSProperties = {
  font: 'inherit', fontSize: 12, fontWeight: 600,
  padding: '2px 8px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', cursor: 'pointer',
  background: 'var(--bg-elevated)', color: 'var(--text-mid)',
  lineHeight: 1.4,
}
const undoBtnDisabled: CSSProperties = {
  ...undoBtnBase,
  opacity: 0.35, cursor: 'not-allowed',
}

export function AppShell() {
  useAutosave()

  const activeMode     = useStore((s) => s.activeMode)
  const setMode        = useStore((s) => s.setMode)
  const composeView    = useStore((s) => s.composeView)
  const setComposeView = useStore((s) => s.setComposeView)
  const tempo          = useStore((s) => s.project.transport.tempo)
  const timeSignature  = useStore((s) => s.project.transport.timeSignature)
  const { play, stop, getSeconds } = useAudio()

  const undo     = useStore((s) => s.undo)
  const redo     = useStore((s) => s.redo)
  const canUndo  = useStore((s) => s.history.past.length > 0)
  const canRedo  = useStore((s) => s.history.future.length > 0)

  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)

  // 전역 키보드 단축키: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y = redo.
  // input/textarea 포커스 시에는 무시(텍스트 편집 우선).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if (mod && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      if (!isMac && e.ctrlKey && !e.shiftKey && e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />

        {/* Undo / Redo 버튼 */}
        <button
          aria-label="실행 취소"
          disabled={!canUndo}
          onClick={undo}
          title="Undo (Ctrl+Z)"
          style={canUndo ? undoBtnBase : undoBtnDisabled}
        >
          ↩
        </button>
        <button
          aria-label="다시 실행"
          disabled={!canRedo}
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          style={canRedo ? undoBtnBase : undoBtnDisabled}
        >
          ↪
        </button>

        {activeMode === 'compose' && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              aria-pressed={composeView === 'roll'}
              onClick={() => setComposeView('roll')}
              style={{
                font: 'inherit', fontSize: 11, fontWeight: 600,
                padding: '3px 10px', borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
                border: '1px solid var(--border)', cursor: 'pointer',
                background: composeView === 'roll' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'roll' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Roll
            </button>
            <button
              aria-pressed={composeView === 'score'}
              onClick={() => setComposeView('score')}
              style={{
                font: 'inherit', fontSize: 11, fontWeight: 600,
                padding: '3px 10px', borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                border: '1px solid var(--border)', cursor: 'pointer',
                background: composeView === 'score' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'score' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Score
            </button>
          </div>
        )}
        <FileMenu />
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {tempo} BPM · {timeSignature.join('/')}
        </span>
      </div>

      {/* 본문 */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region, overflowY: 'auto' }}>
          {activeMode === 'compose' && <TracksPanel />}
        </div>
        <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
          {activeMode === 'compose' && composeView === 'roll' && (
            <div style={{ position: 'relative' }}>
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
            </div>
          )}
          {activeMode === 'compose' && composeView === 'score' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <NotationView />
            </div>
          )}
          {activeMode === 'play' && (
            <div style={{ overflowY: 'auto', height: '100%' }}>
              <MixerPanel />
            </div>
          )}
        </div>
        <div style={{ ...region, overflowY: 'auto' }}>
          {activeMode === 'compose' && <Inspector />}
        </div>
      </div>

      {/* 트랜스포트 */}
      <div style={region}>
        <TransportBar onPlay={play} onStop={stop} />
      </div>

      {/* 사운드 디자인 패널 (전역 오버레이 — soundPanelTrackId !== null 일 때 표시) */}
      <SoundDesignPanel />
    </div>
  )
}
```

> **타입 노트:** `useEffect`는 `'react'`에서 named import. `CSSProperties`도 동일. React 타입 네임스페이스 접근(`React.CSSProperties`) 금지.

> **기존 AppShell 테스트 영향:** Undo/Redo 버튼 추가 후 기존 테스트(`'Roll'`/`'Score'` 버튼, `'재생'` 버튼 등) 쿼리는 더 구체적인 name을 가지므로 충돌 없음. `useAudio`/`useAutosave` 모킹은 유지됨 → **기존 8개 PASS**.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.test AppShell.compose
```

Expected: `AppShell.test.tsx` 13개(기존 8 + 신규 5) PASS. `AppShell.compose.test.tsx` 3개 PASS.

---

## Task 4: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 기존 | 신규 | 합계 |
|---|---|---|---|
| @sculptone/score-model | (기존 유지) | 0 | — |
| @sculptone/sound-engine | (기존 유지) | 0 | — |
| @sculptone/web | 346 | 37 | **383** |

신규 37개 내역:
- `history.test.ts`: 19개 (createHistory 1, canUndo 2, canRedo 2, record 8, undo 3, redo 3)
- `history-store.test.ts`: 13개 (초기상태 2, setProject record 4, replaceProject 1, undo 4, redo 2)
- `AppShell.test.tsx` 추가: 5개

> **기존 테스트 보존 체크리스트:**
> - `store.test.ts` 3개: `history`/`_lastEditAt` 필드 추가됐지만 단언 없음 → **PASS**
> - `editor-store.test.ts` 9개: `setProject` 선택 불변 / `replaceProject` 선택 리셋 동작 동일, 히스토리 단언 없음 → **PASS**
> - `useRecording.test.ts` 9개: `setProject` project 값 정확, `_lastEditAt` state-reset 포함 → **PASS**
> - `useAutosave.test.ts` 4개: `setProject` 디바운스 트리거 동작 동일 → **PASS**
> - `PianoRoll.test.tsx` 2개 + `PianoRoll.edit.test.tsx` n개: `setProject` notes 단언 동일 → **PASS**
> - `AppShell.compose.test.tsx` 3개: 기존 모킹 유지, Undo 버튼 렌더 추가는 기존 쿼리와 충돌 없음 → **PASS**
> - `useAudio.test.ts`, `multitrack.test.ts`, `playback.test.ts`, `MixerPanel.test.tsx`, `TracksPanel.test.tsx`, `SoundDesignPanel.test.tsx`, `PatchLibrary.test.tsx`, `storage.test.ts`, `patch-storage.test.ts` 등: 파일 수정 없음 → **PASS**

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음. 특히:
- `AppState`에 `history: History<Project>`, `_lastEditAt: number`, `undo`, `redo` 추가 — 기존 `create<AppState>()` 호출에서 모두 구현됨
- `correctTrackId`/`correctNoteId` 내부 함수 — 외부 export 불필요
- `History<T>` — `readonly` 배열에 spread 연산자 호환 확인

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `useEffect` import from `'react'`(named import) 확인.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과(기존 346개 보존 + 신규 30개).
- `history.ts`: `createHistory` / `record` / `undo` / `redo` / `canUndo` / `canRedo` — 16개 단위 테스트 통과.
- `record({ coalesce: true })`: present 교체, past 불변, future 클리어 — 자동 테스트 검증.
- `record` cap: past.length > cap이면 가장 오래된 항목 제거 — 자동 테스트 검증.
- `undo`/`redo` no-op: 경계 상태에서 동일 히스토리 참조 반환 — 자동 테스트 검증.
- `store.setProject`: 히스토리에 record, `_lastEditAt` 갱신 — 자동 테스트 검증.
- 코얼레싱: 400ms 이내 연속 setProject는 past에 push 안 함 — fake timers 테스트 검증.
- `store.replaceProject`: history 리셋, `_lastEditAt=0` — 자동 테스트 검증.
- `store.undo`/`redo`: project 복원 + selection 보정 — 자동 테스트 검증.
- `getInitialState()` 리셋: `history`/`_lastEditAt` 포함하여 초기화됨 — 기존 테스트 beforeEach 패턴으로 검증.
- Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z / Ctrl+Y = redo — 키보드 테스트 검증.
- input/textarea 포커스 시 단축키 무시 — 테스트 검증.
- Undo/Redo 버튼: canUndo/canRedo=false일 때 disabled — 테스트 검증.
- CSS 변수(`var(--bg-elevated)`, `var(--text-mid)`, `var(--border)`, `var(--r-sm)`)만 사용(하드코딩 hex 없음).
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후)

- **히스토리 라벨 UI (P2):** 각 undo 단계에 액션 이름("Add Note", "Delete Track" 등) 표시. `record` opts에 `label?: string` 추가, 툴바 tooltip에 표시.
- **영속 히스토리 (P3, 사용자 확인 필요):** 새로고침 후 히스토리 복원. `History<Project>`를 IndexedDB에 직렬화. 스냅샷 크기 vs UX 트레이드오프 논의 필요.
- **백엔드 (P3, 사용자 확인 필요):** 서버 저장소 연동. 히스토리와의 충돌 머지 전략 설계 필요.

---

## 열린 질문

1. **코얼레싱 임계값 400ms:** 현재 기본값. 드래그 UX 테스트 후 조정 가능. `COALESCE_MS` 상수로 격리되어 있어 단순 변경 가능.

2. **히스토리 cap 100:** 프로젝트 크기에 따라 메모리 이슈 여지. 각 `Project` 스냅샷의 크기를 측정 후 cap을 동적으로 조정하거나(e.g., 50) 고정 유지. 현재는 `DEFAULT_CAP = 100`으로 고정.

3. **재생 중 undo 허용:** 현재 계획은 재생 중에도 undo를 허용(playback 상태 미변경). 재생 중 undo 시 사운드와 UI 불일치 가능성. UX 논의 후 `isPlaying`이 true이면 `undo()`/`redo()`에서 early return 추가 고려.

4. **Mac vs Windows 플랫폼 감지:** `navigator.userAgent` 기반 isMac 판단. jsdom에서는 `Mac`이 포함되지 않으므로 `ctrlKey`로 동작(Ctrl+Z). 실제 Mac 브라우저에서 Cmd+Z(metaKey)로 동작. 단위 테스트는 `ctrlKey` 기반으로 작성.

5. **Ctrl+Y 충돌:** Ctrl+Y는 일부 환경(크롬 Windows)에서 redo 관례. 현재 구현은 `!isMac && ctrlKey && !shiftKey && key==='y'`로 처리. Mac에서는 Ctrl+Y가 redo로 동작하지 않음(Cmd+Shift+Z 사용).

6. **PatchLibrary.tsx의 setProject:** `PatchLibrary`에서 `loadPatch` 후 `setProject(updateTrackSound(...))` 호출 — 히스토리에 자동 record됨. "Load Patch"도 undoable이 되므로 의도한 동작인지 확인. 그렇다면 추가 작업 불필요.

7. **`_lastEditAt` 네이밍:** 밑줄 접두사로 내부 전용임을 명시. 외부 코드에서 직접 읽거나 쓰지 않도록 컨벤션 유지. 더 강한 격리가 필요하면 향후 Zustand middleware로 리팩토링 가능.
