# Sculptone — Cloud Sync (Sub-project B) 설계 문서

- 상태: Draft v1
- 작성일: 2026-07-01
- 범위: **백엔드 2단계 — 클라우드 프로젝트 동기화 (Sub-project B)**
- 의존 스펙: `docs/superpowers/specs/2026-07-01-sculptone-cloud-auth-foundation.md`
- 전제: Sub-project A(인증) 완료 — `supabase.ts`(`supabase | null`, `isCloudConfigured()`), `authStore.ts`(`useAuthStore`, `status`, `user`) 구현됨.
- 태그라인: *로그인 사용자의 프로젝트를 클라우드에 가산적으로 동기화한다 — 미로그인/미설정 시 앱은 100% 로컬.*

---

## 1. 목표

Supabase Postgres를 통해 로그인 사용자의 프로젝트를 클라우드에 동기화한다. 핵심 원칙:

1. **가산적(additive)**: 기존 local-first(IndexedDB) 구조를 건드리지 않는다. 클라우드 동기화는 독립 레이어로 얹힌다.
2. **Graceful degradation**: 미설정/미로그인 전 구간이 no-op로 동작한다. 로컬 앱 100% 정상.
3. **Last-write-wins**: 프로젝트별 `updated_at` ISO 문자열 비교로 충돌 해결. 필드 단위 병합 없음.
4. **단방향 삭제 미전파**: 이번 범위에서 삭제는 전파하지 않는다(데이터 안전 우선). 사용자가 로컬에서 삭제해도 클라우드 복사본은 보존된다.

이 서브프로젝트의 산출물:
- SQL 마이그레이션 (`supabase/migrations/0001_projects.sql`)
- 순수 reconcile 로직 (`apps/web/src/cloud/reconcile.ts`)
- 클라우드 저장소 어댑터 (`apps/web/src/cloud/projectsRepo.ts`)
- 동기화 엔진 (`apps/web/src/cloud/sync.ts`)
- 로컬 저장소 확장 (`apps/web/src/io/storage.ts` — `saveProjectRaw` 추가)
- 배선 (`useAutosave.ts` + `useCloudSync.ts` + AppShell)

---

## 2. 아키텍처 / 모듈 경계

```
apps/web/src/
  cloud/                          ← Sub-project A 기존 디렉토리
    supabase.ts                   (기존) 싱글톤 클라이언트
    authStore.ts                  (기존) 인증 상태
    AuthButton.tsx                (기존) 인증 UI
    reconcile.ts                  NEW: 순수 LWW 조정 로직
    projectsRepo.ts               NEW: Supabase CRUD 어댑터
    sync.ts                       NEW: 동기화 엔진 (syncNow + pushProject)
    useCloudSync.ts               NEW: authStore 구독 → syncNow 트리거 훅
    test/
      reconcile.test.ts           NEW: 완전 TDD (~10개)
      projectsRepo.test.ts        NEW: mock supabase TDD (~8개)
      sync.test.ts                NEW: mock repo+storage TDD (~10개)
      useCloudSync.test.ts        NEW: 스모크 (~3개)
  io/
    storage.ts                    MOD: saveProjectRaw 추가(additive)
    test/
      storage.test.ts             MOD: saveProjectRaw 테스트 추가(~2개)
    useAutosave.ts                MOD: pushProject 호출 추가
  shell/
    AppShell.tsx                  MOD: useCloudSync() 호출

supabase/
  migrations/
    0001_projects.sql             NEW: projects 테이블 DDL + RLS (사용자가 수동 적용)
```

**아키텍처 원칙**:
- `reconcile.ts`는 순수 함수. 외부 의존 없음(저장소 없음, 네트워크 없음).
- `projectsRepo.ts`는 Supabase 어댑터. `supabase === null`이면 안전 no-op.
- `sync.ts`는 조율자. storage + reconcile + projectsRepo + authStore를 엮는다.
- `useCloudSync.ts`는 React 훅. sync.ts에서 authStore 의존을 격리한다(순환 방지).
- `useAutosave.ts` 수정은 additive(`pushProject` 한 줄 추가). 기존 동작 불변.
- `storage.ts` 수정은 additive(`saveProjectRaw` 함수 추가). 기존 함수 불변.

---

## 3. 컴포넌트 스펙

### 3.1 `supabase/migrations/0001_projects.sql` — DB 스키마 + RLS

사용자가 Supabase 대시보드 SQL Editor 또는 CLI로 직접 적용한다.

```sql
-- Sculptone Cloud Sync — projects table
-- Sub-project B: Cloud Project Sync
-- 적용: Supabase Dashboard → SQL Editor, 또는 supabase CLI `supabase db push`

create table if not exists public.projects (
  id          text         primary key,
  -- Project.id는 crypto.randomUUID() 생성 UUID 문자열. text로 선언해 형식 유연성 유지.
  owner       uuid         not null references auth.users(id) on delete cascade,
  -- auth.users.id (Supabase Auth UUID). 사용자 삭제 시 cascade 삭제.
  title       text         not null default '',
  data        jsonb        not null,
  -- serializeProject(project) → JSON.parse() 결과 객체. jsonb 컬럼.
  updated_at  timestamptz  not null,
  -- Project.metadata.updatedAt (ISO 8601 문자열 → timestamptz 자동 변환)
  created_at  timestamptz  not null default now()
);

-- RLS 활성화: 정책이 없으면 모든 행 접근 거부
alter table public.projects enable row level security;

-- 소유자만 본인 행 조회
create policy "owner can select own projects"
  on public.projects
  for select
  using (auth.uid() = owner);

-- 소유자만 삽입 + owner = 현재 사용자 강제 (다른 사용자 행 사칭 불가)
create policy "owner can insert own projects"
  on public.projects
  for insert
  with check (auth.uid() = owner);

-- 소유자만 본인 행 수정 + owner 변경 불가
create policy "owner can update own projects"
  on public.projects
  for update
  using  (auth.uid() = owner)
  with check (auth.uid() = owner);

-- 소유자만 본인 행 삭제
create policy "owner can delete own projects"
  on public.projects
  for delete
  using (auth.uid() = owner);
```

**RLS 보장**:
- SELECT: `auth.uid() = owner` 행만 반환. 다른 사용자 행 조회 불가.
- INSERT: `owner` 컬럼이 반드시 `auth.uid()`여야 함. 앱이 엉뚱한 owner를 넣으면 거부.
- UPDATE: 본인 행만 수정 가능 + 수정 후에도 owner가 본인이어야 함(owner 변경 불가).
- DELETE: 본인 행만 삭제 가능.
- 익명/미인증 요청: 모두 거부(`auth.uid()` = null → 어떤 행과도 일치하지 않음).

---

### 3.2 타입 정의 (공유 인터페이스)

```typescript
// reconcile.ts export
export interface ProjectMeta {
  id: string
  updatedAt: string  // ISO 8601
}

export interface ReconcileResult {
  toUpload: string[]    // id 배열: 로컬 → 클라우드
  toDownload: string[]  // id 배열: 클라우드 → 로컬
}

// projectsRepo.ts export
export interface CloudProjectRow {
  id: string
  owner: string       // auth.users.id (UUID string)
  title: string
  updated_at: string  // ISO 8601 (Supabase가 timestamptz를 ISO string으로 반환)
  data: unknown       // jsonb — deserializeProject(JSON.stringify(data)) 로 복원
}
```

---

### 3.3 `reconcile.ts` — 순수 LWW 조정 로직

```
위치: apps/web/src/cloud/reconcile.ts
```

**시그니처**:
```typescript
export function reconcile(
  local: ProjectMeta[],
  cloud: ProjectMeta[]
): ReconcileResult
```

**LWW 알고리즘**:
1. `localMap`: id → updatedAt (local 배열 인덱스)
2. `cloudMap`: id → updatedAt (cloud 배열 인덱스)
3. 모든 unique id에 대해:
   - local에만 존재 → `toUpload`
   - cloud에만 존재 → `toDownload`
   - 양쪽 존재:
     - `local.updatedAt > cloud.updatedAt` → `toUpload` (로컬이 최신)
     - `local.updatedAt < cloud.updatedAt` → `toDownload` (클라우드가 최신)
     - `local.updatedAt === cloud.updatedAt` → 아무것도 하지 않음 (동일 버전, tie-break)
4. 비교는 ISO 8601 문자열 사전식 비교로 충분 (`'2026-07-01T12:00:00.000Z' < '2026-07-01T13:00:00.000Z'` 성립).

**완전 테스트 대상 케이스**:
1. 빈 목록 × 빈 목록 → `{ toUpload: [], toDownload: [] }`
2. 로컬에만 있는 프로젝트 → `toUpload`
3. 클라우드에만 있는 프로젝트 → `toDownload`
4. 양쪽 있음, 로컬 더 최신 → `toUpload`
5. 양쪽 있음, 클라우드 더 최신 → `toDownload`
6. 양쪽 있음, 동일 타임스탬프(tie) → 아무것도 없음
7. 혼합: 로컬전용 2개 + 클라우드전용 1개 + 로컬최신 1개 + 클라우드최신 1개 + tie 1개 → 각각 올바른 분류
8. 로컬 없음 + 클라우드 여러 개 → 전부 `toDownload`
9. 로컬 여러 개 + 클라우드 없음 → 전부 `toUpload`

**순수 함수 보장**: 입력 배열 불변(mutate 없음). 외부 부작용 없음. 결정론적.

---

### 3.4 `projectsRepo.ts` — 클라우드 저장소 어댑터

```
위치: apps/web/src/cloud/projectsRepo.ts
```

**시그니처**:
```typescript
export async function fetchCloudProjects(): Promise<CloudProjectRow[]>
export async function upsertCloudProject(project: Project, ownerId: string): Promise<void>
export async function deleteCloudProject(id: string): Promise<void>
```

**동작**:

`fetchCloudProjects()`:
- `supabase === null` → `[]` 반환(no-op)
- `supabase.from('projects').select('id, owner, title, updated_at, data')` 호출
- 에러 시: `console.error` 로그 + `[]` 반환(앱 계속 동작)
- 반환: `CloudProjectRow[]`

`upsertCloudProject(project, ownerId)`:
- `supabase === null` → 즉시 return(no-op)
- 준비:
  ```
  data = JSON.parse(serializeProject(project))  // Project → jsonb용 객체
  updated_at = project.metadata.updatedAt
  ```
- `supabase.from('projects').upsert({ id, owner: ownerId, title, data, updated_at }, { onConflict: 'id' })`
- 에러 시: `console.error` 로그 + rethrow(호출자가 재시도 여부 결정)

`deleteCloudProject(id)`:
- `supabase === null` → 즉시 return(no-op)
- `supabase.from('projects').delete().eq('id', id)`
- 에러 시: `console.error` 로그 + rethrow
- **주의**: 이 함수는 현재 `sync.ts`에서 호출하지 않는다. 삭제 동기화는 이번 범위 밖. 미래 Sub-project C 또는 삭제 동기화 기능을 위한 예약 구현.

---

### 3.5 `storage.ts` — `saveProjectRaw` 추가 (additive)

```
위치: apps/web/src/io/storage.ts (기존 파일에 함수 추가)
```

**배경**: 기존 `saveProject`는 저장 시 `project.metadata.updatedAt`을 현재 시각으로 **재발급**한다. 클라우드에서 다운로드한 프로젝트를 로컬에 저장할 때 이 재발급이 문제가 된다 — 로컬 `updatedAt`이 클라우드 `updated_at`보다 커져, 다음 동기화에서 불필요한 재업로드가 발생한다.

**해결**: `saveProjectRaw(project)` — `project.metadata.updatedAt`을 그대로 보존하는 내부 함수.

```typescript
/**
 * Cloud sync 전용: project.metadata.updatedAt을 재발급하지 않고 그대로 저장.
 * 클라우드에서 다운로드한 프로젝트를 로컬에 반영할 때만 사용한다.
 * 일반 사용자 편집 저장에는 saveProject를 사용할 것.
 */
export async function saveProjectRaw(project: Project): Promise<void>
```

동작:
- `updatedAt = project.metadata.updatedAt` (재발급 없음)
- `db.put(STORE_NAME, { id, title, updatedAt, data: serializeProject(project) })`
- `serializeProject`는 project를 Zod 검증 + JSON 직렬화한다. `metadata.updatedAt`이 project에 그대로 포함되어 직렬화됨.

**기존 `saveProject` 동작 불변**: 추가 함수이므로 기존 테스트 회귀 없음.

---

### 3.6 `sync.ts` — 동기화 엔진

```
위치: apps/web/src/cloud/sync.ts
```

**시그니처**:
```typescript
export async function syncNow(): Promise<void>
export function pushProject(project: Project): void
```

**`syncNow()` 알고리즘**:
```
1. Guard: useAuthStore.getState().status !== 'signedIn' → return (no-op)
2. Guard: !isCloudConfigured() → return (no-op)
3. const user = useAuthStore.getState().user (non-null: status=signedIn 보장)
4. [병렬] localSummaries = await listProjects()
         cloudRows = await fetchCloudProjects()
5. localMeta = localSummaries.map(s => ({ id: s.id, updatedAt: s.updatedAt }))
   cloudMeta = cloudRows.map(r => ({ id: r.id, updatedAt: r.updated_at }))
6. { toUpload, toDownload } = reconcile(localMeta, cloudMeta)
7. Download (toDownload):
   for id of toDownload:
     row = cloudRows.find(r => r.id === id)
     if (!row) continue  // 방어 코드
     project = deserializeProject(JSON.stringify(row.data))
     await saveProjectRaw(project)  // updatedAt 보존 — 무한 재업로드 방지
8. Upload (toUpload):
   for id of toUpload:
     project = await loadProject(id)
     if (!project) continue  // 방어 코드
     await upsertCloudProject(project, user.id)
9. 에러 시: console.error 로그, 전파 안 함(다음 syncNow에서 재시도)
```

**`pushProject(project)` 디바운스 업로드**:
```
- Guard: useAuthStore.getState().status !== 'signedIn' → return (no-op)
- Guard: !isCloudConfigured() → return (no-op)
- Guard: useAuthStore.getState().user === null → return (no-op)
- 모듈 수준 타이머 변수(pushTimer): 이전 타이머 취소 후 새 타이머 설정(2000ms)
- 타이머 만료: upsertCloudProject(project, user.id).catch(console.error)
- 에러 전파 없음(fire-and-forget)
```

**디바운스 2000ms 근거**: `useAutosave`의 기본 딜레이(800ms)가 지난 후 로컬 저장이 완료되는 시점 이후에 클라우드 업로드를 시작하려면 충분한 여유가 필요. 빠른 연속 편집 시 업로드를 하나로 합친다.

**무한 루프 / 중복 업로드 방지**:
- `syncNow`는 `signedIn` 전환 시 1회만 트리거됨. 이후 호출은 `pushProject` 디바운스.
- 다운로드 후 `saveProjectRaw`를 사용하면 로컬 `updatedAt = 클라우드 updated_at` → 다음 reconcile에서 tie → 재업로드 없음.
- `pushProject`는 디바운스로 중복 호출을 하나로 합침.

---

### 3.7 `useCloudSync.ts` — 배선 훅

```
위치: apps/web/src/cloud/useCloudSync.ts
```

```typescript
export function useCloudSync(): void {
  const status = useAuthStore((s) => s.status)
  useEffect(() => {
    if (status === 'signedIn') {
      void syncNow()
    }
  }, [status])
}
```

`status`가 `'signedIn'`으로 전환될 때(1회) `syncNow()`를 실행한다. `sync.ts` 내부에서 authStore를 직접 구독하면 순환 의존(sync → authStore → sync)이 발생하므로 React 훅으로 분리한다.

AppShell에서 마운트:
```tsx
// AppShell.tsx 최상단
useCloudSync()
```

---

### 3.8 `useAutosave.ts` 수정 — `pushProject` 호출 추가

기존 `setTimeout` 콜백과 flush 경로에 `pushProject` 호출을 추가한다(additive). `pushProject`는 내부적으로 signedIn guard를 수행하므로 미로그인 시 no-op.

```typescript
// 변경 전:
saveProject(project).catch((err) => console.error('autosave failed', err))

// 변경 후:
saveProject(project)
  .then(() => { pushProject(project) })
  .catch((err) => console.error('autosave failed', err))
```

flush 경로(프로젝트 전환)도 동일하게:
```typescript
// 변경 전:
void saveProject(prev).catch((err) => console.error('autosave flush failed', err))

// 변경 후:
void saveProject(prev)
  .then(() => { pushProject(prev) })
  .catch((err) => console.error('autosave flush failed', err))
```

`pushProject`는 로컬 저장 성공 이후 호출하여 데이터 일관성을 보장한다(로컬 저장이 실패하면 클라우드에도 올리지 않음).

---

## 4. 데이터 흐름

```
[앱 시작 — signedIn 상태]
  AppShell 마운트
    → useCloudSync() 훅 실행
      → authStore.status = 'signedIn' 감지
        → syncNow() 1회 호출
          → listProjects() + fetchCloudProjects() [병렬]
          → reconcile(localMeta, cloudMeta)
          → toDownload: cloudRows → saveProjectRaw() (로컬에 반영)
          → toUpload:   loadProject() → upsertCloudProject() (클라우드에 반영)

[사용자 편집 중 — signedIn 상태]
  사용자 편집 → useStore.setProject()
    → useAutosave 800ms 디바운스
      → saveProject(project)  [로컬 저장 + updatedAt 재발급]
        .then(() => pushProject(project))  [클라우드 업로드 예약]
          → 2000ms 디바운스
            → upsertCloudProject(project, user.id)  [클라우드 반영]

[사용자 로그인]
  OAuth 완료 → onAuthStateChange → status = 'signedIn'
    → useCloudSync useEffect → syncNow() 1회

[사용자 로그아웃]
  signOut() → status = 'signedOut'
    → useCloudSync useEffect: status !== 'signedIn' → no-op
    → pushProject: guard 실패 → no-op (타이머 미취소 — 이미 디바운스 중이면 다음 호출에서 guard 실패)

[미설정/미로그인]
  isCloudConfigured() = false OR status !== 'signedIn'
    → syncNow: guard → return
    → pushProject: guard → return
    → fetchCloudProjects: supabase null → []
    → upsertCloudProject: supabase null → return
    로컬 앱 100% 정상 동작
```

---

## 5. 에러 처리 / 오프라인

| 상황 | 처리 |
|---|---|
| `fetchCloudProjects` 네트워크 오류 | `console.error` + `[]` 반환. `syncNow` 계속 진행(upload만 있을 수 있음). |
| `upsertCloudProject` 네트워크 오류 | `console.error` + rethrow. `syncNow` 해당 id skip 후 계속. |
| `saveProjectRaw` 실패 | `console.error`. 다음 `syncNow`에서 재시도(클라우드에서 여전히 최신). |
| `loadProject` 반환 undefined | skip(방어 코드). |
| Supabase RLS 거부 (401/403) | `upsertCloudProject` 에러 로그. 인증 만료 시 onAuthStateChange가 signedOut 전환. |
| 미설정(`supabase === null`) | 전 레이어 no-op. 로컬만 동작. |
| 미로그인(`status !== 'signedIn'`) | `syncNow`/`pushProject` guard 즉시 return. |

**재시도 정책**: 자동 재시도 없음. 다음 syncNow(재로그인 또는 앱 재시작) 또는 다음 pushProject(다음 편집)에서 자연 재시도.

**오프라인 복원**: 앱이 오프라인에서 편집 → 로컬 저장 정상 → `pushProject` 타임아웃/실패 → 에러 로그. 다음 온라인 시 재로그인하거나 편집하면 `pushProject` 재시도.

---

## 6. 테스트 전략

**원칙**: 순수 로직(reconcile) 완전 TDD, 어댑터(repo) mock TDD, 엔진(sync) mock TDD, 배선 훅 스모크.

### 6.1 `reconcile.test.ts` — 완전 TDD (모킹 없음)

`reconcile`은 순수 함수이므로 어떤 mock도 불필요.

**테스트 케이스 (~10개)**:
1. `reconcile([], [])` → `{ toUpload: [], toDownload: [] }`
2. 로컬에만 있음 → `toUpload: [id]`
3. 클라우드에만 있음 → `toDownload: [id]`
4. 양쪽 있음, 로컬 더 최신 → `toUpload: [id]`
5. 양쪽 있음, 클라우드 더 최신 → `toDownload: [id]`
6. 양쪽 있음, 동일 타임스탬프(tie) → `{ toUpload: [], toDownload: [] }`
7. 로컬 없음 + 클라우드 여러 개 → 전부 `toDownload`
8. 로컬 여러 개 + 클라우드 없음 → 전부 `toUpload`
9. 혼합: 로컬전용·클라우드전용·로컬최신·클라우드최신·tie → 각 분류 정확
10. id 순서에 무관한 결과 (입력 순서 다르게 섞어서 동일 결과)

### 6.2 `projectsRepo.test.ts` — mock supabase TDD

**모킹 전략**:
```typescript
vi.mock('../supabase', () => ({ supabase: mockSupabase, isCloudConfigured: () => true }))
```
Supabase 쿼리 빌더를 최소 mock으로 체이닝:
```typescript
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockUpsert = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()

mockFrom.mockReturnValue({ select: mockSelect, upsert: mockUpsert, delete: mockDelete })
mockDelete.mockReturnValue({ eq: mockEq })
const mockSupabase = { from: mockFrom }
```
별도 `projectsRepo.null.test.ts`: `vi.mock('../supabase', () => ({ supabase: null, isCloudConfigured: () => false }))`로 null-safe 경로 격리.

**테스트 케이스 (~8개)**:
1. `fetchCloudProjects()` → `from('projects').select(...)` 호출, rows 반환
2. `fetchCloudProjects()` 에러 → `[]` 반환, console.error 호출
3. `upsertCloudProject(project, ownerId)` → upsert 올바른 payload (id/owner/title/data/updated_at)
4. `upsertCloudProject` 에러 → rethrow
5. `deleteCloudProject(id)` → delete().eq('id', id) 호출
6. `supabase null` → `fetchCloudProjects()` returns `[]` (no-op)
7. `supabase null` → `upsertCloudProject(...)` returns undefined (no-op)
8. `supabase null` → `deleteCloudProject(...)` returns undefined (no-op)

### 6.3 `sync.test.ts` — mock repo+storage TDD

**모킹 전략**:
```typescript
vi.mock('../projectsRepo', () => ({
  fetchCloudProjects: mockFetchCloudProjects,
  upsertCloudProject: mockUpsertCloudProject,
}))
vi.mock('../../io/storage', () => ({
  listProjects: mockListProjects,
  loadProject: mockLoadProject,
  saveProjectRaw: mockSaveProjectRaw,
}))
vi.mock('../supabase', () => ({ isCloudConfigured: () => true }))
// authStore는 setState로 직접 조작
import { useAuthStore } from '../authStore'
vi.mock('../authStore', ...) // 또는 모듈 수준 mock 없이 setState 직접 사용
```

`pushProject` 디바운스 테스트: `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(2000)`.

**테스트 케이스 (~10개)**:
1. `syncNow()` — 미로그인(`status !== 'signedIn'`) → no-op (repo 미호출)
2. `syncNow()` — `isCloudConfigured() = false` → no-op
3. `syncNow()` — signedIn, 클라우드전용 → `saveProjectRaw` 호출 (download 경로)
4. `syncNow()` — signedIn, 로컬전용 → `upsertCloudProject` 호출 (upload 경로)
5. `syncNow()` — signedIn, 로컬최신 → `upsertCloudProject` 호출
6. `syncNow()` — signedIn, 클라우드최신 → `saveProjectRaw` 호출
7. `syncNow()` — signedIn, tie → repo 미호출 (no action)
8. `pushProject(project)` — 미로그인 → 타이머 미설정, `upsertCloudProject` 미호출
9. `pushProject(project)` — signedIn, 2000ms 경과 → `upsertCloudProject` 호출
10. `pushProject(project)` 연속 2회 — 타이머 하나로 debounce, `upsertCloudProject` 1회만 호출

### 6.4 `useCloudSync.test.ts` + `useAutosave` 수정 검증

`useCloudSync` 스모크 (~3개):
1. `status='loading'` → `syncNow` 미호출
2. `status='signedIn'` 전환 → `syncNow` 호출됨
3. `status='signedOut'` 전환 후 다시 no-op

`useAutosave` 수정 검증 (기존 `storage.test.ts` 또는 `useAutosave.test.ts` 확장):
- 기존 테스트 회귀 없음 확인
- `saveProject` 성공 후 `pushProject`가 호출되는지 스모크

---

## 7. 삭제 동기화 결정

**결정: 이번 서브프로젝트에서 삭제 전파를 완전히 제외한다.**

근거:
- 로컬 삭제가 실수(취소 불가)였을 때 클라우드에 전파하면 데이터 영구 손실.
- 삭제 동기화를 안전하게 구현하려면 삭제 로그(soft delete or tombstone) 메커니즘이 필요 — 범위 초과.
- LWW의 경우 삭제를 "가장 오래된 버전"으로 취급하는 기법이 있지만 복잡도가 높음.

**결과**:
- `deleteCloudProject` 함수는 repo에 구현하지만 `sync.ts`에서 호출하지 않는다.
- 사용자가 로컬에서 프로젝트를 삭제하면, 다음 sync에서 클라우드에만 있는 프로젝트로 처리되어 **로컬로 다시 다운로드된다**.
- 이 동작은 비목표에 명시한다. 추후 Sub-project C 또는 별도 태스크에서 삭제 동기화를 구현한다.

---

## 8. 비목표 (이번 서브프로젝트에서 하지 않음)

- **Sub-project C**: 프로젝트 공유 (share token, 읽기 전용 뷰어, 공개 링크)
- **실시간 공동편집**: Yjs/CRDT (P3 장기 계획)
- **필드 단위 병합**: 트랙별·노트별 세분화 충돌 해결
- **충돌 UI**: 사용자에게 "어떤 버전을 선택하겠습니까?" 대화상자
- **삭제 동기화**: 로컬 또는 클라우드 삭제가 반대쪽에 전파됨
- **Supabase Storage 파일 저장**: 오디오 파일, 바이너리 에셋
- **자동 재시도**: 네트워크 오류 시 지수 백오프 재시도 루프
- **오프라인 감지**: navigator.onLine 이벤트 구독
- **인프라/CI 파일 변경**: `.github/`, 루트 설정, `allowedBuilds`
- **다른 패키지 변경**: `packages/score-model`, `packages/sound-engine`

---

## 9. 열린 질문

1. **로컬 삭제 후 재다운로드**: 사용자가 로컬에서 프로젝트를 삭제하면 다음 sync에서 클라우드에서 다시 다운로드된다. 사용자에게 안내 UI가 필요할 수 있다. 이번에는 무음 처리.

2. **다수 프로젝트의 fetchCloudProjects 성능**: 모든 `data` jsonb를 한 번에 가져온다. 프로젝트가 수십 개라면 페이로드가 클 수 있다. 추후 최적화: metadata-only fetch + on-demand data fetch. 현 스펙에서는 단순성 우선.

3. **pushProject와 syncNow 경합**: 편집 중 syncNow가 실행되면 로컬 로드 시점과 클라우드 업로드 시점 사이에 상태 불일치가 있을 수 있다. 뮤텍스 없이 자연 수렴에 의존(다음 push가 올바른 상태를 업로드). 허용 가능한 수준.

4. **`updated_at` 정밀도**: JavaScript `Date.toISOString()`은 밀리초 정밀도. 같은 밀리초에 두 기기에서 동시 편집은 ISO string tie로 처리(no action). 실질적으로 발생 가능성 매우 낮음.

5. **auth.users cascade 삭제**: `owner` 컬럼이 `on delete cascade`이므로 Supabase 계정 삭제 시 모든 프로젝트가 삭제된다. 사용자에게 이 동작을 안내할 필요가 있다.

---

## 부록 — 결정 로그

- **Postgres/jsonb vs Supabase Storage**: jsonb는 structured query 가능(미래 검색 기능) + 단일 테이블로 관리 단순. 프로젝트 데이터는 DAW 시퀀스(JSON, 수십~수백 KB)로 Storage 불필요. Supabase 30MB jsonb 한도 내.
- **text id vs uuid id**: `Project.id`가 `crypto.randomUUID()` 생성이지만 스키마 타입은 `z.string()`이므로 `text`로 선언. UUID 형식 강제 없이 유연성 유지.
- **saveProjectRaw 도입**: `saveProject`는 updatedAt 재발급이 설계 의도. sync 다운로드는 별도 함수로 분리해 기존 동작 불변 보장.
- **useCloudSync 분리**: `sync.ts`가 직접 `useAuthStore`를 구독하면 sync → authStore → (authStore 내부 import 없으나 향후 sync 참조 가능성) 순환 위험. React 훅 분리가 의존 방향을 명확히 한다.
- **pushProject 디바운스 2000ms**: autosave 800ms + 여유. 빠른 연속 편집을 한 번의 업로드로 합친다. 5초 이상으로 늘리면 체감 sync 지연이 있음.
- **삭제 전파 제외**: 데이터 안전 우선. 복잡한 tombstone 메커니즘 없이 단순 upsert/download 정책을 이번 범위로 확정.
