# Sculptone Cloud Sync (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Supabase Postgres를 사용해 로그인 사용자의 프로젝트를 클라우드에 동기화한다. local-first(IndexedDB) 구조를 보존하며 클라우드는 가산적 레이어다. 미로그인/미설정 전 구간 no-op, graceful degradation. Last-write-wins (ISO `updated_at` 비교). 삭제 전파 없음(안전 우선).

**Architecture:** 4-레이어 구조.
1. `reconcile.ts` — 순수 LWW 조정 함수. 의존 없음.
2. `projectsRepo.ts` — Supabase 어댑터. `supabase null` 시 no-op.
3. `sync.ts` — 오케스트레이터. storage + reconcile + repo + authStore 엮음. `syncNow()` + 디바운스 `pushProject()`.
4. 배선 — `useCloudSync.ts`(signedIn → syncNow), `useAutosave.ts` 수정(push after save), AppShell 마운트.
`storage.ts`에 `saveProjectRaw`(타임스탬프 보존) 추가 — 다운로드 후 무한 재업로드 방지.

**Mock 전략 요약:**
- `reconcile.ts` 테스트: mock 없음(순수 함수).
- `projectsRepo.ts` 테스트: `vi.mock('../supabase', ...)` + 수동 Supabase 쿼리 빌더 mock (`{ from, select, upsert, delete, eq }` vi.fn 체인). null-safe 경로는 별도 파일 분리.
- `sync.ts` 테스트: `vi.mock('../projectsRepo', ...)` + `vi.mock('../../io/storage', ...)` + `vi.mock('../supabase', ...)`. `useAuthStore.setState`로 authStore 직접 제어. 디바운스 테스트: `vi.useFakeTimers()`.
- `useCloudSync.test.ts`: `vi.mock('../sync', ...)` + `useAuthStore.setState` + jsdom 렌더.

**Tech Stack:** React 18 + TS · Zustand 4 · @supabase/supabase-js · Vitest 2.1.9(jsdom) · @testing-library/react · idb

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `apps/web/src/cloud/supabase.ts` — `supabase: SupabaseClient | null`, `isCloudConfigured(): boolean`
> - `apps/web/src/cloud/authStore.ts` — `useAuthStore`, `AuthStatus`, `AuthUser`
> - `apps/web/src/io/storage.ts` — `saveProject`, `loadProject`, `listProjects` (`ProjectSummary`), `deleteProject`
> - `apps/web/src/io/_db.ts` — `getDB`, `__resetDB`
> - `@sculptone/score-model` — `Project`, `serializeProject`, `deserializeProject`
> - Sub-project A 테스트 전부 통과 상태

---

## 비목표 (이 계획에서 하지 말 것)

- Sub-project C: 프로젝트 공유 / 공개 링크
- 실시간 공동편집 (Yjs/CRDT)
- 필드 단위 병합 / 충돌 UI
- 삭제 동기화 (로컬↔클라우드 삭제 전파)
- 자동 재시도 루프 (재시도는 다음 sync 기회에 자연 수렴)
- 오프라인 감지 (navigator.onLine 구독)
- Supabase Storage 파일 저장
- **인프라/CI 파일 변경** (`.github/`, 루트 설정, eslint/prettier 설정, `allowedBuilds`)
- `packages/score-model`, `packages/sound-engine` 수정

---

## 설계 근거

### saveProjectRaw 필요성

`saveProject`는 저장 시 `updatedAt = new Date().toISOString()`으로 재발급한다. 다운로드한 프로젝트를 `saveProject`로 저장하면 로컬 `updatedAt`이 클라우드 `updated_at`보다 커져, 다음 reconcile에서 "로컬 최신"으로 판정 → 불필요한 재업로드 발생. `saveProjectRaw`는 `project.metadata.updatedAt`을 그대로 IDB에 저장해 이 문제를 방지한다.

### reconcile LWW ISO 문자열 비교

ISO 8601 UTC 문자열(`YYYY-MM-DDTHH:mm:ss.sssZ`)은 사전식 비교와 시간 비교가 동치다. JavaScript `<`, `>` 연산자로 직접 비교 가능.

Tie-break (`===`): 두 버전이 같은 타임스탬프이면 내용이 동일하다고 가정 → 아무 동작 없음. 가장 안전한 tie-break.

### sync.ts와 authStore 순환 의존 방지

`sync.ts`가 `authStore`를 import하고, `authStore`가 `sync.ts`를 import하면 순환이 발생한다(현재는 없지만 미래 확장 시 위험). `useCloudSync.ts` React 훅으로 분리해 authStore 구독을 sync.ts 외부에 위치시킨다.

### pushProject 디바운스 패턴

```typescript
let pushTimer: ReturnType<typeof setTimeout> | null = null

export function pushProject(project: Project): void {
  const { status, user } = useAuthStore.getState()
  if (status !== 'signedIn' || !user || !isCloudConfigured()) return
  if (pushTimer !== null) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    upsertCloudProject(project, user.id).catch(console.error)
  }, PUSH_DEBOUNCE_MS)  // 2000
}
```

모듈 수준 타이머 변수로 디바운스를 구현한다. Vitest fake timers로 2000ms 경과를 시뮬레이션한다.

### Supabase 쿼리 빌더 mock 패턴

```typescript
const mockSelect = vi.fn()
const mockUpsert = vi.fn()
const mockEq = vi.fn()
const mockDelete = vi.fn()
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  upsert: mockUpsert,
  delete: () => ({ eq: mockEq }),
}))
const mockSupabase = { from: mockFrom }

vi.mock('../supabase', () => ({
  supabase: mockSupabase,
  isCloudConfigured: () => true,
}))
```

각 메서드는 `beforeEach`에서 `mockResolvedValue`로 기본 반환값을 설정한다:
```typescript
mockSelect.mockResolvedValue({ data: [], error: null })
mockUpsert.mockResolvedValue({ error: null })
mockEq.mockResolvedValue({ error: null })
```

---

## File Structure

```
supabase/
  migrations/
    0001_projects.sql                NEW: projects DDL + RLS (사용자 수동 적용)

apps/web/
  src/
    cloud/                           (기존 디렉토리)
      reconcile.ts                   NEW: 순수 LWW 조정 함수
      projectsRepo.ts                NEW: Supabase CRUD 어댑터
      sync.ts                        NEW: syncNow + pushProject 엔진
      useCloudSync.ts                NEW: authStore 구독 → syncNow 훅
      test/
        reconcile.test.ts            NEW: 완전 TDD (~10개)
        projectsRepo.test.ts         NEW: mock supabase TDD (~6개)
        projectsRepo.null.test.ts    NEW: null-safe 경로 TDD (~3개)
        sync.test.ts                 NEW: mock repo+storage TDD (~10개)
        useCloudSync.test.tsx        NEW: 스모크 (~3개)

    io/
      storage.ts                     MOD: saveProjectRaw 함수 추가(additive)
      test/
        storage.test.ts              MOD: saveProjectRaw 테스트 추가(~2개)
      useAutosave.ts                 MOD: pushProject 호출 추가(additive)

    shell/
      AppShell.tsx                   MOD: useCloudSync() 호출 추가
```

변경 없는 파일:
- `apps/web/src/cloud/supabase.ts`, `authStore.ts`, `AuthButton.tsx`
- `apps/web/src/state/store.ts`
- `apps/web/src/compose/**`, `apps/web/src/audio/**`, `apps/web/src/io/_db.ts`
- `apps/web/vitest.config.ts`, `apps/web/vite.config.ts`
- `packages/score-model/**`, `packages/sound-engine/**`
- CI/인프라 파일 전체

---

## Task 1: SQL 마이그레이션 파일 + 적용 가이드

**Files:** Create `supabase/migrations/0001_projects.sql`, Create `supabase/README.md`

이 태스크는 사용자가 Supabase에 직접 적용할 SQL 파일을 작성한다. 코드 구현이나 테스트가 없다.

- [ ] **Step 1: 마이그레이션 디렉토리 확인**

```
supabase/migrations/ 디렉토리가 존재하는지 확인(없으면 생성).
```

- [ ] **Step 2: SQL 마이그레이션 파일 작성**

Create `supabase/migrations/0001_projects.sql`:

```sql
-- Sculptone Cloud Sync — projects table
-- Sub-project B: Cloud Project Sync
-- =============================================================================
-- 적용 방법 (택 1):
--   A. Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣기 → Run
--   B. Supabase CLI: supabase db push (supabase 프로젝트 연결 필요)
-- =============================================================================

create table if not exists public.projects (
  id          text         primary key,
  -- Project.id: crypto.randomUUID() 생성. text로 선언해 형식 유연성 유지.

  owner       uuid         not null references auth.users(id) on delete cascade,
  -- Supabase Auth 사용자 UUID. 계정 삭제 시 cascade 삭제.

  title       text         not null default '',
  -- Project.metadata.title.

  data        jsonb        not null,
  -- serializeProject(project)의 JSON.parse() 결과 객체.
  -- 앱은 JSON.stringify(row.data)를 deserializeProject에 전달해 복원한다.

  updated_at  timestamptz  not null,
  -- Project.metadata.updatedAt (ISO 8601 UTC).
  -- LWW 동기화 기준 타임스탬프. saveProject가 updatedAt을 발급하므로
  -- 앱 자체가 이 값의 단일 진실 소스다.

  created_at  timestamptz  not null default now()
  -- 행 최초 삽입 시각. 앱이 쓰지 않으며 감사 목적.
);

-- RLS 활성화: 정책이 하나도 없으면 모든 행 접근 거부.
alter table public.projects enable row level security;

-- ── RLS 정책: 소유자(owner = auth.uid())만 본인 행에 접근 가능 ────────────────

-- SELECT: 본인 행만 조회
create policy "owner can select own projects"
  on public.projects
  for select
  using (auth.uid() = owner);

-- INSERT: owner = 현재 사용자 강제. 다른 사람 행 사칭 불가.
create policy "owner can insert own projects"
  on public.projects
  for insert
  with check (auth.uid() = owner);

-- UPDATE: 본인 행만 수정 가능 + 수정 후에도 owner = 본인(owner 변경 불가).
create policy "owner can update own projects"
  on public.projects
  for update
  using  (auth.uid() = owner)
  with check (auth.uid() = owner);

-- DELETE: 본인 행만 삭제 가능.
-- 참고: 이번 Sub-project B에서 앱이 deleteCloudProject를 호출하지 않음.
-- 이 정책은 미래 삭제 동기화 기능을 위한 예약.
create policy "owner can delete own projects"
  on public.projects
  for delete
  using (auth.uid() = owner);
```

- [ ] **Step 3: README 가이드 작성**

Create `supabase/README.md`:

```markdown
# Supabase 설정 가이드

Sculptone Cloud Sync(Sub-project B)를 사용하려면 Supabase 프로젝트에 아래 마이그레이션을 적용해야 합니다.

## 전제 조건

Sub-project A(인증) 설정이 완료되어 있어야 합니다:
- Supabase 프로젝트 생성됨
- Google/GitHub OAuth provider 활성화됨
- `apps/web/.env.local`에 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` 설정됨

## 마이그레이션 적용

### 방법 A: Supabase 대시보드 (권장)

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속
2. 프로젝트 선택 → SQL Editor
3. `supabase/migrations/0001_projects.sql` 파일 내용 복사 → 붙여넣기 → Run

### 방법 B: Supabase CLI

```bash
# supabase CLI 설치 및 로그인 후:
supabase link --project-ref <your-project-ref>
supabase db push
```

## 검증

마이그레이션 적용 후 Supabase 대시보드 → Table Editor → `projects` 테이블이 생성되었는지 확인합니다.
Row Level Security 탭에서 4개 정책(select/insert/update/delete)이 활성화되었는지 확인합니다.

## 스키마 요약

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | text PK | Project.id (crypto.randomUUID()) |
| `owner` | uuid FK→auth.users | 소유자 |
| `title` | text | Project.metadata.title |
| `data` | jsonb | serializeProject() 출력 (JSON 객체) |
| `updated_at` | timestamptz | Project.metadata.updatedAt |
| `created_at` | timestamptz | 행 삽입 시각 (자동) |
```

---

## Task 2: `reconcile.ts` 순수 로직 — 완전 TDD

**Files:** Create `apps/web/src/cloud/test/reconcile.test.ts`, Create `apps/web/src/cloud/reconcile.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/cloud/test/reconcile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// reconcile은 순수 함수 — mock 없음
import { reconcile } from '../reconcile'
import type { ProjectMeta } from '../reconcile'

// 테스트용 타임스탬프 헬퍼
const T1 = '2026-01-01T00:00:00.000Z'  // 가장 오래됨
const T2 = '2026-06-01T00:00:00.000Z'  // 중간
const T3 = '2026-07-01T12:00:00.000Z'  // 가장 최신

describe('reconcile — LWW 동기화 결정', () => {

  // ── 빈 목록 ──────────────────────────────────────────────────

  it('local 빈 배열 + cloud 빈 배열 → toUpload=[], toDownload=[]', () => {
    expect(reconcile([], [])).toEqual({ toUpload: [], toDownload: [] })
  })

  // ── 단방향: 한쪽에만 존재 ────────────────────────────────────

  it('local에만 있는 프로젝트 → toUpload에 포함', () => {
    const local: ProjectMeta[] = [{ id: 'p1', updatedAt: T2 }]
    const result = reconcile(local, [])
    expect(result.toUpload).toContain('p1')
    expect(result.toDownload).toHaveLength(0)
  })

  it('cloud에만 있는 프로젝트 → toDownload에 포함', () => {
    const cloud: ProjectMeta[] = [{ id: 'p2', updatedAt: T2 }]
    const result = reconcile([], cloud)
    expect(result.toDownload).toContain('p2')
    expect(result.toUpload).toHaveLength(0)
  })

  // ── 양쪽 존재: LWW 비교 ──────────────────────────────────────

  it('양쪽 있음 + 로컬이 더 최신 → toUpload', () => {
    const local: ProjectMeta[] = [{ id: 'p3', updatedAt: T3 }]
    const cloud: ProjectMeta[] = [{ id: 'p3', updatedAt: T2 }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).toContain('p3')
    expect(result.toDownload).not.toContain('p3')
  })

  it('양쪽 있음 + 클라우드가 더 최신 → toDownload', () => {
    const local: ProjectMeta[] = [{ id: 'p4', updatedAt: T1 }]
    const cloud: ProjectMeta[] = [{ id: 'p4', updatedAt: T3 }]
    const result = reconcile(local, cloud)
    expect(result.toDownload).toContain('p4')
    expect(result.toUpload).not.toContain('p4')
  })

  it('양쪽 있음 + 동일 타임스탬프(tie) → 아무것도 없음', () => {
    const local: ProjectMeta[] = [{ id: 'p5', updatedAt: T2 }]
    const cloud: ProjectMeta[] = [{ id: 'p5', updatedAt: T2 }]
    const result = reconcile(local, cloud)
    expect(result.toUpload).not.toContain('p5')
    expect(result.toDownload).not.toContain('p5')
  })

  // ── 단방향: 한쪽이 여러 개 ───────────────────────────────────

  it('로컬 없음 + 클라우드 여러 개 → 전부 toDownload', () => {
    const cloud: ProjectMeta[] = [
      { id: 'a', updatedAt: T1 },
      { id: 'b', updatedAt: T2 },
      { id: 'c', updatedAt: T3 },
    ]
    const result = reconcile([], cloud)
    expect(result.toDownload).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(result.toDownload).toHaveLength(3)
    expect(result.toUpload).toHaveLength(0)
  })

  it('로컬 여러 개 + 클라우드 없음 → 전부 toUpload', () => {
    const local: ProjectMeta[] = [
      { id: 'x', updatedAt: T1 },
      { id: 'y', updatedAt: T3 },
    ]
    const result = reconcile(local, [])
    expect(result.toUpload).toEqual(expect.arrayContaining(['x', 'y']))
    expect(result.toUpload).toHaveLength(2)
    expect(result.toDownload).toHaveLength(0)
  })

  // ── 혼합: 6가지 케이스 동시 ──────────────────────────────────

  it('혼합 시나리오: 로컬전용·클라우드전용·로컬최신·클라우드최신·tie → 각각 올바른 분류', () => {
    const local: ProjectMeta[] = [
      { id: 'local-only',    updatedAt: T2 },  // → toUpload
      { id: 'local-newer',   updatedAt: T3 },  // → toUpload
      { id: 'cloud-newer',   updatedAt: T1 },  // → toDownload
      { id: 'tie',           updatedAt: T2 },  // → 없음
    ]
    const cloud: ProjectMeta[] = [
      { id: 'cloud-only',    updatedAt: T2 },  // → toDownload
      { id: 'local-newer',   updatedAt: T2 },  // → toUpload (로컬 T3 > 클라우드 T2)
      { id: 'cloud-newer',   updatedAt: T3 },  // → toDownload (클라우드 T3 > 로컬 T1)
      { id: 'tie',           updatedAt: T2 },  // → 없음
    ]
    const result = reconcile(local, cloud)

    expect(result.toUpload).toEqual(expect.arrayContaining(['local-only', 'local-newer']))
    expect(result.toUpload).not.toContain('cloud-only')
    expect(result.toUpload).not.toContain('cloud-newer')
    expect(result.toUpload).not.toContain('tie')

    expect(result.toDownload).toEqual(expect.arrayContaining(['cloud-only', 'cloud-newer']))
    expect(result.toDownload).not.toContain('local-only')
    expect(result.toDownload).not.toContain('local-newer')
    expect(result.toDownload).not.toContain('tie')
  })

  // ── 입력 배열 불변성 ────────────────────────────────────────

  it('입력 배열을 변경하지 않는다(순수 함수)', () => {
    const local: ProjectMeta[] = [{ id: 'p', updatedAt: T1 }]
    const cloud: ProjectMeta[] = [{ id: 'q', updatedAt: T2 }]
    const localCopy = [...local]
    const cloudCopy = [...cloud]
    reconcile(local, cloud)
    expect(local).toEqual(localCopy)
    expect(cloud).toEqual(cloudCopy)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- reconcile.test
```

Expected: FAIL — `'../reconcile'` 모듈 없음.

- [ ] **Step 3: `reconcile.ts` 구현**

Create `apps/web/src/cloud/reconcile.ts`:

```typescript
/**
 * 로컬 ↔ 클라우드 프로젝트 목록을 비교해 Last-Write-Wins 동기화 결정을 반환한다.
 *
 * 순수 함수 — 외부 부작용 없음, 입력 배열 불변.
 * ISO 8601 UTC 문자열은 사전식 비교로 시간 비교가 성립한다.
 */

export interface ProjectMeta {
  id: string
  updatedAt: string  // ISO 8601 UTC
}

export interface ReconcileResult {
  toUpload: string[]    // local → cloud: 로컬에만 있거나 로컬이 최신
  toDownload: string[]  // cloud → local: 클라우드에만 있거나 클라우드가 최신
}

export function reconcile(
  local: ProjectMeta[],
  cloud: ProjectMeta[],
): ReconcileResult {
  const localMap = new Map<string, string>(local.map((p) => [p.id, p.updatedAt]))
  const cloudMap = new Map<string, string>(cloud.map((p) => [p.id, p.updatedAt]))

  const toUpload: string[] = []
  const toDownload: string[] = []

  // 로컬 기준: 로컬에만 있거나 로컬이 더 최신이면 upload
  for (const [id, localAt] of localMap) {
    const cloudAt = cloudMap.get(id)
    if (cloudAt === undefined) {
      // 로컬에만 존재 → upload
      toUpload.push(id)
    } else if (localAt > cloudAt) {
      // 양쪽 존재, 로컬 최신 → upload
      toUpload.push(id)
    }
    // localAt === cloudAt: tie → 아무것도 하지 않음
    // localAt < cloudAt: 클라우드 최신 → 아래 루프에서 처리
  }

  // 클라우드 기준: 클라우드에만 있거나 클라우드가 더 최신이면 download
  for (const [id, cloudAt] of cloudMap) {
    const localAt = localMap.get(id)
    if (localAt === undefined) {
      // 클라우드에만 존재 → download
      toDownload.push(id)
    } else if (cloudAt > localAt) {
      // 양쪽 존재, 클라우드 최신 → download
      toDownload.push(id)
    }
    // cloudAt === localAt: tie → 아무것도 하지 않음 (위 루프에서도 처리 안 됨)
    // cloudAt < localAt: 로컬 최신 → 위 루프에서 처리됨
  }

  return { toUpload, toDownload }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- reconcile.test
```

Expected: **10개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 3: `projectsRepo.ts` 어댑터 — mock supabase TDD

**Files:** Create `apps/web/src/cloud/projectsRepo.ts`, Create `apps/web/src/cloud/test/projectsRepo.test.ts`, Create `apps/web/src/cloud/test/projectsRepo.null.test.ts`

- [ ] **Step 1: `projectsRepo.test.ts` 작성 (실패 상태)**

Create `apps/web/src/cloud/test/projectsRepo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Supabase 쿼리 빌더 mock ──────────────────────────────────────────────────
const mockSelect = vi.fn()
const mockUpsert = vi.fn()
const mockEq = vi.fn()
const mockDeleteBuilder = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  upsert: mockUpsert,
  delete: mockDeleteBuilder,
}))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom },
  isCloudConfigured: () => true,
}))

import { fetchCloudProjects, upsertCloudProject, deleteCloudProject } from '../projectsRepo'

// 테스트용 최소 Project 픽스처
const fakeProject: Project = {
  id: 'proj-uuid-1',
  metadata: {
    title: 'Test Song',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

const fakeRows = [
  {
    id: 'proj-uuid-1',
    owner: 'user-abc',
    title: 'Test Song',
    updated_at: '2026-07-01T10:00:00.000Z',
    data: { id: 'proj-uuid-1', metadata: { title: 'Test Song', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' }, transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' }, tracks: [] },
  },
]

describe('projectsRepo — configured (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockResolvedValue({ data: [], error: null })
    mockUpsert.mockResolvedValue({ error: null })
    mockEq.mockResolvedValue({ error: null })
  })

  // ── fetchCloudProjects ───────────────────────────────────────

  it('fetchCloudProjects() → from("projects").select("id,owner,title,updated_at,data") 호출', async () => {
    mockSelect.mockResolvedValue({ data: fakeRows, error: null })
    await fetchCloudProjects()
    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockSelect).toHaveBeenCalledWith('id, owner, title, updated_at, data')
  })

  it('fetchCloudProjects() → 반환된 rows를 CloudProjectRow[]로 반환', async () => {
    mockSelect.mockResolvedValue({ data: fakeRows, error: null })
    const result = await fetchCloudProjects()
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('proj-uuid-1')
    expect(result[0]!.updated_at).toBe('2026-07-01T10:00:00.000Z')
  })

  it('fetchCloudProjects() 에러 → [] 반환, console.error 호출', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'network fail' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await fetchCloudProjects()
    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  // ── upsertCloudProject ───────────────────────────────────────

  it('upsertCloudProject(project, ownerId) → from("projects").upsert() 호출, 올바른 payload', async () => {
    const ownerId = 'user-abc'
    await upsertCloudProject(fakeProject, ownerId)

    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [payload, options] = mockUpsert.mock.calls[0] as [unknown, unknown]
    const row = payload as Record<string, unknown>
    expect(row['id']).toBe(fakeProject.id)
    expect(row['owner']).toBe(ownerId)
    expect(row['title']).toBe(fakeProject.metadata.title)
    expect(row['updated_at']).toBe(fakeProject.metadata.updatedAt)
    // data는 serializeProject → JSON.parse() 결과이므로 객체여야 함
    expect(typeof row['data']).toBe('object')
    expect(row['data']).not.toBeNull()
    expect((options as Record<string, unknown>)['onConflict']).toBe('id')
  })

  it('upsertCloudProject() 에러 → rethrow', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'RLS denied' } })
    await expect(upsertCloudProject(fakeProject, 'user-abc')).rejects.toThrow()
  })

  // ── deleteCloudProject ───────────────────────────────────────

  it('deleteCloudProject(id) → from("projects").delete().eq("id", id) 호출', async () => {
    await deleteCloudProject('proj-uuid-1')
    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockDeleteBuilder).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('id', 'proj-uuid-1')
  })
})
```

- [ ] **Step 2: `projectsRepo.null.test.ts` 작성**

Create `apps/web/src/cloud/test/projectsRepo.null.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Project } from '@sculptone/score-model'

// supabase null → disabled 모드
vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

import { fetchCloudProjects, upsertCloudProject, deleteCloudProject } from '../projectsRepo'

const fakeProject: Project = {
  id: 'p1',
  metadata: { title: 'T', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('projectsRepo — disabled (supabase null)', () => {
  it('fetchCloudProjects() → [] 반환 (no-op)', async () => {
    await expect(fetchCloudProjects()).resolves.toEqual([])
  })

  it('upsertCloudProject() → undefined 반환 (no-op)', async () => {
    await expect(upsertCloudProject(fakeProject, 'user-1')).resolves.toBeUndefined()
  })

  it('deleteCloudProject() → undefined 반환 (no-op)', async () => {
    await expect(deleteCloudProject('p1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- projectsRepo
```

Expected: FAIL — `'../projectsRepo'` 모듈 없음.

- [ ] **Step 4: `projectsRepo.ts` 구현**

Create `apps/web/src/cloud/projectsRepo.ts`:

```typescript
import { serializeProject, type Project } from '@sculptone/score-model'
import { supabase } from './supabase'

/** Supabase `projects` 테이블 행 타입 (클라이언트 반환 형태) */
export interface CloudProjectRow {
  id: string
  owner: string
  title: string
  updated_at: string  // ISO 8601 (Supabase가 timestamptz를 ISO string으로 반환)
  data: unknown       // jsonb: deserializeProject(JSON.stringify(data)) 로 복원
}

/**
 * 현재 사용자의 모든 클라우드 프로젝트를 가져온다.
 * supabase === null(미설정) → [] 반환(no-op).
 * 네트워크 오류 → console.error + [] 반환(앱 계속 동작).
 */
export async function fetchCloudProjects(): Promise<CloudProjectRow[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, owner, title, updated_at, data')
    if (error) throw error
    return (data ?? []) as CloudProjectRow[]
  } catch (e) {
    console.error('[projectsRepo] fetchCloudProjects failed:', e)
    return []
  }
}

/**
 * 프로젝트를 클라우드에 upsert한다 (insert or update, onConflict: id).
 * supabase === null → no-op.
 * 오류 → console.error + rethrow (호출자가 재시도 여부 결정).
 */
export async function upsertCloudProject(project: Project, ownerId: string): Promise<void> {
  if (!supabase) return
  const data = JSON.parse(serializeProject(project)) as unknown
  const { error } = await supabase.from('projects').upsert(
    {
      id: project.id,
      owner: ownerId,
      title: project.metadata.title,
      data,
      updated_at: project.metadata.updatedAt,
    },
    { onConflict: 'id' },
  )
  if (error) {
    console.error('[projectsRepo] upsertCloudProject failed:', error)
    throw new Error(error.message)
  }
}

/**
 * 클라우드에서 프로젝트를 삭제한다.
 * supabase === null → no-op.
 * 오류 → console.error + rethrow.
 *
 * NOTE: Sub-project B 에서 sync.ts가 이 함수를 호출하지 않는다.
 * 삭제 동기화는 이번 범위 밖. 미래 기능을 위한 예약 구현.
 */
export async function deleteCloudProject(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) {
    console.error('[projectsRepo] deleteCloudProject failed:', error)
    throw new Error(error.message)
  }
}
```

- [ ] **Step 5: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- projectsRepo
```

Expected:
- `projectsRepo.test.ts`: **6개** PASS
- `projectsRepo.null.test.ts`: **3개** PASS

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 4: `storage.ts` + `sync.ts` 엔진 — TDD

**Files:** Modify `apps/web/src/io/storage.ts`, Modify `apps/web/src/io/test/storage.test.ts`, Create `apps/web/src/cloud/sync.ts`, Create `apps/web/src/cloud/test/sync.test.ts`

### Task 4a: `saveProjectRaw` — storage.ts additive

- [ ] **Step 1: storage.test.ts에 saveProjectRaw 테스트 추가**

기존 `apps/web/src/io/test/storage.test.ts` (또는 해당 경로)에 다음 케이스를 추가한다. 파일 경로가 다를 경우 실제 경로로 조정:

```typescript
// 추가할 테스트 — 기존 describe 블록 끝에 append
describe('saveProjectRaw', () => {
  it('project.metadata.updatedAt을 재발급하지 않고 그대로 저장한다', async () => {
    const project = createEmptyProject('Raw Test')
    // 오래된 타임스탬프를 수동 설정
    const oldTimestamp = '2026-01-01T00:00:00.000Z'
    const projectWithOldTs: Project = {
      ...project,
      metadata: { ...project.metadata, updatedAt: oldTimestamp },
    }
    await saveProjectRaw(projectWithOldTs)
    const summaries = await listProjects()
    const saved = summaries.find((s) => s.id === project.id)
    expect(saved).toBeDefined()
    // 재발급 없이 원래 타임스탬프가 보존되어야 함
    expect(saved!.updatedAt).toBe(oldTimestamp)
  })

  it('saveProjectRaw로 저장한 프로젝트를 loadProject로 복원하면 원본과 일치한다', async () => {
    const project = createEmptyProject('Load Raw Test')
    const ts = '2025-12-31T23:59:59.999Z'
    const stamped: Project = { ...project, metadata: { ...project.metadata, updatedAt: ts } }
    await saveProjectRaw(stamped)
    const loaded = await loadProject(stamped.id)
    expect(loaded).toBeDefined()
    expect(loaded!.metadata.updatedAt).toBe(ts)
  })
})
```

기존 테스트들이 여전히 통과하는지 확인한다:
```bash
pnpm --filter @sculptone/web test -- storage.test
```
Expected: 기존 테스트 모두 PASS + 신규 2개 FAIL (saveProjectRaw 미구현).

- [ ] **Step 2: saveProjectRaw 구현**

`apps/web/src/io/storage.ts` 끝에 추가:

```typescript
/**
 * Cloud sync 전용: project.metadata.updatedAt을 재발급하지 않고 그대로 보존하여 저장.
 * 클라우드에서 다운로드한 프로젝트를 로컬에 반영할 때 사용한다.
 * 이 함수로 저장한 이후 reconcile 시 타임스탬프가 클라우드와 동일 → 재업로드 방지.
 *
 * 일반 사용자 편집 저장에는 saveProject를 사용할 것 (updatedAt 재발급).
 */
export async function saveProjectRaw(project: Project): Promise<void> {
  const db: DB = await getDB()
  await db.put(STORE_NAME, {
    id: project.id,
    title: project.metadata.title,
    updatedAt: project.metadata.updatedAt,  // 재발급 없이 원본 타임스탬프 보존
    data: serializeProject(project),         // project.metadata.updatedAt 포함된 채 직렬화
  })
}
```

- [ ] **Step 3: storage.test.ts 전체 통과 확인**

```bash
pnpm --filter @sculptone/web test -- storage.test
```

Expected: 기존 + 신규 2개 모두 PASS.

---

### Task 4b: `sync.ts` 엔진 — 완전 TDD

- [ ] **Step 4: `sync.test.ts` 작성 (실패 상태)**

Create `apps/web/src/cloud/test/sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Mock: projectsRepo ───────────────────────────────────────────────────────
const mockFetchCloudProjects = vi.fn()
const mockUpsertCloudProject = vi.fn()

vi.mock('../projectsRepo', () => ({
  fetchCloudProjects: mockFetchCloudProjects,
  upsertCloudProject: mockUpsertCloudProject,
}))

// ── Mock: storage ────────────────────────────────────────────────────────────
const mockListProjects = vi.fn()
const mockLoadProject = vi.fn()
const mockSaveProjectRaw = vi.fn()

vi.mock('../../io/storage', () => ({
  listProjects: mockListProjects,
  loadProject: mockLoadProject,
  saveProjectRaw: mockSaveProjectRaw,
}))

// ── Mock: supabase (isCloudConfigured) ───────────────────────────────────────
let _isConfigured = true
vi.mock('../supabase', () => ({
  supabase: {},
  isCloudConfigured: () => _isConfigured,
}))

// ── authStore: setState로 직접 제어 ─────────────────────────────────────────
import { useAuthStore } from '../authStore'
vi.mock('../authStore', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../authStore')>()
  return mod  // 실제 모듈 사용, setState로 상태 제어
})

import { syncNow, pushProject } from '../sync'

// 테스트 픽스처
const T_OLD = '2026-01-01T00:00:00.000Z'
const T_NEW = '2026-07-01T12:00:00.000Z'

const makeProject = (id: string, updatedAt: string): Project => ({
  id,
  metadata: { title: `Project ${id}`, createdAt: T_OLD, updatedAt },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
})

const signedInUser = { id: 'user-abc', email: 'test@test.com', avatarUrl: null }

describe('sync — syncNow()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _isConfigured = true
    mockFetchCloudProjects.mockResolvedValue([])
    mockListProjects.mockResolvedValue([])
    mockLoadProject.mockResolvedValue(undefined)
    mockSaveProjectRaw.mockResolvedValue(undefined)
    mockUpsertCloudProject.mockResolvedValue(undefined)
  })

  // ── Guard: 미로그인/미설정 ───────────────────────────────────

  it('status !== signedIn → no-op (repo 미호출)', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    await syncNow()
    expect(mockFetchCloudProjects).not.toHaveBeenCalled()
    expect(mockListProjects).not.toHaveBeenCalled()
  })

  it('isCloudConfigured() = false → no-op', async () => {
    _isConfigured = false
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    await syncNow()
    expect(mockFetchCloudProjects).not.toHaveBeenCalled()
  })

  // ── Download 경로 ─────────────────────────────────────────────

  it('클라우드에만 있는 프로젝트 → saveProjectRaw 호출 (download)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('cloud-only', T_NEW)
    mockListProjects.mockResolvedValue([])
    mockFetchCloudProjects.mockResolvedValue([{
      id: 'cloud-only',
      owner: signedInUser.id,
      title: 'Cloud Only',
      updated_at: T_NEW,
      data: JSON.parse(JSON.stringify(cloudProject)),
    }])

    await syncNow()

    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    const savedProject = mockSaveProjectRaw.mock.calls[0]![0] as Project
    expect(savedProject.id).toBe('cloud-only')
  })

  it('클라우드가 더 최신인 프로젝트 → saveProjectRaw 호출 (LWW download)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('p1', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'p1', title: 'P1', updatedAt: T_OLD }])
    mockFetchCloudProjects.mockResolvedValue([{
      id: 'p1',
      owner: signedInUser.id,
      title: 'P1',
      updated_at: T_NEW,
      data: JSON.parse(JSON.stringify(cloudProject)),
    }])

    await syncNow()

    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
  })

  // ── Upload 경로 ───────────────────────────────────────────────

  it('로컬에만 있는 프로젝트 → upsertCloudProject 호출 (upload)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const localProject = makeProject('local-only', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'local-only', title: 'Local', updatedAt: T_NEW }])
    mockLoadProject.mockResolvedValue(localProject)
    mockFetchCloudProjects.mockResolvedValue([])

    await syncNow()

    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    const [uploadedProject, ownerId] = mockUpsertCloudProject.mock.calls[0] as [Project, string]
    expect(uploadedProject.id).toBe('local-only')
    expect(ownerId).toBe(signedInUser.id)
  })

  it('로컬이 더 최신인 프로젝트 → upsertCloudProject 호출 (LWW upload)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const localProject = makeProject('p2', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'p2', title: 'P2', updatedAt: T_NEW }])
    mockLoadProject.mockResolvedValue(localProject)
    mockFetchCloudProjects.mockResolvedValue([{
      id: 'p2', owner: signedInUser.id, title: 'P2', updated_at: T_OLD, data: {},
    }])

    await syncNow()

    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    expect(mockSaveProjectRaw).not.toHaveBeenCalled()
  })

  // ── Tie ───────────────────────────────────────────────────────

  it('동일 타임스탬프(tie) → repo 미호출 (no action)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    mockListProjects.mockResolvedValue([{ id: 'p3', title: 'P3', updatedAt: T_NEW }])
    mockFetchCloudProjects.mockResolvedValue([{
      id: 'p3', owner: signedInUser.id, title: 'P3', updated_at: T_NEW, data: {},
    }])

    await syncNow()

    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
    expect(mockSaveProjectRaw).not.toHaveBeenCalled()
  })
})

describe('sync — pushProject()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    _isConfigured = true
    mockUpsertCloudProject.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('미로그인 → 타이머 미설정, upsertCloudProject 미호출', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    const project = makeProject('p-nologin', T_NEW)
    pushProject(project)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
  })

  it('signedIn + 2000ms 경과 → upsertCloudProject 호출', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const project = makeProject('p-push', T_NEW)
    pushProject(project)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    const [calledProject, ownerId] = mockUpsertCloudProject.mock.calls[0] as [Project, string]
    expect(calledProject.id).toBe('p-push')
    expect(ownerId).toBe(signedInUser.id)
  })

  it('pushProject 연속 2회 → 디바운스로 upsertCloudProject 1회만 호출', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const p1 = makeProject('p-debounce', T_OLD)
    const p2 = makeProject('p-debounce', T_NEW)
    pushProject(p1)
    await vi.advanceTimersByTimeAsync(500)  // 아직 타이머 미만료
    pushProject(p2)                          // 이전 타이머 취소, 새 타이머 시작
    await vi.advanceTimersByTimeAsync(2000) // 새 타이머 만료
    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    // 마지막 호출(p2)의 프로젝트가 업로드됨
    const [calledProject] = mockUpsertCloudProject.mock.calls[0] as [Project]
    expect(calledProject.metadata.updatedAt).toBe(T_NEW)
  })
})
```

- [ ] **Step 5: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- sync.test
```

Expected: FAIL — `'../sync'` 모듈 없음.

- [ ] **Step 6: `sync.ts` 구현**

Create `apps/web/src/cloud/sync.ts`:

```typescript
import { deserializeProject, type Project } from '@sculptone/score-model'
import { isCloudConfigured } from './supabase'
import { useAuthStore } from './authStore'
import { fetchCloudProjects, upsertCloudProject } from './projectsRepo'
import { reconcile } from './reconcile'
import { listProjects, loadProject, saveProjectRaw } from '../../io/storage'

/** pushProject 디바운스 딜레이(ms). autosave(800ms)보다 길게 설정해 로컬 저장 완료 후 업로드. */
const PUSH_DEBOUNCE_MS = 2000

/** 모듈 수준 디바운스 타이머. pushProject 연속 호출을 하나로 합친다. */
let pushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 로컬 ↔ 클라우드 전체 동기화.
 * signedIn + isCloudConfigured() 일 때만 실행. 그 외 즉시 return(no-op).
 * 에러: console.error 로그 후 전파 안 함(다음 syncNow 기회에 자연 재시도).
 *
 * 삭제 전파 없음: reconcile 결과에 삭제 정보가 없으며 deleteCloudProject를 호출하지 않음.
 */
export async function syncNow(): Promise<void> {
  const { status, user } = useAuthStore.getState()
  if (status !== 'signedIn' || !user || !isCloudConfigured()) return

  try {
    // 1. 로컬 + 클라우드 목록 병렬 조회
    const [localSummaries, cloudRows] = await Promise.all([
      listProjects(),
      fetchCloudProjects(),
    ])

    // 2. LWW reconcile (ISO 문자열 비교)
    const localMeta = localSummaries.map((s) => ({ id: s.id, updatedAt: s.updatedAt }))
    const cloudMeta = cloudRows.map((r) => ({ id: r.id, updatedAt: r.updated_at }))
    const { toUpload, toDownload } = reconcile(localMeta, cloudMeta)

    // 3. 다운로드: 클라우드 → 로컬 (saveProjectRaw: updatedAt 보존 → 재업로드 방지)
    for (const id of toDownload) {
      const row = cloudRows.find((r) => r.id === id)
      if (!row) continue  // 방어 코드
      try {
        const project = deserializeProject(JSON.stringify(row.data))
        await saveProjectRaw(project)
      } catch (e) {
        console.error(`[sync] download failed for ${id}:`, e)
      }
    }

    // 4. 업로드: 로컬 → 클라우드
    for (const id of toUpload) {
      const project = await loadProject(id)
      if (!project) continue  // 방어 코드
      try {
        await upsertCloudProject(project, user.id)
      } catch (e) {
        console.error(`[sync] upload failed for ${id}:`, e)
      }
    }
  } catch (e) {
    console.error('[sync] syncNow failed:', e)
  }
}

/**
 * 단일 프로젝트를 클라우드에 디바운스 업로드한다.
 * signedIn + isCloudConfigured() 일 때만 실행. 그 외 즉시 return(no-op).
 * 연속 호출 시 마지막 호출 기준 2000ms 후 1회 업로드(디바운스).
 *
 * useAutosave가 saveProject 성공 후 이 함수를 호출한다.
 * 에러: fire-and-forget (console.error만).
 */
export function pushProject(project: Project): void {
  const { status, user } = useAuthStore.getState()
  if (status !== 'signedIn' || !user || !isCloudConfigured()) return

  // 이전 예약 취소 (debounce)
  if (pushTimer !== null) {
    clearTimeout(pushTimer)
  }

  const ownerId = user.id
  pushTimer = setTimeout(() => {
    pushTimer = null
    upsertCloudProject(project, ownerId).catch((e) => {
      console.error('[sync] pushProject failed:', e)
    })
  }, PUSH_DEBOUNCE_MS)
}
```

- [ ] **Step 7: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- sync.test
```

Expected: **10개** PASS (syncNow 7개 + pushProject 3개).

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 5: 배선 + 스모크

**Files:** Create `apps/web/src/cloud/useCloudSync.ts`, Create `apps/web/src/cloud/test/useCloudSync.test.tsx`, Modify `apps/web/src/io/useAutosave.ts`, Modify `apps/web/src/shell/AppShell.tsx`

- [ ] **Step 1: `useCloudSync.ts` 구현**

Create `apps/web/src/cloud/useCloudSync.ts`:

```typescript
import { useEffect } from 'react'
import { useAuthStore } from './authStore'
import { syncNow } from './sync'

/**
 * authStore.status가 'signedIn'으로 전환될 때 syncNow()를 1회 호출한다.
 * AppShell 최상단에 마운트. sync.ts에서 authStore를 직접 구독하지 않아 순환 의존 방지.
 */
export function useCloudSync(): void {
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (status === 'signedIn') {
      void syncNow()
    }
  }, [status])
}
```

- [ ] **Step 2: `useCloudSync.test.tsx` 스모크 작성**

Create `apps/web/src/cloud/test/useCloudSync.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { useAuthStore } from '../authStore'
import { useCloudSync } from '../useCloudSync'

const mockSyncNow = vi.fn()
vi.mock('../sync', () => ({ syncNow: mockSyncNow }))
vi.mock('../supabase', () => ({ supabase: null, isCloudConfigured: () => false }))

describe('useCloudSync — 스모크', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncNow.mockResolvedValue(undefined)
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
  })

  it('status=loading → syncNow 미호출', () => {
    act(() => { useAuthStore.setState({ status: 'loading' }, true) })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).not.toHaveBeenCalled()
  })

  it('status=signedIn → syncNow 호출됨', () => {
    act(() => { useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } }, true) })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).toHaveBeenCalledOnce()
  })

  it('status=signedOut → syncNow 미호출', () => {
    act(() => { useAuthStore.setState({ status: 'signedOut', user: null }, true) })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: `useCloudSync.test.tsx` 통과 확인**

```bash
pnpm --filter @sculptone/web test -- useCloudSync.test
```

Expected: **3개** PASS.

- [ ] **Step 4: `useAutosave.ts` 수정 — pushProject 추가**

`apps/web/src/io/useAutosave.ts`를 다음과 같이 수정한다.

**import 추가** (파일 상단):
```typescript
import { pushProject } from '../cloud/sync'
```

**setTimeout 콜백 수정**:

기존:
```typescript
    timerRef.current = setTimeout(() => {
      saveProject(project).catch((err) => console.error('autosave failed', err))
    }, delayMs)
```

변경:
```typescript
    timerRef.current = setTimeout(() => {
      saveProject(project)
        .then(() => { pushProject(project) })
        .catch((err) => console.error('autosave failed', err))
    }, delayMs)
```

**flush 경로(프로젝트 전환) 수정**:

기존:
```typescript
      void saveProject(prev).catch((err) => console.error('autosave flush failed', err))
```

변경:
```typescript
      void saveProject(prev)
        .then(() => { pushProject(prev) })
        .catch((err) => console.error('autosave flush failed', err))
```

- [ ] **Step 5: useAutosave 기존 테스트 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- useAutosave
```

Expected: 기존 테스트 모두 PASS. `pushProject`는 미로그인 시 no-op이므로 기존 테스트 환경에서 부작용 없음.

(useAutosave 테스트가 없다면 이 step은 skip하고 Task 6에서 전체 확인으로 대체)

- [ ] **Step 6: `AppShell.tsx` 수정 — useCloudSync 마운트**

`apps/web/src/shell/AppShell.tsx` 두 곳 수정:

**import 추가** — 기존 import 블록 끝에:
```typescript
import { useCloudSync } from '../cloud/useCloudSync'
```

**훅 호출 추가** — `AppShell` 함수 본문 최상단(다른 훅들과 함께):
```typescript
export function AppShell() {
  useCloudSync()  // ← 추가: signedIn 시 syncNow 트리거
  // ... (기존 코드)
```

- [ ] **Step 7: AppShell 기존 테스트 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell
```

Expected: 기존 테스트 모두 PASS. `useCloudSync`는 미로그인/미설정 시 no-op이므로 기존 단언 영향 없음.

---

## Task 6: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: cloud/ 신규 테스트 전체 확인**

```bash
pnpm --filter @sculptone/web test -- cloud
```

Expected:
- `reconcile.test.ts`: **10개** PASS
- `projectsRepo.test.ts`: **6개** PASS
- `projectsRepo.null.test.ts`: **3개** PASS
- `sync.test.ts`: **10개** PASS
- `useCloudSync.test.tsx`: **3개** PASS
- 합계: **32개** 신규 PASS

- [ ] **Step 2: io/ 수정 확인**

```bash
pnpm --filter @sculptone/web test -- storage
```

Expected: 기존 + `saveProjectRaw` 신규 2개 PASS.

- [ ] **Step 3: 전체 @sculptone/web 테스트 (회귀 0)**

```bash
pnpm --filter @sculptone/web test
```

Expected:
- 신규 +34개 PASS (cloud 32 + storage 2)
- 기존 테스트 전부 PASS — 회귀 0

**예상 회귀 분석**:

| 기존 테스트 | 영향 분석 | 판정 |
|---|---|---|
| `supabase.test.ts` | supabase.ts 불변 | PASS |
| `authStore.test.ts / disabled.test.ts` | authStore.ts 불변 | PASS |
| `AuthButton.test.tsx` | AuthButton.tsx 불변 | PASS |
| `AppShell.test.tsx` | `useCloudSync()` 추가. 미로그인/supabase null → no-op | PASS |
| `storage.test.ts` | `saveProjectRaw` 추가(기존 함수 불변) | PASS |
| `store.test.ts` | state/store.ts 불변 | PASS |
| `PianoRoll.*.test.tsx` | compose/ 불변 | PASS |
| `useAudio.test.ts` | audio/ 불변 | PASS |

- [ ] **Step 4: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 신규 | 기존 |
|---|---|---|
| `@sculptone/score-model` | 0 | 유지 |
| `@sculptone/sound-engine` | 0 | 유지 |
| `@sculptone/web` | +34 | 전부 유지 |

- [ ] **Step 5: 커버리지 게이트 확인**

```bash
pnpm --filter @sculptone/web coverage
```

Expected: `functions` 커버리지 **≥ 82%** 유지.

신규 코드 커버리지 분석:
- `reconcile.ts`: `reconcile` 함수 100% (로컬전용/클라우드전용/로컬최신/클라우드최신/tie/빈목록 전부 커버)
- `projectsRepo.ts`: `fetchCloudProjects`/`upsertCloudProject`/`deleteCloudProject` × (supabase non-null/null) 경로 커버
- `sync.ts`: `syncNow`(guard/download/upload/tie) + `pushProject`(guard/debounce/disordered) 커버
- `useCloudSync.ts`: 3-상태 스모크 커버
- `storage.ts(saveProjectRaw)`: 2-케이스 커버

- [ ] **Step 6: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. 특히:
- `reconcile.ts`: `ProjectMeta`, `ReconcileResult` 타입 일치
- `projectsRepo.ts`: `CloudProjectRow.data: unknown` — `JSON.stringify(row.data)` 안전
- `sync.ts`: `deserializeProject(JSON.stringify(row.data))` — string 인수 타입 일치
- `useCloudSync.ts`: `useEffect` return void — syncNow는 Promise, void 캐스팅(`void syncNow()`)
- `useAutosave.ts`: `pushProject(project)` — Project 타입 일치
- React named import: `import { useEffect } from 'react'` 사용 (네임스페이스 미사용)

- [ ] **Step 7: lint + format**

```bash
pnpm --filter @sculptone/web exec eslint src/cloud src/io/storage.ts src/io/useAutosave.ts src/shell/AppShell.tsx --max-warnings 0
```

Expected: 에러 0, 경고 0.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과. 기존 테스트 회귀 0.
- `supabase/migrations/0001_projects.sql`: projects 테이블 DDL + 4개 RLS 정책(select/insert/update/delete) SQL 정확.
- `reconcile.ts`: 10개 케이스(빈목록/단방향/LWW양방향/tie/혼합) 모두 TDD 통과. 순수 함수.
- `projectsRepo.ts`: fetch/upsert/delete × null-safe 경로 TDD 통과. `supabase null` → no-op.
- `sync.ts`: syncNow guard/download/upload/tie + pushProject guard/debounce/disordered TDD 통과.
- `saveProjectRaw`: storage.ts 기존 함수 불변 + additive TDD 통과.
- `useCloudSync.ts`: signedIn 전환 시 syncNow 1회 트리거 스모크 통과.
- `useAutosave.ts`: pushProject 호출 추가, 기존 테스트 회귀 없음.
- `AppShell.tsx`: useCloudSync() 마운트, 기존 테스트 회귀 없음.
- 삭제 전파 없음: `deleteCloudProject`가 sync.ts에서 호출되지 않음.
- 무한 루프 없음: `saveProjectRaw` 사용으로 다운로드 후 재업로드 방지됨.
- `pnpm --filter @sculptone/web coverage` functions ≥ 82%.
- `tsc --noEmit` 에러 없음.
- React 타입 네임스페이스 미사용.
- 인프라/CI 파일 수정 없음.

---

## 사용자 필수 액션 (코드 배포 전 완료 필요)

Sub-project A(인증) 설정이 이미 완료되었다면:

1. `supabase/migrations/0001_projects.sql`을 Supabase 대시보드 SQL Editor에 붙여넣어 실행
2. Table Editor에서 `projects` 테이블이 생성되었는지, RLS 탭에서 4개 정책이 활성화되었는지 확인
3. (선택) `supabase/README.md` 가이드 참조

코드 자체는 Supabase 없이 테스트/타입체크/빌드 모두 통과한다. 실제 클라우드 동기화를 사용하려면 위 3단계가 필요하다.

---

## 다음 증분

- **Sub-project C**: 공유 링크 — share token, 읽기 전용 뷰어, 공개 URL
- **삭제 동기화**: 삭제 tombstone 또는 soft delete 메커니즘 도입
- **오프라인 복원**: navigator.onLine 이벤트 구독 → 온라인 복귀 시 syncNow 자동 호출
- **자동 재시도**: 네트워크 오류 시 지수 백오프
- **ProjectList 동기화 상태 표시**: 각 프로젝트 옆에 클라우드 동기화 상태 아이콘 (up-to-date / syncing / error)
- **metadata-only fetch 최적화**: 프로젝트 수가 많을 때 data jsonb를 초기 fetch에서 제외하고 on-demand 로드

---

## 열린 질문

1. **로컬 삭제 후 재다운로드**: 이번 범위에서 무음 처리. 사용자가 혼란스러울 수 있음. 추후 UI 안내 필요.

2. **pushProject 타이머 미취소(로그아웃 시)**: 사용자가 로그아웃하면 pushTimer가 여전히 남아있을 수 있다. 타이머가 만료되어도 `pushProject` 내부의 guard가 `status !== 'signedIn'`을 감지해 upsert를 실행하지 않는다(클로저 바깥에서 authStore를 재조회하지 않으므로 주의). `sync.ts`의 실제 구현에서 setTimeout 콜백 내부에서 status를 재확인하는 것이 더 안전하다. 계획 작성 시점 추가 검토 필요.

3. **`deserializeProject(JSON.stringify(row.data))` 실패**: `row.data`가 Zod 스키마와 맞지 않으면 `deserializeProject`가 throw. try-catch로 감싸져 있어 해당 id를 skip하지만, 유저에게 알림이 없다.

4. **fetchCloudProjects 대용량**: 사용자가 수백 개 프로젝트를 가지면 data jsonb를 포함한 전체 fetch가 느려질 수 있다. 현재는 단순성 우선. 추후 metadata-only 최적화.
