# Sculptone 멀티노트 선택 (다중 선택 + 클립보드/삭제) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤에서 Shift-클릭 및 Shift-드래그(박스 선택)로 여러 노트를 동시 선택하고, Delete로 일괄 삭제하며, Ctrl/Cmd+C/X/V/D로 다중 노트 클립보드 조작을 할 수 있게 한다. 기존 670개 테스트, 단일 선택·드래그·클립보드 동작을 완전히 보존한다.

**Architecture:** 순수 함수 분리 원칙을 확장해 `selection.ts`(`notesInRect`)와 `clipboard.ts` 다중 노트 함수(`pasteNotesParams`, `duplicateNotesParams`)를 완전 TDD로 구현한다. `store.ts`에 `selectedNoteIds: string[]`(주 선택 상태)를 추가하되, `selectedNoteId: string|null`을 동기화 미러 필드로 유지해 기존 22개 테스트 단언을 **무수정**으로 통과시킨다. 클립보드도 동일하게 `clipboardNotes: Note[]`를 추가하고 `clipboardNote`는 미러로 유지한다. PianoRoll은 Shift+포인터다운 분기를 추가하고, 박스 선택 시각화를 `useState`로 관리한다. useClipboard는 `selectedNoteIds` 기반으로 다중 노트를 처리하면서 단일 노트 경로도 모두 통과시킨다. Inspector는 선택 수에 따라 단일·다중·없음 뷰를 전환한다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:**
> - `apps/web/src/state/store.ts` — `selectedNoteId`, `clipboardNote`, `selectNote`, `correctNoteId`
> - `apps/web/src/compose/PianoRoll.tsx` — 기존 드래그/생성/삭제 상호작용
> - `apps/web/src/compose/Inspector.tsx` — 단일 노트 속성 표시
> - `apps/web/src/compose/clipboard.ts` — `barTicks`, `duplicateNoteParams`, `pasteNoteParams`
> - `apps/web/src/compose/useClipboard.ts` — 기존 C/X/V/D 훅
> - `apps/web/src/compose/geometry.ts` — `xToTick`, `yToPitch`, `tickToX`, `pitchToY`
> - `apps/web/src/compose/quantize.ts` — `snap`, `divisionToTicks`
> - `packages/score-model/src/operations.ts` — `addNote`, `removeNote`, `createNote`

---

## 비목표 (이 계획에서 하지 말 것)

- **여러 노트 동시 드래그 이동/리사이즈** — 다음 증분으로 명시. 기존 단일 노트 드래그는 그대로 유지.
- 좌측 리사이즈 핸들(start 이동)
- 트랙 간 다중 선택
- 다중 선택 velocity 일괄 스케일 편집 (2개+ Inspector는 "N개 선택됨" 표시만)
- 시스템 클립보드 연동 (`navigator.clipboard`)
- 다중 선택 직사각형 드래그 자동 스크롤
- Ctrl+A 전체 선택 (열린 질문 참조 — 원하면 소규모 추가 가능하지만 핵심 아님)
- 협업·백엔드
- 인프라 파일 변경 (`.github/`, 루트 설정, eslint/prettier config)

---

## 설계 근거

### 선택 모델 마이그레이션 전략: 미러 필드

`selectedNoteId: string|null`을 완전히 제거하면 7개 파일의 22개 테스트 단언이 깨진다.
대신 **두 필드를 함께 유지하고 항상 동기화**한다:

- `selectedNoteIds: string[]` — 주 다중 선택 상태 (신규)
- `selectedNoteId: string|null` — 미러: 항상 `selectedNoteIds[0] ?? null` (기존 호환)

모든 selection 변경 액션은 두 필드를 동시에 갱신한다:

| 액션 | selectedNoteId | selectedNoteIds |
|------|----------------|-----------------|
| `selectNote(id)` | id | `[id]` |
| `selectNote(null)` | null | `[]` |
| `toggleNoteSelection(id)` — 추가 | `ids[0] ?? null` | 기존+id |
| `toggleNoteSelection(id)` — 제거 | `ids[0] ?? null` | 기존-id |
| `setSelectedNoteIds(ids)` | `ids[0] ?? null` | ids |
| `clearNoteSelection()` | null | `[]` |
| `selectTrack(id)` | null | `[]` |
| `replaceProject(p)` | null | `[]` |
| `undo/redo` | `correctNoteId(...)` | `correctNoteIds(...)` |

이 전략으로 기존 22개 `selectedNoteId` 단언 테스트를 **무수정**으로 통과시킨다.

### 클립보드 미러 전략

동일 패턴:

- `clipboardNotes: Note[]` — 주 다중 클립보드 (신규)
- `clipboardNote: Note|null` — 미러: `clipboardNotes[0] ?? null` (기존 호환)
- `setClipboardNote(note)` → `{ clipboardNote: note, clipboardNotes: note ? [note] : [] }` (기존 sig 유지)
- `setClipboardNotes(notes)` → `{ clipboardNotes: notes, clipboardNote: notes[0] ?? null }` (신규)

기존 `clipboard-store.test.ts`(4개)와 `useClipboard.test.tsx`에서 `clipboardNote`를 단언하는 테스트 전부 **무수정** 통과.

### notesInRect 겹침 규칙

**틱 겹침 (반개구간 [startTick, endTick)):**
```
note.start < rect.endTick  AND  note.start + note.duration > rect.startTick
```
- 노트가 rect 끝(`endTick`)에서 시작: 제외 (exclusive end)
- 노트 끝이 rect 시작(`startTick`)에 정확히 닿음: 제외 (끝이 경계를 넘어야 포함)
- 부분 겹침(노트가 좌측 또는 우측으로 삐져나옴): **포함** (표준 DAW 동작)
- 노트가 rect를 완전히 감싸는 경우: **포함**

**피치 겹침 (폐구간 [pitchLow, pitchHigh]):**
```
note.pitch >= rect.pitchLow  AND  note.pitch <= rect.pitchHigh
```
피치는 정수 MIDI 번호이므로 경계 포함이 직관적.

### 박스 선택 vs 생성 분기

| 제스처 | 동작 |
|--------|------|
| 빈 그리드 일반 클릭 (no shift) | 노트 생성 (기존) |
| 빈 그리드 Shift+클릭 또는 Shift+드래그 | 박스 선택 시작 |
| 노트 위 일반 포인터다운 (no shift) | 단일 선택 + 드래그 준비 (기존) |
| 노트 위 Shift+포인터다운 | `toggleNoteSelection` — 추가/제거 |

Shift 키 체크를 `handleGridPointerDown` 최상단과 `handleNotePointerDown` 최상단에서 분기한다.

박스 선택 시각화: `useState<{x,y,w,h}|null>` + 절대 배치 overlay div. `boxSelRef`(useRef)에 원점 좌표 보관, `pointermove`마다 `setState`로 시각 갱신, `pointerup`에서 `notesInRect` 적용 후 클리어.

### Delete 다중 삭제

`selectedNoteIds` 배열을 순회해 `removeNote`를 반복 적용한 후 `setProject(finalProject)`, `clearNoteSelection()`. 기존 `PianoRoll.edit.test.tsx` — "Delete키로 선택된 노트 삭제" 테스트는 `selectNote(id)` → `selectedNoteIds=[id]`이므로 그대로 통과.

### pasteNotesParams 앵커 규칙

다중 노트 붙여넣기는 첫 번째 노트(start 기준 최소값)를 앵커로 삼고 나머지는 상대 오프셋을 유지한다:
```
anchoredStart = max(0, snap(anchorTick, gridTicks))
each note: start = max(0, anchoredStart + (note.start - firstNote.start))
```
단일 노트 호출 시 기존 `pasteNoteParams`와 동일한 결과를 반환한다.

---

## File Structure

```
apps/web/src/
  compose/
    selection.ts                     # NEW: notesInRect 순수 함수
    clipboard.ts                     # MOD: pasteNotesParams, duplicateNotesParams 추가
    PianoRoll.tsx                    # MOD: Shift+click 토글, 박스선택, 다중 강조, 다중 Delete
    Inspector.tsx                    # MOD: selectedNoteIds 기반 0/1/N 뷰 분기
    useClipboard.ts                  # MOD: selectedNoteIds + clipboardNotes 기반 다중화
    test/
      selection.test.ts              # NEW: notesInRect 완전 TDD (~15개)
      clipboard.multi.test.ts        # NEW: pasteNotesParams/duplicateNotesParams TDD (~12개)
      PianoRoll.multiselect.test.tsx # NEW: 다중 선택 스모크 (~7개)
      useClipboard.multi.test.tsx    # NEW: 다중 C/X/V/D 스모크 (~6개)
      Inspector.multiselect.test.tsx # NEW: 0/1/N 뷰 스모크 (~3개)

  state/
    store.ts                         # MOD: selectedNoteIds, toggleNoteSelection,
                                     #      setSelectedNoteIds, clearNoteSelection,
                                     #      clipboardNotes, setClipboardNotes 추가.
                                     #      selectNote/selectTrack/replaceProject/undo/redo 갱신.

  test/
    multi-select-store.test.ts       # NEW: store 다중 선택·클립보드 완전 TDD (~15개)
```

변경 없는 파일:
- `compose/test/clipboard.test.ts` — 기존 15개 PASS (단일 함수 수정 없음)
- `compose/test/useClipboard.test.tsx` — 기존 14개 PASS (단일 선택 경로 compat)
- `test/clipboard-store.test.ts` — 기존 4개 PASS (clipboardNote 미러)
- `test/editor-store.test.ts` — 기존 13개 PASS (selectedNoteId 미러)
- `test/history-store.test.ts` — 기존 PASS (selectedNoteId 미러 + correctNoteIds 추가)
- `compose/test/PianoRoll.edit.test.tsx` — 기존 4개 PASS
- `compose/test/PianoRoll.drag.test.tsx` — 기존 PASS (Shift 없는 드래그 경로 그대로)
- `ui/test/FileMenu.test.tsx` — 기존 PASS (selectedNoteId 미러)
- `compose/test/drag.ts`, `geometry.ts`, `quantize.ts`, `time.ts` — 수정 없음
- `packages/score-model/*` — 수정 없음

---

## Task 1: compose/selection.ts — 순수 notesInRect 함수 (완전 TDD)

**Files:** Create `apps/web/src/compose/selection.ts`, `apps/web/src/compose/test/selection.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/selection.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { notesInRect } from '../selection'
import type { SelectionRect } from '../selection'
import type { Note } from '@sculptone/score-model'

// ── 헬퍼 ────────────────────────────────────────────────────
let seq = 0
function makeNote(
  start: number,
  duration: number,
  pitch: number,
  id?: string,
): Note {
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
    const a = makeNote(300, 240, 65, 'a')  // IN
    const b = makeNote(0, 100, 65, 'b')    // OUT (end=100 <= 240)
    const c = makeNote(500, 120, 65, 'c')  // IN
    const d = makeNote(300, 240, 59, 'd')  // OUT (pitch=59 < 60)
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- selection.test
```

Expected: FAIL — `'../selection'` 모듈 없음.

- [ ] **Step 3: selection.ts 구현**

Create `apps/web/src/compose/selection.ts`:
```ts
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
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- selection.test
```

Expected: `selection.test.ts` 15개 PASS.

---

## Task 2: state/store.ts — 선택 모델 확장 + 클립보드 다중화 (완전 TDD)

**Files:** Modify `apps/web/src/state/store.ts`, Create `apps/web/src/test/multi-select-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/multi-select-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from '../state/store'
import { addNote, createNote, createEmptyProject, createTrack, addTrack } from '@sculptone/score-model'

describe('multi-select store — selectedNoteIds', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  // ── 초기 상태 ──────────────────────────────────────────────

  it('초기 selectedNoteIds는 []이다', () => {
    expect(useStore.getState().selectedNoteIds).toEqual([])
  })

  // ── selectNote 호환 ────────────────────────────────────────

  it('selectNote(id) → selectedNoteIds=[id], selectedNoteId=id (미러)', () => {
    useStore.getState().selectNote('n1')
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual(['n1'])
    expect(s.selectedNoteId).toBe('n1')
  })

  it('selectNote(null) → selectedNoteIds=[], selectedNoteId=null', () => {
    useStore.getState().selectNote('n1')
    useStore.getState().selectNote(null)
    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  // ── toggleNoteSelection ────────────────────────────────────

  it('toggleNoteSelection(id): 미선택 → 추가됨', () => {
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual(['n1'])
    expect(useStore.getState().selectedNoteId).toBe('n1')
  })

  it('toggleNoteSelection: 두 번 → 두 개 누적', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n2')
    expect(useStore.getState().selectedNoteIds).toEqual(['n1', 'n2'])
    expect(useStore.getState().selectedNoteId).toBe('n1') // 미러 = ids[0]
  })

  it('toggleNoteSelection: 이미 선택된 id → 제거됨', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n2')
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual(['n2'])
    expect(useStore.getState().selectedNoteId).toBe('n2')
  })

  it('toggleNoteSelection: 마지막 id 제거 → [], null', () => {
    useStore.getState().toggleNoteSelection('n1')
    useStore.getState().toggleNoteSelection('n1')
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── setSelectedNoteIds ─────────────────────────────────────

  it('setSelectedNoteIds(["a","b"]) → selectedNoteIds=["a","b"], selectedNoteId="a"', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    expect(useStore.getState().selectedNoteIds).toEqual(['a', 'b'])
    expect(useStore.getState().selectedNoteId).toBe('a')
  })

  it('setSelectedNoteIds([]) → [], null', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.getState().setSelectedNoteIds([])
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── clearNoteSelection ─────────────────────────────────────

  it('clearNoteSelection() → [], null', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b', 'c'])
    useStore.getState().clearNoteSelection()
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── selectTrack 부수효과 ────────────────────────────────────

  it('selectTrack() → selectedNoteIds 초기화', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.getState().selectTrack('t1')
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── replaceProject 부수효과 ────────────────────────────────

  it('replaceProject() → selectedNoteIds 초기화', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    const fresh = addTrack(createEmptyProject('Fresh'), createTrack('Piano'))
    useStore.getState().replaceProject(fresh)
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  // ── undo/redo correctNoteIds ───────────────────────────────

  it('undo() 후 삭제된 노트가 selectedNoteIds에서 제거된다', () => {
    // history-store.test.ts 패턴 참조: vi.useFakeTimers()로 코얼레싱 방지
    vi.useFakeTimers()
    useStore.setState(useStore.getInitialState(), true)
    const s0 = useStore.getState()
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })

    // Step 1: 초기 project(노트 없음)이 history.past에 기록됨 (createHistory에서)
    // Step 2: 401ms 진행 후 노트가 있는 project를 새 undo 스텝으로 기록
    vi.advanceTimersByTime(401)
    const p1 = addNote(s0.project, s0.selectedTrackId, note)
    s0.setProject(p1)
    s0.setSelectedNoteIds([note.id])
    expect(useStore.getState().selectedNoteIds).toEqual([note.id])

    // undo → 원래 project(노트 없음)으로 돌아가며 correctNoteIds 적용
    useStore.getState().undo()
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()

    vi.useRealTimers()
  })

  // ── getInitialState 리셋 ───────────────────────────────────

  it('getInitialState()/setState(true) 리셋 후 selectedNoteIds=[]이다', () => {
    useStore.getState().setSelectedNoteIds(['a', 'b'])
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().selectedNoteIds).toEqual([])
  })
})

describe('multi-select store — clipboardNotes', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 clipboardNotes는 []이다', () => {
    expect(useStore.getState().clipboardNotes).toEqual([])
  })

  it('setClipboardNotes([n1,n2]) → clipboardNotes=[n1,n2], clipboardNote=n1', () => {
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    useStore.getState().setClipboardNotes([n1, n2])
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(2)
    expect(s.clipboardNotes[0]).toMatchObject({ pitch: 60 })
    expect(s.clipboardNote).toMatchObject({ pitch: 60 }) // 미러
  })

  it('setClipboardNotes([]) → clipboardNotes=[], clipboardNote=null', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNotes([n])
    useStore.getState().setClipboardNotes([])
    const s = useStore.getState()
    expect(s.clipboardNotes).toEqual([])
    expect(s.clipboardNote).toBeNull()
  })

  it('setClipboardNote(note) 호환: clipboardNotes=[note], clipboardNote=note', () => {
    const n = createNote({ pitch: 64, start: 240, duration: 120, velocity: 90 })
    useStore.getState().setClipboardNote(n)
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(1)
    expect(s.clipboardNotes[0]).toMatchObject({ pitch: 64 })
    expect(s.clipboardNote).toMatchObject({ pitch: 64 })
  })

  it('setClipboardNote(null) 호환: clipboardNotes=[], clipboardNote=null', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(n)
    useStore.getState().setClipboardNote(null)
    expect(useStore.getState().clipboardNotes).toEqual([])
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('getInitialState() 리셋 후 clipboardNotes=[]', () => {
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNotes([n])
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().clipboardNotes).toEqual([])
  })
})
```

> **Note:** undo correctNoteIds 테스트는 히스토리가 2 스텝 이상일 때 동작한다. 위 테스트는 `endEdit()+setProject`로 코얼레싱을 회피한 후 undo를 호출한다. 히스토리 past가 비어있으면 undo는 no-op이므로 실제 구현에서는 fake timer를 쓴 history-store.test 패턴을 참고한다. 테스트를 단순화하기 위해 `useStore.setState`로 히스토리를 직접 세팅하는 방법도 허용한다.

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- multi-select-store
```

Expected: FAIL — `selectedNoteIds`, `toggleNoteSelection`, `setSelectedNoteIds`, `clearNoteSelection`, `clipboardNotes`, `setClipboardNotes` 없음.

- [ ] **Step 3: store.ts 수정**

**3a) `AppState` 인터페이스 확장**

`selectedNoteId: string | null` 뒤에 추가:
```ts
  /**
   * 다중 선택된 노트 id 배열. 단일 선택 시 [id], 없으면 [].
   * 항상 selectedNoteId === selectedNoteIds[0] ?? null 불변식을 유지한다.
   */
  selectedNoteIds: string[]
  /** Shift-클릭: id를 selectedNoteIds에 추가하거나 제거한다. selectedNoteId 미러를 갱신. */
  toggleNoteSelection: (id: string) => void
  /** selectedNoteIds를 통째로 교체한다. selectedNoteId 미러를 갱신. */
  setSelectedNoteIds: (ids: string[]) => void
  /** selectedNoteIds와 selectedNoteId를 모두 비운다. */
  clearNoteSelection: () => void
```

`clipboardNote: Note | null` 뒤에 추가:
```ts
  /**
   * 다중 클립보드 노트 배열. 항상 clipboardNote === clipboardNotes[0] ?? null 불변식.
   * setClipboardNote 호환: 단일 노트 세팅 시 clipboardNotes = [note].
   */
  clipboardNotes: Note[]
  /** clipboardNotes를 통째로 교체한다. clipboardNote 미러를 갱신. */
  setClipboardNotes: (notes: Note[]) => void
```

**3b) `correctNoteIds` 헬퍼 추가** (`correctNoteId` 바로 아래):
```ts
/**
 * selectedNoteIds 중 project에 존재하지 않는 id를 필터링한다.
 * undo/redo 후 노트가 사라졌을 때 사용.
 */
function correctNoteIds(project: Project, noteIds: string[]): string[] {
  return noteIds.filter((id) =>
    project.tracks.some((t) => t.notes.some((n) => n.id === id)),
  )
}
```

**3c) 초기 상태에 추가** (`selectedNoteId: null` 뒤에):
```ts
  selectedNoteIds: [],
```

`clipboardNote: null` 뒤에:
```ts
  clipboardNotes: [],
```

**3d) `selectNote` 수정** (양쪽 필드 동기화):
```ts
  selectNote: (noteId) =>
    set({ selectedNoteId: noteId, selectedNoteIds: noteId ? [noteId] : [] }),
```

**3e) `selectTrack` 수정** (selectedNoteIds 초기화):
```ts
  selectTrack: (trackId) =>
    set({ selectedTrackId: trackId, selectedNoteId: null, selectedNoteIds: [] }),
```

**3f) `replaceProject` 수정** (`selectedNoteId: null` 뒤에):
```ts
      selectedNoteIds: [],
```

**3g) `undo` 수정** (`selectedNoteId: correctNoteId(...)` 뒤에):
```ts
        selectedNoteIds: correctNoteIds(project, s.selectedNoteIds),
```

**3h) `redo` 수정** (동일 패턴):
```ts
        selectedNoteIds: correctNoteIds(project, s.selectedNoteIds),
```

**3i) `setClipboardNote` 수정** (clipboardNotes 미러 추가):
```ts
  setClipboardNote: (note) =>
    set({ clipboardNote: note, clipboardNotes: note ? [note] : [] }),
```

**3j) 새 액션 구현** (`setClipboardNote` 뒤에):
```ts
  toggleNoteSelection: (id) =>
    set((s) => {
      const ids = s.selectedNoteIds.includes(id)
        ? s.selectedNoteIds.filter((x) => x !== id)
        : [...s.selectedNoteIds, id]
      return { selectedNoteIds: ids, selectedNoteId: ids[0] ?? null }
    }),
  setSelectedNoteIds: (ids) =>
    set({ selectedNoteIds: ids, selectedNoteId: ids[0] ?? null }),
  clearNoteSelection: () => set({ selectedNoteIds: [], selectedNoteId: null }),
  setClipboardNotes: (notes) =>
    set({ clipboardNotes: notes, clipboardNote: notes[0] ?? null }),
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- multi-select-store editor-store history-store clipboard-store
```

Expected:
- `multi-select-store.test.ts` ~15개 PASS
- `editor-store.test.ts` 기존 13개 PASS (selectedNoteId 미러로 무수정)
- `history-store.test.ts` 기존 PASS (correctNoteId 여전히 존재)
- `clipboard-store.test.ts` 기존 4개 PASS (setClipboardNote 호환)

---

## Task 3: compose/clipboard.ts — 다중 노트 순수 함수 확장 (완전 TDD)

**Files:** Modify `apps/web/src/compose/clipboard.ts`, Create `apps/web/src/compose/test/clipboard.multi.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/clipboard.multi.test.ts`:
```ts
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
    const b = n(0, 60)   // 먼저
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard.multi
```

Expected: FAIL — `pasteNotesParams`, `duplicateNotesParams` 없음.

- [ ] **Step 3: clipboard.ts에 함수 추가**

`apps/web/src/compose/clipboard.ts` 파일 끝에 추가:
```ts
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
export function duplicateNotesParams(
  notes: Note[],
  barTicksValue: number,
): Omit<Note, 'id'>[] {
  return notes.map((n) => ({
    pitch: n.pitch,
    start: Math.max(0, n.start + barTicksValue),
    duration: n.duration,
    velocity: n.velocity,
  }))
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard.multi clipboard.test
```

Expected:
- `clipboard.multi.test.ts` ~12개 PASS
- `clipboard.test.ts` 기존 15개 PASS (기존 함수 수정 없음)

---

## Task 4: PianoRoll 다중 선택 상호작용 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/compose/PianoRoll.tsx`, Create `apps/web/src/compose/test/PianoRoll.multiselect.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/PianoRoll.multiselect.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, act } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

describe('PianoRoll multi-select smoke', () => {
  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, tid, nA)
    p = addNote(p, tid, nB)
    s.setProject(p)
    act(() => { s.selectNote(nA.id) })
  })

  it('Shift+클릭으로 두 번째 노트를 추가 선택한다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElB = notes[1]!

    // Shift+pointerdown on note B
    fireEvent.pointerDown(noteElB, {
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      shiftKey: true,
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(2)
  })

  it('선택된 두 노트를 Delete로 모두 삭제한다', () => {
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    fireEvent.keyDown(grid, { key: 'Delete' })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes).toHaveLength(0)
    expect(useStore.getState().selectedNoteIds).toEqual([])
    expect(useStore.getState().selectedNoteId).toBeNull()
  })

  it('Delete 키 시 선택 없으면 no-op', () => {
    act(() => { useStore.getState().clearNoteSelection() })
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    const before = useStore.getState().project

    fireEvent.keyDown(grid, { key: 'Delete' })

    expect(useStore.getState().project).toBe(before)
  })

  it('Shift+이미 선택된 노트 클릭 → 토글(제거)', () => {
    // A, B 모두 선택
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElA = notes[0]!

    // Shift+pointerdown on A → removes A
    fireEvent.pointerDown(noteElA, {
      clientX: 10,
      clientY: 100,
      pointerId: 1,
      shiftKey: true,
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).not.toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(1)
  })

  it('Shift+빈 그리드 드래그: box select 후 올바른 노트들이 선택된다', () => {
    // 두 노트(A: start=0,pitch=60, B: start=480,pitch=62) 모두 화면에 있음
    // Shift+drag 범위를 두 노트 모두 포함하도록 설정
    // jsdom에서 getBoundingClientRect()=0, clientX가 롤 기준 절대 좌표
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')

    // shiftKey=true → box select 시작
    fireEvent.pointerDown(grid, {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      shiftKey: true,
    })
    fireEvent.pointerMove(grid, {
      clientX: 9999, // 화면 끝까지
      clientY: 9999,
      pointerId: 1,
    })
    fireEvent.pointerUp(grid, {
      clientX: 9999,
      clientY: 9999,
      pointerId: 1,
    })

    const s = useStore.getState()
    // 두 노트 모두 선택됨
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
  })

  it('일반(non-shift) 클릭으로 단일 선택 시 selectedNoteIds=[id]', () => {
    // A, B 모두 선택된 상태에서 일반 클릭 → 단일 선택
    act(() => {
      useStore.getState().setSelectedNoteIds([noteAId, noteBId])
    })
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const noteElA = notes[0]!

    // 일반 pointerdown (no shift) → selectNote(A)
    fireEvent.pointerDown(noteElA, {
      clientX: 10,
      clientY: 100,
      pointerId: 1,
      shiftKey: false,
    })
    fireEvent.pointerUp(screen.getByTestId('pianoroll'), {
      clientX: 10,
      clientY: 100,
      pointerId: 1,
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toEqual([noteAId])
    expect(s.selectedNoteId).toBe(noteAId)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll.multiselect
```

Expected: FAIL — Shift 분기, box select 없음.

- [ ] **Step 3: PianoRoll.tsx 다중 선택 확장 (레퍼런스 구현)**

`apps/web/src/compose/PianoRoll.tsx` 수정:

**3a) import 추가:**
```ts
import { useState } from 'react'
import { notesInRect } from './selection'
import type { SelectionRect } from './selection'
```

**3b) 스토어 구독 추가** (`selectNote` 구독 아래):
```ts
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const toggleNoteSelection = useStore((s) => s.toggleNoteSelection)
  const setSelectedNoteIds = useStore((s) => s.setSelectedNoteIds)
  const clearNoteSelection = useStore((s) => s.clearNoteSelection)
```

**3c) 박스 선택 state/ref 추가** (dragRef 아래):
```ts
  const boxSelRef = useRef<{ startX: number; startY: number } | null>(null)
  const [boxSelVisual, setBoxSelVisual] = useState<{
    x: number; y: number; w: number; h: number
  } | null>(null)
```

**3d) `handleGridPointerDown` 수정** — Shift+드래그 분기를 최상단에 추가:
```ts
  const handleGridPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) { dragRef.current = null }
    if (e.target !== e.currentTarget) return

    // Shift+포인터다운: 박스 선택 시작
    if (e.shiftKey) {
      const rect = rollRef.current!.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      boxSelRef.current = { startX: relX, startY: relY }
      setBoxSelVisual({ x: relX, y: relY, w: 0, h: 0 })
      return
    }

    // 기존: 노트 생성
    const rect = rollRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const start = Math.max(0, snap(xToTick(x, ppq), grid))
    const pitch = yToPitch(y)
    const note = createNote({ pitch, start, duration: grid || ppq, velocity: 96 })
    setProject(addNote(project, selectedTrackId, note))
    selectNote(note.id)
  }
```

**3e) `handleNotePointerDown` 수정** — Shift+클릭 토글:
```ts
  const handleNotePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    e.stopPropagation()

    // Shift+클릭: 토글 선택 (드래그 없음)
    if (e.shiftKey) {
      toggleNoteSelection(note.id)
      return
    }

    // 기존: 단일 선택 + 드래그 준비
    selectNote(note.id)
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'move',
      moved: false,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
```

**3f) `handleContainerPointerMove` 수정** — 박스 선택 시각화 분기 추가:
```ts
  const handleContainerPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    // 박스 선택 업데이트
    if (boxSelRef.current) {
      const rect = rollRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const sx = boxSelRef.current.startX
      const sy = boxSelRef.current.startY
      setBoxSelVisual({
        x: Math.min(sx, cx),
        y: Math.min(sy, cy),
        w: Math.abs(cx - sx),
        h: Math.abs(cy - sy),
      })
      return
    }

    // 기존: 노트 드래그
    if (!dragRef.current) return
    // ... (기존 코드 그대로)
  }
```

**3g) `handleContainerPointerUp` 수정** — 박스 선택 완료 분기:
```ts
  const handleContainerPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    // 박스 선택 완료
    if (boxSelRef.current) {
      const rect = rollRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const sx = boxSelRef.current.startX
      const sy = boxSelRef.current.startY
      const selRect: SelectionRect = {
        startTick: xToTick(Math.min(sx, cx), ppq),
        endTick: xToTick(Math.max(sx, cx), ppq),
        pitchLow: yToPitch(Math.max(sy, cy)),
        pitchHigh: yToPitch(Math.min(sy, cy)),
      }
      const ids = notesInRect(track?.notes ?? [], selRect)
      setSelectedNoteIds(ids)
      boxSelRef.current = null
      setBoxSelVisual(null)
      return
    }

    // 기존: 드래그 종료
    endEdit()
    if (!dragRef.current) return
    if (!dragRef.current.moved) {
      selectNote(dragRef.current.noteId)
    }
    dragRef.current = null
  }
```

**3h) `handleKeyDown` 수정** — 다중 삭제:
```ts
  const handleKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNoteIds.length === 0) return
      endEdit()
      let p = project
      for (const id of selectedNoteIds) {
        p = removeNote(p, selectedTrackId, id)
      }
      setProject(p)
      clearNoteSelection()
    }
  }
```

**3i) 노트 강조 수정** (`background` 스타일):
```ts
              background: selectedNoteIds.includes(n.id)
                ? 'var(--accent-deep)'
                : 'var(--accent)',
```

**3j) 박스 선택 overlay 렌더링** — `{track?.notes.map(...)}` 앞에:
```tsx
      {boxSelVisual && (
        <div
          data-testid="box-select-overlay"
          style={{
            position: 'absolute',
            left: boxSelVisual.x,
            top: boxSelVisual.y,
            width: boxSelVisual.w,
            height: boxSelVisual.h,
            border: '1px solid var(--accent)',
            background: 'rgba(128, 80, 30, 0.15)',
            pointerEvents: 'none',
          }}
        />
      )}
```

> **`handleDragRelease` 수정:** `pointercancel`/`lostpointercapture` 시 `boxSelRef`도 정리:
> ```ts
>   const handleDragRelease = () => {
>     dragRef.current = null
>     boxSelRef.current = null
>     setBoxSelVisual(null)
>   }
> ```

> **기존 테스트 보존 노트:**
> - `PianoRoll.edit.test.tsx` 4개: Shift 없는 기존 경로 그대로 → PASS
> - `PianoRoll.drag.test.tsx` 모든 테스트: Shift 없는 드래그 경로 그대로 → PASS
> - 단, `handleKeyDown` 변경: `selectedNoteId` → `selectedNoteIds.length === 0` 체크로 변경.
>   `selectNote(null)` 대신 `clearNoteSelection()`. 기존 테스트가 `selectedNoteId`를 체크하므로 `clearNoteSelection`이 미러를 null로 설정하므로 통과.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll
```

Expected:
- `PianoRoll.multiselect.test.tsx` ~7개 PASS
- `PianoRoll.test.tsx` 기존 2개 PASS
- `PianoRoll.edit.test.tsx` 기존 4개 PASS
- `PianoRoll.drag.test.tsx` 기존 모든 PASS

---

## Task 5: useClipboard.ts 다중화 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/compose/useClipboard.ts`, Create `apps/web/src/compose/test/useClipboard.multi.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/useClipboard.multi.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useClipboard } from '../useClipboard'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

function ClipboardWrapper({ getSeconds }: { getSeconds: () => number }) {
  useClipboard({ getSeconds })
  return null
}

describe('useClipboard multi-note', () => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modKey = isMac ? 'metaKey' : 'ctrlKey'

  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, s.selectedTrackId, nA)
    p = addNote(p, s.selectedTrackId, nB)
    s.setProject(p)
    act(() => { s.setSelectedNoteIds([noteAId, noteBId]) })
  })

  it('Ctrl/Cmd+C: 두 노트 모두 clipboardNotes에 저장된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(2)
    // clipboardNote 미러: 첫 번째 노트 (start 기준 정렬 결과)
    expect(s.clipboardNote).not.toBeNull()
  })

  it('Ctrl/Cmd+X: 두 노트 모두 clipboardNotes에 저장되고 트랙에서 제거된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(s.clipboardNotes).toHaveLength(2)
    expect(track.notes).toHaveLength(0)
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  it('Ctrl/Cmd+V: 두 클립 노트가 앵커에 상대 위치 유지하며 붙여넣어진다', () => {
    // 먼저 복사
    act(() => {
      const s = useStore.getState()
      const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
      s.setClipboardNotes(track.notes.slice())
    })
    // 기존 노트 2개, 붙여넣기 후 4개
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(track.notes).toHaveLength(4)
    // 새 노트 2개가 선택됨
    expect(s.selectedNoteIds).toHaveLength(2)
    // 붙여넣기한 노트들이 anchorTick=0에서 시작 (snap(0,120)=0)
    const newNoteIds = s.selectedNoteIds
    const newNotes = track.notes.filter((n) => newNoteIds.includes(n.id))
    expect(newNotes.some((n) => n.start === 0)).toBe(true)
    // 상대 오프셋 유지 (nA.start=0, nB.start=480 → 0, 480)
    const starts = newNotes.map((n) => n.start).sort((a, b) => a - b)
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBe(480)
  })

  it('Ctrl/Cmd+D: 두 노트가 +1마디 복제된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(track.notes).toHaveLength(4)
    expect(s.selectedNoteIds).toHaveLength(2)
    // 복제된 노트들의 start
    const newNoteIds = s.selectedNoteIds
    const newNotes = track.notes.filter((n) => newNoteIds.includes(n.id))
    const starts = newNotes.map((n) => n.start).sort((a, b) => a - b)
    // A: 0+1920=1920, B: 480+1920=2400
    expect(starts[0]).toBe(1920)
    expect(starts[1]).toBe(2400)
  })

  it('selectedNoteIds가 비어있으면 Ctrl/Cmd+C는 no-op이다', () => {
    act(() => { useStore.getState().clearNoteSelection() })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNotes).toEqual([])
  })

  it('clipboardNotes가 비어있으면 Ctrl/Cmd+V는 no-op이다', () => {
    // clipboardNotes 비워둠 (초기 상태)
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })
    const track = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
    expect(track.notes).toHaveLength(2) // 변화 없음
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- useClipboard.multi
```

Expected: FAIL — `selectedNoteIds`, `clipboardNotes`, `setClipboardNotes` 기반 경로 없음.

- [ ] **Step 3: useClipboard.ts 수정 (레퍼런스 구현)**

`apps/web/src/compose/useClipboard.ts`:

**3a) import 추가:**
```ts
import { pasteNotesParams, duplicateNotesParams } from './clipboard'
```
(기존 `pasteNoteParams`, `duplicateNoteParams` import 제거 — 이제 multi 함수만 사용)

**3b) handler 내 구조분해 교체:**
```ts
      const {
        project,
        selectedTrackId,
        selectedNoteIds,         // 변경: selectedNoteId → selectedNoteIds
        quantizeDenom,
        clipboardNotes,          // 변경: clipboardNote → clipboardNotes
        setClipboardNotes,       // 변경: setClipboardNote → setClipboardNotes
        setProject,
        setSelectedNoteIds,      // 신규
        clearNoteSelection,      // 신규
        endEdit,
      } = useStore.getState()

      const track = project.tracks.find((t) => t.id === selectedTrackId)
      const selectedNotes = track?.notes.filter((n) => selectedNoteIds.includes(n.id)) ?? []
```

**3c) C 핸들러 교체:**
```ts
      if (k === 'c') {
        if (selectedNotes.length === 0) return
        setClipboardNotes(selectedNotes)
        return
      }
```

**3d) X 핸들러 교체:**
```ts
      if (k === 'x') {
        if (selectedNotes.length === 0) return
        setClipboardNotes(selectedNotes)
        endEdit()
        let p = project
        for (const n of selectedNotes) {
          p = removeNote(p, selectedTrackId, n.id)
        }
        setProject(p)
        clearNoteSelection()
        return
      }
```

**3e) V 핸들러 교체:**
```ts
      if (k === 'v') {
        if (clipboardNotes.length === 0) return
        if (!track) return
        const anchorTick = secondsToTicks(getSeconds(), ppq, tempo)
        const paramsArr = pasteNotesParams(clipboardNotes, anchorTick, grid)
        const newNotes = paramsArr.map((params) => createNote(params))
        endEdit()
        let p = project
        for (const n of newNotes) {
          p = addNote(p, selectedTrackId, n)
        }
        setProject(p)
        setSelectedNoteIds(newNotes.map((n) => n.id))
        return
      }
```

**3f) D 핸들러 교체:**
```ts
      if (k === 'd') {
        if (selectedNotes.length === 0) return
        const bt = barTicks(ppq, timeSignature)
        const paramsArr = duplicateNotesParams(selectedNotes, bt)
        const newNotes = paramsArr.map((params) => createNote(params))
        endEdit()
        let p = project
        for (const n of newNotes) {
          p = addNote(p, selectedTrackId, n)
        }
        setProject(p)
        setSelectedNoteIds(newNotes.map((n) => n.id))
      }
```

> **기존 `useClipboard.test.tsx` 14개 호환 보장:**
> - `selectNote(id)` → `selectedNoteIds = [id]` → `selectedNotes = [note]` (단일) — 기존과 동일 결과.
> - `setClipboardNotes([note])` → `clipboardNote = note` (미러) — `clipboardNote` 단언 그대로 통과.
> - `setSelectedNoteIds([newNote.id])` → `selectedNoteId = newNote.id` (미러) — `selectedNoteId` 단언 통과.
> - `clearNoteSelection()` → `selectedNoteId = null` (미러) — `selectedNoteId.toBeNull()` 통과.
> - `selectedNotes.length === 0`은 `selectNote(null)` 후 `selectedNoteIds=[]` → length=0 → no-op 보장.
> - `clipboardNotes.length === 0`은 초기 상태 `[]` → V no-op 보장.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- useClipboard
```

Expected:
- `useClipboard.multi.test.tsx` ~6개 PASS
- `useClipboard.test.tsx` 기존 14개 PASS (단일 선택 경로 compat)

---

## Task 6: Inspector.tsx 다중 노트 표시 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/compose/Inspector.tsx`, Create `apps/web/src/compose/test/Inspector.multiselect.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성**

Create `apps/web/src/compose/test/Inspector.multiselect.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { Inspector } from '../Inspector'

describe('Inspector multi-select', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('0개 선택 → "노트를 선택하세요" 표시', () => {
    render(<Inspector />)
    expect(screen.getByText('노트를 선택하세요')).toBeInTheDocument()
  })

  it('2개 선택 → "2개 노트 선택됨" 표시', () => {
    const s = useStore.getState()
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const n2 = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    let p = addNote(s.project, s.selectedTrackId, n1)
    p = addNote(p, s.selectedTrackId, n2)
    s.setProject(p)
    s.setSelectedNoteIds([n1.id, n2.id])
    render(<Inspector />)
    expect(screen.getByText('2개 노트 선택됨')).toBeInTheDocument()
  })

  it('1개 선택 → 단일 노트 velocity 슬라이더 표시', () => {
    const s = useStore.getState()
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    s.setProject(addNote(s.project, s.selectedTrackId, n))
    s.selectNote(n.id)
    render(<Inspector />)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- Inspector.multiselect
```

Expected: FAIL — Inspector가 `selectedNoteIds`를 읽지 않음 (다중 표시 없음).

- [ ] **Step 3: Inspector.tsx 수정 (레퍼런스 구현)**

`apps/web/src/compose/Inspector.tsx` 수정:

```tsx
import { useStore } from '../state/store'
import { updateNote } from '@sculptone/score-model'

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteName(pitch: number): string {
  return `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

export function Inspector() {
  const project = useStore((s) => s.project)
  const trackId = useStore((s) => s.selectedTrackId)
  const noteId = useStore((s) => s.selectedNoteId)       // compat 미러
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const setProject = useStore((s) => s.setProject)
  const track = project.tracks.find((t) => t.id === trackId)
  const note = track?.notes.find((n) => n.id === noteId)

  const count = selectedNoteIds.length

  // 0개 선택
  if (count === 0) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        노트를 선택하세요
      </div>
    )
  }

  // 2개+ 선택: 간략 표시
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

  // 1개 선택: 기존 단일 편집 UI (변경 없음)
  if (!note) return null
  const row = { fontSize: 12, color: 'var(--text-mid)', lineHeight: 2.2 } as const
  const val = { float: 'right', color: 'var(--text-hi)' } as const
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
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- Inspector.multiselect
```

Expected: `Inspector.multiselect.test.tsx` 3개 PASS.

---

## Task 7: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 테스트**

```bash
pnpm -r test
```

Expected 신규 테스트 추가분:

| 파일 | 신규 테스트 수 |
|------|---------------|
| `compose/test/selection.test.ts` | ~15 |
| `test/multi-select-store.test.ts` | ~15 |
| `compose/test/clipboard.multi.test.ts` | ~12 |
| `compose/test/PianoRoll.multiselect.test.tsx` | ~7 |
| `compose/test/useClipboard.multi.test.tsx` | ~6 |
| `compose/test/Inspector.multiselect.test.tsx` | 3 |
| **합계** | **~58** |

기존 670개 + 신규 ~58개 = **~728개 전부 PASS**.

> **기존 테스트 보존 체크리스트:**
>
> | 파일 | 관련 변경 | 판정 |
> |------|-----------|------|
> | `editor-store.test.ts` (13개) | `selectedNoteId` 미러 → 무수정 | PASS |
> | `history-store.test.ts` | `selectedNoteId` 미러 + `correctNoteIds` 추가 | PASS |
> | `clipboard-store.test.ts` (4개) | `clipboardNote` 미러 → 무수정 | PASS |
> | `PianoRoll.edit.test.tsx` (4개) | Delete: `selectedNoteIds`로 변경, `selectNote(null)` → `clearNoteSelection()`. 미러 덕분에 단언 통과. | PASS |
> | `PianoRoll.drag.test.tsx` | Shift 없는 드래그 경로 그대로. `selectedNoteId` 미러 단언 통과. | PASS |
> | `useClipboard.test.tsx` (14개) | 단일 선택 경로 compat, `clipboardNote`/`selectedNoteId` 미러. | PASS |
> | `clipboard.test.ts` (15개) | 기존 함수 수정 없음. | PASS |
> | `FileMenu.test.tsx` (2개) | `selectedNoteId` 미러. | PASS |
> | `AppShell.test.tsx` | `selectNote` 호출 → `selectedNoteIds` 동기화됨. | PASS |
> | `AppShell.compose.test.tsx` | PianoRoll 렌더 변경(overlay div, selectedNoteIds 구독) → 기존 단언 무관. | PASS |
> | `shortcuts.test.ts` (16개) | 수정 없음. | PASS |
> | `shortcuts-store.test.ts` | 수정 없음. | PASS |
> | `geometry.test.ts`, `quantize.test.ts`, `drag.test.ts` | 수정 없음. | PASS |
> | `TracksPanel.test.tsx`, `LoopStrip.smoke.test.tsx` | 수정 없음. | PASS |
> | `audio/`, `midi/`, `io/`, `notation/`, `play/`, `sound/` | 수정 없음. | PASS |

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. 특히:
- `store.ts`: `selectedNoteIds: string[]`, `toggleNoteSelection`, `setSelectedNoteIds`, `clearNoteSelection`, `clipboardNotes: Note[]`, `setClipboardNotes` — `AppState` 인터페이스와 구현이 일치 ✓
- `correctNoteIds(project, ids)` — `Project`, `string[]` 타입 일치 ✓
- `selection.ts`: `SelectionRect` 인터페이스 export, `notesInRect` 반환 `string[]` ✓
- `clipboard.ts`: `pasteNotesParams`, `duplicateNotesParams` — `Omit<Note,'id'>[]` 반환 ✓
- `PianoRoll.tsx`: `useState` named import from `'react'`, `SelectionRect` import from `'./selection'` ✓
- `useClipboard.ts`: `setClipboardNotes`, `setSelectedNoteIds`, `clearNoteSelection` — store에서 구조분해 ✓
- React 타입 네임스페이스 미사용 (`'react'` named import만) ✓

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `selection.ts` 번들 포함.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 670개 보존 + 신규 ~58개).
- `notesInRect`: 반개구간 틱 겹침, 폐구간 피치, 경계 exclusive/inclusive — ~15개 단위 테스트 검증.
- `pasteNotesParams`: 상대 오프셋 보존, start 기준 정렬, snap, 음수 클램프 — ~8개 단위 테스트.
- `duplicateNotesParams`: 각각 +barTicks, 순서 유지, 방어 클램프 — ~6개 단위 테스트.
- `selectedNoteIds` 초기 `[]`, `toggleNoteSelection`, `setSelectedNoteIds`, `clearNoteSelection` — ~15개 TDD 검증.
- `clipboardNotes` + `setClipboardNotes` — ~5개 TDD 검증.
- **미러 불변식**: `selectedNoteId === selectedNoteIds[0] ?? null`, `clipboardNote === clipboardNotes[0] ?? null` — 항상 보장.
- PianoRoll Shift+클릭 토글, Shift+드래그 박스 선택, 다중 Delete — 스모크 검증.
- useClipboard 다중 C/X/V/D 동작 — 스모크 검증.
- Inspector: 0/1/N 뷰 분기 — 스모크 검증.
- 기존 22개 `selectedNoteId` 단언 테스트 — **무수정** 통과 (미러 전략).
- React 타입 네임스페이스 미사용.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 증분 (이 계획 완료 후)

- **여러 노트 동시 드래그 이동/리사이즈 (P1):** `selectedNoteIds`가 이미 있으므로 `handleContainerPointerMove`에서 모든 선택 노트를 동시에 `updateNote`하는 로직 추가. 기준점(anchor) 노트의 델타를 나머지에 전파.
- **좌측 리사이즈 핸들(start + duration 동시 이동) (P2):** 단일 노트용. 현재 우측 끝만.
- **Ctrl+A 전체 선택 (P2):** `setSelectedNoteIds(track.notes.map(n => n.id))`. 매우 간단한 추가.
- **다중 선택 velocity 일괄 편집 (P3):** Inspector 2개+ 뷰에 공통 velocity 슬라이더 추가 (비율 스케일 또는 절댓값 일괄 설정).
- **인접 노트 스냅 가이드 (P3):** 드래그 중 다른 노트 경계에 스냅 라인 표시.
- **드래그 중 자동 스크롤 (P3):** 뷰포트 가장자리 RAF 기반 스크롤.

---

## 열린 질문

1. **Shift+드래그 vs 생성 분기:** 현재 구현은 Shift 키 유무로 분기. 일반 빈 그리드 드래그(임계값 이상)를 박스 선택으로 전환하는 방안도 있다 — 단, 기존 생성 동작과 충돌하고 기존 테스트 2개(`빈 그리드 클릭 → 노트 생성`)가 영향받을 수 있다. Shift 전용으로 분기하면 기존 동작이 100% 보존된다.

2. **박스 선택 후 노드가 1개도 없을 때:** `setSelectedNoteIds([])` → `clearNoteSelection()`과 동일. 빈 박스 드래그가 이전 선택을 해제하는 동작. 수용 가능하나, 빈 박스 드래그 시 기존 선택을 유지하는 옵션도 있다.

3. **paste 후 selectedNoteIds:** 붙여넣기한 새 노트들이 선택된다. 기존 선택(이전 노트들)은 해제. DAW 표준 동작. 기존 `useClipboard.test.tsx` — "V: 새 노트가 선택됨" 단언이 `selectedNoteId = newNote.id` → `setSelectedNoteIds([newNote.id])` → 미러로 일치.

4. **duplicate 여러 노트 undo:** X/V/D 전에 `endEdit()` 호출로 코얼레싱 방지. 단, 10개 노트를 선택하고 D를 누르면 10번의 `addNote` 가 단일 `setProject` 호출 내에서 반복 적용된다 — 1 undo 스텝. 수용 가능.

5. **Ctrl+A 전체 선택:** 브리프에서 "선택(원하면 작은 추가 가능하나 핵심 아님)"으로 표시. 구현 시 `setSelectedNoteIds(track?.notes.map(n => n.id) ?? [])` — 한 줄. `useClipboard.ts`의 isInputLike 가드 뒤에 `k === 'a' && !isInputLike` 체크로 추가 가능.

6. **boxSel pitchHigh < pitchLow 역방향 드래그:** `yToPitch(Math.min(sy,cy))` vs `yToPitch(Math.max(sy,cy))` — min y는 화면 위쪽 = 높은 피치, max y는 아래쪽 = 낮은 피치. 항상 `pitchLow <= pitchHigh` 불변식 유지. 이미 구현에 반영됨.

7. **PianoRoll.edit.test.tsx "Delete" 테스트 미세 변화:** 기존 테스트는 `selectNote(null)` 호출을 기대하지 않고 `selectedNoteId = null`을 단언한다. 새 구현은 `clearNoteSelection()`을 호출해 `selectedNoteId = null`로 미러를 갱신 — 단언 통과. 단, 기존 테스트의 마지막 단언 `expect(track.notes.length).toBe(0)` 이 먼저고, `selectedNoteId.toBeNull()` 이 후이므로 모두 통과.
