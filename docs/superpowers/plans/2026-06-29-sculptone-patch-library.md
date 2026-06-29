# Sculptone 패치 라이브러리 — 커스텀 패치 저장/명명/불러오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 커스텀 패치(sound.kind === 'patch')를 이름 붙여 IndexedDB에 저장하고, SoundDesignPanel 내 PatchLibrary 서브패널에서 불러오기·삭제할 수 있게 한다. 패치 저장 레이어(`patch-storage.ts`)는 기존 `storage.ts`(projects store)와 동일 IndexedDB 'sculptone'을 공유하되, **버전 충돌 없이** 공존한다. 기존 326개 테스트를 보존한다.

**Architecture:** `_db.ts` 공유 DB 모듈(v2, projects+patches 두 store)을 도입해 버전/upgrade 충돌을 회피한다. `storage.ts`는 `_db.ts`에서 `getDB`를 import하도록 소규모 리팩토링(동작 변경 없음). `patch-storage.ts`는 fake-indexeddb 완전 TDD. `PatchLibrary.tsx`는 SoundDesignPanel 내 임베드, 레퍼런스 구현 + `@testing-library/react` 테스트. 기존 `SoundDesignPanel.test.tsx`는 `PatchLibrary`를 mock해 기존 12개 테스트를 보존하고 2개를 추가한다.

**Tech Stack:** `idb`(기설치) · `fake-indexeddb`(기설치) · Vitest(jsdom) · React + TypeScript · Zustand · Zod(SoundSchema 검증)

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** 사운드 디자인 계획 `docs/superpowers/plans/2026-06-29-sculptone-sound-design.md`, 영속성 계획 `docs/superpowers/plans/2026-06-29-sculptone-persistence-export.md`.

---

## 비목표 (이 계획에서 하지 말 것)

- 패치 공유/클라우드(협업 P3)
- 패치 카테고리/태그/검색
- 패치 미리듣기 일괄
- 기본 프리셋 팩 번들
- 오실레이터/모듈레이션 편집(별도 계획)
- import/export 패치 파일(.json)
- 백엔드

---

## 설계 근거

### DB 버전/Store 공존 충돌 회피 (핵심)

현재 `storage.ts`는 DB 'sculptone'을 `DB_VERSION = 1`로 열고 'projects' store만 관리한다. `patch-storage.ts`가 동일 DB를 독립적으로 `DB_VERSION = 2`로 열면:

1. 두 모듈이 각자 `dbPromise`를 캐싱하므로 **두 개의 IDB 연결이 동시에 존재**한다.
2. v2 연결이 upgrade를 요청할 때 기존 v1 연결에 `versionchange` 이벤트가 발생한다.
3. v1 연결의 `terminated()` 콜백이 실행돼 `dbPromise = null`로 리셋되고, 이후 v1 연결로 하는 `saveProject` 등이 재연결 시 또 upgrade를 받아 무한 충돌 가능성이 생긴다.

**해결:** `apps/web/src/io/_db.ts` 공유 DB 모듈을 도입한다.

- 단일 `dbPromise` 캐시, `DB_VERSION = 2`
- `upgrade(db, oldVersion)` 핸들러가 두 store를 모두 관리:
  - `if (oldVersion < 1)` → 'projects' store 생성
  - `if (oldVersion < 2)` → 'patches' store 생성
- `__resetDB()` 를 이곳에서 정의
- `storage.ts`는 `_db.ts`에서 `getDB`, `__resetDB`를 import하도록 교체(SculptoneDB 인터페이스도 통합)
- `storage.ts`는 `__resetDB`를 re-export → **`storage.test.ts` import 경로 변경 없이 호환 유지**
- `patch-storage.ts`도 `_db.ts`에서 `getDB`를 import

**기존 `storage.test.ts` 영향:** 각 테스트 전에 `__resetDB()` + `new IDBFactory()`로 fresh DB를 만들어 oldVersion = 0에서 시작하므로, upgrade에서 'projects'와 'patches' 두 store를 모두 생성한다. 'projects' store 동작은 동일하므로 기존 7개 테스트는 영향받지 않는다.

### savePatch 레코드 스키마

```ts
{ id: string, name: string, soundJson: string, createdAt: string }
```

`soundJson = JSON.stringify(sound)`. `loadPatch` 시 `SoundSchema.parse(JSON.parse(record.soundJson))`로 zod 검증. 손상된 레코드는 throw된다(호출부에서 핸들). `SoundSchema`는 `@sculptone/score-model`에서 이미 export됨.

### UI 통합

`PatchLibrary.tsx`를 `SoundDesignPanel.tsx`의 **patch 모드 섹션 안에만** 임베드한다. PatchLibrary는 두 파트로 구성된다:

1. **Save 섹션:** 이름 입력 input + "Save" 버튼(빈 이름이면 disabled). 클릭 시 `savePatch(name, currentSound)`.
2. **목록 섹션:** `listPatches()` 결과를 각 항목에 "Load" / "✕(Delete)" 버튼으로 렌더. Load 클릭 시 `loadPatch(id)` → `updateTrackSound` → `setProject`.

preset 모드에서는 PatchLibrary를 렌더하지 않는다("Switch to Patch" 후 patch 모드에서 저장).

### 기존 SoundDesignPanel 테스트 보존 전략

`SoundDesignPanel.test.tsx`에 `vi.mock('../PatchLibrary', ...)` 모킹을 추가해 PatchLibrary 렌더를 격리한다. 기존 12개 테스트는 mock이 null/stub을 반환하므로 영향 없음. PatchLibrary 통합 스모크 2개만 추가.

---

## File Structure

```
apps/web/src/io/
  _db.ts                          # NEW: 공유 DB 모듈 (v2, projects + patches, dbPromise 캐시, __resetDB)
  storage.ts                      # MOD: getDB/__resetDB를 _db.ts에서 import + SculptoneDB 통합(소규모 리팩)
  patch-storage.ts                # NEW: patches store CRUD (savePatch/listPatches/loadPatch/deletePatch)
  test/
    storage.test.ts               # NO CHANGE (호환 유지, __resetDB 경로 불변, 7개 PASS)
    patch-storage.test.ts         # NEW: 9개 완전 TDD (fake-indexeddb)

apps/web/src/sound/
  PatchLibrary.tsx                # NEW: Save/목록/Load/Delete UI 컴포넌트
  SoundDesignPanel.tsx            # MOD: PatchLibrary import + patch 섹션에 통합 (최소 변경)
  test/
    PatchLibrary.test.tsx         # NEW: 6개 (fake-indexeddb 통합 테스트)
    SoundDesignPanel.test.tsx     # MOD: PatchLibrary mock 추가 + 통합 스모크 2개 추가
```

---

## Task 1: `_db.ts` 공유 DB 모듈 + `storage.ts` 리팩토링

**Files:** Create `apps/web/src/io/_db.ts`; Modify `apps/web/src/io/storage.ts`

이 태스크는 동작 변경 없는 리팩토링이다. 기존 7개 `storage.test.ts`가 모두 PASS로 확인하는 것이 완료 기준이다.

- [ ] **Step 1: `_db.ts` 작성**

Create `apps/web/src/io/_db.ts`:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * IndexedDB 스키마 정의.
 * v1: projects store
 * v2: patches store 추가
 */
export interface SculptoneDB extends DBSchema {
  projects: {
    key: string
    value: {
      id:        string
      title:     string
      updatedAt: string
      data:      string   // serializeProject(project) JSON 문자열
    }
  }
  patches: {
    key: string
    value: {
      id:        string
      name:      string
      soundJson: string   // JSON.stringify(Sound)
      createdAt: string
    }
  }
}

export const DB_NAME    = 'sculptone'
export const DB_VERSION = 2

/**
 * DB 연결을 모듈 레벨에서 캐싱한다(매 CRUD마다 새 연결 생성 방지).
 * storage.ts와 patch-storage.ts가 이 함수를 공유해 단일 연결만 유지,
 * versionchange 충돌을 방지한다.
 */
let dbPromise: Promise<IDBPDatabase<SculptoneDB>> | null = null

export function getDB(): Promise<IDBPDatabase<SculptoneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SculptoneDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 이전: projects store 생성
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' })
        }
        // v2 이전: patches store 추가
        if (oldVersion < 2) {
          db.createObjectStore('patches', { keyPath: 'id' })
        }
      },
      terminated() {
        // 연결이 강제 종료되면 캐시를 리셋해 다음 getDB() 시 재연결
        dbPromise = null
      },
    })
  }
  return dbPromise
}

/**
 * 테스트 격리용: 캐시된 DB 연결 프라미스를 리셋한다.
 * storage.ts가 이를 re-export하므로 storage.test.ts의 import 경로가 변경되지 않는다.
 */
export function __resetDB(): void {
  dbPromise = null
}
```

- [ ] **Step 2: `storage.ts` 리팩토링**

Replace `apps/web/src/io/storage.ts`:

```ts
import { type IDBPDatabase } from 'idb'
import { getDB, type SculptoneDB } from './_db'
import { serializeProject, deserializeProject, type Project } from '@sculptone/score-model'

// storage.test.ts 호환 유지: __resetDB를 이 모듈에서 re-export한다.
// (storage.test.ts는 '../storage'에서 __resetDB를 import하므로 경로 변경 불필요)
export { __resetDB } from './_db'

// 타입 참조용: IDBPDatabase<SculptoneDB> 에서 projects store 접근
type DB = IDBPDatabase<SculptoneDB>
const STORE_NAME = 'projects' as const

/** 프로젝트를 IndexedDB에 저장(upsert). 직렬화는 serializeProject 사용. */
export async function saveProject(project: Project): Promise<void> {
  const db: DB = await getDB()
  // 저장 시각으로 updatedAt을 스탬프 → 레코드와 직렬화 데이터에 동일 값 사용.
  const now = new Date().toISOString()
  const stamped: Project = {
    ...project,
    metadata: { ...project.metadata, updatedAt: now },
  }
  await db.put(STORE_NAME, {
    id:        stamped.id,
    title:     stamped.metadata.title,
    updatedAt: now,
    data:      serializeProject(stamped),
  })
}

/** ID로 프로젝트 로드. 없으면 undefined. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const db: DB  = await getDB()
  const record  = await db.get(STORE_NAME, id)
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
  const db: DB = await getDB()
  const all    = await db.getAll(STORE_NAME)
  return all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** 프로젝트 삭제 */
export async function deleteProject(id: string): Promise<void> {
  const db: DB = await getDB()
  await db.delete(STORE_NAME, id)
}
```

> **리팩토링 노트:** `SculptoneDB` 인터페이스가 `_db.ts`로 이동했으므로 `storage.ts`의 로컬 interface는 제거한다. `dbPromise`, `openDB` import, `upgrade` 함수도 제거된다. `db.put(STORE_NAME, ...)` 호출의 타입은 `SculptoneDB['projects']['value']`로 추론되어 기존과 동일하게 동작한다.

- [ ] **Step 3: 기존 storage 테스트 통과 확인**

```bash
pnpm --filter @sculptone/web test -- storage
```

Expected: storage.test.ts 7개 **모두 PASS**. `__resetDB`가 `storage`에서 re-export되어 import 경로 변경 없이 동작. DB가 oldVersion=0에서 v2로 업그레이드되어 'projects'와 'patches' 두 store가 모두 생성되지만, 기존 7개 테스트는 'projects' store만 사용하므로 행동 변화 없음.

---

## Task 2: `patch-storage.ts` 완전 TDD

**Files:** Create `apps/web/src/io/patch-storage.ts`, `apps/web/src/io/test/patch-storage.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/io/test/patch-storage.test.ts`:

```ts
// fake-indexeddb/auto: IDBRequest · IDBDatabase 등 instanceof 검사용 전역 설정
import 'fake-indexeddb/auto'
// 테스트별 새 IDBFactory 인스턴스 → 연결 블록 없이 완전 격리
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, it, expect } from 'vitest'
import {
  savePatch, listPatches, loadPatch, deletePatch,
  type SavedPatch, type PatchSummary,
} from '../patch-storage'
// __resetDB는 storage.ts에서 re-export하므로 기존 storage.test.ts와 동일 경로
import { saveProject, loadProject, __resetDB } from '../storage'
import {
  createEmptyProject, createTrack, createNote,
  addTrack, addNote,
} from '@sculptone/score-model'
import type { Sound } from '@sculptone/score-model'

// ── 픽스처 ─────────────────────────────────────────────────────

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

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

const PRESET_SOUND: Sound = { kind: 'preset', presetId: 'acoustic-piano' }

function makeProject(title = 'Test') {
  const t = createTrack('Piano')
  const n = createNote({ pitch: 60, start: 0, duration: 480, velocity: 96 })
  return addNote(addTrack(createEmptyProject(title), t), t.id, n)
}

// 각 테스트 전에 캐시된 DB 연결을 리셋하고 새 IDBFactory 인스턴스로 교체 → 완전 격리
beforeEach(() => {
  __resetDB()
  globalThis.indexedDB = new IDBFactory()
})

// ── patch-storage 단위 테스트 ───────────────────────────────────

describe('patch-storage', () => {
  it('savePatch → loadPatch가 동일한 Sound를 복원한다(BASE_PATCH)', async () => {
    const saved = await savePatch('My Lead', BASE_PATCH)
    expect(saved.id).toBeTruthy()
    expect(saved.name).toBe('My Lead')
    const loaded = await loadPatch(saved.id)
    expect(loaded).toBeDefined()
    expect(loaded).toEqual(BASE_PATCH)
  })

  it('filter + effects 포함 FULL_PATCH도 무손실 복원된다', async () => {
    const saved  = await savePatch('Full Patch', FULL_PATCH)
    const loaded = await loadPatch(saved.id)
    expect(loaded).toEqual(FULL_PATCH)
  })

  it('preset sound도 저장·복원된다', async () => {
    const saved  = await savePatch('Piano Preset', PRESET_SOUND)
    const loaded = await loadPatch(saved.id)
    expect(loaded).toEqual(PRESET_SOUND)
  })

  it('존재하지 않는 id는 undefined를 반환한다', async () => {
    const result = await loadPatch('no-such-id')
    expect(result).toBeUndefined()
  })

  it('listPatches가 저장된 요약 목록을 반환한다(name 포함)', async () => {
    await savePatch('Patch A', BASE_PATCH)
    await savePatch('Patch B', { ...BASE_PATCH, engine: 'fm' as const })
    const list = await listPatches()
    expect(list).toHaveLength(2)
    const names = list.map((p) => p.name)
    expect(names).toContain('Patch A')
    expect(names).toContain('Patch B')
  })

  it('listPatches 결과에는 soundJson이 포함되지 않는다', async () => {
    await savePatch('Test', BASE_PATCH)
    const list = await listPatches()
    expect(list[0]).toHaveProperty('id')
    expect(list[0]).toHaveProperty('name', 'Test')
    expect(list[0]).toHaveProperty('createdAt')
    expect((list[0] as unknown as Record<string, unknown>)['soundJson']).toBeUndefined()
  })

  it('deletePatch 후 loadPatch는 undefined를 반환한다', async () => {
    const saved = await savePatch('To Delete', BASE_PATCH)
    await deletePatch(saved.id)
    expect(await loadPatch(saved.id)).toBeUndefined()
  })

  it('빈 name으로 savePatch 시 Error를 throw한다', async () => {
    await expect(savePatch('', BASE_PATCH)).rejects.toThrow()
    await expect(savePatch('   ', BASE_PATCH)).rejects.toThrow()
  })

  // ── 공존 검증: projects store와 patches store가 같은 DB에서 독립 동작 ──

  it('[공존] saveProject와 savePatch가 같은 DB에서 독립적으로 동작한다', async () => {
    const project = makeProject('Co-exist Project')
    await saveProject(project)
    await savePatch('Co-exist Patch', BASE_PATCH)

    // projects store 정상
    const loadedProject = await loadProject(project.id)
    expect(loadedProject).toBeDefined()
    expect(loadedProject!.metadata.title).toBe('Co-exist Project')
    expect(loadedProject!.tracks[0]!.notes[0]!.pitch).toBe(60)

    // patches store 정상
    const patches = await listPatches()
    expect(patches).toHaveLength(1)
    expect(patches[0]!.name).toBe('Co-exist Patch')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- patch-storage
```

Expected: FAIL — `'../patch-storage'` 모듈 없음.

- [ ] **Step 3: `patch-storage.ts` 구현**

Create `apps/web/src/io/patch-storage.ts`:

```ts
import { getDB } from './_db'
import { SoundSchema, type Sound } from '@sculptone/score-model'

const STORE_NAME = 'patches' as const

/** patches store 레코드 전체 (soundJson 포함) */
export interface SavedPatch {
  id:        string
  name:      string
  soundJson: string   // JSON.stringify(Sound)
  createdAt: string   // ISO 8601
}

/** listPatches() 반환 타입 (soundJson 제외 — 목록 표시용) */
export interface PatchSummary {
  id:        string
  name:      string
  createdAt: string
}

/**
 * 커스텀 패치를 이름 붙여 IndexedDB에 저장한다.
 * id는 자동 생성(crypto.randomUUID).
 * @throws {Error} name이 빈 문자열(또는 공백만)일 때
 */
export async function savePatch(name: string, sound: Sound): Promise<SavedPatch> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Patch name must not be empty')

  const db = await getDB()
  const record: SavedPatch = {
    id:        crypto.randomUUID(),
    name:      trimmed,
    soundJson: JSON.stringify(sound),
    createdAt: new Date().toISOString(),
  }
  await db.put(STORE_NAME, record)
  return record
}

/**
 * 저장된 패치 요약 목록을 반환한다 (soundJson 제외).
 * createdAt 오름차순으로 정렬한다(먼저 저장된 항목이 상단).
 */
export async function listPatches(): Promise<PatchSummary[]> {
  const db  = await getDB()
  const all = await db.getAll(STORE_NAME)
  return all
    .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * id로 패치의 Sound 객체를 로드한다. 없으면 undefined.
 * soundJson을 SoundSchema.parse로 검증해 타입 안전성을 보장한다.
 * @throws {ZodError} 레코드가 손상되어 SoundSchema를 통과하지 못할 때
 */
export async function loadPatch(id: string): Promise<Sound | undefined> {
  const db     = await getDB()
  const record = await db.get(STORE_NAME, id)
  if (!record) return undefined
  // Zod 검증: 저장 시점 이후 스키마 변경이 있더라도 안전하게 파싱
  return SoundSchema.parse(JSON.parse(record.soundJson))
}

/** 패치 삭제 */
export async function deletePatch(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- patch-storage
```

Expected: patch-storage.test.ts 9개 PASS. 공존 테스트(마지막)도 PASS — saveProject/savePatch 모두 동일 DB에서 독립 동작.

- [ ] **Step 5: 전체 web 테스트 통과 확인(기존 깨짐 없음)**

```bash
pnpm --filter @sculptone/web test
```

Expected: 기존 206개 + 신규 9개 = 215개 PASS. storage.test.ts 7개도 그대로 PASS.

---

## Task 3: `PatchLibrary.tsx` 레퍼런스 구현 + TDD

**Files:** Create `apps/web/src/sound/PatchLibrary.tsx`, `apps/web/src/sound/test/PatchLibrary.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/sound/test/PatchLibrary.test.tsx`:

```tsx
// fake-indexeddb/auto: instanceof 검사용 전역 설정
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { __resetDB } from '../../io/storage'
import { PatchLibrary } from '../PatchLibrary'
import type { Sound } from '@sculptone/score-model'

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

// 각 테스트 전에 DB 격리 + store 초기화
beforeEach(() => {
  __resetDB()
  globalThis.indexedDB = new IDBFactory()
  useStore.setState(useStore.getInitialState(), true)
  vi.clearAllMocks()
})

describe('PatchLibrary', () => {
  function getTrackId() {
    return useStore.getState().selectedTrackId
  }

  it('초기에는 "저장된 패치 없음" 메시지를 표시한다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await waitFor(() => {
      expect(screen.getByText(/저장된 패치 없음/)).toBeInTheDocument()
    })
  })

  it('Patch name 입력 후 Save 버튼 클릭 시 패치가 목록에 나타난다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await userEvent.type(screen.getByRole('textbox', { name: /patch name/i }), 'My Lead')
    await userEvent.click(screen.getByRole('button', { name: /save patch/i }))
    await waitFor(() => {
      expect(screen.getByText('My Lead')).toBeInTheDocument()
    })
  })

  it('이름이 빈 문자열일 때 Save 버튼이 disabled이다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    // 빈 이름 상태에서 버튼이 disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save patch/i })).toBeDisabled()
    })
  })

  it('Load 버튼 클릭 시 해당 sound로 트랙 sound가 갱신된다', async () => {
    // 직접 patch-storage에 저장
    const { savePatch: _savePatch } = await import('../../io/patch-storage')
    await _savePatch('Test Patch', BASE_PATCH)

    const trackId = getTrackId()
    render(<PatchLibrary trackId={trackId} currentSound={BASE_PATCH} />)
    await waitFor(() => screen.getByText('Test Patch'))
    await userEvent.click(screen.getByRole('button', { name: /load patch test patch/i }))
    await waitFor(() => {
      const track = useStore.getState().project.tracks.find((t) => t.id === trackId)
      expect(track?.sound.kind).toBe('patch')
      expect(track?.sound).toEqual(BASE_PATCH)
    })
  })

  it('Delete 버튼 클릭 시 패치가 목록에서 사라진다', async () => {
    const { savePatch: _savePatch } = await import('../../io/patch-storage')
    await _savePatch('To Delete', BASE_PATCH)

    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await waitFor(() => screen.getByText('To Delete'))
    await userEvent.click(screen.getByRole('button', { name: /delete patch to delete/i }))
    await waitFor(() => {
      expect(screen.queryByText('To Delete')).not.toBeInTheDocument()
      expect(screen.getByText(/저장된 패치 없음/)).toBeInTheDocument()
    })
  })

  it('저장 후 이름 입력 필드가 초기화된다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    const input = screen.getByRole('textbox', { name: /patch name/i })
    await userEvent.type(input, 'My Patch')
    await userEvent.click(screen.getByRole('button', { name: /save patch/i }))
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- PatchLibrary
```

Expected: FAIL — `'../PatchLibrary'` 없음.

- [ ] **Step 3: `PatchLibrary.tsx` 레퍼런스 구현**

Create `apps/web/src/sound/PatchLibrary.tsx`:

```tsx
import { useEffect, useState, type ChangeEvent } from 'react'
import { useStore } from '../state/store'
import { updateTrackSound } from '@sculptone/score-model'
import {
  savePatch, listPatches, loadPatch, deletePatch,
  type PatchSummary,
} from '../io/patch-storage'
import type { Sound } from '@sculptone/score-model'

// ── 스타일 상수 ────────────────────────────────────────────────

const labelStyle = {
  fontSize: 11, color: 'var(--text-lo)',
  display: 'block', marginBottom: 4,
  textTransform: 'uppercase' as const, letterSpacing: '.08em',
  margin: 0,
}

const microBtnBase = {
  font: 'inherit', fontSize: 10, fontWeight: 600,
  padding: '2px 8px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)', cursor: 'pointer',
}

// ── 컴포넌트 ──────────────────────────────────────────────────

interface Props {
  trackId: string
  currentSound: Sound
}

/**
 * 패치 라이브러리 패널 — SoundDesignPanel 내 임베드용.
 * - Save 섹션: 이름 input + Save 버튼(빈 이름 = disabled)
 * - 목록 섹션: 저장된 패치 리스트, 각 항목에 Load / Delete 버튼
 */
export function PatchLibrary({ trackId, currentSound }: Props) {
  const project    = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)

  const [patches,   setPatches]   = useState<PatchSummary[]>([])
  const [patchName, setPatchName] = useState('')
  const [saving,    setSaving]    = useState(false)

  const refresh = () => {
    void listPatches().then(setPatches)
  }

  useEffect(() => {
    refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    const trimmed = patchName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await savePatch(trimmed, currentSound)
      setPatchName('')
      refresh()
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async (id: string) => {
    const sound = await loadPatch(id)
    if (sound) setProject(updateTrackSound(project, trackId, sound))
  }

  const handleDelete = async (id: string) => {
    await deletePatch(id)
    refresh()
  }

  return (
    <section aria-label="Patch Library" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── Save 섹션 ── */}
      <p style={labelStyle}>Save Current Patch</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          aria-label="Patch name"
          value={patchName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPatchName(e.target.value)}
          placeholder="Patch name…"
          style={{
            flex: 1, font: 'inherit', fontSize: 11, padding: '4px 6px',
            borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
            background: 'var(--bg-elevated)', color: 'var(--text-mid)',
          }}
        />
        <button
          aria-label="Save patch"
          disabled={!patchName.trim() || saving}
          onClick={() => void handleSave()}
          style={{
            ...microBtnBase,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            opacity: !patchName.trim() || saving ? 0.5 : 1,
          }}
        >
          Save
        </button>
      </div>

      {/* ── Saved Patches 목록 ── */}
      <p style={{ ...labelStyle, marginTop: 6 }}>Saved Patches</p>
      {patches.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-lo)', margin: 0 }}>
          저장된 패치 없음
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {patches.map((patch) => (
            <li
              key={patch.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
            >
              <span style={{
                flex: 1, fontSize: 11, color: 'var(--text-hi)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {patch.name}
              </span>
              <button
                aria-label={`Load patch ${patch.name}`}
                onClick={() => void handleLoad(patch.id)}
                style={{
                  ...microBtnBase,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                }}
              >
                Load
              </button>
              <button
                aria-label={`Delete patch ${patch.name}`}
                onClick={() => void handleDelete(patch.id)}
                style={{
                  ...microBtnBase,
                  background: 'transparent', color: 'var(--text-lo)',
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

> **타입 노트:** React 타입은 네임스페이스 접근(`React.ChangeEvent`, `React.CSSProperties`) 금지. 반드시 `'react'`에서 named import 사용. 위 코드는 `import { useEffect, useState, type ChangeEvent } from 'react'` 형태를 사용한다.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- PatchLibrary
```

Expected: PatchLibrary.test.tsx 6개 PASS.

---

## Task 4: `SoundDesignPanel.tsx` PatchLibrary 통합 + 기존 테스트 보강

**Files:** Modify `apps/web/src/sound/SoundDesignPanel.tsx`, `apps/web/src/sound/test/SoundDesignPanel.test.tsx`

- [ ] **Step 1: SoundDesignPanel.test.tsx에 PatchLibrary mock + 통합 테스트 추가**

`apps/web/src/sound/test/SoundDesignPanel.test.tsx` 상단의 `vi.mock('tone', ...)` 바로 아래에 추가:

```tsx
// PatchLibrary를 mock해 fake-indexeddb 없이 SoundDesignPanel 테스트 격리
vi.mock('../PatchLibrary', () => ({
  PatchLibrary: ({ trackId }: { trackId: string; currentSound: unknown }) => (
    <div data-testid="patch-library-mock" data-track-id={trackId} />
  ),
}))
```

파일 끝에 신규 describe 블록 추가:

```tsx
describe('SoundDesignPanel — PatchLibrary 통합', () => {
  it('patch 모드에서 PatchLibrary(mock)가 렌더된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getByTestId('patch-library-mock')).toBeInTheDocument()
  })

  it('preset 모드에서 PatchLibrary가 렌더되지 않는다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    // 기본 트랙은 preset sound
    render(<SoundDesignPanel />)
    expect(screen.queryByTestId('patch-library-mock')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: 신규 2개 FAIL (`patch-library-mock` data-testid를 찾을 수 없음 — SoundDesignPanel이 아직 PatchLibrary를 import/렌더하지 않음). 기존 13개(12 + 이전에 추가된 슬라이더 min 테스트 등)는 PASS.

- [ ] **Step 3: SoundDesignPanel.tsx에 PatchLibrary 통합**

`apps/web/src/sound/SoundDesignPanel.tsx` 상단 import에 추가:

```tsx
import { PatchLibrary } from './PatchLibrary'
```

patch 모드 섹션(`{sound.kind === 'patch' && (...)}`의 `<>...</>` 안)에서 "Use Preset Instead" 버튼과 Preview 버튼 사이에 PatchLibrary를 삽입한다. 정확한 삽입 위치:

```tsx
{/* 기존: Use Preset Instead 버튼 다음, Preview 버튼(최하단) 전 */}
<button
  aria-label="Use preset instead"
  ...
>
  Use Preset Instead
</button>

{/* ── 신규: Patch Library ── */}
<PatchLibrary trackId={soundPanelTrackId} currentSound={sound} />
```

완성된 patch 섹션 내 PatchLibrary 삽입 diff(컨텍스트로 표시):

```tsx
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

          {/* Patch Library — 저장/불러오기/삭제 */}
          <PatchLibrary trackId={soundPanelTrackId} currentSound={sound} />
        </>
      )}

      {/* 프리뷰 */}
      <button
```

> `PatchLibrary`는 `<>...</>`(patch 모드 Fragment) **안에** 있고 `{/* 프리뷰 */}` 버튼은 **바깥**에 있다. preset 모드에서는 PatchLibrary가 렌더되지 않는다.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- SoundDesignPanel
```

Expected: 기존 13개 + 신규 2개 = 15개 PASS.

---

## Task 5: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected: 전 패키지 PASS.

| 패키지 | 기존 | 신규 | 합계 |
|---|---|---|---|
| @sculptone/score-model | 101 | 0 | 101 |
| @sculptone/sound-engine | 19 | 0 | 19 |
| @sculptone/web | 206 | 17 | 223 |
| **합계** | **326** | **17** | **343** |

신규 17개 내역:
- `patch-storage.test.ts`: 9개
- `PatchLibrary.test.tsx`: 6개
- `SoundDesignPanel.test.tsx` 추가: 2개

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
pnpm --filter @sculptone/score-model exec tsc --noEmit -p tsconfig.json
```

Expected: 타입 에러 없음.

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter @sculptone/web build
```

Expected: 프로덕션 빌드 성공, CSS 변수만 사용(하드코딩 hex 없음).

---

## 완료 기준 (Definition of Done)

- `pnpm -r test`가 전 패키지에서 통과한다(343개 이상).
- `storage.test.ts` 7개가 _db.ts 리팩토링 후에도 그대로 PASS한다.
- `patch-storage.test.ts`의 공존 테스트(`[공존] saveProject와 savePatch`)가 PASS — same DB에서 두 store 독립 동작 증명.
- `savePatch`/`listPatches`/`loadPatch`/`deletePatch` 모두 fake-indexeddb로 단위 테스트.
- PatchLibrary UI: Save(이름 입력 + 저장), Load(트랙 sound 갱신), Delete(목록 제거)가 `@testing-library/react` 테스트로 검증.
- SoundDesignPanel patch 모드에서 PatchLibrary가 렌더되고, preset 모드에서 렌더되지 않음.
- React 타입은 네임스페이스 접근 금지 — `import { type ChangeEvent } from 'react'` 형태만 허용.
- `tsc --noEmit` 타입 에러 없음, 프로덕션 빌드 성공.

---

## 다음 증분 (이 계획 완료 후 별도 작성)

- **패치 export/import (.json):** FileMenu에 "Export Patch Library" / "Import Patches" 버튼 추가, JSON 파일로 patches 배열 직렬화/역직렬화.
- **패치 카테고리/태그:** patches store에 `tags: string[]` 필드 추가, 필터 UI.
- **패치 미리듣기 일괄:** PatchLibrary 목록에 각 항목별 ▶ 미리듣기 버튼.
- **협업/공유:** 서버 저장소 연동(P3).

---

## 열린 질문

1. **`_db.ts` 파일명 컨벤션:** 앞에 `_`를 붙여 내부 모듈임을 표시했다. 프로젝트 컨벤션이 다르면(`db.ts`, `shared-db.ts` 등) 이름 변경 가능 — import 경로만 맞추면 동작 동일.

2. **기존 사용자 데이터 마이그레이션:** 사용자가 이미 v1 DB를 가진 경우(projects 데이터 존재), v2 upgrade 시 'projects' store를 건드리지 않고 'patches' store만 추가된다(`if (oldVersion < 1)` 조건이 false이므로). 따라서 기존 데이터는 보존된다.

3. **`SoundSchema.parse` 예외 처리:** `loadPatch`는 손상된 레코드에서 ZodError를 throw한다. PatchLibrary의 `handleLoad`에서 try/catch로 감싸는 것이 UX상 좋으나, 레퍼런스 구현은 단순화를 위해 생략했다. 구현 에이전트 판단으로 `try { ... } catch { console.error(...) }` 추가 가능.

4. **PatchLibrary에서 patch-storage 직접 import:** `PatchLibrary.test.tsx`는 fake-indexeddb를 사용하는 통합 테스트다. 테스트 실행 속도가 문제가 되면 `patch-storage`를 mock하는 순수 단위 테스트로 전환 가능하나, 현재는 실제 IndexedDB 흐름 검증이 더 가치 있다.

5. **`listPatches` createdAt 정렬:** 동일 ms 내에 여러 패치를 저장하면 순서가 불안정할 수 있다. 필요 시 `id` 기반 2차 정렬 추가 가능.
