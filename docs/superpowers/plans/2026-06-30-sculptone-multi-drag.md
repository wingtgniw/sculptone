# Sculptone 멀티노트 동시 이동 (Group Drag) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤에서 다중 선택된 노트들을 한 번의 드래그로 동시에 이동한다. 수평=시간(틱, grid 스냅), 수직=음정(pitch 반음). 기존 단일 드래그·리사이즈·박스선택·Shift토글·Delete 동작을 완전히 보존한다.

**Architecture:** 순수 함수 분리 원칙을 유지한다. `score-model/operations.ts`에 불변 배치 연산 `moveNotes`를 추가하고, `drag.ts`에 그룹 델타·클램프 계산 순수 함수 `computeGroupMove`를 추가한다. `PianoRoll.tsx`의 `DragState`에 `group-move` 타입과 `origNotes` 스냅샷 필드를 추가해 멀티 드래그 경로를 배선한다. **매 pointermove는 grab 시점 `origNotes` 스냅샷 + 총 델타의 절대 적용** — 기존 단일 드래그와 동일한 원칙, 누적 오차 없음.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `apps/web/src/state/store.ts` — `selectedNoteIds: string[]`, `toggleNoteSelection`, `setSelectedNoteIds`, `clearNoteSelection`, `endEdit`
> - `apps/web/src/compose/selection.ts` — `notesInRect` (박스선택용)
> - `apps/web/src/compose/PianoRoll.tsx` — 기존 단일 이동·리사이즈·박스선택·Shift토글·Delete 구현
> - `apps/web/src/compose/drag.ts` — `pxToTicks`, `pxToSemitones`, `computeMove`, `computeResize`

---

## 비목표 (이 계획에서 하지 말 것)

- **다중 리사이즈** — 리사이즈는 잡은 단일 노트만 유지(기존 그대로)
- **트랙 간 드래그** — 단일 트랙 내 이동만
- **Alt+drag 복사-드래그** — 복사는 별도 증분
- **스냅 옵션 변경 UI** — 기존 quantizeDenom 그대로
- **협업·백엔드**
- **인프라 파일 변경** (`.github/`, 루트 설정, eslint/prettier)

---

## 설계 근거

### 절대값 계산 원칙 (누적 방지)

기존 단일 드래그 구현 코드를 확인한 결과:

```ts
// handleNotePointerDown: grab 시 스냅샷 저장
dragRef.current = {
  origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
  startX: e.clientX, startY: e.clientY, ...
}

// handleContainerPointerMove: 매 move는 grab 기준 총 델타로 절대값 계산
const dx = e.clientX - dragRef.current.startX   // 총 델타 (증분 아님)
computeMove(origNote, pxToTicks(dx, ppq), ...)  // origNote 스냅샷 기준 절대 계산
updateNote(currentProject, ..., { start: newAbsoluteStart })  // 절대 위치 설정
```

따라서 단일 드래그는 `origNote` 스냅샷에서 매 move마다 전체 dx를 적용하는 절대값 방식이다. 멀티 드래그도 동일 원칙을 따른다:

- grab 시 **선택된 모든 노트의 start/pitch를 스냅샷**(`origNotes: Map<string, {start, pitch}>`)
- 매 move는 `origNotes` + 현재 총 델타로 **각 노트의 절대 새 위치** 계산
- `updateNote(project, trackId, id, { start: orig.start + tickDelta, pitch: orig.pitch + pitchDelta })` 루프

### moveNotes vs updateNote 루프

`moveNotes(project, trackId, ids, tickDelta, pitchDelta)`는 `note.start += tickDelta`를 적용하는 배치 연산이다. 이를 드래그 경로에서 `currentProject`에 직접 적용하면 이전 move가 이미 반영된 위치에 또 더하는 **누적이 발생**한다.

따라서:
- **drag preview 경로**: `origNotes` 스냅샷 + 절대 위치를 `updateNote` 루프로 적용 (누적 없음)
- **`moveNotes` 용도**: score-model 계층의 범용 배치 연산. 드래그 외 컨텍스트(예: "선택 구간 1마디 이동" 메뉴 액션, 향후 MIDI 퀀타이즈 등)에서 활용.

### group-move 분기 조건

`handleNotePointerDown`에서:

| 조건 | 동작 |
|------|------|
| `e.shiftKey === true` | `toggleNoteSelection` (기존, 변경 없음) |
| `selectedSet.has(note.id) && selectedNoteIds.length > 1` | group-move 드래그 시작 (신규) |
| 그 외 (미선택 또는 단일 선택) | `selectNote(note.id)` + 단일 이동 드래그 (기존, 변경 없음) |

group-move 시 `selectNote`를 호출하지 않아 `selectedNoteIds`(다중 선택)가 유지된다.

pointerup 시:
- `moved=true` → `endEdit()` + dragRef 클리어. 선택 유지(`selectNote` 호출 안 함).
- `moved=false` (threshold 미만 = 클릭) → `selectNote(noteId)` → 단일 선택으로 전환.

### computeGroupMove 스냅 규칙

단일 드래그의 `computeMove`는 최종 위치를 스냅한다: `snap(note.start + deltaTicks, grid)`. 그룹 드래그에서는 **델타 자체를 스냅**한다: `snap(rawTickDelta, grid)`. 이 방식은 그룹이 grid 배수 단위로 이동함을 보장해 모든 노트가 균일하게 움직인다.

트레이드오프: 개별 노트가 grid-aligned position으로 스냅되지 않을 수 있다(노트가 원래 off-grid인 경우). DAW 표준 동작(grab 노트 기준 최종 위치 스냅)과는 미묘하게 다르다. 현재 구현에서는 delta 스냅이 더 단순하고 그룹 응집성을 유지하므로 채택한다.

### 그룹 클램프 범위

- **tick**: `start >= 0`. 그룹 내 최소 start가 0이 되는 선까지만 왼쪽 이동 허용.
  `tickDelta = max(snappedDelta, -minStart)` where `minStart = min(origNotes[*].start)`.
- **pitch**: schema 전체 범위 `0..127`. 단일 드래그의 `PITCH_LOW..PITCH_HIGH`(36..84, 가시 범위)와 다르다 — 그룹 이동은 schema 한계까지 허용.
  `pitchDelta` clamp: `[-minPitch, 127-maxPitch]`.

> **열린 질문**: 그룹 pitch 클램프를 `PITCH_LOW..PITCH_HIGH`로 제한해 가시 범위 내로 강제할지? 현재 계획은 0..127 사용. 향후 롤 스크롤 범위 확장 시 재검토.

### 리사이즈 핸들 + Shift — 변경 없음

`handleResizePointerDown`의 Shift 분기(`toggleNoteSelection`)와 단일 리사이즈 경로는 그대로 유지된다. group-move는 노트 본체(`handleNotePointerDown`)에서만 시작한다.

### DRAG_THRESHOLD — 변경 없음

기존 `DRAG_THRESHOLD = 3px` 동일하게 적용.

---

## File Structure

```
packages/score-model/src/
  operations.ts                   # MOD: moveNotes 추가

packages/score-model/test/
  operations.test.ts              # MOD: moveNotes 완전 TDD (~9개 추가)

apps/web/src/
  compose/
    drag.ts                       # MOD: computeGroupMove 추가
    PianoRoll.tsx                 # MOD: DragState 확장 + group-move 분기
    test/
      drag.test.ts                # MOD: computeGroupMove 완전 TDD (~9개 추가)
      PianoRoll.multi-drag.test.tsx # NEW: group-move 스모크 (~5개)
```

변경 없는 파일:
- `apps/web/src/state/store.ts` — 선택 상태 이미 구현됨
- `apps/web/src/compose/selection.ts` — 박스선택 helper 변경 없음
- `apps/web/src/compose/geometry.ts`, `quantize.ts`, `time.ts` — 변경 없음
- `apps/web/src/compose/test/PianoRoll.drag.test.tsx` — 기존 8개 PASS (단일 드래그 경로 불변)
- `apps/web/src/compose/test/PianoRoll.multiselect.test.tsx` — 기존 PASS (Shift토글·박스선택·Delete 불변)
- `packages/score-model/test/operations.test.ts` 기존 5개 — 기존 함수 변경 없음

---

## Task 1: score-model/operations.ts — moveNotes 배치 연산 (완전 TDD)

**Files:** Modify `packages/score-model/src/operations.ts`, Modify `packages/score-model/test/operations.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/score-model/test/operations.test.ts` 끝에 추가:

```ts
import { moveNotes } from '../src/operations'

// ── moveNotes ──────────────────────────────────────────────────

describe('moveNotes', () => {
  // 헬퍼: 트랙 + 노트를 가진 project 생성
  function makeProject() {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    const nA = createNote({ pitch: 60, start: 240, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    const nC = createNote({ pitch: 64, start: 0,   duration: 120, velocity: 90 })
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    p = addNote(p, t1.id, nA)
    p = addNote(p, t1.id, nB)
    p = addNote(p, t2.id, nC)
    return { p, t1, t2, nA, nB, nC }
  }

  it('빈 ids → project 완전 불변(동일 참조)', () => {
    const { p, t1 } = makeProject()
    const next = moveNotes(p, t1.id, [], 120, 1)
    // ids가 비어있으므로 어떤 노트도 변경되지 않음
    expect(next.tracks[0]!.notes[0]!.start).toBe(240)
    expect(next.tracks[0]!.notes[1]!.start).toBe(480)
  })

  it('단일 id 이동: tickDelta=120, pitchDelta=2 → 해당 노트만 변경', () => {
    const { p, t1, nA, nB } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 120, 2)
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    const moved = notes.find((n) => n.id === nA.id)!
    const untouched = notes.find((n) => n.id === nB.id)!
    expect(moved.start).toBe(240 + 120)   // 360
    expect(moved.pitch).toBe(60 + 2)      // 62
    expect(untouched.start).toBe(480)     // 변경 없음
    expect(untouched.pitch).toBe(62)
  })

  it('복수 id 이동: nA, nB 동시 이동 → 두 노트 모두 변경', () => {
    const { p, t1, nA, nB } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id, nB.id], 240, -1)
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nA.id)!.start).toBe(480)
    expect(notes.find((n) => n.id === nA.id)!.pitch).toBe(59)
    expect(notes.find((n) => n.id === nB.id)!.start).toBe(720)
    expect(notes.find((n) => n.id === nB.id)!.pitch).toBe(61)
  })

  it('다른 트랙의 노트는 변경되지 않는다', () => {
    const { p, t1, t2, nA, nC } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 120, 0)
    const t2Notes = next.tracks.find((t) => t.id === t2.id)!.notes
    expect(t2Notes.find((n) => n.id === nC.id)!.start).toBe(0)  // 변경 없음
  })

  it('불변성: 원본 project가 변경되지 않는다', () => {
    const { p, t1, nA } = makeProject()
    const origStart = p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start
    moveNotes(p, t1.id, [nA.id], 9999, 9999)
    expect(p.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.start).toBe(origStart)
  })

  it('방어적 start 클램프: tickDelta가 너무 음수여도 start >= 0', () => {
    const { p, t1, nA } = makeProject() // nA.start = 240
    const next = moveNotes(p, t1.id, [nA.id], -9999, 0)
    const moved = next.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.start).toBeGreaterThanOrEqual(0)
  })

  it('방어적 pitch 클램프: pitch 0 미만 → 0, 127 초과 → 127', () => {
    const { p, t1, nA } = makeProject() // nA.pitch = 60
    const tooLow = moveNotes(p, t1.id, [nA.id], 0, -9999)
    expect(tooLow.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.pitch).toBe(0)
    const tooHigh = moveNotes(p, t1.id, [nA.id], 0, 9999)
    expect(tooHigh.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!.pitch).toBe(127)
  })

  it('ids에 없는 id는 무시된다 (일부 매칭)', () => {
    const { p, t1, nA } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id, 'no-such-id'], 120, 0)
    // nA는 이동, nB는 unchanged, no-such-id는 무시
    const notes = next.tracks.find((t) => t.id === t1.id)!.notes
    expect(notes.find((n) => n.id === nA.id)!.start).toBe(360)
    expect(notes.find((n) => n.id === nA.id)!.pitch).toBe(60)
  })

  it('tickDelta=0, pitchDelta=0 → 노트값 변경 없음(pitch·start 동일)', () => {
    const { p, t1, nA } = makeProject()
    const next = moveNotes(p, t1.id, [nA.id], 0, 0)
    const moved = next.tracks.find((t) => t.id === t1.id)!.notes.find((n) => n.id === nA.id)!
    expect(moved.start).toBe(240)
    expect(moved.pitch).toBe(60)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/score-model test -- operations.test
```

Expected: FAIL — `moveNotes` 없음.

- [ ] **Step 3: operations.ts에 moveNotes 추가**

`packages/score-model/src/operations.ts` 파일 끝에 추가:

```ts
/**
 * 지정 트랙에서 ids에 포함된 노트들을 이동한다 (불변).
 *
 * - start += tickDelta  (방어적 클램프: max(0, ...))
 * - pitch += pitchDelta (방어적 클램프: 0..127)
 * - ids에 없는 노트·다른 트랙은 변경하지 않는다.
 * - 호출측이 computeGroupMove로 적절한 범위의 delta를 보장해야 한다.
 *   방어적 클램프는 잘못된 호출에 대한 안전망.
 *
 * **drag preview 경로에서는 사용하지 말 것.**
 * 드래그 경로는 origNotes 스냅샷 + updateNote 루프로 절대 위치를 적용한다.
 * 이 함수는 드래그 외 배치 조작(메뉴 액션, 테스트 픽스처 등)에서 사용한다.
 */
export function moveNotes(
  p: Project,
  trackId: string,
  ids: string[],
  tickDelta: number,
  pitchDelta: number,
): Project {
  if (ids.length === 0) return p
  const idSet = new Set(ids)
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      idSet.has(n.id)
        ? {
            ...n,
            start: Math.max(0, n.start + tickDelta),
            pitch: Math.min(127, Math.max(0, n.pitch + pitchDelta)),
          }
        : n,
    ),
  }))
}
```

> **구현 노트**: `ids.length === 0` early return으로 빈 배열 시 project를 완전 불변으로 반환한다(새 객체도 만들지 않음). `idSet = new Set(ids)` 로 O(1) 조회.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/score-model test -- operations.test
```

Expected: 기존 5개 + 신규 moveNotes 9개 = **14개** PASS.

---

## Task 2: compose/drag.ts — computeGroupMove 순수 함수 (완전 TDD)

**Files:** Modify `apps/web/src/compose/drag.ts`, Modify `apps/web/src/compose/test/drag.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`apps/web/src/compose/test/drag.test.ts` 끝에 추가:

```ts
import { computeGroupMove } from '../drag'

// ── computeGroupMove ──────────────────────────────────────────

describe('computeGroupMove', () => {
  const GRID = 120 // divisionToTicks(16, 480)

  // ── 빈 배열 ────────────────────────────────────────────────

  it('빈 originNotes → { tickDelta:0, pitchDelta:0 }', () => {
    const r = computeGroupMove([], 500, 3, GRID)
    expect(r.tickDelta).toBe(0)
    expect(r.pitchDelta).toBe(0)
  })

  // ── 틱 스냅 ────────────────────────────────────────────────

  it('rawTickDelta=130, grid=120 → snap(130,120)=120 → tickDelta=120', () => {
    const notes = [{ start: 240, pitch: 60 }]
    // snap(130, 120) = round(130/120)*120 = round(1.083)*120 = 1*120 = 120
    const r = computeGroupMove(notes, 130, 0, GRID)
    expect(r.tickDelta).toBe(120)
  })

  it('rawTickDelta=180(1.5 grid) → snap(180,120)=240 (round-half-up)', () => {
    // snap(180, 120) = round(1.5)*120 = 2*120 = 240
    const notes = [{ start: 0, pitch: 60 }]
    const r = computeGroupMove(notes, 180, 0, GRID)
    expect(r.tickDelta).toBe(240)
  })

  it('gridTicks=0: 스냅 없이 rawTickDelta 그대로', () => {
    const notes = [{ start: 240, pitch: 60 }]
    const r = computeGroupMove(notes, 77, 0, 0)
    expect(r.tickDelta).toBe(77)
  })

  // ── tick 그룹 클램프 ────────────────────────────────────────

  it('start=0 노트 포함: 음수 tickDelta 불가(클램프)', () => {
    const notes = [
      { start: 0,   pitch: 60 },
      { start: 480, pitch: 62 },
    ]
    // rawTickDelta=-120, snap(-120,120)=-120 → max(-120, -0) = 0
    const r = computeGroupMove(notes, -120, 0, GRID)
    expect(r.tickDelta).toBe(0)
  })

  it('start=240 최소: tickDelta >= -240 (왼쪽으로 최대 240틱)', () => {
    const notes = [
      { start: 240, pitch: 60 },
      { start: 960, pitch: 62 },
    ]
    // rawTickDelta=-9999, snap=-9999/0=-…, max(snap, -240)=-240 (grid=0로 테스트)
    const r = computeGroupMove(notes, -9999, 0, 0)
    expect(r.tickDelta).toBe(-240)
  })

  // ── pitch 그룹 클램프 ───────────────────────────────────────

  it('pitch=0 노트 포함: 음수 pitchDelta 불가(클램프)', () => {
    const notes = [
      { start: 0, pitch: 0 },
      { start: 0, pitch: 60 },
    ]
    const r = computeGroupMove(notes, 0, -5, GRID)
    expect(r.pitchDelta).toBe(0)
  })

  it('pitch=127 노트 포함: 양수 pitchDelta 불가(클램프)', () => {
    const notes = [
      { start: 0, pitch: 60 },
      { start: 0, pitch: 127 },
    ]
    const r = computeGroupMove(notes, 0, 3, GRID)
    expect(r.pitchDelta).toBe(0)
  })

  it('pitchDelta 클램프: minPitch=36, maxPitch=84 → delta range -36..43', () => {
    const notes = [
      { start: 0, pitch: 36 },
      { start: 0, pitch: 84 },
    ]
    // max delta = 127-84=43, min delta = -36
    const rUp = computeGroupMove(notes, 0, 50, GRID)
    expect(rUp.pitchDelta).toBe(43)  // 클램프
    const rDown = computeGroupMove(notes, 0, -50, GRID)
    expect(rDown.pitchDelta).toBe(-36)  // 클램프
    const rOk = computeGroupMove(notes, 0, 10, GRID)
    expect(rOk.pitchDelta).toBe(10)   // 클램프 없음
  })

  // ── 통합: tick + pitch 동시 ─────────────────────────────────

  it('tick과 pitch 동시 이동 및 클램프', () => {
    const notes = [
      { start: 120, pitch: 60 },
      { start: 240, pitch: 70 },
    ]
    // rawTickDelta=130 → snap=120, clamp max(-120, -120)=-120 실제 minStart=120이므로 OK
    // rawPitchDelta=-100 → clamp(-100, -60, 127-70=57) → -60
    const r = computeGroupMove(notes, 130, -100, GRID)
    expect(r.tickDelta).toBe(120)
    expect(r.pitchDelta).toBe(-60)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- drag.test
```

Expected: FAIL — `computeGroupMove` 없음.

- [ ] **Step 3: drag.ts에 computeGroupMove 추가**

`apps/web/src/compose/drag.ts` 끝에 추가:

```ts
/**
 * 그룹 이동 드래그: 선택 노트 전체에 적용할 { tickDelta, pitchDelta }를 계산한다.
 *
 * **스냅**: rawTickDelta를 grid 단위로 스냅(delta 자체를 스냅 → 그룹이 grid 배수로 이동).
 *           gridTicks <= 0 이면 스냅 없음.
 * **그룹 클램프**:
 *   - tick: 모든 노트의 start >= 0 보장 → tickDelta >= -min(originNotes[*].start)
 *   - pitch: 0..127 범위 → pitchDelta ∈ [-minPitch, 127-maxPitch]
 * **빈 배열**: { tickDelta:0, pitchDelta:0 } 반환.
 *
 * 호출측(PianoRoll)에서 이 함수의 반환값으로 각 노트의 새 위치를
 * origNotes[id].start + tickDelta, origNotes[id].pitch + pitchDelta 로 절대 계산한다.
 */
export function computeGroupMove(
  originNotes: ReadonlyArray<{ start: number; pitch: number }>,
  rawTickDelta: number,
  rawPitchDelta: number,
  gridTicks: number,
): { tickDelta: number; pitchDelta: number } {
  if (originNotes.length === 0) return { tickDelta: 0, pitchDelta: 0 }

  // tick: delta를 grid로 스냅, 그룹 클램프
  const snappedTick = snap(rawTickDelta, gridTicks)
  const minStart = Math.min(...originNotes.map((n) => n.start))
  const tickDelta = Math.max(snappedTick, -minStart)

  // pitch: 스냅 없음(반음 단위 정수), 그룹 클램프
  const minPitch = Math.min(...originNotes.map((n) => n.pitch))
  const maxPitch = Math.max(...originNotes.map((n) => n.pitch))
  const pitchDelta = Math.min(127 - maxPitch, Math.max(-minPitch, rawPitchDelta))

  return { tickDelta, pitchDelta }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- drag.test
```

Expected: 기존 drag.test 16개 PASS(computeMove·computeResize·pxToTicks·pxToSemitones 변경 없음) + 신규 computeGroupMove 9개 = **25개** PASS.

---

## Task 3: PianoRoll.tsx — group-move 배선 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/compose/PianoRoll.tsx`, Create `apps/web/src/compose/test/PianoRoll.multi-drag.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/PianoRoll.multi-drag.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, act } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

/**
 * jsdom 25: PointerEvent.clientX / shiftKey 는 read-only.
 * Object.defineProperty로 주입. (PianoRoll.drag.test.tsx + PianoRoll.multiselect.test.tsx 패턴 통합)
 */
function firePointerEvent(
  el: Element,
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number; shiftKey?: boolean } = {},
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  if (opts.clientX !== undefined)
    Object.defineProperty(e, 'clientX', { value: opts.clientX, configurable: true })
  if (opts.clientY !== undefined)
    Object.defineProperty(e, 'clientY', { value: opts.clientY, configurable: true })
  if (opts.pointerId !== undefined)
    Object.defineProperty(e, 'pointerId', { value: opts.pointerId, configurable: true })
  if (opts.shiftKey !== undefined)
    Object.defineProperty(e, 'shiftKey', { value: opts.shiftKey, configurable: true })
  el.dispatchEvent(e)
}

describe('PianoRoll group-move smoke', () => {
  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    // nA: start=0, pitch=60 / nB: start=480, pitch=62
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 480, velocity: 100 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, tid, nA)
    p = addNote(p, tid, nB)
    s.setProject(p)
    // 두 노트 모두 선택 (group-move 조건)
    act(() => { s.setSelectedNoteIds([nA.id, nB.id]) })
  })

  // ── 핵심: 두 노트 동시 이동 ─────────────────────────────────

  it('group-move: threshold 초과 드래그 시 두 노트 모두 start가 증가한다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    // nA를 잡고 오른쪽으로 dx=100px 드래그
    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const nA = track.notes.find((n) => n.id === noteAId)!
    const nB = track.notes.find((n) => n.id === noteBId)!

    // 두 노트 모두 오른쪽으로 이동
    expect(nA.start).toBeGreaterThan(0)
    expect(nB.start).toBeGreaterThan(480)
    // 상대 오프셋 보존: nB.start - nA.start == 480
    expect(nB.start - nA.start).toBe(480)
  })

  // ── 누적 없음 (절대 계산 검증) ──────────────────────────────

  it('group-move: 같은 clientX에서 두 번째 move는 첫 번째와 동일 결과 (누적 없음)', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    let startAfterFirstMove: number
    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
    })
    startAfterFirstMove = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.start

    act(() => {
      // 같은 clientX=110에서 한 번 더 move
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const startAfterSecondMove = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.start

    // 누적이 없으면 두 move의 결과가 동일해야 함
    expect(startAfterSecondMove).toBe(startAfterFirstMove)
  })

  // ── 드래그 후 다중 선택 유지 ────────────────────────────────

  it('group-move 완료 후 selectedNoteIds가 유지된다', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 110, clientY: 200 })
      firePointerEvent(container, 'pointerup', { clientX: 110, clientY: 200 })
    })

    const s = useStore.getState()
    expect(s.selectedNoteIds).toContain(noteAId)
    expect(s.selectedNoteIds).toContain(noteBId)
    expect(s.selectedNoteIds).toHaveLength(2)
  })

  // ── 클릭(threshold 미만)은 단일 선택으로 전환 ───────────────

  it('group-move click (threshold 미만): 클릭 노트로 단일 선택 전환', () => {
    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')

    act(() => {
      firePointerEvent(notes[0]!, 'pointerdown', { clientX: 10, clientY: 200 })
      firePointerEvent(container, 'pointermove', { clientX: 11, clientY: 200 }) // dx=1 < threshold=3
      firePointerEvent(container, 'pointerup', { clientX: 11, clientY: 200 })
    })

    const s = useStore.getState()
    // moved=false → selectNote(noteAId) → 단일 선택
    expect(s.selectedNoteId).toBe(noteAId)
    expect(s.selectedNoteIds).toEqual([noteAId])
  })

  // ── 미선택 노트 드래그 → 기존 단일 경로 (회귀) ──────────────

  it('미선택 노트 드래그: 기존 단일 이동 경로, A·B는 그대로', () => {
    let noteCId: string
    act(() => {
      const s = useStore.getState()
      const nC = createNote({ pitch: 64, start: 960, duration: 480, velocity: 100 })
      noteCId = nC.id
      s.setProject(addNote(s.project, s.selectedTrackId, nC))
      // A, B는 선택 유지, C는 미선택
    })

    render(<PianoRoll />)
    const notes = screen.getAllByTestId('note')
    const container = screen.getByTestId('pianoroll')
    // notes[2] = nC (추가 순서 기준)
    const noteElC = notes[2]!

    act(() => {
      firePointerEvent(noteElC, 'pointerdown', { clientX: 100, clientY: 100 })
      firePointerEvent(container, 'pointermove', { clientX: 200, clientY: 100 })
      firePointerEvent(container, 'pointerup', { clientX: 200, clientY: 100 })
    })

    // C가 단일 선택됨 (A, B 선택 해제)
    const s = useStore.getState()
    expect(s.selectedNoteId).toBe(noteCId)
    expect(s.selectedNoteIds).toEqual([noteCId])

    // A, B는 이동하지 않음
    const tid = s.selectedTrackId
    const track = s.project.tracks.find((t) => t.id === tid)!
    expect(track.notes.find((n) => n.id === noteAId)!.start).toBe(0)
    expect(track.notes.find((n) => n.id === noteBId)!.start).toBe(480)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll.multi-drag
```

Expected: FAIL — group-move 분기 없음.

- [ ] **Step 3: PianoRoll.tsx 수정 (레퍼런스 구현)**

**3a) import 추가** — `computeGroupMove`를 drag.ts에서 named import:

기존 `import { pxToTicks, pxToSemitones, computeMove, computeResize } from './drag'` 를:
```ts
import { pxToTicks, pxToSemitones, computeMove, computeResize, computeGroupMove } from './drag'
```

**3b) DragState 인터페이스 확장** — `origNotes` 필드와 `'group-move'` 타입 추가:

기존 `DragState` 인터페이스를:
```ts
interface DragState {
  noteId: string
  /** 드래그 시작 시 note 값의 스냅샷 (절댓값 계산 기준). */
  origNote: { start: number; pitch: number; duration: number }
  /**
   * group-move 전용: grab 시점에 선택된 모든 노트의 start·pitch 스냅샷.
   * id → { start, pitch }. 매 pointermove는 이 스냅샷 + 총 델타로 절대 위치 계산.
   */
  origNotes?: Map<string, { start: number; pitch: number }>
  startX: number
  startY: number
  type: 'move' | 'resize' | 'group-move'
  /** threshold 초과 여부. false이면 pointerup 시 클릭으로 처리. */
  moved: boolean
}
```

**3c) `handleNotePointerDown` 수정** — Shift 분기 이후, 단일 이동 이전에 group-move 분기 삽입:

기존:
```ts
  const handleNotePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    e.stopPropagation()

    // Shift+클릭: 토글 선택 (드래그 없음) — selectNote 호출 이전에 분기
    if (e.shiftKey) {
      toggleNoteSelection(note.id)
      return
    }

    // Fix #1: pointerdown 즉시 선택 — 드래그 후 Delete가 올바른 노트를 삭제하도록.
    selectNote(note.id)
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'move',
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }
```

교체:
```ts
  const handleNotePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    e.stopPropagation()

    // Shift+클릭: 토글 선택 (기존, 변경 없음)
    if (e.shiftKey) {
      toggleNoteSelection(note.id)
      return
    }

    // group-move: 잡은 노트가 다중 선택 집합에 포함 → 그룹 드래그 시작
    if (selectedSet.has(note.id) && selectedNoteIds.length > 1) {
      // selectNote 호출 안 함 — selectedNoteIds(다중 선택)를 유지한다.
      // grab 시점의 모든 선택 노트 start·pitch 스냅샷 (절대 계산 기준)
      const snapshot = new Map<string, { start: number; pitch: number }>()
      for (const id of selectedNoteIds) {
        const n = track?.notes.find((nn) => nn.id === id)
        if (n) snapshot.set(id, { start: n.start, pitch: n.pitch })
      }
      dragRef.current = {
        noteId: note.id,
        origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
        origNotes: snapshot,
        startX: e.clientX,
        startY: e.clientY,
        type: 'group-move',
        moved: false,
      }
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
      return
    }

    // 기존: 단일 선택 + 이동 드래그 (변경 없음)
    // Fix #1: pointerdown 즉시 선택 — 드래그 후 Delete가 올바른 노트를 삭제하도록.
    selectNote(note.id)
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'move',
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }
```

**3d) `handleContainerPointerMove` 수정** — 기존 `if (type === 'move')` 분기 이후에 `'group-move'` 분기 추가:

기존 move 처리 블록:
```ts
    if (type === 'move') {
      const patch = computeMove(origNote, pxToTicks(dx, ppq), pxToSemitones(dy, LANE_HEIGHT), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    } else {
      const patch = computeResize(origNote, pxToTicks(dx, ppq), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    }
```

교체:
```ts
    if (type === 'group-move') {
      // 그룹 이동: origNotes 스냅샷 + 절대 위치 계산 (누적 없음)
      const { origNotes } = dragRef.current
      const originArr = Array.from(origNotes!.values())
      const { tickDelta, pitchDelta } = computeGroupMove(
        originArr,
        pxToTicks(dx, ppq),
        pxToSemitones(dy, LANE_HEIGHT),
        grid,
      )
      let p = currentProject
      for (const [id, orig] of origNotes!) {
        p = updateNote(p, selectedTrackId, id, {
          start: orig.start + tickDelta,
          pitch: orig.pitch + pitchDelta,
        })
      }
      setProject(p)
    } else if (type === 'move') {
      const patch = computeMove(origNote, pxToTicks(dx, ppq), pxToSemitones(dy, LANE_HEIGHT), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    } else {
      // type === 'resize'
      const patch = computeResize(origNote, pxToTicks(dx, ppq), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    }
```

**3e) `handleContainerPointerUp` 수정** — group-move 시 `!moved` 클릭 처리:

기존 `!dragRef.current.moved` 분기:
```ts
    // threshold 미만(클릭) → 노트 선택 (Fix #1로 pointerdown에서 이미 선택되지만 click 경로 보존)
    if (!dragRef.current.moved) {
      selectNote(dragRef.current.noteId)
    }
```

교체:
```ts
    if (!dragRef.current.moved) {
      // threshold 미만 = 클릭:
      // - 단일 드래그: Fix #1로 pointerdown에서 이미 선택됨, 재확인용
      // - group-move 클릭: selectNote로 단일 선택으로 전환 (다중 선택 해제)
      selectNote(dragRef.current.noteId)
    }
    // moved=true이고 type==='group-move' 인 경우: selectNote 호출 안 함 → 다중 선택 유지
```

> **설계 노트**: `endEdit()`은 이미 `handleContainerPointerUp`의 box-select 분기 이후, dragRef 체크 이전에 호출된다. group-move의 undo 스텝 마감도 이 경로로 처리된다(추가 구현 불필요).

- [ ] **Step 4: 전체 PianoRoll 테스트 통과 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll
```

Expected:
- `PianoRoll.test.tsx` 기존 2개 PASS (렌더·위치 — 변경 없음)
- `PianoRoll.edit.test.tsx` 기존 4개 PASS (생성·선택·Delete — 변경 없음)
- `PianoRoll.drag.test.tsx` 기존 8개 PASS (단일 드래그 경로 불변)
- `PianoRoll.multiselect.test.tsx` 기존 PASS (Shift토글·박스선택·Delete 불변)
- `PianoRoll.multi-drag.test.tsx` 신규 5개 PASS

**기존 드래그 테스트 회귀 분석:**

| 기존 테스트 | group-move 분기 조건 | 판정 |
|---|---|---|
| 노트 본체 드래그(threshold 초과) | `selectedNoteIds=[noteId]`(1개) → 단일 경로 | PASS |
| 리사이즈 핸들 드래그 | `handleResizePointerDown`(group-move 분기 없음) | PASS |
| 3px 미만 클릭 | `selectedNoteIds=[noteId]`(1개) → 단일 경로 | PASS |
| 노트 위 pointerdown stopPropagation | Shift 없음 + 단일선택 → 단일 경로 | PASS |
| Fix #1: A 선택 후 B 드래그 | B는 미선택 → 단일 경로(selectNote(B)) | PASS |
| Fix #2: 좁은 핸들 폭 | 리사이즈 핸들 — 변경 없음 | PASS |
| Fix #3: endEdit undo 분리 | endEdit 경로 동일 | PASS |
| Fix #5: pointercancel | handleDragRelease — 변경 없음 | PASS |
| Fix #6: 수직 드래그 pitch | `selectedNoteIds=[noteId]`(1개) → 단일 경로 | PASS |

**multiselect 테스트 회귀 분석:**

| 기존 테스트 | group-move 분기 영향 | 판정 |
|---|---|---|
| Shift+클릭 토글 | `e.shiftKey=true` → 최우선 분기, group-move 미진입 | PASS |
| Delete 다중 삭제 | keyDown 이벤트 — 드래그 경로와 무관 | PASS |
| Delete 없을 때 no-op | 동일 | PASS |
| Shift+이미선택 토글(제거) | `e.shiftKey=true` 분기 | PASS |
| 박스 선택 | `handleGridPointerDown`(boxSelRef) — 변경 없음 | PASS |
| 일반 클릭 단일 선택 | `selectedNoteIds=[A,B]`이지만 no-shift → group-move 조건 체크 → `selectedSet.has(note.id)&&length>1` 이면 group-move 시작. pointerup(dx=0 < threshold) → `selectNote(A)` | PASS (단일화 = 기대 동작) |

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
| `@sculptone/score-model` | (기존 유지) | 9 (moveNotes) | +9 |
| `@sculptone/sound-engine` | (기존 유지) | 0 | — |
| `@sculptone/web` | (기존 유지) | 9+5=14 (computeGroupMove+multi-drag) | +14 |

신규 23개 내역:
- `operations.test.ts`: moveNotes 9개
- `drag.test.ts`: computeGroupMove 9개
- `PianoRoll.multi-drag.test.tsx`: group-move 스모크 5개

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/score-model exec tsc --noEmit
```

Expected: 에러 없음. 특히:
- `DragState.origNotes?: Map<string, { start, pitch }>` — optional이므로 기존 `type: 'move'|'resize'` 생성 코드(`origNotes` 없음)가 타입 호환
- `dragRef.current.origNotes!` — `type === 'group-move'` 진입 시점엔 항상 설정되어 있음(논리적 보장). `!` 단언 사용
- `computeGroupMove` 반환값: `{ tickDelta: number; pitchDelta: number }` → `orig.start + tickDelta`는 `number` ✓
- `updateNote(p, trackId, id, { start: number, pitch: number })` — `Partial<Omit<Note,'id'>>` 호환 ✓
- `moveNotes` 반환 `Project` — operations.ts 기존 패턴과 동일 ✓
- React 타입 네임스페이스 미사용(`'react'`에서 named import만) ✓

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `computeGroupMove`, `moveNotes` tree-shaking 없이 번들에 포함.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 테스트 전부 보존 + 신규 23개).
- `moveNotes`: 배치 불변 연산, 방어적 클램프(start>=0, pitch 0..127), 다른 트랙·미매칭 ids 불변. 9개 테스트 통과.
- `computeGroupMove`: delta 스냅, 그룹 tick 클램프(start>=0), 그룹 pitch 클램프(0..127), 빈 배열 안전. 9개 테스트 통과.
- group-move 드래그: 두 노트 동시 이동, 상대 오프셋 보존, 누적 없음, 드래그 후 다중 선택 유지. 5개 스모크 통과.
- group-move 클릭(threshold 미만): `selectNote`로 단일 선택 전환.
- 미선택 노트 드래그: 기존 단일 이동 경로(회귀 없음).
- Shift+클릭·리사이즈·박스선택·Delete 기존 경로 회귀 0.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.
- React 타입 네임스페이스 미사용, 디자인 토큰 유지.

---

## 다음 증분

- **벨로시티 레인 다중 편집**: 다중 선택 노트의 velocity를 일괄 스케일/설정. Inspector "N개 선택됨" 뷰 + velocity 바 조작.
- **그룹 좌측 리사이즈**: 모든 선택 노트의 start를 동시에 이동(duration도 역방향 조정).
- **grab-note 기준 스냅**: `computeGroupMove`에 `grabOrigStart` 파라미터를 추가해 잡은 노트가 grid에 정확히 정렬되는 DAW 표준 스냅으로 업그레이드.
- **드래그 중 자동 스크롤**: 뷰포트 가장자리 근처에서 롤 스크롤(group-move에도 동일하게 적용).
- **다중 노트 복사-드래그 (Alt+drag)**: `handleNotePointerDown`에 Alt 키 분기 추가.

---

## 열린 질문

1. **그룹 pitch 클램프 범위 (0..127 vs PITCH_LOW..PITCH_HIGH)**: 현재 계획은 schema 한계인 0..127 사용. 드래그로 가시 롤 영역 밖으로 이동하면 노트가 사라져 보임. 롤 스크롤 기능 추가 후 이 클램프를 `PITCH_LOW..PITCH_HIGH`로 조여도 됨.

2. **snap 방식 (delta snap vs final-position snap)**: 현재 `snap(rawTickDelta, grid)` (delta를 스냅). 대안은 grab 노트 기준 최종 위치 스냅: `snap(grabOrigStart + rawTickDelta, grid) - grabOrigStart`. 후자가 DAW 표준이지만 `computeGroupMove` 시그니처에 `grabOrigStart` 파라미터가 필요하다. 현재는 delta 스냅으로 단순화. 사용자 경험 테스트 후 재검토.

3. **`origNotes!` 타입 단언**: `type === 'group-move'` 진입 시 `origNotes`가 항상 설정됨을 논리적으로 보장하지만 TS는 모른다. 대안: `DragState`를 discriminated union으로 분리 (`type: 'group-move'` 에서 `origNotes: Map<...>` 필수). 현재는 `!` 단언으로 단순화. 향후 타입 안전성 강화 시 리팩토링.

4. **단일 vs 그룹의 undo 경계 일관성**: `endEdit()`이 `handleContainerPointerUp`에서 호출되므로 group-move도 동일하게 ~1 undo 스텝으로 코얼레싱된다. 문제 없음.

5. **성능: `updateNote` 루프 O(K×N)**: 선택 K개 노트, 트랙 N개 노트. `mapTrack`이 K번 호출되므로 O(K×N). K가 수백~수천이면 주의. 향후 `moveNotes`를 drag preview에서도 사용하는 방향으로 리팩토링 가능(단, `project` 기준점 관리 필요).
