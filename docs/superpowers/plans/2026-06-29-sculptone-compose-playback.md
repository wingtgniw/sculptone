# Sculptone Compose 피아노 롤 + 재생 (슬라이스 3~5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** P0 기반 위에 Compose 모드의 SVG/DOM 피아노 롤(렌더·편집)과 Tone.js 재생(트랜스포트·재생헤드)을 구현해, 단일 사용자가 노트를 그리고 재생할 수 있게 한다.

**Architecture:** 정본 모델은 P0의 시간 기반(PPQ ticks) 그대로 두고 score-model 불변 연산으로만 수정한다. 좌표·시간·양자화·악기매핑 등 **순수 로직은 별도 모듈로 분리해 TDD**하고, 피아노 롤은 **절대배치 DOM 노드(노트당 1개)** 로 렌더(디자인 가이드 목업과 동일, jsdom 테스트 용이). 재생은 Tone.js Transport로 노트를 스케줄하며, **재생헤드는 React 바깥에서 RAF로 명령형** 갱신한다. Tone를 만지는 얇은 층은 모킹/스모크로 검증한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 스펙 `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`, 디자인 가이드 `documents/sculptone-design-guide.html`, 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-p0-foundation.md`.

---

## 설계 근거 (워크플로우 심사 결과)

- **렌더링: SVG/DOM(노트당 절대배치 div).** 디자인 가이드 목업과 동일(`.note` 절대배치 + `.roll` CSS 그라디언트). jsdom에서 노트 요소를 직접 쿼리·이벤트할 수 있어 테스트가 쉽다. 초기 노트 수 규모에서 성능 충분. (Canvas 대안은 성능 우위지만 테스트·상호작용 비용이 커 후순위.)
- **정본 불변:** Note 단위(ticks)·필드 변경 없음. 양자화는 **입력 좌표만** 그리드에 스냅하고 저장값은 스냅된 결과를 그대로 ticks로 보관(마디/박자 필드 추가 안 함).
- **핫패스 분리:** 재생헤드는 Zustand state가 아니라 ref+RAF로 갱신(60fps).
- **순수/비순수 분리:** geometry·time·quantize·instrument-spec은 순수 함수로 TDD. Tone 인스턴스화·Transport 호출은 얇게 감싸 모킹/스모크.

## 좌표계 상수 (디자인 가이드 기준)

- `LANE_HEIGHT = 24` (px, 반음 1개 레인 높이). 노트 높이 = 16px(레인 내 중앙).
- `PX_PER_BEAT = 48` (px, 4분음표 1박). ⇒ `PX_PER_TICK = PX_PER_BEAT / ppq` (ppq=480 ⇒ 0.1).
- 피치 범위(기본): `PITCH_LOW = 36`(C2) ~ `PITCH_HIGH = 84`(C6), 49개 레인.
- x = `start_ticks * PX_PER_TICK`, y = `(PITCH_HIGH - pitch) * LANE_HEIGHT`, width = `duration_ticks * PX_PER_TICK`.

---

## File Structure

```
apps/web/src/
  compose/
    geometry.ts            # 순수: tick↔x, pitch↔y, 상수
    time.ts                # 순수: tick↔seconds
    quantize.ts            # 순수: 그리드 스냅, division→ticks
    PianoRoll.tsx          # 절대배치 노트 div + 그리드 배경 + 편집 상호작용
    TracksPanel.tsx        # 좌측 트랙 목록 + 현재 트랙 선택
    Inspector.tsx          # 우측 선택 노트 속성(Velocity/Length/Octave)
    Playhead.tsx           # RAF 구동 Copper 재생헤드(명령형)
    test/ (각 *.test.ts(x))
  audio/
    playback.ts            # Tone.Transport 스케줄 + play/stop/tempo (얇은 비순수)
    TransportBar.tsx       # 재생/정지/루프 + 템포 표시
    test/
  state/
    store.ts               # (수정) 에디터 상태 추가
packages/sound-engine/src/
  instrument.ts            # 순수 descriptorToToneSpec + createInstrument(스모크)
```

---

## Task 1: compose/geometry.ts — 좌표 순수 함수

**Files:** Create `apps/web/src/compose/geometry.ts`, `apps/web/src/compose/test/geometry.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/compose/test/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  LANE_HEIGHT, PX_PER_BEAT, PITCH_LOW, PITCH_HIGH,
  pxPerTick, tickToX, xToTick, pitchToY, yToPitch, durationToWidth, rollHeight,
} from '../geometry'

describe('geometry', () => {
  const ppq = 480
  it('pxPerTick = PX_PER_BEAT / ppq', () => {
    expect(pxPerTick(ppq)).toBeCloseTo(0.1)
  })
  it('tickToX / xToTick 라운드트립', () => {
    expect(tickToX(960, ppq)).toBeCloseTo(96)
    expect(xToTick(96, ppq)).toBeCloseTo(960)
  })
  it('pitchToY: 높은 음일수록 위(작은 y)', () => {
    expect(pitchToY(PITCH_HIGH, LANE_HEIGHT)).toBe(0)
    expect(pitchToY(PITCH_HIGH - 1, LANE_HEIGHT)).toBe(LANE_HEIGHT)
  })
  it('yToPitch: y=0 → PITCH_HIGH 레인', () => {
    expect(yToPitch(0, LANE_HEIGHT)).toBe(PITCH_HIGH)
    expect(yToPitch(LANE_HEIGHT, LANE_HEIGHT)).toBe(PITCH_HIGH - 1)
  })
  it('durationToWidth', () => {
    expect(durationToWidth(480, ppq)).toBeCloseTo(48)
  })
  it('rollHeight = 레인 수 * LANE_HEIGHT', () => {
    expect(rollHeight(LANE_HEIGHT)).toBe((PITCH_HIGH - PITCH_LOW + 1) * LANE_HEIGHT)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @sculptone/web test` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

Create `apps/web/src/compose/geometry.ts`:
```ts
export const LANE_HEIGHT = 24
export const PX_PER_BEAT = 48
export const PITCH_LOW = 36
export const PITCH_HIGH = 84
export const NOTE_HEIGHT = 16

export function pxPerTick(ppq: number): number {
  return PX_PER_BEAT / ppq
}
export function tickToX(tick: number, ppq: number): number {
  return tick * pxPerTick(ppq)
}
export function xToTick(x: number, ppq: number): number {
  return x / pxPerTick(ppq)
}
export function pitchToY(pitch: number, laneHeight: number = LANE_HEIGHT): number {
  return (PITCH_HIGH - pitch) * laneHeight
}
export function yToPitch(y: number, laneHeight: number = LANE_HEIGHT): number {
  return PITCH_HIGH - Math.floor(y / laneHeight)
}
export function durationToWidth(duration: number, ppq: number): number {
  return duration * pxPerTick(ppq)
}
export function rollHeight(laneHeight: number = LANE_HEIGHT): number {
  return (PITCH_HIGH - PITCH_LOW + 1) * laneHeight
}
```

- [ ] **Step 4: 통과 확인** — `pnpm --filter @sculptone/web test` → geometry PASS.

---

## Task 2: compose/time.ts — tick↔seconds 순수 함수

**Files:** Create `apps/web/src/compose/time.ts`, `test/time.test.ts`

- [ ] **Step 1: 실패 테스트**

Create `apps/web/src/compose/test/time.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ticksToSeconds, secondsToTicks } from '../time'

describe('time', () => {
  it('120BPM, ppq480: 480tick(1박) = 0.5s', () => {
    expect(ticksToSeconds(480, 480, 120)).toBeCloseTo(0.5)
  })
  it('secondsToTicks 라운드트립', () => {
    expect(secondsToTicks(0.5, 480, 120)).toBeCloseTo(480)
  })
  it('60BPM: 480tick = 1s', () => {
    expect(ticksToSeconds(480, 480, 60)).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

Create `apps/web/src/compose/time.ts`:
```ts
export function ticksToSeconds(ticks: number, ppq: number, tempo: number): number {
  return (ticks / ppq) * (60 / tempo)
}
export function secondsToTicks(seconds: number, ppq: number, tempo: number): number {
  return (seconds * tempo / 60) * ppq
}
```

- [ ] **Step 4: 통과 확인.**

---

## Task 3: compose/quantize.ts — 그리드 스냅 순수 함수

**Files:** Create `apps/web/src/compose/quantize.ts`, `test/quantize.test.ts`

- [ ] **Step 1: 실패 테스트**

Create `apps/web/src/compose/test/quantize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { divisionToTicks, snap, QUANTIZE_DIVISIONS } from '../quantize'

describe('quantize', () => {
  it('1/16 division → ppq/4 ticks (ppq480 → 120)', () => {
    expect(divisionToTicks(16, 480)).toBe(120)
  })
  it('1/4 division → ppq ticks', () => {
    expect(divisionToTicks(4, 480)).toBe(480)
  })
  it('snap은 가장 가까운 그리드로 반올림', () => {
    expect(snap(130, 120)).toBe(120)
    expect(snap(190, 120)).toBe(240)
  })
  it('snap(grid=0)은 그대로(자유 입력)', () => {
    expect(snap(137, 0)).toBe(137)
  })
  it('QUANTIZE_DIVISIONS에 16 포함', () => {
    expect(QUANTIZE_DIVISIONS).toContain(16)
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

Create `apps/web/src/compose/quantize.ts`:
```ts
export const QUANTIZE_DIVISIONS = [4, 8, 16, 32] as const

// division: 음표 분할(1/n). 1/16 → denom 16. ticks = ppq * 4 / denom.
export function divisionToTicks(denom: number, ppq: number): number {
  return (ppq * 4) / denom
}

// grid=0 이면 스냅하지 않음(자유 입력).
export function snap(tick: number, gridTicks: number): number {
  if (gridTicks <= 0) return tick
  return Math.round(tick / gridTicks) * gridTicks
}
```

- [ ] **Step 4: 통과 확인.**

---

## Task 4: store.ts — 에디터 상태 추가

P0의 store에 선택/양자화/재생 상태를 추가한다. 정본 project 변경은 계속 `setProject(operation(...))`로 한다.

**Files:** Modify `apps/web/src/state/store.ts`; Create `apps/web/src/test/editor-store.test.ts`

- [ ] **Step 1: 실패 테스트**

Create `apps/web/src/test/editor-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('editor store', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('초기 selectedTrackId는 첫 트랙, selectedNoteId는 null', () => {
    const s = useStore.getState()
    expect(s.selectedTrackId).toBe(s.project.tracks[0]!.id)
    expect(s.selectedNoteId).toBeNull()
  })
  it('기본 quantizeDenom은 16, isPlaying false', () => {
    const s = useStore.getState()
    expect(s.quantizeDenom).toBe(16)
    expect(s.isPlaying).toBe(false)
  })
  it('selectTrack / selectNote / setQuantizeDenom / setPlaying 동작', () => {
    const { selectNote, setQuantizeDenom, setPlaying } = useStore.getState()
    selectNote('n1'); expect(useStore.getState().selectedNoteId).toBe('n1')
    setQuantizeDenom(8); expect(useStore.getState().quantizeDenom).toBe(8)
    setPlaying(true); expect(useStore.getState().isPlaying).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현 — store.ts 전체 교체**

Replace `apps/web/src/state/store.ts`:
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
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
  selectTrack: (trackId: string) => void
  selectNote: (noteId: string | null) => void
  setQuantizeDenom: (denom: number) => void
  setPlaying: (playing: boolean) => void
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
  setMode: (mode) => set({ activeMode: mode }),
  setProject: (project) => set({ project }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedNoteId: null }),
  selectNote: (noteId) => set({ selectedNoteId: noteId }),
  setQuantizeDenom: (denom) => set({ quantizeDenom: denom }),
  setPlaying: (playing) => set({ isPlaying: playing }),
}))
```

- [ ] **Step 4: 통과 확인** — editor-store + 기존 store.test 모두 PASS. (기존 store.test.ts가 깨지지 않는지 확인.)

---

## Task 5: sound-engine/instrument.ts — Tone 악기 브리지

순수 매핑(`descriptorToToneSpec`)은 TDD, 실제 Tone 인스턴스화(`createInstrument`)는 스모크. `tone` 의존성을 추가한다.

**Files:** Create `packages/sound-engine/src/instrument.ts`, `test/instrument.test.ts`; Modify `packages/sound-engine/src/index.ts`, `package.json`

- [ ] **Step 1: tone 의존성 추가**

Run: `pnpm --filter @sculptone/sound-engine add tone`
Expected: `tone`이 dependencies에 추가, 설치 성공.

- [ ] **Step 2: 실패 테스트**

Create `packages/sound-engine/test/instrument.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { descriptorToToneSpec } from '../src/instrument'
import { getPreset } from '../src/presets'

describe('descriptorToToneSpec', () => {
  it('sampler 프리셋(acoustic-piano)은 sampler 스펙', () => {
    const spec = descriptorToToneSpec(getPreset('acoustic-piano')!)
    expect(spec.kind).toBe('sampler')
    expect(spec.source).toBe('salamander')
  })
  it('synth 프리셋(synth-lead)은 toneClass=Synth', () => {
    const spec = descriptorToToneSpec(getPreset('synth-lead')!)
    expect(spec.kind).toBe('synth')
    expect(spec.toneClass).toBe('Synth')
  })
  it('electric-piano는 AMSynth', () => {
    const spec = descriptorToToneSpec(getPreset('electric-piano')!)
    expect(spec.toneClass).toBe('AMSynth')
  })
})
```

- [ ] **Step 3: 실패 확인** — `pnpm --filter @sculptone/sound-engine test` → FAIL.

- [ ] **Step 4: 구현**

Create `packages/sound-engine/src/instrument.ts`:
```ts
import * as Tone from 'tone'
import type { PresetDescriptor } from './types'

export type ToneSpec =
  | { kind: 'sampler'; source: string }
  | { kind: 'synth'; toneClass: 'Synth' | 'AMSynth' | 'FMSynth' }

// 순수: 프리셋 디스크립터 → Tone 생성 스펙
export function descriptorToToneSpec(d: PresetDescriptor): ToneSpec {
  if (d.kind === 'sampler') return { kind: 'sampler', source: d.source }
  const cls = d.source === 'AMSynth' ? 'AMSynth' : d.source === 'FMSynth' ? 'FMSynth' : 'Synth'
  return { kind: 'synth', toneClass: cls }
}

// 비순수(스모크): 스펙 → 실제 Tone 악기. sampler는 P2에서 샘플 URL 매핑 확장 예정이라
// 지금은 합성 폴리신스로 폴백한다(소리는 나되 음색 정밀도는 후속).
export function createInstrument(spec: ToneSpec): Tone.PolySynth {
  switch (spec.kind) {
    case 'synth': {
      const map = { Synth: Tone.Synth, AMSynth: Tone.AMSynth, FMSynth: Tone.FMSynth } as const
      return new Tone.PolySynth(map[spec.toneClass]).toDestination()
    }
    case 'sampler':
    default:
      return new Tone.PolySynth(Tone.Synth).toDestination()
  }
}
```

Modify `packages/sound-engine/src/index.ts` — 끝에 추가:
```ts
export * from './instrument'
```

- [ ] **Step 5: 통과 확인** — `descriptorToToneSpec` 3 테스트 PASS. (`createInstrument`은 jsdom/node에서 Web Audio 미지원이라 단위 테스트하지 않음 — 브라우저 런타임에서만 동작.)

---

## Task 6: audio/playback.ts — Tone.Transport 재생 엔진

Tone를 얇게 감싼 재생 엔진. 스케줄 시각 계산은 `compose/time.ts`의 순수 함수를 쓰고, 엔진 자체는 Tone를 모킹해 테스트한다.

**Files:** Create `apps/web/src/audio/playback.ts`, `apps/web/src/audio/test/playback.test.ts`

- [ ] **Step 1: 실패 테스트 (Tone 모킹)**

Create `apps/web/src/audio/test/playback.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const scheduled: Array<{ time: number; pitch: number }> = []
vi.mock('tone', () => {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    getTransport: () => ({
      bpm: { value: 120 },
      start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
      schedule: (cb: (t: number) => void, time: number) => { scheduled.push({ time, pitch: -1 }) },
      get seconds() { return 0 },
    }),
    Frequency: (n: number, _u: string) => ({ toNote: () => `pitch${n}` }),
  }
})

import { buildSchedule } from '../playback'
import { createEmptyProject, createTrack, createNote, addTrack, addNote } from '@sculptone/score-model'

describe('buildSchedule', () => {
  beforeEach(() => { scheduled.length = 0 })
  it('각 노트를 시작 초(seconds)로 변환해 스케줄 항목을 만든다', () => {
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const items = buildSchedule(p, t.id)
    expect(items).toHaveLength(1)
    // 120BPM ppq480: start 480tick = 0.5s, duration 480tick = 0.5s
    expect(items[0]!.timeSec).toBeCloseTo(0.5)
    expect(items[0]!.durationSec).toBeCloseTo(0.5)
    expect(items[0]!.pitch).toBe(60)
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

Create `apps/web/src/audio/playback.ts`:
```ts
import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'

export interface ScheduleItem {
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

// 순수: 트랙 노트를 절대 초(seconds) 스케줄로 변환
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

export interface PlaybackEngine {
  play: (project: Project, trackId: string) => Promise<void>
  stop: () => void
  getSeconds: () => number
}

// 비순수: Tone Transport로 스케줄 재생. instrument는 주입(테스트/교체 용이).
export function createPlaybackEngine(
  instrument: { triggerAttackRelease: (note: string, dur: number, time: number, vel?: number) => void },
): PlaybackEngine {
  const transport = Tone.getTransport()
  return {
    async play(project, trackId) {
      await Tone.start()
      transport.cancel()
      transport.bpm.value = project.transport.tempo
      for (const item of buildSchedule(project, trackId)) {
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          instrument.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, item.timeSec)
      }
      transport.start()
    },
    stop() { transport.stop(); transport.cancel() },
    getSeconds() { return transport.seconds },
  }
}
```

- [ ] **Step 4: 통과 확인** — `buildSchedule` 테스트 PASS.

---

## Task 7: PianoRoll.tsx — 그리드 + 노트 렌더(읽기 전용 먼저)

**Files:** Create `apps/web/src/compose/PianoRoll.tsx`, `test/PianoRoll.test.tsx`

- [ ] **Step 1: 실패 테스트(렌더)**

Create `apps/web/src/compose/test/PianoRoll.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'
import { PianoRoll } from '../PianoRoll'

describe('PianoRoll', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const tid = s.selectedTrackId
    s.setProject(addNote(s.project, tid, createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })))
  })
  it('현재 트랙의 노트를 data-note 요소로 렌더한다', () => {
    render(<PianoRoll />)
    expect(screen.getAllByTestId('note')).toHaveLength(1)
  })
  it('노트 위치가 geometry 계산과 일치한다(start0,pitch60)', () => {
    render(<PianoRoll />)
    const el = screen.getByTestId('note') as HTMLElement
    expect(el.style.left).toBe('0px')
    // pitch 60, PITCH_HIGH 84 → y=(84-60)*24=576
    expect(el.style.top).toBe('576px')
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현(레퍼런스 — 읽기 전용 렌더; 편집은 Task 10에서 확장)**

Create `apps/web/src/compose/PianoRoll.tsx`:
```tsx
import { useStore } from '../state/store'
import { tickToX, pitchToY, durationToWidth, rollHeight, LANE_HEIGHT, NOTE_HEIGHT, PX_PER_BEAT } from './geometry'

export function PianoRoll() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)

  return (
    <div
      data-testid="pianoroll"
      style={{
        position: 'relative',
        height: rollHeight(),
        minWidth: '100%',
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
          style={{
            position: 'absolute',
            left: tickToX(n.start, ppq),
            top: pitchToY(n.pitch),
            width: durationToWidth(n.duration, ppq),
            height: NOTE_HEIGHT,
            borderRadius: 4,
            background: n.id === selectedNoteId ? 'var(--accent-deep)' : 'var(--accent)',
            boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인** — PianoRoll 렌더 테스트 PASS.

---

## Task 8: TracksPanel.tsx + Inspector.tsx (좌/우 패널)

**Files:** Create `apps/web/src/compose/TracksPanel.tsx`, `Inspector.tsx`, `test/TracksPanel.test.tsx`

- [ ] **Step 1: 실패 테스트(TracksPanel)**

Create `apps/web/src/compose/test/TracksPanel.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { TracksPanel } from '../TracksPanel'

describe('TracksPanel', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })
  it('트랙 목록을 렌더하고 현재 트랙을 aria-current로 표시', () => {
    render(<TracksPanel />)
    const row = screen.getByRole('button', { name: /Piano/ })
    expect(row).toHaveAttribute('aria-current', 'true')
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

Create `apps/web/src/compose/TracksPanel.tsx`:
```tsx
import { useStore } from '../state/store'

export function TracksPanel() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectTrack = useStore((s) => s.selectTrack)
  return (
    <div style={{ padding: '14px 12px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 10px' }}>Tracks</p>
      {project.tracks.map((t) => {
        const sel = t.id === selectedTrackId
        return (
          <button
            key={t.id}
            aria-current={sel}
            onClick={() => selectTrack(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: 8, borderRadius: 'var(--r-sm)', border: 0, cursor: 'pointer',
              fontSize: 12, marginBottom: 6, textAlign: 'left',
              background: sel ? 'var(--accent-soft)' : 'transparent',
              color: sel ? 'var(--text-hi)' : 'var(--text-mid)',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: sel ? 'var(--accent)' : '#55565A' }} />
            {t.name}
          </button>
        )
      })}
    </div>
  )
}
```

Create `apps/web/src/compose/Inspector.tsx`:
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
  const noteId = useStore((s) => s.selectedNoteId)
  const setProject = useStore((s) => s.setProject)
  const track = project.tracks.find((t) => t.id === trackId)
  const note = track?.notes.find((n) => n.id === noteId)

  if (!note) {
    return <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>노트를 선택하세요</div>
  }
  const row = { fontSize: 12, color: 'var(--text-mid)', lineHeight: 2.2 } as const
  const val = { float: 'right', color: 'var(--text-hi)' } as const
  return (
    <div style={{ padding: '14px 12px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 10px' }}>Inspector</p>
      <div style={row}>Velocity <span className="mono" style={val}>{note.velocity}</span></div>
      <input
        type="range" min={1} max={127} value={note.velocity} style={{ width: '100%' }}
        onChange={(e) => setProject(updateNote(project, trackId, note.id, { velocity: Number(e.target.value) }))}
      />
      <div style={row}>Length <span className="mono" style={val}>{note.duration}t</span></div>
      <div style={row}>Pitch <span className="mono" style={val}>{noteName(note.pitch)}</span></div>
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인** — TracksPanel 테스트 PASS.

---

## Task 9: TransportBar.tsx + Playhead.tsx

**Files:** Create `apps/web/src/audio/TransportBar.tsx`, `apps/web/src/compose/Playhead.tsx`, `test/TransportBar.test.tsx`

- [ ] **Step 1: 실패 테스트(TransportBar — 재생 토글)**

Create `apps/web/src/audio/test/TransportBar.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { TransportBar } from '../TransportBar'

describe('TransportBar', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })
  it('재생 버튼 클릭 시 onPlay 호출 + isPlaying true', async () => {
    const onPlay = vi.fn()
    render(<TransportBar onPlay={onPlay} onStop={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '재생' }))
    expect(onPlay).toHaveBeenCalled()
    expect(useStore.getState().isPlaying).toBe(true)
  })
  it('정지 버튼 클릭 시 onStop 호출 + isPlaying false', async () => {
    const onStop = vi.fn()
    useStore.getState().setPlaying(true)
    render(<TransportBar onPlay={() => {}} onStop={onStop} />)
    await userEvent.click(screen.getByRole('button', { name: '정지' }))
    expect(onStop).toHaveBeenCalled()
    expect(useStore.getState().isPlaying).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

Create `apps/web/src/audio/TransportBar.tsx`:
```tsx
import { useStore } from '../state/store'

interface Props { onPlay: () => void; onStop: () => void }

export function TransportBar({ onPlay, onStop }: Props) {
  const isPlaying = useStore((s) => s.isPlaying)
  const setPlaying = useStore((s) => s.setPlaying)
  const tempo = useStore((s) => s.project.transport.tempo)

  const handlePlay = () => { setPlaying(true); onPlay() }
  const handleStop = () => { setPlaying(false); onStop() }

  const tbtn = { width: 38, height: 38, borderRadius: '50%', border: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', background: 'var(--bg-elevated)', color: 'var(--text-hi)' } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: '100%' }}>
      <button aria-label="재생" onClick={handlePlay} style={{ ...tbtn, width: 46, height: 46, background: 'var(--accent)', color: '#1a1206' }}>▶</button>
      <button aria-label="정지" onClick={handleStop} style={tbtn}>⏹</button>
      <span className="mono" style={{ marginLeft: 10, color: 'var(--text-mid)', fontSize: 13 }}>{tempo} BPM {isPlaying ? '· ▶' : ''}</span>
    </div>
  )
}
```

Create `apps/web/src/compose/Playhead.tsx` (RAF 명령형, 스모크 — 단위 테스트 없음):
```tsx
import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { tickToX } from './geometry'
import { secondsToTicks } from './time'

interface Props { getSeconds: () => number }

export function Playhead({ getSeconds }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const isPlaying = useStore((s) => s.isPlaying)
  const ppq = useStore((s) => s.project.transport.ppq)
  const tempo = useStore((s) => s.project.transport.tempo)

  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const tick = () => {
      const ticks = secondsToTicks(getSeconds(), ppq, tempo)
      if (ref.current) ref.current.style.transform = `translateX(${tickToX(ticks, ppq)}px)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, getSeconds, ppq, tempo])

  return (
    <div ref={ref} data-testid="playhead" style={{
      position: 'absolute', top: 0, bottom: 0, left: 0, width: 2,
      background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)', pointerEvents: 'none',
    }} />
  )
}
```

- [ ] **Step 4: 통과 확인** — TransportBar 테스트 PASS.

---

## Task 10: PianoRoll 편집 상호작용 (생성/선택/삭제)

읽기 전용 PianoRoll에 클릭=노트 생성(양자화), 노트 클릭=선택, Delete=삭제를 추가한다.

**Files:** Modify `apps/web/src/compose/PianoRoll.tsx`; Create `apps/web/src/compose/test/PianoRoll.edit.test.tsx`

- [ ] **Step 1: 실패 테스트(편집)**

Create `apps/web/src/compose/test/PianoRoll.edit.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { PianoRoll } from '../PianoRoll'

describe('PianoRoll editing', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('빈 그리드 클릭 시 현재 트랙에 노트가 생성된다', async () => {
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    await userEvent.pointer({ target: grid, coords: { clientX: 0, clientY: 0 } as any, keys: '[MouseLeft]' })
    const tid = useStore.getState().selectedTrackId
    const track = useStore.getState().project.tracks.find((t) => t.id === tid)!
    expect(track.notes.length).toBeGreaterThanOrEqual(1)
  })

  it('노트 클릭 시 선택된다', async () => {
    // 먼저 노트 하나 만들기
    render(<PianoRoll />)
    const grid = screen.getByTestId('pianoroll')
    await userEvent.pointer({ target: grid, coords: { clientX: 10, clientY: 10 } as any, keys: '[MouseLeft]' })
    const note = screen.getAllByTestId('note')[0]!
    await userEvent.click(note)
    expect(useStore.getState().selectedNoteId).not.toBeNull()
  })
})
```

> 참고: jsdom에서 `getBoundingClientRect`는 0을 반환하므로 좌표→tick/pitch 계산은 클릭 좌표 기준 0 근처가 된다. 테스트는 "노트가 생성/선택되는지"의 동작만 검증하고 정확한 위치는 geometry 단위 테스트가 보장한다.

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현 — PianoRoll.tsx 편집 추가**

Replace `apps/web/src/compose/PianoRoll.tsx` 전체:
```tsx
import { useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent, type KeyboardEvent as RKeyboardEvent } from 'react'
import { useStore } from '../state/store'
import { addNote, removeNote, createNote } from '@sculptone/score-model'
import { tickToX, xToTick, pitchToY, yToPitch, durationToWidth, rollHeight, LANE_HEIGHT, NOTE_HEIGHT, PX_PER_BEAT } from './geometry'
import { divisionToTicks, snap } from './quantize'

export function PianoRoll() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const setProject = useStore((s) => s.setProject)
  const selectNote = useStore((s) => s.selectNote)
  const ref = useRef<HTMLDivElement>(null)
  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)

  const grid = divisionToTicks(quantizeDenom, ppq)

  const handleGridPointerDown = (e: RPointerEvent) => {
    if (e.target !== e.currentTarget) return // 노트 위 클릭은 별도 처리
    const rect = ref.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const start = Math.max(0, snap(xToTick(x, ppq), grid))
    const pitch = yToPitch(y)
    const note = createNote({ pitch, start, duration: grid || ppq, velocity: 96 })
    setProject(addNote(project, selectedTrackId, note))
    selectNote(note.id)
  }

  const handleNoteClick = (e: RMouseEvent, id: string) => {
    e.stopPropagation()
    selectNote(id)
  }

  const handleKeyDown = (e: RKeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId) {
      setProject(removeNote(project, selectedTrackId, selectedNoteId))
      selectNote(null)
    }
  }

  return (
    <div
      ref={ref}
      data-testid="pianoroll"
      tabIndex={0}
      onPointerDown={handleGridPointerDown}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative', height: rollHeight(), minWidth: '100%', outline: 'none',
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
          onClick={(e) => handleNoteClick(e, n.id)}
          style={{
            position: 'absolute', left: tickToX(n.start, ppq), top: pitchToY(n.pitch),
            width: Math.max(4, durationToWidth(n.duration, ppq)), height: NOTE_HEIGHT,
            borderRadius: 4, cursor: 'pointer',
            background: n.id === selectedNoteId ? 'var(--accent-deep)' : 'var(--accent)',
            boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인** — 편집 테스트 + 기존 PianoRoll 렌더 테스트 PASS.

---

## Task 11: AppShell 통합 (Compose 모드 조립 + 재생 연결)

Compose 모드일 때 좌(TracksPanel)·중앙(PianoRoll+Playhead, 스크롤)·우(Inspector)·하단(TransportBar)을 연결하고, 재생 엔진을 생성해 TransportBar/ Playhead에 주입한다.

**Files:** Modify `apps/web/src/shell/AppShell.tsx`; Create `apps/web/src/audio/useAudio.ts`, `test/AppShell.compose.test.tsx`

- [ ] **Step 1: 오디오 훅 작성(레퍼런스 — 인스턴스화는 런타임)**

Create `apps/web/src/audio/useAudio.ts`:
```ts
import { useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine } from './playback'
import { useStore } from '../state/store'

export function useAudio() {
  const engineRef = useRef<PlaybackEngine | null>(null)

  const ensureEngine = (): PlaybackEngine => {
    if (!engineRef.current) {
      const presetId = useStore.getState().project.tracks[0]?.sound
      const desc = getPreset(presetId && presetId.kind === 'preset' ? presetId.presetId : 'acoustic-piano')!
      const inst = createInstrument(descriptorToToneSpec(desc))
      engineRef.current = createPlaybackEngine(inst)
    }
    return engineRef.current
  }

  const play = () => {
    const s = useStore.getState()
    void ensureEngine().play(s.project, s.selectedTrackId)
  }
  const stop = () => engineRef.current?.stop()
  const getSeconds = () => engineRef.current?.getSeconds() ?? 0

  return { play, stop, getSeconds }
}
```

- [ ] **Step 2: 실패 테스트(셸 — Compose 영역 마운트)**

Create `apps/web/src/test/AppShell.compose.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../state/store'
import { AppShell } from '../shell/AppShell'

vi.mock('../audio/useAudio', () => ({ useAudio: () => ({ play: vi.fn(), stop: vi.fn(), getSeconds: () => 0 }) }))

describe('AppShell compose mode', () => {
  beforeEach(() => { useStore.setState({ activeMode: 'compose' }) })
  it('Compose 모드에서 피아노 롤과 트랙 패널, 재생 버튼이 보인다', () => {
    render(<AppShell />)
    expect(screen.getByTestId('pianoroll')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piano/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: 실패 확인.**

- [ ] **Step 4: 구현 — AppShell.tsx 교체**

Replace `apps/web/src/shell/AppShell.tsx`:
```tsx
import type { CSSProperties } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'
import { PianoRoll } from '../compose/PianoRoll'
import { TracksPanel } from '../compose/TracksPanel'
import { Inspector } from '../compose/Inspector'
import { Playhead } from '../compose/Playhead'
import { TransportBar } from '../audio/TransportBar'
import { useAudio } from '../audio/useAudio'

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

export function AppShell() {
  const activeMode = useStore((s) => s.activeMode)
  const setMode = useStore((s) => s.setMode)
  const project = useStore((s) => s.project)
  const { play, stop, getSeconds } = useAudio()

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {project.transport.tempo} BPM · {project.transport.timeSignature.join('/')}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region, overflowY: 'auto' }}>{activeMode === 'compose' && <TracksPanel />}</div>
        <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
          {activeMode === 'compose' && (
            <div style={{ position: 'relative' }}>
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
            </div>
          )}
          {activeMode === 'play' && <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-lo)' }}>Play 믹서 (다음 계획)</div>}
        </div>
        <div style={{ ...region, overflowY: 'auto' }}>{activeMode === 'compose' && <Inspector />}</div>
      </div>

      <div style={region}><TransportBar onPlay={play} onStop={stop} /></div>
    </div>
  )
}
```

- [ ] **Step 5: 기존 AppShell.test.tsx 갱신**

기존 `apps/web/src/test/AppShell.test.tsx`는 useAudio가 Tone를 부르므로 모킹이 필요하다. 파일 상단(import 직후)에 추가:
```tsx
vi.mock('../audio/useAudio', () => ({ useAudio: () => ({ play: () => {}, stop: () => {}, getSeconds: () => 0 }) }))
```
그리고 `import { describe, it, expect, beforeEach, vi } from 'vitest'`에 `vi`가 포함됐는지 확인(없으면 추가).

- [ ] **Step 6: 통과 확인 + 최종 게이트**

Run:
```bash
pnpm --filter @sculptone/web test
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
pnpm -r test
```
Expected: 전 패키지 테스트 통과, tsc 에러 없음, 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과(P0 24 + 본 계획 신규 테스트).
- Compose 모드에서 그리드 클릭으로 노트 생성(양자화 적용), 노트 선택/삭제, Inspector에서 Velocity 편집이 동작.
- 재생 버튼으로 Tone.js Transport 재생이 시작되고 Copper 재생헤드가 RAF로 움직인다(브라우저 런타임).
- tsc 에러 없음, 프로덕션 빌드 성공.

## 다음 계획 (별도)

- **계획 3 — 멀티트랙·MIDI 입력·저장/내보내기**: 믹서(Play 모드), Web MIDI 실시간 녹음, IndexedDB + MIDI/MusicXML/JSON 입출력.

## 열린 질문

- 피아노 롤 세로 스크롤 시 좌측 건반(피치 레이블) 표시 — 본 계획은 생략, 후속.
- sampler 프리셋(salamander) 실제 샘플 로딩 — 현재 합성 폴백. 실제 샘플 URL 매핑은 사운드 디자인 단계(P2)에서.
- 재생헤드 자동 스크롤(뷰포트 추적) — 후속.
- 노트 드래그 이동/리사이즈 — 본 계획은 생성/선택/삭제까지. 이동·리사이즈는 계획 3 또는 후속 슬라이스.
