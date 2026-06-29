# Sculptone P0 기반 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pnpm 모노레포를 세우고, 시간 기반(PPQ) 정본 데이터 모델(`score-model`)을 TDD로 완성하며, 사운드 엔진 골격(`sound-engine`)과 디자인 시스템이 적용된 React 앱 셸(3-모드 탭)을 구축한다.

**Architecture:** 순수 TS 패키지 `score-model`(zod 스키마 = 타입 = 런타임 검증 = 미래 ML 라벨 포맷)과 `sound-engine`(프리셋 카탈로그, React 비의존)을 `apps/web`(React+Vite)이 소비한다. 앱 셸은 Design Guide v0.2 토큰을 CSS 변수로 구현하고 Zustand로 모드/프로젝트 상태를 관리한다.

**Tech Stack:** pnpm workspaces · TypeScript · Vite(React-TS) · Vitest · @testing-library/react · zod · Zustand

> **커밋 규칙:** 이 저장소는 사용자 전역 규칙에 따라 **커밋을 사용자가 직접 수행**한다. 계획의 `✋ 커밋 체크포인트`는 논리적 커밋 지점을 표시할 뿐, 실행 에이전트는 커밋하지 말고 **사용자에게 커밋을 요청**하고 대기한다. (저장소가 아직 git이 아니므로 Task 1에서 `git init` 한 번 수행.)

> **참조 문서:** 설계 스펙 `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`, 디자인 가이드 `documents/sculptone-design-guide.html`.

---

## File Structure

```
sculptone/
  package.json                      # 루트 워크스페이스 + 공용 스크립트
  pnpm-workspace.yaml               # 워크스페이스 글롭
  tsconfig.base.json                # 공용 컴파일러 옵션
  .gitignore
  packages/
    score-model/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        schema.ts                   # zod 스키마 + infer 타입 (정본 모델)
        factory.ts                  # createEmptyProject/createTrack/createNote
        operations.ts               # 불변 편집 연산 (note/track)
        serialize.ts                # JSON 직렬화/역직렬화(+검증) 라운드트립
        index.ts                    # 공개 API 배럴
      test/
        factory.test.ts
        operations.test.ts
        serialize.test.ts
    sound-engine/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        types.ts                    # 엔진 인터페이스 타입
        presets.ts                  # 내장 프리셋 카탈로그(순수 데이터)
        index.ts
      test/
        presets.test.ts
  apps/
    web/
      package.json
      tsconfig.json
      vite.config.ts
      vitest.config.ts
      index.html
      src/
        main.tsx
        App.tsx                     # 셸 조립 + 모드 전환
        styles/
          tokens.css                # Design Guide 토큰(CSS 변수)
          global.css
        state/
          store.ts                  # Zustand: activeMode, project
        ui/
          Button.tsx
          Tabs.tsx
          Badge.tsx
        shell/
          AppShell.tsx              # chrome/toolbar/left/center/right/transport 영역
        test/
          setup.ts                  # testing-library jsdom 셋업
          Button.test.tsx
          Tabs.test.tsx
          store.test.ts
```

---

## Task 1: 모노레포 스캐폴딩 + 툴링

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`

- [ ] **Step 1: 저장소 초기화 및 pnpm 확인**

Run:
```bash
cd /d/source/Sculptone
git init
pnpm --version
```
Expected: git 저장소 생성 메시지, pnpm 버전 출력(없으면 `npm i -g pnpm` 후 재시도).

- [ ] **Step 2: 워크스페이스 글롭 작성**

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: 루트 package.json 작성**

Create `package.json`:
```json
{
  "name": "sculptone",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "dev": "pnpm --filter @sculptone/web dev"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: 공용 tsconfig 작성**

Create `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: .gitignore 작성**

Create `.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
coverage/
```

- [ ] **Step 6: 루트 의존성 설치**

Run:
```bash
pnpm install
```
Expected: 워크스페이스 인식, lockfile 생성(아직 패키지가 없어도 정상).

- [ ] **Step 7: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `chore: scaffold pnpm monorepo`
실행 에이전트는 변경 파일을 요약해 사용자에게 커밋을 요청하고 대기한다.

---

## Task 2: score-model — zod 스키마 + 타입

**Files:**
- Create: `packages/score-model/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/schema.ts`

- [ ] **Step 1: 패키지 매니페스트 작성**

Create `packages/score-model/package.json`:
```json
{
  "name": "@sculptone/score-model",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: 패키지 tsconfig 작성**

Create `packages/score-model/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vitest 설정 작성**

Create `packages/score-model/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: zod 스키마 + infer 타입 작성**

Create `packages/score-model/src/schema.ts`:
```ts
import { z } from 'zod'

// 음색: P1은 preset만 사용. patch 변형은 P2 forward-compat(스키마만 선반영).
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

- [ ] **Step 5: 의존성 설치 및 타입체크**

Run:
```bash
pnpm install
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```
Expected: 타입 에러 없음.

- [ ] **Step 6: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(score-model): define zod schema and inferred types`

---

## Task 3: score-model — 팩토리 함수

**Files:**
- Create: `packages/score-model/src/factory.ts`, `test/factory.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/score-model/test/factory.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ProjectSchema, TrackSchema, NoteSchema } from '../src/schema'
import { createEmptyProject, createTrack, createNote } from '../src/factory'

describe('factory', () => {
  it('createEmptyProject는 스키마에 맞는 빈 프로젝트를 만든다', () => {
    const p = createEmptyProject('My Song')
    expect(() => ProjectSchema.parse(p)).not.toThrow()
    expect(p.metadata.title).toBe('My Song')
    expect(p.transport.ppq).toBe(480)
    expect(p.transport.tempo).toBe(120)
    expect(p.tracks).toEqual([])
  })

  it('createTrack는 기본 믹서와 피아노 프리셋을 가진 트랙을 만든다', () => {
    const t = createTrack('Piano')
    expect(() => TrackSchema.parse(t)).not.toThrow()
    expect(t.name).toBe('Piano')
    expect(t.sound).toEqual({ kind: 'preset', presetId: 'acoustic-piano' })
    expect(t.mixer).toEqual({ volume: 0.8, pan: 0, muted: false, soloed: false })
    expect(t.notes).toEqual([])
  })

  it('createNote는 스키마에 맞는 노트를 만들고 고유 id를 부여한다', () => {
    const n1 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const n2 = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    expect(() => NoteSchema.parse(n1)).not.toThrow()
    expect(n1.id).not.toBe(n2.id)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: FAIL — `factory.ts`의 export를 찾지 못함.

- [ ] **Step 3: 최소 구현 작성**

Create `packages/score-model/src/factory.ts`:
```ts
import type { Project, Track, Note } from './schema'

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
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: PASS (3 tests).

- [ ] **Step 5: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(score-model): add factory functions`

---

## Task 4: score-model — 불변 노트/트랙 연산

**Files:**
- Create: `packages/score-model/src/operations.ts`, `test/operations.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/score-model/test/operations.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addTrack, addNote, updateNote, removeNote, updateTrackMixer } from '../src/operations'

describe('operations (immutable)', () => {
  it('addTrack는 새 배열을 반환하고 원본을 변경하지 않는다', () => {
    const p = createEmptyProject('S')
    const t = createTrack('Piano')
    const next = addTrack(p, t)
    expect(next.tracks).toHaveLength(1)
    expect(p.tracks).toHaveLength(0)
    expect(next).not.toBe(p)
  })

  it('addNote는 지정 트랙에만 노트를 추가한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const next = addNote(p, t.id, n)
    expect(next.tracks[0]!.notes).toHaveLength(1)
    expect(p.tracks[0]!.notes).toHaveLength(0)
  })

  it('updateNote는 매칭 노트의 필드를 병합한다', () => {
    const t = createTrack('Piano')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const p = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const next = updateNote(p, t.id, n.id, { velocity: 30 })
    expect(next.tracks[0]!.notes[0]!.velocity).toBe(30)
    expect(next.tracks[0]!.notes[0]!.pitch).toBe(60)
  })

  it('removeNote는 매칭 노트를 제거한다', () => {
    const t = createTrack('Piano')
    const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
    const p = addNote(addTrack(createEmptyProject('S'), t), t.id, n)
    const next = removeNote(p, t.id, n.id)
    expect(next.tracks[0]!.notes).toHaveLength(0)
  })

  it('updateTrackMixer는 믹서 값을 병합한다', () => {
    const t = createTrack('Piano')
    const p = addTrack(createEmptyProject('S'), t)
    const next = updateTrackMixer(p, t.id, { muted: true })
    expect(next.tracks[0]!.mixer.muted).toBe(true)
    expect(next.tracks[0]!.mixer.volume).toBe(0.8)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: FAIL — `operations.ts` 미존재.

- [ ] **Step 3: 최소 구현 작성**

Create `packages/score-model/src/operations.ts`:
```ts
import type { Project, Track, Note, Mixer } from './schema'

function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
  }
}

export function addTrack(p: Project, track: Track): Project {
  return { ...p, tracks: [...p.tracks, track] }
}

export function removeTrack(p: Project, trackId: string): Project {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }
}

export function addNote(p: Project, trackId: string, note: Note): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, notes: [...t.notes, note] }))
}

export function updateNote(
  p: Project,
  trackId: string,
  noteId: string,
  patch: Partial<Omit<Note, 'id'>>,
): Project {
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
  }))
}

export function removeNote(p: Project, trackId: string, noteId: string): Project {
  return mapTrack(p, trackId, (t) => ({
    ...t,
    notes: t.notes.filter((n) => n.id !== noteId),
  }))
}

export function updateTrackMixer(
  p: Project,
  trackId: string,
  patch: Partial<Mixer>,
): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, mixer: { ...t.mixer, ...patch } }))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: PASS (5 tests).

- [ ] **Step 5: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(score-model): add immutable note/track operations`

---

## Task 5: score-model — JSON 직렬화 라운드트립

**Files:**
- Create: `packages/score-model/src/serialize.ts`, `test/serialize.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/score-model/test/serialize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addNote, addTrack } from '../src/operations'
import { serializeProject, deserializeProject } from '../src/serialize'

function sample() {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject('Round'), t), t.id, n)
}

describe('serialize', () => {
  it('serialize → deserialize 는 동등한 객체를 복원한다(무손실)', () => {
    const p = sample()
    const restored = deserializeProject(serializeProject(p))
    expect(restored).toEqual(p)
  })

  it('deserialize는 스키마 위반 입력을 거부한다', () => {
    const bad = JSON.stringify({ id: 'x', metadata: {}, transport: {}, tracks: [] })
    expect(() => deserializeProject(bad)).toThrow()
  })

  it('deserialize는 잘못된 pitch 범위를 거부한다', () => {
    const p = sample()
    const obj = JSON.parse(serializeProject(p))
    obj.tracks[0].notes[0].pitch = 999
    expect(() => deserializeProject(JSON.stringify(obj))).toThrow()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: FAIL — `serialize.ts` 미존재.

- [ ] **Step 3: 최소 구현 작성**

Create `packages/score-model/src/serialize.ts`:
```ts
import { ProjectSchema, type Project } from './schema'

export function serializeProject(project: Project): string {
  return JSON.stringify(ProjectSchema.parse(project))
}

export function deserializeProject(json: string): Project {
  return ProjectSchema.parse(JSON.parse(json))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: PASS (3 tests).

- [ ] **Step 5: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(score-model): add validated JSON serialization`

---

## Task 6: score-model — 공개 API 배럴

**Files:**
- Create: `packages/score-model/src/index.ts`

- [ ] **Step 1: 배럴 작성**

Create `packages/score-model/src/index.ts`:
```ts
export * from './schema'
export * from './factory'
export * from './operations'
export * from './serialize'
```

- [ ] **Step 2: 전체 패키지 테스트 + 타입체크**

Run:
```bash
pnpm --filter @sculptone/score-model test
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```
Expected: 모든 테스트 PASS, 타입 에러 없음.

- [ ] **Step 3: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(score-model): export public API`

---

## Task 7: sound-engine — 프리셋 카탈로그 골격

**Files:**
- Create: `packages/sound-engine/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/presets.ts`, `src/index.ts`, `test/presets.test.ts`

- [ ] **Step 1: 패키지 매니페스트/설정 작성**

Create `packages/sound-engine/package.json`:
```json
{
  "name": "@sculptone/sound-engine",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@sculptone/score-model": "workspace:*"
  }
}
```

Create `packages/sound-engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

Create `packages/sound-engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `packages/sound-engine/test/presets.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset, listPresets } from '../src/presets'

describe('presets', () => {
  it('내장 프리셋에 acoustic-piano가 있다', () => {
    expect(getPreset('acoustic-piano')).toBeDefined()
    expect(getPreset('acoustic-piano')!.label).toBe('Acoustic Piano')
  })

  it('listPresets는 모든 프리셋 id를 반환한다', () => {
    const ids = listPresets().map((p) => p.id)
    expect(ids).toContain('acoustic-piano')
    expect(ids.length).toBe(Object.keys(PRESETS).length)
  })

  it('알 수 없는 id는 undefined', () => {
    expect(getPreset('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run:
```bash
pnpm install
pnpm --filter @sculptone/sound-engine test
```
Expected: FAIL — `presets.ts` 미존재.

- [ ] **Step 4: 타입 + 프리셋 카탈로그 구현**

Create `packages/sound-engine/src/types.ts`:
```ts
// P1: 샘플러/신스 프리셋 디스크립터(순수 데이터). 실제 Tone.js 인스턴스화는 재생 계획(P1 슬라이스 4)에서.
export type PresetKind = 'sampler' | 'synth'

export interface PresetDescriptor {
  id: string
  label: string
  kind: PresetKind
  // sampler: 샘플 베이스 URL 또는 식별자(후속 계획에서 사용). synth: Tone synth 타입명.
  source: string
}
```

Create `packages/sound-engine/src/presets.ts`:
```ts
import type { PresetDescriptor } from './types'

export const PRESETS: Record<string, PresetDescriptor> = {
  'acoustic-piano': { id: 'acoustic-piano', label: 'Acoustic Piano', kind: 'sampler', source: 'salamander' },
  'electric-piano': { id: 'electric-piano', label: 'Electric Piano', kind: 'synth', source: 'AMSynth' },
  'synth-lead': { id: 'synth-lead', label: 'Synth Lead', kind: 'synth', source: 'Synth' },
}

export function getPreset(id: string): PresetDescriptor | undefined {
  return PRESETS[id]
}

export function listPresets(): PresetDescriptor[] {
  return Object.values(PRESETS)
}
```

Create `packages/sound-engine/src/index.ts`:
```ts
export * from './types'
export * from './presets'
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/sound-engine test
```
Expected: PASS (3 tests).

- [ ] **Step 6: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(sound-engine): add preset catalog skeleton`

---

## Task 8: apps/web — Vite 앱 스캐폴딩 + 디자인 토큰

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles/tokens.css`, `src/styles/global.css`, `src/App.tsx`

- [ ] **Step 1: 패키지 매니페스트 작성**

Create `apps/web/package.json`:
```json
{
  "name": "@sculptone/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@sculptone/score-model": "workspace:*",
    "@sculptone/sound-engine": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: tsconfig / vite 설정 작성**

Create `apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src"]
}
```

Create `apps/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

- [ ] **Step 3: 디자인 토큰 작성 (Design Guide v0.2)**

Create `apps/web/src/styles/tokens.css`:
```css
:root {
  --bg-inset: #070708;
  --bg-base: #0C0C0D;
  --bg-surface: #141415;
  --bg-elevated: #1D1D1F;
  --border: #2A2A2C;
  --border-strong: #3A3A3D;

  --text-hi: #F5F5F6;
  --text-mid: #A6A6AA;
  --text-lo: #6B6B70;

  --accent: #F2A65A;
  --accent-deep: #C97E3C;
  --accent-soft: rgba(242, 166, 90, 0.14);
  --record: #E2685F;

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 16px;
  --r-pill: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Create `apps/web/src/styles/global.css`:
```css
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg-base);
  color: var(--text-hi);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }
```

- [ ] **Step 4: index.html + 엔트리 작성**

Create `apps/web/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sculptone</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Create `apps/web/src/App.tsx` (임시 — Task 12에서 셸로 교체):
```tsx
export default function App() {
  return <div style={{ padding: 24 }}>Sculptone</div>
}
```

- [ ] **Step 5: 설치 및 개발 서버 기동 확인**

Run:
```bash
pnpm install
pnpm --filter @sculptone/web dev
```
Expected: Vite dev 서버 URL 출력. 브라우저 확인은 사용자에게 맡기고, 에이전트는 서버가 에러 없이 기동했는지만 확인 후 종료(Ctrl+C).

- [ ] **Step 6: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(web): scaffold vite app with design tokens`

---

## Task 9: apps/web — Vitest(컴포넌트) 설정

**Files:**
- Create: `apps/web/vitest.config.ts`, `src/test/setup.ts`

- [ ] **Step 1: vitest 설정 작성**

Create `apps/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 2: 테스트 셋업 작성**

Create `apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: 설정 확인 (빈 실행)**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: PASS (No test files found 도 정상 — 다음 Task에서 추가).

- [ ] **Step 4: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `chore(web): configure vitest with jsdom`

---

## Task 10: apps/web — Zustand 스토어

**Files:**
- Create: `apps/web/src/state/store.ts`, `src/test/store.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/web/src/test/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('store', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 모드는 compose이고 프로젝트가 1개 트랙으로 시작한다', () => {
    const s = useStore.getState()
    expect(s.activeMode).toBe('compose')
    expect(s.project.tracks).toHaveLength(1)
    expect(s.project.tracks[0]!.name).toBe('Piano')
  })

  it('setMode는 활성 모드를 바꾼다', () => {
    useStore.getState().setMode('play')
    expect(useStore.getState().activeMode).toBe('play')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `state/store.ts` 미존재.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/web/src/state/store.ts`:
```ts
import { create } from 'zustand'
import {
  createEmptyProject,
  createTrack,
  addTrack,
  type Project,
} from '@sculptone/score-model'

export type Mode = 'compose' | 'play' | 'transcribe'

export interface AppState {
  activeMode: Mode
  project: Project
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: initialProject(),
  setMode: (mode) => set({ activeMode: mode }),
  setProject: (project) => set({ project }),
}))
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: PASS (2 tests).

> 참고: `getInitialState()`는 zustand v4.5+ 제공. 버전이 낮아 실패하면 `useStore.setState({ activeMode: 'compose', project: initialProject() })`로 리셋하도록 테스트를 수정.

- [ ] **Step 5: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(web): add zustand store for mode and project`

---

## Task 11: apps/web — UI 프리미티브 (Button, Tabs, Badge)

**Files:**
- Create: `apps/web/src/ui/Button.tsx`, `src/ui/Tabs.tsx`, `src/ui/Badge.tsx`, `src/test/Button.test.tsx`, `src/test/Tabs.test.tsx`

- [ ] **Step 1: Button 실패 테스트 작성**

Create `apps/web/src/test/Button.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../ui/Button'

describe('Button', () => {
  it('라벨을 렌더하고 클릭을 전달한다', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>내보내기</Button>)
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('variant에 따라 data-variant 속성을 단다', () => {
    render(<Button variant="primary">A</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'primary')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인 (userEvent 의존성 추가 포함)**

Run:
```bash
pnpm --filter @sculptone/web add -D @testing-library/user-event
pnpm --filter @sculptone/web test
```
Expected: FAIL — `ui/Button` 미존재.

- [ ] **Step 3: Button 구현**

Create `apps/web/src/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes, CSSProperties } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const styles: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#1a1206' },
  secondary: { background: 'var(--bg-elevated)', color: 'var(--text-hi)', border: '1px solid var(--border-strong)' },
  ghost: { background: 'transparent', color: 'var(--text-mid)' },
  danger: { background: 'transparent', color: 'var(--record)', border: '1px solid rgba(226,104,95,.4)' },
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', style, children, ...rest }: Props) {
  return (
    <button
      data-variant={variant}
      style={{
        font: 'inherit',
        fontWeight: 600,
        fontSize: 14,
        borderRadius: 'var(--r-md)',
        padding: '10px 18px',
        border: '1px solid transparent',
        cursor: 'pointer',
        ...styles[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Button 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: Button 테스트 PASS.

- [ ] **Step 5: Tabs 실패 테스트 작성**

Create `apps/web/src/test/Tabs.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from '../ui/Tabs'

const items = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]

describe('Tabs', () => {
  it('활성 탭에 aria-selected를 부여한다', () => {
    render(<Tabs items={items} active="compose" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Compose' })).toHaveAttribute('aria-selected', 'true')
  })

  it('비활성 탭 클릭은 onChange를 호출하지 않는다', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} active="compose" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Transcribe' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('활성 가능한 탭 클릭은 onChange(id)를 호출한다', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} active="compose" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
    expect(onChange).toHaveBeenCalledWith('play')
  })
})
```

- [ ] **Step 6: Tabs 구현**

Create `apps/web/src/ui/Tabs.tsx`:
```tsx
export interface TabItem {
  id: string
  label: string
  disabled?: boolean
}

interface Props {
  items: TabItem[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ items, active, onChange }: Props) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 4 }}>
      {items.map((it) => {
        const selected = it.id === active
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={selected}
            disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.id)}
            style={{
              font: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              padding: '7px 16px',
              borderRadius: 'var(--r-pill)',
              border: 0,
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              opacity: it.disabled ? 0.4 : 1,
              background: selected ? 'var(--accent)' : 'transparent',
              color: selected ? '#1a1206' : 'var(--text-mid)',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 7: Badge 구현 (테스트 불요 — 표시 전용)**

Create `apps/web/src/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react'

interface Props {
  tone?: 'rec' | 'neutral'
  children: ReactNode
}

export function Badge({ tone = 'neutral', children }: Props) {
  const color = tone === 'rec' ? 'var(--record)' : 'var(--text-mid)'
  const bg = tone === 'rec' ? 'rgba(226,104,95,.12)' : 'var(--bg-elevated)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--r-pill)', color, background: bg }}>
      {children}
    </span>
  )
}
```

- [ ] **Step 8: 전체 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: Button(2) + Tabs(3) + store(2) PASS.

- [ ] **Step 9: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(web): add Button, Tabs, Badge primitives`

---

## Task 12: apps/web — 앱 셸 조립

**Files:**
- Create: `apps/web/src/shell/AppShell.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: 셸 실패 테스트 작성**

Create `apps/web/src/test/AppShell.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../shell/AppShell'
import { useStore } from '../state/store'

describe('AppShell', () => {
  beforeEach(() => {
    useStore.setState({ activeMode: 'compose' })
  })

  it('세 모드 탭을 렌더한다', () => {
    render(<AppShell />)
    expect(screen.getByRole('tab', { name: 'Compose' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Transcribe' })).toBeInTheDocument()
  })

  it('Play 탭 클릭 시 스토어 모드가 바뀐다', async () => {
    render(<AppShell />)
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
    expect(useStore.getState().activeMode).toBe('play')
  })

  it('Transcribe 탭은 비활성이다', () => {
    render(<AppShell />)
    expect(screen.getByRole('tab', { name: 'Transcribe' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `shell/AppShell` 미존재.

- [ ] **Step 3: 셸 구현**

Create `apps/web/src/shell/AppShell.tsx`:
```tsx
import type { CSSProperties } from 'react'
import { useStore, type Mode } from '../state/store'
import { Tabs } from '../ui/Tabs'

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

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {project.transport.tempo} BPM · {project.transport.timeSignature.join('/')}
        </span>
      </div>

      {/* 본문: 좌 패널 · 중앙 캔버스 · 우 인스펙터 */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region }} aria-label="source-panel" />
        <div style={{ background: 'var(--bg-inset)', display: 'grid', placeItems: 'center', color: 'var(--text-lo)' }}>
          {activeMode === 'compose' && 'Compose 캔버스 (P1 슬라이스 3에서 구현)'}
          {activeMode === 'play' && 'Play 믹서 (P1 슬라이스 6에서 구현)'}
        </div>
        <div style={{ ...region }} aria-label="inspector" />
      </div>

      {/* 트랜스포트 */}
      <div style={{ ...region, display: 'grid', placeItems: 'center', color: 'var(--text-lo)' }}>
        Transport (P1 슬라이스 4에서 구현)
      </div>
    </div>
  )
}
```

- [ ] **Step 4: App.tsx를 셸로 교체**

Replace `apps/web/src/App.tsx` 전체 내용:
```tsx
import { AppShell } from './shell/AppShell'

export default function App() {
  return <AppShell />
}
```

- [ ] **Step 5: 테스트 통과 확인 + 타입체크 + 빌드**

Run:
```bash
pnpm --filter @sculptone/web test
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
```
Expected: 모든 테스트 PASS, 타입 에러 없음, 빌드 성공.

- [ ] **Step 6: 전체 모노레포 테스트**

Run:
```bash
pnpm -r test
```
Expected: score-model + sound-engine + web 전 패키지 PASS.

- [ ] **Step 7: ✋ 커밋 체크포인트 (사용자 수행)**

제안 커밋: `feat(web): assemble app shell with mode switching`

---

## 완료 기준 (Definition of Done)

- `pnpm -r test`가 전 패키지에서 통과한다.
- `pnpm --filter @sculptone/web dev`로 앱 셸이 에러 없이 뜨고, Compose/Play 탭 전환이 동작하며 Transcribe는 비활성이다.
- `score-model`이 zod 검증 기반으로 생성·편집·직렬화 라운드트립을 모두 테스트로 보장한다.
- `sound-engine` 프리셋 카탈로그가 존재하고 테스트된다.
- 디자인 토큰(흑백 + Copper)이 CSS 변수로 적용되어 있다.

## 다음 계획 (이 계획 완료 후 별도 작성)

- **계획 2 — Compose 피아노 롤 + 재생**: 피아노 롤 렌더/편집(슬라이스 3·5), Tone.js 재생 + 재생헤드(슬라이스 4). `sound-engine`에 Tone.js 인스턴스화 추가.
- **계획 3 — 멀티트랙·MIDI·저장**: 믹서(슬라이스 6), Web MIDI 입력(슬라이스 7), IndexedDB + MIDI/MusicXML/JSON 입출력(슬라이스 8).
```
