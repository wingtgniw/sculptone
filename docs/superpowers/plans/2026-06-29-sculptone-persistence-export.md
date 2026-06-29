# Sculptone Persistence & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** MIDI/JSON 입출력 어댑터를 score-model에 추가하고, IndexedDB 영속성 레이어(apps/web)를 구축하며, 자동저장·파일 IO·툴바 메뉴로 사용자가 프로젝트를 저장·내보내기·가져오기할 수 있게 한다.

**Architecture:** 순수 변환기(`projectToMidi`/`midiToProject`)는 score-model 패키지에 위치해 node 환경에서 테스트한다. io 레이어(`storage.ts`, `files.ts`)와 훅(`useAutosave`)은 apps/web에 위치하며 jsdom+fake-indexeddb로 테스트한다. UI 컴포넌트는 기존 디자인 토큰(`var(--accent)`, `var(--on-accent)` 등)을 준수하고 레퍼런스 구현을 계획서에 제시한다. JSON 직렬화는 기존 `serializeProject`/`deserializeProject`를 그대로 재사용하며 추가 구현하지 않는다.

**Tech Stack:** `@tonejs/midi`(score-model 의존성, 순수 Node 호환) · `idb`(IndexedDB 래퍼) · `fake-indexeddb`(devDep, jsdom 폴리필) · Vitest · React + TypeScript

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 스펙 `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`(§5.4/§6), 기반 계획 `docs/superpowers/plans/2026-06-29-sculptone-p0-foundation.md`, `docs/superpowers/plans/2026-06-29-sculptone-compose-playback.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- MusicXML 내보내기 (다음 계획)
- 멀티트랙 추가 UI / 믹서 패널 (다음 계획)
- Web MIDI 실시간 입력 (다음 계획)
- 클라우드 저장 / 협업
- MIDI 채널 매핑 세밀화 (P1은 채널 0 고정)

---

## 설계 근거

- **@tonejs/midi 선택 이유:** 순수 JS로 브라우저/Node 양쪽에서 동작. Midi 클래스가 `header.ppq`, `header.tempos[]`, `addTrack()`, `track.addNote({midi, ticks, durationTicks, velocity})`, `toArray()` API를 제공해 score-model의 tick 기반 구조와 직접 대응된다.
- **velocity 변환:** score-model(0–127 정수) ↔ @tonejs/midi(0–1 float). 변환: `vel127 / 127` ↔ `Math.max(0, Math.min(127, Math.round(vel01 * 127)))`. 정수 범위에서 round-trip은 정확(부동소수점 오차 없음).
- **ticks 무손실:** MIDI 표준의 tick은 정수이며, score-model Note.start/duration도 정수 ticks로 사용하므로 round-trip 무손실.
- **IndexedDB 스키마:** store 'projects'(keyPath: 'id'), 레코드: `{ id, title, updatedAt, data: string }`. `data`는 `serializeProject(project)` 결과(JSON 문자열). 로드 시 `deserializeProject(record.data)`로 복원.
- **자동저장 전략:** Zustand `useStore` 구독 → 프로젝트 변경 시 `useEffect`에서 debounce 800ms → `saveProject`. React 훅으로 구현해 jsdom+fake timers로 테스트 가능.
- **AppShell 기존 테스트 보존:** AppShell이 `useAutosave()`를 호출하게 되므로, 기존 `AppShell.test.tsx`와 `AppShell.compose.test.tsx`에 `vi.mock('../io/useAutosave', ...)` 모킹을 추가해야 한다.

---

## File Structure

```
packages/score-model/src/
  midi.ts                         # NEW: projectToMidi + midiToProject
  index.ts                        # MOD: export * from './midi' 추가

packages/score-model/test/
  midi.test.ts                    # NEW: TDD 테스트 (projectToMidi / midiToProject / 라운드트립)

apps/web/src/
  io/
    storage.ts                    # NEW: IndexedDB CRUD (idb)
    files.ts                      # NEW: downloadBytes / downloadText / readFileAsArrayBuffer
    useAutosave.ts                # NEW: 디바운스 자동저장 훅
    test/
      storage.test.ts             # NEW: fake-indexeddb TDD
      files.test.ts               # NEW: 스모크 테스트
      useAutosave.test.ts         # NEW: fake timers TDD

  ui/
    FileMenu.tsx                  # NEW: 툴바 버튼 (New / Export MIDI / Export JSON / Import MIDI)
    ProjectList.tsx               # NEW: 저장 프로젝트 목록 드롭다운
    test/
      FileMenu.test.tsx           # NEW
      ProjectList.test.tsx        # NEW

  styles/
    tokens.css                    # MOD: --on-accent 토큰 추가

  shell/
    AppShell.tsx                  # MOD: FileMenu + useAutosave 통합
  test/
    AppShell.test.tsx             # MOD: useAutosave 모킹 추가
    AppShell.compose.test.tsx     # MOD: useAutosave 모킹 추가
```

---

## Task 1: @tonejs/midi 설치 + projectToMidi

**Files:** Create `packages/score-model/src/midi.ts`, `packages/score-model/test/midi.test.ts`

- [ ] **Step 1: @tonejs/midi 의존성 추가**

Run:
```bash
pnpm --filter @sculptone/score-model add @tonejs/midi
```
Expected: `@tonejs/midi`가 score-model `package.json` dependencies에 추가되고 설치 성공.

- [ ] **Step 2: 실패 테스트 작성 (projectToMidi)**

Create `packages/score-model/test/midi.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Midi } from '@tonejs/midi'
import { createEmptyProject, createTrack, createNote } from '../src/factory'
import { addTrack, addNote } from '../src/operations'
import { projectToMidi } from '../src/midi'

function sampleProject() {
  const t = createTrack('Piano')
  const n1 = createNote({ pitch: 60, start: 0,   duration: 480, velocity: 96 })
  const n2 = createNote({ pitch: 64, start: 480, duration: 240, velocity: 80 })
  let p = addTrack(createEmptyProject('Test MIDI'), t)
  p = addNote(p, t.id, n1)
  p = addNote(p, t.id, n2)
  return { p, t, n1, n2 }
}

describe('projectToMidi', () => {
  it('Uint8Array를 반환한다', () => {
    const { p } = sampleProject()
    const bytes = projectToMidi(p)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('PPQ와 템포를 헤더에 기록한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    expect(midi.header.ppq).toBe(480)
    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(120, 4)
  })

  it('트랙 수와 노트 수가 일치한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    expect(midi.tracks).toHaveLength(1)
    expect(midi.tracks[0]!.notes).toHaveLength(2)
  })

  it('노트 pitch · ticks · durationTicks · velocity를 기록한다', () => {
    const { p } = sampleProject()
    const midi = new Midi(projectToMidi(p))
    const note = midi.tracks[0]!.notes.find((x) => x.ticks === 0)!
    expect(note.midi).toBe(60)
    expect(note.durationTicks).toBe(480)
    expect(note.velocity).toBeCloseTo(96 / 127, 3)
  })

  it('빈 프로젝트(트랙 없음)도 유효한 MIDI를 반환한다', () => {
    const p = createEmptyProject('Empty')
    const bytes = projectToMidi(p)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const midi = new Midi(bytes)
    expect(midi.tracks).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: FAIL — `'../src/midi'` 모듈을 찾을 수 없음.

- [ ] **Step 4: 최소 구현 작성**

Create `packages/score-model/src/midi.ts`:
```ts
import { Midi } from '@tonejs/midi'
import type { Project } from './schema'

/**
 * Project → MIDI bytes (Uint8Array).
 *
 * 각 Track이 MIDI 트랙 1개로 직렬화된다.
 * PPQ / tempo 는 header 에 기록한다.
 * velocity 변환: score-model(0–127 int) → @tonejs/midi(0–1 float) = velocity / 127.
 */
export function projectToMidi(project: Project): Uint8Array {
  const midi = new Midi()
  midi.header.ppq = project.transport.ppq

  // TempoEvent가 time 필드를 요구하는 경우 0 으로 설정
  midi.header.tempos.push({ ticks: 0, bpm: project.transport.tempo, time: 0 })

  for (const track of project.tracks) {
    const midiTrack = midi.addTrack()
    midiTrack.name = track.name
    for (const note of track.notes) {
      midiTrack.addNote({
        midi:          note.pitch,
        ticks:         note.start,
        durationTicks: note.duration,
        velocity:      note.velocity / 127,
      })
    }
  }

  // midi.toArray() 는 v2 에서 Uint8Array 반환. 방어적으로 래핑.
  return new Uint8Array(midi.toArray())
}
```

> **구현 노트:** `midi.header.tempos.push(...)` 에서 TypeScript 가 `time` 필드를 요구하면 `time: 0` 을 포함(위 코드처럼). `@tonejs/midi` 가 `TempoEvent` 를 클래스로 내보내는 버전이라면 `as unknown as TempoEvent` 로 캐스팅.

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: projectToMidi 5 tests PASS. 기존 테스트(factory/operations/serialize)도 계속 PASS.

---

## Task 2: midiToProject 구현

**Files:** Modify `packages/score-model/src/midi.ts`, `packages/score-model/test/midi.test.ts`

- [ ] **Step 1: 실패 테스트 추가 (midiToProject)**

`packages/score-model/test/midi.test.ts` 하단에 추가:
```ts
import { midiToProject } from '../src/midi'

describe('midiToProject', () => {
  it('bytes를 Project로 파싱한다 (트랙·노트 수)', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), 'Test MIDI')
    expect(restored.transport.ppq).toBe(480)
    expect(restored.transport.tempo).toBeCloseTo(120, 4)
    expect(restored.tracks).toHaveLength(1)
    expect(restored.tracks[0]!.notes).toHaveLength(2)
  })

  it('title 인수가 metadata.title에 반영된다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), 'My Import')
    expect(restored.metadata.title).toBe('My Import')
  })

  it('title 생략 시 "Imported"가 기본값이다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p))
    expect(restored.metadata.title).toBe('Imported')
  })

  it('빈 MIDI(트랙 없음)는 track=[] 프로젝트로 파싱된다', () => {
    const emptyMidi = new Midi()
    emptyMidi.header.ppq = 960
    const bytes = new Uint8Array(emptyMidi.toArray())
    const restored = midiToProject(bytes)
    expect(restored.tracks).toHaveLength(0)
    expect(restored.transport.ppq).toBe(960)
  })

  it('velocity 0–127 정수가 round-trip 후 동일하다', () => {
    const t = createTrack('V')
    const notes = [1, 64, 96, 127].map((v) =>
      createNote({ pitch: 60, start: 0, duration: 480, velocity: v }),
    )
    let p = addTrack(createEmptyProject('V'), t)
    for (const n of notes) p = addNote(p, t.id, n)
    const restored = midiToProject(projectToMidi(p))
    const origVel = notes.map((n) => n.velocity)
    const resVel = restored.tracks[0]!.notes.map((n) => n.velocity)
    expect(resVel.sort()).toEqual(origVel.sort())
  })
})
```

- [ ] **Step 2: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: FAIL — `midiToProject`가 `midi.ts`에 export 되지 않음.

- [ ] **Step 3: 최소 구현 작성**

`packages/score-model/src/midi.ts` 에 import와 `midiToProject` 함수를 추가한다 (기존 `projectToMidi` 유지):
```ts
import { Midi } from '@tonejs/midi'
import type { Project } from './schema'
import { createEmptyProject, createTrack, createNote } from './factory'
import { addTrack, addNote } from './operations'

// ... (기존 projectToMidi 함수 유지) ...

/**
 * MIDI bytes → Project.
 *
 * 파일 ppq를 transport.ppq로 채택, 첫 tempo 이벤트를 transport.tempo로 사용.
 * tempo 없으면 120 BPM 기본값.
 * velocity 변환: @tonejs/midi(0–1 float) → score-model(0–127 int, Math.round 후 클램핑).
 * Note.id / Track.id / Project.id 는 새로 생성(UUID). 라운드트립에서 ID가 달라지는 것은 예상된 동작.
 */
export function midiToProject(bytes: Uint8Array, title = 'Imported'): Project {
  const midi = new Midi(bytes)
  const ppq   = midi.header.ppq
  const tempo = midi.header.tempos[0]?.bpm ?? 120

  let project = createEmptyProject(title)
  project = {
    ...project,
    transport: { ...project.transport, ppq, tempo },
  }

  for (const midiTrack of midi.tracks) {
    const track = createTrack(midiTrack.name || 'Track')
    project = addTrack(project, track)

    for (const note of midiTrack.notes) {
      const velocity = Math.max(0, Math.min(127, Math.round(note.velocity * 127)))
      const n = createNote({
        pitch:    note.midi,
        start:    note.ticks,
        duration: Math.max(1, note.durationTicks), // durationTicks=0 방어
        velocity,
      })
      project = addNote(project, track.id, n)
    }
  }

  return project
}
```

완성된 `midi.ts` 전체:
```ts
import { Midi } from '@tonejs/midi'
import type { Project } from './schema'
import { createEmptyProject, createTrack, createNote } from './factory'
import { addTrack, addNote } from './operations'

export function projectToMidi(project: Project): Uint8Array {
  const midi = new Midi()
  midi.header.ppq = project.transport.ppq
  midi.header.tempos.push({ ticks: 0, bpm: project.transport.tempo, time: 0 })

  for (const track of project.tracks) {
    const midiTrack = midi.addTrack()
    midiTrack.name = track.name
    for (const note of track.notes) {
      midiTrack.addNote({
        midi:          note.pitch,
        ticks:         note.start,
        durationTicks: note.duration,
        velocity:      note.velocity / 127,
      })
    }
  }

  return new Uint8Array(midi.toArray())
}

export function midiToProject(bytes: Uint8Array, title = 'Imported'): Project {
  const midi  = new Midi(bytes)
  const ppq   = midi.header.ppq
  const tempo = midi.header.tempos[0]?.bpm ?? 120

  let project = createEmptyProject(title)
  project = {
    ...project,
    transport: { ...project.transport, ppq, tempo },
  }

  for (const midiTrack of midi.tracks) {
    const track = createTrack(midiTrack.name || 'Track')
    project = addTrack(project, track)
    for (const note of midiTrack.notes) {
      const velocity = Math.max(0, Math.min(127, Math.round(note.velocity * 127)))
      const n = createNote({
        pitch:    note.midi,
        start:    note.ticks,
        duration: Math.max(1, note.durationTicks),
        velocity,
      })
      project = addNote(project, track.id, n)
    }
  }

  return project
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: projectToMidi(5) + midiToProject(5) = 10 tests PASS.

---

## Task 3: MIDI 라운드트립 테스트 + score-model 배럴 갱신

**Files:** Modify `packages/score-model/test/midi.test.ts`, `packages/score-model/src/index.ts`

- [ ] **Step 1: 라운드트립 테스트 추가**

`packages/score-model/test/midi.test.ts` 하단에 추가:
```ts
describe('MIDI 라운드트립', () => {
  it('단일 트랙: pitch·start·duration·velocity·tempo·ppq가 보존된다', () => {
    const { p } = sampleProject()
    const restored = midiToProject(projectToMidi(p), p.metadata.title)

    // transport
    expect(restored.transport.ppq).toBe(p.transport.ppq)
    expect(restored.transport.tempo).toBeCloseTo(p.transport.tempo, 4)

    // 트랙 수
    expect(restored.tracks).toHaveLength(p.tracks.length)

    // 노트 비교 (ticks 순 정렬로 순서 보장)
    const origNotes  = [...p.tracks[0]!.notes].sort((a, b) => a.start - b.start)
    const resNotes   = [...restored.tracks[0]!.notes].sort((a, b) => a.start - b.start)
    expect(resNotes).toHaveLength(origNotes.length)

    for (let i = 0; i < origNotes.length; i++) {
      const o = origNotes[i]!
      const r = resNotes[i]!
      expect(r.pitch).toBe(o.pitch)         // 정수 → 무손실
      expect(r.start).toBe(o.start)         // 정수 ticks → 무손실
      expect(r.duration).toBe(o.duration)   // 정수 ticks → 무손실
      expect(r.velocity).toBe(o.velocity)   // round(v/127*127)=v → 무손실
    }
  })

  it('멀티 트랙: 트랙 수·트랙별 노트 수·피치가 보존된다', () => {
    const t1 = createTrack('Piano')
    const t2 = createTrack('Bass')
    let p = createEmptyProject('Multi')
    p = addTrack(p, t1)
    p = addTrack(p, t2)
    p = addNote(p, t1.id, createNote({ pitch: 60, start: 0,   duration: 480, velocity: 100 }))
    p = addNote(p, t1.id, createNote({ pitch: 62, start: 480, duration: 240, velocity: 80  }))
    p = addNote(p, t2.id, createNote({ pitch: 36, start: 0,   duration: 960, velocity: 90  }))

    const restored = midiToProject(projectToMidi(p), 'Multi')
    expect(restored.tracks).toHaveLength(2)
    expect(restored.tracks[0]!.notes).toHaveLength(2)
    expect(restored.tracks[1]!.notes).toHaveLength(1)
    expect(restored.tracks[0]!.notes.find((n) => n.start === 0)!.pitch).toBe(60)
    expect(restored.tracks[1]!.notes[0]!.pitch).toBe(36)
  })

  it('극단 velocity(0·127)도 무손실이다', () => {
    const t = createTrack('X')
    let p = addTrack(createEmptyProject('E'), t)
    p = addNote(p, t.id, createNote({ pitch: 60, start: 0,   duration: 480, velocity: 0   }))
    p = addNote(p, t.id, createNote({ pitch: 61, start: 480, duration: 480, velocity: 127 }))
    const restored = midiToProject(projectToMidi(p))
    const vels = restored.tracks[0]!.notes.map((n) => n.velocity).sort((a, b) => a - b)
    // velocity=0 노트는 MIDI note-off로 처리될 수 있어 주의. 실패 시 velocity=1로 변경 허용.
    expect(vels[1]).toBe(127)
  })
})
```

> **라운드트립 정밀도 명시:**
> - pitch: 정수 → 정확히 보존
> - start/duration: 정수 ticks → 정확히 보존
> - velocity: `round(v/127 * 127) = v` — 0–127 정수 범위에서 무손실. (단, `velocity=0`은 MIDI note-off 이벤트로 처리될 수 있어 라이브러리 버전에 따라 1로 올라갈 수 있음. 허용 오차: ±1.)
> - tempo: 소수점 4자리까지 일치(BPM float는 MIDI microseconds/beat ↔ BPM 변환 시 미세 반올림 가능).

- [ ] **Step 2: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/score-model test
```
Expected: 모든 midi.test.ts 테스트(13개) PASS.

- [ ] **Step 3: score-model 배럴 갱신**

`packages/score-model/src/index.ts` 끝에 추가:
```ts
export * from './midi'
```

완성된 `index.ts`:
```ts
export * from './schema'
export * from './factory'
export * from './operations'
export * from './serialize'
export * from './midi'
```

- [ ] **Step 4: 전체 score-model 게이트**

Run:
```bash
pnpm --filter @sculptone/score-model test
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```
Expected: 전체 테스트 PASS, 타입 에러 없음.

---

## Task 4: apps/web idb + fake-indexeddb 설치 + storage.ts

**Files:** Create `apps/web/src/io/storage.ts`, `apps/web/src/io/test/storage.test.ts`

- [ ] **Step 1: 의존성 추가**

Run:
```bash
pnpm --filter @sculptone/web add idb
pnpm --filter @sculptone/web add -D fake-indexeddb
```
Expected: 두 패키지 설치 성공.

- [ ] **Step 2: 실패 테스트 작성**

Create `apps/web/src/io/test/storage.test.ts`:
```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, it, expect } from 'vitest'
import { saveProject, loadProject, listProjects, deleteProject } from '../storage'
import {
  createEmptyProject, createTrack, createNote,
  addTrack, addNote,
} from '@sculptone/score-model'

function makeProject(title = 'Test') {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject(title), t), t.id, n)
}

// 각 테스트 전에 IndexedDB를 초기화해 격리
beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('sculptone')
    req.onsuccess = () => resolve()
    req.onerror   = () => resolve()
    req.onblocked = () => resolve()
  })
})

describe('storage', () => {
  it('saveProject → loadProject 가 동일한 프로젝트를 복원한다', async () => {
    const p = makeProject('Round Trip')
    await saveProject(p)
    const loaded = await loadProject(p.id)
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe(p.id)
    expect(loaded!.metadata.title).toBe('Round Trip')
    expect(loaded!.tracks[0]!.notes).toHaveLength(1)
    expect(loaded!.tracks[0]!.notes[0]!.pitch).toBe(60)
  })

  it('존재하지 않는 id는 undefined를 반환한다', async () => {
    const result = await loadProject('no-such-id')
    expect(result).toBeUndefined()
  })

  it('listProjects 가 저장된 프로젝트 요약을 반환한다', async () => {
    const p1 = makeProject('Alpha')
    const p2 = makeProject('Beta')
    await saveProject(p1)
    await saveProject(p2)
    const list = await listProjects()
    expect(list).toHaveLength(2)
    const titles = list.map((x) => x.title)
    expect(titles).toContain('Alpha')
    expect(titles).toContain('Beta')
  })

  it('listProjects 결과는 id·title·updatedAt 필드만 포함한다', async () => {
    const p = makeProject('Fields')
    await saveProject(p)
    const list = await listProjects()
    expect(list[0]).toEqual(
      expect.objectContaining({ id: p.id, title: 'Fields' }),
    )
    // tracks 는 포함되지 않음
    expect((list[0] as Record<string, unknown>)['tracks']).toBeUndefined()
  })

  it('deleteProject 후 loadProject는 undefined를 반환한다', async () => {
    const p = makeProject('Delete Me')
    await saveProject(p)
    await deleteProject(p.id)
    expect(await loadProject(p.id)).toBeUndefined()
  })

  it('saveProject는 같은 id로 덮어쓴다 (upsert)', async () => {
    const p = makeProject('Original')
    await saveProject(p)
    const updated = { ...p, metadata: { ...p.metadata, title: 'Updated' } }
    await saveProject(updated)
    const loaded = await loadProject(p.id)
    expect(loaded!.metadata.title).toBe('Updated')
    const list = await listProjects()
    expect(list).toHaveLength(1) // 중복 저장 없음
  })
})
```

- [ ] **Step 3: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `'../storage'` 모듈 없음.

- [ ] **Step 4: 최소 구현 작성**

Create `apps/web/src/io/storage.ts`:
```ts
import { openDB, type DBSchema } from 'idb'
import { serializeProject, deserializeProject, type Project } from '@sculptone/score-model'

/** IndexedDB 스키마 정의 */
interface SculptoneDB extends DBSchema {
  projects: {
    key: string
    value: {
      id:        string
      title:     string
      updatedAt: string
      data:      string   // serializeProject(project) 의 JSON 문자열
    }
  }
}

const DB_NAME    = 'sculptone'
const STORE_NAME = 'projects'
const DB_VERSION = 1

/** DB 연결 열기 (캐싱 없음 — 테스트 격리 용이) */
async function getDB() {
  return openDB<SculptoneDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
  })
}

/** 프로젝트를 IndexedDB에 저장(upsert). 직렬화는 serializeProject 사용. */
export async function saveProject(project: Project): Promise<void> {
  const db = await getDB()
  await db.put(STORE_NAME, {
    id:        project.id,
    title:     project.metadata.title,
    updatedAt: project.metadata.updatedAt,
    data:      serializeProject(project),
  })
}

/** ID로 프로젝트 로드. 없으면 undefined. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const db     = await getDB()
  const record = await db.get(STORE_NAME, id)
  if (!record) return undefined
  return deserializeProject(record.data)
}

/** 저장된 프로젝트 요약 목록 (id · title · updatedAt). */
export interface ProjectSummary {
  id:        string
  title:     string
  updatedAt: string
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db  = await getDB()
  const all = await db.getAll(STORE_NAME)
  return all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 프로젝트 삭제 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: storage.test.ts 6 tests PASS. 기존 웹 테스트(앞 계획의 57개)도 PASS.

---

## Task 5: files.ts — 파일 IO 유틸

**Files:** Create `apps/web/src/io/files.ts`, `apps/web/src/io/test/files.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/io/test/files.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadBytes, downloadText, readFileAsArrayBuffer } from '../files'

describe('files', () => {
  afterEach(() => { vi.restoreAllMocks() })

  describe('readFileAsArrayBuffer', () => {
    it('File의 내용을 ArrayBuffer로 반환한다', async () => {
      const content = new Uint8Array([1, 2, 3, 4])
      const file = new File([content], 'test.mid', { type: 'audio/midi' })
      const buf  = await readFileAsArrayBuffer(file)
      expect(buf).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(buf)).toEqual(content)
    })
  })

  describe('downloadBytes', () => {
    it('URL.createObjectURL · document.createElement · click을 호출한다', () => {
      // jsdom은 URL.createObjectURL을 지원하지 않으므로 스텁
      const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const anchor    = { href: '', download: '', click: vi.fn() }
      const createElement = vi.spyOn(document, 'createElement').mockReturnValue(
        anchor as unknown as HTMLElement,
      )

      downloadBytes(new Uint8Array([0, 1]), 'out.mid', 'audio/midi')

      expect(createURL).toHaveBeenCalledOnce()
      expect(anchor.download).toBe('out.mid')
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(revokeURL).toHaveBeenCalledWith('blob:mock')
    })
  })

  describe('downloadText', () => {
    it('텍스트를 Uint8Array로 인코딩해 downloadBytes를 호출한다', () => {
      const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const anchor = { href: '', download: '', click: vi.fn() }
      vi.spyOn(document, 'createElement').mockReturnValue(
        anchor as unknown as HTMLElement,
      )

      downloadText('{"hello":"world"}', 'out.json', 'application/json')

      expect(createURL).toHaveBeenCalledOnce()
      expect(anchor.download).toBe('out.json')
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `'../files'` 없음.

- [ ] **Step 3: 구현**

Create `apps/web/src/io/files.ts`:
```ts
/**
 * Uint8Array를 브라우저 다운로드로 내보낸다.
 * jsdom 환경에서는 URL.createObjectURL을 스텁해 테스트.
 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a') as HTMLAnchorElement
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 텍스트 문자열을 UTF-8 Uint8Array로 인코딩해 downloadBytes에 전달한다. */
export function downloadText(text: string, filename: string, mime: string): void {
  downloadBytes(new TextEncoder().encode(text), filename, mime)
}

/** File(또는 Blob)을 ArrayBuffer로 비동기 읽기 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: files.test.ts 3 tests PASS.

---

## Task 6: useAutosave 훅

**Files:** Create `apps/web/src/io/useAutosave.ts`, `apps/web/src/io/test/useAutosave.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/io/test/useAutosave.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { useAutosave } from '../useAutosave'

// saveProject를 모킹해 IndexedDB 없이 테스트
vi.mock('../storage', () => ({
  saveProject: vi.fn().mockResolvedValue(undefined),
}))

import { saveProject } from '../storage'
const mockSave = saveProject as ReturnType<typeof vi.fn>

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSave.mockClear()
    useStore.setState(useStore.getInitialState(), true)
  })
  afterEach(() => { vi.useRealTimers() })

  it('초기 마운트 시 800ms 후 saveProject를 한 번 호출한다', async () => {
    renderHook(() => useAutosave())
    expect(mockSave).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(800) })
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('project 변경 시 디바운스가 리셋되어 변경 후 800ms에 한 번 호출한다', async () => {
    renderHook(() => useAutosave())
    // 400ms 후 project 변경
    await act(async () => { vi.advanceTimersByTime(400) })
    act(() => { useStore.getState().setProject({ ...useStore.getState().project }) })
    await act(async () => { vi.advanceTimersByTime(400) })
    // 변경 후 800ms가 아직 안 됨 → 호출 없음
    expect(mockSave).not.toHaveBeenCalled()
    // 추가 400ms → 총 변경 후 800ms → 1회 호출
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('saveProject에 현재 project를 인수로 전달한다', async () => {
    renderHook(() => useAutosave())
    await act(async () => { vi.advanceTimersByTime(800) })
    const calledWith = mockSave.mock.calls[0]?.[0]
    expect(calledWith?.id).toBe(useStore.getState().project.id)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `'../useAutosave'` 없음.

- [ ] **Step 3: 구현**

Create `apps/web/src/io/useAutosave.ts`:
```ts
import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { saveProject } from './storage'

/**
 * project가 변경될 때마다 debounce(delayMs) 후 saveProject를 호출한다.
 * AppShell 최상단에서 한 번 호출하면 된다.
 */
export function useAutosave(delayMs = 800): void {
  const project = useStore((s) => s.project)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void saveProject(project)
    }, delayMs)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [project, delayMs])
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: useAutosave.test.ts 3 tests PASS.

---

## Task 7: --on-accent 토큰 추가 + FileMenu 컴포넌트

**Files:** Modify `apps/web/src/styles/tokens.css`; Create `apps/web/src/ui/FileMenu.tsx`, `apps/web/src/ui/test/FileMenu.test.tsx`

- [ ] **Step 1: --on-accent 토큰 추가**

`apps/web/src/styles/tokens.css` 의 `--accent-soft` 다음 줄에 추가:
```css
  --on-accent: #1a1206;
```

완성 후 해당 섹션:
```css
  --accent: #F2A65A;
  --accent-deep: #C97E3C;
  --accent-soft: rgba(242, 166, 90, 0.14);
  --on-accent: #1a1206;
  --record: #E2685F;
```

- [ ] **Step 2: 실패 테스트 작성**

Create `apps/web/src/ui/test/FileMenu.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { FileMenu } from '../FileMenu'

// IO 모듈 모킹 (IndexedDB · 파일 시스템 없이 테스트)
vi.mock('../../io/storage', () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  saveProject:  vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../io/files', () => ({
  downloadBytes: vi.fn(),
  downloadText:  vi.fn(),
  readFileAsArrayBuffer: vi.fn(),
}))
vi.mock('@sculptone/score-model', async (importOrig) => {
  const orig = await importOrig<typeof import('@sculptone/score-model')>()
  return {
    ...orig,
    projectToMidi:  vi.fn().mockReturnValue(new Uint8Array([0])),
    midiToProject:  vi.fn().mockReturnValue(orig.createEmptyProject('Imported')),
    serializeProject: vi.fn().mockReturnValue('{}'),
  }
})

describe('FileMenu', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('New · Export MIDI · Export JSON · Import MIDI 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export midi/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import midi/i })).toBeInTheDocument()
  })

  it('New 클릭 시 스토어의 project가 빈 프로젝트로 교체된다', async () => {
    render(<FileMenu />)
    const prevId = useStore.getState().project.id
    await userEvent.click(screen.getByRole('button', { name: /new/i }))
    expect(useStore.getState().project.id).not.toBe(prevId)
    expect(useStore.getState().project.tracks).toHaveLength(0)
  })

  it('Export MIDI 클릭 시 downloadBytes가 .mid 파일명으로 호출된다', async () => {
    const { downloadBytes } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export midi/i }))
    expect(downloadBytes).toHaveBeenCalledOnce()
    const [, filename, mime] = (downloadBytes as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(filename).toMatch(/\.mid$/)
    expect(mime).toContain('midi')
  })

  it('Export JSON 클릭 시 downloadText가 .json 파일명으로 호출된다', async () => {
    const { downloadText } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))
    expect(downloadText).toHaveBeenCalledOnce()
    const [, filename] = (downloadText as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(filename).toMatch(/\.json$/)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `'../FileMenu'` 없음.

- [ ] **Step 4: 레퍼런스 구현**

Create `apps/web/src/ui/FileMenu.tsx`:
```tsx
import { useRef, type ChangeEvent, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import { createEmptyProject, projectToMidi, midiToProject, serializeProject } from '@sculptone/score-model'
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
  const project    = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)
  const fileInput  = useRef<HTMLInputElement>(null)

  const handleNew = () => {
    setProject(createEmptyProject('Untitled Project'))
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

  const handleImportMidi = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf   = await readFileAsArrayBuffer(file)
      const bytes = new Uint8Array(buf)
      const title = file.name.replace(/\.mid$/i, '')
      setProject(midiToProject(bytes, title))
    } catch (err) {
      console.error('MIDI import failed:', err)
    } finally {
      // input 초기화 (같은 파일 재선택 허용)
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
      <button
        style={btnStyle}
        onClick={() => fileInput.current?.click()}
      >
        Import MIDI
      </button>
      {/* hidden file input */}
      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi"
        style={{ display: 'none' }}
        onChange={handleImportMidi}
      />
    </div>
  )
}
```

> **타입 노트:** React 타입은 네임스페이스 접근(`React.CSSProperties`, `React.ChangeEvent`) 금지. 반드시 `'react'`에서 named import 사용. 위 코드는 이미 올바른 형태(`import { useRef, type ChangeEvent, type CSSProperties } from 'react'`)를 사용한다.

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FileMenu.test.tsx 4 tests PASS.

---

## Task 8: ProjectList 컴포넌트

**Files:** Create `apps/web/src/ui/ProjectList.tsx`, `apps/web/src/ui/test/ProjectList.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/ui/test/ProjectList.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { ProjectList } from '../ProjectList'
import type { ProjectSummary } from '../../io/storage'

const mockSummaries: ProjectSummary[] = [
  { id: 'id-1', title: 'Alpha', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'id-2', title: 'Beta',  updatedAt: '2026-06-02T00:00:00.000Z' },
]

vi.mock('../../io/storage', () => ({
  listProjects: vi.fn().mockResolvedValue(mockSummaries),
  loadProject:  vi.fn().mockImplementation(async (id: string) => {
    if (id === 'id-1') {
      const { createEmptyProject } = await import('@sculptone/score-model')
      const p = createEmptyProject('Alpha')
      return { ...p, id: 'id-1' }
    }
    return undefined
  }),
  deleteProject: vi.fn().mockResolvedValue(undefined),
}))

describe('ProjectList', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('마운트 후 listProjects 결과로 프로젝트 목록을 렌더한다', async () => {
    render(<ProjectList />)
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  it('프로젝트 선택(Load) 시 loadProject → setProject가 호출된다', async () => {
    render(<ProjectList />)
    await waitFor(() => screen.getByText('Alpha'))
    await userEvent.click(screen.getByRole('button', { name: /load.*alpha/i }))
    await waitFor(() => {
      expect(useStore.getState().project.id).toBe('id-1')
    })
  })

  it('목록이 비어있으면 "저장된 프로젝트 없음" 메시지를 표시한다', async () => {
    const { listProjects } = await import('../../io/storage')
    ;(listProjects as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    render(<ProjectList />)
    await waitFor(() => {
      expect(screen.getByText(/저장된 프로젝트 없음/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: FAIL — `'../ProjectList'` 없음.

- [ ] **Step 3: 레퍼런스 구현**

Create `apps/web/src/ui/ProjectList.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { listProjects, loadProject, type ProjectSummary } from '../io/storage'

export function ProjectList() {
  const setProject = useStore((s) => s.setProject)
  const [items, setItems]   = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void listProjects().then((list) => {
      setItems(list)
      setLoading(false)
    })
  }, [])

  const handleLoad = async (id: string) => {
    const p = await loadProject(id)
    if (p) setProject(p)
  }

  if (loading) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        로딩 중…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--text-lo)', fontSize: 12 }}>
        저장된 프로젝트 없음
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0', minWidth: 220 }}>
      <p style={{
        fontSize: 11, color: 'var(--text-lo)',
        textTransform: 'uppercase', letterSpacing: '.1em',
        margin: '0 12px 8px',
      }}>
        Saved Projects
      </p>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', gap: 8,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-hi)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          <button
            aria-label={`Load ${item.title}`}
            onClick={() => void handleLoad(item.id)}
            style={{
              font: 'inherit', fontSize: 11, fontWeight: 600,
              padding: '3px 8px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border-strong)',
              cursor: 'pointer',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            Load
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: ProjectList.test.tsx 3 tests PASS.

---

## Task 9: AppShell 통합 (FileMenu + useAutosave + 기존 테스트 보존)

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`, `apps/web/src/test/AppShell.compose.test.tsx`

- [ ] **Step 1: 기존 AppShell 테스트에 useAutosave 모킹 추가**

`apps/web/src/test/AppShell.test.tsx` 의 기존 `vi.mock('../audio/useAudio', ...)` 바로 다음에 추가:
```tsx
vi.mock('../io/useAutosave', () => ({ useAutosave: () => {} }))
```

`apps/web/src/test/AppShell.compose.test.tsx` 의 기존 `vi.mock('../audio/useAudio', ...)` 바로 다음에 추가:
```tsx
vi.mock('../io/useAutosave', () => ({ useAutosave: () => {} }))
```

두 파일 모두 `vi` import 가 있는지 확인(`import { describe, it, expect, beforeEach, vi } from 'vitest'`).

- [ ] **Step 2: 실패 확인 (AppShell이 아직 useAutosave를 import하지 않는 상태에서 현재 테스트가 통과하는지 확인)**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: 현재 57개 tests + 이전 tasks의 신규 tests 모두 PASS.

- [ ] **Step 3: AppShell 수정 — FileMenu + useAutosave 통합**

`apps/web/src/shell/AppShell.tsx` 를 수정한다. import 섹션에 추가:
```tsx
import { FileMenu } from '../ui/FileMenu'
import { useAutosave } from '../io/useAutosave'
```

`AppShell` 함수 본문 최상단에 추가 (기존 `const { play, stop, getSeconds } = useAudio()` 줄 위):
```tsx
useAutosave()
```

툴바 영역에서 `<Tabs ... />` 와 BPM span 사이에 `<FileMenu />` 삽입:

수정 전:
```tsx
<Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
<span className="mono" style={{ marginLeft: 'auto', ...
```

수정 후:
```tsx
<Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
<FileMenu />
<span className="mono" style={{ marginLeft: 'auto', ...
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

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />
        <FileMenu />
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}>
          {tempo} BPM · {timeSignature.join('/')}
        </span>
      </div>

      {/* 본문: 좌 패널 · 중앙 캔버스 · 우 인스펙터 */}
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
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-lo)' }}>
              Play 믹서 (다음 계획)
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

- [ ] **Step 4: 전체 테스트 통과 확인**

Run:
```bash
pnpm --filter @sculptone/web test
```
Expected: 기존 테스트 모두 PASS + 신규 테스트(storage, files, useAutosave, FileMenu, ProjectList) PASS.

- [ ] **Step 5: 타입체크 + 빌드 확인**

Run:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/web build
```
Expected: 타입 에러 없음, 빌드 성공.

---

## Task 10: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

Run:
```bash
pnpm -r test
```
Expected: score-model + sound-engine + web 전 패키지 모든 테스트 PASS.
- score-model: 기존 11개 + midi.ts 신규 13개 = 24개
- sound-engine: 기존 6개
- web: 기존 57개 + storage(6) + files(3) + useAutosave(3) + FileMenu(4) + ProjectList(3) = 76개

- [ ] **Step 2: score-model 빌드 확인**

Run:
```bash
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```
Expected: 타입 에러 없음.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test`가 전 패키지에서 통과한다.
- `projectToMidi` → MIDI bytes → `midiToProject` 라운드트립이 pitch/start/duration/velocity/tempo/ppq를 보존함을 자동 테스트가 증명한다.
- IndexedDB(fake-indexeddb)에서 saveProject/loadProject/listProjects/deleteProject가 모두 테스트된다.
- 툴바에 New/Export MIDI/Export JSON/Import MIDI 버튼이 존재하고 각 동작이 단위 테스트로 검증된다.
- AppShell이 project 변경 시 800ms 디바운스 후 자동저장한다(useAutosave 테스트).
- 기존 AppShell.test.tsx / AppShell.compose.test.tsx 가 깨지지 않는다(useAutosave 모킹으로 보호).
- 하드코딩 hex 없음 — FileMenu/ProjectList/AppShell의 신규 색상은 CSS 변수만 사용.
- tsc --noEmit 타입 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후 별도 작성)

- **계획 4 — 멀티트랙·믹서·Web MIDI:** Play 모드 믹서 패널, 트랙 추가/삭제 UI, Web MIDI 실시간 녹음 입력.
- **계획 5 — MusicXML 내보내기:** MusicXML 어댑터 구현(score-model), Export 버튼 추가.

---

## 열린 질문

1. **`@tonejs/midi` TempoEvent 타입:** `{ ticks, bpm, time }` 세 필드가 모두 required 인지 확인 필요. `time: 0` 포함 시 TypeScript 허용 여부 — 실패하면 `as unknown as TempoEvent` 캐스팅 또는 `as never` 사용.
2. **velocity=0 노트:** MIDI 표준에서 velocity 0는 note-off로 처리되는 경우가 있다. `@tonejs/midi`가 이를 어떻게 처리하는지 — 라운드트립 테스트에서 ±1 허용 범위 조정 필요 가능.
3. **ProjectList UI 진입점:** 현재 계획에서 ProjectList는 컴포넌트로 구현되지만, AppShell 어디에 배치할지(FileMenu 옆 드롭다운, 모달 등)는 구현 에이전트가 판단. 최소 구현은 툴바에 "Open" 버튼 + 드롭다운으로 충분.
4. **fake-indexeddb v6+ 호환성:** fake-indexeddb v6은 `fake-indexeddb/auto`가 ESM에서 다르게 동작할 수 있음. 설치 후 `import indexedDB from 'fake-indexeddb'` 방식이 필요하면 `storage.ts`에 factory injection 옵션 추가 고려.
5. **idb 캐싱 전략:** 현재 `getDB()`는 매 호출마다 `openDB`를 부른다(캐싱 없음). 프로덕션 성능을 위해 모듈 레벨 singleton 도입 고려(단, 테스트 격리를 위한 리셋 메커니즘 필요).
