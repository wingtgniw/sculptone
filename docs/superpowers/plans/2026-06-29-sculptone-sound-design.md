# Sculptone 사운드 디자인 — 커스텀 패치 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Track.sound의 patch 변형에 filter/effects 필드를 추가해 커스텀 신스 패치를 편집·연주·저장(프로젝트 자동저장 경유)할 수 있게 한다. score-model patch 스키마 확장(하위호환 필수), sound-engine에 patchToToneConfig(순수 매핑)와 createInstrumentFromSound(Tone 체인 구성), useAudio의 patch 캐시 무효화, 그리고 SoundDesignPanel UI를 구현한다. 패치 라이브러리(이름 붙이기·공유)는 다음 증분에서 다룬다.

**Architecture:** `SoundSchema` patch 확장과 `createDefaultPatch`는 완전 TDD(완전 코드+완전 테스트). `patchToToneConfig`는 순수 매핑이므로 완전 TDD. `createInstrumentFromSound`(Tone 인스턴스화)는 Tone 전체 mock 후 스모크 3개. `useAudio`의 patch 지원은 기존 mock 패턴을 유지하며 patch 전용 describe 블록을 추가. `SoundDesignPanel`은 `@testing-library/react`로 동작 검증. 기존 273개 테스트를 보존한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Zod · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-multitrack-mixer.md`, `docs/superpowers/plans/2026-06-29-sculptone-notation-musicxml.md`, 디자인 가이드 `documents/sculptone-design-guide.html`.

---

## 비목표 (이 계획에서 하지 말 것)

- 패치 라이브러리(저장/명명/공유 — 다음 증분)
- 오실레이터 단위 편집(파형/디튠/유니즌)
- LFO/모듈레이션 매트릭스
- 비주얼 ADSR 그래프 에디터
- 멀티 이펙트 체인 UI(reverb + delay 2개까지만 지원)
- 샘플 업로드 / 샘플러 패치
- MPE / 협업
- 실제 오디오 품질 튜닝(Reverb pregeneration, 임펄스 최적화)

---

## 설계 근거

### patch 스키마 확장 전략

기존 `{ kind:'patch', engine, envelope }` 패치는 filter/effects가 옵셔널이므로 스키마 추가 후에도 그대로 유효하다. `SoundSchema`에 `z.discriminatedUnion`의 patch 분기에 `.optional()` 필드를 추가하기만 하면 된다. 기존 직렬화(JSON)도 새 필드 부재 시 그대로 복원되므로 deserialize가 깨지지 않는다.

```
filter?: { type: 'lowpass'|'highpass'|'bandpass', frequency: number(Hz), Q: number }
effects?: Array<
  | { type: 'reverb', wet: 0..1, decay: number(s) }
  | { type: 'delay', wet: 0..1, time: number(s), feedback: 0..1 }
>
```

effects는 `z.discriminatedUnion('type', [...])` 배열로 정의해 reverb/delay 외의 type을 zod가 거부하게 한다.

### patchToToneConfig 순수 분리

Tone.js 인스턴스화는 jsdom에서 테스트 불가이므로, 순수 매핑 함수 `patchToToneConfig(patch: PatchInput): TonePatchConfig`를 분리한다. 이 함수는 engine → toneClass 매핑, envelope 패스스루, filter/effects 정규화(없으면 null/[])를 수행하며 Tone에 전혀 의존하지 않아 10개 단위 테스트로 완전 검증한다.

### Tone 체인 구성 (createInstrumentFromSound)

patch sound의 Tone 체인은 `PolySynth → [Filter] → [Reverb/Delay...] → Destination` 순서로 연결한다. nodes 배열에 filter, reverb, delay 순으로 push하고 순차 연결(connect) 후 마지막 node를 toDestination()한다. 반환 객체는 `{ triggerAttackRelease, volume, dispose }` 인터페이스를 구현하며 dispose()가 PolySynth와 모든 effect node를 정리한다. preset sound는 기존 `createInstrument(descriptorToToneSpec(getPreset(...)))` 경로를 그대로 사용한다.

### instrument.ts 로컬 타입 전략

sound-engine 패키지는 score-model에 의존하지 않는다(기존 설계 유지). `PatchInput` 인터페이스를 instrument.ts 내부에 정의하고, TypeScript의 구조적 타이핑 덕분에 score-model의 `Sound` patch 변형이 `PatchInput`에 할당 가능하다. 로컬 `SoundInput = { kind:'preset'; presetId:string } | ({ kind:'patch' } & PatchInput)` 유니온으로 `createInstrumentFromSound`를 타이핑한다.

### useAudio 캐시 무효화 전략

기존 `presetCacheRef: Map<trackId, presetId>` → `soundKeyRef: Map<trackId, cacheKey>` 로 교체한다. 캐시 키 규칙:
- preset: `preset:<presetId>` (기존 behavior 동일)
- patch: `patch:<JSON.stringify(sound)>` (모든 필드 변경 감지)

buildInstrument 분기:
- preset → 기존 `createInstrument(descriptorToToneSpec(getPreset(...)))` (기존 mock 호환 유지)
- patch → `createInstrumentFromSound(track.sound)` (새 mock으로 테스트)

기존 9개 useAudio 테스트는 모두 preset 트랙 경로이므로 기존 mock(`createInstrument` spy)으로 그대로 통과한다.

### SoundDesignPanel UI 아키텍처

`store.ts`에 `soundPanelTrackId: string | null`을 추가하고 `setSoundPanelTrackId` 액션으로 제어한다. `SoundDesignPanel`은 `soundPanelTrackId === null`이면 `null`을 반환하는 전역 오버레이 컴포넌트다. AppShell에서 항상 마운트(`<SoundDesignPanel />`)하되 내부에서 조건부 렌더한다. TracksPanel의 선택 트랙에 "Edit Sound" 버튼을 추가해 `setSoundPanelTrackId`를 호출한다.

### 프리뷰 전략

"Preview ▶" 버튼 클릭 시 `createInstrumentFromSound(sound)`로 임시 instrument를 생성, C4를 0.5초 발음 후 1000ms setTimeout으로 dispose한다. jsdom에서는 `@sculptone/sound-engine`을 mock하므로 테스트는 클릭이 오류 없이 실행되는 스모크만 검증한다.

### 기존 테스트 보존 전략

| 파일 | 변경 내용 | 기존 테스트 영향 |
|---|---|---|
| `useAudio.test.ts` | mock에 `createInstrumentFromSound: vi.fn(...)` 추가 + 新 describe 블록 | 기존 9개 PASS (preset 경로 불변) |
| `TracksPanel.test.tsx` | "Edit Sound" 테스트 1개 추가 | 기존 7개 PASS (버튼 추가는 비파괴) |
| `AppShell.test.tsx` | `SoundDesignPanel` mock 추가 + 1개 테스트 | 기존 7개 PASS (mock이 null 반환) |
| `serialize.test.ts` | 변경 없음 | 3개 PASS |
| `instrument.test.ts` | 변경 없음 | 3개 PASS |

---

## File Structure

```
packages/score-model/src/
  schema.ts                              # MOD: patch에 filter?, effects? 추가
  factory.ts                             # MOD: createDefaultPatch() 추가
  index.ts                               # 변경 불필요 (factory 전체 re-export)

packages/score-model/test/
  patch-schema.test.ts                   # NEW: 16개 (스키마 유효성 + createDefaultPatch + serialize 라운드트립)

packages/sound-engine/src/
  instrument.ts                          # MOD: PatchInput/TonePatchConfig/PatchInstrument 타입
                                         #      + patchToToneConfig + createInstrumentFromSound

packages/sound-engine/test/
  patch-instrument.test.ts               # NEW: 13개 (patchToToneConfig 10 + createInstrumentFromSound 스모크 3)

apps/web/src/
  audio/
    useAudio.ts                          # MOD: resolveSoundCacheKey + buildTrackInstrument (patch 분기)
    test/
      useAudio.test.ts                   # MOD: mock에 createInstrumentFromSound 추가 + patch 테스트 3개

  state/
    store.ts                             # MOD: soundPanelTrackId + setSoundPanelTrackId

  sound/
    SoundDesignPanel.tsx                 # NEW
    test/
      SoundDesignPanel.test.tsx          # NEW: 12개

  compose/
    TracksPanel.tsx                      # MOD: "Edit Sound" 버튼 추가
    test/
      TracksPanel.test.tsx               # MOD: "Edit Sound" 테스트 1개 추가

  shell/
    AppShell.tsx                         # MOD: SoundDesignPanel import + 렌더
  test/
    AppShell.test.tsx                    # MOD: SoundDesignPanel mock 추가 + 테스트 1개
```

---

## Task 1: score-model — patch 스키마 확장 + createDefaultPatch (완전 TDD)

**Files:** Modify `packages/score-model/src/schema.ts`, `packages/score-model/src/factory.ts`; Create `packages/score-model/test/patch-schema.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `packages/score-model/test/patch-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SoundSchema } from '../src/schema'
import { createDefaultPatch, createEmptyProject, createTrack } from '../src/factory'
import { addTrack } from '../src/operations'
import { updateTrackSound } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'
import type { Sound } from '../src/schema'

// ── 공통 픽스처 ─────────────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

const FULL_PATCH: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
  filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
  effects: [
    { type: 'reverb', wet: 0.3, decay: 2.5 },
    { type: 'delay', wet: 0.2, time: 0.25, feedback: 0.4 },
  ],
}

// ── SoundSchema — 스키마 유효성 ─────────────────────────────────

describe('SoundSchema — patch 확장 유효성', () => {
  it('기존 patch({engine, envelope}만)는 여전히 유효하다(하위호환)', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
    })
    expect(result.success).toBe(true)
  })

  it('filter가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      filter: { type: 'lowpass', frequency: 1000, Q: 1 },
    })
    expect(result.success).toBe(true)
  })

  it('effects(reverb)가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'am', envelope: BASE_ENV,
      effects: [{ type: 'reverb', wet: 0.4, decay: 2 }],
    })
    expect(result.success).toBe(true)
  })

  it('effects(delay)가 추가된 patch는 유효하다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'fm', envelope: BASE_ENV,
      effects: [{ type: 'delay', wet: 0.3, time: 0.25, feedback: 0.5 }],
    })
    expect(result.success).toBe(true)
  })

  it('filter + effects(reverb + delay) 모두 있는 FULL_PATCH는 유효하다', () => {
    const result = SoundSchema.safeParse(FULL_PATCH)
    expect(result.success).toBe(true)
  })

  it('잘못된 filter.type("notch")은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      filter: { type: 'notch', frequency: 1000, Q: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('알 수 없는 effect.type("chorus")은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      effects: [{ type: 'chorus', wet: 0.5 }],
    })
    expect(result.success).toBe(false)
  })

  it('reverb.wet > 1은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      effects: [{ type: 'reverb', wet: 1.5, decay: 2 }],
    })
    expect(result.success).toBe(false)
  })

  it('filter.frequency <= 0은 거부된다(z.number().positive())', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      filter: { type: 'lowpass', frequency: -100, Q: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('delay.feedback > 1은 거부된다', () => {
    const result = SoundSchema.safeParse({
      kind: 'patch', engine: 'synth', envelope: BASE_ENV,
      effects: [{ type: 'delay', wet: 0.3, time: 0.25, feedback: 1.2 }],
    })
    expect(result.success).toBe(false)
  })
})

// ── createDefaultPatch ─────────────────────────────────────────

describe('createDefaultPatch', () => {
  it('반환값이 SoundSchema를 통과한다', () => {
    expect(SoundSchema.safeParse(createDefaultPatch()).success).toBe(true)
  })

  it('kind가 patch이다', () => {
    expect(createDefaultPatch().kind).toBe('patch')
  })

  it('engine이 synth이다', () => {
    const p = createDefaultPatch()
    expect(p.kind === 'patch' && p.engine).toBe('synth')
  })

  it('filter와 effects는 undefined이다(기본값은 최소 패치)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.filter).toBeUndefined()
      expect(p.effects).toBeUndefined()
    } else {
      throw new Error('expected patch')
    }
  })
})

// ── serialize 라운드트립 ────────────────────────────────────────

function makeProjectWithSound(sound: Sound) {
  const t = createTrack('Synth')
  let p = addTrack(createEmptyProject('Test'), t)
  return updateTrackSound(p, t.id, sound)
}

describe('patch 확장 — serialize 라운드트립', () => {
  it('기존 patch({engine, envelope})는 무손실 라운드트립', () => {
    const sound: Sound = { kind: 'patch', engine: 'synth', envelope: BASE_ENV }
    const p = makeProjectWithSound(sound)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(sound)
  })

  it('filter 있는 patch는 무손실 라운드트립', () => {
    const sound: Sound = {
      kind: 'patch', engine: 'fm', envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
      filter: { type: 'highpass', frequency: 500, Q: 0.7 },
    }
    expect(deserializeProject(serializeProject(makeProjectWithSound(sound))).tracks[0]!.sound).toEqual(sound)
  })

  it('FULL_PATCH(filter + reverb + delay)는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(FULL_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(FULL_PATCH)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/score-model test
```

Expected: FAIL — `createDefaultPatch`가 export되지 않음, `filter`/`effects` 필드 파싱 실패.

- [ ] **Step 3: schema.ts + factory.ts 구현**

`packages/score-model/src/schema.ts` — patch 변형 교체:

```ts
import { z } from 'zod'

const FilterSchema = z.object({
  type: z.enum(['lowpass', 'highpass', 'bandpass']),
  frequency: z.number().positive(),
  Q: z.number().nonnegative(),
})

const EffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reverb'),
    wet: z.number().min(0).max(1),
    decay: z.number().positive(),
  }),
  z.object({
    type: z.literal('delay'),
    wet: z.number().min(0).max(1),
    time: z.number().positive(),
    feedback: z.number().min(0).max(1),
  }),
])

export const SoundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), presetId: z.string() }),
  z.object({
    kind: z.literal('patch'),
    engine: z.enum(['synth', 'fm', 'am']),
    envelope: z.object({
      attack: z.number().nonnegative(),
      decay: z.number().nonnegative(),
      sustain: z.number().min(0).max(1),
      release: z.number().nonnegative(),
    }),
    filter: FilterSchema.optional(),
    effects: z.array(EffectSchema).optional(),
  }),
])

export const NoteSchema = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  velocity: z.number().int().min(0).max(127),
})

export const MixerSchema = z.object({
  volume: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
  muted: z.boolean(),
  soloed: z.boolean(),
})

export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  sound: SoundSchema,
  mixer: MixerSchema,
  notes: z.array(NoteSchema),
})

export const TransportSchema = z.object({
  ppq: z.number().int().positive(),
  tempo: z.number().positive(),
  timeSignature: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  key: z.string(),
})

export const ProjectSchema = z.object({
  id: z.string(),
  metadata: z.object({
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  transport: TransportSchema,
  tracks: z.array(TrackSchema),
})

export type Sound = z.infer<typeof SoundSchema>
export type Note = z.infer<typeof NoteSchema>
export type Mixer = z.infer<typeof MixerSchema>
export type Track = z.infer<typeof TrackSchema>
export type Transport = z.infer<typeof TransportSchema>
export type Project = z.infer<typeof ProjectSchema>
```

`packages/score-model/src/factory.ts` — `createDefaultPatch` 추가:

```ts
import type { Project, Track, Note, Sound } from './schema'

function uid(): string {
  return crypto.randomUUID()
}

export function createEmptyProject(title: string): Project {
  const now = new Date().toISOString()
  return {
    id: uid(),
    metadata: { title, createdAt: now, updatedAt: now },
    transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
    tracks: [],
  }
}

export function createTrack(name: string): Track {
  return {
    id: uid(),
    name,
    color: '#55565A',
    sound: { kind: 'preset', presetId: 'acoustic-piano' },
    mixer: { volume: 0.8, pan: 0, muted: false, soloed: false },
    notes: [],
  }
}

export function createNote(input: Omit<Note, 'id'>): Note {
  return { id: uid(), ...input }
}

/**
 * 기본 커스텀 패치를 생성한다. filter/effects는 없는 최소 패치(옵셔널 필드 미설정).
 * SoundSchema를 통과하는 유효한 Sound 값을 반환한다.
 */
export function createDefaultPatch(): Sound {
  return {
    kind: 'patch',
    engine: 'synth',
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/score-model test
```

Expected: patch-schema.test.ts 16개 PASS. 기존 serialize.test.ts 3개, operations.test.ts 7개 영향 없음. 전체 score-model 테스트 PASS.

---

## Task 2: sound-engine — patchToToneConfig (완전 TDD) + createInstrumentFromSound (스모크)

**Files:** Modify `packages/sound-engine/src/instrument.ts`; Create `packages/sound-engine/test/patch-instrument.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `packages/sound-engine/test/patch-instrument.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchToToneConfig, createInstrumentFromSound } from '../src/instrument'

// ── PatchInput 픽스처 ───────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

type PatchLike = {
  kind: 'patch'
  engine: 'synth' | 'fm' | 'am'
  envelope: typeof BASE_ENV
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; Q: number }
  effects?: Array<
    | { type: 'reverb'; wet: number; decay: number }
    | { type: 'delay'; wet: number; time: number; feedback: number }
  >
}

function makePatch(overrides: Partial<Omit<PatchLike, 'kind'>> = {}): PatchLike {
  return { kind: 'patch', engine: 'synth', envelope: BASE_ENV, ...overrides }
}

// ── patchToToneConfig — 순수 매핑 (완전 TDD) ───────────────────

describe('patchToToneConfig', () => {
  it('synth engine → toneClass: Synth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'synth' })).toneClass).toBe('Synth')
  })

  it('fm engine → toneClass: FMSynth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'fm' })).toneClass).toBe('FMSynth')
  })

  it('am engine → toneClass: AMSynth', () => {
    expect(patchToToneConfig(makePatch({ engine: 'am' })).toneClass).toBe('AMSynth')
  })

  it('envelope 값이 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch())
    expect(cfg.envelope).toEqual(BASE_ENV)
  })

  it('filter 없으면 filter: null 반환', () => {
    expect(patchToToneConfig(makePatch()).filter).toBeNull()
  })

  it('filter 있으면 동일 값 반환', () => {
    const filter = { type: 'lowpass' as const, frequency: 2000, Q: 1.5 }
    expect(patchToToneConfig(makePatch({ filter })).filter).toEqual(filter)
  })

  it('effects 없으면 빈 배열 반환', () => {
    expect(patchToToneConfig(makePatch()).effects).toEqual([])
  })

  it('reverb effect가 그대로 전달된다', () => {
    const effects = [{ type: 'reverb' as const, wet: 0.3, decay: 2.5 }]
    expect(patchToToneConfig(makePatch({ effects })).effects).toEqual(effects)
  })

  it('delay effect가 그대로 전달된다', () => {
    const effects = [{ type: 'delay' as const, wet: 0.2, time: 0.25, feedback: 0.4 }]
    expect(patchToToneConfig(makePatch({ effects })).effects).toEqual(effects)
  })

  it('filter + reverb + delay 모두 있는 패치 — 전체 필드 정확히 매핑', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'bandpass', frequency: 800, Q: 2 },
      effects: [
        { type: 'reverb', wet: 0.4, decay: 3 },
        { type: 'delay', wet: 0.15, time: 0.125, feedback: 0.3 },
      ],
    })
    const cfg = patchToToneConfig(patch)
    expect(cfg.toneClass).toBe('FMSynth')
    expect(cfg.filter).toEqual({ type: 'bandpass', frequency: 800, Q: 2 })
    expect(cfg.effects).toHaveLength(2)
    expect(cfg.effects[0]).toEqual({ type: 'reverb', wet: 0.4, decay: 3 })
    expect(cfg.effects[1]).toEqual({ type: 'delay', wet: 0.15, time: 0.125, feedback: 0.3 })
  })
})

// ── createInstrumentFromSound — 스모크 (Tone 전체 mock) ─────────

const mockPolyInstance = {
  set: vi.fn(),
  connect: vi.fn(),
  toDestination: vi.fn().mockReturnThis(),
  volume: { value: 0 },
  triggerAttackRelease: vi.fn(),
  dispose: vi.fn(),
}
const MockPolySynth = vi.fn().mockReturnValue(mockPolyInstance)
const mockFilterInstance = {
  Q: { value: 0 },
  connect: vi.fn(),
  toDestination: vi.fn(),
  dispose: vi.fn(),
}
const MockFilter = vi.fn().mockReturnValue(mockFilterInstance)
const mockReverbInstance = {
  wet: { value: 0 },
  connect: vi.fn(),
  toDestination: vi.fn(),
  dispose: vi.fn(),
}
const MockReverb = vi.fn().mockReturnValue(mockReverbInstance)
const mockDelayInstance = {
  wet: { value: 0 },
  connect: vi.fn(),
  toDestination: vi.fn(),
  dispose: vi.fn(),
}
const MockFeedbackDelay = vi.fn().mockReturnValue(mockDelayInstance)

vi.mock('tone', () => ({
  PolySynth: MockPolySynth,
  Synth: vi.fn(),
  AMSynth: vi.fn(),
  FMSynth: vi.fn(),
  Filter: MockFilter,
  Reverb: MockReverb,
  FeedbackDelay: MockFeedbackDelay,
}))

describe('createInstrumentFromSound — 스모크 (Tone mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPolyInstance.toDestination.mockReturnThis()
  })

  it('preset sound → triggerAttackRelease와 dispose 메서드가 있는 객체 반환', () => {
    const inst = createInstrumentFromSound({ kind: 'preset', presetId: 'synth-lead' })
    expect(typeof inst.triggerAttackRelease).toBe('function')
    expect(typeof inst.dispose).toBe('function')
  })

  it('patch sound → PatchInstrument 반환(크래시 없음), PolySynth 생성자 호출됨', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'lowpass', frequency: 1000, Q: 1 },
      effects: [{ type: 'reverb', wet: 0.3, decay: 2 }],
    })
    const inst = createInstrumentFromSound(patch)
    expect(typeof inst.triggerAttackRelease).toBe('function')
    expect(typeof inst.dispose).toBe('function')
    expect(MockPolySynth).toHaveBeenCalled()
  })

  it('dispose() 호출 시 내부 PolySynth와 effect 노드가 모두 dispose됨', () => {
    const patch = makePatch({
      effects: [{ type: 'delay', wet: 0.2, time: 0.25, feedback: 0.4 }],
    })
    const inst = createInstrumentFromSound(patch)
    inst.dispose()
    expect(mockPolyInstance.dispose).toHaveBeenCalled()
    expect(mockDelayInstance.dispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/sound-engine test
```

Expected: FAIL — `patchToToneConfig`, `createInstrumentFromSound`가 export되지 않음.

- [ ] **Step 3: instrument.ts 구현**

Replace `packages/sound-engine/src/instrument.ts`:

```ts
import * as Tone from 'tone'
import type { PresetDescriptor } from './types'
import { getPreset } from './presets'

// ── 기존 ToneSpec / createInstrument (하위호환 유지) ───────────

export type ToneSpec =
  | { kind: 'sampler'; source: string }
  | { kind: 'synth'; toneClass: 'Synth' | 'AMSynth' | 'FMSynth' }

export function descriptorToToneSpec(d: PresetDescriptor): ToneSpec {
  if (d.kind === 'sampler') return { kind: 'sampler', source: d.source }
  const cls = d.source === 'AMSynth' ? 'AMSynth' : d.source === 'FMSynth' ? 'FMSynth' : 'Synth'
  return { kind: 'synth', toneClass: cls }
}

export function createInstrument(spec: ToneSpec): Tone.PolySynth {
  switch (spec.kind) {
    case 'synth': {
      const map = { Synth: Tone.Synth, AMSynth: Tone.AMSynth, FMSynth: Tone.FMSynth } as const
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Tone.PolySynth(map[spec.toneClass] as any).toDestination()
    }
    case 'sampler':
    default:
      return new Tone.PolySynth(Tone.Synth).toDestination()
  }
}

// ── 신규: patch 지원 타입 ──────────────────────────────────────
// score-model에 의존하지 않음(구조적 타이핑으로 Sound patch 변형과 호환).

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass'
  frequency: number
  Q: number
}

export interface ReverbConfig { type: 'reverb'; wet: number; decay: number }
export interface DelayConfig  { type: 'delay'; wet: number; time: number; feedback: number }
export type EffectConfig = ReverbConfig | DelayConfig

export interface PatchInput {
  engine: 'synth' | 'fm' | 'am'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter?: FilterConfig
  effects?: EffectConfig[]
}

export interface TonePatchConfig {
  toneClass: 'Synth' | 'AMSynth' | 'FMSynth'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter: FilterConfig | null
  effects: EffectConfig[]
}

export interface PatchInstrument {
  triggerAttackRelease: (note: string, duration: number, time?: number, velocity?: number) => void
  volume: { value: number }
  dispose: () => void
}

// sound.kind를 포함한 유니온 (createInstrumentFromSound 시그니처용)
export type SoundInput =
  | { kind: 'preset'; presetId: string }
  | ({ kind: 'patch' } & PatchInput)

// ── 신규: patchToToneConfig (순수 — Tone 의존 없음) ────────────

const ENGINE_TO_TONE: Record<PatchInput['engine'], TonePatchConfig['toneClass']> = {
  synth: 'Synth',
  fm: 'FMSynth',
  am: 'AMSynth',
}

/**
 * patch 데이터 → Tone 설정 객체로 변환한다 (순수 함수, Tone 의존 없음).
 * - filter 없으면 null 반환.
 * - effects 없으면 빈 배열 반환.
 */
export function patchToToneConfig(patch: PatchInput): TonePatchConfig {
  return {
    toneClass: ENGINE_TO_TONE[patch.engine],
    envelope: { ...patch.envelope },
    filter: patch.filter ? { ...patch.filter } : null,
    effects: (patch.effects ?? []).map((fx) => ({ ...fx })),
  }
}

// ── 신규: createInstrumentFromSound (Tone 체인 구성) ───────────

/**
 * sound 종류에 따라 Tone 악기를 생성한다.
 * - preset → 기존 createInstrument 경로.
 * - patch  → PolySynth + [Filter] + [Reverb/Delay...] 체인.
 *
 * Tone 체인: poly → filter? → reverb? → delay? → destination
 * dispose()는 poly와 모든 effect node를 정리한다.
 */
export function createInstrumentFromSound(
  sound: SoundInput,
  getPresetFn: (id: string) => PresetDescriptor | undefined = getPreset,
): PatchInstrument {
  if (sound.kind === 'preset') {
    const desc = getPresetFn(sound.presetId) ?? getPresetFn('acoustic-piano')!
    const poly = createInstrument(descriptorToToneSpec(desc))
    return poly as unknown as PatchInstrument
  }

  // patch 경로
  const cfg = patchToToneConfig(sound)
  const classMap = {
    Synth: Tone.Synth,
    AMSynth: Tone.AMSynth,
    FMSynth: Tone.FMSynth,
  } as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = new Tone.PolySynth(classMap[cfg.toneClass] as any)
  poly.set({ envelope: cfg.envelope })

  const nodes: Tone.ToneAudioNode[] = []

  if (cfg.filter) {
    const f = new Tone.Filter(cfg.filter.frequency, cfg.filter.type)
    f.Q.value = cfg.filter.Q
    nodes.push(f)
  }

  for (const fx of cfg.effects) {
    if (fx.type === 'reverb') {
      const r = new Tone.Reverb(fx.decay)
      r.wet.value = fx.wet
      nodes.push(r)
    } else if (fx.type === 'delay') {
      const d = new Tone.FeedbackDelay(fx.time, fx.feedback)
      d.wet.value = fx.wet
      nodes.push(d)
    }
  }

  // 체인 연결
  if (nodes.length > 0) {
    poly.connect(nodes[0]!)
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i]!.connect(nodes[i + 1]!)
    }
    nodes[nodes.length - 1]!.toDestination()
  } else {
    poly.toDestination()
  }

  return {
    triggerAttackRelease(note, duration, time, velocity) {
      poly.triggerAttackRelease(note, duration, time, velocity)
    },
    volume: poly.volume as unknown as { value: number },
    dispose() {
      poly.dispose()
      for (const n of nodes) n.dispose()
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/sound-engine test
```

Expected: patch-instrument.test.ts 13개 PASS. 기존 instrument.test.ts(3개) + presets.test.ts 영향 없음.

---

## Task 3: apps/web — useAudio patch 지원 + 캐시 무효화

**Files:** Modify `apps/web/src/audio/useAudio.ts`, `apps/web/src/audio/test/useAudio.test.ts`

- [ ] **Step 1: useAudio.test.ts 에 mock 추가 + patch 테스트 블록 작성**

`apps/web/src/audio/test/useAudio.test.ts` 상단의 `vi.mock('@sculptone/sound-engine', ...)` 팩토리에 `createInstrumentFromSound` 추가:

```ts
// 기존 mock 유지, createInstrumentFromSound만 추가
const mockPatchDispose = vi.fn()
const mockPatchTrigger = vi.fn()

vi.mock('@sculptone/sound-engine', () => ({
  createInstrument: vi.fn(() => ({
    triggerAttackRelease: mockTrigger,
    volume: { value: 0 },
    dispose: mockDispose,
  })),
  descriptorToToneSpec: vi.fn(() => ({ kind: 'synth', toneClass: 'Synth' })),
  getPreset: vi.fn((id: string) => ({ id, label: id, kind: 'synth', source: 'Synth' })),
  // 새로 추가: patch 경로용
  createInstrumentFromSound: vi.fn(() => ({
    triggerAttackRelease: mockPatchTrigger,
    volume: { value: 0 },
    dispose: mockPatchDispose,
  })),
}))
```

import 라인에 `createInstrumentFromSound` 추가:
```ts
import { createInstrument, createInstrumentFromSound } from '@sculptone/sound-engine'
```

파일 끝에 새 describe 블록 추가:

```ts
describe('useAudio — patch instrument 관리', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    mockSeconds = 0
    vi.clearAllMocks()
  })

  it('patch sound 트랙은 createInstrumentFromSound 경로로 instrument를 생성한다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    // preset → patch 전환
    s.setProject(updateTrackSound(s.project, trackId, {
      kind: 'patch', engine: 'synth',
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }))
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)
    // preset 경로(createInstrument)는 호출되지 않아야 함
    expect(createInstrument).not.toHaveBeenCalled()
  })

  it('patch envelope 변경 후 play() 시 instrument가 dispose + 재생성된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    const basePatch = { kind: 'patch' as const, engine: 'synth' as const, envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 } }
    s.setProject(updateTrackSound(s.project, trackId, basePatch))

    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)

    // envelope 변경 (attack: 0.5)
    const updated = useStore.getState()
    updated.setProject(updateTrackSound(updated.project, trackId, {
      ...basePatch,
      envelope: { ...basePatch.envelope, attack: 0.5 },
    }))

    await act(async () => { result.current.play() })
    expect(mockPatchDispose).toHaveBeenCalledTimes(1)
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(2)
  })

  it('preset→patch 전환 후 play() 시 기존 preset instrument가 dispose + patch instrument 생성', async () => {
    // 먼저 preset으로 play
    const { result } = renderHook(() => useAudio())
    await act(async () => { result.current.play() })
    expect(createInstrument).toHaveBeenCalledTimes(1)

    // patch로 전환
    const s = useStore.getState()
    s.setProject(updateTrackSound(s.project, s.selectedTrackId, {
      kind: 'patch', engine: 'am',
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    }))
    await act(async () => { result.current.play() })
    // 기존 preset instrument dispose
    expect(mockDispose).toHaveBeenCalledTimes(1)
    // 새 patch instrument 생성
    expect(createInstrumentFromSound).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- useAudio
```

Expected: 新 3개 FAIL (useAudio.ts가 아직 patch 분기 없음).

- [ ] **Step 3: useAudio.ts 구현 교체**

Replace `apps/web/src/audio/useAudio.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react'
import { createInstrument, descriptorToToneSpec, getPreset, createInstrumentFromSound } from '@sculptone/sound-engine'
import { createPlaybackEngine, type PlaybackEngine, type MultiInstrument } from './playback'
import { useStore } from '../state/store'
import type { Project, Track } from '@sculptone/score-model'

// ── 캐시 키 ───────────────────────────────────────────────────
// preset: "preset:<presetId>" / patch: "patch:<JSON>" (모든 필드 변경 감지)

function resolveSoundCacheKey(track: Track): string {
  if (track.sound.kind === 'preset') return `preset:${track.sound.presetId}`
  return `patch:${JSON.stringify(track.sound)}`
}

// ── instrument 생성 분기 ──────────────────────────────────────
// preset → 기존 createInstrument 경로(기존 mock 호환).
// patch  → createInstrumentFromSound 경로(신규 mock).

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
  const soundKeyRef    = useRef(new Map<string, string>()) // trackId → cacheKey
  const engineRef      = useRef<PlaybackEngine | null>(null)
  const playGenRef     = useRef(0)

  /**
   * 프로젝트 트랙과 instrument Map을 동기화한다.
   * - 삭제된 트랙 → dispose + Map 제거.
   * - 신규 또는 sound 변경 트랙 → dispose + 재생성.
   */
  const syncInstruments = useCallback((project: Project) => {
    const currentIds = new Set(project.tracks.map((t) => t.id))

    // 삭제된 트랙 정리
    for (const [trackId, inst] of instrumentsRef.current.entries()) {
      if (!currentIds.has(trackId)) {
        inst.dispose()
        instrumentsRef.current.delete(trackId)
        soundKeyRef.current.delete(trackId)
      }
    }

    // 신규 또는 sound 변경 트랙
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
    const { project, isRecording } = useStore.getState()
    syncInstruments(project)

    const gen = ++playGenRef.current

    engineRef.current = createPlaybackEngine((trackId) => {
      return instrumentsRef.current.get(trackId) ?? null
    })

    void engineRef.current.play(
      project,
      () => { useStore.getState().setPlaying(false) },
      () => playGenRef.current === gen,
      { keepAlive: isRecording },
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
    }
  }, [])

  return { play, stop, getSeconds }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- useAudio
```

Expected: 기존 9개 + 신규 3개 = 12개 PASS.

---

## Task 4: apps/web — store.ts soundPanelTrackId 상태 추가

**Files:** Modify `apps/web/src/state/store.ts`

- [ ] **Step 1: store.ts 수정**

`packages/score-model/src/state/store.ts` — `AppState` 인터페이스에 추가:

```ts
/** 사운드 디자인 패널 열림 상태. null = 닫힘. */
soundPanelTrackId: string | null
setSoundPanelTrackId: (id: string | null) => void
```

`useStore` create 내 초기값 + 액션 추가:

```ts
soundPanelTrackId: null,
setSoundPanelTrackId: (id) => set({ soundPanelTrackId: id }),
```

전체 파일:

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
  /** 사운드 디자인 패널 열림 상태. null = 닫힘. */
  soundPanelTrackId: string | null
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
  setSoundPanelTrackId: (id: string | null) => void
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
  soundPanelTrackId: null,
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
  setSoundPanelTrackId: (id) => set({ soundPanelTrackId: id }),
}))
```

> **기존 테스트 영향:** `useStore.getInitialState()`가 `soundPanelTrackId: null`을 포함하게 되므로 기존 `beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })` 패턴이 자동으로 새 필드를 초기화한다. 기존 테스트 단언에 영향 없음.

- [ ] **Step 2: 통과 확인**

```bash
pnpm --filter @sculptone/web test
```

Expected: 타입 오류 없음. 기존 모든 web 테스트 PASS.

---

## Task 5: apps/web — SoundDesignPanel UI (TDD)

**Files:** Create `apps/web/src/sound/SoundDesignPanel.tsx`, `apps/web/src/sound/test/SoundDesignPanel.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/sound/test/SoundDesignPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { updateTrackSound } from '@sculptone/score-model'

// createInstrumentFromSound → preview만 사용, Tone 초기화 방지
vi.mock('@sculptone/sound-engine', () => ({
  listPresets: vi.fn(() => [
    { id: 'acoustic-piano', label: 'Acoustic Piano', kind: 'sampler', source: 'salamander' },
    { id: 'synth-lead',     label: 'Synth Lead',     kind: 'synth',   source: 'Synth' },
    { id: 'electric-piano', label: 'Electric Piano', kind: 'synth',   source: 'AMSynth' },
  ]),
  createInstrumentFromSound: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    volume: { value: 0 },
    dispose: vi.fn(),
  })),
}))

import { SoundDesignPanel } from '../SoundDesignPanel'

const BASE_PATCH = {
  kind: 'patch' as const,
  engine: 'synth' as const,
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

describe('SoundDesignPanel', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('soundPanelTrackId가 null이면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<SoundDesignPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('soundPanelTrackId가 설정되면 dialog role의 패널이 열린다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('dialog', { name: /sound design/i })).toBeInTheDocument()
  })

  it('preset sound이면 "Sound preset" 드롭다운이 표시된다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /sound preset/i })).toBeInTheDocument()
  })

  it('"Switch to Patch" 버튼 클릭 시 sound.kind가 patch가 된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /switch to (custom )?patch/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind).toBe('patch')
  })

  it('patch sound이면 Engine 드롭다운이 표시된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /synth engine/i })).toBeInTheDocument()
  })

  it('patch sound이면 ADSR 슬라이더가 4개 이상 존재한다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getAllByRole('slider').length).toBeGreaterThanOrEqual(4)
  })

  it('Engine 드롭다운 변경 시 sound.engine이 갱신된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /synth engine/i }), 'fm')
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && (updated.sound as { engine: string }).engine).toBe('fm')
  })

  it('Attack 슬라이더 변경 시 envelope.attack이 갱신된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /envelope attack/i }), { target: { value: '0.5' } })
    const updated = useStore.getState().project.tracks[0]!
    if (updated.sound.kind === 'patch') expect(updated.sound.envelope.attack).toBeCloseTo(0.5)
  })

  it('Filter 체크박스 활성화 시 Filter type 드롭다운이 나타난다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /enable filter/i }))
    expect(screen.getByRole('combobox', { name: /filter type/i })).toBeInTheDocument()
  })

  it('Reverb 체크박스 활성화 시 effects에 reverb가 추가된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /enable reverb/i }))
    const updated = useStore.getState().project.tracks[0]!
    if (updated.sound.kind === 'patch') {
      expect(updated.sound.effects?.some((fx) => fx.type === 'reverb')).toBe(true)
    }
  })

  it('닫기 버튼 클릭 시 soundPanelTrackId가 null이 된다', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /close sound panel/i }))
    expect(useStore.getState().soundPanelTrackId).toBeNull()
  })

  it('프리뷰 버튼이 존재하고 클릭해도 오류가 없다(스모크)', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('button', { name: /preview sound/i })).toBeInTheDocument()
    await expect(userEvent.click(screen.getByRole('button', { name: /preview sound/i }))).resolves.not.toThrow()
  })

  it('"Use Preset Instead" 버튼 클릭 시 sound.kind가 preset으로 돌아온다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /use preset instead/i }))
    expect(useStore.getState().project.tracks[0]!.sound.kind).toBe('preset')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: FAIL — `'../SoundDesignPanel'` 모듈 없음.

- [ ] **Step 3: SoundDesignPanel.tsx 구현**

Create `apps/web/src/sound/SoundDesignPanel.tsx`:

```tsx
import { useStore } from '../state/store'
import { updateTrackSound, createDefaultPatch } from '@sculptone/score-model'
import { listPresets, createInstrumentFromSound } from '@sculptone/sound-engine'
import type { Sound } from '@sculptone/score-model'
import type { CSSProperties, ChangeEvent } from 'react'

const PRESETS = listPresets()

// ── 스타일 상수 ────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  fontSize: 11, color: 'var(--text-lo)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em',
}
const selectStyle: CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 11, padding: '4px 6px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-mid)', cursor: 'pointer',
}
const sliderRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
}

// ── 컴포넌트 ──────────────────────────────────────────────────

export function SoundDesignPanel() {
  const project              = useStore((s) => s.project)
  const setProject           = useStore((s) => s.setProject)
  const soundPanelTrackId    = useStore((s) => s.soundPanelTrackId)
  const setSoundPanelTrackId = useStore((s) => s.setSoundPanelTrackId)

  if (!soundPanelTrackId) return null
  const track = project.tracks.find((t) => t.id === soundPanelTrackId)
  if (!track) return null

  const sound = track.sound

  // ── 헬퍼 ──────────────────────────────────────────────────

  const commit = (next: Sound) =>
    setProject(updateTrackSound(project, soundPanelTrackId, next))

  const updatePatch = (updates: Partial<Extract<Sound, { kind: 'patch' }>>) => {
    if (sound.kind !== 'patch') return
    commit({ ...sound, ...updates })
  }

  const handlePreview = () => {
    const inst = createInstrumentFromSound(sound)
    try {
      inst.triggerAttackRelease('C4', 0.5)
    } finally {
      setTimeout(() => inst.dispose(), 1200)
    }
  }

  // ── 렌더 ───────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-label="Sound Design"
      style={{
        position: 'fixed', top: 0, right: 0, width: 300, height: '100vh',
        background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
        overflowY: 'auto', padding: '20px 18px', zIndex: 100,
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '-4px 0 16px rgba(0,0,0,.18)',
      }}
    >
      {/* ── 헤더 ── */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-hi)', margin: 0 }}>
          {track.name} — Sound
        </h2>
        <button
          aria-label="Close sound panel"
          onClick={() => setSoundPanelTrackId(null)}
          style={{ font: 'inherit', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-lo)', lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* ── Preset 모드 ── */}
      {sound.kind === 'preset' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Preset</label>
          <select
            aria-label="Sound preset"
            value={sound.presetId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              commit({ kind: 'preset', presetId: e.target.value })
            }
            style={selectStyle}
          >
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button
            aria-label="Switch to custom patch"
            onClick={() => commit(createDefaultPatch())}
            style={{
              font: 'inherit', fontSize: 11, padding: '5px 10px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: 'var(--accent-soft)', color: 'var(--accent)',
            }}
          >
            Switch to Patch
          </button>
        </section>
      )}

      {/* ── Patch 모드 ── */}
      {sound.kind === 'patch' && (
        <>
          {/* Engine */}
          <section>
            <label style={labelStyle}>Engine</label>
            <select
              aria-label="Synth engine"
              value={sound.engine}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                updatePatch({ engine: e.target.value as 'synth' | 'fm' | 'am' })
              }
              style={selectStyle}
            >
              <option value="synth">Synth</option>
              <option value="fm">FM Synth</option>
              <option value="am">AM Synth</option>
            </select>
          </section>

          {/* ADSR */}
          <section>
            <p style={{ ...labelStyle, margin: '0 0 10px' }}>Envelope</p>
            {(['attack', 'decay', 'sustain', 'release'] as const).map((param) => (
              <div key={param} style={sliderRowStyle}>
                <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0, textTransform: 'capitalize' }}>
                  {param}
                </label>
                <input
                  type="range"
                  aria-label={`Envelope ${param}`}
                  min={0}
                  max={param === 'sustain' ? 1 : 2}
                  step={0.001}
                  value={sound.envelope[param]}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updatePatch({ envelope: { ...sound.envelope, [param]: Number(e.target.value) } })
                  }
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                  {param === 'sustain'
                    ? sound.envelope[param].toFixed(2)
                    : `${Math.round(sound.envelope[param] * 1000)}ms`}
                </span>
              </div>
            ))}
          </section>

          {/* Filter */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ ...labelStyle, margin: 0, flex: 1 }}>Filter</p>
              <input
                type="checkbox"
                aria-label="Enable filter"
                checked={!!sound.filter}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  updatePatch({ filter: e.target.checked ? { type: 'lowpass', frequency: 2000, Q: 1 } : undefined })
                }
              />
            </div>
            {sound.filter && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select
                  aria-label="Filter type"
                  value={sound.filter.type}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    updatePatch({ filter: { ...sound.filter!, type: e.target.value as 'lowpass' | 'highpass' | 'bandpass' } })
                  }
                  style={selectStyle}
                >
                  <option value="lowpass">Low Pass</option>
                  <option value="highpass">High Pass</option>
                  <option value="bandpass">Band Pass</option>
                </select>
                {(['frequency', 'Q'] as const).map((fp) => (
                  <div key={fp} style={sliderRowStyle}>
                    <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
                      {fp === 'frequency' ? 'Cutoff' : 'Q'}
                    </label>
                    <input
                      type="range"
                      aria-label={`Filter ${fp}`}
                      min={fp === 'frequency' ? 20 : 0}
                      max={fp === 'frequency' ? 20000 : 20}
                      step={fp === 'frequency' ? 1 : 0.1}
                      value={sound.filter[fp]}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updatePatch({ filter: { ...sound.filter!, [fp]: Number(e.target.value) } })
                      }
                      style={{ flex: 1, accentColor: 'var(--accent)' }}
                    />
                    <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                      {fp === 'frequency' ? `${sound.filter.frequency}Hz` : sound.filter.Q.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Reverb */}
          <section>
            {(() => {
              const reverb = (sound.effects ?? []).find((fx): fx is Extract<typeof fx, { type: 'reverb' }> => fx.type === 'reverb')
              const toggleReverb = (e: ChangeEvent<HTMLInputElement>) => {
                updatePatch({
                  effects: e.target.checked
                    ? [...(sound.effects ?? []), { type: 'reverb' as const, wet: 0.3, decay: 2 }]
                    : (sound.effects ?? []).filter((fx) => fx.type !== 'reverb'),
                })
              }
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                    <p style={{ ...labelStyle, margin: 0, flex: 1 }}>Reverb</p>
                    <input type="checkbox" aria-label="Enable reverb" checked={!!reverb} onChange={toggleReverb} />
                  </div>
                  {reverb && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(['wet', 'decay'] as const).map((rp) => (
                        <div key={rp} style={sliderRowStyle}>
                          <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0, textTransform: 'capitalize' }}>
                            {rp}
                          </label>
                          <input
                            type="range"
                            aria-label={`Reverb ${rp}`}
                            min={0}
                            max={rp === 'wet' ? 1 : 10}
                            step={rp === 'wet' ? 0.01 : 0.1}
                            value={reverb[rp]}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updatePatch({
                                effects: (sound.effects ?? []).map((fx) =>
                                  fx.type === 'reverb' ? { ...fx, [rp]: Number(e.target.value) } : fx
                                ),
                              })
                            }
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                          />
                          <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
                            {rp === 'wet' ? reverb.wet.toFixed(2) : `${reverb.decay.toFixed(1)}s`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </section>

          {/* 프리셋으로 돌아가기 */}
          <button
            aria-label="Use preset instead"
            onClick={() => commit({ kind: 'preset', presetId: 'acoustic-piano' })}
            style={{
              font: 'inherit', fontSize: 11, padding: '5px 10px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', cursor: 'pointer',
              background: 'transparent', color: 'var(--text-lo)',
            }}
          >
            Use Preset Instead
          </button>
        </>
      )}

      {/* 프리뷰 */}
      <button
        aria-label="Preview sound"
        onClick={handlePreview}
        style={{
          font: 'inherit', fontSize: 12, fontWeight: 700, padding: '7px 12px',
          borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: 'var(--on-accent)',
          marginTop: 'auto',
        }}
      >
        Preview ▶
      </button>
    </div>
  )
}
```

> **React namespace 주의:** React 타입 네임스페이스 직접 사용 금지. `import type { CSSProperties, ChangeEvent } from 'react'`로 개별 타입을 import하고 인라인 스타일 상수는 `const name: CSSProperties = {...}` 형태로 선언한다.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: SoundDesignPanel.test.tsx 12개 PASS.

---

## Task 6: apps/web — TracksPanel + AppShell 통합 배선

**Files:** Modify `apps/web/src/compose/TracksPanel.tsx`, `apps/web/src/compose/test/TracksPanel.test.tsx`, `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`

- [ ] **Step 1: TracksPanel.test.tsx에 "Edit Sound" 테스트 추가**

`apps/web/src/compose/test/TracksPanel.test.tsx` 끝에 추가:

```tsx
  it('"Edit Sound" 버튼 클릭 시 soundPanelTrackId가 선택 트랙 ID로 설정된다', async () => {
    render(<TracksPanel />)
    const trackId = useStore.getState().selectedTrackId
    await userEvent.click(screen.getByRole('button', { name: /edit sound/i }))
    expect(useStore.getState().soundPanelTrackId).toBe(trackId)
  })
```

- [ ] **Step 2: TracksPanel.tsx 수정**

`apps/web/src/compose/TracksPanel.tsx` — `useStore`에서 `setSoundPanelTrackId` 추가 및 "Edit Sound" 버튼 삽입:

```tsx
import { useStore } from '../state/store'
import { addTrack, removeTrack, createTrack, updateTrackSound } from '@sculptone/score-model'
import { listPresets } from '@sculptone/sound-engine'
import type { ChangeEvent } from 'react'

const PRESETS = listPresets()

export function TracksPanel() {
  const project              = useStore((s) => s.project)
  const selectedTrackId      = useStore((s) => s.selectedTrackId)
  const setProject           = useStore((s) => s.setProject)
  const selectTrack          = useStore((s) => s.selectTrack)
  const setSoundPanelTrackId = useStore((s) => s.setSoundPanelTrackId)

  const handleAddTrack = () => {
    const maxN = project.tracks.reduce((m, t) => {
      const mm = /^Track (\d+)$/.exec(t.name)
      return mm ? Math.max(m, Number(mm[1])) : m
    }, 1)
    const newTrack = createTrack(`Track ${maxN + 1}`)
    setProject(addTrack(project, newTrack))
    selectTrack(newTrack.id)
  }

  const handleDeleteTrack = (trackId: string) => {
    if (project.tracks.length <= 1) return
    const updated = removeTrack(project, trackId)
    setProject(updated)
    if (selectedTrackId === trackId) selectTrack(updated.tracks[0]!.id)
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
              {sel && (
                <>
                  <button
                    aria-label="Edit sound"
                    onClick={() => setSoundPanelTrackId(t.id)}
                    style={{
                      font: 'inherit', fontSize: 10, padding: '3px 6px',
                      borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                      cursor: 'pointer', background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                    }}
                  >
                    ♪
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
                </>
              )}
            </div>

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

- [ ] **Step 3: TracksPanel 통과 확인**

```bash
pnpm --filter @sculptone/web test -- TracksPanel
```

Expected: 기존 7개 + 신규 1개 = 8개 PASS.

- [ ] **Step 4: AppShell.test.tsx에 SoundDesignPanel mock + 테스트 추가**

`apps/web/src/test/AppShell.test.tsx` 상단 mock 블록에 추가:

```tsx
vi.mock('../sound/SoundDesignPanel', () => ({
  SoundDesignPanel: vi.fn(() => null),
}))
```

기존 describe 블록 안에 테스트 추가:

```tsx
  it('SoundDesignPanel이 AppShell과 함께 마운트된다', () => {
    const { SoundDesignPanel } = vi.mocked(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../sound/SoundDesignPanel') as { SoundDesignPanel: ReturnType<typeof vi.fn> }
    )
    render(<AppShell />)
    expect(SoundDesignPanel).toHaveBeenCalled()
  })
```

- [ ] **Step 5: AppShell.tsx 수정**

`apps/web/src/shell/AppShell.tsx`에 import 추가:

```tsx
import { SoundDesignPanel } from '../sound/SoundDesignPanel'
```

return JSX의 가장 바깥 `<div>` 닫힘 직전에 추가:

```tsx
      {/* 사운드 디자인 패널 (전역 오버레이 — soundPanelTrackId !== null 일 때 표시) */}
      <SoundDesignPanel />
    </div>
```

- [ ] **Step 6: AppShell 통과 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell
```

Expected: 기존 7개 + 신규 1개 = 8개 PASS.

---

## Task 7: 최종 게이트

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected 최소 테스트 수:
- score-model: 기존 테스트 + patch-schema.test.ts **16개** 추가 → 합계 증가
- sound-engine: 기존 6개 + patch-instrument.test.ts **13개** 추가 → 19개
- web: 기존 테스트 + useAudio **3개** + SoundDesignPanel **12개** + TracksPanel **1개** + AppShell **1개** = **17개** 추가

> **기존 273개 테스트 보존 체크:**
> - serialize.test.ts 3개: schema.ts 확장은 additive(zod optional) → PASS
> - operations.test.ts 7개: updateTrackSound 이미 구현됨, Sound 타입 확장 → PASS
> - instrument.test.ts 3개(descriptorToToneSpec): 기존 함수 서명 불변 → PASS
> - useAudio.test.ts 9개: preset 경로 불변(createInstrument mock 유지) → PASS
> - TracksPanel.test.tsx 7개: "Edit Sound" 버튼 추가는 비파괴(기존 버튼/드롭다운 유지) → PASS
> - AppShell.test.tsx 7개: SoundDesignPanel mock이 null 반환 → PASS
> - AppShell.compose.test.tsx: SoundDesignPanel mock 추가 필요 → 동일 mock 적용
> - 나머지: 파일 미수정 → PASS

- [ ] **Step 2: AppShell.compose.test.tsx SoundDesignPanel mock 확인**

`apps/web/src/test/AppShell.compose.test.tsx`도 AppShell을 렌더한다면 상단에 동일 mock 추가가 필요하다:

```tsx
vi.mock('../sound/SoundDesignPanel', () => ({
  SoundDesignPanel: vi.fn(() => null),
}))
```

파일을 읽어 AppShell을 임포트하는지 확인 후, 필요하면 추가한다.

- [ ] **Step 3: 타입 체크**

```bash
pnpm --filter @sculptone/score-model exec tsc --noEmit
pnpm --filter @sculptone/sound-engine exec tsc --noEmit
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음.

- [ ] **Step 4: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 273개 보존 + 신규 ≈46개 추가).
- 기존 patch `{ kind:'patch', engine, envelope }` 객체가 SoundSchema를 통과하고 직렬화 라운드트립이 무손실임을 자동 테스트로 검증.
- `patchToToneConfig` 순수 매핑: engine→toneClass, filter null 처리, effects 빈 배열 기본값 — 10개 테스트로 완전 검증.
- `createInstrumentFromSound`: preset → 기존 경로, patch → PolySynth + 체인 — 스모크 3개 통과.
- useAudio: patch sound 트랙은 `createInstrumentFromSound` 경로로 instrument 생성; sound 필드 변경 시 캐시 무효화 + dispose + 재생성.
- SoundDesignPanel: preset↔patch 전환, ADSR·filter·reverb 편집이 `updateTrackSound`를 통해 스토어에 반영됨 — 12개 테스트로 검증.
- TracksPanel: "Edit Sound" 버튼 클릭 시 `soundPanelTrackId` 설정.
- AppShell: `SoundDesignPanel`이 전역 오버레이로 마운트됨.
- 하드코딩 hex/px 없음 — 모든 색상은 CSS 변수(`var(--accent)`, `var(--text-lo)`, `var(--bg-panel)` 등) 사용.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 증분 (이 계획 완료 후 별도 작성)

- **패치 라이브러리:** 패치에 이름 붙이기, 저장, 로드, 공유(export/import). 별도 사이드바 또는 모달 UI.
- **모듈레이션 매트릭스 / LFO:** Tone.LFO + 파라미터 타겟팅(filter frequency, volume 등).
- **오실레이터 세부 편집:** 파형(sine/square/sawtooth/triangle), detune, unison count.
- **Delay 이펙트 UI:** 현재 계획에서 스키마·엔진은 지원하나 SoundDesignPanel UI에서 delay 슬라이더는 미구현 → 다음 계획에서 reverb와 동일 패턴으로 추가.
- **재생 중 실시간 패치 파라미터 업데이트:** play 중 envelope/filter 변경 시 Tone Signal 직접 업데이트.
- **Tone.Reverb pregeneration 최적화:** 비동기 `reverb.ready` 대기 전략(Web Audio 오프라인 컨텍스트).

---

## 열린 질문

1. **Tone.Reverb 비동기 문제:** `new Tone.Reverb(decay)`는 IR(Impulse Response)을 비동기로 생성한다(`reverb.ready` Promise). 현재 구현에서는 await 없이 즉시 체인에 연결하므로 첫 발음 시 리버브가 없을 수 있다. 프리뷰 품질 문제지 데이터 파괴는 아님. 해결책: `createInstrumentFromSound`를 async로 변경하거나 `new Tone.Reverb({ decay, preload: false })`(있으면) 사용. 다음 증분에서 결정.

2. **delay UI 미포함:** `EffectSchema`와 `patchToToneConfig`는 delay를 지원하나 `SoundDesignPanel`의 현재 구현에서 delay 슬라이더 UI는 생략됨(reverb만 표시). 다음 증분에서 reverb 섹션을 복제해 추가.

3. **SoundDesignPanel 위치 전략:** 현재 fixed 오버레이(우측 패널). 향후 모달 또는 Inspector 탭으로 변경할 경우 `soundPanelTrackId` 상태는 동일하게 유지 가능(UI 컴포넌트만 교체).

4. **patch 편집 중 실시간 프리뷰:** 슬라이더를 움직일 때마다 소리가 변하는 "실시간 프리뷰" 모드는 현재 비목표. 매 변경마다 `createInstrumentFromSound`를 호출하면 성능 문제가 있으므로 디바운스 + 전용 "preview instrument" 참조가 필요하다.

5. **AppShell.compose.test.tsx mock 요구사항:** Task 7 Step 2에서 이 파일이 SoundDesignPanel을 포함하는 AppShell을 렌더한다면 mock을 추가해야 한다. 파일 내용에 따라 처리.

6. **CSSProperties 타입 선언:** `SoundDesignPanel.tsx`에서 인라인 스타일 상수는 `import type { CSSProperties } from 'react'` 후 `const name: CSSProperties = {...}` 형태로 선언한다. 스프레드 조합 시 TypeScript가 자동 호환성을 검증해 별도 캐스트 불필요.
