# Sculptone 벨로시티 레인 (노트별 velocity 드래그 편집) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤 그리드 하단에 고정 높이 벨로시티 레인을 추가한다. 각 노트에 대응하는 세로 막대를 `tickToX` 기반 x 좌표(PianoRoll 노트와 동일 스케일·스크롤)에 렌더링하고, 막대를 위아래로 드래그해 개별 또는 다중 선택 노트의 velocity를 직접 편집한다. 기존 PianoRoll/Inspector/AppShell 테스트와 레이아웃을 완전히 보존한다.

**Architecture:** 순수 함수 분리 원칙. `velocity.ts`에 변환·드래그 계산 순수 함수를 TDD로 작성하고, `VelocityLane.tsx`가 이를 소비한다. 드래그 패턴은 **origVelocity 스냅샷 + `useStore.getState().project`(currentProject) 절대 적용** — 직전 멀티드래그 리뷰에서 지적된 `origProject` 방식(mid-drag 동시변경 clobber)을 피한다. 스크롤 동기는 추가 코드 없이 AppShell 내 **공유 스크롤 컨테이너**(VelocityLane을 PianoRoll과 동일 `position:relative` div에 블록 배치)로 자동 해결한다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `apps/web/src/state/store.ts` — `selectedNoteIds: string[]`, `selectedTrackId`, `setProject`, `endEdit`, coalesce 패턴
> - `apps/web/src/compose/geometry.ts` — `tickToX(tick, ppq)`, `durationToWidth(dur, ppq)`, `PX_PER_BEAT`, `LANE_HEIGHT`, `NOTE_HEIGHT`
> - `packages/score-model/src/operations.ts` — `updateNote(p, trackId, id, patch: Partial<Omit<Note,'id'>>)` — velocity 패치 지원 확인됨
> - `packages/score-model/src/schema.ts` — `Note.velocity: z.number().int().min(0).max(127)`
> - `apps/web/src/compose/PianoRoll.tsx` — 기존 drag·resize·multi-select 구현 (VelocityLane은 PianoRoll을 수정하지 않음)
> - `apps/web/src/shell/AppShell.tsx` — PianoRoll이 마운트되는 중간 컬럼 컨테이너

---

## 비목표 (이 계획에서 하지 말 것)

- velocity "그리기" — 가로로 쓸어 여러 노트를 일괄 페인트
- velocity 랜덤화 / 스케일 툴 (비율 기반 증폭)
- 레인에서 노트 생성 / 삭제
- CC / 오토메이션 레인 (별도 증분)
- 협업 · 백엔드
- `packages/score-model`에 신규 operation 추가 (`updateNote` 재사용으로 충분)
- **인프라 파일 변경** (`.github/`, 루트 설정, eslint/prettier)

---

## 설계 근거

### x좌표 정렬·스크롤 동기 전략

PianoRoll 노트의 x 좌표는 `left: tickToX(n.start, ppq)` (=`n.start * PX_PER_BEAT / ppq`)로 결정된다. PianoRoll은 `position: relative; height: rollHeight(); minWidth: '100%'` div 안에 `position: absolute` 노트를 렌더링한다.

AppShell의 중간 컬럼 구조:
```
outer-scroll-div  { overflow: 'auto' }           ← 공유 스크롤 컨테이너
  inner-flow-div  { position: 'relative' }        ← 기존
    <LoopStrip />
    <PianoRoll />                                 ← 기존
    <VelocityLane />                              ← 신규 (블록 배치)
    <Playhead />                                  ← 기존 (position:absolute, top:0→bottom:0)
```

VelocityLane을 inner-flow-div에 블록 배치하면:
- outer-scroll-div의 수평 스크롤바 하나가 inner 전체를 커버 → **추가 scrollLeft 동기 코드 없음**.
- VelocityLane 내부 막대도 `left: tickToX(n.start, ppq)`로 PianoRoll 노트와 동일 x 스케일.
- Playhead(`position: absolute; top:0; bottom:0`)가 inner-flow-div의 전체 높이를 덮어 VelocityLane까지 자동 확장.

**우려 및 완화**: jsdom에서 `getBoundingClientRect()`는 `{0,0,...}`이므로 smoke 테스트에서 `left` 픽셀 절댓값은 검증하지 않는다. "막대가 렌더됐는가", "velocity 값이 변경됐는가"만 검증한다. 실제 픽셀 정렬은 velocity.ts 단위 테스트에서 수치로 보장한다.

### 드래그 패턴: origVelocity 스냅샷 + currentProject (누적·clobber 방지)

PianoRoll 단일 드래그의 검증된 패턴:
```ts
// pointerdown: 스냅샷
dragRef.current = {
  origNote: { start: n.start, pitch: n.pitch, duration: n.duration },
  startX: e.clientX, startY: e.clientY, ...
}

// pointermove: 스냅샷 + 총 델타 → 절대값 계산
const dx = e.clientX - dragRef.current.startX   // 누적이 아닌 총 델타
const patch = computeMove(origNote, pxToTicks(dx, ppq), ...)
setProject(updateNote(useStore.getState().project, ...))  // currentProject 사용
```

벨로시티 레인도 **동일 패턴**을 따른다:
```ts
// pointerdown: velocity 스냅샷
dragVelRef.current = {
  noteId: n.id,
  origVelocity: n.velocity,                           // 단일 스냅샷
  origVelocities: new Map(selectedIds.map(id =>       // 멀티 스냅샷
    [id, trackNotes.find(nn => nn.id === id)!.velocity]
  )),
  startY: e.clientY,
}

// pointermove: origVelocity 스냅샷 + 총 dy → 절대 velocity 계산
const dy = e.clientY - dragVelRef.current.startY
// 단일:
const newVel = computeVelocityFromDrag(origVelocity, dy, VELOCITY_LANE_HEIGHT)
setProject(updateNote(useStore.getState().project, trackId, noteId, { velocity: newVel }))

// 멀티:
const rawDelta = Math.round(-dy * 127 / VELOCITY_LANE_HEIGHT)
const delta = computeGroupVelocityDelta(Array.from(origVelocities.values()), rawDelta)
let p = useStore.getState().project   // currentProject (stale 클로저 방지)
for (const [id, origVel] of origVelocities) {
  p = updateNote(p, trackId, id, { velocity: origVel + delta })  // delta pre-clamped
}
setProject(p)
```

**기존 group-move와 다른 점**: PianoRoll.tsx의 `group-move`는 grab 시점의 `origProject` 스냅샷을 dragRef에 저장하고 `moveNotes(origProject, ...)` 루프로 드래그 미리보기를 적용한다. 이 방식은 drag 중 다른 변경이 origProject를 기반으로 덮어쓰는 clobber 위험이 있다. 벨로시티 드래그는 **origVelocity 스냅샷만 저장**하고 매 move에서 최신 `currentProject`에 패치를 적용해 이 문제를 회피한다.

### 멀티 그룹 클램프

`computeGroupVelocityDelta(origVelocities, rawDelta)`:
- `min = Math.min(...origVelocities)`, `max = Math.max(...origVelocities)`
- `clamp(rawDelta, 0 - min, 127 - max)` = 모든 노트가 0..127에 머물도록 균일 클램프
- 빈 배열 → 0
- 클램프된 delta가 반환되므로 각 노트에 `origVel + delta` 적용 시 추가 clamp 불필요

### 멀티 드래그 진입 조건

PianoRoll group-move와 동일 조건:
```ts
if (selectedSet.has(n.id) && selectedNoteIds.length > 1) {
  // 멀티 드래그: origVelocities Map 구성
} else {
  // 단일 드래그: origVelocity만 저장
}
```

잡은 노트가 선택 집합에 **포함**되어 있고 선택이 2개 이상일 때 멀티 경로.

### endEdit 대칭 처리

```ts
const handleDragEnd = () => {
  endEdit()
  dragVelRef.current = null
}
// pointerup, pointercancel, lostpointercapture 모두 handleDragEnd 호출
```

드래그 미리보기 전체(포인터다운~업 구간)가 하나의 undo 스텝으로 coalesce된다.

### velocity 없는 클릭 방지

velocity 편집은 움직임이 있을 때만 발동. pointerdown에서는 스냅샷만 저장하고 velocity를 변경하지 않는다. pointermove 진입 시(= `dy !== 0` 또는 사실상 항상 move인 경우) 비로소 velocity 패치를 적용한다. DRAG_THRESHOLD 없음 — 수직 1px 이동도 의미 있음.

---

## File Structure

```
apps/web/src/
  compose/
    velocity.ts                          # NEW: 순수 헬퍼 (velocityToHeight, computeVelocityFromDrag, computeGroupVelocityDelta)
    VelocityLane.tsx                     # NEW: 벨로시티 레인 컴포넌트
    test/
      velocity.test.ts                   # NEW: 완전 TDD (~14개)
      VelocityLane.drag.test.tsx         # NEW: jsdom 스모크 (~6개)

  shell/
    AppShell.tsx                         # MOD: VelocityLane import + <VelocityLane /> 삽입
```

변경 없는 파일:
- `apps/web/src/compose/PianoRoll.tsx` — velocity 드래그는 VelocityLane에서 독립 처리
- `apps/web/src/compose/geometry.ts` — `tickToX`, `durationToWidth` 재사용 (수정 없음)
- `apps/web/src/state/store.ts` — 선택/endEdit 이미 구현됨
- `packages/score-model/src/operations.ts` — `updateNote` velocity patch 지원 확인됨, 신규 op 없음
- `apps/web/src/compose/test/PianoRoll.drag.test.tsx` — PianoRoll 불변
- `apps/web/src/compose/test/PianoRoll.multiselect.test.tsx` — 불변
- `apps/web/src/compose/test/PianoRoll.multi-drag.test.tsx` — 불변
- `apps/web/src/test/AppShell.compose.test.tsx` — `pianoroll` testid 유지됨(VelocityLane 추가는 이 단언에 영향 없음)
- `packages/score-model/*` — 수정 없음

---

## Task 1: compose/velocity.ts — 순수 헬퍼 함수 (완전 TDD)

**Files:** Create `apps/web/src/compose/velocity.ts`, Create `apps/web/src/compose/test/velocity.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/velocity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  velocityToHeight,
  computeVelocityFromDrag,
  computeGroupVelocityDelta,
  VELOCITY_LANE_HEIGHT,
} from '../velocity'

// ── velocityToHeight ─────────────────────────────────────────

describe('velocityToHeight', () => {
  it('velocity=0 → 0', () => {
    expect(velocityToHeight(0, 80)).toBe(0)
  })

  it('velocity=127 → laneHeight (80)', () => {
    expect(velocityToHeight(127, 80)).toBe(80)
  })

  it('velocity=64 → Math.round(64*80/127) = Math.round(40.31) = 40', () => {
    // 64*80/127 = 5120/127 ≈ 40.315... → round = 40
    expect(velocityToHeight(64, 80)).toBe(40)
  })

  it('velocity=100, laneHeight=100 → Math.round(100*100/127)=Math.round(78.74)=79', () => {
    expect(velocityToHeight(100, 100)).toBe(79)
  })

  it('velocity=1 → Math.round(1*80/127) = Math.round(0.63) = 1 (최소 가시성 아님, 스펙 단순화)', () => {
    // round(0.63)=1 — not 0; velocity=1은 최솟값 이상이므로 1px 이상
    expect(velocityToHeight(1, 80)).toBe(1)
  })

  it('laneHeight 파라미터 다양화: velocity=127, laneHeight=100 → 100', () => {
    expect(velocityToHeight(127, 100)).toBe(100)
  })

  it('VELOCITY_LANE_HEIGHT 상수가 양수 정수다', () => {
    expect(VELOCITY_LANE_HEIGHT).toBeGreaterThan(0)
    expect(Number.isInteger(VELOCITY_LANE_HEIGHT)).toBe(true)
  })
})

// ── computeVelocityFromDrag ───────────────────────────────────

describe('computeVelocityFromDrag', () => {
  const H = 80 // laneHeight

  it('dy=0 → origVelocity 그대로 (움직임 없음)', () => {
    expect(computeVelocityFromDrag(64, 0, H)).toBe(64)
  })

  it('dy<0 (위로 드래그) → velocity 증가', () => {
    // dy=-80 (전체 레인 위로) → delta = round(80*127/80) = round(127) = 127
    // newVel = min(127, max(0, 64+127)) = 127
    const result = computeVelocityFromDrag(64, -80, H)
    expect(result).toBeGreaterThan(64)
  })

  it('dy>0 (아래로 드래그) → velocity 감소', () => {
    const result = computeVelocityFromDrag(64, 40, H)
    expect(result).toBeLessThan(64)
  })

  it('상한 클램프: origVelocity=100, dy=-80(full up) → 127', () => {
    // delta = 127 → 100+127=227 → clamp(0,127)=127
    expect(computeVelocityFromDrag(100, -80, H)).toBe(127)
  })

  it('하한 클램프: origVelocity=20, dy=80(full down) → 0', () => {
    // delta = -127 → 20-127=-107 → clamp(0,127)=0
    expect(computeVelocityFromDrag(20, 80, H)).toBe(0)
  })

  it('반환값은 정수다', () => {
    const result = computeVelocityFromDrag(50, 13, H)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('dy=-laneHeight(full-up): vel=0 → 127', () => {
    // delta = round(80*127/80) = 127; 0+127=127
    expect(computeVelocityFromDrag(0, -80, H)).toBe(127)
  })

  it('dy=laneHeight(full-down): vel=127 → 0', () => {
    // delta = -127; 127-127=0
    expect(computeVelocityFromDrag(127, 80, H)).toBe(0)
  })
})

// ── computeGroupVelocityDelta ─────────────────────────────────

describe('computeGroupVelocityDelta', () => {
  it('빈 배열 → 0', () => {
    expect(computeGroupVelocityDelta([], 50)).toBe(0)
  })

  it('단일 원소 배열은 단일 clamp와 같다', () => {
    // vel=[64], rawDelta=100 → max delta=127-64=63 → clamp=63
    expect(computeGroupVelocityDelta([64], 100)).toBe(63)
  })

  it('rawDelta가 모든 노트를 127 이하로 유지 → 원본 반환', () => {
    // vels=[60,80], rawDelta=10 → max delta = 127-80=47 → 10 ≤ 47 → return 10
    expect(computeGroupVelocityDelta([60, 80], 10)).toBe(10)
  })

  it('rawDelta가 최대치 노트를 초과 → 클램프', () => {
    // vels=[60,80], rawDelta=50 → max delta=127-80=47 → 50 clamp to 47
    expect(computeGroupVelocityDelta([60, 80], 50)).toBe(47)
  })

  it('음수 rawDelta가 최솟값 노트를 0 미만으로 → 클램프', () => {
    // vels=[20,80], rawDelta=-30 → min delta=0-20=-20 → -30 clamp to -20
    expect(computeGroupVelocityDelta([20, 80], -30)).toBe(-20)
  })

  it('min=0 노트 포함: 음수 delta 불가', () => {
    // vels=[0,60], rawDelta=-10 → min delta=0-0=0 → clamp(-10, 0, ...) = 0
    expect(computeGroupVelocityDelta([0, 60], -10)).toBe(0)
  })

  it('max=127 노트 포함: 양수 delta 불가', () => {
    // vels=[60,127], rawDelta=10 → max delta=127-127=0 → clamp(10, ..., 0) = 0
    expect(computeGroupVelocityDelta([60, 127], 10)).toBe(0)
  })

  it('rawDelta=0 → 0', () => {
    expect(computeGroupVelocityDelta([40, 80], 0)).toBe(0)
  })

  it('단일=그룹 일관성: 단일 노트 그룹은 단일 clamp와 동일', () => {
    // 단일 드래그에서 clamp: min(127-vel, max(-vel, rawDelta))
    // 그룹(단일 원소): 동일 공식
    const vel = 90
    const rawDelta = -100 // → clamp to -90
    expect(computeGroupVelocityDelta([vel], rawDelta)).toBe(-90)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- velocity.test
```

Expected: FAIL — `'../velocity'` 모듈 없음.

- [ ] **Step 3: velocity.ts 구현**

Create `apps/web/src/compose/velocity.ts`:

```ts
/**
 * 벨로시티 레인 상수 및 순수 헬퍼 함수.
 *
 * 이 모듈은 DOM/React에 의존하지 않는다. 모든 함수는 순수(pure)하고 불변이다.
 */

/** 벨로시티 레인의 고정 높이(px). velocity=127 → 전체 높이, velocity=0 → 0. */
export const VELOCITY_LANE_HEIGHT = 80

/**
 * MIDI velocity(0..127)를 레인 내 막대 높이(px)로 변환한다.
 *
 * - velocity=0   → 0
 * - velocity=127 → laneHeight
 * - 중간값은 선형 비례 후 정수 반올림.
 */
export function velocityToHeight(velocity: number, laneHeight: number): number {
  return Math.round((velocity * laneHeight) / 127)
}

/**
 * 단일 노트 velocity 드래그 결과를 계산한다.
 *
 * - dy < 0 (위로 드래그) → velocity 증가.
 * - dy > 0 (아래로 드래그) → velocity 감소.
 * - laneHeight px 전체가 0~127에 매핑된다.
 * - 반환값은 clamp(0, 127) 후 정수.
 *
 * @param origVelocity - 드래그 시작 시 스냅샷된 velocity (pointerdown 시점)
 * @param dy           - clientY 총 델타 (e.clientY - startY). 누적이 아닌 총 델타.
 * @param laneHeight   - 레인 높이(px). 이 px 전체가 0~127 범위에 대응.
 */
export function computeVelocityFromDrag(
  origVelocity: number,
  dy: number,
  laneHeight: number,
): number {
  const delta = Math.round((-dy * 127) / laneHeight)
  return Math.max(0, Math.min(127, origVelocity + delta))
}

/**
 * 멀티 선택 velocity 드래그의 그룹 델타를 계산한다.
 *
 * - 모든 선택 노트가 0..127에 머물도록 rawDelta를 균일 클램프한다.
 * - clamp(rawDelta, 0 - minVelocity, 127 - maxVelocity)
 * - 빈 배열 → 0.
 * - 반환된 delta는 각 노트에 대해 `origVel + delta`를 적용해도 0..127을 보장한다.
 *
 * @param origVelocities - grab 시점에 스냅샷된 선택 노트들의 velocity 배열
 * @param rawDelta       - 드래그로 산출된 velocity delta (정수 권장)
 */
export function computeGroupVelocityDelta(
  origVelocities: ReadonlyArray<number>,
  rawDelta: number,
): number {
  if (origVelocities.length === 0) return 0
  const minVel = Math.min(...origVelocities)
  const maxVel = Math.max(...origVelocities)
  return Math.min(127 - maxVel, Math.max(0 - minVel, rawDelta))
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- velocity.test
```

Expected: `velocity.test.ts` **14개** PASS.

타입 체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 2: compose/VelocityLane.tsx — 레인 컴포넌트 (레퍼런스 구현 + 스모크)

**Files:** Create `apps/web/src/compose/VelocityLane.tsx`, Create `apps/web/src/compose/test/VelocityLane.drag.test.tsx`

- [ ] **Step 1: 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/VelocityLane.drag.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, act } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { VelocityLane } from '../VelocityLane'

/**
 * jsdom 25: PointerEvent.clientY は read-only.
 * Object.defineProperty로 주입. (PianoRoll.drag.test.tsx 헬퍼 재사용 패턴)
 */
function firePointerEvent(
  el: Element,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperty(e, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(e, 'clientY', { value: clientY, configurable: true })
  Object.defineProperty(e, 'pointerId', { value: pointerId, configurable: true })
  el.dispatchEvent(e)
}

describe('VelocityLane drag smoke', () => {
  let noteAId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    const nA = createNote({ pitch: 60, start: 240, duration: 480, velocity: 64 })
    noteAId = nA.id
    s.setProject(addNote(s.project, tid, nA))
    act(() => { s.selectNote(nA.id) })
  })

  // ── 단일 드래그 ───────────────────────────────────────────

  it('위로 드래그(dy<0)하면 velocity가 증가한다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    // pointerdown on bar, pointermove up (-40px), pointerup
    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    expect(vel).toBeGreaterThan(64)
  })

  it('아래로 드래그(dy>0)하면 velocity가 감소한다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 240) // dy=+40
      firePointerEvent(lane, 'pointerup', 50, 240)
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    const vel = track.notes.find((n) => n.id === noteAId)!.velocity
    expect(vel).toBeLessThan(64)
  })

  it('같은 clientY로 두 번째 move는 첫 번째와 동일 결과 (origVelocity 스냅샷, 누적 없음)', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40
    })
    const velAfterFirst = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity

    act(() => {
      firePointerEvent(lane, 'pointermove', 50, 160) // 동일 clientY
      firePointerEvent(lane, 'pointerup', 50, 160)
    })
    const velAfterSecond = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity

    // 누적 없으면 동일
    expect(velAfterSecond).toBe(velAfterFirst)
  })

  // ── 다중 선택 드래그 ──────────────────────────────────────

  it('다중 선택 드래그: 잡은 노트가 선택 집합에 포함 → 두 노트 모두 velocity 변경', () => {
    let noteBId: string
    act(() => {
      const s = useStore.getState()
      const nB = createNote({ pitch: 62, start: 720, duration: 480, velocity: 80 })
      noteBId = nB.id
      s.setProject(addNote(s.project, s.selectedTrackId, nB))
      s.setSelectedNoteIds([noteAId, nB.id])
    })

    render(<VelocityLane />)
    const bars = screen.getAllByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    // bars[0] = nA (start=240)
    act(() => {
      firePointerEvent(bars[0]!, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // dy=-40 → increase
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const s = useStore.getState()
    const tid = s.selectedTrackId
    const track = s.project.tracks.find((t) => t.id === tid)!
    const velA = track.notes.find((n) => n.id === noteAId)!.velocity
    const velB = track.notes.find((n) => n.id === noteBId)!.velocity

    // 두 노트 모두 증가
    expect(velA).toBeGreaterThan(64)
    expect(velB).toBeGreaterThan(80)
  })

  // ── pointercancel → dragVelRef 초기화 ────────────────────

  it('pointercancel 후 이후 pointermove가 velocity를 변경하지 않는다', () => {
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointercancel', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 100) // drag ref가 없으므로 무시
    })

    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    // velocity 변경 없음 (64 유지)
    expect(track.notes.find((n) => n.id === noteAId)!.velocity).toBe(64)
  })

  // ── endEdit 호출: undo 스텝 생성 ─────────────────────────

  it('pointerup 후 undo를 호출하면 velocity가 원래 값으로 복구된다', () => {
    // endEdit()이 올바르게 호출됐는지는 undo 동작으로 검증
    render(<VelocityLane />)
    const bar = screen.getByTestId('velocity-bar')
    const lane = screen.getByTestId('velocity-lane')

    act(() => {
      useStore.getState().endEdit() // 직전 스텝 경계 닫기
    })

    act(() => {
      firePointerEvent(bar, 'pointerdown', 50, 200)
      firePointerEvent(lane, 'pointermove', 50, 160) // velocity 증가
      firePointerEvent(lane, 'pointerup', 50, 160)
    })

    const velAfterDrag = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity
    expect(velAfterDrag).toBeGreaterThan(64)

    act(() => { useStore.getState().undo() })

    const velAfterUndo = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
      .notes.find((n) => n.id === noteAId)!.velocity
    expect(velAfterUndo).toBe(64)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- VelocityLane.drag
```

Expected: FAIL — `'../VelocityLane'` 모듈 없음.

- [ ] **Step 3: VelocityLane.tsx 구현 (레퍼런스 구현)**

Create `apps/web/src/compose/VelocityLane.tsx`:

```tsx
import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import { updateNote } from '@sculptone/score-model'
import type { Note } from '@sculptone/score-model'
import { tickToX, durationToWidth } from './geometry'
import {
  VELOCITY_LANE_HEIGHT,
  velocityToHeight,
  computeVelocityFromDrag,
  computeGroupVelocityDelta,
} from './velocity'

interface DragVelState {
  noteId: string
  /** 드래그 시작 시 스냅샷된 잡은 노트의 velocity (절대 계산 기준). */
  origVelocity: number
  /**
   * 멀티 드래그 전용: grab 시점에 선택된 모든 노트의 velocity 스냅샷.
   * id → origVelocity. 매 pointermove는 이 스냅샷 + 총 delta로 절대 계산.
   * 단일 드래그 시 null.
   */
  origVelocities: Map<string, number> | null
  /** pointerdown 시점의 clientY. 총 dy 계산 기준. */
  startY: number
}

export function VelocityLane() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const setProject = useStore((s) => s.setProject)
  const endEdit = useStore((s) => s.endEdit)

  const laneRef = useRef<HTMLDivElement>(null)
  const dragVelRef = useRef<DragVelState | null>(null)

  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)

  // O(1) 선택 여부 조회
  const selectedSet = new Set(selectedNoteIds)

  // ── 드래그 시작: 막대 pointerdown ─────────────────────────────

  const handleBarPointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    e.stopPropagation()

    const isMulti = selectedSet.has(note.id) && selectedNoteIds.length > 1

    if (isMulti) {
      // 멀티: 선택 노트 전체의 velocity 스냅샷
      const snapshot = new Map<string, number>()
      for (const id of selectedNoteIds) {
        const n = track?.notes.find((nn) => nn.id === id)
        if (n) snapshot.set(id, n.velocity)
      }
      dragVelRef.current = {
        noteId: note.id,
        origVelocity: note.velocity,
        origVelocities: snapshot,
        startY: e.clientY,
      }
    } else {
      // 단일: 해당 노트의 velocity만 스냅샷
      dragVelRef.current = {
        noteId: note.id,
        origVelocity: note.velocity,
        origVelocities: null,
        startY: e.clientY,
      }
    }

    // Pointer capture: 막대 밖으로 포인터가 나가도 pointermove/up이 이 요소로 전달됨.
    // jsdom에서 미지원 → try/catch 무시. 레인 컨테이너의 onPointerMove로 대체.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 드래그 진행: 레인 컨테이너 pointermove ─────────────────────
  //
  // setPointerCapture 덕분에 막대 밖으로 나가도 이 핸들러로 버블링된다.
  // jsdom에서는 컨테이너에 직접 이벤트를 발사한다.

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragVelRef.current) return
    const { noteId, origVelocity, origVelocities, startY } = dragVelRef.current
    const dy = e.clientY - startY

    // stale 클로저 방지: 매 move마다 스토어에서 최신 project를 읽는다.
    const currentProject = useStore.getState().project

    if (origVelocities !== null) {
      // 멀티 드래그: origVelocities 스냅샷 + 총 dy → 그룹 delta → 절대 적용
      const rawDelta = Math.round((-dy * 127) / VELOCITY_LANE_HEIGHT)
      const delta = computeGroupVelocityDelta(Array.from(origVelocities.values()), rawDelta)
      let p = currentProject
      for (const [id, origVel] of origVelocities) {
        // delta는 이미 0..127 범위 보장 (computeGroupVelocityDelta 클램프)
        p = updateNote(p, selectedTrackId, id, { velocity: origVel + delta })
      }
      setProject(p)
    } else {
      // 단일 드래그: origVelocity 스냅샷 + 총 dy → 절대 velocity
      const newVelocity = computeVelocityFromDrag(origVelocity, dy, VELOCITY_LANE_HEIGHT)
      setProject(updateNote(currentProject, selectedTrackId, noteId, { velocity: newVelocity }))
    }
  }

  // ── 드래그 종료: 모든 종료 경로에서 endEdit() 대칭 호출 ──────────

  const handleDragEnd = () => {
    endEdit()
    dragVelRef.current = null
  }

  return (
    <div
      ref={laneRef}
      data-testid="velocity-lane"
      onPointerMove={handlePointerMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onLostPointerCapture={handleDragEnd}
      style={{
        position: 'relative',
        height: VELOCITY_LANE_HEIGHT,
        minWidth: '100%',
        backgroundColor: 'var(--bg-inset)',
        borderTop: '1px solid var(--border)',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {track?.notes.map((n) => {
        const barWidth = Math.max(4, durationToWidth(n.duration, ppq))
        const barHeight = velocityToHeight(n.velocity, VELOCITY_LANE_HEIGHT)
        const isSelected = selectedSet.has(n.id)
        return (
          <div
            key={n.id}
            data-testid="velocity-bar"
            onPointerDown={(e) => handleBarPointerDown(e, n)}
            style={{
              position: 'absolute',
              left: tickToX(n.start, ppq),
              bottom: 0,
              width: barWidth,
              height: barHeight,
              // 선택 노트: 강조(Copper accent-deep), 미선택: 반투명 accent
              backgroundColor: isSelected ? 'var(--accent-deep)' : 'var(--accent)',
              opacity: isSelected ? 1 : 0.65,
              cursor: 'ns-resize',
              boxSizing: 'border-box',
              borderRadius: '2px 2px 0 0',
            }}
          />
        )
      })}
    </div>
  )
}
```

**구현 노트:**
- `origVelocities !== null`로 멀티/단일 분기 (타입 narrowing 명확).
- `currentProject = useStore.getState().project` — stale 클로저 방지 (PianoRoll 단일 드래그 패턴 동일).
- `data-testid="velocity-lane"`, `data-testid="velocity-bar"` — 스모크 테스트 선택자.
- React 타입 네임스페이스 미사용 — named import (`type PointerEvent as RPointerEvent`) 사용.
- 디자인 토큰: `var(--accent-deep)` (선택), `var(--accent)` 0.65 opacity (미선택). 팀 디자인 시스템의 "Copper" 강조 색이 `--accent` 계열이면 이미 매칭됨.

- [ ] **Step 4: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- VelocityLane.drag
```

Expected: **6개** PASS.

---

## Task 3: AppShell.tsx — VelocityLane 마운트 (레이아웃)

**Files:** Modify `apps/web/src/shell/AppShell.tsx`

- [ ] **Step 1: AppShell.tsx 수정 전 회귀 베이스라인 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.compose
```

Expected: 기존 3개 PASS — `pianoroll`, Piano button, 재생 버튼, FileMenu, useAutosave.

- [ ] **Step 2: Playhead.tsx 위치 확인 (이미 읽음)**

Playhead는 `position: absolute; top: 0; bottom: 0; left: 0` — inner-flow-div의 **전체 높이**를 덮는다. VelocityLane을 PianoRoll 뒤에 배치하면 inner-flow-div의 높이가 늘어나 Playhead가 VelocityLane까지 자동 확장된다. 레이아웃 회귀 없음.

- [ ] **Step 3: AppShell.tsx 수정**

`apps/web/src/shell/AppShell.tsx` 수정:

**3a) import 추가** — `PianoRoll` import 바로 아래:
```ts
import { VelocityLane } from '../compose/VelocityLane'
```

**3b) 레이아웃 수정** — 기존:
```tsx
<div style={{ position: 'relative' }}>
  <LoopStrip />
  <PianoRoll />
  <Playhead getSeconds={getSeconds} />
</div>
```

변경:
```tsx
<div style={{ position: 'relative' }}>
  <LoopStrip />
  <PianoRoll />
  <VelocityLane />
  <Playhead getSeconds={getSeconds} />
</div>
```

**변경 범위 최소화**: 두 줄만 추가(import + JSX). 기존 스크롤 컨테이너(`overflow: 'auto'`) 구조 불변.

**스크롤 동기 자동화 확인**:
- outer-scroll-div(`overflow: 'auto'`)가 inner-flow-div 전체를 스크롤한다.
- VelocityLane이 inner-flow-div에 블록 배치되므로, 수평 스크롤 시 PianoRoll과 VelocityLane이 함께 이동한다.
- VelocityLane 내 막대 x좌표 = `tickToX(n.start, ppq)` = PianoRoll 노트 x좌표와 동일.
- **추가 scrollLeft 동기 코드 불필요.**

- [ ] **Step 4: AppShell 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.compose
```

Expected: 기존 3개 **모두 PASS** (pianoroll testid 유지, VelocityLane 추가는 이 단언에 영향 없음).

---

## Task 4: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 PianoRoll 테스트 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- PianoRoll
```

Expected:
- `PianoRoll.test.tsx` 기존 PASS — PianoRoll 컴포넌트 수정 없음
- `PianoRoll.edit.test.tsx` 기존 4개 PASS
- `PianoRoll.drag.test.tsx` 기존 8개 PASS — VelocityLane에서 dragRef와 무관
- `PianoRoll.multiselect.test.tsx` 기존 PASS
- `PianoRoll.multi-drag.test.tsx` 기존 5개 PASS

**회귀 분석 (PianoRoll.drag.test.tsx):**

| 기존 테스트 | VelocityLane 영향 | 판정 |
|---|---|---|
| 노트 본체 threshold 초과 드래그 | PianoRoll.tsx 불변, VelocityLane과 무관 | PASS |
| 리사이즈 핸들 드래그 | PianoRoll.tsx 불변 | PASS |
| 3px 미만 클릭 | 불변 | PASS |
| 노트 위 stopPropagation | 불변 | PASS |
| Fix #1: A 선택 후 B 드래그 | 불변 | PASS |
| Fix #2: 좁은 핸들 폭 | 불변 | PASS |
| Fix #3: endEdit undo 분리 | 불변 (VelocityLane도 endEdit 올바르게 호출) | PASS |
| Fix #5: pointercancel | PianoRoll 내부 — 불변 | PASS |
| Fix #6: 수직 드래그 pitch | 불변 | PASS |

**회귀 분석 (AppShell.compose.test.tsx):**

| 기존 단언 | VelocityLane 영향 | 판정 |
|---|---|---|
| `pianoroll` testid 존재 | VelocityLane은 `velocity-lane` testid 사용, pianoroll 불변 | PASS |
| Piano 버튼 존재 | TracksPanel 불변 | PASS |
| 재생 버튼 존재 | TransportBar 불변 | PASS |
| FileMenu 버튼들 | 툴바 불변 | PASS |
| useAutosave 호출 | AppShell hook 불변 | PASS |

- [ ] **Step 2: 전체 web 패키지 테스트**

```bash
pnpm --filter @sculptone/web test
```

Expected: 기존 통과 수 **+20개** (velocity.test.ts 14개 + VelocityLane.drag.test.tsx 6개). 기존 테스트 회귀 없음.

- [ ] **Step 3: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 신규 | 기존 |
|---|---|---|
| `@sculptone/score-model` | 0 | 유지 |
| `@sculptone/sound-engine` | 0 | 유지 |
| `@sculptone/web` | +20 | 전부 유지 |

- [ ] **Step 4: 타입체크 + 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
```

Expected:
- `tsc --noEmit` 에러 없음. 특히:
  - `VELOCITY_LANE_HEIGHT: number` 상수 — 양수 정수 ✓
  - `velocityToHeight(velocity: number, laneHeight: number): number` — 양수 반환 ✓
  - `computeVelocityFromDrag(orig, dy, laneHeight): number` — 0..127 반환 ✓
  - `computeGroupVelocityDelta(origVelocities: ReadonlyArray<number>, rawDelta: number): number` — 빈 배열 안전 ✓
  - `dragVelRef: useRef<DragVelState | null>` — null 초기값 ✓
  - `origVelocities: Map<string, number> | null` — `!== null` narrowing으로 `!` 단언 없음 ✓
  - `updateNote(p, trackId, id, { velocity: number })` — `Partial<Omit<Note,'id'>>` 호환 ✓
  - React named import (`type PointerEvent as RPointerEvent`) — 타입 네임스페이스 미사용 ✓
- 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과. 기존 테스트 회귀 0.
- `velocity.ts` 순수 함수 3개 + `VELOCITY_LANE_HEIGHT` 상수:
  - `velocityToHeight`: 경계(0, 127), 선형 비례, 정수 반올림. 7개 통과.
  - `computeVelocityFromDrag`: dy 방향(위↑=증가), 상한(127)/하한(0) clamp, 정수, dy=0 보존. 8개 통과.
  - `computeGroupVelocityDelta`: 빈 배열=0, 상한/하한 그룹 clamp, rawDelta=0 보존, 단일=그룹 일관성. 9개 통과.
- `VelocityLane` smoke: 단일 위↑=증가, 단일 아래↓=감소, 누적 없음, 멀티 동시 변경, pointercancel 무시, undo 복구. 6개 통과.
- AppShell 회귀: `pianoroll` testid 유지, 기존 3개 PASS.
- 드래그 패턴: origVelocity 스냅샷 + `useStore.getState().project`(currentProject) 절대 적용. origProject 방식 미사용.
- 그룹 클램프: 모든 노트 0..127 범위 보장.
- 스크롤 동기: 추가 코드 없이 공유 스크롤 컨테이너로 자동 해결.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.
- React 타입 네임스페이스 미사용, 디자인 토큰(`var(--accent)`, `var(--accent-deep)`, `var(--border)`, `var(--bg-inset)`) 사용.
- `packages/score-model` 파일 수정 없음.
- 인프라/CI 파일 수정 없음.

---

## 다음 증분

- **velocity 페인트(lasso)**: 가로로 드래그하며 지나치는 노트의 velocity를 드래그 y 위치로 일괄 설정.
- **velocity 스케일 툴**: 선택 노트 velocity를 비율 기반 증폭/감쇄.
- **Inspector velocity 표시**: 단일 선택 시 Inspector에서 velocity 수치 표시·편집.
- **PianoRoll group-move clobber 수정**: 현재 `origProject` 방식 → `origNotes` 스냅샷 + updateNote 루프로 교체해 velocity 레인과 동일한 패턴으로 통일.
- **Playhead VelocityLane 높이 동기**: 피아노롤 롤 전용 스크롤이 별도 컨테이너로 분리될 경우 scrollLeft 동기 코드 추가 필요.
- **레인 가시 높이 조절**: 사용자가 레인 구분선을 드래그해 VELOCITY_LANE_HEIGHT를 런타임 변경.

---

## 열린 질문

1. **Copper 토큰 이름**: 계획은 `var(--accent-deep)`(선택)·`var(--accent) 0.65`(미선택)로 지정했다. 실제 디자인 시스템에 별도 `--copper` 또는 `--velocity-bar` 토큰이 있으면 교체.

2. **막대 너비 전략**: 현재 `Math.max(4, durationToWidth(n.duration, ppq))` — 노트와 동일 폭. 대안으로 노트 폭과 무관하게 4px 고정 세로선을 쓰면 좁은 노트에서 더 명확하다. 사용자 피드백 후 결정.

3. **PianoRoll group-move origProject 문제**: VelocityLane은 origVelocity 패턴으로 구현했지만, PianoRoll의 group-move 경로(`origProject`)는 여전히 clobber 위험을 갖는다. 이는 이 계획의 범위 밖이나, 향후 불일관성 해소 차원에서 PianoRoll group-move를 origNotes 패턴으로 리팩토링하는 것을 권장한다.

4. **jsdom에서 x 정렬 검증 불가**: smoke 테스트에서 `left` 픽셀 값을 단언할 수 없다(getBoundingClientRect=0). x 정렬의 정확성은 `tickToX` 단위 테스트(geometry.test.ts)와 육안 검증에 의존한다.

5. **VELOCITY_LANE_HEIGHT 상수 위치**: velocity.ts에 정의해 VelocityLane.tsx가 import한다. 향후 geometry.ts에 통합할지는 팀 컨벤션 따름.
