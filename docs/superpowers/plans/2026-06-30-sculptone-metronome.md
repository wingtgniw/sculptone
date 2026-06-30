# Sculptone 메트로놈 + 카운트인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 재생·녹음 중 박자 클릭 사운드(메트로놈)와 녹음 전 N마디 카운트인을 구현한다. 사용자가 TransportBar에서 메트로놈 ON/OFF와 카운트인 마디 수(0/1/2)를 선택하면, 재생/녹음 엔진이 Tone.js transport에 클릭을 스케줄하고 카운트인 구간 이후 콘텐츠·녹음을 시작한다.

**Architecture:** 순수 클릭 스케줄 로직(`barDurationSec`, `beatDurationSec`, `barsToSeconds`, `computeClickTimes`)은 완전 TDD로 검증한다. 클릭 사운드(`createMetronome`)는 Tone 인스턴스를 생성하므로 jsdom에서 스모크 테스트(Tone 모킹)로 검증한다. 재생/녹음 엔진 통합(`playback.ts`, `useAudio.ts`)은 기존 Tone 모킹 패턴을 확장해 테스트한다. 카운트인↔녹음 타이밍은 store의 `recordingContentStartSec`를 중간 브릿지로 사용해 `useRecording`의 상승 에지가 올바른 기준 시점을 읽도록 한다. 기존 312개 테스트를 전부 보존한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** `docs/superpowers/plans/2026-06-29-sculptone-midi-input.md`(녹음 타이밍 — 핵심 참고), `docs/superpowers/plans/2026-06-29-sculptone-multitrack-mixer.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- 메트로놈 볼륨·사운드 커스터마이즈 (클릭 피치/레벨 조절 UI)
- 서브디비전 클릭 (8분·16분 클릭)
- 탭 템포
- 폴리리듬 / 복합박자 메트로놈
- 시각 박자 인디케이터 (화면상 박자 점멸 등)
- MIDI clock out / 외부 동기
- 카운트인 중 재생 중인 기존 노트 발음 (카운트인은 항상 빈 pre-roll)
- 협업 / 백엔드
- 인프라 파일 변경 (`.github/`, 루트 설정 — 병렬 세션 소관)

---

## 설계 근거

### 순수 클릭 스케줄 로직

- **`beatDurationSec(tempo)`**: `60 / tempo`. 1 BPM beat = 4분음표.
- **`barDurationSec(tempo, timeSignature)`**: `beatDurationSec(tempo) * timeSignature[0]`. 3/4박 = 3박, 4/4박 = 4박.
- **`barsToSeconds(bars, tempo, timeSignature)`**: `bars * barDurationSec(tempo, timeSignature)`.
- **`computeClickTimes(tempo, timeSignature, fromSec, durationSec)`**: `fromSec`부터 `fromSec + durationSec`까지의 모든 박 위치를 반환. 각 박의 accent 여부는 `(beatIndex % beatsPerBar === 0)` — 마디 첫 박만 accent. `fromSec` 이전 박은 반환하지 않음. `durationSec <= 0`이면 빈 배열.

### 클릭 사운드 (`createMetronome`)

- Tone.js `Synth` 또는 `MembraneSynth` 두 인스턴스(accent, normal)를 미리 생성해 `click(timeSec, accent)` 호출 시 `triggerAttackRelease`를 예약.
- accent 클릭은 더 높은 피치(`C5` ≈ 523 Hz)와 살짝 높은 볼륨, normal 클릭은 낮은 피치(`C4` ≈ 261 Hz). duration은 짧게(`'16n'`).
- jsdom에서 Tone 인스턴스화는 WebAudio 없이 실패 → `vi.mock('tone', ...)` 으로 `Synth` 클래스를 스파이로 교체해 스모크 테스트.
- `dispose()`: 두 Synth 인스턴스를 `disconnect + dispose`.

### 재생/녹음 엔진 통합 (`playback.ts`)

- `PlayOptions`에 `metronome?: MetronomeHandle`, `countInDurationSec?: number` 추가.
- `createPlaybackEngine.play()` 내부: 
  1. `countInDurationSec` 만큼 content 노트 스케줄을 오프셋: `transport.schedule(cb, item.timeSec + countInDurationSec)`.
  2. 전체 재생 구간(count-in + content)에 걸쳐 `computeClickTimes`로 박 계산 후 `transport.schedule(cb, click.timeSec)`에 `metronome.click(time, accent)` 예약.
  3. `endSec` 계산: `countInDurationSec + contentEndSec`. keepAlive/non-keepAlive 기존 분기 보존.
- 기존 테스트 보존: `PlayOptions`에 새 선택 필드 추가이므로 기존 `opts?.keepAlive` 단언에 영향 없음.

### 카운트인↔녹음 타이밍 (핵심 설계)

**문제:** `useRecording.ts`는 `active = isPlaying && isRecording` 상승 에지에서 `recordStartSecRef.current = Tone.getTransport().seconds`로 녹음 기준 시점을 캡처한다. 카운트인이 있을 때 transport는 0에서 시작하지만, 콘텐츠 기준은 `countInDur`초 후다. 이 오프셋이 맞지 않으면 녹음 노트가 countInDur만큼 shift되어 오배치된다.

**해결책: `recordingContentStartSec` 브릿지 (스토어 경유)**

```
store.recordingContentStartSec: number  (기본 0, 내부 전용)
```

흐름:
1. 사용자가 재생 버튼 클릭 → `TransportBar.handlePlay`: `setPlaying(true)` → `onPlay()` = `useAudio.play()`
2. `useAudio.play()`에서 동기적으로:
   - `countInDur = isRecording && countInBars > 0 ? barsToSeconds(countInBars, tempo, ts) : 0`
   - `store.setRecordingContentStartSec(countInDur)` **← 반드시 transport.start() 이전에 동기 호출**
3. React 18 automatic batching: `setPlaying(true)`와 `setRecordingContentStartSec(countInDur)` 모두 같은 렌더에 반영.
4. 렌더 후 effect: `useRecording` 상승 에지 — `useStore.getState().recordingContentStartSec` 를 읽어:
   ```ts
   const { recordingContentStartSec } = useStore.getState()
   recordStartSecRef.current = recordingContentStartSec > 0
     ? recordingContentStartSec          // 카운트인: 콘텐츠 기준 시작점
     : Tone.getTransport().seconds       // 일반 재생 or arm-after-play
   ```
5. 카운트인 중 키 입력: `timeSec = transport.seconds - recordingContentStartSec < 0` → **음수 이벤트는 commitTake에서 필터링하여 제외**.
6. 콘텐츠 구간 키 입력: `timeSec = transport.seconds - recordingContentStartSec >= 0` → 콘텐츠 기준 정확한 시간.

**arm-after-play 보존 (기존 테스트):**
- 재생 중 Record 누름(arm-after-play): `useAudio.play()`가 이미 완료됨 → `recordingContentStartSec = 0` (count-in 없음 or 재생 중에는 count-in 미적용).
- 상승 에지: `recordingContentStartSec = 0`, 조건 `> 0` false → `Tone.getTransport().seconds` 사용 (기존 동작 그대로).

**recordStopSec 연계 보존:**
- `commitTake`의 `endSec = Math.max(0, endAbs - recordStartSec)`. `endAbs`는 `recordStopSec`(정지 경로) 또는 `Tone.getTransport().seconds`(disarm 경로). `recordStartSec = countInDur`이면 `endSec = stopPos - countInDur` → 콘텐츠 기준 정확한 종료점.

**음수 이벤트 필터:**
- `commitTake` 내부에서 `events.filter(e => e.timeSec >= 0)` 후 `recordedEventsToNotes`에 전달.
- 기존 `recordedEventsToNotes` 시그니처 불변 (테스트 보존).

### UI 설계 (`TransportBar.tsx`)

- 메트로놈 토글: `<button aria-label="메트로놈" aria-pressed={metronomeEnabled}>` — 활성 시 `var(--accent)` 배경.
- 카운트인 선택: `<select aria-label="카운트인">` options `[0, 1, 2]` 마디. `metronomeEnabled` 아닐 때 `disabled` (카운트인은 메트로놈 ON 전제).
- 기존 `onPlay`/`onStop` prop 시그니처 불변. 기존 재생·정지·녹음 버튼 동작 보존.

---

## File Structure

```
apps/web/src/
  audio/
    metronome.ts                    # NEW: 순수 로직 + Tone 클릭 사운드
    test/
      metronome.test.ts             # NEW: 순수 로직 TDD (19개) + 스모크 (2개)
      playback.test.ts              # MOD: 메트로놈 클릭 스케줄 + 카운트인 오프셋 테스트 (+4)
      useAudio.test.ts              # MOD: 메트로놈 생명주기 + 카운트인 통합 테스트 (+4)
      TransportBar.test.tsx         # MOD: 메트로놈/카운트인 UI 테스트 (+6)
    playback.ts                     # MOD: PlayOptions 확장, 클릭 스케줄, countIn 오프셋
    useAudio.ts                     # MOD: 메트로놈 인스턴스 관리, countInDur 계산/전달
    TransportBar.tsx                # MOD: 메트로놈 토글 + 카운트인 select 추가

  midi/
    useRecording.ts                 # MOD: 상승 에지 recordStartSec 소스, 음수 이벤트 필터
    test/
      useRecording.test.ts          # MOD: 카운트인 타이밍 테스트 (+3)

  state/
    store.ts                        # MOD: metronomeEnabled, countInBars, recordingContentStartSec
    test/
      editor-store.test.ts          # MOD: 신규 상태 테스트 (+3)
```

---

## Task 1: audio/metronome.ts — 순수 클릭 스케줄 로직 (완전 TDD)

**Files:** Create `apps/web/src/audio/metronome.ts`, `apps/web/src/audio/test/metronome.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/audio/test/metronome.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

// metronome.ts는 'tone'을 top-level import하므로 jsdom 환경에서 vi.mock이 필요하다.
// 순수 함수는 Tone을 호출하지 않으므로 이 모킹이 테스트 결과에 영향을 주지 않는다.
// (스모크 테스트를 위한 완전한 모킹은 Task 2에서 추가된다)
vi.mock('tone', () => ({
  Synth: vi.fn().mockImplementation(() => ({
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
  })),
}))

import {
  beatDurationSec,
  barDurationSec,
  barsToSeconds,
  computeClickTimes,
} from '../metronome'

// ── beatDurationSec ───────────────────────────────────────────

describe('beatDurationSec', () => {
  it('120BPM → 0.5s', () => {
    expect(beatDurationSec(120)).toBeCloseTo(0.5)
  })

  it('60BPM → 1.0s', () => {
    expect(beatDurationSec(60)).toBeCloseTo(1.0)
  })

  it('90BPM → 2/3 s', () => {
    expect(beatDurationSec(90)).toBeCloseTo(60 / 90)
  })
})

// ── barDurationSec ────────────────────────────────────────────

describe('barDurationSec', () => {
  it('4/4 120BPM → 2.0s (4박 × 0.5s)', () => {
    expect(barDurationSec(120, [4, 4])).toBeCloseTo(2.0)
  })

  it('3/4 120BPM → 1.5s (3박 × 0.5s)', () => {
    expect(barDurationSec(120, [3, 4])).toBeCloseTo(1.5)
  })

  it('6/8 120BPM → 6박 × 0.5s = 3.0s', () => {
    // 여기서 박은 분모 단위(8분음표 단위 BPM) 아님 — 분자만 쓴다
    expect(barDurationSec(120, [6, 8])).toBeCloseTo(3.0)
  })
})

// ── barsToSeconds ─────────────────────────────────────────────

describe('barsToSeconds', () => {
  it('2마디 4/4 120BPM → 4.0s', () => {
    expect(barsToSeconds(2, 120, [4, 4])).toBeCloseTo(4.0)
  })

  it('1마디 3/4 120BPM → 1.5s', () => {
    expect(barsToSeconds(1, 120, [3, 4])).toBeCloseTo(1.5)
  })

  it('0마디 → 0s', () => {
    expect(barsToSeconds(0, 120, [4, 4])).toBe(0)
  })
})

// ── computeClickTimes ─────────────────────────────────────────

describe('computeClickTimes', () => {
  // 4/4 120BPM: 박 0.5s, 마디 2.0s
  it('4/4 120BPM 1마디 → 4박, 첫 박만 accent', () => {
    const clicks = computeClickTimes(120, [4, 4], 0, 2.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.timeSec).toBeCloseTo(0.5)
    expect(clicks[1]!.accent).toBe(false)
    expect(clicks[2]!.timeSec).toBeCloseTo(1.0)
    expect(clicks[2]!.accent).toBe(false)
    expect(clicks[3]!.timeSec).toBeCloseTo(1.5)
    expect(clicks[3]!.accent).toBe(false)
  })

  it('4/4 120BPM 2마디 → 8박, 마디 첫 박(0.0, 2.0)만 accent', () => {
    const clicks = computeClickTimes(120, [4, 4], 0, 4.0)
    expect(clicks).toHaveLength(8)
    expect(clicks[0]!.accent).toBe(true)   // 0.0
    expect(clicks[1]!.accent).toBe(false)  // 0.5
    expect(clicks[4]!.accent).toBe(true)   // 2.0
    expect(clicks[5]!.accent).toBe(false)  // 2.5
  })

  it('3/4 120BPM 1마디 → 3박, 첫 박만 accent', () => {
    const clicks = computeClickTimes(120, [3, 4], 0, 1.5)
    expect(clicks).toHaveLength(3)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.accent).toBe(false)
    expect(clicks[2]!.accent).toBe(false)
  })

  it('3/4 120BPM 2마디 → 6박, 0.0·1.5 accent', () => {
    const clicks = computeClickTimes(120, [3, 4], 0, 3.0)
    expect(clicks).toHaveLength(6)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[3]!.timeSec).toBeCloseTo(1.5)
    expect(clicks[3]!.accent).toBe(true)
  })

  it('durationSec = 0 → 빈 배열', () => {
    expect(computeClickTimes(120, [4, 4], 0, 0)).toEqual([])
  })

  it('durationSec < 0 → 빈 배열', () => {
    expect(computeClickTimes(120, [4, 4], 0, -1)).toEqual([])
  })

  it('경계: durationSec가 정확히 1박이면 1개만 반환', () => {
    // 4/4 120BPM: beatDur = 0.5s
    // fromSec=0, durationSec=0.5 → [0.0] 1개
    // 0.5s는 포함하지 않음([fromSec, fromSec+durationSec) 반-열린 구간)
    const clicks = computeClickTimes(120, [4, 4], 0, 0.5)
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.timeSec).toBeCloseTo(0.0)
  })

  it('fromSec > 0: 카운트인 이후 콘텐츠 구간 클릭 — accent는 절대 마디 기준', () => {
    // 카운트인 2마디(4.0s) 후 콘텐츠 시작 → 콘텐츠 박 기준(0..durationSec)으로 반환
    // fromSec=4.0, 첫 박 timeSec=4.0, accent=true(새 마디 첫 박)
    const clicks = computeClickTimes(120, [4, 4], 4.0, 2.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(4.0)
    expect(clicks[0]!.accent).toBe(true)
    expect(clicks[1]!.timeSec).toBeCloseTo(4.5)
    expect(clicks[1]!.accent).toBe(false)
  })

  it('fromSec가 박 중간이면 다음 박부터 반환', () => {
    // 4/4 120BPM: fromSec=0.25 (박 중간) → 첫 박(0.0)은 포함 안 됨, 0.5부터 시작
    const clicks = computeClickTimes(120, [4, 4], 0.25, 1.75)
    // 박 위치: 0.5, 1.0, 1.5, 2.0 → 0.25+1.75=2.0은 반열림이므로 제외 → 3개
    expect(clicks[0]!.timeSec).toBeCloseTo(0.5)
    expect(clicks[0]!.accent).toBe(false)
  })

  it('tempo=60, [4,4], 1마디 → 4박 at 0, 1, 2, 3s', () => {
    const clicks = computeClickTimes(60, [4, 4], 0, 4.0)
    expect(clicks).toHaveLength(4)
    expect(clicks[0]!.timeSec).toBeCloseTo(0)
    expect(clicks[1]!.timeSec).toBeCloseTo(1)
    expect(clicks[2]!.timeSec).toBeCloseTo(2)
    expect(clicks[3]!.timeSec).toBeCloseTo(3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../metronome'` 모듈 없음.

- [ ] **Step 3: 순수 로직 구현**

Create `apps/web/src/audio/metronome.ts`:
```ts
import * as Tone from 'tone'

/** 박자표: [분자, 분모]. 예: [4, 4], [3, 4], [6, 8]. */
export type TimeSignature = [number, number]

export interface ClickEvent {
  /** transport 기준 절대 위치(초) */
  timeSec: number
  /** 마디 첫 박이면 true */
  accent: boolean
}

// ── 순수 계산 ─────────────────────────────────────────────────

/**
 * 1박(4분음표)의 길이(초).
 * 주의: 박자표의 분모(4/8 등)를 별도로 보정하지 않는다 — BPM은 항상 4분음표 기준.
 */
export function beatDurationSec(tempo: number): number {
  return 60 / tempo
}

/**
 * 1마디의 길이(초).
 * beatsPerBar = timeSignature[0] (분자).
 */
export function barDurationSec(tempo: number, timeSignature: TimeSignature): number {
  return beatDurationSec(tempo) * timeSignature[0]
}

/**
 * N마디의 길이(초).
 */
export function barsToSeconds(bars: number, tempo: number, timeSignature: TimeSignature): number {
  return bars * barDurationSec(tempo, timeSignature)
}

/**
 * `fromSec`부터 `fromSec + durationSec` 구간(반-열린 구간)에 해당하는
 * 모든 박 클릭 이벤트를 반환한다.
 *
 * - 박 위치는 절대 시간 기준(transport seconds). 마디 첫 박(beatIndex % beatsPerBar === 0)은 accent=true.
 * - fromSec 이전 박은 포함하지 않는다.
 * - durationSec <= 0이면 빈 배열.
 * - fromSec가 박 중간이면 그 박은 건너뛰고 다음 박부터 반환.
 *
 * @param tempo        BPM (4분음표 기준)
 * @param timeSignature 박자표 [분자, 분모]
 * @param fromSec      구간 시작(초, 포함)
 * @param durationSec  구간 길이(초)
 */
export function computeClickTimes(
  tempo: number,
  timeSignature: TimeSignature,
  fromSec: number,
  durationSec: number,
): ClickEvent[] {
  if (durationSec <= 0) return []

  const beatDur = beatDurationSec(tempo)
  const barDur = barDurationSec(tempo, timeSignature)
  const beatsPerBar = timeSignature[0]

  const toSec = fromSec + durationSec
  const clicks: ClickEvent[] = []

  // fromSec 이후 첫 번째 박의 인덱스(절대 0 기준)
  // Math.ceil 대신 부동소수점 허용 오차 포함: fromSec가 박 위치와 거의 일치하면 그 박 포함
  const firstBeatIndex = Math.ceil((fromSec - 1e-9) / beatDur)

  for (let i = firstBeatIndex; ; i++) {
    const timeSec = i * beatDur
    if (timeSec >= toSec - 1e-9) break

    const beatInBar = Math.round((timeSec % barDur) / beatDur)
    const accent = beatInBar % beatsPerBar === 0

    clicks.push({ timeSec, accent })
  }

  return clicks
}

// ── Tone 클릭 사운드 (비순수부) ───────────────────────────────
// Tone은 파일 상단에서 import하지만, createMetronome() 호출(= new Tone.Synth())은
// 테스트 시 vi.mock('tone', ...) 으로 Synth 클래스가 교체된 후 실행된다.
// 순수 함수(computeClickTimes 등)는 Tone을 호출하지 않으므로 모킹 영향 없음.

export interface MetronomeHandle {
  /** transport.schedule 콜백 내부의 오디오 시간(time)에 클릭을 울린다. */
  click: (time: number, accent: boolean) => void
  dispose: () => void
}

/**
 * 클릭 사운드 엔진을 생성한다.
 * accent 클릭: C5, normal 클릭: C4. 각 Synth 인스턴스는 독립적으로 관리된다.
 *
 * 사용 패턴:
 *   const m = createMetronome()
 *   transport.schedule((time) => m.click(time, true), 0)
 *   // 재생 종료 후:
 *   m.dispose()
 */
export function createMetronome(): MetronomeHandle {
  const accentSynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
    volume: -6,
  }).toDestination()

  const normalSynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
    volume: -12,
  }).toDestination()

  return {
    click(time, accent) {
      const synth = accent ? accentSynth : normalSynth
      const note = accent ? 'C5' : 'C4'
      synth.triggerAttackRelease(note, '32n', time)
    },
    dispose() {
      accentSynth.dispose()
      normalSynth.dispose()
    },
  }
}
```

> **top-level Tone import 패턴 근거:** 기존 `playback.ts`와 동일하게 `import * as Tone from 'tone'`를 파일 상단에 선언한다. 순수 함수는 Tone을 호출하지 않으므로 테스트 시 vi.mock('tone') 여부에 무관하게 동작한다. `createMetronome()`은 `new Tone.Synth()`를 호출하므로, 스모크 테스트에서는 `vi.mock('tone', ...)` 으로 Synth를 스파이로 교체한 뒤 테스트한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: metronome.test.ts 19개 PASS (beatDurationSec 3, barDurationSec 3, barsToSeconds 3, computeClickTimes 10개). 기존 312개 테스트 영향 없음.

---

## Task 2: audio/metronome.ts — createMetronome 스모크 테스트

**Files:** Modify `apps/web/src/audio/test/metronome.test.ts` (스모크 블록 추가)

- [ ] **Step 1: 스모크 테스트 추가**

`apps/web/src/audio/test/metronome.test.ts`의 파일 상단 `vi.mock('tone', ...)` 블록을 정밀 스파이 버전으로 교체하고, 파일 끝에 스모크 테스트 블록을 추가한다.

**파일 최상단 vi.mock 교체 (기존 minimal mock → 정밀 스파이):**
```ts
// 기존:
// vi.mock('tone', () => ({ Synth: vi.fn().mockImplementation(() => ({ ... })) }))
// 교체:

const mockAccentTrigger = vi.fn()
const mockNormalTrigger = vi.fn()
const mockDispose = vi.fn()
let synthCallCount = 0

vi.mock('tone', () => ({
  Synth: vi.fn().mockImplementation(() => {
    synthCallCount++
    return {
      triggerAttackRelease: synthCallCount === 1 ? mockAccentTrigger : mockNormalTrigger,
      dispose: mockDispose,
      toDestination: vi.fn().mockReturnThis(),
    }
  }),
}))
```

**파일 끝에 추가할 스모크 테스트 블록:**
```ts
// ── createMetronome 스모크 ────────────────────────────────────

import { createMetronome } from '../metronome'

describe('createMetronome (Tone 스모크)', () => {
  beforeEach(() => {
    synthCallCount = 0
    vi.clearAllMocks()
  })

  it('click(time, true) 호출 시 첫 번째 Synth(accent)가 C5로 트리거된다', () => {
    const m = createMetronome()
    m.click(0.5, true)
    expect(mockAccentTrigger).toHaveBeenCalledWith('C5', '32n', 0.5)
  })

  it('click(time, false) 호출 시 두 번째 Synth(normal)가 C4로 트리거된다', () => {
    const m = createMetronome()
    m.click(1.0, false)
    expect(mockNormalTrigger).toHaveBeenCalledWith('C4', '32n', 1.0)
  })
})
```

> **vi.mock 호이스팅 주의:** Vitest는 `vi.mock(...)` 호출을 파일 최상단으로 자동 호이스팅한다. Task 1에서 minimal mock으로 시작했고, Task 2에서 정밀 스파이로 교체한다. `synthCallCount`로 첫 번째 Synth 인스턴스(accent)와 두 번째(normal)를 구분한다. `import { createMetronome }` 추가도 필요하다.
>
> **순수 함수 테스트 격리:** `computeClickTimes` 등 순수 함수는 `Tone` API를 전혀 호출하지 않으므로, 스파이로 교체된 `vi.mock('tone')` 에 무관하게 정상 동작한다.

- [ ] **Step 2: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: metronome.test.ts 21개 PASS (순수 19 + 스모크 2). 기존 테스트 영향 없음.

---

## Task 3: store — metronomeEnabled, countInBars, recordingContentStartSec 추가

**Files:** Modify `apps/web/src/state/store.ts`, `apps/web/src/test/editor-store.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/test/editor-store.test.ts` 의 `describe('editor store', ...)` 블록 끝에 추가:
```ts
  it('초기 metronomeEnabled는 false이다', () => {
    expect(useStore.getState().metronomeEnabled).toBe(false)
  })

  it('setMetronomeEnabled(true) → metronomeEnabled true', () => {
    useStore.getState().setMetronomeEnabled(true)
    expect(useStore.getState().metronomeEnabled).toBe(true)
    useStore.getState().setMetronomeEnabled(false)
    expect(useStore.getState().metronomeEnabled).toBe(false)
  })

  it('초기 countInBars는 0이다, setCountInBars(2) → 2', () => {
    expect(useStore.getState().countInBars).toBe(0)
    useStore.getState().setCountInBars(2)
    expect(useStore.getState().countInBars).toBe(2)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `metronomeEnabled` / `countInBars` / `setMetronomeEnabled` / `setCountInBars`가 AppState에 없음.

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts`의 `AppState` 인터페이스에 추가:
```ts
  /** 메트로놈 ON/OFF. 기본 false. */
  metronomeEnabled: boolean
  /** 녹음 시작 전 카운트인 마디 수. 0 = 카운트인 없음. 기본 0. */
  countInBars: number
  /**
   * 내부 전용: 카운트인 오프셋(초).
   * useAudio.play()가 재생 시작 직전 설정하며, useRecording 상승 에지에서 읽는다.
   * 카운트인 없으면 0 (useRecording은 Tone.getTransport().seconds를 사용).
   * 외부에서 직접 변경하지 말 것.
   */
  recordingContentStartSec: number
  setMetronomeEnabled: (enabled: boolean) => void
  setCountInBars: (bars: number) => void
  setRecordingContentStartSec: (sec: number) => void
```

`create<AppState>(...)` 초기 상태 객체에 추가:
```ts
  metronomeEnabled: false,
  countInBars: 0,
  recordingContentStartSec: 0,
  setMetronomeEnabled: (enabled) => set({ metronomeEnabled: enabled }),
  setCountInBars: (bars) => set({ countInBars: bars }),
  setRecordingContentStartSec: (sec) => set({ recordingContentStartSec: sec }),
```

> **타입 노트:** `recordingContentStartSec`는 `recordStopSec`와 동일한 패턴("내부 전용 timing 브릿지"). `getInitialState()`/`setState(true)` 리셋 시 0으로 초기화되므로 테스트 격리에 영향 없음.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: editor-store.test.ts 기존 + 신규 3개 PASS. 기존 312개 테스트 영향 없음(isRecording 등 기존 필드 불변, 초기값 추가만).

---

## Task 4: playback.ts — 메트로놈 클릭 스케줄 + 카운트인 오프셋

기존 `PlayOptions`를 확장하고, 메트로놈 클릭과 카운트인 오프셋을 `createPlaybackEngine.play()`에 통합한다. 기존 시그니처 변경 없이 선택 필드 추가만 한다.

**Files:** Modify `apps/web/src/audio/playback.ts`, `apps/web/src/audio/test/playback.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/audio/test/playback.test.ts` 끝에 추가 (기존 `describe('createPlaybackEngine.play', ...)` 블록 내부 끝 또는 별도 블록):
```ts
// 아래 import가 파일 상단 import에 추가됨:
// import { createMetronome, computeClickTimes, type MetronomeHandle } from '../metronome'

describe('createPlaybackEngine.play — 메트로놈', () => {
  beforeEach(() => {
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
  })

  it('metronome 옵션이 있으면 노트 외에 클릭 이벤트도 스케줄된다 (4/4 1마디)', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    // tempo=120, ppq=480: 1마디=2s, 4박
    // transport 모킹의 bpm.value는 play()에서 설정됨
    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: vi.fn(), volume: { value: 0 } }))

    await engine.play(p, undefined, undefined, {
      metronome,
      countInDurationSec: 0,
    })

    // schedule 호출: 노트 1회 + 클릭 N회
    // 1마디(0..2s) → 4박 → schedule 최소 4+1=5회
    expect(transport.schedule.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('카운트인 오프셋이 있으면 노트 스케줄이 countInDurationSec만큼 밀린다', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    // 노트 start=0 → timeSec=0 (no countIn이면 0.0에 스케줄)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))

    const engine = createPlaybackEngine((tid) =>
      tid === t.id ? { triggerAttackRelease: vi.fn(), volume: { value: 0 } } : null
    )

    const countInDurationSec = 2.0
    await engine.play(p, undefined, undefined, { keepAlive: true, metronome, countInDurationSec })

    // 스케줄된 콜백 중 note 스케줄의 시간은 countInDurationSec + 0 = 2.0이어야 함
    // transport.schedule: vi.fn((cb, time) => { cb(time) }) → 각 call의 args[1]이 예약 시간
    const scheduleTimes = (transport.schedule.mock.calls as [unknown, number][]).map(([, t]) => t)
    // 노트 스케줄 time = timeSec + countInDurationSec = 0 + 2.0 = 2.0
    expect(scheduleTimes).toContain(2.0)
  })

  it('카운트인 중 클릭이 0..countInDurationSec에 스케줄된다', async () => {
    const clickSpy = vi.fn()
    const metronome: MetronomeHandle = { click: clickSpy, dispose: vi.fn() }

    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t) // 노트 없음

    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: vi.fn(), volume: { value: 0 } }))
    const countInDurationSec = 2.0

    await engine.play(p, undefined, undefined, { keepAlive: true, metronome, countInDurationSec })

    // schedule 중 countInDurationSec 이전 시간이 포함되어야 함
    const scheduleTimes = (transport.schedule.mock.calls as [unknown, number][]).map(([, t]) => t)
    expect(scheduleTimes.some((t) => t < countInDurationSec)).toBe(true)
  })

  it('metronome 없이 호출 시 기존 동작과 동일 (클릭 스케줄 없음)', async () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 }))
    const engine = createPlaybackEngine(() => ({ triggerAttackRelease: vi.fn(), volume: { value: 0 } }))

    await engine.play(p)

    // metronome 없으면 schedule 호출 횟수 = 노트 수 + scheduleOnce(종료) = 1+1이므로
    // schedule 1회(노트), scheduleOnce 1회(종료)
    expect(transport.schedule).toHaveBeenCalledTimes(1)
    expect(transport.scheduleOnce).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — 신규 테스트 4개 실패 (PlayOptions에 metronome/countInDurationSec 없음).

- [ ] **Step 3: playback.ts 레퍼런스 구현으로 수정**

`apps/web/src/audio/playback.ts` 전체 내용:
```ts
import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from './multitrack'
import { computeClickTimes, type MetronomeHandle } from './metronome'

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
 * - keepAlive: 녹음 모드 — 노트가 없거나 끝나도 Stop 전까지 transport를 유지(자동종료 미등록).
 * - metronome: 제공되면 재생 구간 전체 박에 클릭 이벤트를 스케줄한다.
 * - countInDurationSec: > 0이면 content 노트 스케줄을 이 값만큼 오프셋하고,
 *   0..countInDurationSec 구간에 카운트인 클릭을 추가 스케줄한다.
 */
export interface PlayOptions {
  keepAlive?: boolean
  metronome?: MetronomeHandle
  countInDurationSec?: number
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

      const countInDurationSec = opts?.countInDurationSec ?? 0
      const metronome = opts?.metronome

      const audibleIds = audibleTrackIds(project)
      const items = buildMultiSchedule(project, audibleIds)

      // play 시점에 audible 트랙별 instrument 가져오고 volume 적용
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

      const contentEndSec = items.reduce(
        (m, it) => Math.max(m, it.timeSec + it.durationSec),
        0,
      )
      const totalDurationSec = countInDurationSec + contentEndSec

      // 메트로놈 클릭 스케줄 (count-in + content 전체 구간)
      if (metronome && totalDurationSec > 0) {
        const clicks = computeClickTimes(
          project.transport.tempo,
          project.transport.timeSignature as [number, number],
          0,
          totalDurationSec,
        )
        for (const click of clicks) {
          transport.schedule((time) => {
            metronome.click(time, click.accent)
          }, click.timeSec)
        }
      } else if (metronome && countInDurationSec > 0) {
        // 노트 없는 카운트인 전용 (keepAlive 녹음 시 content가 비어도 카운트인 클릭은 울려야 함)
        const clicks = computeClickTimes(
          project.transport.tempo,
          project.transport.timeSignature as [number, number],
          0,
          countInDurationSec,
        )
        for (const click of clicks) {
          transport.schedule((time) => {
            metronome.click(time, click.accent)
          }, click.timeSec)
        }
      }

      const endSec = totalDurationSec
      if (opts?.keepAlive) {
        transport.start()
      } else if (endSec > 0) {
        transport.scheduleOnce(() => { transport.stop(); transport.cancel(); onEnded?.() }, endSec)
        transport.start()
      } else {
        transport.stop(); transport.cancel(); onEnded?.()
      }
    },
    stop() { transport.stop(); transport.cancel() },
    getSeconds() { return transport.seconds },
  }
}
```

> **기존 테스트 보존:**
> - `PlayOptions.keepAlive` — 기존 필드 그대로. 신규 필드(`metronome`, `countInDurationSec`)는 선택값.
> - `countInDurationSec` 기본 0 → content 노트 오프셋 없음, 기존 `item.timeSec` 그대로.
> - 메트로놈 없는 기존 테스트: `metronome = undefined` → 클릭 스케줄 없음 → `transport.schedule` 호출 횟수 불변.
> - `endSec` 계산 변경: 기존 `contentEndSec`가 `totalDurationSec`로 대체되지만, `countInDurationSec=0`이면 동일.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: playback.test.ts 기존 9개 PASS + 신규 4개 PASS = 13개. 기존 테스트 전체 영향 없음.

---

## Task 5: useAudio.ts — 메트로놈 인스턴스 관리 + 카운트인 전달

**Files:** Modify `apps/web/src/audio/useAudio.ts`, `apps/web/src/audio/test/useAudio.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/audio/test/useAudio.test.ts`의 기존 `vi.mock('@sculptone/sound-engine', ...)` 블록 이후, 최상단 영역에 추가:
```ts
// metronome 모킹: createMetronome → spy 핸들
const mockMetronomeClick = vi.fn()
const mockMetronomeDispose = vi.fn()
vi.mock('../metronome', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../metronome')>()
  return {
    ...orig,  // 순수 함수(computeClickTimes 등)는 실제 구현 사용
    createMetronome: vi.fn(() => ({
      click: mockMetronomeClick,
      dispose: mockMetronomeDispose,
    })),
  }
})
```

그리고 `describe('useAudio — 멀티트랙 instrument 관리', ...)` 블록 내 `beforeEach`에 추가:
```ts
    mockMetronomeClick.mockClear()
    mockMetronomeDispose.mockClear()
```

파일 끝에 새 describe 블록 추가:
```ts
describe('useAudio — 메트로놈 + 카운트인', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('metronomeEnabled=true면 play() 시 createMetronome이 반환한 핸들이 엔진에 전달된다', async () => {
    const { createMetronome } = await import('../metronome')
    act(() => { useStore.getState().setMetronomeEnabled(true) })

    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })

    // createMetronome이 호출되어야 함 (최초 마운트 또는 첫 play 시)
    expect(createMetronome).toHaveBeenCalled()
  })

  it('metronomeEnabled=false면 play() 시 createMetronome을 호출하지 않는다', async () => {
    const { createMetronome } = await import('../metronome')
    // 기본값 metronomeEnabled=false

    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })

    expect(createMetronome).not.toHaveBeenCalled()
  })

  it('isRecording=true, countInBars=2이면 recordingContentStartSec가 barsToSeconds(2,...) 값으로 설정된다', async () => {
    act(() => {
      useStore.getState().setRecording(true)
      useStore.getState().setCountInBars(2)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })

    // tempo=120(기본), timeSignature=[4,4](기본), 2마디 = 4.0s
    const sec = useStore.getState().recordingContentStartSec
    expect(sec).toBeCloseTo(4.0)
  })

  it('isRecording=false이면 countInBars>0이어도 recordingContentStartSec=0을 유지한다', async () => {
    act(() => {
      // isRecording=false (기본)
      useStore.getState().setCountInBars(2)
    })

    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })

    expect(useStore.getState().recordingContentStartSec).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — 신규 4개 테스트 실패 (`createMetronome` import 오류 또는 `recordingContentStartSec` 미설정).

- [ ] **Step 3: useAudio.ts 레퍼런스 구현으로 수정**

`apps/web/src/audio/useAudio.ts` 전체 내용:
```ts
import { useCallback, useEffect, useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset, createInstrumentFromSound } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { createMetronome, barsToSeconds, type MetronomeHandle } from './metronome'
import { useStore } from '../state/store'
import type { Project, Track } from '@sculptone/score-model'

// ── 캐시 키 ───────────────────────────────────────────────────

function resolveSoundCacheKey(track: Track): string {
  if (track.sound.kind === 'preset') return `preset:${track.sound.presetId}`
  return `patch:${JSON.stringify(track.sound)}`
}

// ── instrument 생성 분기 ──────────────────────────────────────

function buildTrackInstrument(track: Track): MultiInstrument & { dispose: () => void } {
  if (track.sound.kind === 'patch') {
    return createInstrumentFromSound(track.sound) as MultiInstrument & { dispose: () => void }
  }
  const desc = getPreset(track.sound.presetId) ?? getPreset('acoustic-piano')!
  const inst = createInstrument(descriptorToToneSpec(desc))
  return inst as unknown as MultiInstrument & { dispose: () => void }
}

export function useAudio() {
  const instrumentsRef = useRef(new Map<string, ReturnType<typeof buildTrackInstrument>>())
  const soundKeyRef    = useRef(new Map<string, string>())
  const engineRef      = useRef<PlaybackEngine | null>(null)
  const playGenRef     = useRef(0)
  // 메트로놈 인스턴스: metronomeEnabled=true일 때만 생성, dispose()로 정리
  const metronomeRef   = useRef<MetronomeHandle | null>(null)

  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        soundKeyRef.current.delete(trackId)
      }
    }
    for (const track of project.tracks) {
      const key = resolveSoundCacheKey(track)
      const cachedKey = soundKeyRef.current.get(track.id)
      if (cachedKey !== key || !instrumentsRef.current.has(track.id)) {
        instrumentsRef.current.get(track.id)?.dispose()
        instrumentsRef.current.set(track.id, buildTrackInstrument(track))
        soundKeyRef.current.set(track.id, key)
      }
    }
  }, [])

  const play = useCallback(() => {
    const {
      project,
      isRecording,
      metronomeEnabled,
      countInBars,
      setRecordingContentStartSec,
    } = useStore.getState()

    syncInstruments(project)

    // ── 카운트인 오프셋 계산 ──────────────────────────────────
    // isRecording 중이고 countInBars > 0일 때만 카운트인 적용.
    // 재생 전용(isRecording=false)이나 카운트인 없으면 0.
    const countInDurationSec =
      isRecording && countInBars > 0
        ? barsToSeconds(countInBars, project.transport.tempo, project.transport.timeSignature as [number, number])
        : 0

    // recordingContentStartSec를 동기적으로 설정 — useRecording 상승 에지가
    // 이 값을 읽을 때 반드시 최신값이어야 한다 (React 18 automatic batching 활용).
    setRecordingContentStartSec(countInDurationSec)

    // ── 메트로놈 인스턴스 관리 ────────────────────────────────
    if (metronomeEnabled) {
      // 인스턴스가 없으면 새로 생성 (이전 play에서 이미 생성했으면 재사용)
      if (!metronomeRef.current) {
        metronomeRef.current = createMetronome()
      }
    } else {
      // metronomeEnabled=false면 기존 인스턴스 정리
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
      },
    )
  }, [syncInstruments])

  const stop = useCallback(() => {
    playGenRef.current++
    const stopped = engineRef.current?.getSeconds() ?? 0
    useStore.getState().setRecordStopSec(stopped)
    engineRef.current?.stop()
  }, [])

  const getSeconds = useCallback(() => engineRef.current?.getSeconds() ?? 0, [])

  useEffect(() => {
    return () => {
      playGenRef.current++
      engineRef.current?.stop()
      for (const inst of instrumentsRef.current.values()) inst.dispose()
      instrumentsRef.current.clear()
      soundKeyRef.current.clear()
      // 메트로놈 정리
      metronomeRef.current?.dispose()
      metronomeRef.current = null
    }
  }, [])

  return { play, stop, getSeconds }
}
```

> **기존 테스트 보존:**
> - `createInstrument` / `createInstrumentFromSound` 호출 경로 불변.
> - `keepAlive: isRecording` 그대로.
> - `recordStopSec` 스냅샷 로직 불변.
> - 기존 `useAudio.test.ts`의 `vi.mock('@sculptone/sound-engine', ...)`는 그대로 동작.
> - 신규 `vi.mock('../metronome', ...)` 에서 `createMetronome`만 모킹하고 `computeClickTimes` 등 순수 함수는 실제 구현 사용(`importOriginal` 패턴).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useAudio.test.ts 기존 + 신규 4개 PASS. 기존 테스트 전체 영향 없음.

---

## Task 6: useRecording.ts — 카운트인 타이밍 통합

`recordingContentStartSec` 브릿지를 이용해 카운트인 중 입력을 제외하고 올바른 녹음 기준 시점을 잡는다.

**Files:** Modify `apps/web/src/midi/useRecording.ts`, `apps/web/src/midi/test/useRecording.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/midi/test/useRecording.test.ts` 끝에 추가:
```ts
describe('useRecording — 카운트인 타이밍', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('카운트인 4초: 카운트인 중(0..4s) 입력은 노트로 커밋되지 않는다', () => {
    const { result } = renderHook(() => useRecording())

    // recordingContentStartSec = 4.0 (2마디 카운트인, 120BPM 4/4)
    act(() => { useStore.getState().setRecordingContentStartSec(4.0) })

    // arm + play (상승 에지: recordStartSec = 4.0)
    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 카운트인 중 입력 (transport.seconds = 1.5, timeSec = 1.5 - 4.0 = -2.5 → 음수)
    mockSeconds = 1.5
    act(() => { result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 }) })
    mockSeconds = 2.0
    act(() => { result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 }) })

    // 콘텐츠 시작 후 정지
    mockSeconds = 4.5
    act(() => { useStore.getState().setRecordStopSec(4.5) })
    mockSeconds = 0
    act(() => { useStore.getState().setPlaying(false) })

    // 카운트인 중 입력이 제외되어 노트 없음
    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(0)
  })

  it('카운트인 4초: 콘텐츠 구간(4s 이후) 입력은 콘텐츠 기준 시간으로 커밋된다', () => {
    const { result } = renderHook(() => useRecording())

    act(() => { useStore.getState().setRecordingContentStartSec(4.0) })

    mockSeconds = 0
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 콘텐츠 구간 입력: transport.seconds=4.0, timeSec = 4.0-4.0 = 0.0 (콘텐츠 시작 기준)
    mockSeconds = 4.0
    act(() => { result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 96 }) })
    // noteoff at 4.5s → timeSec=0.5s → duration = 0.5s = 480 ticks (120BPM ppq480)
    mockSeconds = 4.5
    act(() => { result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 }) })

    mockSeconds = 5.0
    act(() => { useStore.getState().setRecordStopSec(5.0) })
    mockSeconds = 0
    act(() => { useStore.getState().setPlaying(false) })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.start).toBe(0)    // timeSec=0 → 0 ticks
    expect(notes[0]!.duration).toBe(480) // 0.5s = 480 ticks
  })

  it('카운트인 없음(recordingContentStartSec=0): 기존 arm-after-play 동작이 보존된다', () => {
    const { result } = renderHook(() => useRecording())

    // recordingContentStartSec = 0 (기본값 — 카운트인 없음)
    // 재생이 2.0s 진행된 후 arm
    act(() => { useStore.getState().setPlaying(true) })
    mockSeconds = 2.0
    act(() => { useStore.getState().setRecording(true) })
    // arm 시점 transport.seconds=2.0 → recordStartSec = 2.0 (Tone.getTransport().seconds 경로)

    mockSeconds = 2.0
    act(() => { result.current.handleMidiMessage({ type: 'noteon', pitch: 64, velocity: 80 }) })
    mockSeconds = 2.5
    act(() => { result.current.handleMidiMessage({ type: 'noteoff', pitch: 64, velocity: 0 }) })

    mockSeconds = 3.0
    act(() => { useStore.getState().setRecordStopSec(3.0) })
    mockSeconds = 0
    act(() => { useStore.getState().setPlaying(false) })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(0)    // timeSec=0 (2.0-2.0) → 0 ticks
    expect(notes[0]!.duration).toBe(480)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — 신규 3개 테스트 실패 (useRecording이 아직 `recordingContentStartSec`를 읽지 않음).

- [ ] **Step 3: useRecording.ts 수정**

`apps/web/src/midi/useRecording.ts` 수정 — 상승 에지와 commitTake 두 곳:

**상승 에지 변경 (active && !was 블록):**
```ts
    if (active && !was) {
      eventsRef.current = []
      // 카운트인이 있으면 recordingContentStartSec(= countInDur)를 기준으로 삼아
      // 카운트인 중 입력이 음수 timeSec이 되게 한다.
      // 카운트인 없음(=0)이면 기존처럼 Tone.getTransport().seconds를 사용
      // (arm-after-play에서 이미 진행된 시간을 올바르게 캡처).
      const { recordingContentStartSec } = useStore.getState()
      recordStartSecRef.current = recordingContentStartSec > 0
        ? recordingContentStartSec
        : Tone.getTransport().seconds
      recordTrackIdRef.current = useStore.getState().selectedTrackId
    }
```

**commitTake 내부 변경 — 음수 이벤트 필터 추가:**
```ts
  const commitTake = useCallback(() => {
    const events = eventsRef.current
    if (events.length === 0) { eventsRef.current = []; return }

    const recordStartSec = recordStartSecRef.current
    const trackId = recordTrackIdRef.current
    const { project, quantizeDenom, isPlaying: stillPlaying, recordStopSec, setProject } =
      useStore.getState()

    if (!project.tracks.some((t) => t.id === trackId)) { eventsRef.current = []; return }

    const endAbs = stillPlaying ? Tone.getTransport().seconds : recordStopSec
    const endSec = Math.max(0, endAbs - recordStartSec)

    // 카운트인 중(timeSec < 0) 입력 필터링 — 콘텐츠 구간 이전 입력은 제외
    const contentEvents = events.filter((e) => e.timeSec >= 0)

    const noteDataList = recordedEventsToNotes(contentEvents, {
      ppq: project.transport.ppq,
      tempo: project.transport.tempo,
      quantizeDenom,
      endSec,
    })

    if (noteDataList.length > 0) {
      let updated = project
      for (const noteData of noteDataList) {
        updated = addNote(updated, trackId, createNote(noteData))
      }
      setProject(updated)
    }
    eventsRef.current = []
  }, [])
```

> **기존 테스트 보존:**
> - `recordingContentStartSec` 기본값 0 → `recordingContentStartSec > 0` 조건 false → 기존 `Tone.getTransport().seconds` 경로 그대로.
> - `contentEvents = events.filter(e => e.timeSec >= 0)`: 카운트인 없는 경우 timeSec >= 0인 이벤트만 존재(transport.seconds >= 0이고 recordStartSec=transport.seconds이므로) → 필터 통과. 기존 테스트에서 타이밍이 음수인 케이스 없음.
> - `commitTake`, `handleMidiMessage`, `wasActiveRef` 에지 로직 불변.

완성된 `apps/web/src/midi/useRecording.ts`:
```ts
import { useCallback, useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { useStore } from '../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { recordedEventsToNotes, type RawMidiEvent } from './recording'
import type { MidiNoteMessage } from './parse'

export function useRecording() {
  const eventsRef = useRef<RawMidiEvent[]>([])
  const recordStartSecRef = useRef(0)
  const recordTrackIdRef = useRef<string>('')
  const wasActiveRef = useRef(false)

  const isPlayingRef = useRef(false)
  const isRecordingRef = useRef(false)

  const isPlaying   = useStore((s) => s.isPlaying)
  const isRecording = useStore((s) => s.isRecording)

  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])

  const commitTake = useCallback(() => {
    const events = eventsRef.current
    if (events.length === 0) { eventsRef.current = []; return }

    const recordStartSec = recordStartSecRef.current
    const trackId = recordTrackIdRef.current
    const { project, quantizeDenom, isPlaying: stillPlaying, recordStopSec, setProject } =
      useStore.getState()

    if (!project.tracks.some((t) => t.id === trackId)) { eventsRef.current = []; return }

    const endAbs = stillPlaying ? Tone.getTransport().seconds : recordStopSec
    const endSec = Math.max(0, endAbs - recordStartSec)

    // 카운트인 중(timeSec < 0) 입력 제외.
    // 카운트인 없는 경우(recordStartSec = Tone seconds) 모든 이벤트는 timeSec >= 0.
    const contentEvents = events.filter((e) => e.timeSec >= 0)

    const noteDataList = recordedEventsToNotes(contentEvents, {
      ppq: project.transport.ppq,
      tempo: project.transport.tempo,
      quantizeDenom,
      endSec,
    })

    if (noteDataList.length > 0) {
      let updated = project
      for (const noteData of noteDataList) {
        updated = addNote(updated, trackId, createNote(noteData))
      }
      setProject(updated)
    }
    eventsRef.current = []
  }, [])

  useEffect(() => {
    const active = isPlaying && isRecording
    const was = wasActiveRef.current

    if (active && !was) {
      eventsRef.current = []
      // 카운트인 오프셋이 있으면 그것을 기준으로, 없으면 현재 transport 위치를 기준으로 한다.
      // - 카운트인 녹음: recordingContentStartSec = countInDur > 0
      //   → transport가 0부터 시작, 카운트인 구간(0..countInDur) 중 입력은 timeSec < 0 → 필터됨
      // - 일반 녹음 / arm-after-play: recordingContentStartSec = 0
      //   → Tone.getTransport().seconds(현재 재생 위치)를 기준으로 기존 동작 유지
      const { recordingContentStartSec } = useStore.getState()
      recordStartSecRef.current = recordingContentStartSec > 0
        ? recordingContentStartSec
        : Tone.getTransport().seconds
      recordTrackIdRef.current = useStore.getState().selectedTrackId
    } else if (!active && was) {
      commitTake()
      if (!isPlaying) useStore.getState().setRecording(false)
    }

    wasActiveRef.current = active
  }, [isPlaying, isRecording, commitTake])

  const handleMidiMessage = useCallback((msg: MidiNoteMessage) => {
    if (!isPlayingRef.current || !isRecordingRef.current) return
    const timeSec = Tone.getTransport().seconds - recordStartSecRef.current
    eventsRef.current.push({
      kind: msg.type,
      pitch: msg.pitch,
      velocity: msg.velocity,
      timeSec,
    })
  }, [])

  return { handleMidiMessage }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useRecording.test.ts 기존 테스트 전부 PASS + 신규 3개 PASS. 기존 테스트 시그니처 불변.

---

## Task 7: TransportBar.tsx — 메트로놈 토글 + 카운트인 select

기존 `onPlay`/`onStop` prop 불변. 재생·정지·녹음 버튼 동작 보존.

**Files:** Modify `apps/web/src/audio/TransportBar.tsx`, `apps/web/src/audio/test/TransportBar.test.tsx`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/audio/test/TransportBar.test.tsx` 끝에 추가:
```tsx
// import 추가: import { useStore } from '../../state/store'  (이미 있으면 생략)

  it('메트로놈 버튼이 렌더된다 (aria-label="메트로놈")', () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByRole('button', { name: '메트로놈' })).toBeInTheDocument()
  })

  it('메트로놈 버튼 클릭 시 metronomeEnabled가 true가 된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '메트로놈' }))
    expect(useStore.getState().metronomeEnabled).toBe(true)
  })

  it('메트로놈 버튼 두 번 클릭 시 metronomeEnabled가 false로 토글된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '메트로놈' }))
    await userEvent.click(screen.getByRole('button', { name: '메트로놈' }))
    expect(useStore.getState().metronomeEnabled).toBe(false)
  })

  it('카운트인 select가 렌더되고 metronomeEnabled=false이면 disabled이다', () => {
    // 기본: metronomeEnabled=false
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    const sel = screen.getByRole('combobox', { name: '카운트인' })
    expect(sel).toBeInTheDocument()
    expect(sel).toBeDisabled()
  })

  it('metronomeEnabled=true이면 카운트인 select가 활성화된다', () => {
    useStore.getState().setMetronomeEnabled(true)
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByRole('combobox', { name: '카운트인' })).not.toBeDisabled()
  })

  it('카운트인 select를 2로 변경하면 countInBars=2가 된다', async () => {
    useStore.getState().setMetronomeEnabled(true)
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '카운트인' }), '2')
    expect(useStore.getState().countInBars).toBe(2)
  })
```

- [ ] **Step 2: 실패 확인 (기존 6개 PASS, 신규 6개 FAIL)**

Run: `pnpm --filter @sculptone/web test`
Expected: TransportBar.test.tsx 기존 6개 PASS, 신규 6개 FAIL.

- [ ] **Step 3: TransportBar.tsx 레퍼런스 구현으로 수정**

Replace `apps/web/src/audio/TransportBar.tsx`:
```tsx
import { useStore } from '../state/store'
import { Badge } from '../ui/Badge'

interface Props { onPlay: () => void; onStop: () => void }

export function TransportBar({ onPlay, onStop }: Props) {
  const isPlaying        = useStore((s) => s.isPlaying)
  const isRecording      = useStore((s) => s.isRecording)
  const metronomeEnabled = useStore((s) => s.metronomeEnabled)
  const countInBars      = useStore((s) => s.countInBars)
  const setPlaying        = useStore((s) => s.setPlaying)
  const setRecording      = useStore((s) => s.setRecording)
  const setMetronomeEnabled = useStore((s) => s.setMetronomeEnabled)
  const setCountInBars    = useStore((s) => s.setCountInBars)
  const tempo = useStore((s) => s.project.transport.tempo)

  const handlePlay    = () => { setPlaying(true); onPlay() }
  const handleStop    = () => { setPlaying(false); onStop() }
  const handleRecord  = () => { setRecording(!isRecording) }
  const handleMetronome = () => { setMetronomeEnabled(!metronomeEnabled) }
  const handleCountIn = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCountInBars(Number(e.target.value))
  }

  const tbtn = {
    width: 38, height: 38, borderRadius: '50%', border: 0, cursor: 'pointer',
    display: 'grid', placeItems: 'center',
    background: 'var(--bg-elevated)', color: 'var(--text-hi)',
  } as const

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 6, height: '100%',
    }}>
      {/* 녹음 버튼 */}
      <button
        aria-label="녹음"
        aria-pressed={isRecording}
        onClick={handleRecord}
        style={{
          ...tbtn,
          background: isRecording ? 'var(--record)' : 'var(--bg-elevated)',
          color:      isRecording ? '#fff' : 'var(--text-hi)',
        }}
      >
        ⏺
      </button>

      {/* 재생 버튼 */}
      <button
        aria-label="재생"
        onClick={handlePlay}
        style={{ ...tbtn, width: 46, height: 46, background: 'var(--accent)', color: 'var(--on-accent)' }}
      >
        ▶
      </button>

      {/* 정지 버튼 */}
      <button aria-label="정지" onClick={handleStop} style={tbtn}>⏹</button>

      {/* 메트로놈 토글 */}
      <button
        aria-label="메트로놈"
        aria-pressed={metronomeEnabled}
        onClick={handleMetronome}
        style={{
          ...tbtn,
          background: metronomeEnabled ? 'var(--accent)' : 'var(--bg-elevated)',
          color:      metronomeEnabled ? 'var(--on-accent)' : 'var(--text-hi)',
        }}
      >
        ♩
      </button>

      {/* 카운트인 선택 */}
      <select
        aria-label="카운트인"
        value={countInBars}
        disabled={!metronomeEnabled}
        onChange={handleCountIn}
        style={{
          font: 'inherit', fontSize: 11,
          padding: '2px 4px', borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)', cursor: metronomeEnabled ? 'pointer' : 'default',
          background: 'var(--bg-elevated)', color: 'var(--text-mid)',
        }}
      >
        <option value={0}>카운트인 없음</option>
        <option value={1}>1마디</option>
        <option value={2}>2마디</option>
      </select>

      {/* 템포 + 재생 상태 */}
      <span className="mono" style={{ marginLeft: 10, color: 'var(--text-mid)', fontSize: 13 }}>
        {tempo} BPM {isPlaying ? '· ▶' : ''}
      </span>

      {isRecording && (
        <Badge tone="rec">REC</Badge>
      )}
    </div>
  )
}
```

> **React import 주의:** `React.ChangeEvent` 사용 금지. `handleCountIn`의 타입을 `React.ChangeEvent<HTMLSelectElement>`로 쓰면 TypeScript가 React 네임스페이스를 요구한다. 대신 인라인 이벤트 핸들러에서 타입을 생략하거나, `import type { ChangeEvent } from 'react'`로 named import한다. 아래 수정:
> ```tsx
> import type { ChangeEvent } from 'react'
> // ...
> const handleCountIn = (e: ChangeEvent<HTMLSelectElement>) => {
>   setCountInBars(Number(e.target.value))
> }
> ```
> 파일 최상단에 `import type { ChangeEvent } from 'react'` 추가 후, `React.ChangeEvent` 제거.

> **기존 테스트 보존:**
> - `aria-label="재생"` → `handlePlay` 불변 → 기존 2개 PASS.
> - `aria-label="정지"` → `handleStop` 불변 → 기존 2개 PASS.
> - `aria-label="녹음"` → `handleRecord` 불변 → 기존 4개 PASS.
> - `onPlay`/`onStop` prop 시그니처 불변.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: TransportBar.test.tsx 6+6=12개 PASS. 기존 테스트 영향 없음.

---

## Task 8: 최종 게이트

- [ ] **Step 1: 전체 web 테스트 통과 확인**

Run: `pnpm --filter @sculptone/web test`

예상 최소 테스트 수:
- 기존: 312개
- 신규:
  - metronome.test.ts: 21개 (순수 19 + 스모크 2)
  - editor-store.test.ts: +3개
  - playback.test.ts: +4개
  - useAudio.test.ts: +4개
  - useRecording.test.ts: +3개
  - TransportBar.test.tsx: +6개
- **목표: ≥ 353개**

> **기존 테스트 보존 체크리스트:**
> - `TransportBar.test.tsx` 기존 6개(재생·정지·녹음): `onPlay`/`onStop`/`aria-label` 시그니처 불변 → PASS
> - `playback.test.ts` 기존 9개: `PlayOptions` 필드 추가만(선택), `countInDurationSec` 기본 0 → `item.timeSec + 0 = item.timeSec` → 기존 단언 불변 → PASS
> - `useAudio.test.ts` 기존 테스트: `metronomeEnabled` 기본 false → `createMetronome` 미호출 → 기존 `createInstrument` 호출 수 불변 → PASS
> - `useRecording.test.ts` 기존 테스트: `recordingContentStartSec` 기본 0 → `recordingContentStartSec > 0` false → `Tone.getTransport().seconds` 경로(기존 동작) → PASS. `contentEvents.filter(e => e.timeSec >= 0)`: 기존 테스트에서 모든 이벤트 timeSec >= 0 → 필터 통과 → 기존 단언 불변 → PASS
> - `editor-store.test.ts` 기존: `metronomeEnabled/countInBars/recordingContentStartSec` 기본값 추가만 → `getInitialState()` 리셋에 포함 → PASS
> - `AppShell.test.tsx`, `AppShell.compose.test.tsx`: `useAudio` 모킹으로 `useAudio` 내부 로직 격리 → PASS

- [ ] **Step 2: 최종 모노레포 게이트**

Run: `pnpm -r test`
Expected: 전 패키지 통과.

- [ ] **Step 3: 타입 체크 + 빌드**

Run:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
```
Expected: 타입 에러 없음, 빌드 성공.

> **타입 주의 사항:**
> - `import type { ChangeEvent } from 'react'` 사용, `React.ChangeEvent` 미사용.
> - `computeClickTimes`에 `project.transport.timeSignature as [number, number]` 단언 — `timeSignature`가 `[number, number]` tuple 타입이면 단언 제거 가능. `@sculptone/score-model`의 정의 확인 필요.
> - `MetronomeHandle` 타입은 `playback.ts`에서 `import type { MetronomeHandle } from './metronome'`으로 사용.
> - `metronome.ts`는 `import * as Tone from 'tone'`(top-level) 패턴을 사용한다. `createMetronome()`은 `new Tone.Synth()`를 호출하므로 테스트 시 `vi.mock('tone')` 필수. 순수 함수 테스트는 Tone 호출 없음.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (web ≥ 353개).
- `computeClickTimes`: 4/4, 3/4 박자, fromSec 오프셋, durationSec 경계, accent 패턴 — 자동 테스트 검증.
- `createMetronome`: click(time, true) → accent synth C5, click(time, false) → normal synth C4 — 스모크 테스트 검증.
- `playback.ts`: `metronome` 옵션 시 모든 박에 클릭 스케줄, `countInDurationSec` > 0 시 content 노트 오프셋 — 자동 테스트 검증.
- `useAudio.ts`: `metronomeEnabled=true` 시 `createMetronome` 호출, `isRecording+countInBars>0` 시 `recordingContentStartSec` 설정 — 자동 테스트 검증.
- `useRecording.ts`: 카운트인 중 입력 제외, 콘텐츠 기준 타이밍 정확, arm-after-play 기존 동작 보존 — 자동 테스트 검증.
- TransportBar: 메트로놈 토글(aria-pressed, 색상), 카운트인 select(metronomeEnabled=false시 disabled), 선택 → countInBars 반영 — 자동 테스트 검증.
- 기존 312개 테스트 전부 PASS.
- 하드코딩 색상 없음 — 신규 UI는 `var(--accent)`, `var(--on-accent)`, `var(--bg-elevated)`, `var(--text-hi)` 등 CSS 변수만 사용.
- `React.XXX` 네임스페이스 미사용 — 모든 React 타입은 named import.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후 별도 작성)

- **재생 중 라이브 미리듣기:** 녹음 arm 상태에서 MIDI noteon 시 selectedTrack instrument 즉시 트리거.
- **메트로놈 볼륨 조절:** 클릭 사운드 레벨을 TransportBar 슬라이더로 제어.
- **시각 박자 인디케이터:** 재생 중 현재 박을 TransportBar에 점멸 표시.
- **템포 탭 입력:** TransportBar에 "Tap" 버튼 추가, 연속 탭으로 BPM 자동 계산.

---

## 열린 질문

1. **`computeClickTimes` 부동소수점 누적 오차:** `i * beatDur`로 절대 위치를 계산하므로 누적 오차가 없다(`(i-1) * beatDur + beatDur` 대신). 그러나 비율이 무리수인 tempo(예: 100BPM = 0.6s/beat)에서 박 경계 판별 시 `1e-9` 허용 오차(`fromSec - 1e-9`) 적용 여부를 고려한다.

2. **`timeSignature` 타입 (`@sculptone/score-model`):** `project.transport.timeSignature`가 `[number, number]` tuple이면 `as [number, number]` 단언 불필요. `number[]`이면 단언 또는 보정 함수 추가. `playback.ts` 내 `score-model` 타입 확인 후 결정.

3. **카운트인 중 콘텐츠 발음:** 현재 계획은 카운트인 구간에 기존 노트를 발음하지 않는다(content notes는 countInDur 이후로 오프셋됨). 카운트인 중에도 기존 재생 노트를 들으면서 체크하고 싶다면 별도 설계 필요.

4. **metronome 인스턴스 재사용 vs 재생성:** 현재 설계는 `metronomeEnabled` 변경 시 `dispose` 후 재생성. 재생 세션 간 동일 Synth 재사용 시 Tone.js의 envelope reset 필요 여부 확인.

5. **`handleCountIn`의 React import:** `ChangeEvent`를 `'react'`에서 named import하면 `import type { ChangeEvent } from 'react'` 1줄 추가 필요. 기존 파일에 React import가 없으므로 최초 React 타입 import가 된다. `React.` 네임스페이스 사용 금지 규칙을 준수한다.

6. **카운트인 정밀도:** `barsToSeconds`는 부동소수점 계산. `countInDurationSec = 4.000000000001` 등 미세 오차 시 카운트인 마지막 클릭이 겹치거나 누락될 수 있음. `computeClickTimes` 의 반열림 구간 경계(`>= toSec`)를 `1e-9` 마진으로 보정하는 방안 고려.
