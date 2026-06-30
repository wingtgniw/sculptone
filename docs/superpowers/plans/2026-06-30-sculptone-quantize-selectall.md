# Sculptone 노트 퀀타이즈 + 전체선택 (Ctrl+A / Q) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤 선택 노트를 현재 그리드로 퀀타이즈하고, `Ctrl/Cmd+A`로 현재 트랙 전체 노트를 선택한다. Inspector에 "Quantize" 버튼을 추가해 1개·N개 선택 뷰 양쪽에서 접근 가능하게 하고, 단축키 `Q`로도 트리거할 수 있다.

**Architecture:** 순수 함수 분리 원칙. `score-model/operations.ts`에 불변 배치 연산 `quantizeNotes`를 추가하고, `store.ts`에 `selectAllInTrack()` 액션을 추가한다. `quantizeSelection.ts`는 store 상태를 읽어 `endEdit → setProject(quantizeNotes) → endEdit` 단일 undo 스텝 패턴을 캡슐화한다. Inspector와 AppShell 단축키 양쪽에서 이 헬퍼를 호출한다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `packages/score-model/src/operations.ts` — `mapTrack`, `updateNote`, `moveNotes` 불변 패턴
> - `apps/web/src/compose/quantize.ts` — `divisionToTicks(denom, ppq)`, `snap(tick, gridTicks)` 순수 함수
> - `apps/web/src/state/store.ts` — `selectedNoteIds: string[]`, `selectedNoteId` 미러, `selectedTrackId`, `quantizeDenom: number`(기본 16), `setProject`, `endEdit`, `setSelectedNoteIds`
> - `apps/web/src/shell/shortcuts.ts` — `matchShortcut` 순수 함수 (Space/R/M/? 처리)
> - `apps/web/src/shell/AppShell.tsx` — 전역 keydown, `isInputLike` 가드, Ctrl+Z/Y 인라인 처리 패턴
> - `apps/web/src/compose/Inspector.tsx` — 0/1/N 선택 3-뷰 구조
> - `apps/web/src/ui/Button.tsx` — `variant: 'primary'|'secondary'|'ghost'|'danger'`

---

## 비목표 (이 계획에서 하지 말 것)

- strength/부분 퀀타이즈 (0..1 blend)
- duration 퀀타이즈 (끝점 스냅)
- 스윙 퀀타이즈, 휴머나이즈
- 트랙 간 전체선택 (단일 트랙만)
- 협업·백엔드
- **인프라 파일 변경** (`.github/`, 루트 설정, eslint/prettier)

---

## 설계 근거

### quantizeNotes 스냅 공식

`apps/web/src/compose/quantize.ts`의 `snap` 함수와 동일:
```ts
Math.round(start / gridTicks) * gridTicks
```
- `gridTicks <= 0` → no-op (동일 참조 반환). `quantize.ts`의 `snap` 가드와 일관.
- `ids.length === 0` → early return `p` (동일 참조).
- duration 변경 없음 (start 스냅만).
- JS `Math.round`는 반올림(0.5 → 1). start=180, grid=120 → 180/120=1.5 → round=2 → 240.

### gridTicks 산출

`PianoRoll.tsx` line 70과 동일 공식:
```ts
const gridTicks = divisionToTicks(quantizeDenom, project.transport.ppq)
// = (ppq * 4) / quantizeDenom
// 기본: ppq=480, quantizeDenom=16 → (480*4)/16 = 120 ticks (1/16음표)
```
`quantizeSelection.ts`가 `store.getState()`에서 `quantizeDenom`과 `project.transport.ppq`를 읽어 산출한다.

### selectAllInTrack

`selectedTrackId` 트랙의 모든 노트 id → `setSelectedNoteIds(ids)` 경유로 `selectedNoteId = ids[0] ?? null` 미러 자동 유지. 기존 `setSelectedNoteIds` 구현을 재사용:
```ts
selectAllInTrack: () => set((s) => {
  const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)
  const ids = track?.notes.map((n) => n.id) ?? []
  return { selectedNoteIds: ids, selectedNoteId: ids[0] ?? null }
}),
```

### quantizeSelection 단일 undo 스텝

Delete 패턴(PianoRoll.tsx `handleKeyDown`)과 동일한 `endEdit` 대칭:
```ts
endEdit()                                                           // 선행 coalesce 창 닫기
setProject(quantizeNotes(project, trackId, selectedNoteIds, gridTicks))  // 새 스텝 시작
endEdit()                                                           // 퀀타이즈 스텝 즉시 밀봉
```
이렇게 하면 이후 편집(노트 드래그 등)이 별도 undo 스텝이 된다.

### Ctrl+A 처리 위치

`matchShortcut`는 `e.ctrlKey || e.metaKey` → null 반환으로 Ctrl/Cmd 조합을 일괄 거부한다.
따라서 Ctrl+A는 Undo/Redo(Ctrl+Z/Y)와 동일하게 AppShell keydown 핸들러에서 **인라인 처리**한다:
```ts
if (mod && !e.shiftKey && k === 'a') {
  e.preventDefault()
  useStore.getState().selectAllInTrack()
}
```
기존 Undo(Ctrl+Z)/Redo(Ctrl+Shift+Z / Ctrl+Y) 분기와 충돌 없음.

### Q 단축키

`matchShortcut`에 `'quantize'` 액션 추가. 기존 단축키(Space/R/M/?) 충돌 없음.
PianoRoll `handleKeyDown`은 Delete/Backspace만 처리 — Q 충돌 없음.
Shift+Q → null (R/M 패턴과 일관).

### Inspector Quantize 버튼

1-selected 뷰와 N≥2-selected 뷰 양쪽에 Quantize 버튼 추가.
기존 Inspector 테스트(`Inspector.multiselect.test.tsx`)는 "N개 노트 선택됨" 텍스트와 슬라이더 존재 여부만 검증 → 버튼 추가 후 회귀 없음.

---

## File Structure

```
packages/score-model/src/
  operations.ts                      # MOD: quantizeNotes 추가

packages/score-model/test/
  operations.test.ts                 # MOD: quantizeNotes 완전 TDD (~11개 추가)

apps/web/src/
  state/
    store.ts                         # MOD: selectAllInTrack() 추가 (AppState + create)

  test/
    select-all-store.test.ts         # NEW: selectAllInTrack TDD (~5개)
    shortcuts.test.ts                # MOD: Q → 'quantize' 테스트 추가 (~4개)

  compose/
    quantizeSelection.ts             # NEW: quantizeSelection 헬퍼 (useStore.getState() 기반)
    Inspector.tsx                    # MOD: Quantize 버튼 + import 2개
    test/
      Inspector.quantize.test.tsx    # NEW: Quantize 버튼 스모크 (~4개)

  shell/
    shortcuts.ts                     # MOD: ShortcutAction에 'quantize' 추가, Q 매칭
    AppShell.tsx                     # MOD: Ctrl+A 인라인 처리, Q action 배선
    ShortcutsHelp.tsx                # MOD: SHORTCUTS 배열에 Ctrl+A / Q 항목 추가
```

변경 없는 파일:
- `packages/score-model/src/index.ts` — `export * from './operations'`로 자동 재내보내기
- `apps/web/src/compose/quantize.ts` — `divisionToTicks`, `snap` 재사용 (수정 없음)
- `apps/web/src/compose/PianoRoll.tsx` — 변경 없음
- `apps/web/src/compose/test/PianoRoll.*.test.tsx` — 전부 불변
- `apps/web/src/compose/test/Inspector.multiselect.test.tsx` — 기존 3개 PASS (Quantize 버튼 추가는 텍스트·슬라이더 단언에 영향 없음)
- `apps/web/src/test/multi-select-store.test.ts` — 불변
- `apps/web/src/test/shortcuts-store.test.ts` — 불변
- `apps/web/src/compose/VelocityLane.tsx`, `velocity.ts` — 불변

---

## Task 1: score-model/operations.ts — quantizeNotes 배치 연산 (완전 TDD)

**Files:** Modify `packages/score-model/src/operations.ts`, Modify `packages/score-model/test/operations.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/score-model/test/operations.test.ts` 끝에 추가:

```ts
import { quantizeNotes } from '../src/operations'

// ── quantizeNotes ─────────────────────────────────────────────

describe('quantizeNotes', () => {
  function makeProject() {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    const nA = createNote({ pitch: 60, start: 250, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 430, duration: 240, velocity: 80 })
    const nC = createNote({ pitch: 64, start: 0,   duration: 120, velocity: 90 })
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    p = addNote(p, t1.id, nA)
    p = addNote(p, t1.id, nB)
    p = addNote(p, t2.id, nC)
    return { p, t1, t2, nA, nB, nC }
  }

  it('ids=[] → 동일 참조 반환 (early return)', () => {
    const { p, t1 } = makeProject()
    const result = quantizeNotes(p, t1.id, [], 120)
    expect(result).toBe(p)
  })

  it('gridTicks=0 → 동일 참조 반환 (no-op)', () => {
    const { p, t1, nA } = makeProject()
    const result = quantizeNotes(p, t1.id, [nA.id], 0)
    expect(result).toBe(p)
  })

  it('gridTicks<0 → 동일 참조 반환 (no-op)', () => {
    const { p, t1, nA } = makeProject()
    const result = quantizeNotes(p, t1.id, [nA.id], -1)
    expect(result).toBe(p)
  })

  it('단일 노트 스냅: start=250, gridTicks=120 → round(250/120)*120 = 2*120 = 240', () => {
    // 250/120 = 2.083... → round = 2 → 2*120 = 240
    const { p, t1, nA } = makeProject()
    const result = quantizeNotes(p, t1.id, [nA.id], 120)
    const moved = result.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.start).toBe(240)
  })

  it('정확히 중간값(half-grid): start=180, gridTicks=120 → round(1.5)*120 = 2*120 = 240', () => {
    // JS Math.round(1.5) = 2 (반올림)
    const { p, t1, nA } = makeProject()
    // nA.start를 180으로 세팅하려면 새 project 필요
    const t = createTrack('T')
    const n = createNote({ pitch: 60, start: 180, duration: 480, velocity: 100 })
    const proj = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const result = quantizeNotes(proj, t.id, [n.id], 120)
    expect(result.tracks[0]!.notes[0]!.start).toBe(240)
  })

  it('이미 정렬된 노트: start=480, gridTicks=120 → 480 (변경 없음)', () => {
    const t = createTrack('T')
    const n = createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 })
    const proj = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const result = quantizeNotes(proj, t.id, [n.id], 120)
    expect(result.tracks[0]!.notes[0]!.start).toBe(480)
  })

  it('복수 노트 동시 스냅: nA.start=250→240, nB.start=430→480', () => {
    // 250/120=2.083 → 2*120=240 / 430/120=3.583 → 4*120=480
    const { p, t1, nA, nB } = makeProject()
    const result = quantizeNotes(p, t1.id, [nA.id, nB.id], 120)
    const notes = result.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nA.id)!.start).toBe(240)
    expect(notes.find((n) => n.id === nB.id)!.start).toBe(480)
  })

  it('ids에 없는 노트는 변경되지 않는다', () => {
    const { p, t1, nA, nB } = makeProject()
    // nA만 퀀타이즈 → nB는 start=430 유지
    const result = quantizeNotes(p, t1.id, [nA.id], 120)
    const notes = result.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nB.id)!.start).toBe(430)
  })

  it('다른 트랙의 노트는 변경되지 않는다', () => {
    const { p, t1, t2, nA, nC } = makeProject()
    const result = quantizeNotes(p, t1.id, [nA.id], 120)
    const t2Notes = result.tracks.find((t) => t.id === t2.id)!.notes
    expect(t2Notes.find((n) => n.id === nC.id)!.start).toBe(0)
  })

  it('불변성: 원본 project가 변경되지 않는다', () => {
    const { p, t1, nA } = makeProject()
    const origStart = p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start
    quantizeNotes(p, t1.id, [nA.id], 120)
    expect(
      p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start,
    ).toBe(origStart)
  })

  it('duration은 변경되지 않는다 (start만 스냅)', () => {
    const { p, t1, nA } = makeProject()
    const origDuration = p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.duration
    const result = quantizeNotes(p, t1.id, [nA.id], 120)
    const moved = result.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.duration).toBe(origDuration)
  })

  it('start=0인 노트는 0으로 유지된다 (0이 이미 grid-aligned)', () => {
    const t = createTrack('T')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const proj = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const result = quantizeNotes(proj, t.id, [n.id], 120)
    expect(result.tracks[0]!.notes[0]!.start).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/score-model test -- operations.test
```

Expected: FAIL — `quantizeNotes` 없음.

- [ ] **Step 3: operations.ts에 quantizeNotes 추가**

`packages/score-model/src/operations.ts` 파일 끝에 추가:

```ts
/**
 * 지정 트랙에서 ids에 포함된 노트들의 start를 gridTicks 배수로 스냅한다 (불변).
 *
 * - start = Math.round(start / gridTicks) * gridTicks
 * - duration은 변경하지 않는다.
 * - ids에 없는 노트·다른 트랙은 변경하지 않는다.
 * - ids.length === 0 이거나 gridTicks <= 0 이면 동일 참조 early return (no-op).
 *
 * 스냅 공식은 apps/web/src/compose/quantize.ts의 snap()과 동일하다.
 */
export function quantizeNotes(
  p: Project,
  trackId: string,
  ids: string[],
  gridTicks: number,
): Project {
  if (ids.length === 0 || gridTicks <= 0) return p
  const idSet = new Set(ids)
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      idSet.has(n.id)
        ? { ...n, start: Math.round(n.start / gridTicks) * gridTicks }
        : n,
    ),
  }))
}
```

**구현 노트:**
- `ids.length === 0 || gridTicks <= 0` early return으로 동일 참조 보존.
- `idSet = new Set(ids)` O(1) 조회.
- `mapTrack`은 이미 파일 내 private helper — 재사용.
- `pitch`·`duration`·기타 필드는 `...n` 스프레드로 보존.
- `Math.round(0 / gridTicks) * gridTicks === 0` — start=0 노트 안전.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/score-model test -- operations.test
```

Expected: 기존 operations/moveNotes/updateTrackSound describe 블록 전부 PASS + 신규 quantizeNotes **11개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/score-model exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 2: store.ts — selectAllInTrack 액션 (완전 TDD)

**Files:** Modify `apps/web/src/state/store.ts`, Create `apps/web/src/test/select-all-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/select-all-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { addNote, createNote, createTrack, createEmptyProject, addTrack } from '@sculptone/score-model'

describe('selectAllInTrack', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('트랙에 3개 노트 → selectedNoteIds에 3개 id 모두 포함', () => {
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const n1 = createNote({ pitch: 60, start: 0,   duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    const n3 = createNote({ pitch: 64, start: 720, duration: 120, velocity: 90 })
    let p = addNote(s.project, tid, n1)
    p = addNote(p, tid, n2)
    p = addNote(p, tid, n3)
    s.setProject(p)
    useStore.getState().selectAllInTrack()
    const ids = useStore.getState().selectedNoteIds
    expect(ids).toHaveLength(3)
    expect(ids).toContain(n1.id)
    expect(ids).toContain(n2.id)
    expect(ids).toContain(n3.id)
  })

  it('빈 트랙 → selectedNoteIds=[], selectedNoteId=null', () => {
    // 초기 트랙은 노트 없음
    useStore.getState().selectAllInTrack()
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  it('미러 불변식: selectedNoteId === selectedNoteIds[0] ?? null', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    useStore.getState().selectAllInTrack()
    const state = useStore.getState()
    expect(state.selectedNoteId).toBe(state.selectedNoteIds[0] ?? null)
  })

  it('반복 호출 → 동일 결과 (멱등성)', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0,   duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    s.setProject(addNote(addNote(s.project, s.selectedTrackId, n1), s.selectedTrackId, n2))
    useStore.getState().selectAllInTrack()
    const first = [...useStore.getState().selectedNoteIds]
    useStore.getState().selectAllInTrack()
    const second = useStore.getState().selectedNoteIds
    expect(second).toEqual(first)
  })

  it('존재하지 않는 selectedTrackId → selectedNoteIds=[], selectedNoteId=null', () => {
    // selectedTrackId를 무효 값으로 강제 설정
    useStore.setState({ selectedTrackId: 'no-such-track' })
    useStore.getState().selectAllInTrack()
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- select-all-store.test
```

Expected: FAIL — `selectAllInTrack` 없음 (타입 에러 또는 런타임 에러).

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts`:

**3a) AppState 인터페이스에 추가** — `clearNoteSelection` 선언 이후:

```ts
/**
 * 현재 selectedTrackId 트랙의 모든 노트 id를 selectedNoteIds로 설정한다.
 * selectedNoteId 미러(= ids[0] ?? null)를 자동 갱신한다.
 * 트랙 없거나 노트 0개이면 빈 선택(selectedNoteIds=[], selectedNoteId=null).
 */
selectAllInTrack: () => void
```

**3b) create\<AppState\> 구현에 추가** — `clearNoteSelection` 구현 이후:

```ts
selectAllInTrack: () =>
  set((s) => {
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)
    const ids = track?.notes.map((n) => n.id) ?? []
    return { selectedNoteIds: ids, selectedNoteId: ids[0] ?? null }
  }),
```

**변경 최소화 확인:** 기존 필드/액션 순서 불변. `setSelectedNoteIds` 구현을 복제하지 않고 `set` 직접 호출.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- select-all-store.test
```

Expected: **5개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. `AppState.selectAllInTrack: () => void` 선언과 구현 일치.

---

## Task 3: quantizeSelection 헬퍼 + Inspector Quantize 버튼 (레퍼런스 구현 + 스모크)

**Files:** Create `apps/web/src/compose/quantizeSelection.ts`, Modify `apps/web/src/compose/Inspector.tsx`, Create `apps/web/src/compose/test/Inspector.quantize.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/Inspector.quantize.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { Inspector } from '../Inspector'

describe('Inspector Quantize button smoke', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('1개 선택 → Quantize 버튼 렌더', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeInTheDocument()
  })

  it('2개 선택 → Quantize 버튼 렌더', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0,   duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    let p = addNote(s.project, s.selectedTrackId, n1)
    p = addNote(p, s.selectedTrackId, n2)
    s.setProject(p)
    s.setSelectedNoteIds([n1.id, n2.id])
    render(<Inspector />)
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeInTheDocument()
  })

  it('Quantize 버튼 클릭 → 선택 노트 start가 gridTicks 배수로 스냅된다', () => {
    // quantizeDenom=16(기본), ppq=480 → gridTicks = 480*4/16 = 120
    // start=130 → round(130/120)*120 = round(1.083)*120 = 1*120 = 120
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 130, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Quantize' }))
    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes.find((nn) => nn.id === n.id)!.start).toBe(120)
  })

  it('0개 선택 → Quantize 버튼 없음', () => {
    render(<Inspector />)
    expect(screen.queryByRole('button', { name: 'Quantize' })).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- Inspector.quantize
```

Expected: FAIL — `'../quantizeSelection'` 모듈 없음 또는 Quantize 버튼 없음.

- [ ] **Step 3: quantizeSelection.ts 구현**

Create `apps/web/src/compose/quantizeSelection.ts`:

```ts
/**
 * 현재 선택 노트를 현재 그리드(quantizeDenom/ppq)로 퀀타이즈한다.
 *
 * - 선택 노트 없음 → no-op.
 * - endEdit() → setProject(quantizeNotes(...)) → endEdit() 패턴으로
 *   단일 undo 스텝을 생성한다.
 * - store 상태를 useStore.getState()로 직접 읽어 stale 클로저를 방지한다.
 */
import { quantizeNotes } from '@sculptone/score-model'
import { useStore } from '../state/store'
import { divisionToTicks } from './quantize'

export function quantizeSelection(): void {
  const {
    selectedNoteIds,
    selectedTrackId,
    project,
    quantizeDenom,
    endEdit,
    setProject,
  } = useStore.getState()

  if (selectedNoteIds.length === 0) return

  const gridTicks = divisionToTicks(quantizeDenom, project.transport.ppq)

  endEdit()
  setProject(quantizeNotes(project, selectedTrackId, selectedNoteIds, gridTicks))
  endEdit()
}
```

- [ ] **Step 4: Inspector.tsx 수정**

`apps/web/src/compose/Inspector.tsx` 수정:

**4a) import 추가** — 파일 상단:

```ts
import { Button } from '../ui/Button'
import { quantizeSelection } from './quantizeSelection'
```

**4b) N≥2 selected 뷰에 Quantize 버튼 추가** — 기존:

```tsx
  if (count >= 2) {
    return (
      <div style={{ padding: '14px 12px' }}>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-lo)',
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            margin: '0 0 10px',
          }}
        >
          Inspector
        </p>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 2.2 }}>
          {count}개 노트 선택됨
        </div>
      </div>
    )
  }
```

교체:

```tsx
  if (count >= 2) {
    return (
      <div style={{ padding: '14px 12px' }}>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-lo)',
            textTransform: 'uppercase',
            letterSpacing: '.1em',
            margin: '0 0 10px',
          }}
        >
          Inspector
        </p>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 2.2 }}>
          {count}개 노트 선택됨
        </div>
        <Button
          variant="secondary"
          style={{ fontSize: 11, padding: '4px 10px', width: '100%', marginTop: 10 }}
          onClick={quantizeSelection}
        >
          Quantize
        </Button>
      </div>
    )
  }
```

**4c) 1개 selected 뷰에 Quantize 버튼 추가** — 기존 return JSX의 마지막 `<div style={row}>Pitch...` 블록 이후, 닫는 `</div>` 직전:

```tsx
        <Button
          variant="secondary"
          style={{ fontSize: 11, padding: '4px 10px', width: '100%', marginTop: 10 }}
          onClick={quantizeSelection}
        >
          Quantize
        </Button>
```

전체 1-selected 뷰 return은 다음과 같이 된다:

```tsx
  return (
    <div style={{ padding: '14px 12px' }}>
      <p
        style={{
          fontSize: 11,
          color: 'var(--text-lo)',
          textTransform: 'uppercase',
          letterSpacing: '.1em',
          margin: '0 0 10px',
        }}
      >
        Inspector
      </p>
      <div style={row}>
        Velocity{' '}
        <span className="mono" style={val}>
          {note.velocity}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={127}
        value={note.velocity}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
        onChange={(e) =>
          setProject(updateNote(project, trackId, note.id, { velocity: Number(e.target.value) }))
        }
      />
      <div style={row}>
        Length{' '}
        <span className="mono" style={val}>
          {note.duration}t
        </span>
      </div>
      <div style={row}>
        Pitch{' '}
        <span className="mono" style={val}>
          {noteName(note.pitch)}
        </span>
      </div>
      <Button
        variant="secondary"
        style={{ fontSize: 11, padding: '4px 10px', width: '100%', marginTop: 10 }}
        onClick={quantizeSelection}
      >
        Quantize
      </Button>
    </div>
  )
```

**구현 노트:**
- `Button` variant="secondary": `var(--bg-elevated)` 배경, `var(--border-strong)` 테두리.
- `style={{ ..., width: '100%', marginTop: 10 }}`: Inspector 너비에 맞춤, 기존 필드와 간격.
- `onClick={quantizeSelection}`: 클로저 없이 안정적 참조.
- React 타입 네임스페이스 미사용 — named import만.

- [ ] **Step 5: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- Inspector.quantize
```

Expected: **4개** PASS.

- [ ] **Step 6: 기존 Inspector 테스트 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- Inspector
```

Expected:
- `Inspector.multiselect.test.tsx` 기존 3개 PASS:
  - "노트를 선택하세요" 텍스트 — 0개 뷰 변경 없음 ✓
  - "2개 노트 선택됨" 텍스트 — 여전히 존재 (Quantize 버튼 추가는 텍스트를 대체하지 않음) ✓
  - `getByRole('slider')` — 1개 뷰 velocity slider 여전히 존재 ✓
- `Inspector.quantize.test.tsx` 신규 4개 PASS

---

## Task 4: shortcuts.ts + AppShell.tsx + ShortcutsHelp.tsx — 단축키 배선

**Files:** Modify `apps/web/src/shell/shortcuts.ts`, Modify `apps/web/src/shell/AppShell.tsx`, Modify `apps/web/src/shell/ShortcutsHelp.tsx`, Modify `apps/web/src/test/shortcuts.test.ts`

- [ ] **Step 1: shortcuts.test.ts에 실패 테스트 추가**

`apps/web/src/test/shortcuts.test.ts` 끝에 추가:

```ts
// ── Q → 'quantize' ───────────────────────────────────────────

describe("Q → 'quantize'", () => {
  it('소문자 q는 quantize를 반환한다', () => {
    expect(matchShortcut(ev('q'))).toBe('quantize')
  })

  it('대문자 Q(CapsLock, shiftKey=false)는 quantize를 반환한다', () => {
    expect(matchShortcut(ev('Q', { shiftKey: false }))).toBe('quantize')
  })

  it('Shift+Q(shiftKey=true)는 null을 반환한다', () => {
    expect(matchShortcut(ev('Q', { shiftKey: true }))).toBeNull()
  })

  it('Ctrl+Q는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev('q', { ctrlKey: true }))).toBeNull()
  })

  it('INPUT 포커스 시 q는 null을 반환한다 (타깃 가드)', () => {
    expect(matchShortcut(ev('q', { targetTag: 'INPUT' }))).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts.test
```

Expected: FAIL — `matchShortcut(ev('q'))` returns null (아직 quantize 없음).

- [ ] **Step 3: shortcuts.ts 수정**

`apps/web/src/shell/shortcuts.ts`:

**3a) ShortcutAction 타입 확장:**

기존:
```ts
export type ShortcutAction = 'play' | 'record' | 'metronome' | 'help'
```

교체:
```ts
export type ShortcutAction = 'play' | 'record' | 'metronome' | 'help' | 'quantize'
```

**3b) 주석 업데이트** — 반환값 목록에 추가:
```ts
 *   'quantize'   — Q (수식어 없음, 대소문자 무관)
```

**3c) 키 매칭 추가** — `if (e.key === '?')` 줄 이전:
```ts
  // Q: !shiftKey 조건으로 Shift+Q는 null. R/M 패턴과 일관.
  if (e.key.toLowerCase() === 'q' && !e.shiftKey) return 'quantize'
```

- [ ] **Step 4: shortcuts.test 통과 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts.test
```

Expected: 기존 단언 전부 PASS + 신규 Q→quantize **5개** PASS. 특히:
- "기타" describe의 `'관련 없는 키(a)는 null'` 테스트 — a ≠ q, 여전히 PASS ✓

- [ ] **Step 5: AppShell.tsx 수정**

`apps/web/src/shell/AppShell.tsx`:

**5a) import 추가** — 파일 상단 `import { matchShortcut }` 줄 아래:
```ts
import { quantizeSelection } from '../compose/quantizeSelection'
```

**5b) keydown 핸들러 수정** — 기존 `if (!isInputLike)` 블록 내부, Redo(Ctrl+Y) 처리 직후에 Ctrl+A 추가:

기존:
```ts
      if (!isInputLike) {
        const mod = isMac ? e.metaKey : e.ctrlKey
        const k = e.key.toLowerCase()
        if (mod && !e.shiftKey && k === 'z') {
          e.preventDefault()
          undo()
        }
        if (mod && e.shiftKey && k === 'z') {
          e.preventDefault()
          redo()
        }
        if (!isMac && e.ctrlKey && !e.shiftKey && k === 'y') {
          e.preventDefault()
          redo()
        }
      }
```

교체:
```ts
      if (!isInputLike) {
        const mod = isMac ? e.metaKey : e.ctrlKey
        const k = e.key.toLowerCase()
        if (mod && !e.shiftKey && k === 'z') {
          e.preventDefault()
          undo()
        }
        if (mod && e.shiftKey && k === 'z') {
          e.preventDefault()
          redo()
        }
        if (!isMac && e.ctrlKey && !e.shiftKey && k === 'y') {
          e.preventDefault()
          redo()
        }
        // Ctrl/Cmd+A: 현재 트랙 전체 노트 선택
        if (mod && !e.shiftKey && k === 'a') {
          e.preventDefault()
          useStore.getState().selectAllInTrack()
        }
      }
```

**5c) matchShortcut action 처리에 quantize 추가** — 기존 `else if (action === 'help')` 블록 이후:

기존:
```ts
      } else if (action === 'help') {
        toggleShortcuts()
      }
```

교체:
```ts
      } else if (action === 'help') {
        toggleShortcuts()
      } else if (action === 'quantize') {
        quantizeSelection()
      }
```

**5d) useEffect deps 배열 확인:** `selectAllInTrack`은 `useStore.getState()`를 통해 호출되므로 deps 배열에 추가 불필요. `quantizeSelection`은 독립 import 함수로 ref-stable. deps 변경 없음: `[undo, redo, isMac, play, stop]` 유지.

- [ ] **Step 6: ShortcutsHelp.tsx 수정**

`apps/web/src/shell/ShortcutsHelp.tsx`의 `SHORTCUTS` 배열에 2개 항목 추가:

기존 배열 끝(Ctrl+D 항목 이후, `?` 항목 이전)에 삽입:
```ts
  { keys: 'Ctrl+A / Cmd+A', desc: '현재 트랙 모든 노트 전체 선택' },
  { keys: 'Q', desc: '선택 노트 퀀타이즈 (현재 그리드)' },
```

**위치 전략:** 편집 관련 단축키(Undo/Redo/Delete/Clipboard/Duplicate) 직후, 도움말 `?` 직전 배치.

- [ ] **Step 7: AppShell 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell
```

Expected: `AppShell.compose.test.tsx` 기존 테스트 전부 PASS. `AppShell.test.tsx` 전부 PASS.

**AppShell 회귀 분석:**

| 기존 테스트 | 변경 영향 | 판정 |
|---|---|---|
| `pianoroll` testid 존재 | 변경 없음 | PASS |
| Piano 버튼 존재 | TracksPanel 불변 | PASS |
| 재생 버튼 존재 | TransportBar 불변 | PASS |
| FileMenu 버튼들 | 툴바 불변 | PASS |
| useAutosave 호출 | hook 불변 | PASS |
| ShortcutsHelp 렌더 | SHORTCUTS 배열 확장(텍스트 추가) → 기존 테스트가 특정 텍스트를 단언하지 않으면 PASS | PASS |

---

## Task 5: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 score-model 테스트**

```bash
pnpm --filter @sculptone/score-model test
```

Expected: 기존 전부 유지 + quantizeNotes 11개.

- [ ] **Step 2: 전체 web 패키지 테스트**

```bash
pnpm --filter @sculptone/web test
```

Expected: 기존 전부 PASS + 신규:

| 테스트 파일 | 신규 | 비고 |
|---|---|---|
| `select-all-store.test.ts` | 5개 | selectAllInTrack |
| `shortcuts.test.ts` | 5개 | Q → quantize |
| `Inspector.quantize.test.tsx` | 4개 | Quantize 버튼 스모크 |
| `Inspector.multiselect.test.tsx` | 0 (기존 3개 유지) | 회귀 없음 확인 |

- [ ] **Step 3: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 신규 | 기존 |
|---|---|---|
| `@sculptone/score-model` | 11 (quantizeNotes) | 유지 |
| `@sculptone/sound-engine` | 0 | 유지 |
| `@sculptone/web` | 5+5+4=14 | 전부 유지 |

**회귀 전수 점검:**

| 테스트 파일 | 위험 | 판정 |
|---|---|---|
| `PianoRoll.drag.test.tsx` | Inspector/shortcuts 변경 무관 | PASS |
| `PianoRoll.multiselect.test.tsx` | 동일 | PASS |
| `PianoRoll.multi-drag.test.tsx` | 동일 | PASS |
| `multi-select-store.test.ts` | `selectAllInTrack` 추가는 기존 `setSelectedNoteIds` 등에 영향 없음 | PASS |
| `shortcuts.test.ts` 기존 항목 | `matchShortcut(ev('a'))` → null ('a' ≠ 'q') | PASS |
| `ShortcutsHelp.test.tsx` | SHORTCUTS 배열 확장. 기존 테스트가 특정 행 텍스트만 단언하지 않으면 PASS | 확인 필요¹ |
| `AppShell.compose.test.tsx` | Inspector 변경이 pianoroll testid에 영향 없음 | PASS |
| `VelocityLane.drag.test.tsx` | 완전 별개 | PASS |

¹ `ShortcutsHelp.test.tsx`가 SHORTCUTS 배열 항목 수를 단언하거나 특정 행 텍스트를 검사하면 업데이트 필요. 계획 작성 시점에 해당 테스트를 직접 확인하지 않았으므로 구현 시 먼저 `pnpm --filter @sculptone/web test -- ShortcutsHelp` 실행 후 회귀 여부 확인할 것.

- [ ] **Step 4: 타입체크 + 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/score-model exec tsc --noEmit
pnpm --filter @sculptone/web build
```

Expected: 에러 없음. 특히:
- `quantizeNotes(p: Project, trackId: string, ids: string[], gridTicks: number): Project` — 반환 `Project` ✓
- `selectAllInTrack: () => void` — AppState 인터페이스와 구현 일치 ✓
- `quantizeSelection(): void` — `useStore.getState()` 구조분해 타입 일치 ✓
- `ShortcutAction = 'play'|'record'|'metronome'|'help'|'quantize'` — AppShell `action === 'quantize'` 분기 타입-안전 ✓
- `Button` import — named import, React 타입 네임스페이스 미사용 ✓
- `quantizeSelection` import in AppShell — named import ✓
- 빌드 성공

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과. 기존 테스트 회귀 0.
- `quantizeNotes`: ids=[]/gridTicks<=0 early return, start 스냅, duration 불변, 다른 트랙/미선택 노트 불변, 불변성. 11개 통과.
- `selectAllInTrack`: 전체 id 수집, 빈 트랙/무효 trackId 빈 선택, `selectedNoteId` 미러 불변식, 멱등성. 5개 통과.
- `quantizeSelection`: 선택 없음 → no-op, `endEdit()→setProject→endEdit()` 단일 undo 스텝.
- Quantize 버튼: 1-selected/N-selected 뷰에 렌더, 클릭 시 start 스냅. Inspector 스모크 4개 통과.
- `Ctrl/Cmd+A`: `selectAllInTrack()` 호출, `isInputLike` 가드, `preventDefault()`, e.repeat 처리는 불필요(selectAll은 반복 안전).
- `Q` 단축키: `matchShortcut` → 'quantize', `isInputLike` 가드, Shift+Q/Ctrl+Q → null. 5개 통과.
- ShortcutsHelp에 Ctrl+A / Q 항목 추가.
- 기존 Inspector 테스트(0개/"N개"/"slider") 회귀 없음.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.
- React 타입 네임스페이스 미사용(named import만). 디자인 토큰 사용.
- 인프라/CI 파일 수정 없음. `score-model/index.ts` 수정 없음(`export * from './operations'` 자동 재내보내기).

---

## 다음 증분

- **휴머나이즈**: strength(0..1) 파라미터로 원본 start와 퀀타이즈 결과 사이를 보간. `quantizeNotes(p, tid, ids, gridTicks, strength=1)` 시그니처 확장 — 현재 strength 없는 버전과 완전 하위호환.
- **duration 퀀타이즈**: 끝점(`start + duration`)도 gridTicks로 스냅. Inspector에 "Quantize Duration" 옵션 또는 별도 버튼.
- **스윙 퀀타이즈**: 짝수/홀수 그리드 위치에 다른 오프셋을 적용해 그루브 생성.
- **strength/부분 퀀타이즈 슬라이더**: Inspector에 0~100% 슬라이더 추가. 휴머나이즈 기능의 역수.
- **Inspector 퀀타이즈 undo 확인 표시**: Quantize 후 "퀀타이즈됨" 피드백(일시적 색상 변화 등).

---

## 열린 질문

1. **ShortcutsHelp.test.tsx 회귀**: 계획 작성 시점에 내용을 직접 확인하지 않았다. 구현 시 `pnpm --filter @sculptone/web test -- ShortcutsHelp`를 먼저 실행해 SHORTCUTS 배열 확장이 기존 단언과 충돌하는지 확인할 것. 충돌 시 해당 테스트도 업데이트(항목 수 단언이 있으면 +2로 수정).

2. **e.repeat 가드(Ctrl+A)**: 현재 계획은 Ctrl+A에 `e.repeat` 체크를 추가하지 않았다(반복 전체선택은 무해함). 반복 호출 시 상태가 동일하므로 오토리피트 폭주 문제 없음. 하지만 Q(quantize)는 `matchShortcut` 경로를 따르므로 기존 `if (e.repeat) return` 가드가 자동 적용된다. 대칭성이 필요하다면 Ctrl+A에도 `if (e.repeat) return`을 추가할 수 있다.

3. **quantizeSelection의 project stale 문제**: `useStore.getState()`를 함수 진입 시점에 1회 읽으므로 스냅샷이다. `endEdit()` 후 store 상태가 변경되지 않으므로(endEdit은 `_lastEditAt=0`만 갱신) 이 스냅샷은 안전하다.

4. **Ctrl+A와 브라우저 기본 동작(텍스트 전체선택)**: `e.preventDefault()`로 브라우저 기본 동작을 차단한다. `isInputLike` 가드가 선행하므로 입력 필드 포커스 시엔 Ctrl+A가 발동되지 않는다(브라우저 기본 텍스트 전체선택 동작 보존).

5. **Q 키 한국어 IME 충돌**: 한국어 IME 활성 시 Q 키가 'ㅂ'로 처리되어 `e.key === 'q'` 매칭이 실패할 수 있다. 현재 Inspector Quantize 버튼이 대안으로 존재하므로 허용 가능한 트레이드오프. 향후 필요 시 `e.code === 'KeyQ'` 매칭으로 전환 검토.
