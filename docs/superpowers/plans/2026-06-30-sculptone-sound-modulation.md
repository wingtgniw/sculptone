# Sculptone 사운드 디자인 심화 — 오실레이터 + LFO 모듈레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** patch sound에 오실레이터(파형 타입·detune)와 LFO(타겟·rate·depth) 필드를 추가해 커스텀 신스 음색의 표현력을 심화한다. score-model의 patch 스키마에 `oscillator?`·`lfo?`를 하위호환 옵셔널로 추가하고, sound-engine의 `patchToToneConfig`(순수)에서 이를 정규화 설정으로 매핑한 뒤 `createInstrumentFromSound`에서 Tone.js 오실레이터 설정 적용 및 LFO 배선을 수행한다. SoundDesignPanel에 Oscillator·LFO 두 편집 섹션을 추가한다.

**Architecture:** `SoundSchema` oscillator/lfo 확장과 schema 테스트는 완전 TDD(완전 코드+완전 테스트). `patchToToneConfig` 순수 매핑 확장도 완전 TDD. `createInstrumentFromSound`(LFO 배선)는 Tone 전체 mock 스모크 5개. `SoundDesignPanel`에 Oscillator·LFO 섹션을 추가하고 `@testing-library/react`로 동작 검증 8개. 기존 389개 테스트를 보존한다.

**Tech Stack:** React + TS · Zustand · Tone.js(^15) · Zod · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 직접 선행 계획 `docs/superpowers/plans/2026-06-29-sculptone-sound-design.md`, `docs/superpowers/plans/2026-06-29-sculptone-patch-library.md`, 디자인 가이드 `documents/sculptone-design-guide.html`.

---

## 비목표 (이 계획에서 하지 말 것)

- 다중 오실레이터 / 유니즌 / 디튠 보이스 (단일 oscillator만)
- 모듈레이션 매트릭스 (복수 LFO·엔벨로프→임의 타겟)
- 비주얼 LFO 파형 디스플레이 / ADSR 그래프
- 오실레이터 파티셜(custom/partials) 타입 지원
- 샘플 기반 사운드, 아르페지에이터
- 프리셋(kind:'preset') 모드에 LFO/oscillator 적용
- Delay LFO 타겟 (delay.time/feedback 변조)
- MPE / 협업 / 백엔드

---

## 설계 근거

### patch 스키마 확장 전략

기존 `{ kind:'patch', engine, envelope, filter?, effects? }` 패치는 완전 유효하다. `SoundSchema` patch 분기에 두 필드를 옵셔널로 추가한다:

```
oscillator?: { type: 'sine'|'square'|'sawtooth'|'triangle', detune: number }
lfo?: { target: 'filter'|'pitch'|'amplitude', rate: number(Hz, >0), depth: number(0..1) }
```

- `OscillatorSchema`: `type`은 4가지 기본 파형만 허용(z.enum). `detune`은 제약 없는 정수 범위 cents(z.number() — 양수/음수 허용, 범위 미제한: UI가 -1200..1200 한계를 강제).
- `LFOSchema`: `target`은 z.enum 3값. `rate`는 z.number().positive()(>0 강제). `depth`는 z.number().min(0).max(1)(0..1).
- `createDefaultPatch()`(factory.ts) **변경 없음** — 최소 패치 철학 유지. oscillator/lfo 모두 `undefined`(미설정).

기존 patch(oscillator/lfo 없음)는 SoundSchema를 그대로 통과하므로 하위호환 유지. 기존 serialize/deserialize도 옵셔널 필드 부재 시 그대로 복원.

### patchToToneConfig 순수 확장

`PatchInput`에 `oscillator?: OscillatorConfig`, `lfo?: LFOConfig` 추가.
`TonePatchConfig`에 `oscillator: OscillatorConfig` (non-null, default 적용됨), `lfo: LFOConfig | null` 추가.

`patchToToneConfig` 확장 규칙:
- `oscillator` 미설정 → 기본값 `{ type: 'sine', detune: 0 }` 반환(신스 기본 파형과 동일).
- `lfo` 미설정 → `null` 반환.

이 함수는 Tone에 전혀 의존하지 않으므로 jsdom에서 완전 테스트 가능. 12개 단위 테스트.

### createInstrumentFromSound: oscillator 적용 + LFO 배선

기존 patch 경로(`kind:'patch'`)에 두 단계를 추가한다:

**oscillator 적용(기존 poly.set({ envelope }) 이후):**
```ts
poly.set({ oscillator: { type: cfg.oscillator.type, detune: cfg.oscillator.detune } })
```
Tone.js에서 `PolySynth.set()`은 각 보이스에 옵션을 전파한다. Synth/FMSynth/AMSynth 모두 `oscillator: { type, detune }` 옵션을 가지므로 세 엔진 모두 동작한다.

**LFO 배선(노드 체인 연결 후):**

노드 체인(poly → [filter] → [effects] → destination) 구성 후, `cfg.lfo`에 따라 분기:

| target | 연결 대상 | min/max 계산 | 조건 |
|---|---|---|---|
| `'filter'` | `filterNode.frequency` (Signal) | `baseFreq × (1−depth)` .. `baseFreq × (1+depth)` (클램프 20..20000 Hz) | filterNode가 null이면 no-op |
| `'pitch'` | `poly.detune` (Signal\<'cents'\>) | `−depth × 1200` .. `+depth × 1200` (최대 ±1 옥타브) | 항상 적용 |
| `'amplitude'` | `ampGainNode.gain` (Param\<'gain'\>) | `1 − depth` .. `1` | ampGainNode를 nodes 배열에 추가해 체인 삽입 후 LFO 연결 |

amplitude 타겟은 노드 체인 구성 전에 `Tone.Gain(1)` 노드를 nodes 배열에 먼저 push해야 체인 연결에 포함된다. LFO는 `Tone.LFO({ frequency: rate, min, max }).start()`로 생성.

`dispose()`: `lfoInstance?.dispose()` 호출 + 기존 `poly.dispose()` + `nodes` 루프(ampGainNode 포함됨).

### SoundDesignPanel UI 추가

patch 모드에서 두 섹션 추가:

**Oscillator 섹션 (Engine 바로 아래):**
- 파형 선택: `<select aria-label="Oscillator type">` 4개 옵션(sine/square/sawtooth/triangle), `sound.oscillator?.type ?? 'sine'`
- Detune 슬라이더: `<input type="range" aria-label="Oscillator detune" min={-1200} max={1200} step={1}>`, `sound.oscillator?.detune ?? 0`

**LFO 섹션 (Filter 섹션 다음):**
- Enable 체크박스: `<input type="checkbox" aria-label="LFO enable" checked={!!sound.lfo}>`
  - checked → `updatePatch({ lfo: { target:'filter', rate:1, depth:0.5 } })`
  - unchecked → `updatePatch({ lfo: undefined })`
- lfo 있을 때만 표시:
  - `<select aria-label="LFO target">` (filter/pitch/amplitude 3옵션)
  - `<input type="range" aria-label="LFO rate" min={0.1} max={20} step={0.1}>`
  - `<input type="range" aria-label="LFO depth" min={0} max={1} step={0.01}>`

`updatePatch`는 기존 sound-design 계획의 헬퍼 그대로 사용. 디자인 토큰(CSS 변수) 준수.

### useAudio 캐시 무효화 — 변경 불필요

`useAudio.ts`의 캐시 키는 이미 `patch:${JSON.stringify(sound)}`이다. oscillator/lfo 필드 변경 시 JSON이 달라지므로 자동 무효화→dispose→재생성. **useAudio.ts 수정 불필요.**

### 기존 테스트 보존 전략

| 파일 | 영향 | 보존 방법 |
|---|---|---|
| `patch-schema.test.ts` (16개) | `SoundSchema.safeParse` — oscillator/lfo 옵셔널이므로 기존 테스트 PASS | 변경 없음 |
| `patch-instrument.test.ts` (13개) | `patchToToneConfig` 테스트는 개별 필드 단언(toneClass/filter/effects만 체크) → 신규 oscillator/lfo 필드 추가되어도 PASS | 변경 없음 |
| `patchToToneConfig` 스모크 3개 | `poly.set({ oscillator })` 추가되나 mock `vi.fn()` 수용 → PASS | 변경 없음 |
| `serialize.test.ts` (3개) | zod optional 추가 = additive → PASS | 변경 없음 |
| `SoundDesignPanel.test.tsx` (12개+PatchLibrary스모크) | 섹션 추가는 비파괴 → 기존 테스트 PASS | 변경 없음, 새 describe 블록 추가 |
| `useAudio.test.ts` (12개) | useAudio.ts 미변경 → PASS | 변경 없음 |
| `TracksPanel.test.tsx`, `AppShell.test.tsx` 등 | 미수정 → PASS | 변경 없음 |

---

## File Structure

```
packages/score-model/src/
  schema.ts                              # MOD: OscillatorSchema, LFOSchema 추가 + patch 분기에 oscillator?, lfo? 추가
  factory.ts                             # 변경 없음 (createDefaultPatch = 최소 패치)

packages/score-model/test/
  oscillator-lfo-schema.test.ts          # NEW: 16개 (스키마 유효성 + createDefaultPatch + serialize 라운드트립)

packages/sound-engine/src/
  instrument.ts                          # MOD: OscillatorConfig, LFOConfig 타입 추가
                                         #      + PatchInput/TonePatchConfig에 oscillator/lfo 추가
                                         #      + patchToToneConfig 확장 (순수)
                                         #      + createInstrumentFromSound: oscillator 적용 + LFO 배선

packages/sound-engine/test/
  oscillator-lfo-instrument.test.ts      # NEW: 17개 (patchToToneConfig 12 + LFO 배선 스모크 5)

apps/web/src/
  sound/
    SoundDesignPanel.tsx                 # MOD: Oscillator 섹션 + LFO 섹션 추가 (patch 모드)
    test/
      SoundDesignPanel.test.tsx          # MOD: Oscillator/LFO 섹션 테스트 8개 추가 (새 describe 블록)
```

---

## Task 1: score-model — patch 스키마 oscillator/lfo 확장 (완전 TDD)

**Files:** Modify `packages/score-model/src/schema.ts`; Create `packages/score-model/test/oscillator-lfo-schema.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `packages/score-model/test/oscillator-lfo-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SoundSchema } from '../src/schema'
import { createDefaultPatch, createEmptyProject, createTrack } from '../src/factory'
import { addTrack, updateTrackSound } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'
import type { Sound } from '../src/schema'

// ── 공통 픽스처 ─────────────────────────────────────────────────

const BASE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 }

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: BASE_ENV,
}

const WITH_OSC: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: BASE_ENV,
  oscillator: { type: 'square', detune: 100 },
}

const WITH_LFO: Sound = {
  kind: 'patch',
  engine: 'am',
  envelope: BASE_ENV,
  lfo: { target: 'filter', rate: 2, depth: 0.5 },
}

const FULL_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: BASE_ENV,
  filter: { type: 'lowpass', frequency: 2000, Q: 1.5 },
  effects: [{ type: 'reverb', wet: 0.3, decay: 2.5 }],
  oscillator: { type: 'sawtooth', detune: -50 },
  lfo: { target: 'amplitude', rate: 5, depth: 0.8 },
}

// ── SoundSchema — 스키마 유효성 ─────────────────────────────────

describe('SoundSchema — oscillator/lfo 확장 유효성', () => {
  it('기존 patch(filter/effects 없음)는 oscillator/lfo 없이도 유효하다(하위호환)', () => {
    expect(SoundSchema.safeParse(BASE_PATCH).success).toBe(true)
  })

  it('oscillator(type/detune) 추가된 patch는 유효하다', () => {
    expect(SoundSchema.safeParse(WITH_OSC).success).toBe(true)
  })

  it('lfo(target/rate/depth) 추가된 patch는 유효하다', () => {
    expect(SoundSchema.safeParse(WITH_LFO).success).toBe(true)
  })

  it('oscillator + lfo + filter + effects 모두 있는 FULL_PATCH는 유효하다', () => {
    expect(SoundSchema.safeParse(FULL_PATCH).success).toBe(true)
  })

  it('oscillator.type이 triangle인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'triangle', detune: 0 },
    }).success).toBe(true)
  })

  it('oscillator.detune가 음수(-1200)인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'sine', detune: -1200 },
    }).success).toBe(true)
  })

  it('잘못된 oscillator.type("noise")은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, oscillator: { type: 'noise', detune: 0 },
    }).success).toBe(false)
  })

  it('lfo.target이 pitch인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'pitch', rate: 1, depth: 0.3 },
    }).success).toBe(true)
  })

  it('lfo.target이 amplitude인 patch는 유효하다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'amplitude', rate: 0.5, depth: 1 },
    }).success).toBe(true)
  })

  it('잘못된 lfo.target("volume")은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'volume', rate: 1, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.rate <= 0은 거부된다(z.number().positive())', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: 0, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.rate 음수는 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: -1, depth: 0.5 },
    }).success).toBe(false)
  })

  it('lfo.depth > 1은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'filter', rate: 1, depth: 1.5 },
    }).success).toBe(false)
  })

  it('lfo.depth < 0은 거부된다', () => {
    expect(SoundSchema.safeParse({
      ...BASE_PATCH, lfo: { target: 'pitch', rate: 1, depth: -0.1 },
    }).success).toBe(false)
  })
})

// ── createDefaultPatch — oscillator/lfo 기본값 ──────────────────

describe('createDefaultPatch — oscillator/lfo 미설정 확인', () => {
  it('반환값이 SoundSchema를 통과한다', () => {
    expect(SoundSchema.safeParse(createDefaultPatch()).success).toBe(true)
  })

  it('oscillator는 undefined이다(최소 패치 유지)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.oscillator).toBeUndefined()
    } else {
      throw new Error('expected patch')
    }
  })

  it('lfo는 undefined이다(최소 패치 유지)', () => {
    const p = createDefaultPatch()
    if (p.kind === 'patch') {
      expect(p.lfo).toBeUndefined()
    } else {
      throw new Error('expected patch')
    }
  })
})

// ── serialize 라운드트립 ────────────────────────────────────────

function makeProjectWithSound(sound: Sound) {
  const t = createTrack('Synth')
  const p = addTrack(createEmptyProject('Test'), t)
  return updateTrackSound(p, t.id, sound)
}

describe('oscillator/lfo — serialize 라운드트립', () => {
  it('oscillator 없는 기존 patch는 무손실 라운드트립(하위호환)', () => {
    const p = makeProjectWithSound(BASE_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(BASE_PATCH)
  })

  it('oscillator 있는 patch는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(WITH_OSC)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(WITH_OSC)
  })

  it('lfo 있는 patch는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(WITH_LFO)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(WITH_LFO)
  })

  it('FULL_PATCH(oscillator + lfo + filter + reverb)는 무손실 라운드트립', () => {
    const p = makeProjectWithSound(FULL_PATCH)
    expect(deserializeProject(serializeProject(p)).tracks[0]!.sound).toEqual(FULL_PATCH)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/score-model test -- oscillator-lfo-schema
```

Expected: FAIL — `SoundSchema`에 `oscillator`/`lfo` 필드가 없어 파싱 실패.

- [ ] **Step 3: schema.ts 수정**

`packages/score-model/src/schema.ts` — `OscillatorSchema` + `LFOSchema` 추가 후 patch 분기에 옵셔널 필드 삽입:

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

// 오실레이터 파형·detune (4종 기본 파형; detune 단위: cents)
const OscillatorSchema = z.object({
  type: z.enum(['sine', 'square', 'sawtooth', 'triangle']),
  detune: z.number(), // cents — 범위 미제한(UI가 -1200..1200 강제)
})

// LFO 모듈레이션 (타겟·rate(Hz)·depth(0..1))
const LFOSchema = z.object({
  target: z.enum(['filter', 'pitch', 'amplitude']),
  rate: z.number().positive(), // Hz, >0
  depth: z.number().min(0).max(1),
})

// 음색: preset(프리셋 참조) 또는 patch(커스텀 신스 패치).
// filter/effects/oscillator/lfo는 옵셔널(하위호환).
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
    oscillator: OscillatorSchema.optional(),
    lfo: LFOSchema.optional(),
  }),
])

export const NoteSchema = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127),
  start: z.number().nonnegative(),     // ticks (절대)
  duration: z.number().positive(),     // ticks
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

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/score-model test
```

Expected: oscillator-lfo-schema.test.ts **16개** PASS. 기존 patch-schema.test.ts 16개, serialize.test.ts 3개, operations.test.ts 7개 영향 없음. 전체 score-model 테스트 PASS.

---

## Task 2: sound-engine — patchToToneConfig 확장 (완전 TDD) + createInstrumentFromSound oscillator·LFO 배선 (스모크)

**Files:** Modify `packages/sound-engine/src/instrument.ts`; Create `packages/sound-engine/test/oscillator-lfo-instrument.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `packages/sound-engine/test/oscillator-lfo-instrument.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchToToneConfig, createInstrumentFromSound } from '../src/instrument'

// ── 픽스처 타입 ────────────────────────────────────────────────

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
  oscillator?: { type: 'sine' | 'square' | 'sawtooth' | 'triangle'; detune: number }
  lfo?: { target: 'filter' | 'pitch' | 'amplitude'; rate: number; depth: number }
}

function makePatch(overrides: Partial<Omit<PatchLike, 'kind'>> = {}): PatchLike {
  return { kind: 'patch', engine: 'synth', envelope: BASE_ENV, ...overrides }
}

// ── patchToToneConfig — oscillator/lfo 순수 매핑 (완전 TDD) ────

describe('patchToToneConfig — oscillator 매핑', () => {
  it('oscillator 없으면 기본값 { type:"sine", detune:0 } 반환', () => {
    expect(patchToToneConfig(makePatch()).oscillator).toEqual({ type: 'sine', detune: 0 })
  })

  it('oscillator.type이 square이면 square 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'square', detune: 0 } })).oscillator.type
    ).toBe('square')
  })

  it('oscillator.type이 sawtooth이면 sawtooth 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sawtooth', detune: 0 } })).oscillator.type
    ).toBe('sawtooth')
  })

  it('oscillator.type이 triangle이면 triangle 반환', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'triangle', detune: 0 } })).oscillator.type
    ).toBe('triangle')
  })

  it('oscillator.detune 양수(100 cents)가 그대로 전달된다', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sine', detune: 100 } })).oscillator.detune
    ).toBe(100)
  })

  it('oscillator.detune 음수(-50 cents)가 그대로 전달된다', () => {
    expect(
      patchToToneConfig(makePatch({ oscillator: { type: 'sine', detune: -50 } })).oscillator.detune
    ).toBe(-50)
  })
})

describe('patchToToneConfig — lfo 매핑', () => {
  it('lfo 없으면 lfo: null 반환', () => {
    expect(patchToToneConfig(makePatch()).lfo).toBeNull()
  })

  it('lfo.target="filter"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'filter', rate: 2, depth: 0.5 } }))
    expect(cfg.lfo?.target).toBe('filter')
  })

  it('lfo.target="pitch"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'pitch', rate: 1, depth: 0.3 } }))
    expect(cfg.lfo?.target).toBe('pitch')
  })

  it('lfo.target="amplitude"가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'amplitude', rate: 5, depth: 0.8 } }))
    expect(cfg.lfo?.target).toBe('amplitude')
  })

  it('lfo.rate와 depth가 그대로 전달된다', () => {
    const cfg = patchToToneConfig(makePatch({ lfo: { target: 'filter', rate: 3.5, depth: 0.7 } }))
    expect(cfg.lfo?.rate).toBe(3.5)
    expect(cfg.lfo?.depth).toBe(0.7)
  })

  it('기존 필드(toneClass/envelope/filter/effects)는 oscillator/lfo 추가 후에도 정상 매핑', () => {
    const patch = makePatch({
      engine: 'fm',
      filter: { type: 'lowpass', frequency: 2000, Q: 1 },
      effects: [{ type: 'reverb', wet: 0.3, decay: 2 }],
      oscillator: { type: 'sawtooth', detune: -100 },
      lfo: { target: 'amplitude', rate: 4, depth: 0.6 },
    })
    const cfg = patchToToneConfig(patch)
    expect(cfg.toneClass).toBe('FMSynth')
    expect(cfg.envelope).toEqual(BASE_ENV)
    expect(cfg.filter).toEqual({ type: 'lowpass', frequency: 2000, Q: 1 })
    expect(cfg.effects).toHaveLength(1)
    expect(cfg.oscillator).toEqual({ type: 'sawtooth', detune: -100 })
    expect(cfg.lfo).toEqual({ target: 'amplitude', rate: 4, depth: 0.6 })
  })
})

// ── createInstrumentFromSound — oscillator/LFO 스모크 (Tone mock) ─

// Mock 정의
const mockPolyInstance = {
  set: vi.fn(),
  connect: vi.fn(),
  toDestination: vi.fn().mockReturnThis(),
  volume: { value: 0 },
  detune: { value: 0 }, // Signal<'cents'> — LFO pitch target용
  triggerAttackRelease: vi.fn(),
  dispose: vi.fn(),
}
const MockPolySynth = vi.fn().mockReturnValue(mockPolyInstance)

const mockFilterInstance = {
  Q: { value: 0 },
  frequency: { value: 2000 }, // Signal<'frequency'> — LFO filter target용
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

const mockLFOInstance = {
  connect: vi.fn().mockReturnThis(),
  start: vi.fn().mockReturnThis(),
  dispose: vi.fn(),
  frequency: { value: 0 },
}
const MockLFO = vi.fn().mockReturnValue(mockLFOInstance)

const mockGainInstance = {
  gain: { value: 1 }, // Param<'gain'> — LFO amplitude target용
  connect: vi.fn(),
  toDestination: vi.fn(),
  dispose: vi.fn(),
}
const MockGain = vi.fn().mockReturnValue(mockGainInstance)

vi.mock('tone', () => ({
  PolySynth: MockPolySynth,
  Synth: vi.fn(),
  AMSynth: vi.fn(),
  FMSynth: vi.fn(),
  Filter: MockFilter,
  Reverb: MockReverb,
  FeedbackDelay: MockFeedbackDelay,
  LFO: MockLFO,
  Gain: MockGain,
}))

describe('createInstrumentFromSound — oscillator/LFO 스모크 (Tone mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPolyInstance.toDestination.mockReturnThis()
    mockLFOInstance.connect.mockReturnThis()
    mockLFOInstance.start.mockReturnThis()
  })

  it('oscillator 설정 시 poly.set이 oscillator.type과 detune을 포함해 호출된다', () => {
    const patch = makePatch({ oscillator: { type: 'square', detune: 100 } })
    createInstrumentFromSound(patch)
    // poly.set이 oscillator 정보로 호출됐는지 확인
    const calls = mockPolyInstance.set.mock.calls
    const oscCall = calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'object' &&
        args[0] !== null &&
        'oscillator' in (args[0] as object),
    )
    expect(oscCall).toBeDefined()
    const oscArg = (oscCall![0] as { oscillator: { type: string; detune: number } }).oscillator
    expect(oscArg.type).toBe('square')
    expect(oscArg.detune).toBe(100)
  })

  it('lfo target="pitch" 시 Tone.LFO가 생성되고 poly.detune에 connect+start된다', () => {
    const patch = makePatch({ lfo: { target: 'pitch', rate: 2, depth: 0.5 } })
    createInstrumentFromSound(patch)
    expect(MockLFO).toHaveBeenCalled()
    expect(mockLFOInstance.connect).toHaveBeenCalledWith(mockPolyInstance.detune)
    expect(mockLFOInstance.start).toHaveBeenCalled()
  })

  it('lfo target="filter" + filter 있을 때 LFO가 filterNode.frequency에 connect된다', () => {
    const patch = makePatch({
      filter: { type: 'lowpass', frequency: 2000, Q: 1 },
      lfo: { target: 'filter', rate: 1, depth: 0.5 },
    })
    createInstrumentFromSound(patch)
    expect(MockLFO).toHaveBeenCalled()
    expect(mockLFOInstance.connect).toHaveBeenCalledWith(mockFilterInstance.frequency)
    expect(mockLFOInstance.start).toHaveBeenCalled()
  })

  it('lfo target="amplitude" 시 Tone.Gain이 생성되고 LFO가 gainNode.gain에 connect된다', () => {
    const patch = makePatch({ lfo: { target: 'amplitude', rate: 3, depth: 0.7 } })
    createInstrumentFromSound(patch)
    expect(MockGain).toHaveBeenCalled()
    expect(MockLFO).toHaveBeenCalled()
    expect(mockLFOInstance.connect).toHaveBeenCalledWith(mockGainInstance.gain)
    expect(mockLFOInstance.start).toHaveBeenCalled()
  })

  it('dispose() 호출 시 LFO도 dispose된다', () => {
    const patch = makePatch({ lfo: { target: 'pitch', rate: 1, depth: 0.3 } })
    const inst = createInstrumentFromSound(patch)
    inst.dispose()
    expect(mockLFOInstance.dispose).toHaveBeenCalled()
    expect(mockPolyInstance.dispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/sound-engine test -- oscillator-lfo-instrument
```

Expected: FAIL — `patchToToneConfig`가 `oscillator`/`lfo` 필드를 반환하지 않고, `createInstrumentFromSound`에 LFO 배선 코드 없음.

- [ ] **Step 3: instrument.ts 수정**

`packages/sound-engine/src/instrument.ts` — 아래와 같이 교체:

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

// ── patch 지원 타입 ────────────────────────────────────────────
// score-model에 의존하지 않음(구조적 타이핑으로 Sound patch 변형과 호환).

export interface FilterConfig {
  type: 'lowpass' | 'highpass' | 'bandpass'
  frequency: number
  Q: number
}

export interface ReverbConfig { type: 'reverb'; wet: number; decay: number }
export interface DelayConfig  { type: 'delay'; wet: number; time: number; feedback: number }
export type EffectConfig = ReverbConfig | DelayConfig

/** 오실레이터 파형 설정. type: 기본 파형 4종. detune: 정적 cents 오프셋. */
export interface OscillatorConfig {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle'
  detune: number // cents
}

/**
 * LFO 모듈레이션 설정.
 * - target: 변조 대상 파라미터.
 * - rate: Hz(>0).
 * - depth: 0..1 정규화 깊이(target별 범위 계산은 createInstrumentFromSound에서 수행).
 */
export interface LFOConfig {
  target: 'filter' | 'pitch' | 'amplitude'
  rate: number   // Hz
  depth: number  // 0..1
}

export interface PatchInput {
  engine: 'synth' | 'fm' | 'am'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter?: FilterConfig
  effects?: EffectConfig[]
  oscillator?: OscillatorConfig
  lfo?: LFOConfig
}

export interface TonePatchConfig {
  toneClass: 'Synth' | 'AMSynth' | 'FMSynth'
  envelope: { attack: number; decay: number; sustain: number; release: number }
  filter: FilterConfig | null
  effects: EffectConfig[]
  /** 항상 정의됨. 미설정 시 기본값 { type:'sine', detune:0 }. */
  oscillator: OscillatorConfig
  /** 미설정 시 null. */
  lfo: LFOConfig | null
}

export interface PatchInstrument {
  triggerAttackRelease: (note: string, duration: number, time?: number, velocity?: number) => void
  volume: { value: number }
  dispose: () => void
}

export type SoundInput =
  | { kind: 'preset'; presetId: string }
  | ({ kind: 'patch' } & PatchInput)

// ── patchToToneConfig (순수 — Tone 의존 없음) ──────────────────

const ENGINE_TO_TONE: Record<PatchInput['engine'], TonePatchConfig['toneClass']> = {
  synth: 'Synth',
  fm: 'FMSynth',
  am: 'AMSynth',
}

const DEFAULT_OSCILLATOR: OscillatorConfig = { type: 'sine', detune: 0 }

/**
 * patch 데이터 → Tone 설정 객체로 변환한다 (순수 함수, Tone 의존 없음).
 * - oscillator 미설정 → 기본값 { type:'sine', detune:0 }.
 * - lfo 미설정 → null.
 * - filter 미설정 → null.
 * - effects 미설정 → 빈 배열.
 */
export function patchToToneConfig(patch: PatchInput): TonePatchConfig {
  return {
    toneClass: ENGINE_TO_TONE[patch.engine],
    envelope: { ...patch.envelope },
    filter: patch.filter ? { ...patch.filter } : null,
    effects: (patch.effects ?? []).map((fx) => ({ ...fx })),
    oscillator: patch.oscillator ? { ...patch.oscillator } : { ...DEFAULT_OSCILLATOR },
    lfo: patch.lfo ? { ...patch.lfo } : null,
  }
}

// ── createInstrumentFromSound (Tone 체인 구성) ─────────────────

/**
 * sound 종류에 따라 Tone 악기를 생성한다.
 * - preset → 기존 createInstrument 경로.
 * - patch  → PolySynth + oscillator 설정 + [Filter] + [Effects] + [Gain(amplitude)] → destination.
 *            LFO 있으면 체인 구성 후 타겟에 배선.
 *
 * LFO depth → 오디오 범위 매핑:
 *   filter  : baseFreq × (1−depth) .. baseFreq × (1+depth), 클램프 20..20000 Hz
 *   pitch   : −depth×1200 .. +depth×1200 cents (최대 ±1 옥타브)
 *   amplitude: (1−depth) .. 1 gain
 *
 * dispose()는 lfoInstance, poly, 모든 node를 정리한다.
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

  // ── patch 경로 ──────────────────────────────────────────────

  const cfg = patchToToneConfig(sound)
  const classMap = {
    Synth: Tone.Synth,
    AMSynth: Tone.AMSynth,
    FMSynth: Tone.FMSynth,
  } as const

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = new Tone.PolySynth(classMap[cfg.toneClass] as any)
  poly.set({ envelope: cfg.envelope })

  // 오실레이터 파형 + detune 적용 (voice 레벨 전파)
  poly.set({ oscillator: { type: cfg.oscillator.type, detune: cfg.oscillator.detune } })

  // ── 노드 배열 구성 (체인 연결 전) ──────────────────────────

  const nodes: Tone.ToneAudioNode[] = []
  let filterNode: Tone.Filter | null = null

  // Filter
  if (cfg.filter) {
    filterNode = new Tone.Filter(cfg.filter.frequency, cfg.filter.type)
    filterNode.Q.value = cfg.filter.Q
    nodes.push(filterNode)
  }

  // Effects
  for (const fx of cfg.effects) {
    if (fx.type === 'reverb') {
      const r = new Tone.Reverb(Math.max(fx.decay, 0.001))
      r.wet.value = fx.wet
      nodes.push(r)
    } else if (fx.type === 'delay') {
      const d = new Tone.FeedbackDelay(fx.time, fx.feedback)
      d.wet.value = fx.wet
      nodes.push(d)
    }
  }

  // Amplitude LFO용 Gain 노드 — 체인 연결 전에 nodes에 추가해야 toDestination()에 포함됨
  let ampGainNode: Tone.Gain | null = null
  if (cfg.lfo?.target === 'amplitude') {
    ampGainNode = new Tone.Gain(1)
    nodes.push(ampGainNode)
  }

  // ── 체인 연결 ───────────────────────────────────────────────

  if (nodes.length > 0) {
    poly.connect(nodes[0]!)
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i]!.connect(nodes[i + 1]!)
    }
    nodes[nodes.length - 1]!.toDestination()
  } else {
    poly.toDestination()
  }

  // ── LFO 배선 (체인 연결 후) ─────────────────────────────────

  let lfoInstance: Tone.LFO | null = null

  if (cfg.lfo) {
    const { target, rate, depth } = cfg.lfo

    if (target === 'filter' && filterNode) {
      // filterNode.frequency에 LFO 연결 (filter가 있을 때만)
      const baseFreq = cfg.filter?.frequency ?? 2000
      const minFreq = Math.max(20, baseFreq * (1 - depth))
      const maxFreq = Math.min(20000, baseFreq * (1 + depth))
      lfoInstance = new Tone.LFO({ frequency: rate, min: minFreq, max: maxFreq })
      lfoInstance.connect(filterNode.frequency)
      lfoInstance.start()
    } else if (target === 'pitch') {
      // poly.detune Signal에 LFO 연결 (항상 적용)
      const maxCents = depth * 1200
      lfoInstance = new Tone.LFO({ frequency: rate, min: -maxCents, max: maxCents })
      lfoInstance.connect(poly.detune)
      lfoInstance.start()
    } else if (target === 'amplitude' && ampGainNode) {
      // ampGainNode.gain Param에 LFO 연결
      const minGain = Math.max(0, 1 - depth)
      lfoInstance = new Tone.LFO({ frequency: rate, min: minGain, max: 1 })
      lfoInstance.connect(ampGainNode.gain)
      lfoInstance.start()
    }
    // target='filter' + filterNode===null → no-op (LFO 생성하지 않음)
  }

  // ── PatchInstrument 반환 ─────────────────────────────────────

  return {
    triggerAttackRelease(note, duration, time, velocity) {
      poly.triggerAttackRelease(note, duration, time, velocity)
    },
    volume: poly.volume as unknown as { value: number },
    dispose() {
      lfoInstance?.dispose()
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

Expected:
- oscillator-lfo-instrument.test.ts **17개** PASS (patchToToneConfig 12개 + 스모크 5개)
- 기존 patch-instrument.test.ts **13개** PASS (기존 단언이 개별 필드 체크 → 신규 oscillator/lfo 필드 무관)
- 기존 instrument.test.ts(descriptorToToneSpec 등) **3개** PASS
- 전체 sound-engine 테스트 PASS

---

## Task 3: apps/web — SoundDesignPanel Oscillator + LFO 섹션 추가

**Files:** Modify `apps/web/src/sound/SoundDesignPanel.tsx`, `apps/web/src/sound/test/SoundDesignPanel.test.tsx`

- [ ] **Step 1: SoundDesignPanel.test.tsx에 Oscillator/LFO 테스트 추가**

`apps/web/src/sound/test/SoundDesignPanel.test.tsx` 파일 끝(기존 `})` 닫기 전)에 새 describe 블록 추가:

```tsx
describe('SoundDesignPanel — Oscillator 섹션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  function openPatchPanel() {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }))
    s.setSoundPanelTrackId(trackId)
  }

  it('patch 모드에서 Oscillator type 드롭다운이 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /oscillator type/i })).toBeInTheDocument()
  })

  it('Oscillator type 변경 시 sound.oscillator.type이 갱신된다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /oscillator type/i }),
      'square',
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(
      updated.sound.kind === 'patch' && updated.sound.oscillator?.type
    ).toBe('square')
  })

  it('patch 모드에서 Oscillator Detune 슬라이더가 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('slider', { name: /oscillator detune/i })).toBeInTheDocument()
  })

  it('Detune 슬라이더 변경 시 sound.oscillator.detune이 갱신된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    fireEvent.change(
      screen.getByRole('slider', { name: /oscillator detune/i }),
      { target: { value: '200' } },
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(
      updated.sound.kind === 'patch' && updated.sound.oscillator?.detune
    ).toBe(200)
  })
})

describe('SoundDesignPanel — LFO 섹션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  function openPatchPanel() {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
    }))
    s.setSoundPanelTrackId(trackId)
  }

  it('patch 모드에서 LFO Enable 체크박스가 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('checkbox', { name: /lfo enable/i })).toBeInTheDocument()
  })

  it('LFO Enable 체크박스 활성화 시 target·rate·depth 컨트롤이 나타난다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    expect(screen.getByRole('combobox', { name: /lfo target/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /lfo rate/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /lfo depth/i })).toBeInTheDocument()
  })

  it('LFO Enable 체크박스 활성화 시 sound.lfo가 기본값으로 설정된다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo).toBeDefined()
  })

  it('LFO rate 슬라이더 변경 시 sound.lfo.rate가 갱신된다', async () => {
    openPatchPanel()
    const s = useStore.getState()
    // LFO 있는 patch로 설정
    s.setProject(updateTrackSound(s.project, s.selectedTrackId, {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
      lfo: { target: 'filter', rate: 1, depth: 0.5 },
    }))
    render(<SoundDesignPanel />)
    fireEvent.change(
      screen.getByRole('slider', { name: /lfo rate/i }),
      { target: { value: '5' } },
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo?.rate).toBe(5)
  })

  it('LFO Enable 체크박스 비활성화 시 sound.lfo가 undefined가 된다', async () => {
    openPatchPanel()
    const s = useStore.getState()
    s.setProject(updateTrackSound(s.project, s.selectedTrackId, {
      kind: 'patch' as const,
      engine: 'synth' as const,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
      lfo: { target: 'pitch', rate: 2, depth: 0.3 },
    }))
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: FAIL — Oscillator type 드롭다운, Detune 슬라이더, LFO Enable 체크박스가 없어 역할 쿼리 실패.

- [ ] **Step 3: SoundDesignPanel.tsx 수정**

`apps/web/src/sound/SoundDesignPanel.tsx`의 patch 모드 섹션에 Oscillator 섹션(Engine 다음)과 LFO 섹션(Filter 섹션 다음)을 추가한다:

```tsx
// ─ patch 모드 내 Engine 섹션 다음에 삽입 ─

{/* Oscillator */}
<section>
  <p style={{ ...labelStyle, margin: '0 0 10px' }}>Oscillator</p>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={labelStyle}>Waveform</label>
      <select
        aria-label="Oscillator type"
        value={sound.oscillator?.type ?? 'sine'}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          updatePatch({
            oscillator: {
              type: e.target.value as 'sine' | 'square' | 'sawtooth' | 'triangle',
              detune: sound.oscillator?.detune ?? 0,
            },
          })
        }
        style={selectStyle}
      >
        <option value="sine">Sine</option>
        <option value="square">Square</option>
        <option value="sawtooth">Sawtooth</option>
        <option value="triangle">Triangle</option>
      </select>
    </div>
    <div style={sliderRowStyle}>
      <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
        Detune
      </label>
      <input
        type="range"
        aria-label="Oscillator detune"
        min={-1200}
        max={1200}
        step={1}
        value={sound.oscillator?.detune ?? 0}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          updatePatch({
            oscillator: {
              type: sound.oscillator?.type ?? 'sine',
              detune: Number(e.target.value),
            },
          })
        }
        style={{ flex: 1, accentColor: 'var(--accent)' }}
      />
      <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
        {(sound.oscillator?.detune ?? 0) > 0
          ? `+${sound.oscillator?.detune ?? 0}¢`
          : `${sound.oscillator?.detune ?? 0}¢`}
      </span>
    </div>
  </div>
</section>
```

```tsx
// ─ patch 모드 내 Filter 섹션 다음에 삽입 ─

{/* LFO */}
<section>
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
    <p style={{ ...labelStyle, margin: 0, flex: 1 }}>LFO</p>
    <input
      type="checkbox"
      aria-label="LFO enable"
      checked={!!sound.lfo}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        updatePatch({
          lfo: e.target.checked
            ? { target: 'filter', rate: 1, depth: 0.5 }
            : undefined,
        })
      }
    />
  </div>
  {sound.lfo && (() => {
    const lfo = sound.lfo
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <select
          aria-label="LFO target"
          value={lfo.target}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            updatePatch({ lfo: { ...lfo, target: e.target.value as 'filter' | 'pitch' | 'amplitude' } })
          }
          style={selectStyle}
        >
          <option value="filter">Filter Cutoff</option>
          <option value="pitch">Pitch (Vibrato)</option>
          <option value="amplitude">Amplitude (Tremolo)</option>
        </select>

        {/* Rate */}
        <div style={sliderRowStyle}>
          <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
            Rate
          </label>
          <input
            type="range"
            aria-label="LFO rate"
            min={0.1}
            max={20}
            step={0.1}
            value={lfo.rate}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePatch({ lfo: { ...lfo, rate: Math.max(0.1, Number(e.target.value)) } })
            }
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />
          <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
            {lfo.rate.toFixed(1)}Hz
          </span>
        </div>

        {/* Depth */}
        <div style={sliderRowStyle}>
          <label style={{ width: 52, fontSize: 11, color: 'var(--text-lo)', flexShrink: 0 }}>
            Depth
          </label>
          <input
            type="range"
            aria-label="LFO depth"
            min={0}
            max={1}
            step={0.01}
            value={lfo.depth}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePatch({ lfo: { ...lfo, depth: Number(e.target.value) } })
            }
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />
          <span style={{ width: 44, fontSize: 10, color: 'var(--text-lo)', textAlign: 'right', flexShrink: 0 }}>
            {Math.round(lfo.depth * 100)}%
          </span>
        </div>
      </div>
    )
  })()}
</section>
```

완전한 `SoundDesignPanel.tsx` 파일에서의 배치 순서:

```
헤더 (트랙명 + 닫기)
├─ [preset 모드] Sound preset 드롭다운 + Switch to Patch 버튼
└─ [patch 모드]
    ├─ Engine 섹션 (synth/fm/am)
    ├─ Oscillator 섹션 ← 신규 추가 (파형 선택 + detune 슬라이더)
    ├─ Envelope 섹션 (ADSR 슬라이더 4개)
    ├─ Filter 섹션 (체크박스 + type/frequency/Q)
    ├─ LFO 섹션 ← 신규 추가 (enable체크 + target/rate/depth)
    ├─ Reverb 섹션 (체크박스 + wet/decay)
    ├─ Use Preset Instead 버튼
    └─ PatchLibrary (기존)
Preview ▶ 버튼 (하단 고정)
```

> **React namespace 주의:** `React.` 네임스페이스 직접 사용 금지. `import type { CSSProperties, ChangeEvent } from 'react'` 형태로 개별 타입만 import한다. 기존 파일이 이미 이 패턴을 따르고 있으므로 그대로 유지한다.

> **PatchLibrary 모킹:** 기존 `SoundDesignPanel.test.tsx`에 이미 `vi.mock('../PatchLibrary', ...)` 가 설정되어 있다. 신규 테스트 블록도 동일 mock을 재사용하므로 추가 설정 불필요.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: 기존 12개(+PatchLibrary 스모크) + 신규 Oscillator 4개 + 신규 LFO 4개 = 모두 PASS.

---

## Task 4: 최종 게이트

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected 추가 테스트 수:
- score-model: oscillator-lfo-schema.test.ts **16개** 추가
- sound-engine: oscillator-lfo-instrument.test.ts **17개** 추가
- web/SoundDesignPanel: Oscillator **4개** + LFO **4개** = **8개** 추가

> **기존 389개 테스트 보존 체크:**
> - `patch-schema.test.ts` 16개: `SoundSchema` 확장은 additive(optional 추가) → PASS
> - `serialize.test.ts` 3개: zod optional 필드 부재 시 그대로 복원 → PASS
> - `operations.test.ts` 7개: `updateTrackSound` 시그니처 불변 → PASS
> - `patch-instrument.test.ts` 13개: `patchToToneConfig` 단언이 개별 필드 체크, 기존 스모크 mock에 `set()`·`toDestination()` 이미 있음 → PASS
> - `instrument.test.ts` 3개(descriptorToToneSpec): 함수 서명 불변 → PASS
> - `useAudio.test.ts` 12개: `useAudio.ts` 미수정, 캐시 키 `JSON.stringify(sound)` 자동 처리 → PASS
> - `SoundDesignPanel.test.tsx` 기존 12개+: 섹션 추가는 비파괴, PatchLibrary mock 유지 → PASS
> - `TracksPanel.test.tsx`, `AppShell.test.tsx` 등: 미수정 → PASS

- [ ] **Step 2: 타입 체크**

```bash
pnpm --filter @sculptone/score-model exec tsc --noEmit
pnpm --filter @sculptone/sound-engine exec tsc --noEmit
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음.

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과 (기존 389개 보존 + 신규 ≈41개 추가).
- 기존 `{ kind:'patch', engine, envelope, filter?, effects? }` 객체가 `SoundSchema`를 통과하고 직렬화 라운드트립이 무손실임을 자동 테스트로 검증.
- `oscillator`/`lfo` 있는 patch가 `SoundSchema.safeParse`를 통과하고 직렬화 라운드트립도 무손실임을 자동 테스트로 검증.
- `patchToToneConfig` 순수 매핑: oscillator 기본값 `{ type:'sine', detune:0 }` 반환, lfo null 처리 — 12개 테스트로 완전 검증.
- `createInstrumentFromSound`: oscillator 설정이 `poly.set({ oscillator: { type, detune } })`를 통해 전파됨. LFO target별(filter/pitch/amplitude) connect+start 호출 — 5개 스모크로 검증.
- `SoundDesignPanel`: Oscillator 섹션(파형 선택 + detune 슬라이더), LFO 섹션(enable/target/rate/depth)이 patch 모드에서 렌더되며 `updatePatch`를 통해 스토어에 반영 — 8개 테스트로 검증.
- LFO target='filter' + filter 미설정 시 LFO 생성 no-op (크래시 없음, 테스트 5번이 간접 검증).
- useAudio.ts 변경 없음 — 기존 캐시 키 `patch:${JSON.stringify(sound)}`가 oscillator/lfo 변경도 자동 감지.
- 하드코딩 hex/px 없음 — 모든 색상은 CSS 변수(`var(--accent)`, `var(--text-lo)` 등) 사용.
- React 네임스페이스 직접 사용 없음(`React.FC`, `React.ChangeEvent` 등) — `import type { ChangeEvent } from 'react'` 개별 import 패턴 유지.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 증분 (이 계획 완료 후 별도 작성)

- **Delay LFO 타겟:** `delay.time` / `delay.feedback`을 LFO 변조 타겟으로 추가. LFOConfig.target에 `'delay-time'|'delay-feedback'` 추가.
- **비주얼 LFO 디스플레이:** Canvas API 또는 SVG로 LFO 파형 실시간 시각화.
- **비주얼 ADSR 그래프:** SVG envelope 곡선 에디터.
- **재생 중 실시간 패치 파라미터 업데이트:** play 중 oscillator type/detune, LFO rate/depth 변경 시 Tone Signal 직접 업데이트(디바운스 필요).
- **오실레이터 유니즌/보이스 수:** Tone.js PolySynth voices 조정 UI.
- **모듈레이션 매트릭스 심화:** 복수 LFO, 엔벨로프 팔로워, 임의 타겟 매핑.
- **LFO Sync:** 템포 동기화 LFO rate(예: "1/4" = BPM/4 Hz).
- **Tone.Reverb pregeneration 최적화:** IR 비동기 생성 대기 전략(`reverb.ready`).

---

## 열린 질문

1. **LFO depth → filter 주파수 범위 정밀도:** 현재 `baseFreq × (1 ± depth)` 선형 스케일. 사람의 청각은 주파수를 로그로 인식하므로 로그 스케일 범위(`baseFreq * 2^(depth * octaves)`)가 더 자연스러울 수 있다. 다음 증분에서 사용자 피드백 후 결정.

2. **LFO target='filter' + filter 미설정:** 현재 구현에서 filter 없으면 LFO no-op. 대안으로 자동으로 기본 filter를 생성하고 LFO를 연결할 수 있다. 현재는 단순성을 위해 no-op 채택.

3. **poly.detune vs. oscillator.detune 의미 분리:** `oscillator.detune`(patch 필드)은 정적 오프셋으로 `poly.set({ oscillator: { detune } })`을 통해 각 보이스의 오실레이터 레벨 detune에 적용. LFO pitch 타겟은 `poly.detune`(PolySynth 글로벌 Signal)에 연결 — 이는 전체 악기의 피치를 변조(vibrato 효과). 두 메커니즘이 독립적으로 작동하므로 정적 detune + LFO 피치 변조를 동시에 적용 가능. 이 분리가 사용자에게 혼란스러울 경우 UI 레이블링을 재검토할 필요 있음.

4. **FMSynth/AMSynth oscillator 설정 호환성:** `poly.set({ oscillator: { type, detune } })`가 FMSynth/AMSynth의 carrier oscillator에만 적용됨. modulator는 별도. 현재 modulator 파형 편집은 비목표. FMSynth 모듈레이터 편집은 추후 별도 섹션으로 추가.

5. **Tone.LFO 생성자 인터페이스:** Tone.js v15에서 `new Tone.LFO({ frequency, min, max })` 객체 형식과 `new Tone.LFO(frequency, min, max)` positional 형식 모두 지원. 계획서에서는 객체 형식 사용(명시적). 실제 구현 시 Tone.js 타입 정의를 확인해 필요하면 positional 형식으로 변경.

6. **ampGainNode dispose 이중 dispose 가능성:** `ampGainNode`는 `nodes` 배열에 포함되므로 `dispose()` 루프에서 정리됨. `lfoInstance?.dispose()`는 별도. 이중 dispose 없음.

7. **SoundDesignPanel 실시간 미리듣기:** LFO depth/rate 슬라이더를 드래그할 때마다 소리가 실시간으로 변하길 기대할 수 있다. 현재는 슬라이더 변경이 스토어 상태만 업데이트하고, 다음 play() 시 새 instrument를 생성. 실시간 업데이트는 "재생 중 실시간 패치 파라미터 업데이트" 다음 증분에서 구현.
