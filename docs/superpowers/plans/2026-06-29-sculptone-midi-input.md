# Sculptone Web MIDI 실시간 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Web MIDI API를 통한 실시간 MIDI 입력·녹음을 구현해, 사용자가 외부 MIDI 키보드로 연주하고 선택된 트랙에 노트를 실시간 녹음할 수 있게 한다.

**Architecture:** 순수 로직(`parseMidiMessage` / `recordedEventsToNotes` / `stepInsert`)은 완전 TDD로 검증한다. Web MIDI 바인딩(`useMidi`)은 `navigator.requestMIDIAccess`를 `vi.stubGlobal`로 모킹해 jsdom에서 테스트한다. 녹음 통합 훅(`useRecording`)은 Tone.getTransport 모킹 + store 직접 구독으로 테스트한다. UI(TransportBar Record 버튼, MidiDeviceSelect)는 레퍼런스 구현을 계획서에 제시하고 @testing-library/react로 검증한다. 기존 141개 테스트는 전부 보존한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Web MIDI API · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 스펙 `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`, 디자인 가이드 `documents/sculptone-design-guide.html`, 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-multitrack-mixer.md`, `docs/superpowers/plans/2026-06-29-sculptone-persistence-export.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- MIDI 출력 (MIDIOutput)
- MIDI clock / 외부 동기 (Sync to MIDI clock)
- 벨로시티 커브·감도 설정
- 여러 MIDI 장치 동시 머지 (장치 1개 선택만)
- MPE (Multi-dimensional Polyphonic Expression)
- MusicXML 내보내기
- 멀티트랙 동시 녹음 (녹음 대상은 selectedTrack 1개)
- 재생 중 라이브 미리듣기 (입력 노트 즉시 발음) — 선택 확장으로 남김
- 클라우드 저장 / 협업

---

## 설계 근거

- **parseMidiMessage 채널 마스킹:** MIDI 상태 바이트 상위 니블(0xF0 마스크)로 메시지 종류 판별, 하위 니블(채널)은 무시. 이렇게 하면 어떤 채널로 수신해도 동일하게 동작.
- **velocity 0 noteoff 정규화:** 0x9n 메시지에서 velocity=0은 MIDI 표준상 noteoff와 동일. parseMidiMessage에서 `type: 'noteoff'`로 정규화해 recording.ts가 단순한 kind 비교만 하면 되게 함.
- **recordedEventsToNotes FIFO 매칭:** 동일 pitch의 noteon이 여러 개 겹칠 경우(빠른 트릴) pitch별 FIFO 큐로 관리. 큐가 비어있는데 noteoff가 오면(dangling noteoff) 스킵. 큐에 남은 noteon은 endSec로 마감(dangling noteon).
- **타임스탬프 소스:** `Tone.getTransport().seconds` — 재생 시작 시점을 `recordStartSec`으로 캡처하고, 각 MIDI 이벤트에서 `Tone.getTransport().seconds - recordStartSec`를 상대 초로 사용.
- **양자화 적용 지점:** `start = snap(secondsToTicks(timeSec, ppq, tempo), gridTicks)`. duration은 스냅 없이 ticks 단위 반올림(Math.round). 최소 duration = 1 tick(부동소수점·동시 입력 방어).
- **useMidi 모킹 전략:** jsdom에 `navigator.requestMIDIAccess` 없음 → `vi.stubGlobal('navigator', {...})` 로 가짜 MIDIAccess·inputs Map을 주입. 입력 객체는 `onmidimessage` setter/getter 포함 plain object. `afterEach(() => vi.unstubAllGlobals())` 로 격리.
- **useRecording ref 패턴:** `isPlaying`/`isRecording` 값을 ref에 미러링해 `handleMidiMessage` 콜백이 재생성 없이 최신 상태를 읽게 함. `useMidi`의 onmidimessage 핸들러가 stale closure 없이 동작.
- **기존 TransportBar 테스트 보존:** Record 버튼 추가 시 `onPlay`/`onStop` prop 시그니처 변경 없음. 기존 테스트의 `<TransportBar onPlay={...} onStop={...} />` 렌더 코드는 그대로 동작.
- **AppShell 기존 테스트 보존:** `useMidi`와 `useRecording`을 AppShell에 추가할 때, 기존 `AppShell.test.tsx`와 `AppShell.compose.test.tsx`에 두 훅의 모킹을 추가.

---

## File Structure

```
apps/web/src/
  midi/
    parse.ts                       # NEW: parseMidiMessage (순수)
    recording.ts                   # NEW: recordedEventsToNotes, stepInsert (순수)
    useMidi.ts                     # NEW: Web MIDI 바인딩 훅
    useRecording.ts                # NEW: 녹음 통합 훅
    MidiDeviceSelect.tsx           # NEW: 장치 선택 드롭다운 컴포넌트
    test/
      parse.test.ts                # NEW: parseMidiMessage 완전 TDD (9개)
      recording.test.ts            # NEW: recordedEventsToNotes + stepInsert TDD (13개)
      useMidi.test.ts              # NEW: 장치 열거·메시지 디스패치·미지원 (5개)
      useRecording.test.ts         # NEW: 이벤트 수집·커밋 동작 (4개)
      MidiDeviceSelect.test.tsx    # NEW: UI 동작 (4개)

  audio/
    TransportBar.tsx               # MOD: Record 버튼 + REC 배지 추가
    test/
      TransportBar.test.tsx        # MOD: Record 버튼 4개 테스트 추가 (기존 2개 보존)

  state/
    store.ts                       # MOD: isRecording + setRecording 추가
  test/
    editor-store.test.ts           # MOD: isRecording 테스트 2개 추가

  shell/
    AppShell.tsx                   # MOD: useMidi + useRecording + MidiDeviceSelect 통합
  test/
    AppShell.test.tsx              # MOD: useMidi + useRecording 모킹 추가
    AppShell.compose.test.tsx      # MOD: 동일
```

---

## Task 1: midi/parse.ts — MIDI 메시지 파서 (완전 TDD)

**Files:** Create `apps/web/src/midi/parse.ts`, `apps/web/src/midi/test/parse.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/midi/test/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseMidiMessage } from '../parse'

describe('parseMidiMessage', () => {
  // ── noteon ────────────────────────────────────────────────────

  it('0x90 (ch1) + velocity>0 → noteon 반환', () => {
    const result = parseMidiMessage([0x90, 60, 100])
    expect(result).toEqual({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  it('0x91 (ch2) → 채널 무시하고 noteon 반환', () => {
    const result = parseMidiMessage([0x91, 64, 80])
    expect(result).toEqual({ type: 'noteon', pitch: 64, velocity: 80 })
  })

  it('0x9F (ch16) → 채널 무시하고 noteon 반환', () => {
    const result = parseMidiMessage([0x9F, 48, 64])
    expect(result).toEqual({ type: 'noteon', pitch: 48, velocity: 64 })
  })

  // ── velocity=0 정규화 ─────────────────────────────────────────

  it('0x90 velocity=0 → noteoff로 정규화', () => {
    const result = parseMidiMessage([0x90, 60, 0])
    expect(result).toEqual({ type: 'noteoff', pitch: 60, velocity: 0 })
  })

  // ── noteoff ───────────────────────────────────────────────────

  it('0x80 (ch1) → noteoff 반환', () => {
    const result = parseMidiMessage([0x80, 60, 0])
    expect(result).toEqual({ type: 'noteoff', pitch: 60, velocity: 0 })
  })

  it('0x83 (ch4) → 채널 무시하고 noteoff 반환', () => {
    const result = parseMidiMessage([0x83, 72, 40])
    expect(result).toEqual({ type: 'noteoff', pitch: 72, velocity: 40 })
  })

  // ── 무시할 메시지들 ──────────────────────────────────────────

  it('0xB0 Control Change → null', () => {
    expect(parseMidiMessage([0xB0, 7, 127])).toBeNull()
  })

  it('0xA0 Aftertouch → null', () => {
    expect(parseMidiMessage([0xA0, 60, 64])).toBeNull()
  })

  it('0xE0 Pitch Bend → null', () => {
    expect(parseMidiMessage([0xE0, 0, 64])).toBeNull()
  })

  // ── Uint8Array 입력 ───────────────────────────────────────────

  it('Uint8Array 입력도 동일하게 동작한다', () => {
    const result = parseMidiMessage(new Uint8Array([0x90, 60, 100]))
    expect(result).toEqual({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  // ── 방어 ─────────────────────────────────────────────────────

  it('빈 배열 → null (방어)', () => {
    expect(parseMidiMessage([])).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../parse'` 모듈 없음.

- [ ] **Step 3: 구현**

Create `apps/web/src/midi/parse.ts`:
```ts
export interface MidiNoteMessage {
  type: 'noteon' | 'noteoff'
  pitch: number
  velocity: number
}

/**
 * Web MIDI API onmidimessage 이벤트의 data를 파싱해 noteon/noteoff 메시지를 반환한다.
 *
 * - 0x9n (noteon): velocity > 0이면 noteon, velocity = 0이면 noteoff로 정규화.
 * - 0x8n (noteoff): noteoff 반환.
 * - 그 외 (CC / Aftertouch / PitchBend / SysEx 등): null 반환.
 *
 * 채널(상태 바이트 하위 니블)은 무시한다.
 */
export function parseMidiMessage(data: Uint8Array | number[]): MidiNoteMessage | null {
  if (data.length < 1) return null
  const status = data[0] ?? 0
  const pitch = data[1] ?? 0
  const velocity = data[2] ?? 0

  const msgType = status & 0xf0 // 채널 니블 제거

  if (msgType === 0x90) {
    if (velocity === 0) return { type: 'noteoff', pitch, velocity: 0 }
    return { type: 'noteon', pitch, velocity }
  }
  if (msgType === 0x80) {
    return { type: 'noteoff', pitch, velocity }
  }
  return null
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: parse.test.ts 11개 PASS. 기존 테스트 영향 없음.

---

## Task 2: midi/recording.ts — 녹음 이벤트→Note[] 변환 (완전 TDD)

`recordedEventsToNotes`는 순수 함수로 Tone 의존 없이 완전 TDD한다. `stepInsert` 헬퍼도 포함.

**Files:** Create `apps/web/src/midi/recording.ts`, `apps/web/src/midi/test/recording.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/midi/test/recording.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { recordedEventsToNotes, stepInsert } from '../recording'
import type { RawMidiEvent, RecordingContext } from '../recording'

// ── 공통 컨텍스트 ─────────────────────────────────────────────
// 120BPM, ppq=480 → 1tick = 1/480 박자, 1박 = 0.5s, 1/16 = 30ticks
const CTX_DEFAULT: RecordingContext = {
  ppq: 480,
  tempo: 120,
  quantizeDenom: 16,
  endSec: 4.0,
}

// ── recordedEventsToNotes ─────────────────────────────────────

describe('recordedEventsToNotes', () => {
  it('단일 noteon+noteoff → 피치·시작·길이·벨로시티 정확', () => {
    // noteon at 0s pitch60 vel96, noteoff at 0.5s → duration 0.5s
    // start=0s → 0 ticks → snap(0, 120)=0
    // duration=0.5s → 240 ticks (0.5 * 120 * 480 / 60)
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 96, timeSec: 0.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.start).toBe(0)       // snap(0, 120)=0
    expect(notes[0]!.duration).toBe(240)   // 0.5s = 240 ticks at 120bpm ppq480
    expect(notes[0]!.velocity).toBe(96)
  })

  it('다른 피치 2개 노트 → 각각 독립적으로 매칭', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },
      { kind: 'noteon',  pitch: 64, velocity: 70, timeSec: 0.1 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
      { kind: 'noteoff', pitch: 64, velocity: 0,  timeSec: 0.6 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(2)
    const n60 = notes.find((n) => n.pitch === 60)!
    const n64 = notes.find((n) => n.pitch === 64)!
    expect(n60.velocity).toBe(80)
    expect(n64.velocity).toBe(70)
  })

  it('dangling noteon → endSec까지 지속으로 마감', () => {
    // noteon at 0s, no matching noteoff → closed at endSec=4.0s
    // duration = 4.0s = 1920 ticks
    const events: RawMidiEvent[] = [
      { kind: 'noteon', pitch: 60, velocity: 100, timeSec: 0.0 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, endSec: 4.0 })
    expect(notes).toHaveLength(1)
    expect(notes[0]!.duration).toBe(1920) // 4.0s at 120bpm ppq480
  })

  it('dangling noteon이 endSec와 같은 시점 → duration<=0으로 제외', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon', pitch: 60, velocity: 100, timeSec: 0.0 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, endSec: 0.0 })
    expect(notes).toHaveLength(0)
  })

  it('dangling noteoff (매칭 noteon 없음) → 스킵', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteoff', pitch: 60, velocity: 0, timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(0)
  })

  it('양자화 적용: start가 1/16 그리드에 스냅된다', () => {
    // 1/16 at 120bpm ppq480 = divisionToTicks(16,480) = 480*4/16 = 120 ticks
    // noteon at 0.04s → secondsToTicks(0.04, 480, 120) = 0.04*120/60*480 = 38.4 ticks
    // snap(38.4, 120) = round(38.4/120)*120 = 0*120 = 0
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.04 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.54 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.start).toBe(0) // 38ticks → snap to 0
  })

  it('양자화 적용: start가 가장 가까운 1/16에 스냅된다 (오른쪽)', () => {
    // noteon at 0.07s → ticks = 0.07*120/60*480 = 67.2 → snap(67.2,120) = 120
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.07 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.57 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes[0]!.start).toBe(120) // snap to next 1/16 grid
  })

  it('quantizeDenom=0 → 스냅 없이 raw ticks', () => {
    // noteon at 0.04s → ticks = 38.4 → Math.round = 38 (실제 구현은 snap(t,0)=t)
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.04 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.54 },
    ]
    const ctx: RecordingContext = { ...CTX_DEFAULT, quantizeDenom: 0 }
    const notes = recordedEventsToNotes(events, ctx)
    // snap(38.4, 0) = 38.4 → secondsToTicks 결과 그대로 (소수 발생 → Math.round로 정수화)
    // 38 ticks (Math.round(38.4))
    expect(notes[0]!.start).toBe(38)
  })

  it('최소 duration 보장: noteon과 noteoff가 동시에 → duration=1 tick', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.5 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    // duration=0 → clamped to 1
    expect(notes[0]!.duration).toBeGreaterThanOrEqual(1)
  })

  it('velocity는 noteon의 값을 보존한다', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 42, timeSec: 0.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes[0]!.velocity).toBe(42)
  })

  it('결과가 start(ticks) 오름차순으로 정렬된다', () => {
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 64, velocity: 80, timeSec: 0.5 },  // start: 240 ticks
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },  // start: 0 ticks
      { kind: 'noteoff', pitch: 64, velocity: 0,  timeSec: 1.0 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
    ]
    const notes = recordedEventsToNotes(events, CTX_DEFAULT)
    expect(notes).toHaveLength(2)
    expect(notes[0]!.pitch).toBe(60)  // start=0 → 먼저
    expect(notes[1]!.pitch).toBe(64)  // start=240 → 나중
  })

  it('동일 pitch의 빠른 연타: FIFO 순서로 매칭', () => {
    // 첫 번째 noteon-noteoff 쌍, 그 다음 두 번째 쌍
    const events: RawMidiEvent[] = [
      { kind: 'noteon',  pitch: 60, velocity: 80, timeSec: 0.0 },
      { kind: 'noteon',  pitch: 60, velocity: 70, timeSec: 0.3 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.5 },
      { kind: 'noteoff', pitch: 60, velocity: 0,  timeSec: 0.8 },
    ]
    const notes = recordedEventsToNotes(events, { ...CTX_DEFAULT, quantizeDenom: 0 })
    expect(notes).toHaveLength(2)
    // 첫 noteon(vel=80)이 첫 noteoff(0.5s)와 매칭
    expect(notes[0]!.velocity).toBe(80)
    expect(notes[1]!.velocity).toBe(70)
  })

  it('이벤트 없음 → 빈 배열', () => {
    expect(recordedEventsToNotes([], CTX_DEFAULT)).toEqual([])
  })
})

// ── stepInsert ────────────────────────────────────────────────

describe('stepInsert', () => {
  it('커서를 gridTicks만큼 전진시킨다', () => {
    expect(stepInsert(480, 120)).toBe(600)
  })

  it('커서 0에서 시작해도 전진한다', () => {
    expect(stepInsert(0, 480)).toBe(480)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../recording'` 모듈 없음.

- [ ] **Step 3: 구현**

Create `apps/web/src/midi/recording.ts`:
```ts
import { secondsToTicks } from '../compose/time'
import { divisionToTicks, snap } from '../compose/quantize'
import type { Note } from '@sculptone/score-model'

export interface RawMidiEvent {
  kind: 'noteon' | 'noteoff'
  pitch: number
  velocity: number
  timeSec: number // 녹음 시작 기준 상대 초
}

export interface RecordingContext {
  ppq: number
  tempo: number
  quantizeDenom: number // 0 또는 음수 → 양자화 없음(snap 스킵)
  endSec: number       // 녹음 종료 시점(상대 초). dangling noteon 마감에 사용.
}

/**
 * MIDI noteon/noteoff 이벤트 배열을 Note 데이터 배열로 변환한다.
 *
 * - pitch별 FIFO 큐로 noteon↔noteoff 매칭.
 * - dangling noteoff (매칭 noteon 없음) → 스킵.
 * - dangling noteon (매칭 noteoff 없음) → endSec로 마감.
 * - start: secondsToTicks(timeSec) 후 snap(gridTicks)로 양자화.
 * - duration: Math.max(1, Math.round(secondsToTicks(durSec))). 최소 1 tick.
 * - 결과를 start 오름차순으로 정렬.
 *
 * 반환 타입이 Omit<Note, 'id'>인 이유: createNote()로 id를 생성해 addNote에 전달.
 */
export function recordedEventsToNotes(
  events: RawMidiEvent[],
  ctx: RecordingContext,
): Array<Omit<Note, 'id'>> {
  const { ppq, tempo, quantizeDenom, endSec } = ctx
  const gridTicks = quantizeDenom > 0 ? divisionToTicks(quantizeDenom, ppq) : 0

  // pitch → 활성 noteon 큐 (FIFO)
  const active = new Map<number, Array<{ timeSec: number; velocity: number }>>()
  const results: Array<Omit<Note, 'id'>> = []

  for (const ev of events) {
    if (ev.kind === 'noteon') {
      if (!active.has(ev.pitch)) active.set(ev.pitch, [])
      active.get(ev.pitch)!.push({ timeSec: ev.timeSec, velocity: ev.velocity })
    } else {
      // noteoff
      const queue = active.get(ev.pitch)
      if (!queue || queue.length === 0) continue // dangling noteoff → 스킵
      const on = queue.shift()!
      const durSec = ev.timeSec - on.timeSec
      if (durSec <= 0) {
        // 동시 입력 방어: duration 1 tick 보장
        const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
        const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
        results.push({ pitch: ev.pitch, start, duration: 1, velocity: on.velocity })
        continue
      }
      const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
      const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
      const duration = Math.max(1, Math.round(secondsToTicks(durSec, ppq, tempo)))
      results.push({ pitch: ev.pitch, start, duration, velocity: on.velocity })
    }
  }

  // dangling noteon → endSec로 마감
  for (const [pitch, queue] of active.entries()) {
    for (const on of queue) {
      const durSec = endSec - on.timeSec
      if (durSec <= 0) continue // endSec 이전 입력이 없으면 스킵
      const rawStart = secondsToTicks(on.timeSec, ppq, tempo)
      const start = gridTicks > 0 ? snap(rawStart, gridTicks) : Math.round(rawStart)
      const duration = Math.max(1, Math.round(secondsToTicks(durSec, ppq, tempo)))
      results.push({ pitch, start, duration, velocity: on.velocity })
    }
  }

  // start 오름차순 정렬
  results.sort((a, b) => a.start - b.start)

  return results
}

/**
 * Step input 모드 커서 전진 헬퍼.
 * cursorTick에서 gridTicks만큼 이동한 다음 위치를 반환한다.
 */
export function stepInsert(cursorTick: number, gridTicks: number): number {
  return cursorTick + gridTicks
}
```

> **타입 노트:** `Omit<Note, 'id'>` 반환 타입은 `@sculptone/score-model`의 `Note`를 import해 사용. `recording.ts`는 Tone.js에 의존하지 않아 `apps/web` 내에서도 Vitest의 jsdom 환경에서 순수 함수로 완전 테스트된다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: recording.test.ts 13개 PASS (recordedEventsToNotes 11개 + stepInsert 2개). 기존 테스트 영향 없음.

---

## Task 3: store — isRecording 상태 추가

**Files:** Modify `apps/web/src/state/store.ts`, `apps/web/src/test/editor-store.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/test/editor-store.test.ts` 의 `describe('editor store', ...)` 블록 끝에 추가:
```ts
  it('초기 isRecording은 false이다', () => {
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('setRecording(true) → isRecording true, setRecording(false) → false', () => {
    useStore.getState().setRecording(true)
    expect(useStore.getState().isRecording).toBe(true)
    useStore.getState().setRecording(false)
    expect(useStore.getState().isRecording).toBe(false)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `isRecording` / `setRecording`이 AppState에 없음.

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts`에서 `AppState` 인터페이스에 추가:
```ts
  isRecording: boolean
  setRecording: (recording: boolean) => void
```

`create<AppState>(...)` 의 초기 상태 객체에 추가:
```ts
  isRecording: false,
  setRecording: (recording) => set({ isRecording: recording }),
```

완성된 `store.ts`:
```ts
import { create } from 'zustand'
import {
  createEmptyProject, createTrack, addTrack, type Project,
} from '@sculptone/score-model'

export type Mode = 'compose' | 'play' | 'transcribe'

export interface AppState {
  activeMode: Mode
  project: Project
  selectedTrackId: string
  selectedNoteId: string | null
  quantizeDenom: number
  isPlaying: boolean
  isRecording: boolean
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
  replaceProject: (project: Project) => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
  setRecording: (recording: boolean) => void
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
  setMode: (mode) => set({ activeMode: mode }),
  setProject: (project) => set({ project }),
  replaceProject: (project) =>
    set({ project, selectedTrackId: project.tracks[0]?.id ?? '', selectedNoteId: null }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setRecording: (recording) => set({ isRecording: recording }),
}))
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: editor-store.test.ts 6개 PASS (기존 4 + 신규 2). 기존 테스트 전체 영향 없음 (isRecording: false는 초기 상태에 존재하므로 getInitialState() 호출로 리셋되는 기존 beforeEach도 정상 동작).

---

## Task 4: midi/useMidi.ts — Web MIDI 바인딩 훅

**Files:** Create `apps/web/src/midi/useMidi.ts`, `apps/web/src/midi/test/useMidi.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/midi/test/useMidi.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMidi } from '../useMidi'

// ── 가짜 MIDIAccess 픽스처 ────────────────────────────────────
type MidiHandler = ((e: { data: Uint8Array }) => void) | null

function makeFakeInput(id: string, name: string) {
  let _handler: MidiHandler = null
  return {
    id,
    name,
    get onmidimessage(): MidiHandler { return _handler },
    set onmidimessage(fn: MidiHandler) { _handler = fn },
    _dispatch(data: Uint8Array) { _handler?.({ data }) },
  }
}

const fakeInput1 = makeFakeInput('device-1', 'Test Piano')
const fakeInput2 = makeFakeInput('device-2', 'Test Drum')

const fakeMIDIAccess = {
  inputs: new Map([
    ['device-1', fakeInput1],
    ['device-2', fakeInput2],
  ]),
  outputs: new Map(),
}

// ── beforeEach: navigator 스텁 ────────────────────────────────
beforeEach(() => {
  vi.stubGlobal('navigator', {
    requestMIDIAccess: vi.fn().mockResolvedValue(fakeMIDIAccess),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fakeInput1.onmidimessage = null
  fakeInput2.onmidimessage = null
})

describe('useMidi', () => {
  it('마운트 시 requestMIDIAccess를 호출하고 장치 목록을 반환한다', async () => {
    const { result } = renderHook(() => useMidi(() => {}))
    await waitFor(() => {
      expect(result.current.devices).toHaveLength(2)
    })
    expect(result.current.devices[0]!.name).toBe('Test Piano')
    expect(result.current.devices[1]!.name).toBe('Test Drum')
    expect(result.current.isSupported).toBe(true)
    expect(result.current.accessError).toBeNull()
  })

  it('selectDevice 후 해당 장치의 MIDI 메시지가 콜백으로 전달된다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))

    await waitFor(() => { expect(result.current.devices).toHaveLength(2) })

    act(() => { result.current.selectDevice('device-1') })

    // noteon 메시지 디스패치
    act(() => { fakeInput1._dispatch(new Uint8Array([0x90, 60, 100])) })

    expect(onMessage).toHaveBeenCalledWith({ type: 'noteon', pitch: 60, velocity: 100 })
  })

  it('parseMidiMessage가 null 반환하는 메시지(CC 등)는 콜백을 호출하지 않는다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))
    await waitFor(() => { expect(result.current.devices).toHaveLength(2) })
    act(() => { result.current.selectDevice('device-1') })

    // Control Change → null → 콜백 없음
    act(() => { fakeInput1._dispatch(new Uint8Array([0xB0, 7, 127])) })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('장치 선택 해제(null) 시 메시지 수신이 중단된다', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useMidi(onMessage))
    await waitFor(() => { expect(result.current.devices).toHaveLength(2) })

    act(() => { result.current.selectDevice('device-1') })
    act(() => { result.current.selectDevice(null) })
    act(() => { fakeInput1._dispatch(new Uint8Array([0x90, 60, 100])) })

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('navigator.requestMIDIAccess가 없으면 isSupported=false, devices=[]', () => {
    vi.unstubAllGlobals()
    // requestMIDIAccess 없는 navigator
    vi.stubGlobal('navigator', {})

    const { result } = renderHook(() => useMidi(() => {}))

    expect(result.current.isSupported).toBe(false)
    expect(result.current.devices).toEqual([])
  })
})
```

> **jsdom 주의:** `vi.stubGlobal('navigator', ...)` 는 `navigator` 전체를 교체한다. `afterEach`에서 `vi.unstubAllGlobals()`로 반드시 복원한다. `requestMIDIAccess`가 없는 테스트는 `navigator = {}`만 설정해도 충분 — TypeScript에서 `navigator as Navigator & { requestMIDIAccess?: ... }`로 캐스팅해 접근.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../useMidi'` 모듈 없음.

- [ ] **Step 3: useMidi.ts 레퍼런스 구현**

Create `apps/web/src/midi/useMidi.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseMidiMessage, type MidiNoteMessage } from './parse'

export interface MidiDevice {
  id: string
  name: string
}

// navigator.requestMIDIAccess 타입 어시스턴스 (Web MIDI API는 lib.dom.d.ts 선택 사양)
type MIDIAccessCompat = {
  inputs: Map<string, { id: string; name: string; onmidimessage: ((e: { data: Uint8Array }) => void) | null }>
  outputs: Map<string, unknown>
}

type NavWithMidi = Navigator & {
  requestMIDIAccess?: () => Promise<MIDIAccessCompat>
}

export function useMidi(onMessage: (msg: MidiNoteMessage) => void) {
  const [devices, setDevices] = useState<MidiDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)

  const accessRef = useRef<MIDIAccessCompat | null>(null)
  // stable callback ref — useMidi의 onMessage prop이 바뀌어도 핸들러 재등록 불필요
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  useEffect(() => {
    const nav = navigator as NavWithMidi
    if (!nav.requestMIDIAccess) {
      setIsSupported(false)
      return
    }
    nav
      .requestMIDIAccess()
      .then((access) => {
        accessRef.current = access
        const devs: MidiDevice[] = []
        access.inputs.forEach((input) => {
          devs.push({ id: input.id, name: input.name })
        })
        setDevices(devs)
      })
      .catch((err: Error) => {
        setAccessError(err.name ?? 'Unknown error')
      })
  }, [])

  const selectDevice = useCallback((id: string | null) => {
    setSelectedDeviceId(id)
    if (!accessRef.current) return
    accessRef.current.inputs.forEach((input) => {
      if (input.id === id) {
        input.onmidimessage = (e) => {
          const msg = parseMidiMessage(e.data)
          if (msg) onMessageRef.current(msg)
        }
      } else {
        input.onmidimessage = null
      }
    })
  }, [])

  return { devices, selectedDeviceId, selectDevice, isSupported, accessError }
}
```

> **타입 노트:** `MIDIAccessCompat`은 브라우저 `MIDIAccess` 인터페이스의 부분 타입으로 직접 정의. `lib.dom.d.ts`에서 `webmidi` 타겟 없이 빌드하더라도 타입 에러 없음. `React.XXX` 네임스페이스 미사용 — 모든 React 타입은 named import.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useMidi.test.ts 5개 PASS. 기존 테스트 영향 없음.

---

## Task 5: audio/TransportBar.tsx — Record 버튼 + REC 배지

기존 `onPlay`/`onStop` prop 시그니처 변경 없이 Record 버튼을 추가한다.

**Files:** Modify `apps/web/src/audio/TransportBar.tsx`, `apps/web/src/audio/test/TransportBar.test.tsx`

- [ ] **Step 1: 신규 테스트 추가 (기존 테스트 보존)**

`apps/web/src/audio/test/TransportBar.test.tsx` 의 `describe('TransportBar', ...)` 블록 끝에 추가:
```ts
  it('녹음 버튼이 렌더된다 (aria-label="녹음")', () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByRole('button', { name: '녹음' })).toBeInTheDocument()
  })

  it('녹음 버튼 클릭 시 isRecording이 true가 된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    expect(useStore.getState().isRecording).toBe(true)
  })

  it('두 번 클릭 시 isRecording이 false로 토글된다', async () => {
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    await userEvent.click(screen.getByRole('button', { name: '녹음' }))
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('isRecording=true 시 REC 배지가 표시된다', () => {
    useStore.getState().setRecording(true)
    render(<TransportBar onPlay={() => {}} onStop={() => {}} />)
    expect(screen.getByText('REC')).toBeInTheDocument()
  })
```

- [ ] **Step 2: 실패 확인 (기존 2개는 PASS, 신규 4개는 FAIL)**

Run: `pnpm --filter @sculptone/web test`
Expected: TransportBar.test.tsx 기존 2개 PASS, 신규 4개 FAIL.

- [ ] **Step 3: TransportBar.tsx 레퍼런스 구현으로 교체**

Replace `apps/web/src/audio/TransportBar.tsx`:
```tsx
import { useStore } from '../state/store'
import { Badge } from '../ui/Badge'

interface Props { onPlay: () => void; onStop: () => void }

export function TransportBar({ onPlay, onStop }: Props) {
  const isPlaying   = useStore((s) => s.isPlaying)
  const isRecording = useStore((s) => s.isRecording)
  const setPlaying   = useStore((s) => s.setPlaying)
  const setRecording = useStore((s) => s.setRecording)
  const tempo = useStore((s) => s.project.transport.tempo)

  const handlePlay   = () => { setPlaying(true); onPlay() }
  const handleStop   = () => { setPlaying(false); onStop() }
  const handleRecord = () => { setRecording(!isRecording) }

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

      {/* 템포 + 녹음 상태 */}
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

> **기존 테스트 보존 확인:**
> - `aria-label="재생"` → `handlePlay` 동일 → 기존 `'재생 버튼 클릭 시 onPlay 호출 + isPlaying true'` PASS.
> - `aria-label="정지"` → `handleStop` 동일 → 기존 `'정지 버튼 클릭 시 onStop 호출 + isPlaying false'` PASS.
> - `onPlay`/`onStop` prop 시그니처 변경 없음.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: TransportBar.test.tsx 6개 PASS (기존 2 + 신규 4). AppShell 테스트 영향 없음 (useAudio 모킹이 useAudio 내부를 덮으며, TransportBar는 AppShell.test.tsx에서 렌더되지만 play/stop/record 버튼 직접 클릭 테스트는 없음).

---

## Task 6: midi/useRecording.ts — 녹음 통합 훅

MIDI 이벤트를 수집하고 재생 종료 시 Note[]로 변환해 스토어에 반영한다.

**Files:** Create `apps/web/src/midi/useRecording.ts`, `apps/web/src/midi/test/useRecording.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/midi/test/useRecording.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { useRecording } from '../useRecording'

// Tone 모킹: transport.seconds를 제어 가능하게 함
let mockSeconds = 0
vi.mock('tone', () => ({
  getTransport: () => ({
    get seconds() { return mockSeconds },
    stop: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    schedule: vi.fn(),
    scheduleOnce: vi.fn(),
    bpm: { value: 120 },
  }),
  start: vi.fn().mockResolvedValue(undefined),
  Frequency: (n: number) => ({ toNote: () => `note${n}` }),
}))

describe('useRecording', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('재생 중이 아닐 때 handleMidiMessage → 이벤트 무시', () => {
    const { result } = renderHook(() => useRecording())

    // isPlaying=false, isRecording=false
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })

    // 아무 노트도 추가되지 않아야 함
    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(0)
  })

  it('재생 중이지만 isRecording=false → 이벤트 무시', () => {
    const { result } = renderHook(() => useRecording())

    act(() => { useStore.getState().setPlaying(true) })
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 100 })
    })

    expect(useStore.getState().project.tracks[0]!.notes).toHaveLength(0)
  })

  it('isPlaying=true AND isRecording=true → 이벤트 수집 후 정지 시 노트 생성', () => {
    const { result } = renderHook(() => useRecording())

    // 재생 + 녹음 시작
    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })

    // 녹음 시작 시점 seconds=0
    mockSeconds = 0
    // noteon at 0s
    act(() => {
      result.current.handleMidiMessage({ type: 'noteon', pitch: 60, velocity: 96 })
    })

    // noteoff at 0.5s
    mockSeconds = 0.5
    act(() => {
      result.current.handleMidiMessage({ type: 'noteoff', pitch: 60, velocity: 0 })
    })

    // 정지: isPlaying → false (커밋 트리거)
    mockSeconds = 1.0
    act(() => { useStore.getState().setPlaying(false) })

    const notes = useStore.getState().project.tracks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.pitch).toBe(60)
    expect(notes[0]!.velocity).toBe(96)
    // duration: 0.5s at 120bpm ppq480 = 240 ticks
    expect(notes[0]!.duration).toBe(240)
  })

  it('정지 시 isRecording=false가 된다', () => {
    const { result } = renderHook(() => useRecording())

    act(() => {
      useStore.getState().setPlaying(true)
      useStore.getState().setRecording(true)
    })
    act(() => { useStore.getState().setPlaying(false) })

    expect(useStore.getState().isRecording).toBe(false)
  })
})
```

> **Tone 모킹 주의:** `mockSeconds`를 모듈 스코프 변수로 두고 `vi.mock`의 factory closure에서 getter로 참조. 각 `act` 블록에서 `mockSeconds = N`으로 시간을 제어. `vi.mock` 호이스팅 때문에 `let mockSeconds`를 호이스팅 범위 밖에 선언한 뒤 factory 내부에서 참조.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../useRecording'` 없음.

- [ ] **Step 3: useRecording.ts 레퍼런스 구현**

Create `apps/web/src/midi/useRecording.ts`:
```ts
import { useCallback, useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { useStore } from '../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { recordedEventsToNotes, type RawMidiEvent } from './recording'
import type { MidiNoteMessage } from './parse'

/**
 * MIDI 이벤트를 수집하고 재생 종료 시 Note[]로 변환해 스토어에 반영하는 훅.
 *
 * 사용 패턴:
 *   const { handleMidiMessage } = useRecording()
 *   const { ... } = useMidi(handleMidiMessage)
 *
 * isPlaying AND isRecording일 때만 이벤트를 수집한다.
 * isPlaying이 false로 전환되면 이벤트를 커밋하고 isRecording을 해제한다.
 */
export function useRecording() {
  const eventsRef = useRef<RawMidiEvent[]>([])
  const recordStartSecRef = useRef(0)

  // ref 미러: 클로저 stale 방지
  const isPlayingRef = useRef(false)
  const isRecordingRef = useRef(false)

  const isPlaying   = useStore((s) => s.isPlaying)
  const isRecording = useStore((s) => s.isRecording)

  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])

  // 재생 시작(isPlaying true + isRecording true) → 이벤트 버퍼 초기화
  // 재생 종료(isPlaying false) → 커밋
  useEffect(() => {
    if (isPlaying && isRecording) {
      eventsRef.current = []
      recordStartSecRef.current = Tone.getTransport().seconds
    }
    if (!isPlaying && isRecording) {
      // 커밋
      const endSec = Tone.getTransport().seconds - recordStartSecRef.current
      const { project, selectedTrackId, quantizeDenom, setProject, setRecording } =
        useStore.getState()

      const noteDataList = recordedEventsToNotes(eventsRef.current, {
        ppq: project.transport.ppq,
        tempo: project.transport.tempo,
        quantizeDenom,
        endSec,
      })

      if (noteDataList.length > 0) {
        let updated = project
        for (const noteData of noteDataList) {
          updated = addNote(updated, selectedTrackId, createNote(noteData))
        }
        setProject(updated)
      }

      eventsRef.current = []
      setRecording(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  const handleMidiMessage = useCallback((msg: MidiNoteMessage) => {
    if (!isPlayingRef.current || !isRecordingRef.current) return
    const timeSec = Tone.getTransport().seconds - recordStartSecRef.current
    eventsRef.current.push({
      kind: msg.type,
      pitch: msg.pitch,
      velocity: msg.velocity,
      timeSec,
    })
  }, []) // 의도적 stable callback: ref로 최신 상태 접근

  return { handleMidiMessage }
}
```

> **useEffect 의존성 주의:** `[isPlaying]`만 의존성으로 등록해 재생 상태 전환 시에만 커밋·리셋. `isRecording` 없이도 `isRecordingRef.current`를 통해 최신 값 읽음. eslint-disable 주석 필요.
>
> **Zustand 직접 접근:** `useStore.getState()`로 커밋 시점의 최신 상태를 읽어 stale closure 없이 setProject.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useRecording.test.ts 4개 PASS. 기존 테스트 영향 없음.

---

## Task 7: midi/MidiDeviceSelect.tsx — 장치 선택 UI

**Files:** Create `apps/web/src/midi/MidiDeviceSelect.tsx`, `apps/web/src/midi/test/MidiDeviceSelect.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/midi/test/MidiDeviceSelect.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MidiDeviceSelect } from '../MidiDeviceSelect'
import type { MidiDevice } from '../useMidi'

const devices: MidiDevice[] = [
  { id: 'dev-1', name: 'Piano' },
  { id: 'dev-2', name: 'Synth' },
]

describe('MidiDeviceSelect', () => {
  it('장치 목록이 드롭다운 옵션으로 렌더된다', () => {
    render(
      <MidiDeviceSelect
        devices={devices}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={true}
        accessError={null}
      />
    )
    expect(screen.getByRole('option', { name: 'Piano' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Synth' })).toBeInTheDocument()
  })

  it('장치 선택 시 selectDevice가 해당 id로 호출된다', async () => {
    const selectDevice = vi.fn()
    render(
      <MidiDeviceSelect
        devices={devices}
        selectedDeviceId={null}
        selectDevice={selectDevice}
        isSupported={true}
        accessError={null}
      />
    )
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /midi device/i }), 'dev-1')
    expect(selectDevice).toHaveBeenCalledWith('dev-1')
  })

  it('장치 없음(devices=[]) → "장치 없음" 메시지 표시', () => {
    render(
      <MidiDeviceSelect
        devices={[]}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={true}
        accessError={null}
      />
    )
    expect(screen.getByText(/장치 없음/)).toBeInTheDocument()
  })

  it('isSupported=false → "Web MIDI 미지원" 메시지 표시', () => {
    render(
      <MidiDeviceSelect
        devices={[]}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={false}
        accessError={null}
      />
    )
    expect(screen.getByText(/Web MIDI 미지원/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../MidiDeviceSelect'` 없음.

- [ ] **Step 3: MidiDeviceSelect.tsx 레퍼런스 구현**

Create `apps/web/src/midi/MidiDeviceSelect.tsx`:
```tsx
import type { ChangeEvent } from 'react'
import type { MidiDevice } from './useMidi'

interface Props {
  devices: MidiDevice[]
  selectedDeviceId: string | null
  selectDevice: (id: string | null) => void
  isSupported: boolean
  accessError: string | null
}

export function MidiDeviceSelect({
  devices,
  selectedDeviceId,
  selectDevice,
  isSupported,
  accessError,
}: Props) {
  if (!isSupported) {
    return (
      <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
        Web MIDI 미지원
      </span>
    )
  }

  if (devices.length === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-lo)', whiteSpace: 'nowrap' }}>
        {accessError ? `MIDI 오류: ${accessError}` : '장치 없음'}
      </span>
    )
  }

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    selectDevice(val === '' ? null : val)
  }

  return (
    <select
      aria-label="MIDI Device"
      value={selectedDeviceId ?? ''}
      onChange={handleChange}
      style={{
        font: 'inherit', fontSize: 11,
        padding: '3px 6px', borderRadius: 'var(--r-sm)',
        border: '1px solid var(--border)', cursor: 'pointer',
        background: 'var(--bg-elevated)', color: 'var(--text-mid)',
        whiteSpace: 'nowrap',
      }}
    >
      <option value="">— MIDI 입력 선택 —</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  )
}
```

> **타입 노트:** `type ChangeEvent` import from `'react'` — `React.ChangeEvent` 네임스페이스 형태 사용 금지. `type MidiDevice` import from `'./useMidi'`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: MidiDeviceSelect.test.tsx 4개 PASS.

---

## Task 8: AppShell 통합 + 최종 게이트

MIDI 훅과 장치 선택 UI를 AppShell에 연결하고 기존 테스트가 깨지지 않도록 모킹을 추가한다.

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`, `apps/web/src/test/AppShell.compose.test.tsx`

- [ ] **Step 1: 기존 AppShell 테스트에 모킹 추가**

`apps/web/src/test/AppShell.test.tsx` 의 기존 `vi.mock(...)` 블록들 바로 아래에 추가:
```tsx
vi.mock('../midi/useMidi', () => ({
  useMidi: () => ({
    devices: [],
    selectedDeviceId: null,
    selectDevice: () => {},
    isSupported: true,
    accessError: null,
  }),
}))
vi.mock('../midi/useRecording', () => ({
  useRecording: () => ({ handleMidiMessage: () => {} }),
}))
```

`apps/web/src/test/AppShell.compose.test.tsx` 에도 동일한 두 줄을 기존 `vi.mock(...)` 블록 아래에 추가.

- [ ] **Step 2: 실패 확인 (모킹 추가 전 AppShell 변경이 있을 경우를 위한 게이트)**

Run: `pnpm --filter @sculptone/web test`
Expected: 현재 전체 테스트 PASS (AppShell 수정 전 모킹 먼저 추가).

- [ ] **Step 3: AppShell.tsx 수정 — useMidi + useRecording + MidiDeviceSelect 통합**

`apps/web/src/shell/AppShell.tsx`에 import 추가:
```tsx
import { useMidi } from '../midi/useMidi'
import { useRecording } from '../midi/useRecording'
import { MidiDeviceSelect } from '../midi/MidiDeviceSelect'
```

`AppShell` 함수 본문에 기존 `const { play, stop, getSeconds } = useAudio()` 다음에 추가:
```tsx
  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)
```

툴바 영역의 `<FileMenu />` 다음에 `<MidiDeviceSelect ... />` 삽입:
```tsx
        <FileMenu />
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />
```

완성된 `apps/web/src/shell/AppShell.tsx`:
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

const TABS = [
  { id: 'compose',    label: 'Compose' },
  { id: 'play',       label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

export function AppShell() {
  useAutosave()

  const activeMode    = useStore((s) => s.activeMode)
  const setMode       = useStore((s) => s.setMode)
  const tempo         = useStore((s) => s.project.transport.tempo)
  const timeSignature = useStore((s) => s.project.transport.timeSignature)
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
          {activeMode === 'compose' && (
            <div style={{ position: 'relative' }}>
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
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

- [ ] **Step 4: 전체 web 테스트 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: 전체 web 테스트 PASS. AppShell.test.tsx 4개 + AppShell.compose.test.tsx 기존 개수 모두 PASS.

- [ ] **Step 5: 최종 모노레포 게이트**

Run:
```bash
pnpm -r test
```

Expected 최소 테스트 수:
- score-model: 기존 수 유지 (변경 없음)
- sound-engine: 기존 수 유지 (변경 없음)
- web: 기존 141개 + 신규 45개 = **186개**
  - parse.test.ts: 11개 (parseMidiMessage)
  - recording.test.ts: 15개 (recordedEventsToNotes 13 + stepInsert 2)
  - editor-store.test.ts: +2개 (isRecording 테스트)
  - useMidi.test.ts: 5개
  - TransportBar.test.tsx: +4개 (기존 2 보존 + 신규 4 = 6개)
  - useRecording.test.ts: 4개
  - MidiDeviceSelect.test.tsx: 4개

> **기존 테스트 보존 체크리스트:**
> - `TransportBar.test.tsx` 기존 2개(재생·정지): `onPlay`/`onStop` 시그니처 불변, `aria-label="재생"/"정지"` 불변 → PASS
> - `AppShell.test.tsx` 4개: `useMidi`/`useRecording` 모킹 추가 → PASS
> - `AppShell.compose.test.tsx`: 동일 모킹 → PASS
> - `editor-store.test.ts` 기존 4개: `isRecording: false` 초기값 추가만 → 기존 테스트 검사 항목 불변 → PASS
> - `store.test.ts` 2개: `isPlaying` / `setMode` 검증만 → PASS
> - 나머지 모든 테스트: 변경 파일 없음 → PASS

- [ ] **Step 6: 타입 체크 + 프로덕션 빌드**

Run:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
```
Expected: 타입 에러 없음, 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (web ≥ 182개).
- `parseMidiMessage`: 0x9n velocity>0 → noteon, 0x9n velocity=0 → noteoff 정규화, 0x8n → noteoff, 그 외 → null, 채널 무시 — 자동 테스트 검증.
- `recordedEventsToNotes`: noteon↔noteoff FIFO 매칭, snap 양자화, dangling noteon clamped to endSec, min duration=1, start 오름차순 정렬 — 자동 테스트 검증.
- `stepInsert`: 커서 + gridTicks 반환 — 자동 테스트 검증.
- `useMidi`: navigator.requestMIDIAccess 없으면 isSupported=false + devices=[] 반환, 장치 목록 정상 열거, 선택 장치 메시지 → onMessage 콜백 — 자동 테스트 검증(모킹).
- `useRecording`: isPlaying + isRecording 모두 true일 때만 이벤트 수집, isPlaying→false 전환 시 Note[] 변환 + setProject 반영, 이후 isRecording=false 해제 — 자동 테스트 검증.
- TransportBar Record 버튼(aria-label="녹음")이 isRecording을 토글하고 isRecording=true 시 REC 배지(`var(--record)`) 표시 — 자동 테스트 검증.
- MidiDeviceSelect: 장치 목록 렌더, 선택 → selectDevice 호출, 빈 목록 → "장치 없음", 미지원 → "Web MIDI 미지원" — 자동 테스트 검증.
- 기존 141개 테스트 전부 PASS.
- 하드코딩 색상 없음 — 신규 UI는 `var(--record)`, `var(--accent)`, `var(--text-lo)` 등 CSS 변수만 사용.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후 별도 작성)

- **계획 6 — 재생 중 라이브 미리듣기:** 녹음 arm 상태에서 MIDI noteon 시 selectedTrack의 instrument를 즉시 triggerAttack, noteoff 시 triggerRelease. useRecording 또는 별도 useLivePlay 훅.
- **계획 7 — Pan 노브 UI + 재생 중 믹서 실시간 반영:** Tone.PolySynth.volume/pan 신호를 구독, 재생 중 슬라이더 변경 즉시 반영.
- **계획 8 — MusicXML 내보내기:** score-model 어댑터, Export 버튼 추가.

---

## 열린 질문

1. **Tone.getTransport().seconds 정밀도:** Web Audio API의 `AudioContext.currentTime`을 기반으로 하므로 부동소수점 오차 발생 가능. 실용적으로는 문제 없으나, 고정밀 녹음이 필요하면 `performance.now()` 기반 타임스탬프 소스 고려.

2. **MIDIAccess.onstatechange 미구현:** 장치가 녹음 중에 연결/해제될 경우 `onstatechange` 이벤트를 수신해 device 목록을 갱신해야 한다. 현재 계획에서는 마운트 시 1회 열거만 구현. 후속 계획에서 추가.

3. **useMidi onMessage 콜백 안정성:** `handleMidiMessage`가 `useCallback(fn, [])` stable callback이므로 `useMidi`가 재마운트 없이 사용 가능. 단, `useMidi`의 `selectDevice`가 `onMessageRef`를 통해 참조하므로 핸들러 교체 시 재등록 불필요. 향후 multiple 콜백 패턴(onMessage 배열)으로 확장 가능.

4. **useRecording useEffect 의존성:** `[isPlaying]`만 의존성으로 등록하고 `isRecording`은 ref로 읽는다. 이로 인해 `isPlaying` 변경 시에만 커밋이 트리거되고 `isRecording`만 변경(녹음 arm/disarm)시에는 커밋 없음 — 의도된 동작. eslint-plugin-react-hooks가 경고를 발생시키면 `eslint-disable-next-line` 주석으로 억제.

5. **Recording arm → Play 순서 vs Play → arm 순서:** 현재 구현은 `isPlaying && isRecording`이 동시에 true가 될 때 `recordStartSec`을 캡처. 재생 중에 Record를 누르면 그 시점부터 녹음 시작. 반대로 Record → Play 순서도 동일하게 동작 — 두 상태가 모두 true인 시점을 기준으로 함.

6. **Step input UI 미구현:** `stepInsert` 헬퍼는 계획서에 구현되나, 단계 입력 UI(커서 이동 + noteon 시 노트 삽입)는 이 계획의 비목표. 후속 계획에서 PianoRoll 커서와 연계해 구현.

7. **jsdom에서 MIDIAccess 타입 충돌:** `lib.dom.d.ts`에 `MIDIAccess` 타입이 포함된 버전과 그렇지 않은 버전이 있음. `useMidi.ts`에서 `MIDIAccessCompat` 로컬 타입을 정의해 라이브러리 버전 무관하게 동작하도록 함. 빌드 오류 시 tsconfig의 `lib` 옵션에 `"dom"` 확인.
