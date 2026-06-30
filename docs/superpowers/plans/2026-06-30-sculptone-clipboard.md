# Sculptone 노트 클립보드 (복사·오려내기·붙여넣기·복제) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤에서 선택된 단일 노트를 Ctrl/Cmd+C(복사), Ctrl/Cmd+X(오려내기), Ctrl/Cmd+V(붙여넣기), Ctrl/Cmd+D(복제)로 조작할 수 있게 한다. 붙여넣기 위치는 현재 재생 헤드(정지 시 0틱)에 퀀타이즈 스냅을 적용한 시각, 복제는 원본 노트 시작 + 1마디 뒤다. 기존 630개 테스트와 Ctrl+Z/Y(undo/redo), Space/R/M/? 단축키를 완전히 보존한다.

**Architecture:** 붙여넣기·복제 위치 계산을 순수 함수 모듈 `clipboard.ts`로 분리해 완전 TDD. 클립보드 상태(`clipboardNote: Note | null`)는 `store.ts`에 추가해 `getInitialState()` 리셋으로 테스트 격리를 보장한다. 키보드 배선은 `useClipboard` 커스텀 훅으로 분리해 `AppShell`을 크게 건드리지 않고 독립 테스트한다(`window.addEventListener('keydown', ...)`). `AppShell.tsx`에서 `useClipboard({ getSeconds })` 한 줄만 추가하면 배선 완성. `ShortcutsHelp.tsx` SHORTCUTS 목록에 C/X/V/D 항목을 추가한다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:**
> - `apps/web/src/compose/clipboard.ts` (NEW — 순수 함수)
> - `apps/web/src/compose/useClipboard.ts` (NEW — 배선 훅)
> - `apps/web/src/compose/time.ts` (`secondsToTicks`)
> - `apps/web/src/compose/quantize.ts` (`snap`, `divisionToTicks`)
> - `apps/web/src/state/store.ts` (`setProject` 코얼레싱, `endEdit`, `selectedNoteId`, `quantizeDenom`)
> - `apps/web/src/shell/shortcuts.ts` (기존 `matchShortcut` — 수정 없음)
> - `apps/web/src/shell/AppShell.tsx` (기존 keydown 패턴, `useAudio().getSeconds`)
> - `apps/web/src/shell/ShortcutsHelp.tsx` (SHORTCUTS 목록 추가)
> - `packages/score-model/src/operations.ts` (`addNote`, `removeNote`, `createNote`)

---

## 비목표 (이 계획에서 하지 말 것)

- 멀티노트 선택·클립보드 (다음 증분 — `selectedNoteIds: Set<string>` 필요)
- 트랙 간 붙여넣기 (현재 트랙에만 붙여넣기)
- 시스템 클립보드 연동 (`navigator.clipboard` API — 보안 컨텍스트·권한 필요)
- 붙여넣기 위치 선택 UI (재생 헤드 고정 — 열린 질문 참조)
- 클립보드 영속화 (새로고침 시 초기화 — 수용)
- 마디·리전 복사
- 협업·백엔드
- `matchShortcut` 확장 (C/X/V/D는 mod+key; 기존 matchShortcut은 mod 없는 단일 키 전용으로 설계됨 — 수정 불필요)
- 인프라 파일 변경 (`.github/`, 루트 설정, eslint/prettier config)

---

## 설계 근거

### clipboard.ts 순수 함수 분리

`barTicks`, `duplicateNoteParams`, `pasteNoteParams`는 외부 상태 없이 입력만으로 결정되는 순수 함수다. 이들을 `clipboard.ts`로 분리해 jsdom에서 import만으로 빠르게 단위 테스트한다. 사이드 이펙트(store 변경, selectNote)는 `useClipboard` 훅이 담당한다.

### clipboardNote를 store에 저장하는 이유

모듈 레벨 변수 대신 store를 선택한 이유:
1. **테스트 격리**: `useStore.setState(useStore.getInitialState(), true)`로 `beforeEach`에서 null로 리셋된다.
2. **미래 확장**: 붙여넣기 가능 여부를 UI에서 표시하거나 붙여넣기 버튼을 비활성화할 때 reactive하게 구독 가능.
3. **일관성**: store가 전체 앱 상태의 단일 출처.

`clipboardNote` 변경은 undo 스택에 기록하지 않는다(`setClipboardNote`는 `history`를 건드리지 않음). 복사/오려내기 자체는 undo 불가; 프로젝트 변경(removeNote 등)은 `setProject`를 통해 undo에 기록된다.

### useClipboard 훅 분리

AppShell의 기존 `useEffect` keydown 핸들러를 수정하는 대신 `useClipboard` 훅으로 분리한다:
1. **독립 테스트 가능**: `render(<TestWrapper getSeconds={...} />)` + `fireEvent.keyDown(document.body, ...)` 패턴으로 AppShell 없이 훅만 테스트 가능.
2. **AppShell 최소 변경**: `useClipboard({ getSeconds })` 한 줄 추가만 필요.
3. **관심사 분리**: 클립보드 로직과 재생/메트로놈/도움말 로직이 분리됨.

### matchShortcut 미확장 이유

기존 `matchShortcut`은 `ctrlKey || metaKey || altKey`이면 null을 반환하도록 설계되어 있다 — mod+key 조합은 브라우저 단축키에 양보하는 철학. C/X/V/D는 반드시 mod 키가 필요한 클립보드 단축키이므로 이 패턴에 맞지 않는다. `useClipboard`에서 직접 `mod && k === 'c'` 등을 체크하면 코드가 더 명확하고 기존 `shortcuts.test.ts` 16개를 건드리지 않는다.

### 붙여넣기 앵커 = 재생 헤드 틱

`anchorTick = secondsToTicks(getSeconds(), ppq, tempo)`:
- 정지 중: `getSeconds()` → `0`, 따라서 0틱에 붙여넣기 (곡 시작).
- 재생 중: 현재 재생 위치에 붙여넣기.
- `getSeconds`는 `useAudio`의 `useCallback([], [])` — stable ref이므로 `useEffect` 의존 배열에 안전하게 포함 가능.

재생 중 붙여넣기가 직관적이지 않을 수 있다는 열린 질문이 있으나, 구현이 가장 단순하고 DAW 표준(Logic Pro 등)과 유사하다. 향후 UX 개선 시 anchorTick 계산만 교체하면 된다.

### endEdit() 호출로 undo 스텝 독립 보장

`setProject`는 직전 호출로부터 400ms 이내면 코얼레싱한다. 드래그 직후 클립보드 조작이 발생하면 paste/duplicate의 `setProject`가 드래그의 마지막 스텝과 합쳐질 수 있다. 이를 방지하기 위해 프로젝트를 변경하는 클립보드 액션(X, V, D) 실행 직전에 `endEdit()`을 호출해 `_lastEditAt = 0`으로 리셋한다.

### 입력 필드 가드

`useClipboard` 핸들러 최상단에서 `isInputLike` 체크를 수행한다. INPUT/TEXTAREA/SELECT에서 Ctrl+C/X/V는 브라우저 텍스트 복사/붙여넣기이므로 발동하면 안 된다. `target.isContentEditable`도 포함한다. 이 가드 통과 후에만 `e.preventDefault()` + 클립보드 액션을 실행한다.

### Ctrl+D preventDefault

`Ctrl+D`는 브라우저에서 "즐겨찾기 추가" 단축키다. `e.preventDefault()`로 차단한다. Ctrl+C/X/V도 isInputLike 가드 밖에서는 `preventDefault()`를 호출해 예기치 않은 브라우저 동작을 방지한다.

### 기존 단축키 충돌 없음

| 기존 단축키 | 키 조합 | 새 단축키 | 충돌? |
|---|---|---|---|
| undo | Ctrl/Cmd+Z | — | 없음 (Z ≠ C/X/V/D) |
| redo | Ctrl/Cmd+Shift+Z, Ctrl+Y | — | 없음 |
| Space/R/M/? | 수식어 없음 | — | 없음 (수식어 필수) |
| C/X/V/D | 수식어 필수 | 클립보드 | — |

---

## File Structure

```
apps/web/src/
  compose/
    clipboard.ts                # NEW: barTicks, duplicateNoteParams, pasteNoteParams 순수 함수
    useClipboard.ts             # NEW: Ctrl/Cmd+C/X/V/D 배선 훅
    test/
      clipboard.test.ts         # NEW: 순수 함수 완전 TDD (15개)
      useClipboard.test.ts      # NEW: 배선 훅 jsdom 스모크 (7개)

  state/
    store.ts                    # MOD: clipboardNote: Note | null + setClipboardNote 추가

  test/
    clipboard-store.test.ts     # NEW: clipboardNote 스토어 TDD (4개)

  shell/
    AppShell.tsx                # MOD: useClipboard({ getSeconds }) 훅 호출 1줄 추가
    ShortcutsHelp.tsx           # MOD: SHORTCUTS 배열에 C/X/V/D 4항목 추가
```

변경 없는 파일:
- `shell/shortcuts.ts` — matchShortcut 수정 없음, 기존 16개 테스트 보존
- `test/shortcuts.test.ts`, `test/shortcuts-store.test.ts` — 변경 없음
- `test/ShortcutsHelp.test.tsx` — 기존 6개 PASS (목록 추가는 기존 단언과 충돌 없음)
- `compose/quantize.ts`, `compose/time.ts`, `compose/geometry.ts` — import만 함, 수정 없음
- `packages/score-model/*` — 기존 연산 함수 그대로 사용
- `.github/`, 루트 설정 — 비목표

---

## Task 1: compose/clipboard.ts — 순수 클립보드 함수 (완전 TDD)

**Files:** Create `apps/web/src/compose/clipboard.ts`, `apps/web/src/compose/test/clipboard.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/clipboard.test.ts`:
```ts
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
    // snap(-50, 120) = 0 (round(-0.417)*120 = 0) → max(0, 0) = 0
    const r = pasteNoteParams(clip, -50, GRID)
    expect(r.start).toBeGreaterThanOrEqual(0)
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
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard.test
```

Expected: FAIL — `'../clipboard'` 모듈 없음.

- [ ] **Step 3: clipboard.ts 구현**

Create `apps/web/src/compose/clipboard.ts`:
```ts
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
export function duplicateNoteParams(
  note: Note,
  barTicksValue: number,
): Omit<Note, 'id'> {
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
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard.test
```

Expected: `clipboard.test.ts` 15개 PASS. 기존 테스트 영향 없음(새 파일만 추가).

---

## Task 2: state/store.ts — clipboardNote 추가 (완전 TDD)

**Files:** Modify `apps/web/src/state/store.ts`, Create `apps/web/src/test/clipboard-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/clipboard-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'
import { createNote } from '@sculptone/score-model'

describe('clipboard store — clipboardNote', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 clipboardNote는 null이다', () => {
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('setClipboardNote(note) → clipboardNote가 해당 노트로 설정된다', () => {
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(note)
    expect(useStore.getState().clipboardNote).toEqual(note)
  })

  it('setClipboardNote(null) → clipboardNote가 null로 초기화된다', () => {
    const note = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    useStore.getState().setClipboardNote(note)
    useStore.getState().setClipboardNote(null)
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('getInitialState() / setState(true) 리셋 후 clipboardNote는 null이다', () => {
    const note = createNote({ pitch: 72, start: 480, duration: 240, velocity: 80 })
    useStore.getState().setClipboardNote(note)
    // beforeEach에서 이미 리셋됨을 확인하는 것이지만,
    // 명시적으로 다시 리셋해 격리를 이중 검증.
    useStore.setState(useStore.getInitialState(), true)
    expect(useStore.getState().clipboardNote).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard-store
```

Expected: FAIL — `clipboardNote`, `setClipboardNote`가 `AppState`에 없음.

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts`의 `AppState` 인터페이스에 추가:
```ts
  /**
   * 클립보드에 복사된 노트. null = 클립보드 비어있음.
   * undo 스택에 기록하지 않는다 — setClipboardNote는 history를 건드리지 않음.
   */
  clipboardNote: Note | null
  setClipboardNote: (note: Note | null) => void
```

> **import 주의:** `AppState` 인터페이스 상단에 `import type { ... Project }` 가 있다. `Note`를 추가한다:
> ```ts
> import { createEmptyProject, createTrack, addTrack, type Project, type Note } from '@sculptone/score-model'
> ```

`create<AppState>(...)` 초기 상태에 추가 (`endEdit` 구현 다음에):
```ts
  clipboardNote: null,
  setClipboardNote: (note) => set({ clipboardNote: note }),
```

> **기존 테스트 보존 노트:** `AppState` 인터페이스에 필드 추가는 `create<AppState>()` 구현에 대응 필드가 있어야 TS 오류 없음. 기존 `store.test.ts`(3개), `editor-store.test.ts`, `history-store.test.ts`는 `clipboardNote`를 단언하지 않으므로 영향 없음.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- clipboard-store store editor-store history-store
```

Expected:
- `clipboard-store.test.ts` 4개 PASS
- `store.test.ts` 기존 3개 PASS (단언 없는 필드 추가)
- `editor-store.test.ts` 기존 PASS
- `history-store.test.ts` 기존 PASS

---

## Task 3: compose/useClipboard.ts — 배선 훅 (레퍼런스 구현 + jsdom 스모크)

**Files:** Create `apps/web/src/compose/useClipboard.ts`, `apps/web/src/compose/test/useClipboard.test.ts`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/useClipboard.test.ts`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useClipboard } from '../useClipboard'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

/**
 * useClipboard를 호출하는 최소 래퍼 컴포넌트.
 * getSeconds는 테스트에서 제어 가능한 값을 반환한다.
 */
function ClipboardWrapper({ getSeconds }: { getSeconds: () => number }) {
  useClipboard({ getSeconds })
  return null
}

describe('useClipboard', () => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modKey = isMac ? 'metaKey' : 'ctrlKey'

  let noteId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    // 트랙에 노트를 추가하고 선택한다.
    const s = useStore.getState()
    const note = createNote({ pitch: 60, start: 480, duration: 240, velocity: 100 })
    noteId = note.id
    s.setProject(addNote(s.project, s.selectedTrackId, note))
    act(() => { s.selectNote(note.id) })
  })

  it('Ctrl/Cmd+C: 선택된 노트가 clipboardNote에 저장된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNote).toMatchObject({ id: noteId, pitch: 60 })
  })

  it('Ctrl/Cmd+X: 노트가 clipboardNote에 저장되고 트랙에서 제거되며 selectedNoteId가 null이 된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    const state = useStore.getState()
    const tid = state.selectedTrackId
    const track = state.project.tracks.find((t) => t.id === tid)!
    expect(state.clipboardNote).toMatchObject({ pitch: 60 })
    expect(track.notes).toHaveLength(0)
    expect(state.selectedNoteId).toBeNull()
  })

  it('Ctrl/Cmd+V: clipboardNote에서 새 노트가 현재 anchorTick에 붙여넣어지고 선택된다', () => {
    // 먼저 복사
    const s = useStore.getState()
    const originalNote = s.project.tracks[0]!.notes[0]!
    act(() => { s.setClipboardNote(originalNote) })

    // getSeconds=0 → anchorTick=0, 4/4 ppq480 기준 grid=16th=120
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })

    const state2 = useStore.getState()
    const track = state2.project.tracks[0]!
    // 원본 1개 + 붙여넣기 1개 = 2개
    expect(track.notes).toHaveLength(2)
    // 새 노트가 선택됨
    const newNote = track.notes.find((n) => n.id !== noteId)!
    expect(state2.selectedNoteId).toBe(newNote.id)
    // start는 anchorTick(0)에 snap → 0
    expect(newNote.start).toBe(0)
    // pitch, duration, velocity는 clip에서
    expect(newNote.pitch).toBe(60)
    expect(newNote.duration).toBe(240)
  })

  it('Ctrl/Cmd+D: 선택된 노트를 1마디 뒤에 복제하고 새 노트가 선택된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })

    const state = useStore.getState()
    const track = state.project.tracks[0]!
    expect(track.notes).toHaveLength(2)
    const newNote = track.notes.find((n) => n.id !== noteId)!
    expect(state.selectedNoteId).toBe(newNote.id)
    // start = 480 + 1920(4/4 bar) = 2400
    expect(newNote.start).toBe(2400)
    expect(newNote.pitch).toBe(60)
    expect(newNote.duration).toBe(240)
  })

  it('INPUT 포커스 시 Ctrl/Cmd+C는 no-op이다 (입력 필드 가드)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'c', [modKey]: true, bubbles: true })
    expect(useStore.getState().clipboardNote).toBeNull()
    document.body.removeChild(input)
  })

  it('선택된 노트가 없으면 Ctrl/Cmd+C는 no-op이다', () => {
    act(() => { useStore.getState().selectNote(null) })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNote).toBeNull()
  })

  it('clipboardNote가 null이면 Ctrl/Cmd+V는 no-op이다', () => {
    // clipboardNote는 null (초기 상태)
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })
    const track = useStore.getState().project.tracks[0]!
    // 노트 수 변화 없음
    expect(track.notes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- useClipboard.test
```

Expected: FAIL — `'../useClipboard'` 모듈 없음.

- [ ] **Step 3: useClipboard.ts 레퍼런스 구현**

Create `apps/web/src/compose/useClipboard.ts`:
```ts
import { useEffect } from 'react'
import { addNote, removeNote, createNote } from '@sculptone/score-model'
import { useStore } from '../state/store'
import { barTicks, duplicateNoteParams, pasteNoteParams } from './clipboard'
import { divisionToTicks } from './quantize'
import { secondsToTicks } from './time'

// ── 입력 필드 가드 ─────────────────────────────────────────────

function isInputLike(target: HTMLElement): boolean {
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

// ── 훅 ────────────────────────────────────────────────────────

/**
 * 전역 Ctrl/Cmd+C/X/V/D 클립보드 단축키를 등록한다.
 *
 * @param getSeconds - 현재 재생 위치(초)를 반환하는 stable ref. useAudio().getSeconds.
 *
 * 설계 노트:
 * - window keydown 리스너를 직접 등록해 AppShell의 기존 핸들러와 독립적으로 동작.
 * - 모든 store 상태는 핸들러 내부에서 useStore.getState()로 읽어 stale 클로저를 방지.
 * - 프로젝트를 변경하는 액션(X/V/D) 전에 endEdit()을 호출해 클립보드 조작이
 *   직전 드래그와 코얼레싱되지 않고 독립적인 undo 스텝이 되게 한다.
 * - Ctrl+D는 브라우저 북마크 단축키이므로 e.preventDefault() 필수.
 *   C/X/V도 입력 필드 외부에서 e.preventDefault()를 호출해 예기치 않은
 *   브라우저 동작을 방지한다.
 */
export function useClipboard({ getSeconds }: { getSeconds: () => number }): void {
  useEffect(() => {
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

    const handler = (e: KeyboardEvent) => {
      // ── 입력 필드 가드 ──
      if (isInputLike(e.target as HTMLElement)) return

      // ── 수식어 가드: Ctrl 또는 Cmd 필수, Alt/Shift는 불가 ──
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return

      const k = e.key.toLowerCase()
      if (k !== 'c' && k !== 'x' && k !== 'v' && k !== 'd') return

      // 여기까지 왔으면 클립보드 단축키 — 브라우저 기본 동작 차단
      e.preventDefault()

      const {
        project,
        selectedTrackId,
        selectedNoteId,
        quantizeDenom,
        clipboardNote,
        setClipboardNote,
        setProject,
        selectNote,
        endEdit,
      } = useStore.getState()

      const track = project.tracks.find((t) => t.id === selectedTrackId)
      const note = track?.notes.find((n) => n.id === selectedNoteId) ?? null

      const ppq = project.transport.ppq
      const tempo = project.transport.tempo
      const timeSignature = project.transport.timeSignature as [number, number]
      const grid = divisionToTicks(quantizeDenom, ppq)

      // ── 복사 (C) ──────────────────────────────────────────────
      if (k === 'c') {
        if (!note) return
        setClipboardNote(note)
        return
      }

      // ── 오려내기 (X) ──────────────────────────────────────────
      if (k === 'x') {
        if (!note) return
        setClipboardNote(note)
        endEdit() // 직전 드래그와 코얼레싱 방지
        setProject(removeNote(project, selectedTrackId, note.id))
        selectNote(null)
        return
      }

      // ── 붙여넣기 (V) ──────────────────────────────────────────
      if (k === 'v') {
        if (!clipboardNote) return
        const anchorTick = secondsToTicks(getSeconds(), ppq, tempo)
        const params = pasteNoteParams(clipboardNote, anchorTick, grid)
        const newNote = createNote(params)
        endEdit()
        setProject(addNote(project, selectedTrackId, newNote))
        selectNote(newNote.id)
        return
      }

      // ── 복제 (D) ──────────────────────────────────────────────
      if (k === 'd') {
        if (!note) return
        const bt = barTicks(ppq, timeSignature)
        const params = duplicateNoteParams(note, bt)
        const newNote = createNote(params)
        endEdit()
        setProject(addNote(project, selectedTrackId, newNote))
        selectNote(newNote.id)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [getSeconds])
  // getSeconds는 useAudio의 useCallback([], []) — stable ref, 의존 배열 포함 안전.
}
```

> **타입 노트:**
> - `useEffect` — `'react'` named import. React 네임스페이스(`React.useEffect`) 금지.
> - `Note` 타입은 직접 사용하지 않으므로 별도 import 불필요 (`useStore.getState().clipboardNote`가 `Note | null`로 이미 타입됨).
> - `useStore.getState()` inside handler: Rules of Hooks 위반 없음 (핸들러 내부, useEffect 클로저 밖이 아님).


- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- useClipboard.test
```

Expected: `useClipboard.test.ts` 7개 PASS.

---

## Task 4: AppShell + ShortcutsHelp 배선 (레퍼런스 + 스모크)

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/shell/ShortcutsHelp.tsx`

- [ ] **Step 1: ShortcutsHelp.tsx — SHORTCUTS 배열에 클립보드 항목 추가**

`apps/web/src/shell/ShortcutsHelp.tsx`의 `SHORTCUTS` 배열에 추가:

기존:
```ts
const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Space', desc: '재생 / 정지' },
  { keys: 'R', desc: '녹음 Arm 토글' },
  { keys: 'M', desc: '메트로놈 토글' },
  { keys: 'Ctrl+Z / Cmd+Z', desc: '실행 취소' },
  { keys: 'Ctrl+Shift+Z / Cmd+Shift+Z', desc: '다시 실행' },
  { keys: 'Del / Backspace', desc: '노트 삭제 (Piano Roll)' },
  { keys: '?', desc: '이 도움말 열기 / 닫기' },
]
```

변경 후 (Del/Backspace 다음, ? 앞에 삽입):
```ts
const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Space', desc: '재생 / 정지' },
  { keys: 'R', desc: '녹음 Arm 토글' },
  { keys: 'M', desc: '메트로놈 토글' },
  { keys: 'Ctrl+Z / Cmd+Z', desc: '실행 취소' },
  { keys: 'Ctrl+Shift+Z / Cmd+Shift+Z', desc: '다시 실행' },
  { keys: 'Del / Backspace', desc: '노트 삭제 (Piano Roll)' },
  { keys: 'Ctrl+C / Cmd+C', desc: '노트 복사' },
  { keys: 'Ctrl+X / Cmd+X', desc: '노트 오려내기' },
  { keys: 'Ctrl+V / Cmd+V', desc: '노트 붙여넣기 (재생 위치에)' },
  { keys: 'Ctrl+D / Cmd+D', desc: '노트 복제 (+1마디)' },
  { keys: '?', desc: '이 도움말 열기 / 닫기' },
]
```

> **기존 ShortcutsHelp.test.tsx 영향 없음:** 기존 6개 테스트는 "재생 / 정지" 텍스트와 "Space" 텍스트, 닫기 버튼, 배경 클릭을 단언한다. 새 항목 추가는 이들과 충돌하지 않는다.

- [ ] **Step 2: AppShell.tsx — useClipboard 훅 연결**

`apps/web/src/shell/AppShell.tsx`에 두 가지만 변경:

**2a) import 추가:**
```ts
import { useClipboard } from '../compose/useClipboard'
```

**2b) `const { play, stop, getSeconds } = useAudio()` 다음 줄에 추가:**
```ts
useClipboard({ getSeconds })
```

> **설계 노트:** `getSeconds`는 `useAudio`가 이미 생성한 audio engine의 `getSeconds`다. `useClipboard` 내부에서 `useAudio()`를 재호출하면 두 번째 audio engine 인스턴스가 생성되므로 반드시 AppShell에서 전달해야 한다.

- [ ] **Step 3: ShortcutsHelp 신규 항목 스모크 (AppShell.test.tsx 또는 ShortcutsHelp.test.tsx)**

`apps/web/src/test/ShortcutsHelp.test.tsx`에 테스트 2개 추가 (기존 6개 뒤에):
```tsx
  it('클립보드 단축키 "노트 복사" 항목이 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText('노트 복사')).toBeInTheDocument()
  })

  it('클립보드 단축키 "노트 복제 (+1마디)" 항목이 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText('노트 복제 (+1마디)')).toBeInTheDocument()
  })
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- ShortcutsHelp.test AppShell.test
```

Expected:
- `ShortcutsHelp.test.tsx` 기존 6개 + 신규 2개 = **8개 PASS**
- `AppShell.test.tsx` 기존 테스트 전부 **PASS** (useClipboard 추가가 기존 keydown/undo 테스트와 독립적)

---

## Task 5: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 테스트**

```bash
pnpm -r test
```

Expected 추가분:

| 파일 | 신규 테스트 수 |
|---|---|
| `compose/test/clipboard.test.ts` | 15 |
| `test/clipboard-store.test.ts` | 4 |
| `compose/test/useClipboard.test.ts` | 7 |
| `test/ShortcutsHelp.test.tsx` 추가 | 2 |
| **합계** | **28** |

기존 630 + 28 = **658개 전부 PASS**.

> **기존 테스트 보존 체크리스트:**
> - `test/shortcuts.test.ts` 16개: `shortcuts.ts` 수정 없음 → **PASS**
> - `test/shortcuts-store.test.ts` 5개: `store.ts` 수정(clipboardNote 추가)은 `showShortcuts` 관련 테스트와 무관 → **PASS**
> - `test/ShortcutsHelp.test.tsx` 기존 6개: SHORTCUTS 배열 추가는 "재생 / 정지", "Space", "닫기" 단언과 충돌 없음 → **PASS**
> - `test/AppShell.test.tsx`: `useClipboard`가 AppShell에 추가됐지만 AppShell 테스트는 `vi.mock('../audio/useAudio', ...)` 패턴 사용. `useClipboard`는 `getSeconds: () => 0`을 받는다 — 테스트 환경에서 `getSeconds()`는 항상 0을 반환. 기존 keydown 테스트(Space/R/M/? 등)는 영향 없음. 단, `useClipboard`의 keydown 리스너가 추가로 등록됨 — 기존 테스트가 `Ctrl+C` 등을 발생시키지 않으므로 간섭 없음 → **PASS**
> - `test/store.test.ts` 3개: `clipboardNote` 미단언 → **PASS**
> - `compose/test/drag.test.ts` 22개, `compose/test/PianoRoll.drag.test.tsx` 4개: 수정 없음 → **PASS**
> - `midi/`, `audio/`, `io/` 테스트: 수정 없음 → **PASS**

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. 특히:
- `store.ts`: `Note` import 추가, `clipboardNote: Note | null`, `setClipboardNote: (note: Note | null) => void` — `create<AppState>()` 구현에 대응 필드 있음 ✓
- `useClipboard.ts`: `useEffect`가 `'react'` named import, `Note` 타입 불필요 ✓
- `clipboard.ts`: `Note` import가 `import type`으로, `Omit<Note, 'id'>` 반환 타입 일치 ✓
- `AppShell.tsx`: `useClipboard` import, `useClipboard({ getSeconds })` 호출 — `getSeconds: () => number` 타입 일치 ✓

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `clipboard.ts`, `useClipboard.ts` 번들에 포함.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 630개 보존 + 신규 28개, 합계 658개).
- `clipboard.ts` 순수 함수 3개(`barTicks`, `duplicateNoteParams`, `pasteNoteParams`) — 15개 단위 테스트 검증.
- `store.clipboardNote`: 초기 null, `setClipboardNote(note)` 설정, `setClipboardNote(null)` 초기화, `getInitialState()` 리셋 시 null — 4개 TDD 테스트 검증.
- `useClipboard`: Ctrl/Cmd+C(복사), X(오려내기+선택해제), V(붙여넣기+선택), D(복제+선택) 동작 — 7개 스모크 테스트 검증.
- 입력 필드 가드: INPUT 포커스 시 Ctrl+C no-op — 테스트 검증.
- 선택 없음 가드: 노트 미선택 시 C/X/D no-op, clipboardNote=null 시 V no-op.
- `e.preventDefault()`: C/X/V/D 모두 브라우저 기본 동작 차단 (Ctrl+D 북마크 방지 포함).
- `endEdit()` 호출: X/V/D 전에 호출해 코얼레싱 없는 독립 undo 스텝 보장.
- 기존 Ctrl+Z/Y(undo/redo), Space/R/M/? 단축키 보존 — 기존 단축키 테스트 PASS 유지.
- `ShortcutsHelp`에 C/X/V/D 4개 항목 표시 — 스모크 테스트 검증.
- React 타입 네임스페이스 미사용 (`'react'` named import만).
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.
- `shortcuts.ts` 미수정 — 기존 `matchShortcut` 16개 테스트 그대로 통과.

---

## 다음 계획 (이 계획 완료 후)

- **멀티노트 선택·클립보드 (P2 증분):** `selectedNoteIds: Set<string>` 추가, PianoRoll에서 박스 선택·Shift 클릭. 클립보드에 `Note[]` 배열. `duplicateNoteParams` / `pasteNoteParams`를 배열 처리로 확장.
- **붙여넣기 위치 UX 개선 (P3):** "정확 위치 vs 재생 헤드" 옵션. 현재 구현은 재생 헤드 고정. 향후 `anchorTick` 계산 함수만 교체하면 됨.
- **시스템 클립보드 연동 (P3):** `navigator.clipboard` API로 DAW 앱 간 노트 공유. MusicXML 또는 JSON 직렬화 필요.
- **키보드 단축키 사용자 정의 (P3):** shortcuts.ts에 사용자 설정 테이블 기반 매칭 도입 시 C/X/V/D도 동일 패턴으로 적용 가능.

---

## 열린 질문

1. **붙여넣기 앵커 정지 시 0틱 vs 마지막 정지 위치:** 현재 `getSeconds()` → 정지 시 `engineRef.current?.getSeconds() ?? 0`이 0을 반환. 사용자가 재생 중 정지한 직후 붙여넣으면 정지 직전 위치가 앵커가 되는 게 더 자연스럽다. `recordStopSec`를 활용하는 방안 검토 가능(열린 질문).

2. **오려내기(X) undo 동작:** 현재 X는 `setProject(removeNote(...))` 1번 → 1 undo 스텝. undo 시 노트는 복구되지만 `clipboardNote`는 그대로 남는다(clipboardNote는 undo 대상 아님). 이는 대부분의 DAW 표준 동작. 사용자 혼란 가능성 낮음.

3. **붙여넣기 후 복수 붙여넣기 위치:** Ctrl+V를 연속으로 누르면 매번 동일한 `anchorTick`(getSeconds())에 붙여넣어진다. 각 붙여넣기를 1마디씩 오프셋할지는 UX 결정 필요. 현재는 동일 위치에 겹쳐 붙여넣기(velocity/pitch 동일이므로 실제로는 1개처럼 보임). 향후 개선 가능.

4. **Ctrl+D 와 브라우저 북마크:** `e.preventDefault()`로 차단하지만, 일부 브라우저 환경(특히 iframe 임베딩)에서 preventDefault가 무시될 수 있다. 수용 가능 위험 수준이며, 앱이 독립 탭으로 동작할 때는 문제없음.

5. **복제 방향:** 현재 복제는 항상 +1마디(앞). 일부 DAW는 Ctrl+D를 "다음 트랙 빈 위치"에 복제한다. 현재 구현(+1마디 고정)이 가장 단순하고 예측 가능. 향후 확장 시 `duplicateNoteParams` 함수의 offset 파라미터를 변경하면 됨.

6. **`contentEditable` 가드 — `isContentEditable` 프로퍼티 사용:** `shortcuts.ts`의 기존 구현이 `target.isContentEditable`(boolean 프로퍼티)를 사용하는 것을 확인했다. `useClipboard`도 동일하게 `target.isContentEditable`을 사용해 일관성 유지. (플랜 설계 근거 참조.)
