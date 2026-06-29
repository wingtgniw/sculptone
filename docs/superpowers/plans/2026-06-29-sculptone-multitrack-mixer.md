# Sculptone Multitrack Mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 멀티트랙 재생 엔진(솔로/뮤트 포함), Play 모드 믹서 UI(볼륨·뮤트·솔로 per-track), Compose 모드 TracksPanel 확장(트랙 추가/삭제/프리셋 선택)을 구현해, 사용자가 여러 트랙을 독립적으로 제어하며 재생할 수 있게 한다.

**Architecture:** 순수 헬퍼(`audibleTrackIds` / `buildMultiSchedule` / `linearToDb` / `updateTrackSound`)는 완전 TDD로 검증한다. `createPlaybackEngine`은 단일 instrument 주입에서 `getInstrument(trackId)` 콜백 방식으로 변경하며, 기존 `buildSchedule` + `createPlaybackEngine.play` 테스트는 시그니처 갱신과 함께 통과를 유지한다. `useAudio`는 `Map<trackId, PolySynth>`로 확장하되 Tone 인스턴스화 부분은 모킹/스모크로만 테스트한다. UI(TracksPanel 확장, MixerPanel)는 레퍼런스 구현을 계획서에 제시하고 @testing-library/react로 동작을 검증한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 스펙 `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`, 디자인 가이드 `documents/sculptone-design-guide.html`, 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-compose-playback.md`, `docs/superpowers/plans/2026-06-29-sculptone-persistence-export.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- Web MIDI 실시간 입력
- MusicXML 내보내기
- 파형 표시 (Play 화면 waveform)
- Pan 노브 UI (모델에는 있으나 UI는 후속 계획)
- 재생 중 믹서 변경 즉시 반영 (볼륨은 play 시작 시점에 적용; 실시간 Tone 신호 업데이트는 후속)
- 클라우드 저장 / 협업

---

## 설계 근거

- **audibleTrackIds 순수 함수:** soloed 트랙이 1개 이상이면 그 트랙 ID 집합만, 없으면 muted 아닌 트랙 ID 집합. solo는 additive(여러 개 동시 가능). UI 테스트 없이 단위 테스트로 검증.
- **linearToDb:** `v <= 0 → -Infinity`, 그 외 `20 * Math.log10(v)`. Tone.gainToDb 의존 없이 순수 함수로 테스트. `v=1 → 0dB, v=0.5 → ~-6dB`.
- **getInstrument 콜백 패턴:** `createPlaybackEngine(getInstrument)` — instrument를 play 시점에 콜백으로 주입해 useAudio에서 Map을 관리하고 교체 가능하게 함. play 설정 단계에서 audible 트랙 별 콜백을 한 번 호출해 volume 적용 후 스케줄에 사용.
- **기존 createPlaybackEngine.play 테스트 갱신:** `engine.play(p, t.id, onEnded)` → `engine.play(p, onEnded)`, `createPlaybackEngine({triggerAttackRelease})` → `createPlaybackEngine(tid => ...)`. 테스트의 검증 로직(stop 순서, triggerAttackRelease 호출, onEnded)은 그대로 유지.
- **buildSchedule 유지:** 기존 `buildSchedule(project, trackId): ScheduleItem[]`은 playback.ts에 그대로 둔다(기존 테스트 보존). 멀티트랙용 `buildMultiSchedule`은 `audio/multitrack.ts`에 별도 추가. 엔진 내부는 `buildMultiSchedule`을 사용.
- **Tone 모킹 전략:** multitrack.ts 테스트 — Tone 불필요(순수 함수). playback.test.ts — 기존 `vi.mock('tone', ...)` 재사용. useAudio.test.ts — Tone + @sculptone/sound-engine 동시 모킹 후 renderHook.
- **volume 적용 시점:** `play()` 호출 시 각 audible 트랙에 대해 `inst.volume.value = linearToDb(t.mixer.volume)` 설정 후 스케줄. 재생 중 실시간 반영은 비목표.
- **프리셋 변경 감지:** useAudio의 `play()` 호출 시 각 트랙의 현재 presetId를 `presetMapRef`와 비교해 변경됐으면 기존 instrument dispose 후 재생성. 프로젝트 교체(New/Import)로 사라진 트랙 ID의 instrument도 동일 시점에 dispose.

---

## File Structure

```
packages/score-model/src/
  operations.ts                       # MOD: updateTrackSound 추가
  index.ts                            # 이미 operations 전체 export — 변경 불필요

packages/score-model/test/
  operations.test.ts                  # MOD: updateTrackSound 테스트 추가

apps/web/src/
  audio/
    multitrack.ts                     # NEW: audibleTrackIds, buildMultiSchedule, linearToDb (순수)
    playback.ts                       # MOD: createPlaybackEngine → getInstrument 콜백 + play(project)
    useAudio.ts                       # MOD: Map<trackId, PolySynth>, preset 변경 감지
    test/
      multitrack.test.ts              # NEW: 순수 헬퍼 TDD
      playback.test.ts                # MOD: createPlaybackEngine 시그니처 + play 호출 갱신
      useAudio.test.ts                # NEW: Map 관리 + preset 변경 동작

  compose/
    TracksPanel.tsx                   # MOD: + Add/Delete/Preset 드롭다운
    test/
      TracksPanel.test.tsx            # MOD: 신규 기능 테스트 추가

  play/
    MixerPanel.tsx                    # NEW: 트랙별 볼륨 슬라이더 + Mute + Solo
    test/
      MixerPanel.test.tsx             # NEW: 믹서 UI TDD

  shell/
    AppShell.tsx                      # MOD: Play 모드 스텁 → <MixerPanel />
  test/
    AppShell.test.tsx                 # 기존 모킹 유지 — 변경 불필요
    AppShell.compose.test.tsx         # 기존 모킹 유지 — 변경 불필요
```

---

## Task 1: score-model — updateTrackSound 순수 연산

`Track.sound`를 교체하는 불변 연산이 operations.ts에 없으므로 추가한다.

**Files:** Modify `packages/score-model/src/operations.ts`, `packages/score-model/test/operations.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`packages/score-model/test/operations.test.ts` 끝에 추가:
```ts
import { updateTrackSound } from '../src/operations'
import type { Sound } from '../src/schema'

describe('updateTrackSound', () => {
  it('지정 트랙의 sound를 교체하고 다른 필드와 다른 트랙은 유지한다', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    const newSound: Sound = { kind: 'preset', presetId: 'synth-lead' }
    p = updateTrackSound(p, t1.id, newSound)
    expect(p.tracks.find((t) => t.id === t1.id)!.sound).toEqual(newSound)
    // 다른 트랙은 기본값 유지
    expect(p.tracks.find((t) => t.id === t2.id)!.sound).toEqual({ kind: 'preset', presetId: 'acoustic-piano' })
    // 기타 필드 보존
    expect(p.tracks.find((t) => t.id === t1.id)!.notes).toHaveLength(0)
    expect(p.tracks.find((t) => t.id === t1.id)!.mixer.volume).toBe(0.8)
  })

  it('존재하지 않는 trackId는 no-op — 프로젝트를 그대로 반환한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const newSound: Sound = { kind: 'preset', presetId: 'synth-lead' }
    const result = updateTrackSound(p, 'no-such-id', newSound)
    expect(result.tracks[0]!.sound).toEqual({ kind: 'preset', presetId: 'acoustic-piano' })
  })
})
```

상단 import에 `updateTrackSound`와 `Sound` 추가:
```ts
import { addTrack, addNote, updateNote, removeNote, updateTrackMixer, updateTrackSound } from '../src/operations'
import type { Sound } from '../src/schema'
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/score-model test`
Expected: FAIL — `updateTrackSound`가 export되지 않음.

- [ ] **Step 3: 구현**

`packages/score-model/src/operations.ts` 끝에 추가:
```ts
import type { Sound } from './schema'

export function updateTrackSound(p: Project, trackId: string, sound: Sound): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, sound }))
}
```

> `Sound` 타입은 이미 `./schema`에서 export됨. `mapTrack` 헬퍼는 파일 내 이미 존재함.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/score-model test`
Expected: 기존 operations 테스트(5개) + 신규 2개 = 7개 PASS.

---

## Task 2: audio/multitrack.ts — 순수 헬퍼 TDD

`audibleTrackIds`, `buildMultiSchedule`, `linearToDb`를 새 파일로 분리해 Tone 없이 완전 TDD한다.

**Files:** Create `apps/web/src/audio/multitrack.ts`, `apps/web/src/audio/test/multitrack.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/audio/test/multitrack.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  audibleTrackIds,
  buildMultiSchedule,
  linearToDb,
} from '../multitrack'
import {
  createEmptyProject, createTrack, createNote,
  addTrack, addNote, updateTrackMixer,
} from '@sculptone/score-model'

// ── 테스트 픽스처 ──────────────────────────────────────────────

function makeProject() {
  const t1 = createTrack('Piano')
  const t2 = createTrack('Bass')
  const t3 = createTrack('Drums')
  let p = createEmptyProject('Test')
  p = addTrack(p, t1)
  p = addTrack(p, t2)
  p = addTrack(p, t3)
  // Piano: note at tick 0, 480t duration, pitch 60
  p = addNote(p, t1.id, createNote({ pitch: 60, start: 0,   duration: 480, velocity: 96 }))
  // Bass: note at tick 480, pitch 36
  p = addNote(p, t2.id, createNote({ pitch: 36, start: 480, duration: 960, velocity: 80 }))
  // Drums: no notes
  return { p, ids: { t1: t1.id, t2: t2.id, t3: t3.id } }
}

// ── audibleTrackIds ───────────────────────────────────────────

describe('audibleTrackIds', () => {
  it('솔로·뮤트 없음: 모든 트랙 반환', () => {
    const { p, ids } = makeProject()
    expect(audibleTrackIds(p)).toEqual([ids.t1, ids.t2, ids.t3])
  })

  it('뮤트된 트랙 제외', () => {
    const { p, ids } = makeProject()
    const muted = updateTrackMixer(p, ids.t2, { muted: true })
    expect(audibleTrackIds(muted)).toEqual([ids.t1, ids.t3])
  })

  it('솔로 트랙이 있으면 솔로 집합만 반환 (뮤트 재정의)', () => {
    const { p, ids } = makeProject()
    // t1 muted + t2 soloed → t2만 audible
    let q = updateTrackMixer(p, ids.t1, { muted: true })
    q = updateTrackMixer(q, ids.t2, { soloed: true })
    expect(audibleTrackIds(q)).toEqual([ids.t2])
  })

  it('여러 트랙 솔로: 솔로된 트랙 모두 반환', () => {
    const { p, ids } = makeProject()
    let q = updateTrackMixer(p, ids.t1, { soloed: true })
    q = updateTrackMixer(q, ids.t3, { soloed: true })
    expect(audibleTrackIds(q)).toEqual([ids.t1, ids.t3])
  })

  it('모든 트랙 뮤트: 빈 배열', () => {
    const { p, ids } = makeProject()
    let q = updateTrackMixer(p, ids.t1, { muted: true })
    q = updateTrackMixer(q, ids.t2, { muted: true })
    q = updateTrackMixer(q, ids.t3, { muted: true })
    expect(audibleTrackIds(q)).toEqual([])
  })

  it('트랙 없는 프로젝트: 빈 배열', () => {
    expect(audibleTrackIds(createEmptyProject('Empty'))).toEqual([])
  })
})

// ── buildMultiSchedule ────────────────────────────────────────

describe('buildMultiSchedule', () => {
  it('각 audible 트랙의 노트를 timeSec/durationSec으로 변환하며 trackId를 포함', () => {
    const { p, ids } = makeProject()
    const items = buildMultiSchedule(p, [ids.t1, ids.t2])
    // t1: pitch60, start 0 → 0s, dur 480t → 0.5s (120BPM ppq480)
    // t2: pitch36, start 480t → 0.5s, dur 960t → 1s
    expect(items).toHaveLength(2)
    const item1 = items.find((x) => x.trackId === ids.t1)!
    expect(item1.timeSec).toBeCloseTo(0)
    expect(item1.durationSec).toBeCloseTo(0.5)
    expect(item1.pitch).toBe(60)
    expect(item1.velocity).toBeCloseTo(96 / 127)
    const item2 = items.find((x) => x.trackId === ids.t2)!
    expect(item2.timeSec).toBeCloseTo(0.5)
    expect(item2.durationSec).toBeCloseTo(1)
    expect(item2.pitch).toBe(36)
  })

  it('audibleIds가 비어있으면 빈 배열 반환', () => {
    const { p } = makeProject()
    expect(buildMultiSchedule(p, [])).toEqual([])
  })

  it('노트 없는 트랙은 아이템 0개 기여', () => {
    const { p, ids } = makeProject()
    const items = buildMultiSchedule(p, [ids.t3])
    expect(items).toHaveLength(0)
  })

  it('여러 노트를 가진 트랙은 모두 포함', () => {
    const { p, ids } = makeProject()
    let q = addNote(p, ids.t1, createNote({ pitch: 62, start: 480, duration: 240, velocity: 64 }))
    const items = buildMultiSchedule(q, [ids.t1])
    expect(items).toHaveLength(2)
    expect(items.every((x) => x.trackId === ids.t1)).toBe(true)
  })
})

// ── linearToDb ────────────────────────────────────────────────

describe('linearToDb', () => {
  it('v=1 → 0dB', () => {
    expect(linearToDb(1)).toBeCloseTo(0)
  })
  it('v=0.5 → ≈ -6.02dB', () => {
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1)
  })
  it('v=0 → -Infinity', () => {
    expect(linearToDb(0)).toBe(-Infinity)
  })
  it('v<0 → -Infinity (방어)', () => {
    expect(linearToDb(-0.1)).toBe(-Infinity)
  })
  it('v=0.8 (기본 volume) → ≈ -1.94dB', () => {
    expect(linearToDb(0.8)).toBeCloseTo(-1.94, 1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../multitrack'` 모듈 없음.

- [ ] **Step 3: 구현**

Create `apps/web/src/audio/multitrack.ts`:
```ts
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'

export interface MultiScheduleItem {
  trackId: string
  timeSec: number
  durationSec: number
  pitch: number
  velocity: number
}

/**
 * 재생해야 할 트랙 ID 목록을 반환한다.
 * - soloed 트랙이 1개 이상이면 그 집합만.
 * - 없으면 muted 아닌 트랙 전체.
 */
export function audibleTrackIds(project: Project): string[] {
  const soloed = project.tracks.filter((t) => t.mixer.soloed)
  if (soloed.length > 0) return soloed.map((t) => t.id)
  return project.tracks.filter((t) => !t.mixer.muted).map((t) => t.id)
}

/**
 * audibleIds 트랙의 모든 노트를 절대 초(seconds) 기준 아이템으로 변환한다.
 * time.ts의 ticksToSeconds를 재사용.
 */
export function buildMultiSchedule(
  project: Project,
  audibleIds: string[],
): MultiScheduleItem[] {
  const { ppq, tempo } = project.transport
  const result: MultiScheduleItem[] = []
  for (const trackId of audibleIds) {
    const track = project.tracks.find((t) => t.id === trackId)
    if (!track) continue
    for (const n of track.notes) {
      result.push({
        trackId,
        timeSec: ticksToSeconds(n.start, ppq, tempo),
        durationSec: ticksToSeconds(n.duration, ppq, tempo),
        pitch: n.pitch,
        velocity: n.velocity / 127,
      })
    }
  }
  return result
}

/**
 * 0..1 선형 볼륨 → dB 변환.
 * v=0 또는 음수 → -Infinity (무음).
 */
export function linearToDb(v: number): number {
  if (v <= 0) return -Infinity
  return 20 * Math.log10(v)
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: multitrack.test.ts 14개 PASS. 기존 테스트 영향 없음.

---

## Task 3: audio/playback.ts — 멀티트랙으로 확장 (기존 테스트 갱신 포함)

`createPlaybackEngine`을 `getInstrument(trackId)` 콜백 방식으로 변경하고, `play(project, trackId, onEnded?)` → `play(project, onEnded?)`로 바꾼다. `buildSchedule`은 그대로 유지. 기존 `playback.test.ts`의 `createPlaybackEngine.play` 테스트를 갱신한다.

**Files:** Modify `apps/web/src/audio/playback.ts`, `apps/web/src/audio/test/playback.test.ts`

- [ ] **Step 1: 기존 테스트 갱신 (시그니처 맞춤) — 먼저 테스트 수정 후 구현**

`apps/web/src/audio/test/playback.test.ts`의 `describe('createPlaybackEngine.play', ...)` 블록을 교체한다:

기존:
```ts
describe('createPlaybackEngine.play', () => {
  beforeEach(() => { ... })
  it('재생 시 stop을 먼저 호출하고 노트를 트리거하며 종료 시 onEnded를 호출한다', async () => {
    const triggerAttackRelease = vi.fn()
    const engine = createPlaybackEngine({ triggerAttackRelease })
    ...
    await engine.play(p, t.id, onEnded)
    ...
  })
})
```

교체 후 전체 `describe('createPlaybackEngine.play', ...)`:
```ts
describe('createPlaybackEngine.play', () => {
  beforeEach(() => {
    transport.start.mockClear()
    transport.stop.mockClear()
    transport.cancel.mockClear()
    transport.schedule.mockClear()
    transport.scheduleOnce.mockClear()
  })

  it('재생 시 stop을 먼저 호출하고 노트를 트리거하며 종료 시 onEnded를 호출한다', async () => {
    const triggerAttackRelease = vi.fn()
    // 새 시그니처: getInstrument 콜백 + volume 필드
    const engine = createPlaybackEngine((tid) =>
      tid === t.id ? { triggerAttackRelease, volume: { value: 0 } } : null
    )
    const t = createTrack('Piano')
    let p = addTrack(createEmptyProject('S'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 480, duration: 480, velocity: 100 }))
    const onEnded = vi.fn()

    // 새 시그니처: play(project, onEnded?) — trackId 없음
    await engine.play(p, onEnded)

    // stop이 악기 트리거보다 먼저 호출되어야 한다
    expect(transport.stop).toHaveBeenCalled()
    expect(transport.stop.mock.invocationCallOrder[0]!).toBeLessThan(
      triggerAttackRelease.mock.invocationCallOrder[0]!,
    )
    // 스케줄된 콜백이 즉시 실행되어 악기를 트리거
    expect(triggerAttackRelease).toHaveBeenCalledWith('pitch60', 0.5, 0.5, 100 / 127)
    // onEnded 호출
    expect(transport.scheduleOnce).toHaveBeenCalled()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('muted 트랙의 노트는 스케줄되지 않는다', async () => {
    const triggerAR = vi.fn()
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = addTrack(addTrack(createEmptyProject('S'), t1), t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 }))
    p = addNote(p, t2.id, createNote({ pitch: 36, start: 0, duration: 480, velocity: 80 }))
    // t2 muted
    p = { ...p, tracks: p.tracks.map((t) => t.id === t2.id ? { ...t, mixer: { ...t.mixer, muted: true } } : t) }

    const engine = createPlaybackEngine((tid) =>
      tid === t1.id ? { triggerAR, volume: { value: 0 } } : null
    )
    await engine.play(p)
    // Piano 노트만 스케줄
    expect(transport.schedule).toHaveBeenCalledTimes(1)
  })
})
```

> **주의:** `createTrack` / `createEmptyProject` / ... import 는 파일 상단에 이미 있음. `t`의 선언이 `beforeEach` 바깥에 없으므로 첫 번째 테스트 안에서 재선언(`const t = createTrack('Piano')`)한다.

- [ ] **Step 2: 실패 확인 (구현 전)**

Run: `pnpm --filter @sculptone/web test`
Expected: `createPlaybackEngine.play` 테스트 2개 FAIL(시그니처 불일치). `buildSchedule` 테스트 2개는 여전히 PASS.

- [ ] **Step 3: playback.ts 구현 교체**

Replace `apps/web/src/audio/playback.ts`:
```ts
import * as Tone from 'tone'
import type { Project } from '@sculptone/score-model'
import { ticksToSeconds } from '../compose/time'
import { audibleTrackIds, buildMultiSchedule, linearToDb } from './multitrack'

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

export interface PlaybackEngine {
  /** 프로젝트 전체를 audibleTrackIds 기준으로 재생. onEnded: 마지막 노트 후 호출. */
  play: (project: Project, onEnded?: () => void) => Promise<void>
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
    async play(project, onEnded) {
      await Tone.start()
      transport.stop()
      transport.cancel()
      transport.bpm.value = project.transport.tempo

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

      for (const item of items) {
        const inst = instMap.get(item.trackId)
        if (!inst) continue
        transport.schedule((time) => {
          const note = Tone.Frequency(item.pitch, 'midi').toNote()
          inst.triggerAttackRelease(note, item.durationSec, time, item.velocity)
        }, item.timeSec)
      }

      const endSec = items.reduce((m, it) => Math.max(m, it.timeSec + it.durationSec), 0)
      if (endSec > 0) {
        transport.scheduleOnce(() => { transport.stop(); transport.cancel(); onEnded?.() }, endSec)
      }
      transport.start()
    },
    stop() { transport.stop(); transport.cancel() },
    getSeconds() { return transport.seconds },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: playback.test.ts 4개 PASS(buildSchedule 2 + createPlaybackEngine.play 2). 기존 테스트 전체 영향 없음.

---

## Task 4: audio/useAudio.ts — Map<trackId, instrument> 멀티트랙 관리

`useAudio`를 Map 기반으로 재구현해 트랙 추가/프리셋 변경 시 instrument를 동적으로 관리하고, play 시점에 볼륨을 적용한다.

**Files:** Replace `apps/web/src/audio/useAudio.ts`, Create `apps/web/src/audio/test/useAudio.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/audio/test/useAudio.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'

// Tone 전체 모킹
const mockTransport = {
  bpm: { value: 120 },
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  scheduleOnce: vi.fn(),
  get seconds() { return 0 },
}
vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: () => mockTransport,
  Frequency: (n: number) => ({ toNote: () => `note${n}` }),
}))

// sound-engine 모킹: createInstrument → 스파이 객체 반환
const mockDispose = vi.fn()
const mockTrigger = vi.fn()
vi.mock('@sculptone/sound-engine', () => ({
  createInstrument: vi.fn(() => ({
    triggerAttackRelease: mockTrigger,
    volume: { value: 0 },
    dispose: mockDispose,
  })),
  descriptorToToneSpec: vi.fn(() => ({ kind: 'synth', toneClass: 'Synth' })),
  getPreset: vi.fn((id: string) => ({ id, label: id, kind: 'synth', source: 'Synth' })),
}))

import { createInstrument } from '@sculptone/sound-engine'
import { useAudio } from '../useAudio'
import { createTrack, addTrack, updateTrackSound } from '@sculptone/score-model'

describe('useAudio — 멀티트랙 instrument 관리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
    mockTransport.start.mockClear()
    mockTransport.stop.mockClear()
    mockTransport.cancel.mockClear()
    mockTransport.schedule.mockClear()
    mockTransport.scheduleOnce.mockClear()
  })

  it('play() 호출 시 프로젝트의 모든 트랙에 대해 instrument가 생성된다', async () => {
    // 초기: 트랙 1개(Piano)
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    // 1개 트랙 → createInstrument 1회
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('두 번째 play()는 preset이 바뀌지 않으면 instrument를 재생성하지 않는다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    await act(async () => { result.current.play() })
    // 두 번 재생해도 createInstrument는 1회만
    expect(createInstrument).toHaveBeenCalledTimes(1)
  })

  it('프리셋 변경 후 play() 시 해당 트랙 instrument가 dispose + 재생성된다', async () => {
    const { result } = renderHook(() => useAudio())
    // 첫 play — instrument 생성
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 프리셋 변경
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const updated = updateTrackSound(s.project, trackId, { kind: 'preset', presetId: 'synth-lead' })
    act(() => { s.setProject(updated) })

    // 두 번째 play — 변경된 트랙의 instrument dispose + 재생성
    await act(async () => { result.current.play() })
    expect(mockDispose).toHaveBeenCalledTimes(1)
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('트랙 추가 후 play() 시 신규 트랙 instrument도 생성된다', async () => {
    // 먼저 한 번 play (기존 트랙 instrument 생성)
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // 트랙 추가
    const s = useStore.getState()
    const newTrack = createTrack('Bass')
    act(() => { s.setProject(addTrack(s.project, newTrack)) })

    // 두 번째 play — 신규 트랙 instrument 추가 생성
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(2)
  })

  it('stop()은 transport.stop과 cancel을 호출한다', async () => {
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    act(() => { result.current.stop() })
    expect(mockTransport.stop).toHaveBeenCalled()
  })

  it('getSeconds()는 엔진이 없으면 0을 반환한다', () => {
    const { result } = renderHook(() => useAudio())
    expect(result.current.getSeconds()).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useAudio.test.ts FAIL (현재 useAudio가 Map 방식이 아님).

- [ ] **Step 3: useAudio.ts 레퍼런스 구현으로 교체**

Replace `apps/web/src/audio/useAudio.ts`:
```ts
import { useCallback, useEffect, useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { linearToDb } from './multitrack'
import { useStore } from '../state/store'
import type { Project } from '@sculptone/score-model'

/** 트랙 ID → 현재 presetId 캐시 (변경 감지용) */
type PresetCache = Map<string, string>

function resolvePresetId(project: Project, trackId: string): string {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) return 'acoustic-piano'
  return track.sound.kind === 'preset' ? track.sound.presetId : 'acoustic-piano'
}

function buildInstrument(presetId: string): MultiInstrument & { dispose: () => void } {
  const desc = getPreset(presetId) ?? getPreset('acoustic-piano')!
  const inst = createInstrument(descriptorToToneSpec(desc))
  // Tone.PolySynth는 volume AudioParam과 dispose()를 가짐
  return inst as MultiInstrument & { dispose: () => void }
}

export function useAudio() {
  const instrumentsRef = useRef(new Map<string, ReturnType<typeof buildInstrument>>())
  const presetCacheRef = useRef<PresetCache>(new Map())
  const engineRef = useRef<PlaybackEngine | null>(null)

  /**
   * 프로젝트의 모든 트랙에 대해:
   * - 신규 또는 preset 변경 시 → dispose 후 재생성
   * - 삭제된 트랙 → dispose 후 Map에서 제거
   */
  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))

    // 삭제된 트랙 instrument dispose
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        presetCacheRef.current.delete(trackId)
      }
    }

    // 신규 또는 preset 변경 트랙 instrument 생성/재생성
    for (const track of project.tracks) {
      const presetId = resolvePresetId(project, track.id)
      const cached = presetCacheRef.current.get(track.id)
      if (cached !== presetId || !instrumentsRef.current.has(track.id)) {
        // 기존 있으면 dispose
        instrumentsRef.current.get(track.id)?.dispose()
        instrumentsRef.current.set(track.id, buildInstrument(presetId))
        presetCacheRef.current.set(track.id, presetId)
      }
    }
  }, [])

  const play = useCallback(() => {
    const { project } = useStore.getState()
    syncInstruments(project)

    // 엔진을 매 play 시 재생성 (getInstrument 클로저가 최신 Map 참조)
    engineRef.current = createPlaybackEngine((trackId) => {
      return instrumentsRef.current.get(trackId) ?? null
    })

    void engineRef.current.play(project, () => {
      useStore.getState().setPlaying(false)
    })
  }, [syncInstruments])

  const stop = useCallback(() => engineRef.current?.stop(), [])
  const getSeconds = useCallback(() => engineRef.current?.getSeconds() ?? 0, [])

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      engineRef.current?.stop()
      for (const inst of instrumentsRef.current.values()) inst.dispose()
      instrumentsRef.current.clear()
      presetCacheRef.current.clear()
    }
  }, [])

  return { play, stop, getSeconds }
}
```

> **Tone.PolySynth.volume:** `Tone.PolySynth`는 `volume: Tone.Signal<"decibels">` 속성을 가지며 `.value = dB`로 직접 설정 가능. jsdom에서는 모킹된 `{ value: 0 }` 객체로 대체됨. `dispose()` 메서드도 내장.

> **AppShell 기존 테스트 영향:** `vi.mock('../audio/useAudio', ...)` 모킹이 이미 있으므로 AppShell.test.tsx / AppShell.compose.test.tsx 변경 불필요.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: useAudio.test.ts 6개 PASS. 기존 AppShell / TransportBar 테스트 영향 없음.

---

## Task 5: TracksPanel 확장 — 트랙 추가/삭제/프리셋 선택

**Files:** Modify `apps/web/src/compose/TracksPanel.tsx`, `apps/web/src/compose/test/TracksPanel.test.tsx`

- [ ] **Step 1: 실패 테스트 추가**

`apps/web/src/compose/test/TracksPanel.test.tsx`를 교체:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('+ Add Track 버튼이 있고 클릭 시 트랙이 추가된다', async () => {
    render(<TracksPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    expect(s.project.tracks).toHaveLength(2)
    // 새 트랙이 선택된다
    expect(s.selectedTrackId).toBe(s.project.tracks[1]!.id)
  })

  it('신규 트랙 이름은 "Track N" 형식이다', async () => {
    render(<TracksPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    expect(s.project.tracks[1]!.name).toBe('Track 2')
  })

  it('트랙이 1개일 때 삭제 버튼은 비활성(disabled)', () => {
    render(<TracksPanel />)
    // 삭제 버튼은 aria-label="트랙 삭제" 또는 "delete track"
    const del = screen.getByRole('button', { name: /delete track/i })
    expect(del).toBeDisabled()
  })

  it('트랙이 2개일 때 삭제 버튼 클릭 시 선택된 트랙이 삭제된다', async () => {
    render(<TracksPanel />)
    // 트랙 추가
    await userEvent.click(screen.getByRole('button', { name: /add track/i }))
    const s = useStore.getState()
    const secondTrackId = s.project.tracks[1]!.id
    // 두 번째 트랙 선택
    await userEvent.click(screen.getByRole('button', { name: /Track 2/ }))
    // 삭제
    await userEvent.click(screen.getByRole('button', { name: /delete track/i }))
    const s2 = useStore.getState()
    expect(s2.project.tracks).toHaveLength(1)
    expect(s2.project.tracks.find((t) => t.id === secondTrackId)).toBeUndefined()
    // selectedTrackId가 첫 트랙으로 재선택됨
    expect(s2.selectedTrackId).toBe(s2.project.tracks[0]!.id)
  })

  it('프리셋 드롭다운에서 변경 시 해당 트랙의 sound가 갱신된다', async () => {
    render(<TracksPanel />)
    const trackId = useStore.getState().selectedTrackId
    const select = screen.getByRole('combobox', { name: /preset/i })
    await userEvent.selectOptions(select, 'synth-lead')
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.sound).toEqual({ kind: 'preset', presetId: 'synth-lead' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: 신규 5개 테스트 FAIL. 기존 `트랙 목록을 렌더하고` 테스트 PASS.

- [ ] **Step 3: TracksPanel 레퍼런스 구현으로 교체**

Replace `apps/web/src/compose/TracksPanel.tsx`:
```tsx
import { useStore } from '../state/store'
import { addTrack, removeTrack, createTrack, updateTrackSound } from '@sculptone/score-model'
import { listPresets } from '@sculptone/sound-engine'
import type { ChangeEvent } from 'react'

const PRESETS = listPresets()

export function TracksPanel() {
  const project       = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const setProject    = useStore((s) => s.setProject)
  const selectTrack   = useStore((s) => s.selectTrack)

  const handleAddTrack = () => {
    const n = project.tracks.length + 1
    const newTrack = createTrack(`Track ${n}`)
    setProject(addTrack(project, newTrack))
    selectTrack(newTrack.id)
  }

  const handleDeleteTrack = (trackId: string) => {
    if (project.tracks.length <= 1) return
    const updated = removeTrack(project, trackId)
    setProject(updated)
    if (selectedTrackId === trackId) {
      selectTrack(updated.tracks[0]!.id)
    }
  }

  const handlePresetChange = (trackId: string, e: ChangeEvent<HTMLSelectElement>) => {
    setProject(updateTrackSound(project, trackId, { kind: 'preset', presetId: e.target.value }))
  }

  const canDelete = project.tracks.length > 1

  return (
    <div style={{ padding: '14px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.1em', margin: 0, flex: 1 }}>
          Tracks
        </p>
        <button
          aria-label="Add Track"
          onClick={handleAddTrack}
          style={{
            font: 'inherit', fontSize: 11, fontWeight: 700,
            padding: '2px 7px', borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)', cursor: 'pointer',
            background: 'var(--accent-soft)', color: 'var(--accent)',
          }}
        >
          +
        </button>
      </div>

      {project.tracks.map((t) => {
        const sel = t.id === selectedTrackId
        const currentPreset = t.sound.kind === 'preset' ? t.sound.presetId : 'acoustic-piano'
        return (
          <div key={t.id} style={{ marginBottom: 8 }}>
            {/* 트랙 선택 행 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                aria-current={sel}
                onClick={() => selectTrack(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                  padding: '6px 8px', borderRadius: 'var(--r-sm)', border: 0, cursor: 'pointer',
                  fontSize: 12, textAlign: 'left',
                  background: sel ? 'var(--accent-soft)' : 'transparent',
                  color: sel ? 'var(--text-hi)' : 'var(--text-mid)',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: sel ? 'var(--accent)' : 'var(--dot-idle)', flexShrink: 0 }} />
                {t.name}
              </button>
              <button
                aria-label="Delete Track"
                disabled={!canDelete}
                onClick={() => handleDeleteTrack(t.id)}
                style={{
                  font: 'inherit', fontSize: 10, padding: '3px 6px',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                  cursor: canDelete ? 'pointer' : 'not-allowed',
                  background: 'transparent',
                  color: canDelete ? 'var(--text-lo)' : 'var(--text-disabled)',
                  opacity: canDelete ? 1 : 0.4,
                }}
              >
                ✕
              </button>
            </div>

            {/* 프리셋 드롭다운 (선택된 트랙에만 표시) */}
            {sel && (
              <select
                aria-label="Preset"
                value={currentPreset}
                onChange={(e) => handlePresetChange(t.id, e)}
                style={{
                  width: '100%', marginTop: 4, font: 'inherit', fontSize: 11,
                  padding: '3px 6px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                  background: 'var(--bg-elevated)', color: 'var(--text-mid)',
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: TracksPanel.test.tsx 6개 PASS. 기존 AppShell.compose 테스트(`getByRole('button', { name: /Piano/ })`)도 계속 PASS.

---

## Task 6: play/MixerPanel.tsx — 믹서 UI

Play 모드에서 트랙별 볼륨 슬라이더 + Mute + Solo 토글을 제공한다.

**Files:** Create `apps/web/src/play/MixerPanel.tsx`, `apps/web/src/play/test/MixerPanel.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/play/test/MixerPanel.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { MixerPanel } from '../MixerPanel'
import { createTrack, addTrack } from '@sculptone/score-model'

describe('MixerPanel', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })

  it('각 트랙의 이름과 볼륨 슬라이더가 렌더된다', () => {
    render(<MixerPanel />)
    // 초기: Piano 트랙 1개
    expect(screen.getByText('Piano')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /piano volume/i })).toBeInTheDocument()
  })

  it('볼륨 슬라이더 변경 시 updateTrackMixer가 적용된다', () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const slider = screen.getByRole('slider', { name: /piano volume/i })
    // range input은 fireEvent.change로 직접 값 변경 (userEvent pointer 대신)
    fireEvent.change(slider, { target: { value: '0.5' } })
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.volume).toBeCloseTo(0.5)
  })

  it('Mute 버튼 클릭 시 muted가 토글된다', async () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const muteBtn = screen.getByRole('button', { name: /piano mute/i })
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(muteBtn)
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.muted).toBe(true)
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('Solo 버튼 클릭 시 soloed가 토글된다', async () => {
    render(<MixerPanel />)
    const trackId = useStore.getState().selectedTrackId
    const soloBtn = screen.getByRole('button', { name: /piano solo/i })
    await userEvent.click(soloBtn)
    const updated = useStore.getState().project.tracks.find((t) => t.id === trackId)!
    expect(updated.mixer.soloed).toBe(true)
  })

  it('여러 트랙이 있으면 모두 렌더된다', () => {
    const s = useStore.getState()
    const t2 = createTrack('Bass')
    s.setProject(addTrack(s.project, t2))
    render(<MixerPanel />)
    expect(screen.getByText('Piano')).toBeInTheDocument()
    expect(screen.getByText('Bass')).toBeInTheDocument()
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: FAIL — `'../MixerPanel'` 없음.

- [ ] **Step 3: MixerPanel 레퍼런스 구현**

Create `apps/web/src/play/MixerPanel.tsx`:
```tsx
import { useStore } from '../state/store'
import { updateTrackMixer } from '@sculptone/score-model'
import type { ChangeEvent } from 'react'

export function MixerPanel() {
  const project    = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)

  return (
    <div style={{ padding: '24px 28px' }}>
      <p style={{
        fontSize: 11, color: 'var(--text-lo)',
        textTransform: 'uppercase', letterSpacing: '.1em', margin: '0 0 16px',
      }}>
        Mixer
      </p>

      {project.tracks.map((t) => (
        <div
          key={t.id}
          style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}
        >
          {/* 트랙 이름 */}
          <span style={{
            width: 80, fontSize: 12, fontWeight: 600,
            color: 'var(--text-mid)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {t.name}
          </span>

          {/* 볼륨 슬라이더 */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={t.mixer.volume}
            aria-label={`${t.name} volume`}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setProject(updateTrackMixer(project, t.id, { volume: Number(e.target.value) }))
            }
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />

          {/* 볼륨 수치 */}
          <span style={{ width: 32, fontSize: 11, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
            {Math.round(t.mixer.volume * 100)}
          </span>

          {/* Mute */}
          <button
            aria-label={`${t.name} mute`}
            aria-pressed={t.mixer.muted}
            onClick={() => setProject(updateTrackMixer(project, t.id, { muted: !t.mixer.muted }))}
            style={{
              font: 'inherit', fontSize: 11, fontWeight: 700,
              padding: '4px 8px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0,
              background: t.mixer.muted ? 'var(--record)' : 'var(--bg-elevated)',
              color: t.mixer.muted ? '#fff' : 'var(--text-mid)',
            }}
          >
            M
          </button>

          {/* Solo */}
          <button
            aria-label={`${t.name} solo`}
            aria-pressed={t.mixer.soloed}
            onClick={() => setProject(updateTrackMixer(project, t.id, { soloed: !t.mixer.soloed }))}
            style={{
              font: 'inherit', fontSize: 11, fontWeight: 700,
              padding: '4px 8px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0,
              background: t.mixer.soloed ? 'var(--accent)' : 'var(--bg-elevated)',
              color: t.mixer.soloed ? 'var(--on-accent)' : 'var(--text-mid)',
            }}
          >
            S
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: MixerPanel.test.tsx 5개 PASS.

---

## Task 7: AppShell — Play 모드에 MixerPanel 연결

Play 모드의 "Play 믹서 (다음 계획)" 스텁을 `<MixerPanel />`로 교체하고, AppShell 테스트에서 Play 모드가 MixerPanel을 렌더하는지 검증한다.

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`

- [ ] **Step 1: AppShell.test.tsx에 Play 모드 테스트 추가**

`apps/web/src/test/AppShell.test.tsx` 기존 describe 블록 안에 테스트 추가:
```tsx
it('Play 탭으로 전환 시 MixerPanel이 렌더된다', async () => {
  render(<AppShell />)
  await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
  // MixerPanel은 "Mixer" 헤더 텍스트를 렌더함
  expect(screen.getByText(/mixer/i)).toBeInTheDocument()
})
```

> `userEvent` import가 이미 있는지 확인. 없으면 `import userEvent from '@testing-library/user-event'` 추가.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: 새 테스트 FAIL (스텁 텍스트가 "Mixer"가 아님).

- [ ] **Step 3: AppShell.tsx 수정**

`apps/web/src/shell/AppShell.tsx`에 import 추가:
```tsx
import { MixerPanel } from '../play/MixerPanel'
```

Play 모드 스텁 블록 교체:

기존:
```tsx
{activeMode === 'play' && (
  <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-lo)' }}>
    Play 믹서 (다음 계획)
  </div>
)}
```

교체 후:
```tsx
{activeMode === 'play' && (
  <div style={{ overflowY: 'auto', height: '100%' }}>
    <MixerPanel />
  </div>
)}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sculptone/web test`
Expected: AppShell.test.tsx 4개 PASS (기존 3 + 신규 1). AppShell.compose.test.tsx 3개 PASS. 전체 web 테스트 영향 없음.

---

## Task 8: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

Run:
```bash
pnpm -r test
```

Expected 최소 테스트 수:
- score-model: 기존 24개 + updateTrackSound 2개 = **26개**
- sound-engine: 기존 6개 = **6개**
- web: 기존 101개 + multitrack(14) + useAudio(6) + MixerPanel(5) + TracksPanel(+5) + playback 갱신(+1 신규 케이스) + AppShell(+1) = **≈ 133개**

> **기존 테스트 보존 체크리스트:**
> - `buildSchedule` 2개: playback.ts 함수 그대로 유지 → PASS
> - `createPlaybackEngine.play` 2개: 시그니처 갱신 완료 → PASS
> - TracksPanel 기존 1개("트랙 목록을 렌더하고"): 교체된 구현에서도 동일 aria-current 로직 → PASS
> - AppShell / AppShell.compose: `useAudio` / `useAutosave` 모킹 유지 → PASS
> - 나머지 기존 테스트: 변경 파일 없음 → PASS

- [ ] **Step 2: 타입 체크**

Run:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```
Expected: 타입 에러 없음.

- [ ] **Step 3: 프로덕션 빌드**

Run:
```bash
pnpm --filter @sculptone/web build
```
Expected: 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과.
- `audibleTrackIds`: soloed 우선, muted 제외 — 자동 테스트 검증.
- `buildMultiSchedule`: 멀티트랙 노트가 trackId 포함 아이템으로 변환됨 — 자동 테스트 검증.
- `linearToDb`: v=0 → -Infinity, v=1 → 0dB — 자동 테스트 검증.
- `updateTrackSound`: 불변 연산으로 sound 교체, 다른 트랙 보존 — 자동 테스트 검증.
- Play 모드에서 볼륨/뮤트/솔로 슬라이더·토글이 `updateTrackMixer`를 통해 스토어에 반영됨.
- Compose 모드에서 트랙 추가/삭제/프리셋 선택이 동작하고 selectedTrackId가 올바르게 갱신됨.
- 재생 시 muted 트랙 노트는 스케줄되지 않고, soloed 트랙이 있으면 그 집합만 재생됨.
- 프리셋 변경 후 재생 시 해당 트랙 instrument가 dispose + 재생성됨.
- tsc 에러 없음, 프로덕션 빌드 성공.
- 하드코딩 hex 없음 — 신규 UI는 CSS 변수(`var(--accent)`, `var(--record)`, `var(--on-accent)` 등)만 사용.

---

## 다음 계획 (이 계획 완료 후 별도 작성)

- **계획 5 — Web MIDI 실시간 입력:** Web MIDI API 브리지, 실시간 노트 녹음, MIDI 클록 동기화.
- **계획 6 — Pan 노브 UI + 재생 중 믹서 실시간 반영:** Tone.PolySynth.volume/pan 신호를 구독, 재생 중 슬라이더 변경 즉시 반영.
- **계획 7 — MusicXML 내보내기:** score-model 어댑터, Export 버튼 추가.

---

## 열린 질문

1. **재생 중 볼륨 실시간 반영:** 현재는 play 시작 시점에만 `inst.volume.value`를 설정. 재생 중 슬라이더 변경 시 즉시 반영하려면 Tone.Signal 구독 또는 `useEffect`에서 playback engine 의 instrument volume을 업데이트해야 함. 후속 계획에서 결정.

2. **Tone.PolySynth.volume 접속:** `PolySynth`의 `volume`은 `Tone.Signal<"decibels">` 타입으로 `.value = dB` 설정 가능. 그러나 `dispose()` 후 접근 시 오류 가능. instrument가 dispose된 후 `getInstrument`가 null을 반환하도록 보장됨(syncInstruments에서 Map 제거).

3. **Solo exclusive vs additive:** 현재 `audibleTrackIds`는 additive solo(여러 트랙 동시 solo 허용). Exclusive solo(새 솔로 시 기존 솔로 해제)는 `updateTrackMixer` 래퍼 함수를 store 액션으로 추가해 구현 가능. UI/UX 결정 후 추가.

4. **"Track N" 이름 중복:** 트랙 삭제 후 다시 추가하면 "Track 2"가 이미 삭제된 번호와 동일할 수 있음. `project.tracks.length + 1`은 삭제 후 재추가 시 번호가 예상과 다를 수 있음(e.g. 3개 중 1개 삭제 후 추가 → "Track 3"). 큰 문제 없으나 향후 고유 이름 생성 로직 추가 고려.

5. **replaceProject 시 instrument 정리:** `FileMenu`의 "New" / "Import MIDI" 후 `replaceProject`가 호출되면 프로젝트의 track IDs가 모두 교체됨. `useAudio.play()` 다음 호출 시 `syncInstruments`가 구 track IDs의 instrument를 dispose 처리함 — 즉, play 전까지 Tone 메모리 잔류. 허용 가능하지만 향후 `replaceProject`를 store 구독으로 즉시 감지해 정리하는 옵션 고려.

6. **jsdom `fireEvent` vs `userEvent` for range input:** `userEvent.type`이 `<input type="range">`에 완전히 동작하지 않을 수 있음. 테스트에서 `fireEvent.change(slider, { target: { value: '0.5' } })`를 우선 사용하고, userEvent v14의 pointer 방식으로 대체 가능.
