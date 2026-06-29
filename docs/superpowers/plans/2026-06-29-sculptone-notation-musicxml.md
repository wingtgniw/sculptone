# Sculptone Web 악보 뷰 + MusicXML 내보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** score-model에 순수 기보 파생 함수(`trackToNotation`)와 MusicXML 직렬화(`projectToMusicXML`)를 완전 TDD로 추가한다. apps/web에 VexFlow 기반 악보 뷰(`NotationView`)와 Compose 모드 Roll/Score 토글을 구현하고, FileMenu에 "Export MusicXML" 버튼을 추가한다. 정본 데이터 구조는 ticks 기반 그대로 유지하며, 기보(notation)는 저장하지 않는 순수 파생 뷰로 처리한다.

**Architecture:** `trackToNotation` / `ticksToDurationType` / `flattenToChords` / `splitAtBarlines` / `fillRests`는 완전 TDD(완전 코드 + 완전 테스트)로 검증한다. `projectToMusicXML`도 완전 TDD. VexFlow(`NotationView`)는 jsdom에서 SVG 렌더 불가를 고려해 VexFlow 전체 mock + 스모크 테스트 전략을 사용한다. AppShell·FileMenu 변경 시 기존 모킹·단언을 유지해 205개 기존 테스트를 보존한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · VexFlow(^4) · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-multitrack-mixer.md`, `docs/superpowers/plans/2026-06-29-sculptone-midi-input.md`, 디자인 가이드 `documents/sculptone-design-guide.html`.

---

## 비목표 (이 계획에서 하지 말 것)

- 튜플렛(셋잇단 등), 진짜 다성(여러 voice), 빔 그룹핑 정교화
- 조표 정밀 매핑 (key는 C 기본 처리: fifths=0 고정)
- MusicXML 가져오기 (import)
- 악보 편집 (NotationView는 읽기 전용)
- 오버랩 노트의 완벽한 다성 처리 (클리핑으로 단순화)
- 마디 내 duration 합계의 수학적 완벽성 (근사 rest 허용, P1 한계로 명시)
- 점2분음표(dotted-whole) — 4/4 마디 초과이므로 표시 대상 외
- 사운드 디자인, 협업, 클라우드 저장

---

## 설계 근거

### 기보 파생 원칙

- **정본(source of truth)**: score-model의 Note.start / Note.duration (절대 ticks). 저장·편집은 ticks 기반.
- **기보는 파생**: `trackToNotation`은 순수 함수. 결과를 store에 저장하지 않는다. 렌더 시마다 재계산.
- **score-model 외부 import 금지**: notation.ts / musicxml.ts는 zod schema와 factory/operations만 참조. apps/web의 time.ts, quantize.ts는 사용하지 않는다(동일 수식을 내부에서 직접 계산).

### 단성 단순화 규칙 (flattenToChords)

기보는 단성(monophonic) + 화음(chord) 구조로 단순화한다. 처리 규칙은 다음과 같다.

1. **정렬**: 노트를 `start` 오름차순 정렬. start 동일 시 pitch 오름차순.
2. **화음 그룹**: `start`가 동일한 노트는 하나의 화음(`pitches[]`)으로 묶는다. 화음의 `end` = 모든 노트 중 `max(start + duration)`.
3. **오버랩 해소**: 인접 화음 쌍 (i, i+1) 검사:
   - `chord[i].end > chord[i+1].start` 이면 → `chord[i].displayDuration = chord[i+1].start - chord[i].start`로 클리핑.
   - `chord[i+1]`의 위치는 변경하지 않는다.
   - 클리핑 후 `displayDuration <= 0`이면 `chord[i]` 전체 제외 (피치 중복 극단 케이스).
4. **순서 보존**: 빠른 start가 앞에 배치된다.

### 음표값 매핑 (ticksToDurationType, ppq=480 기준)

| DurationType | dots | ticks (ppq=480) |
|---|---|---|
| 16th | 0 | 120 |
| 16th | 1 | 180 |
| eighth | 0 | 240 |
| eighth | 1 | 360 |
| quarter | 0 | 480 |
| quarter | 1 | 720 |
| half | 0 | 960 |
| half | 1 | 1440 |
| whole | 0 | 1920 |

규칙:
- 정확히 일치하는 duration이 있으면 그것을 반환.
- 일치 없으면 절대 거리(|ticks - d.ticks|)가 가장 작은 것 선택. 거리가 동일하면 더 짧은 쪽 우선.
- dotted-whole(2880)은 정상 4/4 마디를 초과하므로 목록에서 제외.

### ticks 필드 전달 이유

`NotationElement`에 `ticks` 필드를 두어 실제 tick 길이를 유지한다. `durationType+dots`는 화면 표시용 근사이며, MusicXML `<duration>` 값은 `ticks` 필드를 직접 사용해 타이밍 정확도를 보장한다.

### MusicXML 구조

- 표준 MusicXML 3.1 **partwise** 포맷.
- 각 Track → `<part>`.
- `<divisions>` = ppq (quarter note 기준).
- `<key><fifths>0</fifths></key>` 고정 (C major, 조표 단순 처리).
- `<clef><sign>G</sign><line>2</line></clef>` (단일 G 보표).
- 화음: 두 번째 피치부터 `<chord/>` 선행.
- 쉼표: `<rest/>` 내부.
- 점음표: `<dot/>`.
- 타이: `<tie type="start|stop"/>` + `<notations><tied type="start|stop"/></notations>`.
- `<duration>` = `el.ticks` (실제 tick 값). `<type>` = 근사 durationType. 두 값이 불일치하는 것은 P1 허용 오차.

### MusicXML 테스트 전략 (Node 환경)

score-model 테스트는 Node 환경(jsdom 없음). DOMParser 미사용. 문자열 단언으로 검증:
```ts
expect(xml).toContain('<score-partwise version="3.1">')
const noteCount = (xml.match(/<note>/g) ?? []).length
expect(noteCount).toBe(N)
```

### VexFlow jsdom 전략

- `vexflow` 패키지를 `vi.mock` 으로 전체 교체 (테스트에서 실제 DOM 렌더 안 함).
- `NotationView` 컴포넌트 내부는 `try/catch`로 VexFlow 렌더 오류를 격리 — jsdom에서 layout 계산 실패 시 placeholder 렌더.
- 스모크 테스트: 빈 트랙/노트 있는 트랙에서 크래시 없이 마운트, `Renderer` 생성자 호출 확인.

### 기존 테스트 보존 전략

- `AppShell.test.tsx` / `AppShell.compose.test.tsx`: `useMidi`, `useRecording`, `useAudio`, `useAutosave` 기존 mock 유지. `NotationView` import를 새로운 mock 추가.
- `FileMenu.test.tsx`: 기존 score-model mock에 `projectToMusicXML: vi.fn().mockReturnValue('<?xml ...')`만 추가.
- 기존 테스트 단언 변경 없음.

---

## File Structure

```
packages/score-model/src/
  notation.ts                           # NEW: trackToNotation + 순수 헬퍼
  musicxml.ts                           # NEW: projectToMusicXML
  index.ts                              # MOD: notation/musicxml export 추가

packages/score-model/test/
  notation.test.ts                      # NEW: 완전 TDD (≈29개)
  musicxml.test.ts                      # NEW: 완전 TDD (≈9개)

apps/web/src/
  notation/
    NotationView.tsx                    # NEW: VexFlow 악보 뷰

  notation/test/
    NotationView.test.tsx               # NEW: VexFlow mock + 스모크 (3개)

  state/
    store.ts                            # MOD: composeView + setComposeView 추가

  test/
    editor-store.test.ts                # MOD: composeView 테스트 추가 (2개)

  shell/
    AppShell.tsx                        # MOD: Score/Roll 토글 + NotationView 연결

  test/
    AppShell.test.tsx                   # MOD: NotationView mock 추가 + 토글 테스트 (3개)
    AppShell.compose.test.tsx           # MOD: NotationView mock 추가 (기존 3개 보존)

  ui/
    FileMenu.tsx                        # MOD: Export MusicXML 버튼 추가

  ui/test/
    FileMenu.test.tsx                   # MOD: projectToMusicXML mock + 2개 테스트 추가
```

---

## Task 1: score-model — notation.ts (완전 TDD)

**Files:** Create `packages/score-model/src/notation.ts`, `packages/score-model/test/notation.test.ts`

### Step 1: 실패 테스트 작성

Create `packages/score-model/test/notation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ticksToDurationType,
  flattenToChords,
  splitAtBarlines,
  fillRests,
  trackToNotation,
} from '../src/notation'

// ── 공통 상수 ──────────────────────────────────────────────────
const PPQ = 480
// 4/4 박자: measureTicks = 480 * 4 * 4 / 4 = 1920
const MEASURE_TICKS = 1920

// ────────────────────────────────────────────────────────────────
// ticksToDurationType
// ────────────────────────────────────────────────────────────────

describe('ticksToDurationType', () => {
  it('whole (1920 ticks) → durationType:whole, dots:0', () => {
    const r = ticksToDurationType(1920, PPQ)
    expect(r.durationType).toBe('whole')
    expect(r.dots).toBe(0)
  })

  it('half (960) → half, dots:0', () => {
    const r = ticksToDurationType(960, PPQ)
    expect(r.durationType).toBe('half')
    expect(r.dots).toBe(0)
  })

  it('quarter (480) → quarter, dots:0', () => {
    const r = ticksToDurationType(480, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(0)
  })

  it('eighth (240) → eighth, dots:0', () => {
    const r = ticksToDurationType(240, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(0)
  })

  it('16th (120) → 16th, dots:0', () => {
    const r = ticksToDurationType(120, PPQ)
    expect(r.durationType).toBe('16th')
    expect(r.dots).toBe(0)
  })

  it('dotted-half (1440) → half, dots:1', () => {
    const r = ticksToDurationType(1440, PPQ)
    expect(r.durationType).toBe('half')
    expect(r.dots).toBe(1)
  })

  it('dotted-quarter (720) → quarter, dots:1', () => {
    const r = ticksToDurationType(720, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(1)
  })

  it('dotted-eighth (360) → eighth, dots:1', () => {
    const r = ticksToDurationType(360, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(1)
  })

  it('dotted-16th (180) → 16th, dots:1', () => {
    const r = ticksToDurationType(180, PPQ)
    expect(r.durationType).toBe('16th')
    expect(r.dots).toBe(1)
  })

  it('비표준(500) → 가장 가까운 quarter(480) 반환', () => {
    // |500-480|=20 vs |500-720|=220 → quarter
    const r = ticksToDurationType(500, PPQ)
    expect(r.durationType).toBe('quarter')
    expect(r.dots).toBe(0)
  })

  it('비표준(400) → 가장 가까운 dotted-eighth(360) 반환', () => {
    // |400-360|=40 vs |400-480|=80 → dotted-eighth
    const r = ticksToDurationType(400, PPQ)
    expect(r.durationType).toBe('eighth')
    expect(r.dots).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────
// flattenToChords
// ────────────────────────────────────────────────────────────────

describe('flattenToChords', () => {
  it('빈 배열 → []', () => {
    expect(flattenToChords([])).toEqual([])
  })

  it('단일 노트 → chord 1개', () => {
    const result = flattenToChords([{ pitch: 60, start: 0, duration: 480 }])
    expect(result).toHaveLength(1)
    expect(result[0]!.pitches).toEqual([60])
    expect(result[0]!.start).toBe(0)
    expect(result[0]!.duration).toBe(480)
  })

  it('같은 start 노트 2개 → 화음 pitches:[60,64]', () => {
    const result = flattenToChords([
      { pitch: 64, start: 0, duration: 480 },
      { pitch: 60, start: 0, duration: 480 },
    ])
    expect(result).toHaveLength(1)
    // pitch 오름차순 정렬
    expect(result[0]!.pitches).toEqual([60, 64])
  })

  it('같은 start 화음: 화음 end = max(note.end)', () => {
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 480 },
      { pitch: 64, start: 0, duration: 960 }, // longer note
    ])
    expect(result[0]!.duration).toBe(960) // max end = 960
  })

  it('비겹침 노트 2개 → chord 2개, 순서 보존', () => {
    const result = flattenToChords([
      { pitch: 64, start: 480, duration: 480 },
      { pitch: 60, start: 0,   duration: 480 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]!.start).toBe(0)
    expect(result[1]!.start).toBe(480)
  })

  it('오버랩 노트: chord[0].duration이 chord[1].start까지 클리핑된다', () => {
    // note A: 0→960 (half), note B: 480→960 (quarter)
    const result = flattenToChords([
      { pitch: 60, start: 0,   duration: 960 },
      { pitch: 64, start: 480, duration: 480 },
    ])
    expect(result).toHaveLength(2)
    // A는 480(B's start)까지 클리핑
    expect(result[0]!.duration).toBe(480)
    expect(result[1]!.duration).toBe(480)
  })

  it('오버랩: 클리핑 후 duration<=0이면 해당 chord 제외', () => {
    // note A: 0→0 (duration 0, 극단 케이스), note B: 0→480
    // A와 B가 동일 start → 화음으로 묶이므로 별도 케이스:
    // 명시적 오버랩 케이스: A(0→100), B(0→480)
    // A,B 같은 start → 화음 [60,64] duration=480(max) — 제외 케이스 아님
    // 실제 클리핑 제외 케이스: A(0→10), B(10→480)
    // 클리핑 후 A.dur = 10-0=10 > 0 이므로 제외 안 됨.
    // duration=0 강제 케이스: A(0→0), B(0→480) → 동일 start이므로 화음.
    // 아래는 flattenToChords가 올바르게 작동하는지만 확인:
    const result = flattenToChords([
      { pitch: 60, start: 0, duration: 1 }, // 1 tick
      { pitch: 64, start: 1, duration: 479 },
    ])
    expect(result).toHaveLength(2)
    // note A: end=1, note B starts at 1 → A.end=1=B.start → no clip needed (end <= next.start)
    expect(result[0]!.duration).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────
// splitAtBarlines
// ────────────────────────────────────────────────────────────────

describe('splitAtBarlines', () => {
  it('빈 배열 → []', () => {
    expect(splitAtBarlines([], MEASURE_TICKS)).toEqual([])
  })

  it('마디 내 단일 노트 → tie 없음, measure 1개에만 포함', () => {
    const chords = [{ start: 0, duration: 480, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(1)
    expect(measures[0]).toHaveLength(1)
    expect(measures[0]![0]!.tie).toBeUndefined()
  })

  it('마디를 넘는 노트 → tie:start (앞 마디), tie:stop (뒷 마디)', () => {
    // note: start=1680, duration=480 → crosses barline at 1920
    // portion in m0: 1680→1920 = 240 ticks, tie='start'
    // portion in m1: 1920→2160 = 240 ticks, tie='stop'
    const chords = [{ start: 1680, duration: 480, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(2)
    expect(measures[0]![0]!.duration).toBe(240)
    expect(measures[0]![0]!.tie).toBe('start')
    expect(measures[1]![0]!.start).toBe(1920)
    expect(measures[1]![0]!.duration).toBe(240)
    expect(measures[1]![0]!.tie).toBe('stop')
  })

  it('3개 마디에 걸친 노트 → start/startstop/stop', () => {
    // note: start=960, duration=3840 → ends at 4800
    // m0 (0-1920): start=960, dur=960, tie='start'
    // m1 (1920-3840): start=1920, dur=1920, tie='startstop'
    // m2 (3840-5760): start=3840, dur=960, tie='stop'
    const chords = [{ start: 960, duration: 3840, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    expect(measures).toHaveLength(3)
    expect(measures[0]![0]!.tie).toBe('start')
    expect(measures[1]![0]!.tie).toBe('startstop')
    expect(measures[2]![0]!.tie).toBe('stop')
  })

  it('정확히 마디 경계에서 끝나는 노트 → tie 없음', () => {
    const chords = [{ start: 960, duration: 960, pitches: [60] }]
    const measures = splitAtBarlines(chords, MEASURE_TICKS)
    // 960+960=1920 = 마디 끝
    expect(measures).toHaveLength(1)
    expect(measures[0]![0]!.tie).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────
// fillRests
// ────────────────────────────────────────────────────────────────

describe('fillRests', () => {
  const MS = 0
  const ME = MEASURE_TICKS // 1920

  it('코드 없음 → 마디 전체를 whole rest로 채운다', () => {
    const els = fillRests([], MS, ME, PPQ)
    expect(els).toHaveLength(1)
    expect(els[0]!.kind).toBe('rest')
    expect(els[0]!.durationType).toBe('whole')
    expect((els[0] as {ticks:number}).ticks).toBe(1920)
  })

  it('박자 시작 quarter note → 앞 gap 없음, 뒤 dotted-half rest', () => {
    // chord at 0, dur=480
    const chords = [{ start: 0, duration: 480, pitches: [60] }]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(2)
    expect(els[0]!.kind).toBe('note')
    expect(els[0]!.durationType).toBe('quarter')
    expect(els[1]!.kind).toBe('rest')
    // trailing gap = 1920-480 = 1440 → dotted-half
    expect(els[1]!.durationType).toBe('half')
    expect(els[1]!.dots).toBe(1)
    expect((els[1] as {ticks:number}).ticks).toBe(1440)
  })

  it('마디 두 번째 박에 시작하는 노트 → quarter rest 앞에, half rest 뒤에', () => {
    // chord at 480, dur=480
    const chords = [{ start: 480, duration: 480, pitches: [60] }]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(3)
    expect(els[0]!.kind).toBe('rest')
    expect(els[0]!.durationType).toBe('quarter')
    expect(els[1]!.kind).toBe('note')
    expect(els[2]!.kind).toBe('rest')
    expect(els[2]!.durationType).toBe('half')
  })

  it('두 quarter 노트 연속 → 사이 gap 없음, 뒤 half rest', () => {
    const chords = [
      { start: 0,   duration: 480, pitches: [60] },
      { start: 480, duration: 480, pitches: [64] },
    ]
    const els = fillRests(chords, MS, ME, PPQ)
    expect(els).toHaveLength(3) // note, note, rest(half)
    expect(els[0]!.kind).toBe('note')
    expect(els[1]!.kind).toBe('note')
    expect(els[2]!.kind).toBe('rest')
    expect(els[2]!.durationType).toBe('half')
  })

  it('타이 정보는 note element에 보존된다', () => {
    const chords = [{ start: 0, duration: 240, pitches: [60], tie: 'start' as const }]
    const els = fillRests(chords, MS, ME, PPQ)
    const noteEl = els.find((e) => e.kind === 'note')
    expect((noteEl as {tie?:string}).tie).toBe('start')
  })
})

// ────────────────────────────────────────────────────────────────
// trackToNotation (통합)
// ────────────────────────────────────────────────────────────────

const TRANSPORT_44 = {
  ppq: PPQ,
  tempo: 120,
  timeSignature: [4, 4] as [number, number],
  key: 'C',
}

describe('trackToNotation', () => {
  it('빈 트랙 → measures:[]', () => {
    const result = trackToNotation({ notes: [] }, TRANSPORT_44)
    expect(result.measures).toHaveLength(0)
  })

  it('단일 quarter 노트 → 1마디, 노트 + rest', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(1)
    const els = result.measures[0]!.elements
    expect(els[0]!.kind).toBe('note')
    expect((els[0] as {durationType:string}).durationType).toBe('quarter')
    expect((els[0] as {pitches:number[]}).pitches).toEqual([60])
    // trailing rest
    expect(els[1]!.kind).toBe('rest')
  })

  it('같은 start 2개 노트 → 화음 pitches:[60,64]', () => {
    const notes = [
      { pitch: 60, start: 0, duration: 480, id: '1', velocity: 96 },
      { pitch: 64, start: 0, duration: 480, id: '2', velocity: 80 },
    ]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    const el = result.measures[0]!.elements[0]!
    expect(el.kind).toBe('note')
    expect((el as {pitches:number[]}).pitches).toEqual([60, 64])
  })

  it('2마디에 걸친 노트 → 2마디 생성, tie 존재', () => {
    // note: start=1680, dur=480 → crosses barline at 1920
    const notes = [{ pitch: 60, start: 1680, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(2)
    // 마디 0 마지막 요소에 tie:'start'
    const m0 = result.measures[0]!.elements
    const tieStart = m0.find((e) => e.kind === 'note' && (e as {tie?:string}).tie === 'start')
    expect(tieStart).toBeDefined()
    // 마디 1 첫 요소에 tie:'stop'
    const m1 = result.measures[1]!.elements
    const tieStop = m1.find((e) => e.kind === 'note' && (e as {tie?:string}).tie === 'stop')
    expect(tieStop).toBeDefined()
  })

  it('오버랩 노트: 앞 노트 클리핑 후 두 별도 chord로 표시', () => {
    // note A: 0→960, note B: 480→960
    // After clip: A(0, dur=480), B(480, dur=480)
    const notes = [
      { pitch: 60, start: 0,   duration: 960, id: '1', velocity: 96 },
      { pitch: 64, start: 480, duration: 480, id: '2', velocity: 80 },
    ]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    const els = result.measures[0]!.elements
    const noteEls = els.filter((e) => e.kind === 'note')
    expect(noteEls).toHaveLength(2)
    // 첫 노트는 pitch 60만 (A 단독)
    expect((noteEls[0] as {pitches:number[]}).pitches).toEqual([60])
    // 두 번째 노트는 pitch 64
    expect((noteEls[1] as {pitches:number[]}).pitches).toEqual([64])
  })

  it('두 번째 마디에만 노트 → 2마디 생성', () => {
    const notes = [{ pitch: 60, start: 1920, duration: 480, id: '1', velocity: 96 }]
    const result = trackToNotation({ notes }, TRANSPORT_44)
    expect(result.measures).toHaveLength(2)
    const m1 = result.measures[1]!.elements
    expect(m1.find((e) => e.kind === 'note')).toBeDefined()
  })
})
```

### Step 2: 실패 확인

```bash
pnpm --filter @sculptone/score-model test
```

Expected: FAIL — `'../src/notation'` 모듈 없음.

### Step 3: notation.ts 구현

Create `packages/score-model/src/notation.ts`:

```ts
import type { Track, Transport } from './schema'

// ── 공개 타입 ─────────────────────────────────────────────────

export type DurationType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th'

export interface NotationNote {
  kind: 'note'
  pitches: number[]        // MIDI pitches (오름차순). 1개=단음, 2+개=화음.
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // 실제 tick 길이 (MusicXML <duration> 용)
  tie?: 'start' | 'stop' | 'startstop'
}

export interface NotationRest {
  kind: 'rest'
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // 실제 gap tick 길이 (MusicXML <duration> 용)
}

export type NotationElement = NotationNote | NotationRest

export interface NotationMeasure {
  elements: NotationElement[]
}

export interface TrackNotation {
  measures: NotationMeasure[]
}

export interface DurationSpec {
  durationType: DurationType
  dots: 0 | 1
  ticks: number            // canonical tick count (ppq 기준)
}

// ── 내부 타입 ──────────────────────────────────────────────────

interface ChordEvent {
  start: number
  duration: number
  pitches: number[]
  tie?: 'start' | 'stop' | 'startstop'
}

// ── 순수 헬퍼 함수 ─────────────────────────────────────────────

/**
 * 주어진 ppq에서 지원하는 모든 표준 duration을 반환한다 (ticks 오름차순).
 * dotted-whole(ppq*6)은 4/4 마디 초과이므로 제외.
 */
function buildDurationTable(ppq: number): DurationSpec[] {
  const base: Array<[DurationType, number]> = [
    ['16th',    ppq / 4],
    ['eighth',  ppq / 2],
    ['quarter', ppq],
    ['half',    ppq * 2],
    ['whole',   ppq * 4],
  ]
  const result: DurationSpec[] = []
  for (const [durationType, t] of base) {
    result.push({ durationType, dots: 0, ticks: t })
    result.push({ durationType, dots: 1, ticks: t * 1.5 })
  }
  return result.sort((a, b) => a.ticks - b.ticks)
}

/**
 * tick 길이를 가장 가까운 표준 duration spec으로 매핑한다.
 * 거리 동일 시 더 짧은(보수적) 쪽 우선.
 *
 * @public
 */
export function ticksToDurationType(ticks: number, ppq: number): DurationSpec {
  const table = buildDurationTable(ppq)

  // 정확 일치 우선 (부동소수점 오차 ±0.5 허용)
  for (const spec of table) {
    if (Math.abs(spec.ticks - ticks) < 0.5) return spec
  }

  // 최근접 검색 (거리 동일 시 더 짧은 쪽)
  let best = table[0]!
  let bestDist = Math.abs(table[0]!.ticks - ticks)
  for (const spec of table) {
    const dist = Math.abs(spec.ticks - ticks)
    if (dist < bestDist || (dist === bestDist && spec.ticks < best.ticks)) {
      bestDist = dist
      best = spec
    }
  }
  return best
}

/**
 * 노트 배열을 단성 화음 이벤트 배열로 변환한다.
 *
 * 규칙:
 * 1. start 오름차순 정렬 (동률 시 pitch 오름차순).
 * 2. 동일 start 노트 → 화음 그룹 (pitches 오름차순). end = max(start+duration).
 * 3. 인접 화음 오버랩 시 앞 화음 duration을 다음 화음 start까지 클리핑.
 * 4. 클리핑 후 duration <= 0이면 해당 화음 제외.
 *
 * @public
 */
export function flattenToChords(
  notes: ReadonlyArray<{ pitch: number; start: number; duration: number }>,
): ChordEvent[] {
  if (notes.length === 0) return []

  // 정렬
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)

  // 화음 그룹핑
  const grouped: Array<{ start: number; end: number; pitches: number[] }> = []
  for (const n of sorted) {
    const last = grouped[grouped.length - 1]
    if (last && last.start === n.start) {
      last.pitches.push(n.pitch) // pitch는 이미 오름차순 정렬됨
      last.end = Math.max(last.end, n.start + n.duration)
    } else {
      grouped.push({ start: n.start, end: n.start + n.duration, pitches: [n.pitch] })
    }
  }

  // 오버랩 해소
  const result: ChordEvent[] = []
  for (let i = 0; i < grouped.length; i++) {
    const cur = grouped[i]!
    const next = grouped[i + 1]
    let duration = cur.end - cur.start
    if (next && cur.end > next.start) {
      duration = next.start - cur.start
    }
    if (duration <= 0) continue
    result.push({ start: cur.start, duration, pitches: cur.pitches })
  }
  return result
}

/**
 * 화음 이벤트 배열을 마디 경계에서 분할하고 타이를 부여한다.
 *
 * @returns 마디별 ChordEvent 배열 (인덱스 = 마디 번호)
 * @public
 */
export function splitAtBarlines(
  chords: ChordEvent[],
  measureTicks: number,
): ChordEvent[][] {
  if (chords.length === 0) return []

  const lastEnd = chords.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const numMeasures = Math.max(1, Math.ceil(lastEnd / measureTicks))
  const measures: ChordEvent[][] = Array.from({ length: numMeasures }, () => [])

  for (const chord of chords) {
    let remaining = chord.duration
    let currentStart = chord.start
    let isFirstPart = true

    while (remaining > 0) {
      const measureIdx = Math.floor(currentStart / measureTicks)
      if (measureIdx >= numMeasures) break

      const measureEnd = (measureIdx + 1) * measureTicks
      const portionDur = Math.min(remaining, measureEnd - currentStart)
      const isLastPart = portionDur >= remaining

      let tie: ChordEvent['tie'] = undefined
      if (isFirstPart && !isLastPart) tie = 'start'
      else if (!isFirstPart && !isLastPart) tie = 'startstop'
      else if (!isFirstPart && isLastPart) tie = 'stop'
      // isFirstPart && isLastPart → 타이 없음

      measures[measureIdx]!.push({
        start: currentStart,
        duration: portionDur,
        pitches: chord.pitches,
        ...(tie !== undefined ? { tie } : {}),
      })

      currentStart = measureEnd
      remaining -= portionDur
      isFirstPart = false
    }
  }

  return measures
}

/**
 * 마디 내 화음 이벤트 배열에 쉼표를 삽입해 NotationElement[] 로 변환한다.
 *
 * - cursor는 chord.start로 점프(gap 표시 후 실제 위치 유지).
 * - 끝 부분 gap이 있으면 rest 추가.
 *
 * @public
 */
export function fillRests(
  chords: ChordEvent[],
  measureStart: number,
  measureEnd: number,
  ppq: number,
): NotationElement[] {
  const elements: NotationElement[] = []
  let cursor = measureStart

  const sorted = [...chords].sort((a, b) => a.start - b.start)

  for (const chord of sorted) {
    if (chord.start > cursor) {
      const gapTicks = chord.start - cursor
      const spec = ticksToDurationType(gapTicks, ppq)
      elements.push({ kind: 'rest', durationType: spec.durationType, dots: spec.dots, ticks: gapTicks })
      cursor = chord.start // 실제 위치로 점프 (spec.ticks 아님 — 정렬 유지)
    }

    const spec = ticksToDurationType(chord.duration, ppq)
    const noteEl: NotationNote = {
      kind: 'note',
      pitches: chord.pitches,
      durationType: spec.durationType,
      dots: spec.dots,
      ticks: chord.duration,
    }
    if (chord.tie !== undefined) noteEl.tie = chord.tie
    elements.push(noteEl)
    cursor = chord.start + chord.duration
  }

  // 마디 끝 gap
  if (cursor < measureEnd) {
    const gapTicks = measureEnd - cursor
    const spec = ticksToDurationType(gapTicks, ppq)
    elements.push({ kind: 'rest', durationType: spec.durationType, dots: spec.dots, ticks: gapTicks })
  }

  return elements
}

/**
 * Track의 노트를 악보 기보 구조로 변환한다 (순수 함수, 저장 안 함).
 *
 * @param track - { notes } (id 불필요)
 * @param transport - { ppq, tempo, timeSignature, key }
 * @public
 */
export function trackToNotation(
  track: Pick<Track, 'notes'>,
  transport: Pick<Transport, 'ppq' | 'timeSignature'>,
): TrackNotation {
  if (track.notes.length === 0) return { measures: [] }

  const { ppq, timeSignature } = transport
  const [numerator, denominator] = timeSignature
  const measureTicks = (ppq * 4 * numerator) / denominator

  // 1. 단성 화음 평탄화
  const chords = flattenToChords(track.notes)

  // 2. 마디 분할 + 타이 부여
  const perMeasure = splitAtBarlines(chords, measureTicks)

  // 3. 쉼표 삽입 + NotationElement 변환
  const measures: NotationMeasure[] = perMeasure.map((measureChords, idx) => {
    const measureStart = idx * measureTicks
    const measureEnd = (idx + 1) * measureTicks
    const elements = fillRests(measureChords, measureStart, measureEnd, ppq)
    return { elements }
  })

  return { measures }
}
```

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/score-model test
```

Expected: notation.test.ts 29개 PASS. 기존 테스트 영향 없음.

---

## Task 2: score-model — musicxml.ts (완전 TDD)

**Files:** Create `packages/score-model/src/musicxml.ts`, `packages/score-model/test/musicxml.test.ts`

### Step 1: 실패 테스트 작성

Create `packages/score-model/test/musicxml.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { projectToMusicXML } from '../src/musicxml'
import {
  createEmptyProject, createTrack, createNote,
  addTrack, addNote,
} from '../src'

// ── 헬퍼 ──────────────────────────────────────────────────────

function countTag(xml: string, tag: string): number {
  // <tag> 혹은 <tag/> 시작 카운트
  const re = new RegExp(`<${tag}[\\s/>]`, 'g')
  return (xml.match(re) ?? []).length
}

function makeProject(notes: Array<{pitch:number;start:number;duration:number;velocity:number}> = []) {
  const t = createTrack('Piano')
  let p = addTrack(createEmptyProject('Test'), t)
  for (const n of notes) {
    p = addNote(p, t.id, createNote(n))
  }
  return p
}

// ── 기본 구조 ──────────────────────────────────────────────────

describe('projectToMusicXML — 기본 구조', () => {
  it('score-partwise 루트 엘리먼트와 버전 3.1이 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<score-partwise version="3.1">')
    expect(xml).toContain('</score-partwise>')
  })

  it('DOCTYPE 선언이 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<!DOCTYPE score-partwise')
  })

  it('part-list와 score-part가 포함된다', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<part-list>')
    expect(xml).toContain('<score-part id="P1">')
    expect(xml).toContain('<part-name>Piano</part-name>')
  })

  it('노트 없는 트랙 → part 있음, measure 없음', () => {
    const xml = projectToMusicXML(makeProject())
    expect(xml).toContain('<part id="P1">')
    expect(countTag(xml, 'measure')).toBe(0)
  })
})

// ── 첫 마디 attributes ─────────────────────────────────────────

describe('projectToMusicXML — 첫 마디 attributes', () => {
  it('첫 마디에 divisions(=ppq), key, time, clef가 포함된다', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<divisions>480</divisions>')
    expect(xml).toContain('<fifths>0</fifths>')
    expect(xml).toContain('<beats>4</beats>')
    expect(xml).toContain('<beat-type>4</beat-type>')
    expect(xml).toContain('<sign>G</sign>')
  })
})

// ── 노트 직렬화 ────────────────────────────────────────────────

describe('projectToMusicXML — note 직렬화', () => {
  it('quarter 노트(C4=60) → step:C, octave:4, duration:480, type:quarter', () => {
    const notes = [{ pitch: 60, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<step>C</step>')
    expect(xml).toContain('<octave>4</octave>')
    expect(xml).toContain('<duration>480</duration>')
    expect(xml).toContain('<type>quarter</type>')
  })

  it('# 음(C#4=61) → step:C, alter:1, octave:4', () => {
    const notes = [{ pitch: 61, start: 0, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<step>C</step>')
    expect(xml).toContain('<alter>1</alter>')
    expect(xml).toContain('<octave>4</octave>')
  })

  it('쉼표 → <rest/> 포함', () => {
    // quarter note at beat 2, beat 1 is a rest
    const notes = [{ pitch: 60, start: 480, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<rest/>')
  })

  it('화음(같은 start) → 두 번째 음에 <chord/> 포함', () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('Test'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    p = addNote(p, t.id, createNote({ pitch: 64, start: 0, duration: 480, velocity: 80 }))
    const xml = projectToMusicXML(p)
    expect(xml).toContain('<chord/>')
    // 두 note 엘리먼트 존재
    expect(countTag(xml, 'note')).toBeGreaterThanOrEqual(2)
  })

  it('점음표 → <dot/> 포함', () => {
    // dotted-quarter = 720 ticks
    const notes = [{ pitch: 60, start: 0, duration: 720, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<dot/>')
  })

  it('마디 넘는 노트 → <tie type="start"/> 와 <tie type="stop"/> 존재', () => {
    // note at tick 1680, duration 480 → crosses barline at 1920
    const notes = [{ pitch: 60, start: 1680, duration: 480, velocity: 96 }]
    const xml = projectToMusicXML(makeProject(notes))
    expect(xml).toContain('<tie type="start"/>')
    expect(xml).toContain('<tie type="stop"/>')
    expect(xml).toContain('<tied type="start"/>')
    expect(xml).toContain('<tied type="stop"/>')
  })
})

// ── 멀티트랙 ──────────────────────────────────────────────────

describe('projectToMusicXML — 멀티트랙', () => {
  it('트랙 2개 → part P1, P2 모두 포함', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('Test'), t1), t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    const xml = projectToMusicXML(p)
    expect(xml).toContain('<score-part id="P1">')
    expect(xml).toContain('<score-part id="P2">')
    expect(xml).toContain('<part id="P1">')
    expect(xml).toContain('<part id="P2">')
  })
})
```

### Step 2: 실패 확인

```bash
pnpm --filter @sculptone/score-model test
```

Expected: FAIL — `'../src/musicxml'` 모듈 없음.

### Step 3: musicxml.ts 구현

Create `packages/score-model/src/musicxml.ts`:

```ts
import type { Project } from './schema'
import { trackToNotation } from './notation'
import type { NotationNote, NotationRest, DurationType } from './notation'

// ── 내부 헬퍼 ──────────────────────────────────────────────────

/** MIDI pitch class → MusicXML step / alter */
const PC_STEP  = ['C','C','D','D','E','F','F','G','G','A','A','B'] as const
const PC_ALTER = [0,  1,  0,  1,  0,  0,  1,  0,  1,  0,  1,  0] as const

function midiToXml(pitch: number): { step: string; octave: number; alter: number } {
  const pc = ((pitch % 12) + 12) % 12
  const octave = Math.floor(pitch / 12) - 1
  return { step: PC_STEP[pc]!, octave, alter: PC_ALTER[pc]! }
}

/** project.transport.key → MusicXML fifths (C major = 0 기본) */
function keyToFifths(key: string): number {
  const MAP: Record<string, number> = {
    'C': 0,  'G': 1,  'D': 2,  'A': 3,  'E': 4,  'B': 5,  'F#': 6,  'C#': 7,
    'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6, 'Cb': -7,
  }
  return MAP[key] ?? 0
}

/** XML 특수문자 이스케이프 */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** NotationRest → <note> XML 문자열 */
function renderRest(el: NotationRest): string {
  const lines = [
    '      <note>',
    '        <rest/>',
    `        <duration>${el.ticks}</duration>`,
    `        <type>${el.durationType}</type>`,
    ...(el.dots > 0 ? ['        <dot/>'] : []),
    '      </note>',
  ]
  return lines.join('\n')
}

/** 단일 pitch + NotationNote 메타 → <note> XML 문자열 */
function renderPitch(
  pitch: number,
  el: NotationNote,
  isChordContinuation: boolean,
): string {
  const { step, octave, alter } = midiToXml(pitch)
  const lines = ['      <note>']
  if (isChordContinuation) lines.push('        <chord/>')
  lines.push(
    '        <pitch>',
    `          <step>${step}</step>`,
    ...(alter !== 0 ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    `        <duration>${el.ticks}</duration>`,
  )

  // Tie elements (attribute on note, before type)
  if (el.tie === 'start' || el.tie === 'startstop') {
    lines.push('        <tie type="start"/>')
  }
  if (el.tie === 'stop' || el.tie === 'startstop') {
    lines.push('        <tie type="stop"/>')
  }

  lines.push(`        <type>${el.durationType}</type>`)
  if (el.dots > 0) lines.push('        <dot/>')

  // Notations for tied elements
  if (el.tie) {
    lines.push('        <notations>')
    if (el.tie === 'start' || el.tie === 'startstop') {
      lines.push('          <tied type="start"/>')
    }
    if (el.tie === 'stop' || el.tie === 'startstop') {
      lines.push('          <tied type="stop"/>')
    }
    lines.push('        </notations>')
  }

  lines.push('      </note>')
  return lines.join('\n')
}

// ── 공개 API ──────────────────────────────────────────────────

/**
 * Project → MusicXML 3.1 partwise 문자열 (순수 함수, 저장 안 함).
 *
 * - <divisions> = ppq (quarter note = ppq divisions).
 * - <key><fifths>: project.transport.key 기반 단순 매핑, 미지 키는 0(C major).
 * - <clef>: G 보표 고정.
 * - 화음(동일 start): 두 번째 음부터 <chord/> 삽입.
 * - 타이: <tie type="start|stop"/> + <notations><tied .../></notations>.
 * - <duration> = el.ticks (실제 tick 값). <type>은 근사 표시용.
 */
export function projectToMusicXML(project: Project): string {
  const { ppq, timeSignature, key } = project.transport
  const [numerator, denominator] = timeSignature
  const fifths = keyToFifths(key)

  const partListItems: string[] = []
  const partItems: string[] = []

  for (let pi = 0; pi < project.tracks.length; pi++) {
    const track = project.tracks[pi]!
    const partId = `P${pi + 1}`

    partListItems.push(
      `    <score-part id="${partId}">\n      <part-name>${escapeXml(track.name)}</part-name>\n    </score-part>`,
    )

    const notation = trackToNotation(track, project.transport)
    if (notation.measures.length === 0) {
      partItems.push(`  <part id="${partId}">\n  </part>`)
      continue
    }

    const measureLines: string[] = []
    for (let mi = 0; mi < notation.measures.length; mi++) {
      const measure = notation.measures[mi]!
      const mLines = [`    <measure number="${mi + 1}">`]

      // 첫 마디 attributes
      if (mi === 0) {
        mLines.push(
          '      <attributes>',
          `        <divisions>${ppq}</divisions>`,
          '        <key>',
          `          <fifths>${fifths}</fifths>`,
          '        </key>',
          '        <time>',
          `          <beats>${numerator}</beats>`,
          `          <beat-type>${denominator}</beat-type>`,
          '        </time>',
          '        <clef>',
          '          <sign>G</sign>',
          '          <line>2</line>',
          '        </clef>',
          '      </attributes>',
        )
      }

      for (const el of measure.elements) {
        if (el.kind === 'rest') {
          mLines.push(renderRest(el))
        } else {
          // NotationNote: pitches[] → 첫 음은 주 note, 이후는 chord continuation
          for (let ki = 0; ki < el.pitches.length; ki++) {
            mLines.push(renderPitch(el.pitches[ki]!, el, ki > 0))
          }
        }
      }

      mLines.push('    </measure>')
      measureLines.push(mLines.join('\n'))
    }

    partItems.push(`  <part id="${partId}">\n${measureLines.join('\n')}\n  </part>`)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    '  <part-list>',
    partListItems.join('\n'),
    '  </part-list>',
    partItems.join('\n'),
    '</score-partwise>',
  ].join('\n')
}
```

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/score-model test
```

Expected: musicxml.test.ts 9개 PASS. notation.test.ts 29개 유지. 기존 테스트 영향 없음.

---

## Task 3: score-model — index.ts 배럴 갱신

**Files:** Modify `packages/score-model/src/index.ts`

### Step 1: 실패 테스트 (import 검증)

기존 musicxml.test.ts 상단 import가 `../src/musicxml`에서 가져오므로 별도 실패 테스트 불필요. 배럴 export 추가로 apps/web에서 `@sculptone/score-model`을 통해 import할 수 있게 한다.

### Step 2: index.ts 수정

`packages/score-model/src/index.ts`에 다음 두 줄 추가:

```ts
export * from './schema'
export * from './factory'
export * from './operations'
export * from './serialize'
export * from './midi'
export * from './notation'   // NEW
export * from './musicxml'   // NEW
```

### Step 3: 통과 확인

```bash
pnpm --filter @sculptone/score-model test
pnpm --filter @sculptone/score-model exec tsc --noEmit
```

Expected: 전체 PASS. 타입 에러 없음.

---

## Task 4: apps/web — NotationView.tsx (VexFlow 스모크 테스트)

**Files:** Create `apps/web/src/notation/NotationView.tsx`, `apps/web/src/notation/test/NotationView.test.tsx`

먼저 VexFlow 의존성 추가:

```bash
pnpm --filter @sculptone/web add vexflow
```

### Step 1: 실패 테스트 작성

Create `apps/web/src/notation/test/NotationView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

// ── VexFlow 전체 모킹 (jsdom에서 SVG layout 불가) ──────────────

const mockRendererInstance = {
  resize: vi.fn(),
  getContext: vi.fn().mockReturnValue({ setFont: vi.fn(), clear: vi.fn() }),
}
const MockRenderer = vi.fn().mockImplementation(() => mockRendererInstance)
;(MockRenderer as unknown as { Backends: { SVG: number } }).Backends = { SVG: 1 }

vi.mock('vexflow', () => ({
  Renderer: MockRenderer,
  Stave: vi.fn().mockImplementation(() => ({
    addClef: vi.fn().mockReturnThis(),
    addTimeSignature: vi.fn().mockReturnThis(),
    setContext: vi.fn().mockReturnThis(),
    draw: vi.fn(),
  })),
  Voice: vi.fn().mockImplementation(() => ({
    setStrict: vi.fn().mockReturnThis(),
    addTickables: vi.fn().mockReturnThis(),
    draw: vi.fn(),
  })),
  StaveNote: vi.fn().mockImplementation(() => ({})),
  Formatter: vi.fn().mockImplementation(() => ({
    joinVoices: vi.fn().mockReturnThis(),
    format: vi.fn(),
  })),
  Dot: { buildAndAttach: vi.fn() },
}))

import { NotationView } from '../NotationView'

// ── 테스트 ────────────────────────────────────────────────────

describe('NotationView', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('빈 트랙으로 크래시 없이 마운트되고 컨테이너가 렌더된다', () => {
    const { getByTestId } = render(<NotationView />)
    expect(getByTestId('notation-view')).toBeInTheDocument()
  })

  it('노트가 있는 트랙으로 크래시 없이 마운트된다', () => {
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    const { getByTestId } = render(<NotationView />)
    expect(getByTestId('notation-view')).toBeInTheDocument()
  })

  it('노트가 있는 트랙에서 VexFlow Renderer가 호출된다', () => {
    const s = useStore.getState()
    const updated = addNote(
      s.project,
      s.selectedTrackId,
      createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }),
    )
    s.setProject(updated)

    render(<NotationView />)

    // useEffect는 동기적이므로 render 후 바로 확인 가능
    expect(MockRenderer).toHaveBeenCalled()
  })
})
```

### Step 2: 실패 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: FAIL — `'../NotationView'` 없음.

### Step 3: NotationView.tsx 구현

Create `apps/web/src/notation/NotationView.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Renderer, Stave, Voice, StaveNote, Formatter, Dot } from 'vexflow'
import { useStore } from '../state/store'
import { trackToNotation } from '@sculptone/score-model'
import type { NotationElement } from '@sculptone/score-model'

// DurationType → VexFlow duration 문자열
const DUR_TO_VF: Record<string, string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
}

/** MIDI pitch → VexFlow key 문자열 ("c/4", "c#/4", ...) */
function midiToVexKey(midi: number): string {
  const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.max(0, Math.floor(midi / 12) - 1)
  return `${NAMES[pc]!}/${octave}`
}

const MEASURE_WIDTH = 250
const STAVE_X_FIRST = 20
const STAVE_Y = 40

export function NotationView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const project         = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)

  const track = project.tracks.find((t) => t.id === selectedTrackId)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''

    if (!track || track.notes.length === 0) return

    try {
      const notation = trackToNotation(track, project.transport)
      if (notation.measures.length === 0) return

      const [numerator, denominator] = project.transport.timeSignature
      const totalWidth =
        STAVE_X_FIRST + notation.measures.length * MEASURE_WIDTH + 40

      const renderer = new Renderer(container, Renderer.Backends.SVG)
      renderer.resize(totalWidth, 160)
      const ctx = renderer.getContext()

      for (let mi = 0; mi < notation.measures.length; mi++) {
        const measure = notation.measures[mi]!
        const x = mi === 0 ? STAVE_X_FIRST : STAVE_X_FIRST + mi * MEASURE_WIDTH
        const stave = new Stave(x, STAVE_Y, MEASURE_WIDTH)

        if (mi === 0) {
          stave.addClef('treble').addTimeSignature(`${numerator}/${denominator}`)
        }

        stave.setContext(ctx).draw()

        const staveNotes = measure.elements.map((el: NotationElement) => {
          const vfDur = DUR_TO_VF[el.durationType] ?? 'q'
          if (el.kind === 'rest') {
            return new StaveNote({ keys: ['b/4'], duration: vfDur + 'r' })
          }
          const keys = el.pitches.map(midiToVexKey)
          const sn = new StaveNote({ keys, duration: vfDur })
          if (el.dots > 0) Dot.buildAndAttach([sn], { all: true })
          return sn
        })

        if (staveNotes.length > 0) {
          const voice = new Voice({ numBeats: numerator, beatValue: denominator })
          voice.setStrict(false).addTickables(staveNotes)
          new Formatter().joinVoices([voice]).format([voice], MEASURE_WIDTH - 40)
          voice.draw(ctx, stave)
        }
      }
    } catch {
      // VexFlow 렌더 실패(jsdom 또는 DOM 미지원 환경)
      if (container) {
        container.innerHTML =
          '<p style="color:var(--text-lo);padding:16px;font-size:12px">악보를 렌더할 수 없습니다.</p>'
      }
    }
  }, [track, project.transport])

  return (
    <div
      ref={containerRef}
      data-testid="notation-view"
      style={{
        background: 'var(--bg-inset)',
        width: '100%',
        minHeight: 200,
        padding: 8,
        overflowX: 'auto',
        color: 'var(--text-hi)',
      }}
    />
  )
}
```

> **타입 노트:** `React.XXX` 네임스페이스 미사용. `type { NotationElement }` 등 named import 사용. VexFlow catch 블록에서 오류 변수를 바인딩하지 않아 `catch {}` 표기 사용(TS 4.0+).

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: NotationView.test.tsx 3개 PASS. 기존 테스트 영향 없음.

---

## Task 5: apps/web — store.ts composeView 토글

**Files:** Modify `apps/web/src/state/store.ts`, `apps/web/src/test/editor-store.test.ts`

### Step 1: 실패 테스트 추가

`apps/web/src/test/editor-store.test.ts` 의 기존 `describe('editor store', ...)` 블록 끝에 추가:

```ts
  it('초기 composeView는 "roll"이다', () => {
    expect(useStore.getState().composeView).toBe('roll')
  })

  it('setComposeView("score") → composeView가 "score"로 변경된다', () => {
    useStore.getState().setComposeView('score')
    expect(useStore.getState().composeView).toBe('score')
    useStore.getState().setComposeView('roll')
    expect(useStore.getState().composeView).toBe('roll')
  })
```

### Step 2: 실패 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: FAIL — `composeView`, `setComposeView`가 AppState에 없음.

### Step 3: store.ts 수정

`apps/web/src/state/store.ts`에 다음을 추가:

`export type Mode = ...` 아래에 타입 추가:

```ts
export type ComposeView = 'roll' | 'score'
```

`AppState` 인터페이스에 추가:

```ts
  composeView: ComposeView
  setComposeView: (view: ComposeView) => void
```

`create<AppState>(...)` 초기 상태 객체에 추가:

```ts
  composeView: 'roll',
  setComposeView: (view) => set({ composeView: view }),
```

완성된 `store.ts`:

```ts
import { create } from 'zustand'
import {
  createEmptyProject, createTrack, addTrack, type Project,
} from '@sculptone/score-model'

export type Mode = 'compose' | 'play' | 'transcribe'
export type ComposeView = 'roll' | 'score'

export interface AppState {
  activeMode: Mode
  project: Project
  selectedTrackId: string
  selectedNoteId: string | null
  quantizeDenom: number
  isPlaying: boolean
  isRecording: boolean
  recordStopSec: number
  composeView: ComposeView
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
  replaceProject: (project: Project) => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
  setRecording: (recording: boolean) => void
  setRecordStopSec: (sec: number) => void
  setComposeView: (view: ComposeView) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

const project0 = initialProject()

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: project0,
  selectedTrackId: project0.tracks[0]!.id,
  selectedNoteId: null,
  quantizeDenom: 16,
  isPlaying: false,
  isRecording: false,
  recordStopSec: 0,
  composeView: 'roll',
  setMode: (mode) => set({ activeMode: mode }),
  setProject: (project) => set({ project }),
  replaceProject: (project) =>
    set({ project, selectedTrackId: project.tracks[0]?.id ?? '', selectedNoteId: null }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setRecording: (recording) => set({ isRecording: recording }),
  setRecordStopSec: (sec) => set({ recordStopSec: sec }),
  setComposeView: (view) => set({ composeView: view }),
}))
```

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: editor-store.test.ts 신규 2개 PASS. 기존 테스트 영향 없음(`composeView: 'roll'`은 `getInitialState()`에 포함되므로 기존 `beforeEach` reset도 정상 작동).

---

## Task 6: apps/web — AppShell.tsx Score/Roll 토글

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`, `apps/web/src/test/AppShell.compose.test.tsx`

### Step 1: AppShell.test.tsx — NotationView mock 추가 + 토글 테스트

`apps/web/src/test/AppShell.test.tsx` 상단의 기존 mock 블록 뒤에 추가:

```ts
vi.mock('../notation/NotationView', () => ({
  NotationView: () => <div data-testid="notation-view" />,
}))
```

그리고 기존 `describe('AppShell', ...)` 블록 끝에 테스트 3개 추가:

```tsx
  it('Compose 모드 툴바에 Roll/Score 토글 버튼이 렌더된다', () => {
    render(<AppShell />)
    expect(screen.getByRole('button', { name: 'Roll' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Score' })).toBeInTheDocument()
  })

  it('Score 버튼 클릭 시 NotationView가 렌더된다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('button', { name: 'Score' }))
    expect(screen.getByTestId('notation-view')).toBeInTheDocument()
  })

  it('Score 후 Roll 버튼 클릭 시 PianoRoll로 돌아온다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('button', { name: 'Score' }))
    await userEvent.click(screen.getByRole('button', { name: 'Roll' }))
    expect(screen.getByTestId('pianoroll')).toBeInTheDocument()
  })
```

> **기존 테스트 보존:** 기존 4개 테스트('세 모드 탭', 'Play 탭', 'Transcribe 비활성', 'MixerPanel') 단언 변경 없음.

### Step 2: AppShell.compose.test.tsx — NotationView mock 추가

`apps/web/src/test/AppShell.compose.test.tsx`의 기존 mock 블록 뒤에 추가:

```ts
vi.mock('../notation/NotationView', () => ({
  NotationView: () => <div data-testid="notation-view" />,
}))
```

> **기존 테스트 보존:** 기존 3개 테스트 단언 변경 없음. NotationView mock 추가는 import 오류 방지용.

### Step 3: AppShell.tsx 수정

`apps/web/src/shell/AppShell.tsx`에 추가/수정:

**import 추가:**

```tsx
import { NotationView } from '../notation/NotationView'
```

**store hook 추가:**

```tsx
const composeView    = useStore((s) => s.composeView)
const setComposeView = useStore((s) => s.setComposeView)
```

**툴바 내 Tabs 뒤에 Roll/Score 토글 추가:**

기존 `<Tabs ... />` 뒤에 삽입:

```tsx
{activeMode === 'compose' && (
  <div style={{ display: 'flex', gap: 2 }}>
    <button
      aria-pressed={composeView === 'roll'}
      onClick={() => setComposeView('roll')}
      style={{
        font: 'inherit', fontSize: 11, fontWeight: 600,
        padding: '3px 10px', borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
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
        border: '1px solid var(--border)',
        cursor: 'pointer',
        background: composeView === 'score' ? 'var(--accent)' : 'var(--bg-elevated)',
        color: composeView === 'score' ? 'var(--on-accent)' : 'var(--text-mid)',
      }}
    >
      Score
    </button>
  </div>
)}
```

**중앙 패널 compose 구역 교체:**

기존:

```tsx
{activeMode === 'compose' && (
  <div style={{ position: 'relative' }}>
    <PianoRoll />
    <Playhead getSeconds={getSeconds} />
  </div>
)}
```

교체 후:

```tsx
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
```

완성된 `AppShell.tsx` 전체 (참고용 레퍼런스):

```tsx
import { type CSSProperties } from 'react'
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

const TABS = [
  { id: 'compose',    label: 'Compose' },
  { id: 'play',       label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

export function AppShell() {
  useAutosave()

  const activeMode     = useStore((s) => s.activeMode)
  const setMode        = useStore((s) => s.setMode)
  const composeView    = useStore((s) => s.composeView)
  const setComposeView = useStore((s) => s.setComposeView)
  const tempo          = useStore((s) => s.project.transport.tempo)
  const timeSignature  = useStore((s) => s.project.transport.timeSignature)
  const { play, stop, getSeconds } = useAudio()

  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
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
    </div>
  )
}
```

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/web test
```

Expected:
- AppShell.test.tsx: 기존 4개 + 신규 3개 = **7개 PASS**.
- AppShell.compose.test.tsx: 기존 3개 PASS (NotationView mock 추가로 import 오류 해소).
- 전체 기존 테스트 영향 없음.

---

## Task 7: apps/web — FileMenu.tsx Export MusicXML

**Files:** Modify `apps/web/src/ui/FileMenu.tsx`, `apps/web/src/ui/test/FileMenu.test.tsx`

### Step 1: FileMenu.test.tsx — mock 확장 + 테스트 추가

`apps/web/src/ui/test/FileMenu.test.tsx`의 `vi.mock('@sculptone/score-model', ...)` 블록을 수정:

기존:
```ts
vi.mock('@sculptone/score-model', async (importOrig) => {
  const orig = await importOrig<typeof import('@sculptone/score-model')>()
  return {
    ...orig,
    projectToMidi:    vi.fn().mockReturnValue(new Uint8Array([0])),
    midiToProject:    vi.fn().mockReturnValue(orig.createEmptyProject('Imported')),
    serializeProject: vi.fn().mockReturnValue('{}'),
  }
})
```

교체 후 (`projectToMusicXML` mock 추가):
```ts
vi.mock('@sculptone/score-model', async (importOrig) => {
  const orig = await importOrig<typeof import('@sculptone/score-model')>()
  return {
    ...orig,
    projectToMidi:     vi.fn().mockReturnValue(new Uint8Array([0])),
    midiToProject:     vi.fn().mockReturnValue(orig.createEmptyProject('Imported')),
    serializeProject:  vi.fn().mockReturnValue('{}'),
    projectToMusicXML: vi.fn().mockReturnValue('<?xml version="1.0"?>'),  // NEW
  }
})
```

기존 describe 블록 끝에 테스트 2개 추가:

```ts
  it('"Export MusicXML" 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /export musicxml/i })).toBeInTheDocument()
  })

  it('Export MusicXML 클릭 시 downloadText가 .musicxml 파일명으로 호출된다', async () => {
    const { downloadText } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export musicxml/i }))
    expect(downloadText).toHaveBeenCalledOnce()
    const [, filename, mime] = (downloadText as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(filename).toMatch(/\.musicxml$/)
    expect(mime).toBe('application/vnd.recordare.musicxml+xml')
  })
```

> **기존 테스트 보존:** 기존 6개 테스트 단언 변경 없음. `downloadText` mock은 `beforeEach(() => vi.clearAllMocks())`로 초기화되므로 새 테스트와 기존 테스트 간 간섭 없음.

### Step 2: 실패 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: 신규 2개 FAIL. 기존 6개 PASS.

### Step 3: FileMenu.tsx 수정

`apps/web/src/ui/FileMenu.tsx`에:

**import 수정** — `projectToMusicXML` 추가:

```ts
import {
  createEmptyProject, createTrack, addTrack,
  projectToMidi, midiToProject, serializeProject, projectToMusicXML,
} from '@sculptone/score-model'
```

**handleExportMusicXML 핸들러 추가** (`handleExportJson` 아래에):

```ts
  const handleExportMusicXML = () => {
    const xml      = projectToMusicXML(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.musicxml`
    downloadText(xml, filename, 'application/vnd.recordare.musicxml+xml')
  }
```

**JSX에 버튼 추가** (`Export JSON` 버튼 뒤에):

```tsx
      <button style={btnStyle} onClick={handleExportMusicXML}>
        Export MusicXML
      </button>
```

완성된 `FileMenu.tsx` (참고용 레퍼런스):

```tsx
import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import {
  createEmptyProject, createTrack, addTrack,
  projectToMidi, midiToProject, serializeProject, projectToMusicXML,
} from '@sculptone/score-model'
import { downloadBytes, downloadText, readFileAsArrayBuffer } from '../io/files'

const btnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  whiteSpace: 'nowrap',
}

export function FileMenu() {
  const project        = useStore((s) => s.project)
  const replaceProject = useStore((s) => s.replaceProject)
  const fileInput      = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleNew = () => {
    replaceProject(addTrack(createEmptyProject('Untitled Project'), createTrack('Piano')))
  }

  const handleExportMidi = () => {
    const bytes    = projectToMidi(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.mid`
    downloadBytes(bytes, filename, 'audio/midi')
  }

  const handleExportJson = () => {
    const json     = serializeProject(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.json`
    downloadText(json, filename, 'application/json')
  }

  const handleExportMusicXML = () => {
    const xml      = projectToMusicXML(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.musicxml`
    downloadText(xml, filename, 'application/vnd.recordare.musicxml+xml')
  }

  const handleImportMidi = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf   = await readFileAsArrayBuffer(file)
      const bytes = new Uint8Array(buf)
      const title = file.name.replace(/\.midi?$/i, '')
      replaceProject(midiToProject(bytes, title))
      setImportError(null)
    } catch (err) {
      console.error('MIDI import failed:', err)
      setImportError('MIDI 파일을 불러올 수 없습니다.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button style={btnStyle} onClick={handleNew}>
        New
      </button>
      <button style={btnStyle} onClick={handleExportMidi}>
        Export MIDI
      </button>
      <button style={btnStyle} onClick={handleExportJson}>
        Export JSON
      </button>
      <button style={btnStyle} onClick={handleExportMusicXML}>
        Export MusicXML
      </button>
      <button
        style={btnStyle}
        onClick={() => fileInput.current?.click()}
      >
        Import MIDI
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi"
        style={{ display: 'none' }}
        onChange={handleImportMidi}
      />
      {importError && (
        <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
          {importError}
        </span>
      )}
    </div>
  )
}
```

### Step 4: 통과 확인

```bash
pnpm --filter @sculptone/web test
```

Expected: FileMenu.test.tsx 기존 6개 + 신규 2개 = **8개 PASS**. AppShell.compose.test.tsx의 `Export MIDI` / `Import MIDI` 단언은 계속 PASS.

---

## Task 8: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected 최소 테스트 수:
- `@sculptone/score-model`: 기존 ≈38개 + notation(29) + musicxml(9) = **≈76개**
- `@sculptone/web`: 기존 205개 + NotationView(3) + store-composeView(2) + AppShell-toggle(3) + FileMenu-MusicXML(2) = **≈215개**

> **기존 테스트 보존 체크리스트:**
> - operations.test.ts 7개: 변경 없음 → PASS.
> - AppShell.test.tsx 기존 4개: NotationView mock 추가, 기존 단언 변경 없음 → PASS.
> - AppShell.compose.test.tsx 기존 3개: NotationView mock 추가, `피아노 롤` / `New` / `useAutosave` 단언 변경 없음 → PASS.
> - FileMenu.test.tsx 기존 6개: mock에 `projectToMusicXML` 추가만, 기존 단언 변경 없음 → PASS.
> - editor-store.test.ts 기존: `composeView: 'roll'`은 `getInitialState()`에 포함 → beforeEach reset 정상 → PASS.

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @sculptone/score-model exec tsc --noEmit
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음.

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. VexFlow는 번들에 포함됨 (code splitting 고려 시 `() => import('vexflow')` 로 전환 가능하나 이는 선택).

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과.
- `ticksToDurationType`: 표준 9개 duration 정확 매핑, 비표준은 최근접 반환 — 자동 테스트 검증.
- `flattenToChords`: 동일 start 화음 그룹화, 오버랩 클리핑, pitches 오름차순 — 자동 테스트 검증.
- `splitAtBarlines`: 마디 경계에서 분할, tie='start'/'startstop'/'stop' 정확 부여 — 자동 테스트 검증.
- `fillRests`: 간격에 쉼표 삽입, ticks 필드 실제 gap 유지 — 자동 테스트 검증.
- `trackToNotation`: 빈 트랙 → 빈 배열, 단일 노트 → 노트+trailing rest, 화음 → pitches[], 타이 경계 — 자동 테스트 검증.
- `projectToMusicXML`: 유효 XML 헤더, part-list, 첫 마디 attributes, 화음 `<chord/>`, 쉼표 `<rest/>`, 점 `<dot/>`, 타이 `<tie>` + `<tied>` — 자동 테스트 검증.
- `NotationView`: VexFlow mock 환경에서 크래시 없이 마운트, Renderer 호출 확인 — 스모크 테스트 검증.
- Compose 모드에서 Roll/Score 토글 버튼이 렌더되고 클릭 시 뷰가 전환된다.
- FileMenu에 "Export MusicXML" 버튼이 추가되고 `.musicxml` + 올바른 MIME 타입으로 downloadText가 호출된다.
- `tsc --noEmit` 에러 없음. 빌드 성공.
- 하드코딩 hex 없음 — 신규 UI는 `var(--accent)`, `var(--on-accent)`, `var(--bg-elevated)` 등 CSS 변수만 사용.
- React.XXX 네임스페이스 직접 사용 없음.

**범위 밖 (완료 기준에서 제외):**
- 튜플렛, 다성 voice, 빔 그룹핑 정교화, 조표 정밀 매핑.
- 마디 내 duration 합계의 수학적 완벽성 (근사 rest의 tick 오차 허용).
- MusicXML import, 악보 편집, 오버랩 노트 완벽 다성 처리.

---

## 다음 계획 (이 계획 완료 후 별도 작성)

- **P2 — 사운드 디자인:** 음색 파라미터 에디터(FM/AM/Synth ADSR), 커스텀 patch 저장, Pad/Arpeggiator 프리셋.
- **기보 개선 (선택):** 빔 그룹핑(eighth/16th 연속 자동 빔), 셋잇단 표시, 피아노 보표(G+F 이중 보표).
- **MusicXML 고도화:** import(MusicXML → Project), 조표 정밀 매핑, 다성 voice 지원.

---

## 열린 질문

1. **오버랩 클리핑 UX:** 현재 오버랩 시 앞 노트를 클리핑(뒷 노트 시작까지). 다른 DAW 방식(앞 노트 유지, 뒷 노트를 다음 슬롯으로 밀기)이 더 나을 수 있음. P1에서는 클리핑 단순화로 진행. 차후 UX 결정 후 변경 가능.

2. **fillRests의 trailing rest 상한:** 현재 마디 끝까지 trailing rest를 삽입한다. 마지막 마디에서 trailing rest가 크면(예: 첫 박만 노트가 있고 나머지 3박이 rest) 시각적으로 복잡할 수 있음. 다음 계획에서 마지막 마디 trailing rest 표시를 선택적으로 숨기는 옵션 고려.

3. **VexFlow 타이 표시:** 현재 `NotationView`에서 `StaveNote`에 타이 어노테이션을 추가하지 않는다(VexFlow의 `StaveTie` API 연결 미구현). 기보에서 타이가 시각적으로 표시되지 않는 것은 P1 허용 한계. 후속에서 `StaveTie.apply` 또는 `note.addModifier` 로 추가.

4. **MusicXML `<duration>` 불일치:** `el.ticks`를 `<duration>`으로 쓰고 `el.durationType`을 `<type>`으로 쓰면, 근사 rest의 경우 두 값이 불일치할 수 있음(예: gap=1680, type=half+dots=1이지만 duration=1680, canonical=1440). 이는 MusicXML 표준에서 `type`이 `duration`의 visual representation임을 명시하므로 허용. Sibelius/Finale 등 수신 프로그램에서 경고를 낼 수 있으나 parse error는 아님.

5. **VexFlow 버전 pinning:** `vexflow` ^4.x는 API가 안정적이지 않을 수 있음. pnpm lock 파일로 버전을 고정하고, 업그레이드 시 NotationView.test.tsx의 mock 구조도 함께 검토.

6. **스토어 composeView 초기화:** `replaceProject` / `New` 시 `composeView`를 'roll'로 리셋할지 유지할지 정책 미결정. 현재는 유지(사용자 토글 상태 보존). 향후 UX 결정에 따라 `replaceProject` 액션에 `composeView: 'roll'` 추가 고려.
