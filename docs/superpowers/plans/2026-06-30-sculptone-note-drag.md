# Sculptone Piano Roll 노트 드래그 (이동 + 리사이즈) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤에서 노트를 마우스로 드래그해 위치(pitch·start)를 이동하고, 우측 끝 핸들로 길이(duration)를 리사이즈할 수 있게 한다. 기존 생성(그리드 클릭)/선택(노트 클릭)/삭제(Delete) 동작을 완전히 보존하고, 기존 439개 테스트를 그대로 통과시킨다.

**Architecture:** 픽셀 델타→틱/반음 변환과 클램프·스냅 계산을 순수 함수 모듈 `drag.ts`로 분리해 완전 TDD. `PianoRoll.tsx`는 포인터 이벤트 3종(pointerdown on note, pointermove + pointerup on container)으로 드래그를 처리하고, 매 pointermove마다 `updateNote` + `setProject`를 호출한다. `setProject`의 400ms 코얼레싱(Plan 9 구현)이 드래그 폭주를 자동으로 ~1 undo 스텝으로 합친다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** `apps/web/src/compose/PianoRoll.tsx` (기존 편집 상호작용), `apps/web/src/compose/geometry.ts` (좌표 상수·함수), `apps/web/src/compose/quantize.ts` (snap), `apps/web/src/state/store.ts` (setProject 코얼레싱), `packages/score-model/src/operations.ts` (updateNote).

---

## 비목표 (이 계획에서 하지 말 것)

- 다중 노트 동시 드래그 / 박스 선택
- 다른 노트로 스냅(인접 노트 스냅 가이드)
- 트랙 간 드래그
- 좌측 끝 리사이즈(start 이동, 반대 방향 핸들)
- 롤에서 velocity 드래그(수직 바)
- 드래그 중 자동 스크롤(뷰포트 추적)
- 터치 제스처 정밀화(멀티터치, pinch-zoom)
- 협업 / 백엔드

---

## 설계 근거

### 순수 / 비순수 분리

픽셀↔틱/반음 변환(`pxToTicks`, `pxToSemitones`)과 이동·리사이즈 계산(`computeMove`, `computeResize`)은 외부 상태 없이 입력만으로 결정되는 순수 함수다. `drag.ts`로 분리해 완전 TDD(22개). 나머지 포인터 이벤트 핸들링만 PianoRoll에 있고, 스모크 테스트로 검증한다.

### 클릭 vs 드래그 분기 (기존 동작 보존)

`pointerdown` 시 dragRef에 시작 좌표와 origNote를 기록한다. `pointermove`에서 `|dx|` 또는 `|dy|` 중 하나가 `DRAG_THRESHOLD = 3px` 이상일 때만 `dragRef.moved = true`로 전환하고 `updateNote`를 호출한다. `pointerup`에서 `!moved`이면 클릭으로 판단해 `selectNote`를 호출한다. 이 분기 덕분에:

- **기존 노트 클릭=선택** 동작 보존: `userEvent.click(note)`는 포인터 이동 없이 pointerdown+pointerup을 발생시켜 `moved=false` → `selectNote` ✓
- **기존 그리드 클릭=노트 생성** 동작 보존: 그리드 직접 클릭은 노트 div를 통하지 않으므로 dragRef가 설정되지 않고 `handleGridPointerDown`만 실행 ✓

### 이벤트 위계 및 stopPropagation 전략

- **노트 div `onPointerDown`**: `e.stopPropagation()` 호출 → 컨테이너의 `handleGridPointerDown`이 노트 위 클릭을 받지 않음. (기존 `e.target !== e.currentTarget` 가드도 유지.)
- **리사이즈 핸들 div `onPointerDown`**: `e.stopPropagation()` 호출 → 노트 div의 `handleNotePointerDown`이 실행되지 않음. `type: 'resize'`로 dragRef 설정.
- **컨테이너 div `onPointerMove` / `onPointerUp`**: 단일 위치에서 drag 상태를 관리. DOM 포인터 이벤트는 버블링되므로, 브라우저에서 `setPointerCapture`로 노트 div가 포인터를 잡더라도 pointermove/up이 컨테이너까지 버블링되어 핸들러가 실행된다. jsdom에서는 `fireEvent.pointerMove(container, ...)` / `fireEvent.pointerUp(container, ...)` 직접 발사로 동일 경로를 시뮬레이션한다.

### origNote 스냅샷 — 절댓값 계산

`dragRef.origNote`에 드래그 시작 시의 note 값을 스냅샷으로 보관한다. 매 `pointermove`마다 `dx = e.clientX - dragRef.startX`(드래그 시작 기준 전체 델타)로 계산해 `computeMove(origNote, deltaTicks, ...)` 또는 `computeResize(origNote, deltaTicks, ...)`를 호출한다. 증분 누적이 아니라 절댓값 계산이므로 코얼레싱·렌더 지연과 무관하게 항상 올바른 위치를 반환한다.

### store project 최신 참조

`handleContainerPointerMove`에서 `setProject(updateNote(...))` 호출 시 `useStore.getState().project`(항상 최신)를 읽어 stale 클로저 문제를 방지한다. `selectedTrackId`·`ppq`·`grid`는 드래그 중 변경되지 않으므로 렌더 클로저 값을 사용해도 안전하다.

### undo 코얼레싱 활용

`store.ts`의 `COALESCE_MS = 400` 로직이 이미 구현되어 있다. 드래그 중 매 `pointermove`마다 `setProject`가 호출되지만 400ms 이내 연속 호출은 `history.past`에 push하지 않고 `present`만 교체한다. 드래그 전체가 자동으로 ~1 undo 스텝으로 합쳐지며, 추가 구현이 없다.

### 피치 클램프 범위

`PITCH_LOW(36, C2)` .. `PITCH_HIGH(84, C6)` — geometry 상수를 사용. 롤의 가시 범위 내로 제한하므로 드래그로 보이지 않는 피치로 이동할 수 없다.

### jsdom 스모크 전략

jsdom 제약: `getBoundingClientRect()` 는 `{ left:0, top:0, ... }` 반환, `setPointerCapture`는 미구현(try/catch 처리). 드래그 스모크 테스트는:
1. `fireEvent.pointerDown(noteEl, { clientX, clientY })` — dragRef 설정
2. `fireEvent.pointerMove(container, { clientX + δ, ... })` — 드래그 처리
3. `fireEvent.pointerUp(container, ...)` — 드래그 종료

좌표는 `getBoundingClientRect`와 무관하게 clientX 자체가 상대 좌표처럼 작동한다(`rect.left = 0`이므로 `x = clientX - 0 = clientX`). 정확한 수치 검증은 drag.ts 순수 함수 테스트가 보장하고, 스모크는 "이동 후 값이 바뀌는가"만 검증한다.

---

## 피치 클램프 선택 명시

**선택: `PITCH_LOW(36)..PITCH_HIGH(84)`** (geometry 상수). 0..127 대신 롤 가시 범위를 선택한 이유: 뷰포트 밖 피치로 이동하면 노트가 보이지 않아 혼란스럽다. 롤 스크롤 확장 시 PITCH_LOW/PITCH_HIGH를 조정하면 자동으로 반영된다.

---

## File Structure

```
apps/web/src/
  compose/
    drag.ts                   # NEW: 순수 드래그 지오메트리 (pxToTicks, pxToSemitones, computeMove, computeResize)
    PianoRoll.tsx             # MOD: 드래그 상호작용 추가 (onPointerDown on note, onPointerMove/Up on container)
    test/
      drag.test.ts            # NEW: drag.ts 완전 TDD (22개)
      PianoRoll.drag.test.tsx # NEW: PianoRoll 드래그 스모크 (4개)
      PianoRoll.test.tsx      # 변경 없음 — 렌더 테스트 유지
      PianoRoll.edit.test.tsx # 변경 없음 — 생성/선택/삭제 테스트 유지
```

변경 없는 파일:
- `geometry.ts`, `quantize.ts` — drag.ts가 상수와 `snap`을 import할 뿐 수정 없음
- `store.ts` — 코얼레싱 로직 그대로 활용
- `packages/score-model/*` — `updateNote` 그대로 사용

---

## Task 1: compose/drag.ts — 순수 드래그 지오메트리 (완전 TDD)

**Files:** Create `apps/web/src/compose/drag.ts`, `apps/web/src/compose/test/drag.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/drag.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { pxToTicks, pxToSemitones, computeMove, computeResize } from '../drag'
import { PITCH_LOW, PITCH_HIGH, LANE_HEIGHT, PX_PER_BEAT } from '../geometry'

const PPQ = 480
const GRID = 120  // divisionToTicks(16, 480) = 480*4/16 = 120

// ── pxToTicks ────────────────────────────────────────────────

describe('pxToTicks', () => {
  it('1박(PX_PER_BEAT px) = PPQ 틱', () => {
    expect(pxToTicks(PX_PER_BEAT, PPQ)).toBeCloseTo(PPQ)
  })

  it('음수 px → 음수 틱 (왼쪽 드래그)', () => {
    expect(pxToTicks(-PX_PER_BEAT, PPQ)).toBeCloseTo(-PPQ)
  })

  it('0 → 0', () => {
    expect(pxToTicks(0, PPQ)).toBe(0)
  })
})

// ── pxToSemitones ────────────────────────────────────────────

describe('pxToSemitones', () => {
  it('1 레인 아래(+laneHeight) → -1 반음 (낮은 피치)', () => {
    expect(pxToSemitones(LANE_HEIGHT, LANE_HEIGHT)).toBe(-1)
  })

  it('1 레인 위(-laneHeight) → +1 반음 (높은 피치)', () => {
    expect(pxToSemitones(-LANE_HEIGHT, LANE_HEIGHT)).toBe(1)
  })

  it('0 → 0 (수직 이동 없음)', () => {
    expect(pxToSemitones(0, LANE_HEIGHT)).toBe(0)
  })

  it('0.4 레인 아래 → 반올림 0 (반음 경계 미만)', () => {
    expect(pxToSemitones(LANE_HEIGHT * 0.4, LANE_HEIGHT)).toBe(0)
  })

  it('0.6 레인 아래 → 반올림 -1 (반음 경계 초과)', () => {
    expect(pxToSemitones(LANE_HEIGHT * 0.6, LANE_HEIGHT)).toBe(-1)
  })
})

// ── computeMove ──────────────────────────────────────────────

describe('computeMove', () => {
  const note = { start: 240, pitch: 60 }

  it('기본 이동: deltaTicks=GRID, deltaSemitones=-1 → start·pitch 변경', () => {
    const r = computeMove(note, GRID, -1, GRID)
    // snap(240+120, 120) = 360
    expect(r.start).toBe(360)
    // 60 - 1 = 59
    expect(r.pitch).toBe(59)
  })

  it('start는 0 미만으로 클램프된다 (큰 음수 delta)', () => {
    const r = computeMove(note, -9999, 0, GRID)
    expect(r.start).toBe(0)
  })

  it('pitch는 PITCH_LOW 미만으로 내려가지 않는다', () => {
    const r = computeMove({ start: 0, pitch: PITCH_LOW }, 0, -10, GRID)
    expect(r.pitch).toBe(PITCH_LOW)
  })

  it('pitch는 PITCH_HIGH를 초과하지 않는다', () => {
    const r = computeMove({ start: 0, pitch: PITCH_HIGH }, 0, +10, GRID)
    expect(r.pitch).toBe(PITCH_HIGH)
  })

  it('gridTicks=0: 스냅 없이 자유 이동', () => {
    const r = computeMove({ start: 100, pitch: 60 }, 37, 0, 0)
    expect(r.start).toBe(137)
  })

  it('정확히 그리드 경계(360 = 3×GRID): 스냅 유지', () => {
    const r = computeMove({ start: 0, pitch: 60 }, 360, 0, GRID)
    expect(r.start).toBe(360)
  })

  it('양자화 반올림: 1.5그리드(180) → 상위 그리드(240)', () => {
    // snap(0+180, 120) = round(1.5)*120 = 2*120 = 240
    const r = computeMove({ start: 0, pitch: 60 }, 180, 0, GRID)
    expect(r.start).toBe(240)
  })

  it('pitch와 start 동시 변경(통합)', () => {
    const r = computeMove({ start: 480, pitch: 70 }, -GRID, 2, GRID)
    // snap(480-120, 120) = snap(360, 120) = 360
    expect(r.start).toBe(360)
    // 70 + 2 = 72, within range
    expect(r.pitch).toBe(72)
  })
})

// ── computeResize ────────────────────────────────────────────

describe('computeResize', () => {
  const note = { duration: 480 }

  it('기본 리사이즈: delta=GRID → duration 증가', () => {
    const r = computeResize(note, GRID, GRID)
    // snap(480+120, 120) = 600
    expect(r.duration).toBe(600)
  })

  it('최소 1그리드(gridTicks > 0) 보장 (큰 음수 delta)', () => {
    const r = computeResize(note, -9999, GRID)
    // snap(480-9999, 120) 은 음수 → max(120, 음수) = 120
    expect(r.duration).toBe(GRID)
  })

  it('gridTicks=0: 최소 1틱 보장 (큰 음수 delta)', () => {
    const r = computeResize({ duration: 1 }, -9999, 0)
    // snap(-9998, 0) = -9998 → max(1, -9998) = 1
    expect(r.duration).toBe(1)
  })

  it('gridTicks=0: 스냅 없이 자유 리사이즈', () => {
    const r = computeResize({ duration: 100 }, 37, 0)
    // snap(137, 0) = 137 → max(1, 137) = 137
    expect(r.duration).toBe(137)
  })

  it('양자화 반올림: 1.508그리드 오버 → 상위 그리드', () => {
    // snap(480+181, 120) = snap(661, 120) = round(5.508)*120 = 6*120 = 720
    const r = computeResize({ duration: 480 }, 181, GRID)
    expect(r.duration).toBe(720)
  })

  it('소폭 감소(delta 음수): gridTicks 이상 보장', () => {
    // snap(480-180, 120) = snap(300, 120) = round(2.5)*120 = 3*120 = 360
    // max(120, 360) = 360
    const r = computeResize({ duration: 480 }, -180, GRID)
    expect(r.duration).toBe(360)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- drag.test
```

Expected: FAIL — `'../drag'` 모듈 없음.

- [ ] **Step 3: drag.ts 구현**

Create `apps/web/src/compose/drag.ts`:
```ts
import { PITCH_LOW, PITCH_HIGH, PX_PER_BEAT } from './geometry'
import { snap } from './quantize'

/**
 * 픽셀 델타(수평) → 틱 델타.
 * PX_PER_BEAT(48px/박) 기준으로 변환한다.
 * 부호 보존: 오른쪽(+px) = 나중(+ticks), 왼쪽(-px) = 앞(-ticks).
 */
export function pxToTicks(dx: number, ppq: number): number {
  return dx / (PX_PER_BEAT / ppq)
}

/**
 * 픽셀 델타(수직) → 반음 델타.
 * 화면 아래(dy > 0) = 낮은 피치 = 음수 반음.
 * 반올림해 반음 단위로 반환한다.
 */
export function pxToSemitones(dy: number, laneHeight: number): number {
  return -Math.round(dy / laneHeight)
}

/**
 * 이동 드래그: 새 { start, pitch } 를 계산한다.
 *
 * - start = max(0, snap(note.start + deltaTicks, gridTicks))
 * - pitch = clamp(note.pitch + deltaSemitones, PITCH_LOW, PITCH_HIGH)
 *
 * gridTicks <= 0 이면 스냅 없이 자유 이동.
 * 피치 클램프 범위: geometry.PITCH_LOW(36, C2) .. PITCH_HIGH(84, C6) — 롤 가시 범위.
 */
export function computeMove(
  note: { start: number; pitch: number },
  deltaTicks: number,
  deltaSemitones: number,
  gridTicks: number,
): { start: number; pitch: number } {
  const start = Math.max(0, snap(note.start + deltaTicks, gridTicks))
  const pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, note.pitch + deltaSemitones))
  return { start, pitch }
}

/**
 * 리사이즈 드래그: 새 { duration } 을 계산한다.
 *
 * - minDuration = gridTicks > 0 ? gridTicks : 1  (최소 1그리드 또는 1틱)
 * - duration = max(minDuration, snap(note.duration + deltaTicks, gridTicks))
 *
 * gridTicks <= 0 이면 스냅 없이 자유 리사이즈.
 */
export function computeResize(
  note: { duration: number },
  deltaTicks: number,
  gridTicks: number,
): { duration: number } {
  const minDuration = gridTicks > 0 ? gridTicks : 1
  const duration = Math.max(minDuration, snap(note.duration + deltaTicks, gridTicks))
  return { duration }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- drag.test
```

Expected: drag.test.ts 22개 PASS. 기존 테스트 영향 없음.

---

## Task 2: PianoRoll 드래그 상호작용 + 스모크 테스트

**Files:** Create `apps/web/src/compose/test/PianoRoll.drag.test.tsx`; Modify `apps/web/src/compose/PianoRoll.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/PianoRoll.drag.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, act } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

/**
 * jsdom 제약 메모:
 * - getBoundingClientRect() 는 항상 { left:0, top:0, ... } 반환.
 *   따라서 clientX 자체가 롤 내 상대 좌표처럼 동작한다.
 * - setPointerCapture 는 미구현 → try/catch로 무시.
 * - pointermove/pointerup 은 컨테이너 div에 직접 발사해 핸들러 경로 검증.
 * - 정확한 수치(start 값 등)는 drag.ts 순수 함수 테스트가 보장.
 *   스모크는 "드래그 후 값이 변화하는가" 여부만 검증한다.
 */

describe('PianoRoll drag smoke', () => {
  let noteId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const note = createNote({ pitch: 60, start: 240, duration: 480, velocity: 100 })
    noteId = note.id
    s.setProject(addNote(s.project, tid, note))
    s.selectNote(note.id)
  })

  it('노트 본체를 threshold 초과 드래그하면 start가 증가한다', () => {
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // pointerdown → pointermove(dx=50, > threshold=3) → pointerup
    fireEvent.pointerDown(noteEl, { clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(container, { clientX: 150, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(container, { clientX: 150, clientY: 200, pointerId: 1 })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // dx=50px > 3px → 드래그 발생; pxToTicks(50, 480)=500tick → snap(740,120)=720 > 240
    expect(track.notes[0]!.start).toBeGreaterThan(240)
  })

  it('리사이즈 핸들을 threshold 초과 드래그하면 duration이 증가한다', () => {
    render(<PianoRoll />)
    const handle = screen.getByTestId('note-resize-handle')
    const container = screen.getByTestId('pianoroll')

    // dx=48px = 1박 → pxToTicks(48,480)=480tick → snap(960,120)=960 > 480
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(container, { clientX: 148, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(container, { clientX: 148, clientY: 200, pointerId: 1 })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes[0]!.duration).toBeGreaterThan(480)
  })

  it('3px 미만 이동(클릭)이면 드래그 없이 노트만 선택된다', () => {
    // 선택을 먼저 비운다
    act(() => { useStore.getState().selectNote(null) })
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // dx=1px < threshold=3px → moved=false → selectNote 호출
    fireEvent.pointerDown(noteEl, { clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(container, { clientX: 101, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(container, { clientX: 101, clientY: 200, pointerId: 1 })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // 선택됨
    expect(useStore.getState().selectedNoteId).toBe(noteId)
    // start는 변경되지 않음
    expect(track.notes[0]!.start).toBe(240)
  })

  it('노트 위 pointerdown은 컨테이너 노트 생성을 트리거하지 않는다', () => {
    render(<PianoRoll />)
    const noteEl = screen.getByTestId('note')

    // note 위에서 pointerdown → stopPropagation → 컨테이너 handleGridPointerDown 실행 안 됨
    fireEvent.pointerDown(noteEl, { clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(noteEl, { clientX: 100, clientY: 200, pointerId: 1 })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // 기존 1개 노트만 존재 (새 노트 생성 없음)
    expect(track.notes).toHaveLength(1)
  })
})
```

> **참고:** `"노트 위 pointerdown은 컨테이너 노트 생성을 트리거하지 않는다"` 테스트는 stopPropagation이 정상 동작함을 검증한다. jsdom에서 fireEvent.pointerDown(noteEl)은 note의 onPointerDown을 먼저 실행(stopPropagation)하고, 컨테이너의 onPointerDown은 실행되지 않는다.

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll.drag
```

Expected: FAIL — `note-resize-handle` 없음, 드래그 핸들러 없음.

- [ ] **Step 3: PianoRoll.tsx 교체 (드래그 추가 — 레퍼런스 구현)**

Replace `apps/web/src/compose/PianoRoll.tsx`:
```tsx
import {
  useRef,
  type PointerEvent as RPointerEvent,
  type KeyboardEvent as RKeyboardEvent,
} from 'react'
import { useStore } from '../state/store'
import { addNote, removeNote, createNote, updateNote } from '@sculptone/score-model'
import type { Note } from '@sculptone/score-model'
import {
  tickToX, xToTick, pitchToY, yToPitch, durationToWidth,
  rollHeight, LANE_HEIGHT, NOTE_HEIGHT, PX_PER_BEAT,
} from './geometry'
import { divisionToTicks, snap } from './quantize'
import { pxToTicks, pxToSemitones, computeMove, computeResize } from './drag'

/** pointerdown → pointermove 이 이 거리(px)를 초과해야 드래그로 인식한다. */
const DRAG_THRESHOLD = 3

/** 리사이즈 핸들 너비(px). 노트 우측 끝. */
const RESIZE_HANDLE_WIDTH = 6

interface DragState {
  noteId: string
  /** 드래그 시작 시 note 값의 스냅샷 (절댓값 계산 기준). */
  origNote: { start: number; pitch: number; duration: number }
  startX: number
  startY: number
  type: 'move' | 'resize'
  /** threshold 초과 여부. false이면 pointerup 시 클릭으로 처리. */
  moved: boolean
}

export function PianoRoll() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const setProject = useStore((s) => s.setProject)
  const selectNote = useStore((s) => s.selectNote)
  const rollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)
  const grid = divisionToTicks(quantizeDenom, ppq)

  // ── 그리드 클릭: 노트 생성 (기존 동작, 변경 없음) ──────────────

  const handleGridPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // 노트/핸들 위 pointerdown은 stopPropagation으로 여기 도달하지 않음.
    // Belt-and-suspenders: e.target !== e.currentTarget 가드도 유지.
    if (e.target !== e.currentTarget) return
    const rect = rollRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const start = Math.max(0, snap(xToTick(x, ppq), grid))
    const pitch = yToPitch(y)
    const note = createNote({ pitch, start, duration: grid || ppq, velocity: 96 })
    setProject(addNote(project, selectedTrackId, note))
    selectNote(note.id)
  }

  // ── Delete / Backspace: 노트 삭제 (기존 동작, 변경 없음) ────────

  const handleKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId) {
      setProject(removeNote(project, selectedTrackId, selectedNoteId))
      selectNote(null)
    }
  }

  // ── 드래그 시작: 노트 본체 ────────────────────────────────────────

  const handleNotePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    // stopPropagation: 컨테이너의 handleGridPointerDown 이 실행되지 않도록.
    e.stopPropagation()
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'move',
      moved: false,
    }
    // setPointerCapture: 포인터가 노트 밖으로 나가도 pointermove/up 이 노트 → 컨테이너로 버블링됨.
    // jsdom 미지원 시 try/catch로 무시; 컨테이너 onPointerMove 직접 발사로 대체 가능.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 드래그 시작: 리사이즈 핸들 ──────────────────────────────────

  const handleResizePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    // stopPropagation: 노트 div의 handleNotePointerDown 이 실행되지 않도록.
    e.stopPropagation()
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'resize',
      moved: false,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 드래그 진행: 컨테이너 pointermove ────────────────────────────
  //
  // 노트/핸들이 setPointerCapture로 포인터를 잡으면 pointermove 는 해당 요소로 디스패치되고,
  // DOM 버블링으로 컨테이너까지 올라온다. jsdom에서는 container에 직접 발사한다.

  const handleContainerPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

    dragRef.current.moved = true
    const { noteId, origNote, type } = dragRef.current

    // stale 클로저 방지: 항상 스토어에서 최신 project 를 읽는다.
    const currentProject = useStore.getState().project

    if (type === 'move') {
      const patch = computeMove(
        origNote,
        pxToTicks(dx, ppq),
        pxToSemitones(dy, LANE_HEIGHT),
        grid,
      )
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    } else {
      const patch = computeResize(origNote, pxToTicks(dx, ppq), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    }
  }

  // ── 드래그 종료: 컨테이너 pointerup ──────────────────────────────

  const handleContainerPointerUp = (_e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    // threshold 미만(클릭) → 노트 선택
    if (!dragRef.current.moved) {
      selectNote(dragRef.current.noteId)
    }
    dragRef.current = null
  }

  return (
    <div
      ref={rollRef}
      data-testid="pianoroll"
      tabIndex={0}
      onPointerDown={handleGridPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        height: rollHeight(),
        minWidth: '100%',
        outline: 'none',
        backgroundColor: 'var(--bg-inset)',
        backgroundImage:
          `repeating-linear-gradient(0deg, transparent 0 ${LANE_HEIGHT - 1}px, rgba(255,255,255,.03) ${LANE_HEIGHT - 1}px ${LANE_HEIGHT}px),` +
          `repeating-linear-gradient(90deg, transparent 0 ${PX_PER_BEAT - 1}px, rgba(255,255,255,.05) ${PX_PER_BEAT - 1}px ${PX_PER_BEAT}px)`,
      }}
    >
      {track?.notes.map((n) => (
        <div
          key={n.id}
          data-testid="note"
          onPointerDown={(e) => handleNotePointerDown(e, n)}
          style={{
            position: 'absolute',
            left: tickToX(n.start, ppq),
            top: pitchToY(n.pitch),
            width: Math.max(4, durationToWidth(n.duration, ppq)),
            height: NOTE_HEIGHT,
            borderRadius: 4,
            cursor: 'grab',
            overflow: 'hidden',
            background: n.id === selectedNoteId ? 'var(--accent-deep)' : 'var(--accent)',
            boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}
        >
          {/* 리사이즈 핸들: 노트 우측 끝 RESIZE_HANDLE_WIDTH px. overflow:hidden 으로 클립됨. */}
          <div
            data-testid="note-resize-handle"
            onPointerDown={(e) => handleResizePointerDown(e, n)}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: RESIZE_HANDLE_WIDTH,
              cursor: 'ew-resize',
            }}
          />
        </div>
      ))}
    </div>
  )
}
```

> **설계 노트(구현 서브에이전트용):**
>
> - `onClick` 은 노트 div에서 제거됐다. 선택은 `handleContainerPointerUp`(`!moved` 분기)에서 처리한다. `userEvent.click(note)`는 내부적으로 pointerdown+pointerup 순서를 발생시키므로 기존 `"노트 클릭 시 해당 노트가 선택된다"` 테스트는 그대로 통과한다.
> - `handleGridPointerDown`의 `e.target !== e.currentTarget` 가드는 제거하지 않는다. `stopPropagation`과 이중 방어.
> - `RMouseEvent` import 는 더 이상 사용하지 않으므로 제거한다.
> - `Note` type은 `import type { Note } from '@sculptone/score-model'`로 별도 import.
> - React 타입 네임스페이스(`React.PointerEvent` 등) 직접 사용 금지. 항상 `'react'`에서 named import 후 alias.

- [ ] **Step 4: 기존 테스트 포함 전체 통과 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll
```

Expected: 모든 PianoRoll 관련 테스트 PASS:
- `PianoRoll.test.tsx` 2개 (렌더·위치) — 변경 없음 ✓
- `PianoRoll.edit.test.tsx` 4개 (그리드 클릭 생성·노트 선택·Delete·Backspace 무효) ✓
- `PianoRoll.drag.test.tsx` 4개 (이동·리사이즈·클릭·노트 위 pointerdown 격리) ✓

**기존 edit 테스트 영향 분석:**
| 테스트 | 변경 전 | 변경 후 | 판정 |
|---|---|---|---|
| 빈 그리드 클릭 시 노트 생성 | userEvent.pointer on grid | grid onPointerDown (동일) | PASS |
| 노트 클릭 시 선택 | `onClick` | pointerup → `handleContainerPointerUp(!moved)` | PASS |
| Delete 키 삭제 | `handleKeyDown` on container | 동일(이동 없음) | PASS |
| 선택 없을 때 Backspace 무효 | 동일 | 동일 | PASS |

---

## Task 3: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 기존 | 신규 | 합계 |
|---|---|---|---|
| @sculptone/score-model | (유지) | 0 | — |
| @sculptone/sound-engine | (유지) | 0 | — |
| @sculptone/web | 439 | 26 | **465** |

신규 26개 내역:
- `drag.test.ts`: 22개 (pxToTicks 3, pxToSemitones 5, computeMove 8, computeResize 6)
- `PianoRoll.drag.test.tsx`: 4개 (이동·리사이즈·클릭·stopPropagation 격리)

> **기존 테스트 보존 체크리스트:**
> - `PianoRoll.test.tsx` 2개: 노트 렌더·위치 단언(style.left/top) — div 구조·스타일 동일 → **PASS**
> - `PianoRoll.edit.test.tsx` 4개: 위 분석 참조 → **PASS**
> - `geometry.test.ts`, `quantize.test.ts`: 파일 수정 없음 → **PASS**
> - `history.test.ts`, `history-store.test.ts`, `AppShell.test.tsx` 등: 파일 수정 없음 → **PASS**
> - `useRecording.test.ts`, `useAutosave.test.ts`, `MixerPanel.test.tsx` 등: 무관 → **PASS**

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음. 특히:
- `DragState` 인터페이스의 `origNote` 타입(`{ start, pitch, duration }`)이 `computeMove`/`computeResize` 인수(`{ start, pitch }` / `{ duration }`)의 서브타입 — 호환 ✓
- `updateNote` 패치 타입(`Partial<Omit<Note, 'id'>>`)에 `{ start, pitch }` 및 `{ duration }` 할당 가능 ✓
- `RMouseEvent` import 제거 → 남은 참조 없음 확인 ✓
- `Note` type import(`import type { Note } from '@sculptone/score-model'`) — 런타임 번들에 포함 안 됨 ✓

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `drag.ts`가 tree-shaking 대상 없이 번들에 포함됨.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과(기존 439개 보존 + 신규 26개, 합계 465개).
- `drag.ts`: `pxToTicks` / `pxToSemitones` / `computeMove` / `computeResize` — 22개 단위 테스트 통과.
- `computeMove` 경계: start >= 0, pitch ∈ [PITCH_LOW, PITCH_HIGH], gridTicks=0 자유 이동 — 자동 테스트 검증.
- `computeResize` 경계: duration >= gridTicks(>0) 또는 >=1, gridTicks=0 자유 리사이즈 — 자동 테스트 검증.
- PianoRoll 드래그: 노트 본체 드래그 → start 변화, 리사이즈 핸들 드래그 → duration 변화 — 스모크 테스트 검증.
- 클릭 vs 드래그 분기: threshold=3px 미만 포인터 이동 → selectNote(드래그 없음) — 스모크 테스트 검증.
- 기존 그리드 클릭=노트 생성, 노트 클릭=선택, Delete=삭제 동작 보존 — 기존 4개 PianoRoll.edit 테스트 통과.
- `note-resize-handle` div가 노트 div 내 우측 끝 6px에 절대 배치.
- 드래그 중 undo: 400ms 코얼레싱으로 전체 드래그가 ~1 undo 스텝 (추가 구현 불필요).
- React 타입 네임스페이스 미사용(`'react'`에서 alias import만).
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후)

- **좌측 리사이즈 핸들(시작점 이동):** 노트 좌측 끝 6px 핸들로 `start`와 `duration`을 동시에 조정 (`computeMoveResize` 함수 추가). 현 계획은 우측 끝만.
- **다중 노트 드래그/박스 선택:** 여러 노트를 동시에 이동. `selectedNoteIds: Set<string>` 추가 필요.
- **드래그 중 자동 스크롤:** 뷰포트 가장자리 근처에서 롤을 스크롤. RAF 기반 스크롤 로직.
- **인접 노트 스냅 가이드:** 드래그 중 다른 노트의 start/end에 스냅 가이드 표시.

---

## 열린 질문

1. **DRAG_THRESHOLD = 3px:** 마우스 드리프트(의도치 않은 미세 이동) vs 응답성 트레이드오프. 현재 3px. 터치 환경에서는 더 높은 값(8-10px)이 적합할 수 있다. `DRAG_THRESHOLD` 상수로 격리되어 조정 용이.

2. **피치 클램프 범위(PITCH_LOW..PITCH_HIGH):** 현재 롤이 PITCH_LOW(36)..PITCH_HIGH(84) 범위를 표시한다. 롤을 확장(더 많은 옥타브 표시)하면 이 상수를 업데이트해야 하며, `computeMove`의 클램프도 자동으로 반영된다.

3. **undo 코얼레싱 경계:** 드래그 종료(pointerup) 후 400ms 이내에 새 편집이 시작되면 두 번째 편집의 첫 `setProject`도 코얼레싱될 수 있다. 이는 두 별개의 드래그가 1 undo 스텝으로 합쳐지는 부작용. 현 설계에서 수용. 더 정밀한 제어가 필요하면 `undo()` 호출 시 `_lastEditAt=0` 리셋이 이미 구현되어 있어 undo 후 첫 편집은 항상 새 스텝이 된다.

4. **jsdom에서 `setPointerCapture` 없는 경우 주의:** 브라우저에서는 캡처로 포인터가 노트 div에 고정되어 노트 외부에서도 pointermove/up이 동작한다. jsdom에서는 캡처 없이도 컨테이너 div의 핸들러가 직접 이벤트를 받아 동작한다. 단, jsdom 스모크 테스트에서 `fireEvent.pointerMove`를 노트 div에 발사하면(컨테이너 대신) 버블링으로 컨테이너까지 전달되므로 여전히 동작한다.

5. **리사이즈 핸들 overflow:** `NOTE_HEIGHT=16px`, 최소 노트 너비 `Math.max(4, ...)=4px`인 경우 핸들(6px)이 노트보다 넓다. 노트 div에 `overflow: 'hidden'`을 설정해 핸들을 클립했다. 매우 짧은 노트(< 6px)는 사실상 전체가 리사이즈 핸들이 된다 — 이동 드래그가 불가능. 수용 가능. 최소 노트 너비를 12px 이상으로 높이거나, 핸들 너비를 `Math.min(6, noteWidth/2)`로 동적 조정하면 해소된다.

6. **origNote 스냅샷 vs 최신 노트 참조:** 현 설계는 `origNote`를 드래그 시작 시 캡처하고 매 pointermove마다 origNote + 전체 델타로 계산한다. 만약 드래그 중 외부에서 같은 노트를 편집하면(협업 시나리오) origNote가 outdated될 수 있다. 단일 사용자 로컬 편집 환경에서는 문제없다.
