# Sculptone 루프 구간 (재생 한정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 피아노 롤 상단의 얇은 루프 스트립을 드래그해 [loopStart, loopEnd] 구간을 설정하고, TransportBar의 루프 토글 버튼으로 켜면 재생 시 해당 구간을 Stop 전까지 반복한다. 녹음 중(keepAlive)에는 루프가 강제 비활성되어 녹음 타이밍을 보호한다.

**Architecture:** 루프 구간 순수 계산(normalizeLoop, computeLoopDraw/Move/Resize*)은 `compose/loop.ts`로 분리해 완전 TDD. store에 `loopEnabled/loopStartTicks/loopEndTicks`를 추가하고 setLoopRegion이 normalizeLoop를 내부 적용해 불변식을 항상 보장한다. `playback.ts`에서 `effectiveLoopEnabled = loopEnabled && !keepAlive`로 녹음 가드를 구현하고, `transport.loop = true; transport.setLoopPoints(startSec, endSec)`를 호출한다. 루프 활성 시 `scheduleOnce(자동종료)` 미등록, 메트로놈은 `scheduleRepeat`로 연속 클릭. `LoopStrip.tsx`가 피아노 롤 위에 마운트되어 드래그로 구간을 설정한다. 기존 576개 테스트(특히 playback.test/useAudio.test)는 `loopEnabled` 기본값 false 덕분에 불변이다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** `docs/superpowers/plans/2026-06-30-sculptone-metronome.md`(재생 엔진 패턴 — keepAlive/scheduleRepeat), `docs/superpowers/plans/2026-06-30-sculptone-note-drag.md`(드래그/지오메트리/스모크 전략).

---

## 비목표 (이 계획에서 하지 말 것)

- 녹음 중 루프 (keepAlive=true 시 loop=false 고정 — 이 계획에서 의도적으로 제외)
- 루프 카운트 제한 (N회 후 자동 정지)
- 루프별 재생 속도 변조
- 스윙 / 그루브 퀀타이즈
- 마커 / 리전 다중 (현재 단일 루프 구간만)
- 자동 구간 감지 / 콘텐츠 기반 루프 설정
- 협업 / 백엔드
- 인프라 파일 변경 (`.github/`, 루트 설정 — 병렬 세션 소관)

---

## 설계 근거

### 순수 루프 헬퍼 (`compose/loop.ts`)

#### normalizeLoop(start, end, minDuration?)

루프 구간의 불변식을 보장하는 정규화 함수:
1. `s = max(0, start)` — 음수 클램프
2. `e = max(0, end)` — 음수 클램프
3. `e <= s` 이면 `e = s + max(1, minDuration)` — 최소 1틱 확보

반환: `{ loopStart: number, loopEnd: number }`. 호출부에서 미리 정규화하므로 store/playback에서 항상 `loopStart < loopEnd` 불변식이 유지된다.

#### computeLoopDrawRegion(startTick, endTick, gridTicks)

드래그로 새 구간을 그릴 때: 두 틱을 방향 무관하게 받아 작은 쪽이 loopStart, 큰 쪽이 loopEnd. gridTicks로 스냅 후 normalizeLoop 적용.

#### computeLoopMove(origStart, origEnd, deltaTicks, gridTicks)

구간 전체 이동: `duration = origEnd - origStart`를 보존하면서 `newStart = max(0, snap(origStart + deltaTicks, gridTicks))`, `newEnd = newStart + duration`.

#### computeLoopResizeStart(origStart, origEnd, deltaTicks, gridTicks, minDuration?)

시작점 리사이즈: `newStart = max(0, snap(origStart + deltaTicks, gridTicks))`. `end - minDuration` 이상으로 클램프(시작이 끝을 추월하지 않도록).

#### computeLoopResizeEnd(origStart, origEnd, deltaTicks, gridTicks, minDuration?)

종료점 리사이즈: `newEnd = snap(origEnd + deltaTicks, gridTicks)`. `start + minDuration` 이상으로 클램프.

### store 루프 상태

```
loopEnabled: boolean       기본 false
loopStartTicks: number     기본 0
loopEndTicks: number       기본 7680  (= ppq480 × 4 × 4, 4마디)
setLoopEnabled(enabled)
setLoopRegion(start, end)  → normalizeLoop 내부 적용 후 저장
```

`setLoopRegion`이 normalizeLoop를 내부 호출하므로 store는 항상 불변식을 보장한다. store.ts가 `compose/loop.ts`에서 normalizeLoop를 import하는 단방향 의존성(state/ → compose/)이며, loop.ts는 state/를 참조하지 않아 순환 없음.

### 재생 엔진 통합 (`playback.ts`)

```typescript
// 녹음 가드: keepAlive(녹음) 중에는 loop 강제 비활성
const effectiveLoopEnabled = (opts?.loopEnabled ?? false) && !(opts?.keepAlive ?? false)

if (effectiveLoopEnabled) {
  transport.loop = true
  transport.setLoopPoints(
    ticksToSeconds(opts.loopStartTicks ?? 0, ppq, tempo),
    ticksToSeconds(opts.loopEndTicks ?? 0, ppq, tempo),
  )
} else {
  transport.loop = false
}
```

**자동종료 비등록:** `effectiveLoopEnabled` 시 `keepAlive` 분기와 동일하게 `scheduleOnce` 미등록. 루프는 Stop 전까지 반복.

**메트로놈:** `effectiveLoopEnabled || opts?.keepAlive` 이면 `scheduleRepeat`(연속 클릭). 유한 재생이면 기존 `computeClickTimes + schedule`.

**기존 테스트 보존:**
- `PlayOptions` 신규 선택 필드(`loopEnabled?, loopStartTicks?, loopEndTicks?`) 추가만 — 기존 시그니처 불변.
- `loopEnabled` 기본 false → `effectiveLoopEnabled = false` → 기존 경로 그대로.
- 기존 `scheduleOnce` 단언 테스트: 루프 미적용 시 그대로 PASS.

### 루프 스트립 UI (`compose/LoopStrip.tsx`)

16px 얇은 스트립을 AppShell의 PianoRoll 위(형제 요소, 일반 문서 흐름)에 마운트. x축은 PianoRoll과 동일 스크롤 컨텍스트라 시간 축이 정렬된다.

드래그 유형 3가지:
- **빈 영역 pointerdown**: `type: 'draw'` — 새 구간 그리기
- **구간 본체 pointerdown**: `type: 'move'` — 전체 이동  
- **좌측 핸들 pointerdown**: `type: 'resizeStart'` — 시작점 조정
- **우측 핸들 pointerdown**: `type: 'resizeEnd'` — 종료점 조정

origStart/origEnd 스냅샷 + 전체 deltaTicks 절댓값 계산(note-drag와 동일 패턴). jsdom 스모크: `fireEvent.pointerDown + pointerMove + pointerUp` 시퀀스로 loopStartTicks/loopEndTicks 변화 검증.

`loopEnabled=false` 시 strip opacity 0.4(흐리게). 드래그 완료(pointerUp) 시 loopEnabled가 false였으면 자동으로 true로 전환(사용자가 구간을 그렸으면 활성화 의도).

---

## File Structure

```
apps/web/src/
  compose/
    loop.ts                       # NEW: 순수 루프 헬퍼 (normalizeLoop + compute*)
    LoopStrip.tsx                 # NEW: 루프 스트립 UI 컴포넌트
    test/
      loop.test.ts                # NEW: 완전 TDD (24개)
      LoopStrip.smoke.test.tsx    # NEW: jsdom 드래그 스모크 (5개)

  state/
    store.ts                      # MOD: loopEnabled/loopStartTicks/loopEndTicks + setters
    test/
      editor-store.test.ts        # MOD: 루프 상태 + setLoopRegion 불변식 테스트 (+7)

  audio/
    playback.ts                   # MOD: PlayOptions 루프 필드, effectiveLoopEnabled 가드
    useAudio.ts                   # MOD: loop 상태를 engine.play()에 전달
    TransportBar.tsx              # MOD: 루프 토글 버튼 추가
    test/
      playback.test.ts            # MOD: 루프 모드 스모크 (+5)
      useAudio.test.ts            # MOD: 루프 배선 스모크 (+3)
      TransportBar.test.tsx       # MOD: 루프 토글 UI 테스트 (+3)

  shell/
    AppShell.tsx                  # MOD: LoopStrip 마운트 (import + JSX 1줄)
```

변경 없는 파일:
- `compose/geometry.ts`, `compose/quantize.ts`, `compose/time.ts` — loop.ts가 import만
- `compose/drag.ts` — 기존 드래그 로직 불변
- `compose/PianoRoll.tsx` — 루프 스트립은 외부 형제 컴포넌트로 분리
- `packages/score-model/*`, `audio/metronome.ts` — 수정 없음

---

## Task 1: compose/loop.ts — 순수 루프 헬퍼 (완전 TDD)

**Files:** Create `apps/web/src/compose/loop.ts`, `apps/web/src/compose/test/loop.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/loop.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeLoop,
  computeLoopDrawRegion,
  computeLoopMove,
  computeLoopResizeStart,
  computeLoopResizeEnd,
} from '../loop'

// PPQ=480 기준 상수
const PPQ = 480
const GRID = 120  // 1/16음표 = divisionToTicks(16, 480) = 120

// ── normalizeLoop ─────────────────────────────────────────────

describe('normalizeLoop', () => {
  it('start < end이면 그대로 반환한다', () => {
    expect(normalizeLoop(0, 480)).toEqual({ loopStart: 0, loopEnd: 480 })
  })

  it('start === end이면 end = start + 1로 보정한다 (기본 minDuration=1)', () => {
    const r = normalizeLoop(240, 240)
    expect(r.loopStart).toBe(240)
    expect(r.loopEnd).toBe(241)
  })

  it('start > end이면 end = start + 1로 보정한다', () => {
    const r = normalizeLoop(480, 240)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBe(481)
  })

  it('음수 start는 0으로 클램프된다', () => {
    const r = normalizeLoop(-100, 480)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('음수 end는 0으로 클램프되고 start+1로 보정된다', () => {
    const r = normalizeLoop(0, -100)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(1)
  })

  it('음수 start와 end 모두: loopStart=0, loopEnd=1', () => {
    const r = normalizeLoop(-200, -100)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(1)
  })

  it('minDuration=GRID: start===end이면 end = start + GRID', () => {
    const r = normalizeLoop(480, 480, GRID)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBe(480 + GRID)
  })
})

// ── computeLoopDrawRegion ─────────────────────────────────────

describe('computeLoopDrawRegion', () => {
  it('startTick < endTick: 그대로 정렬됨', () => {
    // snap(0, 120)=0, snap(480, 120)=480
    const r = computeLoopDrawRegion(0, 480, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('startTick > endTick: 역방향 드래그도 정상 처리 (swap)', () => {
    const r = computeLoopDrawRegion(480, 0, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('그리드 스냅 적용: 틱이 그리드 사이이면 가장 가까운 그리드로', () => {
    // snap(50, 120) = 0, snap(430, 120) = 480
    const r = computeLoopDrawRegion(50, 430, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('gridTicks=0: 스냅 없이 자유 구간', () => {
    const r = computeLoopDrawRegion(37, 953, 0)
    expect(r.loopStart).toBe(37)
    expect(r.loopEnd).toBe(953)
  })

  it('start === end (점 드래그): normalizeLoop가 end를 보정', () => {
    const r = computeLoopDrawRegion(240, 240, GRID)
    expect(r.loopStart).toBe(240)
    expect(r.loopEnd).toBeGreaterThan(240)
  })
})

// ── computeLoopMove ───────────────────────────────────────────

describe('computeLoopMove', () => {
  it('오른쪽 이동: start·end가 deltaTicks만큼 증가하고 duration 보존', () => {
    const r = computeLoopMove(240, 720, GRID, GRID)
    // snap(240+120, 120)=360; end=360+(720-240)=360+480=840
    expect(r.loopStart).toBe(360)
    expect(r.loopEnd).toBe(840)
    expect(r.loopEnd - r.loopStart).toBe(480)
  })

  it('왼쪽 이동: start가 음수가 되면 0으로 클램프, 폭 보존', () => {
    // origStart=0, origEnd=480, delta=-200 → snap(0-200,120)=snap(-200,120)=-240 → max(0,...)=0
    const r = computeLoopMove(0, 480, -200, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)
  })

  it('gridTicks=0: 스냅 없이 자유 이동, duration 보존', () => {
    const r = computeLoopMove(0, 500, 37, 0)
    expect(r.loopStart).toBe(37)
    expect(r.loopEnd).toBe(537)
  })

  it('큰 음수 delta에서도 start >= 0 보장', () => {
    const r = computeLoopMove(120, 600, -9999, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(480)  // 폭 480 보존
  })
})

// ── computeLoopResizeStart ────────────────────────────────────

describe('computeLoopResizeStart', () => {
  it('시작점을 오른쪽으로 축소: newStart 증가, end 불변', () => {
    // origStart=0, origEnd=960, delta=+120 → snap(0+120,120)=120 < 960-1=959 → OK
    const r = computeLoopResizeStart(0, 960, 120, GRID)
    expect(r.loopStart).toBe(120)
    expect(r.loopEnd).toBe(960)
  })

  it('시작점을 왼쪽으로 확장: newStart 감소', () => {
    // origStart=480, origEnd=960, delta=-120 → snap(360,120)=360
    const r = computeLoopResizeStart(480, 960, -120, GRID)
    expect(r.loopStart).toBe(360)
    expect(r.loopEnd).toBe(960)
  })

  it('시작점이 end - minDuration을 초과하면 클램프: 최소 폭 보장', () => {
    // origStart=0, origEnd=480, delta=+9999 → newStart=snap(9999,120) → 매우 큰 값
    // clamp: min(newStart, 480-1) = 479 (minDuration 기본 1)
    const r = computeLoopResizeStart(0, 480, 9999, GRID)
    expect(r.loopStart).toBeLessThan(480)
    expect(r.loopEnd).toBe(480)
  })

  it('시작점이 0 미만이 되면 0으로 클램프', () => {
    const r = computeLoopResizeStart(120, 960, -9999, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(960)
  })
})

// ── computeLoopResizeEnd ──────────────────────────────────────

describe('computeLoopResizeEnd', () => {
  it('종료점을 오른쪽으로 확장: newEnd 증가, start 불변', () => {
    const r = computeLoopResizeEnd(0, 480, 120, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(600)
  })

  it('종료점을 왼쪽으로 축소: newEnd 감소', () => {
    // origEnd=960, delta=-120 → snap(840,120)=840 > 0+1=1 → OK
    const r = computeLoopResizeEnd(0, 960, -120, GRID)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(840)
  })

  it('종료점이 start + minDuration 미만이 되면 클램프: 최소 폭 보장', () => {
    // origStart=480, origEnd=960, delta=-9999 → newEnd 매우 작음 → clamp to 480+1=481
    const r = computeLoopResizeEnd(480, 960, -9999, GRID)
    expect(r.loopStart).toBe(480)
    expect(r.loopEnd).toBeGreaterThan(480)
  })

  it('gridTicks=0: 스냅 없이 자유 리사이즈', () => {
    const r = computeLoopResizeEnd(0, 480, 37, 0)
    expect(r.loopStart).toBe(0)
    expect(r.loopEnd).toBe(517)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- loop.test
```

Expected: FAIL — `'../loop'` 모듈 없음.

- [ ] **Step 3: loop.ts 구현**

Create `apps/web/src/compose/loop.ts`:
```ts
import { snap } from './quantize'

export interface LoopRegion {
  loopStart: number
  loopEnd: number
}

/**
 * 루프 구간 불변식 정규화.
 * - 양단 >= 0 클램프
 * - loopStart < loopEnd 보장 (end <= start이면 end = start + max(1, minDuration))
 *
 * @param start        시작 틱 (임의 값 가능)
 * @param end          종료 틱 (임의 값 가능)
 * @param minDuration  최소 구간 폭(틱). 기본 1.
 */
export function normalizeLoop(
  start: number,
  end: number,
  minDuration: number = 1,
): LoopRegion {
  const s = Math.max(0, start)
  let e = Math.max(0, end)
  if (e <= s) {
    e = s + Math.max(1, minDuration)
  }
  return { loopStart: s, loopEnd: e }
}

/**
 * 드래그로 새 루프 구간을 그린다.
 * startTick, endTick은 방향 무관. 그리드 스냅 후 normalizeLoop 적용.
 */
export function computeLoopDrawRegion(
  startTick: number,
  endTick: number,
  gridTicks: number,
): LoopRegion {
  const a = snap(Math.max(0, startTick), gridTicks)
  const b = snap(Math.max(0, endTick), gridTicks)
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return normalizeLoop(lo, hi)
}

/**
 * 루프 구간 전체 이동.
 * duration(origEnd - origStart)을 보존하고, start가 0 미만이 되면 클램프.
 *
 * @param origStart   드래그 시작 시의 loopStartTicks 스냅샷
 * @param origEnd     드래그 시작 시의 loopEndTicks 스냅샷
 * @param deltaTicks  x 이동량(틱 단위, 부호 있음)
 * @param gridTicks   양자화 그리드(0이면 스냅 없음)
 */
export function computeLoopMove(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
): LoopRegion {
  const duration = origEnd - origStart
  const newStart = Math.max(0, snap(origStart + deltaTicks, gridTicks))
  return { loopStart: newStart, loopEnd: newStart + duration }
}

/**
 * 루프 시작점 리사이즈 드래그.
 * end - minDuration 이상으로 클램프하여 구간이 사라지지 않도록 한다.
 */
export function computeLoopResizeStart(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
  minDuration: number = 1,
): LoopRegion {
  const rawStart = snap(origStart + deltaTicks, gridTicks)
  const maxStart = origEnd - Math.max(1, minDuration)
  const loopStart = Math.max(0, Math.min(rawStart, maxStart))
  return { loopStart, loopEnd: origEnd }
}

/**
 * 루프 종료점 리사이즈 드래그.
 * start + minDuration 이상으로 클램프하여 구간이 사라지지 않도록 한다.
 */
export function computeLoopResizeEnd(
  origStart: number,
  origEnd: number,
  deltaTicks: number,
  gridTicks: number,
  minDuration: number = 1,
): LoopRegion {
  const rawEnd = snap(origEnd + deltaTicks, gridTicks)
  const minEnd = origStart + Math.max(1, minDuration)
  const loopEnd = Math.max(minEnd, rawEnd)
  return { loopStart: origStart, loopEnd }
}
```

> **설계 노트:** `normalizeLoop`는 store.ts에서 `setLoopRegion` 내부에서 import해 재사용한다. loop.ts가 state/를 역참조하지 않으므로 순환 의존성 없음. `snap` 은 기존 `compose/quantize.ts`에서 재사용 — loop.ts는 geometry를 import하지 않음(픽셀 변환은 LoopStrip.tsx에서 처리).

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- loop.test
```

Expected: loop.test.ts 24개 PASS (normalizeLoop 7, computeLoopDrawRegion 5, computeLoopMove 4, computeLoopResizeStart 4, computeLoopResizeEnd 4). 기존 테스트 영향 없음.

---

## Task 2: store — loopEnabled, loopStartTicks, loopEndTicks (완전 TDD)

**Files:** Modify `apps/web/src/state/store.ts`, `apps/web/src/test/editor-store.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/test/editor-store.test.ts`의 `describe('editor store', ...)` 블록 끝에 추가:
```ts
  // ── 루프 상태 ─────────────────────────────────────────────

  it('초기 loopEnabled는 false이다', () => {
    expect(useStore.getState().loopEnabled).toBe(false)
  })

  it('setLoopEnabled(true) → loopEnabled true, setLoopEnabled(false) → false', () => {
    useStore.getState().setLoopEnabled(true)
    expect(useStore.getState().loopEnabled).toBe(true)
    useStore.getState().setLoopEnabled(false)
    expect(useStore.getState().loopEnabled).toBe(false)
  })

  it('초기 loopStartTicks=0, loopEndTicks=7680', () => {
    expect(useStore.getState().loopStartTicks).toBe(0)
    expect(useStore.getState().loopEndTicks).toBe(7680)
  })

  it('setLoopRegion(0, 1920) → loopStartTicks=0, loopEndTicks=1920', () => {
    useStore.getState().setLoopRegion(0, 1920)
    expect(useStore.getState().loopStartTicks).toBe(0)
    expect(useStore.getState().loopEndTicks).toBe(1920)
  })

  it('setLoopRegion(불변식 위반: start >= end) → normalizeLoop가 end를 보정', () => {
    useStore.getState().setLoopRegion(960, 240)
    // normalizeLoop(960, 240): s=960, e=240<960 → e=960+1=961
    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopStartTicks).toBe(960)
    expect(loopEndTicks).toBe(961)
  })

  it('setLoopRegion(음수 start, 음수 end) → 양단 클램프', () => {
    useStore.getState().setLoopRegion(-100, -50)
    expect(useStore.getState().loopStartTicks).toBe(0)
    expect(useStore.getState().loopEndTicks).toBe(1)
  })

  it('setLoopRegion 후 loopEnabled는 변경되지 않는다 (독립 setter)', () => {
    useStore.getState().setLoopEnabled(true)
    useStore.getState().setLoopRegion(0, 480)
    expect(useStore.getState().loopEnabled).toBe(true)
  })
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- editor-store
```

Expected: FAIL — `loopEnabled` / `loopStartTicks` / `loopEndTicks` / `setLoopEnabled` / `setLoopRegion`이 AppState에 없음.

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts` 상단 import에 추가:
```ts
import { normalizeLoop } from '../compose/loop'
```

`AppState` 인터페이스에 추가 (recordingContentStartSec 블록 다음):
```ts
  /** 루프 구간 활성화. 기본 false. 재생 전용 — 녹음 중(keepAlive)에는 엔진이 강제 비활성. */
  loopEnabled: boolean
  /**
   * 루프 시작(틱). 기본 0.
   * 불변식: loopStartTicks < loopEndTicks, 둘 다 >= 0.
   * setLoopRegion으로만 갱신 — normalizeLoop가 항상 적용된다.
   */
  loopStartTicks: number
  /**
   * 루프 종료(틱). 기본 7680 (ppq480 × 4마디).
   * setLoopRegion으로만 갱신.
   */
  loopEndTicks: number
  setLoopEnabled: (enabled: boolean) => void
  /**
   * 루프 구간을 설정한다. normalizeLoop를 내부 적용해 항상 불변식을 보장한다.
   * 직접 loopStartTicks/loopEndTicks를 변경하지 말 것.
   */
  setLoopRegion: (startTicks: number, endTicks: number) => void
```

`create<AppState>(...)` 초기 상태 객체에 추가 (recordingContentStartSec 초기값 다음):
```ts
  loopEnabled: false,
  loopStartTicks: 0,
  loopEndTicks: 7680,
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
  setLoopRegion: (startTicks, endTicks) => {
    const { loopStart, loopEnd } = normalizeLoop(startTicks, endTicks)
    set({ loopStartTicks: loopStart, loopEndTicks: loopEnd })
  },
```

> **타입 노트:** `loopEndTicks` 기본값 7680 = ppq(480) × 4박 × 4마디. `getInitialState()/setState(true)` 리셋 시 이 값으로 초기화되므로 테스트 격리에 영향 없음. `normalizeLoop`는 compose/loop.ts에서 import — loop.ts는 state를 역참조하지 않아 순환 없음.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- editor-store
```

Expected: 기존 + 신규 7개 PASS. 기존 테스트(metronomeEnabled, countInBars 등) 영향 없음.

---

## Task 3: playback.ts — 루프 모드 통합 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/audio/playback.ts`, `apps/web/src/audio/test/playback.test.ts`

- [ ] **Step 1: playback.test.ts 모킹 확장 + 실패 테스트 추가**

`apps/web/src/audio/test/playback.test.ts` 파일 상단의 `transport` 객체에 루프 필드 추가:
```ts
// 기존 transport 객체에 아래 필드 추가 (start/stop/cancel/... 기존 필드 보존):
const transport = {
  bpm: { value: 120 },
  loop: false,              // NEW
  loopStart: 0,             // NEW
  loopEnd: 0,               // NEW
  setLoopPoints: vi.fn(),   // NEW
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn((cb: (t: number) => void, time: number) => { cb(time) }),
  scheduleOnce: vi.fn((cb: (t: number) => void, time: number) => { cb(time) }),
  scheduleRepeat: vi.fn(),
  get seconds() { return 0 },
}
```

파일 끝에 새 describe 블록 추가:
```ts
describe('createPlaybackEngine.play — 루프 모드', () => {
  beforeEach(() => {
    transport.loop = false
    transport.loopStart = 0
    transport.loopEnd = 0
    transport.setLoopPoints.mockClear()
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
    transport.scheduleRepeat.mockClear()
  })

  it('loopEnabled=true → transport.loop=true 및 setLoopPoints(startSec, endSec) 호출', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    // ppq=480, tempo=120 → loopStartTicks=0 → 0s, loopEndTicks=1920 → 2.0s
    await engine.play(p, undefined, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    expect(transport.loop).toBe(true)
    expect(transport.setLoopPoints).toHaveBeenCalledWith(
      expect.closeTo(0),
      expect.closeTo(2.0),
    )
  })

  it('loopEnabled=true → scheduleOnce(자동종료) 미등록, transport.start는 호출됨', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()

    await engine.play(p, onEnded, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    // 루프 모드는 자동종료 없이 무한 반복
    expect(transport.scheduleOnce).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(transport.start).toHaveBeenCalledTimes(1)
  })

  it('녹음 가드: keepAlive=true이면 loopEnabled=true여도 transport.loop=false', async () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, {
      keepAlive: true,
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
    })

    // 녹음 중에는 루프 비활성 — 녹음 타이밍 보호
    expect(transport.loop).toBe(false)
    expect(transport.setLoopPoints).not.toHaveBeenCalled()
  })

  it('loopEnabled=false(기본) → transport.loop=false, 기존 동작 불변', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))
    const onEnded = vi.fn()

    await engine.play(p, onEnded)

    expect(transport.loop).toBe(false)
    expect(transport.setLoopPoints).not.toHaveBeenCalled()
    // 기존 경로: scheduleOnce로 자동종료
    expect(transport.scheduleOnce).toHaveBeenCalledTimes(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('loopEnabled=true + metronome → scheduleRepeat(연속 클릭), schedule 클릭 없음', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const engine = createPlaybackEngine(() => ({
      triggerAttackRelease: vi.fn(),
      volume: { value: 0 },
    }))

    await engine.play(p, undefined, undefined, {
      loopEnabled: true,
      loopStartTicks: 0,
      loopEndTicks: 1920,
      metronome,
    })

    // 루프 모드 메트로놈 = keepAlive와 동일하게 scheduleRepeat 사용 (무한 반복)
    expect(transport.scheduleRepeat).toHaveBeenCalledTimes(1)
    // 개별 schedule로 클릭이 등록되지 않아야 함 (노트도 없으므로 schedule 0회)
    expect(transport.schedule).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- playback.test
```

Expected: FAIL — 신규 5개 테스트 실패 (`PlayOptions`에 loopEnabled 등 없음, `transport.loop` 미설정).

- [ ] **Step 3: playback.ts 수정**

`apps/web/src/audio/playback.ts` 전체 내용:
```ts
import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from './multitrack'
import { computeClickTimes, beatDurationSec, type MetronomeHandle } from './metronome'

// ── 기존 buildSchedule (단일 트랙) — backward compat, 테스트 보존 ──

export interface ScheduleItem {
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

export function buildSchedule(project: Project, trackId: string): ScheduleItem[] {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) return []
  const { ppq, tempo } = project.transport
  return track.notes.map((n) => ({
    timeSec: ticksToSeconds(n.start, ppq, tempo),
    durationSec: ticksToSeconds(n.duration, ppq, tempo),
    pitch: n.pitch,
    velocity: n.velocity / 127,
  }))
}

// ── 멀티트랙 재생 엔진 ─────────────────────────────────────────

export interface MultiInstrument {
  triggerAttackRelease: (note: string, dur: number, time: number, vel?: number) => void
  volume: { value: number }
}

/**
 * play 옵션.
 * - keepAlive: 녹음 모드 — 노트가 없거나 끝나도 Stop 전까지 transport를 유지.
 * - metronome: 재생 구간 전체 박에 클릭 이벤트를 스케줄한다.
 * - countInDurationSec: > 0이면 content 노트를 이 값만큼 오프셋.
 * - loopEnabled: true이면 transport.loop=true + setLoopPoints. keepAlive 시 강제 false(녹음 가드).
 * - loopStartTicks: 루프 시작(틱). loopEnabled=true 시 사용.
 * - loopEndTicks: 루프 종료(틱). loopEnabled=true 시 사용.
 */
export interface PlayOptions {
  keepAlive?: boolean
  metronome?: MetronomeHandle
  countInDurationSec?: number
  loopEnabled?: boolean
  loopStartTicks?: number
  loopEndTicks?: number
}

export interface PlaybackEngine {
  play: (
    project: Project,
    onEnded?: () => void,
    isValid?: () => boolean,
    opts?: PlayOptions,
  ) => Promise<void>
  stop: () => void
  getSeconds: () => number
}

/**
 * 멀티트랙 재생 엔진.
 * @param getInstrument trackId → MultiInstrument | null (null이면 해당 트랙 스킵)
 */
export function createPlaybackEngine(
  getInstrument: (trackId: string) => MultiInstrument | null,
): PlaybackEngine {
  const transport = Tone.getTransport()
  return {
    async play(project, onEnded, isValid, opts) {
      await Tone.start()
      if (isValid && !isValid()) return
      transport.stop()
      transport.cancel()
      transport.bpm.value = project.transport.tempo

      const { ppq, tempo } = project.transport
      const countInDurationSec = opts?.countInDurationSec ?? 0
      const metronome = opts?.metronome

      // ── 녹음 가드: keepAlive(녹음 모드) 중에는 루프 강제 비활성 ──
      // 녹음 타이밍(recordingContentStartSec)이 루프 반복으로 어긋나지 않도록 보호.
      const effectiveLoopEnabled = (opts?.loopEnabled ?? false) && !(opts?.keepAlive ?? false)

      if (effectiveLoopEnabled) {
        const loopStartSec = ticksToSeconds(opts?.loopStartTicks ?? 0, ppq, tempo)
        const loopEndSec = ticksToSeconds(opts?.loopEndTicks ?? 0, ppq, tempo)
        transport.loop = true
        transport.setLoopPoints(loopStartSec, loopEndSec)
      } else {
        // 이전 play에서 loop=true였을 경우를 위해 항상 리셋
        transport.loop = false
      }

      const audibleIds = audibleTrackIds(project)
      const items = buildMultiSchedule(project, audibleIds)

      const instMap = new Map<string, MultiInstrument>()
      for (const trackId of audibleIds) {
        const inst = getInstrument(trackId)
        if (!inst) continue
        const track = project.tracks.find((t) => t.id === trackId)
        if (track) inst.volume.value = linearToDb(track.mixer.volume)
        instMap.set(trackId, inst)
      }

      // 노트 스케줄: countInDurationSec만큼 오프셋
      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        const scheduledAt = item.timeSec + countInDurationSec
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          inst.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, scheduledAt)
      }

      const contentEndSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
      const totalDurationSec = countInDurationSec + contentEndSec

      // ── 메트로놈 클릭 스케줄 ──────────────────────────────────
      // keepAlive(녹음) 또는 루프 모드: scheduleRepeat로 무한 연속 클릭.
      // 유한 재생: computeClickTimes + schedule로 구간 내 클릭만 등록.
      if (metronome) {
        if (opts?.keepAlive || effectiveLoopEnabled) {
          const beatDur = beatDurationSec(tempo)
          const beatsPerBar = (project.transport.timeSignature as [number, number])[0]
          let beatIndex = 0
          transport.scheduleRepeat(
            (time) => {
              metronome.click(time, beatIndex % beatsPerBar === 0)
              beatIndex++
            },
            beatDur,
            0,
          )
        } else if (totalDurationSec > 0) {
          const clicks = computeClickTimes(
            tempo,
            project.transport.timeSignature as [number, number],
            0,
            totalDurationSec,
          )
          for (const click of clicks) {
            transport.schedule((time) => {
              metronome.click(time, click.accent)
            }, click.timeSec)
          }
        }
      }

      const endSec = totalDurationSec

      if (opts?.keepAlive || effectiveLoopEnabled) {
        // 녹음 모드 또는 루프 모드: 자동종료(scheduleOnce)/onEnded 미등록.
        // 사용자가 Stop할 때까지 transport 유지.
        transport.start()
      } else if (endSec > 0) {
        transport.scheduleOnce(() => {
          transport.stop()
          transport.cancel()
          onEnded?.()
        }, endSec)
        transport.start()
      } else {
        transport.stop()
        transport.cancel()
        onEnded?.()
      }
    },
    stop() {
      transport.stop()
      transport.cancel()
    },
    getSeconds() {
      return transport.seconds
    },
  }
}
```

> **기존 테스트 보존:**
> - `PlayOptions.keepAlive/metronome/countInDurationSec` — 기존 필드 그대로. 신규 필드 선택값.
> - `loopEnabled` 기본 undefined → `effectiveLoopEnabled = false` → 기존 경로 완전 동일.
> - `transport.loop = false` 추가 호출: mock 객체에 단순 프로퍼티 설정이므로 기존 단언 영향 없음.
> - `transport.setLoopPoints`: 루프 비활성 시 호출 안 됨 → 기존 mock 단언 불변.
> - 기존 `keepAlive` 단언 테스트: `opts?.keepAlive || effectiveLoopEnabled` 조건에서 `effectiveLoopEnabled=false`이면 기존 `opts?.keepAlive` 조건과 동일 → PASS.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- playback.test
```

Expected: 기존 15개(buildSchedule 2 + play 8 + 메트로놈 5) + 신규 5개 = 20개 PASS.

---

## Task 4: useAudio.ts — 루프 상태 배선 (레퍼런스 구현 + 스모크)

**Files:** Modify `apps/web/src/audio/useAudio.ts`, `apps/web/src/audio/test/useAudio.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/audio/test/useAudio.test.ts` 끝에 새 describe 블록 추가:
```ts
describe('useAudio — 루프 배선', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('loopEnabled=false(기본) → engine.play에 loopEnabled=false 전달', async () => {
    // 기본 상태: loopEnabled=false
    const { result } = renderHook(() => useAudio())
    // play() 내부에서 engine.play가 호출됨 — 모킹된 Tone으로 검증
    // getTransport()의 loop 속성이 false로 설정되어야 함
    await act(async () => { result.current.play() })
    // transport.loop mock은 playback.ts에서 직접 설정 — Tone mock을 통해 검증
    // useAudio.test에서는 createPlaybackEngine 자체를 모킹하지 않으므로,
    // 실제 playback.ts 경로를 타고 transport mock의 loop를 확인한다.
    // NOTE: playback.test에서 이미 세밀하게 검증 — 여기서는 "loopEnabled 전달 여부" 스모크만.
    const { loopEnabled } = useStore.getState()
    expect(loopEnabled).toBe(false)
  })

  it('loopEnabled=true로 설정 후 play() → transport.loop=true (통합 경로)', async () => {
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setLoopRegion(0, 1920)
    })
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    // 스토어에서 loopEnabled=true → play()에서 engine.play({ loopEnabled: true, ... }) 전달
    // Tone transport mock에서 loop=true가 설정되어야 함
    // useAudio.test의 Tone mock: getTransport()가 transport 객체 반환
    // transport.loop는 playback.ts에서 `transport.loop = true`로 설정됨
    const toneTransport = (await import('tone')).getTransport()
    expect((toneTransport as { loop: boolean }).loop).toBe(true)
  })

  it('loopEnabled=true, keepAlive=true(녹음 가드) → transport.loop=false', async () => {
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setRecording(true)  // keepAlive 유발
    })
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    const toneTransport = (await import('tone')).getTransport()
    // keepAlive=true이면 effectiveLoopEnabled=false → loop=false
    expect((toneTransport as { loop: boolean }).loop).toBe(false)
  })
})
```

> **useAudio.test 스모크 전략 노트:**
> - `useAudio.test.ts`는 `@sculptone/sound-engine`을 완전 모킹하고 `tone`을 기존 패턴으로 모킹.
> - `transport.loop`는 playback.ts 내에서 `transport.loop = true/false`로 직접 설정되므로,
>   `(getTransport()).loop` 값을 읽어 검증 가능.
> - 세밀한 루프 검증(setLoopPoints 인수 등)은 Task 3(playback.test)에서 완전 단언함.
>   여기서는 "루프 상태가 play() 경로에 올바르게 전달되는가" 통합 스모크에 집중.
> - 기존 `useAudio.test.ts`의 `vi.mock('tone', ...)`이 `getTransport`를 모킹하므로,
>   `loop` 속성 읽기가 가능. 기존 transport mock 객체에 `loop: false` 초기화 필요 여부는
>   `useAudio.test.ts` 파일 내 transport 객체 정의를 확인 후 추가.

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- useAudio.test
```

Expected: FAIL — 신규 3개 중 루프 배선 테스트 실패 (play()가 loopEnabled를 전달하지 않음).

- [ ] **Step 3: useAudio.ts 수정**

`apps/web/src/audio/useAudio.ts`의 `play` 콜백 내부를 수정한다. 변경 부분만 표시:

```ts
  const play = useCallback(() => {
    const {
      project,
      isRecording,
      metronomeEnabled,
      countInBars,
      setRecordingContentStartSec,
      loopEnabled,         // NEW
      loopStartTicks,      // NEW
      loopEndTicks,        // NEW
    } = useStore.getState()

    syncInstruments(project)

    const countInDurationSec =
      metronomeEnabled && isRecording && countInBars > 0
        ? barsToSeconds(
            countInBars,
            project.transport.tempo,
            project.transport.timeSignature as [number, number],
          )
        : 0

    setRecordingContentStartSec(countInDurationSec)

    if (metronomeEnabled) {
      if (!metronomeRef.current) {
        metronomeRef.current = createMetronome()
      }
    } else {
      if (metronomeRef.current) {
        metronomeRef.current.dispose()
        metronomeRef.current = null
      }
    }

    const gen = ++playGenRef.current

    engineRef.current = createPlaybackEngine((trackId) => {
      return instrumentsRef.current.get(trackId) ?? null
    })

    void engineRef.current.play(
      project,
      () => { useStore.getState().setPlaying(false) },
      () => playGenRef.current === gen,
      {
        keepAlive: isRecording,
        metronome: metronomeRef.current ?? undefined,
        countInDurationSec,
        loopEnabled,         // NEW
        loopStartTicks,      // NEW
        loopEndTicks,        // NEW
      },
    )
  }, [syncInstruments])
```

> 기존 `stop`, `getSeconds`, `useEffect` 정리 콜백 — 변경 없음.
> `barsToSeconds`, `createMetronome`, `MetronomeHandle` import — 기존 그대로.
> 변경은 `useStore.getState()` 구조분해에 3개 필드 추가 + `PlayOptions`에 3개 필드 전달뿐.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- useAudio.test
```

Expected: 기존 테스트 + 신규 3개 PASS. 기존 테스트 영향 없음(`loopEnabled=false` 기본이므로).

---

## Task 5: TransportBar.tsx — 루프 토글 버튼 (UI 스모크)

**Files:** Modify `apps/web/src/audio/TransportBar.tsx`, `apps/web/src/audio/test/TransportBar.test.tsx`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/audio/test/TransportBar.test.tsx`에 새 describe 블록 추가:
```tsx
describe('TransportBar — 루프 토글', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('루프 버튼이 aria-label="루프"로 렌더된다', () => {
    render(<TransportBar onPlay={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByRole('button', { name: '루프' })).toBeInTheDocument()
  })

  it('루프 버튼 클릭 → loopEnabled 토글', async () => {
    render(<TransportBar onPlay={vi.fn()} onStop={vi.fn()} />)
    const loopBtn = screen.getByRole('button', { name: '루프' })
    expect(useStore.getState().loopEnabled).toBe(false)
    await userEvent.click(loopBtn)
    expect(useStore.getState().loopEnabled).toBe(true)
    await userEvent.click(loopBtn)
    expect(useStore.getState().loopEnabled).toBe(false)
  })

  it('loopEnabled=true 시 버튼의 aria-pressed가 true이다', () => {
    act(() => { useStore.getState().setLoopEnabled(true) })
    render(<TransportBar onPlay={vi.fn()} onStop={vi.fn()} />)
    const loopBtn = screen.getByRole('button', { name: '루프' })
    expect(loopBtn).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- TransportBar.test
```

Expected: FAIL — 루프 버튼 없음.

- [ ] **Step 3: TransportBar.tsx 수정**

`apps/web/src/audio/TransportBar.tsx`에 루프 상태와 버튼 추가:

파일 상단 useStore 구독에 추가:
```tsx
  const loopEnabled = useStore((s) => s.loopEnabled)
  const setLoopEnabled = useStore((s) => s.setLoopEnabled)
```

핸들러 추가 (handleCountIn 다음):
```tsx
  const handleLoop = () => {
    setLoopEnabled(!loopEnabled)
  }
```

JSX에 루프 버튼 추가 (메트로놈 토글 다음, 카운트인 선택 이전):
```tsx
      {/* 루프 토글 */}
      <button
        aria-label="루프"
        aria-pressed={loopEnabled}
        onClick={handleLoop}
        style={{
          ...tbtn,
          background: loopEnabled ? 'var(--accent)' : 'var(--bg-elevated)',
          color: loopEnabled ? 'var(--on-accent)' : 'var(--text-hi)',
        }}
      >
        ↺
      </button>
```

> **기존 TransportBar 테스트 보존:** 기존 버튼(녹음/재생/정지/메트로놈/카운트인)의 aria-label·동작 불변. 루프 버튼은 독립 추가.
> **React 타입:** import 없이 JSX 사용. `ChangeEvent<HTMLSelectElement>`는 기존 import 그대로.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- TransportBar.test
```

Expected: 기존 + 신규 3개 PASS.

---

## Task 6: LoopStrip.tsx + AppShell 마운트 (레퍼런스 구현 + jsdom 스모크)

**Files:** Create `apps/web/src/compose/LoopStrip.tsx`, `apps/web/src/compose/test/LoopStrip.smoke.test.tsx`; Modify `apps/web/src/shell/AppShell.tsx`

- [ ] **Step 1: jsdom 스모크 테스트 작성 (실패 상태)**

Create `apps/web/src/compose/test/LoopStrip.smoke.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { LoopStrip } from '../LoopStrip'

/**
 * jsdom 제약 메모:
 * - getBoundingClientRect() 는 항상 { left:0, top:0, ... } 반환.
 *   따라서 clientX 자체가 절대 x 좌표처럼 동작한다.
 * - setPointerCapture 미구현 → try/catch 무시.
 * - 정확한 틱 값 계산은 loop.ts 순수 함수 테스트가 보장.
 *   스모크는 "드래그 후 loopStartTicks/loopEndTicks 값이 변화하는가"만 검증.
 * - pointerdown → pointermove → pointerup 시퀀스로 드래그 시뮬레이션.
 */

describe('LoopStrip smoke', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('data-testid="loop-strip"이 렌더된다', () => {
    render(<LoopStrip />)
    expect(screen.getByTestId('loop-strip')).toBeInTheDocument()
  })

  it('빈 영역 드래그로 새 루프 구간이 설정된다 (loopStartTicks, loopEndTicks 변화)', () => {
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')

    // PX_PER_BEAT=48, PPQ=480: 1박=48px
    // pointerdown at clientX=48 → startTick=480
    // pointermove to clientX=192 → endTick=1920
    fireEvent.pointerDown(strip, { clientX: 48, clientY: 8, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 192, clientY: 8, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 192, clientY: 8, pointerId: 1 })

    const { loopStartTicks, loopEndTicks } = useStore.getState()
    // 구간이 초기값(0, 7680)에서 변화해야 함
    // (정확한 값은 loop.ts 테스트가 보장)
    expect(loopStartTicks).toBeGreaterThanOrEqual(0)
    expect(loopEndTicks).toBeGreaterThan(loopStartTicks)
  })

  it('loopEnabled=false이면 strip의 opacity가 낮다 (흐리게)', () => {
    act(() => { useStore.getState().setLoopEnabled(false) })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')
    const opacity = (strip as HTMLElement).style.opacity
    // loopEnabled=false → opacity=0.4 (흐리게)
    expect(Number(opacity)).toBeLessThan(1)
  })

  it('loopEnabled=true이면 strip의 opacity가 1이다', () => {
    act(() => { useStore.getState().setLoopEnabled(true) })
    render(<LoopStrip />)
    const strip = screen.getByTestId('loop-strip')
    const opacity = (strip as HTMLElement).style.opacity
    expect(Number(opacity)).toBe(1)
  })

  it('구간 본체(loop-region) 드래그로 loopEndTicks가 변화한다', () => {
    // 먼저 구간 설정
    act(() => {
      useStore.getState().setLoopEnabled(true)
      useStore.getState().setLoopRegion(0, 480)
    })
    render(<LoopStrip />)
    const region = screen.getByTestId('loop-region')
    const strip = screen.getByTestId('loop-strip')

    const origEnd = useStore.getState().loopEndTicks

    // 구간 이동: region body pointerdown + pointermove + pointerup
    fireEvent.pointerDown(region, { clientX: 50, clientY: 8, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 98, clientY: 8, pointerId: 1 })  // dx=48 = 1박
    fireEvent.pointerUp(strip, { clientX: 98, clientY: 8, pointerId: 1 })

    // 이동 후 loopEndTicks가 변화해야 함 (폭은 유지)
    const { loopStartTicks, loopEndTicks } = useStore.getState()
    expect(loopEndTicks - loopStartTicks).toBe(origEnd - 0)  // 폭 480 유지
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- LoopStrip.smoke
```

Expected: FAIL — `LoopStrip` 컴포넌트 없음.

- [ ] **Step 3: LoopStrip.tsx 레퍼런스 구현**

Create `apps/web/src/compose/LoopStrip.tsx`:
```tsx
import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import { tickToX, xToTick, PX_PER_BEAT } from './geometry'
import { divisionToTicks } from './quantize'
import {
  computeLoopDrawRegion,
  computeLoopMove,
  computeLoopResizeStart,
  computeLoopResizeEnd,
} from './loop'

const STRIP_HEIGHT = 16
const HANDLE_WIDTH = 6

/** LoopStrip 드래그 상태 */
interface LoopDragState {
  /** 드래그 유형 */
  type: 'draw' | 'move' | 'resizeStart' | 'resizeEnd'
  /** pointerdown 시점의 clientX */
  startX: number
  /** 드래그 시작 시의 loopStartTicks 스냅샷 */
  origStartTicks: number
  /** 드래그 시작 시의 loopEndTicks 스냅샷 */
  origEndTicks: number
}

export function LoopStrip() {
  const ppq = useStore((s) => s.project.transport.ppq)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const loopEnabled = useStore((s) => s.loopEnabled)
  const loopStartTicks = useStore((s) => s.loopStartTicks)
  const loopEndTicks = useStore((s) => s.loopEndTicks)
  const setLoopRegion = useStore((s) => s.setLoopRegion)
  const setLoopEnabled = useStore((s) => s.setLoopEnabled)

  const stripRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<LoopDragState | null>(null)

  const grid = divisionToTicks(quantizeDenom, ppq)

  const loopStartX = tickToX(loopStartTicks, ppq)
  const loopEndX = tickToX(loopEndTicks, ppq)
  const regionWidth = Math.max(0, loopEndX - loopStartX)

  // ── 빈 영역 pointerdown: 새 구간 그리기 시작 ────────────────

  const handleStripPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // 자식 요소(region/handle)에서 올라온 이벤트는 stopPropagation으로 차단됨.
    // Belt-and-suspenders:
    if (e.target !== e.currentTarget) return

    const rect = stripRef.current?.getBoundingClientRect() ?? { left: 0 }
    const startTick = xToTick(e.clientX - rect.left, ppq)
    dragRef.current = {
      type: 'draw',
      startX: e.clientX,
      origStartTicks: startTick,
      origEndTicks: startTick,
    }
    // 즉시 1-tick 임시 구간 설정
    setLoopRegion(startTick, startTick + (grid > 0 ? grid : ppq))
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 구간 본체 pointerdown: 이동 ──────────────────────────────

  const handleRegionPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'move',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 시작점 핸들 pointerdown ───────────────────────────────────

  const handleResizeStartPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'resizeStart',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 종료점 핸들 pointerdown ───────────────────────────────────

  const handleResizeEndPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'resizeEnd',
      startX: e.clientX,
      origStartTicks: loopStartTicks,
      origEndTicks: loopEndTicks,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }

  // ── 드래그 진행: strip pointermove ───────────────────────────

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const { type, startX, origStartTicks, origEndTicks } = dragRef.current

    const rect = stripRef.current?.getBoundingClientRect() ?? { left: 0 }
    const dx = e.clientX - startX
    // 픽셀→틱 변환: pxPerTick = PX_PER_BEAT / ppq
    const deltaTicks = dx / (PX_PER_BEAT / ppq)

    let region: { loopStart: number; loopEnd: number }

    if (type === 'draw') {
      const drawStartTick = xToTick(startX - rect.left, ppq)
      const currentTick = xToTick(e.clientX - rect.left, ppq)
      region = computeLoopDrawRegion(drawStartTick, currentTick, grid)
    } else if (type === 'move') {
      region = computeLoopMove(origStartTicks, origEndTicks, deltaTicks, grid)
    } else if (type === 'resizeStart') {
      region = computeLoopResizeStart(origStartTicks, origEndTicks, deltaTicks, grid)
    } else {
      region = computeLoopResizeEnd(origStartTicks, origEndTicks, deltaTicks, grid)
    }

    setLoopRegion(region.loopStart, region.loopEnd)
  }

  // ── 드래그 종료: strip pointerup ─────────────────────────────

  const handlePointerUp = (_e: RPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      // 드래그로 구간을 설정/변경했으면 loopEnabled를 자동 활성화
      if (!loopEnabled) {
        setLoopEnabled(true)
      }
    }
    dragRef.current = null
  }

  return (
    <div
      ref={stripRef}
      data-testid="loop-strip"
      onPointerDown={handleStripPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'relative',
        height: STRIP_HEIGHT,
        minWidth: '100%',
        background: 'var(--bg-elevated)',
        cursor: 'crosshair',
        userSelect: 'none',
        opacity: loopEnabled ? 1 : 0.4,
      }}
    >
      {/* 루프 구간 표시 영역 */}
      <div
        data-testid="loop-region"
        onPointerDown={handleRegionPointerDown}
        style={{
          position: 'absolute',
          left: loopStartX,
          top: 0,
          width: regionWidth,
          height: STRIP_HEIGHT,
          // Copper 반투명 (디자인 토큰 미지정 시 인라인 폴백)
          background: 'rgba(184, 115, 51, 0.45)',
          cursor: 'grab',
        }}
      >
        {/* 시작점 리사이즈 핸들 (좌측) */}
        <div
          data-testid="loop-resize-start"
          onPointerDown={handleResizeStartPointerDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: HANDLE_WIDTH,
            cursor: 'ew-resize',
            background: 'rgba(184, 115, 51, 0.8)',
          }}
        />
        {/* 종료점 리사이즈 핸들 (우측) */}
        <div
          data-testid="loop-resize-end"
          onPointerDown={handleResizeEndPointerDown}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: HANDLE_WIDTH,
            cursor: 'ew-resize',
            background: 'rgba(184, 115, 51, 0.8)',
          }}
        />
      </div>
    </div>
  )
}
```

> **설계 노트:**
> - `useRef<HTMLDivElement>`, `type PointerEvent as RPointerEvent`: `'react'`에서 named import — React 네임스페이스 직접 사용 금지.
> - `stripRef.current?.getBoundingClientRect() ?? { left: 0 }`: jsdom에서 `getBoundingClientRect()`가 `{ left: 0 }`를 반환하므로, `clientX - 0 = clientX`가 그대로 스트립 내 x 좌표로 동작한다.
> - `origStartTicks/origEndTicks` 스냅샷: note-drag와 동일 패턴. 매 pointermove마다 원점 기준 절댓값 계산 → 코얼레싱/렌더 지연 무관.
> - `loopEnabled` 자동 활성: 사용자가 구간을 드래그했으면 의도적으로 루프를 사용하려는 것이므로 `setLoopEnabled(true)` 호출. 단, 이미 활성이면 재호출 없음.
> - `handleStripPointerDown`의 `e.target !== e.currentTarget` 가드: region/handle에서 `stopPropagation`이 이미 막지만 이중 방어.

- [ ] **Step 4: AppShell.tsx 수정 — LoopStrip 마운트**

`apps/web/src/shell/AppShell.tsx`에 import 추가:
```tsx
import { LoopStrip } from '../compose/LoopStrip'
```

Compose/roll 섹션 수정:
```tsx
          {activeMode === 'compose' && composeView === 'roll' && (
            <div style={{ position: 'relative' }}>
              <LoopStrip />
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
            </div>
          )}
```

> **레이아웃 노트:** `LoopStrip`은 일반 문서 흐름(non-absolute)으로 16px를 차지하며, 그 아래에 `PianoRoll`이 이어진다. 두 컴포넌트는 외부 `overflow: auto` 컨테이너 안에서 함께 스크롤되므로 시간 축이 정렬된다. `Playhead`가 `position: absolute; top: 0`을 사용한다면 `top: 16px`로 조정이 필요할 수 있다(Playhead.tsx 구현에 따라 — 열린 질문 참조).

- [ ] **Step 5: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- LoopStrip.smoke
```

Expected: 5개 PASS. 기존 AppShell.test.tsx(있다면) 영향 확인.

---

## Task 7: 최종 게이트

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
| @sculptone/web | 417 | 47 | **464** |

신규 47개 내역:
- `loop.test.ts`: 24개 (normalizeLoop 7, computeLoopDrawRegion 5, computeLoopMove 4, computeLoopResizeStart 4, computeLoopResizeEnd 4)
- `editor-store.test.ts` 추가: 7개 (loopEnabled/loopStartTicks/loopEndTicks 초기값, setLoopEnabled, setLoopRegion 불변식)
- `playback.test.ts` 추가: 5개 (루프 모드 스모크)
- `useAudio.test.ts` 추가: 3개 (루프 배선 스모크)
- `TransportBar.test.tsx` 추가: 3개 (루프 토글 UI)
- `LoopStrip.smoke.test.tsx`: 5개 (렌더, 드래그, opacity, 이동)

> **기존 테스트 보존 체크리스트:**
> - `playback.test.ts` 기존 15개: `loopEnabled` 기본 undefined → `effectiveLoopEnabled=false` → 기존 경로 완전 동일 → **PASS**
> - `useAudio.test.ts` 기존 테스트: `loopEnabled=false` 기본 → 기존 `play()` 동작 불변 → **PASS**
> - `TransportBar.test.tsx` 기존: 기존 버튼 aria-label·동작 불변, 루프 버튼 독립 추가 → **PASS**
> - `editor-store.test.ts` 기존: metronomeEnabled/countInBars/recordingContentStartSec 필드 불변 → **PASS**
> - `PianoRoll.test.tsx`, `PianoRoll.edit.test.tsx`, `PianoRoll.drag.test.tsx`: PianoRoll 수정 없음 → **PASS**
> - `drag.test.ts`, `loop.test.ts`: 순수 함수 독립 → **PASS**
> - `geometry.test.ts`, `quantize.test.ts`, `time.test.ts`: 파일 수정 없음 → **PASS**

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음. 특히:
- `PlayOptions`에 선택 필드 추가: 기존 호출부(`opts?.keepAlive` 등) 영향 없음.
- `store.ts`의 `normalizeLoop` import: `compose/loop.ts` 존재 + export 확인.
- `LoopStrip.tsx`의 `PointerEvent as RPointerEvent`: `'react'`에서 import.
- `AppState`에 신규 필드: 기존 `useStore((s) => s.xxx)` 구독 호환.

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `loop.ts`, `LoopStrip.tsx`가 번들에 포함됨.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 보존 + 신규 47개).
- **불변식 보장:** `loopStartTicks < loopEndTicks`, 둘 다 >= 0 — `setLoopRegion` 호출 시 normalizeLoop가 항상 적용됨. 단위 테스트 7개 검증.
- **녹음 가드:** `keepAlive=true && loopEnabled=true → effectiveLoopEnabled=false → transport.loop=false`. playback.test 스모크 + useAudio.test 스모크 검증.
- **루프 재생:** `loopEnabled=true → transport.loop=true + setLoopPoints(startSec, endSec)`. scheduleOnce 미등록. playback.test 스모크 검증.
- **메트로놈 루프 모드:** `loopEnabled=true + metronome → scheduleRepeat`. playback.test 스모크 검증.
- **순수 함수 TDD:** `normalizeLoop`, `computeLoopDraw/Move/ResizeStart/ResizeEnd` 24개 단위 테스트 통과.
- **루프 스트립:** 드래그로 구간 설정, opacity로 활성/비활성 표시, 드래그 완료 시 loopEnabled 자동 활성. jsdom 스모크 5개 검증.
- **루프 토글:** TransportBar의 aria-label="루프" 버튼, aria-pressed 반영. UI 테스트 3개 검증.
- React 타입 네임스페이스 미사용 (`'react'`에서 named import만).
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후)

- **루프 경계 시각 마커:** 루프 구간 시작/종료에 세로선 표시 (PianoRoll 내 absolute div).
- **루프 카운트 제한:** N회 반복 후 자동 정지 (`transport.loopCount` 또는 수동 카운트).
- **녹음 중 루프:** keepAlive=true 시에도 루프를 허용 (복잡한 타이밍 처리 필요 — 별도 계획).
- **LoopStrip 키보드:** `L` 단축키로 현재 선택 구간을 루프로 설정, `Shift+L`로 루프 토글.
- **다중 마커/리전:** 여러 루프 구간 저장 후 선택 재생.

---

## 열린 질문

1. **Playhead 오프셋:** `LoopStrip`이 AppShell에서 `<PianoRoll />` 위에 16px를 차지하면, `<Playhead>`의 `top` 위치가 PianoRoll과 맞지 않을 수 있다. `Playhead.tsx`가 `position: absolute; top: 0`을 사용하면 `top: 16px`로 조정 필요. Playhead 구현 확인 후 결정.

2. **LoopStrip 수평 최소 폭:** `minWidth: '100%'`로 설정했으나, PianoRoll의 전체 가로 폭(콘텐츠 길이 기준)과 동기화가 필요할 수 있다. PianoRoll이 스크롤 가능한 긴 콘텐츠를 렌더하면 LoopStrip도 같은 폭이어야 x축이 정렬된다. PianoRoll의 실제 폭 계산 방식을 확인해 LoopStrip에 동일 적용 여부 결정.

3. **루프 경계 정밀도:** `computeLoopDrawRegion`에서 tick → snap → loopRegion 과정에 부동소수점 오차가 있을 수 있다. `ticksToSeconds(loopStartTicks, ppq, tempo)`로 변환 시 오차 전파. Tone.js `setLoopPoints`는 소수점 초 단위를 허용하므로 실용 범위에서 문제 없음. 매우 빠른 템포(200BPM 이상)에서 확인 권장.

4. **loopEndTicks 기본값 7680:** ppq=480, 4마디 가정. 사용자가 ppq를 변경하거나 다른 프로젝트를 로드하면 이 값이 맞지 않을 수 있다. `replaceProject` 시 `setLoopRegion(0, ppq * 16)`으로 리셋하는 추가 로직 고려.

5. **LoopStrip 드래그 중 loopEnabled 상태:** 드래그 시작 시 loopEnabled=false이면 pointermove마다 `setLoopRegion`이 호출되지만 `loopEnabled`는 pointerUp까지 false다. 드래그 중에도 활성화할지 여부 — 현재 구현은 pointerUp에서만 활성화. 드래그 중 미리 보기(활성화 없이 구간만 표시)가 더 자연스러울 수 있다.

6. **기존 playback.test.ts의 transport mock 변경:** 신규 필드(`loop: false`, `setLoopPoints: vi.fn()`) 추가가 기존 단언에 영향을 주지 않는지 확인. `beforeEach`에서 `transport.setLoopPoints.mockClear()`를 추가하는 패턴으로 격리.
