# Sculptone Cloud Share (Sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** share_token 기반 읽기전용 공유 링크를 구현한다. 소유자가 토큰을 발급하면 누구나 `?share=<token>` URL로 익명 읽기전용 열람 가능. security-definer RPC로 enumeration 방지. 미설정/미로그인 graceful degradation.

**Architecture:**
1. `0002_share.sql` — share_token 컬럼 + security-definer RPC `get_shared_project`
2. `shareRepo.ts` — Supabase 어댑터 (shareProject/unshareProject/fetchSharedProject)
3. `parseShareToken.ts` — 순수 URL 파서 + `useShareLoader.ts` 훅
4. `shareStore.ts` + `App.tsx` 분기 + `ShareViewerShell.tsx` — read-only 뷰어
5. `ShareButton.tsx` — 공유 UI (Share/Unshare + URL 복사)
6. 최종 게이트 (커버리지/eslint/prettier)

**Mock 전략 요약:**
- `parseShareToken.ts` 테스트: mock 없음 (순수 함수).
- `shareRepo.ts` 테스트: `vi.mock('../supabase', ...)` + 수동 쿼리 빌더 mock (`from/select/update/eq/rpc`). null-safe는 별도 파일.
- `useShareLoader.ts` 테스트: `vi.mock('../cloud/shareRepo', ...)` + `vi.mock('./parseShareToken', ...)` + shareStore 직접 상태 검증.
- UI 스모크: `vi.mock` + `@testing-library/react` 렌더 + 존재 여부 확인.

**Tech Stack:** React 18 + TS · Zustand 4 · @supabase/supabase-js · Vitest 2.1.9 (jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - Sub-project A + B 완료: `supabase.ts`, `authStore.ts`, `projectsRepo.ts`, `sync.ts`, `useCloudSync.ts`
> - `supabase/migrations/0001_projects.sql` — projects 테이블 + RLS (소유자 정책)
> - `apps/web/src/io/storage.ts` — `saveProject`, `loadProject`, `listProjects`, `saveProjectRaw`
> - `apps/web/src/state/store.ts` — `replaceProject`, `AppState`
> - `apps/web/src/shell/AppShell.tsx` — 3-모드 셸 (라우터 없음)
> - `apps/web/src/App.tsx` — `<AppShell />` 단순 렌더
> - `@sculptone/score-model` — `Project`, `serializeProject`, `deserializeProject`
> - Sub-project A·B 테스트 전부 통과 상태

---

## 비목표 (이 계획에서 하지 말 것)

- 공개 프로젝트 목록 / 탐색 UI
- 공유 만료 / 비밀번호 보호 / 권한 레벨
- 실시간 협업 (Yjs/CRDT)
- 삭제 동기화
- **인프라/CI 파일 변경** (`.github/`, 루트 설정, eslint/prettier 설정, `allowedBuilds`)
- `packages/score-model`, `packages/sound-engine` 수정
- anon SELECT 정책 추가 (enumeration 취약점 — 절대 금지)

---

## 설계 근거

### Enumeration 방지 — security-definer RPC

anon 역할에 `share_token is not null` 조건의 SELECT 정책을 추가하면 Supabase 대시보드나 직접 API 호출로 모든 공유 프로젝트 목록을 열람할 수 있다. 이를 방지하기 위해:

1. 테이블에 anon SELECT 정책 추가 금지
2. `get_shared_project(p_token text)` — security definer 함수로만 접근
3. anon에게 이 함수의 execute 권한만 grant
4. 정확한 토큰 없이는 어떤 행도 반환되지 않음

```sql
-- 올바른 설계 (RPC만)
grant execute on function get_shared_project(text) to anon;

-- 절대 하지 말 것 (enumeration 취약점)
-- create policy "anon can view shared"
--   on public.projects for select
--   using (share_token is not null);  -- 이 줄 추가 금지
```

### 클라이언트 토큰 생성

DB의 `DEFAULT encode(gen_random_bytes(16), 'hex')`는 nullable 컬럼의 NULL→UPDATE 시 적용되지 않는다. 클라이언트에서 `crypto.getRandomValues(new Uint8Array(16))`로 생성하면 CSPRNG 128비트 엔트로피, 추측 불가, 추가 RPC 불필요.

### read-only 차단 — pointer-events:none 래퍼

기존 PianoRoll/VelocityLane에 readOnly prop을 추가하면 컴포넌트 수정 + 기존 테스트 변경이 따른다. `pointer-events: none` 래퍼 div로 마우스 이벤트를 차단하면 기존 컴포넌트 불변. 저장/동기화 차단은 useAutosave/useCloudSync 미마운트로 보장.

### App.tsx 분기 — AppShell 무변경

AppShell에 readOnly prop을 전달하거나 내부를 분기하면 기존 테스트에 영향. App.tsx 레벨에서 ShareViewerShell/AppShell로 분기하면 AppShell 완전 불변.

### URL 방식 — 쿼리 파라미터 `?share=<token>`

`new URL(href).searchParams.get('share')`로 표준 파싱. 해시 방식(`#/p/<token>`)보다 단순하고 추후 서버 사이드 처리 가능.

---

## File Structure

```
supabase/
  migrations/
    0002_share.sql                    NEW: share_token 컬럼 + RPC 함수

apps/web/
  src/
    cloud/
      shareRepo.ts                    NEW: Supabase 공유 어댑터
      shareStore.ts                   NEW: Zustand { isReadOnly, shareLoadState, ... }
      test/
        shareRepo.test.ts             NEW: mock supabase TDD (~7개)
        shareRepo.null.test.ts        NEW: null-safe TDD (~3개)

    share/
      parseShareToken.ts              NEW: 순수 URL 파서
      useShareLoader.ts               NEW: 마운트 시 URL → 프로젝트 로드 훅
      ShareViewerShell.tsx            NEW: 읽기전용 뷰어 셸
      ShareLoadingScreen.tsx          NEW: 로딩 화면
      ShareErrorScreen.tsx            NEW: 에러 화면
      test/
        parseShareToken.test.ts       NEW: 완전 TDD (~8개)
        useShareLoader.test.ts        NEW: TDD (~5개)
        ShareViewerShell.test.tsx     NEW: 스모크 (~2개)

    ui/
      ShareButton.tsx                 NEW: Share/Unshare + URL 복사 UI
      test/
        ShareButton.test.tsx          NEW: 스모크 (~4개)

    App.tsx                           MOD: useShareLoader + isReadOnly 분기 추가
```

변경 없는 파일:
- `apps/web/src/shell/AppShell.tsx` — 완전 불변
- `apps/web/src/state/store.ts` — 완전 불변
- `apps/web/src/compose/**` (PianoRoll, VelocityLane 등) — 완전 불변
- `apps/web/src/cloud/supabase.ts`, `authStore.ts`, `projectsRepo.ts`, `sync.ts`, `useCloudSync.ts`
- `apps/web/src/io/**`, `apps/web/src/audio/**`, `apps/web/src/midi/**`
- `packages/score-model/**`, `packages/sound-engine/**`
- CI/인프라 파일 전체

---

## Task 1: `0002_share.sql` — share_token 컬럼 + RPC 함수

**Files:** Create `supabase/migrations/0002_share.sql`, Update `supabase/README.md`

이 태스크는 사용자가 Supabase에 직접 적용할 SQL 파일을 작성한다. 코드 구현이나 테스트가 없다.

- [ ] **Step 1: SQL 마이그레이션 파일 작성**

Create `supabase/migrations/0002_share.sql`:

```sql
-- Sculptone Cloud Share — share_token + RPC
-- Sub-project C: Read-only Project Sharing
-- =============================================================================
-- 적용 방법 (택 1):
--   A. Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣기 → Run
--   B. Supabase CLI: supabase db push (supabase 프로젝트 연결 필요)
--
-- 전제: 0001_projects.sql 이미 적용됨
-- =============================================================================

-- 1. share_token 컬럼 추가
--    nullable: 공유 안 된 프로젝트 (기본값)
--    unique: 동일 토큰으로 두 프로젝트 공유 불가
alter table public.projects
  add column if not exists share_token text unique;

-- 2. security-definer RPC: 정확한 토큰의 행 1개만 반환
--    anon이 직접 테이블 SELECT 없이 토큰 조회만 허용 → enumeration 방지.
--    security definer: 함수 내부는 소유자(postgres) 권한으로 실행.
--    set search_path = public: search_path injection 방지.
create or replace function get_shared_project(p_token text)
returns setof public.projects
language sql
security definer
set search_path = public
stable
as $$
  select *
  from   public.projects
  where  share_token = p_token
    and  share_token is not null;
$$;

-- 3. 권한 부여: anon 및 authenticated 사용자 모두 이 함수 호출 가능
--    (테이블 직접 SELECT는 여전히 기존 RLS 정책이 제한)
grant execute on function get_shared_project(text) to anon;
grant execute on function get_shared_project(text) to authenticated;

-- !! 경고 !!
-- 아래 정책은 추가하지 않는다. 추가 시 모든 공유 프로젝트 열거 가능(enumeration 취약점).
--
--   create policy "anon can view shared projects"
--     on public.projects
--     for select
--     using (share_token is not null);   -- 절대 추가 금지
--
-- anon 접근은 get_shared_project RPC 함수로만 허용한다.
```

- [ ] **Step 2: README 업데이트**

`supabase/README.md`에 Sub-project C 마이그레이션 섹션을 추가한다:

```markdown
## Sub-project C: 프로젝트 공유

### 마이그레이션 적용 (0002_share.sql)

`supabase/migrations/0001_projects.sql` 적용 이후 실행:

#### 방법 A: Supabase 대시보드
1. SQL Editor → `supabase/migrations/0002_share.sql` 내용 붙여넣기 → Run

#### 방법 B: Supabase CLI
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 검증

마이그레이션 적용 후:
- Table Editor → `projects` → `share_token` 컬럼(text, nullable, unique) 존재 확인
- Database → Functions → `get_shared_project` 함수 존재 확인
- anon 역할에 `execute on function get_shared_project` 권한 부여 확인
- projects 테이블에 anon SELECT 정책이 없음을 확인 (기존 소유자 정책만)

### 스키마 변경 요약

| 변경 | 설명 |
|---|---|
| `projects.share_token` | text UNIQUE NULL: 공유 토큰 (null=미공유) |
| `get_shared_project(p_token text)` | security-definer RPC: 토큰 일치 행만 반환 |
```

---

## Task 2: `shareRepo.ts` — Supabase 공유 어댑터 TDD

**Files:**
- Create `apps/web/src/cloud/shareStore.ts`
- Create `apps/web/src/cloud/test/shareRepo.test.ts`
- Create `apps/web/src/cloud/test/shareRepo.null.test.ts`
- Create `apps/web/src/cloud/shareRepo.ts`

### Task 2a: shareStore.ts 작성

- [ ] **Step 1: `shareStore.ts` 구현**

Create `apps/web/src/cloud/shareStore.ts`:

```typescript
import { create } from 'zustand'
import type { Project } from '@sculptone/score-model'

export type ShareLoadState = 'idle' | 'loading' | 'loaded' | 'error'

interface ShareState {
  /** URL에 ?share=<token>이 감지되면 true. 읽기전용 뷰어 진입 플래그. */
  isReadOnly: boolean
  /** 공유 프로젝트 로드 상태 기계. */
  shareLoadState: ShareLoadState
  /** 로드된 공유 프로젝트. shareLoadState='loaded'일 때만 non-null. */
  sharedProject: Project | null
  /** 에러 메시지. shareLoadState='error'일 때만 non-null. */
  shareError: string | null
  setReadOnly: (v: boolean) => void
  setShareLoadState: (s: ShareLoadState) => void
  setSharedProject: (p: Project | null) => void
  setShareError: (msg: string | null) => void
}

export const useShareStore = create<ShareState>((set) => ({
  isReadOnly: false,
  shareLoadState: 'idle',
  sharedProject: null,
  shareError: null,
  setReadOnly: (v) => set({ isReadOnly: v }),
  setShareLoadState: (s) => set({ shareLoadState: s }),
  setSharedProject: (p) => set({ sharedProject: p }),
  setShareError: (msg) => set({ shareError: msg }),
}))
```

### Task 2b: shareRepo TDD

- [ ] **Step 2: `shareRepo.test.ts` 작성 (실패 상태)**

Create `apps/web/src/cloud/test/shareRepo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Supabase 쿼리 빌더 mock ──────────────────────────────────────────────────
// .from('projects').select('share_token').eq('id', id).eq('owner', uid)
// .from('projects').update({...}).eq('id', id).eq('owner', uid)
// .rpc('get_shared_project', { p_token: token })

const mockEqChain = vi.fn()  // 두 번째 .eq() 또는 최종 await
const mockEq1 = vi.fn()      // 첫 번째 .eq()
mockEq1.mockReturnValue({ eq: mockEqChain })

const mockSelect = vi.fn()
mockSelect.mockReturnValue({ eq: mockEq1 })

const mockUpdate = vi.fn()
mockUpdate.mockReturnValue({ eq: mockEq1 })

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  update: mockUpdate,
}))

const mockRpc = vi.fn()

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  isCloudConfigured: () => true,
}))

// authStore 직접 제어
import { useAuthStore } from '../authStore'

const signedInUser = { id: 'user-abc', email: 'test@test.com', avatarUrl: null }

import { shareProject, unshareProject, fetchSharedProject } from '../shareRepo'

// 테스트용 Project 직렬화 픽스처
const fakeProjectData = {
  id: 'proj-1',
  metadata: {
    title: 'Shared Song',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('shareRepo — configured (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)

    // 기본: select 결과 (share_token: null)
    mockEqChain.mockResolvedValue({ data: [{ share_token: null }], error: null })
    mockRpc.mockResolvedValue({ data: [], error: null })
  })

  // ── shareProject ─────────────────────────────────────────────────────────

  it('shareProject: 기존 share_token 있음 → 기존 토큰 반환 (update 미호출)', async () => {
    const existingToken = 'existing-token-abc'
    mockEqChain.mockResolvedValue({ data: [{ share_token: existingToken }], error: null })

    const result = await shareProject('proj-1')

    expect(result).toBe(existingToken)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('shareProject: share_token null → update 호출, non-empty 토큰 반환', async () => {
    mockEqChain
      .mockResolvedValueOnce({ data: [{ share_token: null }], error: null }) // select
      .mockResolvedValueOnce({ data: null, error: null })                    // update

    const result = await shareProject('proj-1')

    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(mockUpdate).toHaveBeenCalledOnce()
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>
    expect(typeof updateArg['share_token']).toBe('string')
    expect((updateArg['share_token'] as string).length).toBe(32) // 16바이트 hex = 32자
  })

  it('shareProject: select 에러 → rethrow', async () => {
    mockEqChain.mockResolvedValue({ data: null, error: { message: 'network error' } })
    await expect(shareProject('proj-1')).rejects.toThrow()
  })

  // ── unshareProject ───────────────────────────────────────────────────────

  it('unshareProject: update({ share_token: null }) 호출', async () => {
    mockEqChain.mockResolvedValue({ data: null, error: null })

    await unshareProject('proj-1')

    expect(mockUpdate).toHaveBeenCalledOnce()
    const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>
    expect(updateArg['share_token']).toBeNull()
    // .eq('id', 'proj-1') 호출 확인
    expect(mockEq1).toHaveBeenCalledWith('id', 'proj-1')
  })

  it('unshareProject: 에러 → rethrow', async () => {
    mockEqChain.mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    await expect(unshareProject('proj-1')).rejects.toThrow()
  })

  // ── fetchSharedProject ───────────────────────────────────────────────────

  it('fetchSharedProject: rpc 호출 → Project 반환', async () => {
    mockRpc.mockResolvedValue({
      data: [fakeProjectData],
      error: null,
    })

    const result = await fetchSharedProject('some-valid-token')

    expect(mockRpc).toHaveBeenCalledWith('get_shared_project', { p_token: 'some-valid-token' })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('proj-1')
  })

  it('fetchSharedProject: 빈 결과(토큰 무효) → null 반환', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const result = await fetchSharedProject('invalid-token')

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: `shareRepo.null.test.ts` 작성**

Create `apps/web/src/cloud/test/shareRepo.null.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

import { shareProject, unshareProject, fetchSharedProject } from '../shareRepo'

describe('shareRepo — disabled (supabase null)', () => {
  it('fetchSharedProject → null 반환 (no-op)', async () => {
    await expect(fetchSharedProject('any-token')).resolves.toBeNull()
  })

  it('unshareProject → undefined 반환 (no-op)', async () => {
    await expect(unshareProject('proj-1')).resolves.toBeUndefined()
  })

  it('shareProject → throw Error (소유자 전용, degradation 없음)', async () => {
    await expect(shareProject('proj-1')).rejects.toThrow()
  })
})
```

- [ ] **Step 4: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- shareRepo
```

Expected: FAIL — `'../shareRepo'` 모듈 없음.

- [ ] **Step 5: `shareRepo.ts` 구현**

Create `apps/web/src/cloud/shareRepo.ts`:

```typescript
import { deserializeProject, type Project } from '@sculptone/score-model'
import { supabase } from './supabase'
import { useAuthStore } from './authStore'

/**
 * 클라이언트에서 추측불가 32자 hex 토큰을 생성한다.
 * crypto.getRandomValues: 128비트 엔트로피 (CSPRNG).
 */
function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 프로젝트에 공유 토큰을 발급한다(멱등).
 * - supabase null → throw (소유자 전용 기능, graceful degradation 불필요)
 * - 기존 토큰 있으면 반환 (재발급 없음)
 * - 없으면 신규 생성 후 UPDATE, 토큰 반환
 */
export async function shareProject(id: string): Promise<string> {
  if (!supabase) throw new Error('[shareRepo] Cloud not configured')

  const { user } = useAuthStore.getState()
  if (!user) throw new Error('[shareRepo] Not signed in')

  // 1. 기존 share_token 조회
  const { data: rows, error: selectErr } = await supabase
    .from('projects')
    .select('share_token')
    .eq('id', id)
    .eq('owner', user.id)

  if (selectErr) {
    console.error('[shareRepo] shareProject select failed:', selectErr)
    throw new Error(selectErr.message)
  }

  const row = (rows as Array<{ share_token: string | null }> | null)?.[0]
  if (row?.share_token) {
    // 이미 공유 중 → 기존 토큰 반환 (멱등)
    return row.share_token
  }

  // 2. 신규 토큰 생성 + UPDATE
  const token = generateShareToken()
  const { error: updateErr } = await supabase
    .from('projects')
    .update({ share_token: token })
    .eq('id', id)
    .eq('owner', user.id)

  if (updateErr) {
    console.error('[shareRepo] shareProject update failed:', updateErr)
    throw new Error(updateErr.message)
  }

  return token
}

/**
 * 공유 토큰을 제거한다(공유 해제).
 * - supabase null → no-op (graceful degradation)
 * - share_token을 null로 UPDATE → 기존 링크 무효화
 */
export async function unshareProject(id: string): Promise<void> {
  if (!supabase) return

  const { user } = useAuthStore.getState()
  if (!user) return

  const { error } = await supabase
    .from('projects')
    .update({ share_token: null })
    .eq('id', id)
    .eq('owner', user.id)

  if (error) {
    console.error('[shareRepo] unshareProject failed:', error)
    throw new Error(error.message)
  }
}

/**
 * 토큰으로 공유 프로젝트를 읽어온다.
 * - supabase null → null (graceful degradation: 미설정 앱에서 뷰어 진입 무시)
 * - security-definer RPC 호출: 정확한 토큰 없이는 어떤 행도 반환하지 않음
 * - 미로그인(anon)도 동작: anon key에 get_shared_project execute 권한 있음
 * - 결과 없음 → null (토큰 무효 또는 공유 해제)
 * - 에러 → console.error + null (에러 전파 없음, 호출자가 에러 UI 처리)
 */
export async function fetchSharedProject(token: string): Promise<Project | null> {
  if (!supabase) return null

  try {
    const { data, error } = await supabase.rpc('get_shared_project', { p_token: token })

    if (error) {
      console.error('[shareRepo] fetchSharedProject rpc failed:', error)
      return null
    }

    const rows = data as Array<{ data: unknown }> | null
    if (!rows || rows.length === 0) return null

    const row = rows[0]!
    return deserializeProject(JSON.stringify(row.data))
  } catch (e) {
    console.error('[shareRepo] fetchSharedProject exception:', e)
    return null
  }
}
```

- [ ] **Step 6: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- shareRepo
```

Expected:
- `shareRepo.test.ts`: **7개** PASS
- `shareRepo.null.test.ts`: **3개** PASS

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 3: `parseShareToken.ts` 완전 TDD + `useShareLoader.ts` TDD

**Files:**
- Create `apps/web/src/share/parseShareToken.ts`
- Create `apps/web/src/share/test/parseShareToken.test.ts`
- Create `apps/web/src/share/useShareLoader.ts`
- Create `apps/web/src/share/test/useShareLoader.test.ts`

### Task 3a: parseShareToken 완전 TDD

- [ ] **Step 1: `parseShareToken.test.ts` 작성 (실패 상태)**

Create `apps/web/src/share/test/parseShareToken.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// 순수 함수 — mock 없음
import { parseShareToken } from '../parseShareToken'

describe('parseShareToken — 순수 URL 파서', () => {

  // ── 정상 케이스 ───────────────────────────────────────────────

  it('?share=abc123 → "abc123" 반환', () => {
    expect(parseShareToken('https://app.sculptone.com?share=abc123')).toBe('abc123')
  })

  it('여러 파라미터 중 share 포함 → share 값만 반환', () => {
    expect(
      parseShareToken('https://app.sculptone.com?foo=bar&share=tok42&baz=qux')
    ).toBe('tok42')
  })

  it('share 파라미터가 뒤에 있어도 추출됨', () => {
    expect(
      parseShareToken('https://app.sculptone.com?other=value&share=mytoken')
    ).toBe('mytoken')
  })

  it('URL에 hash가 있어도 share 파라미터 정상 추출', () => {
    expect(
      parseShareToken('https://app.sculptone.com?share=hashtest#section')
    ).toBe('hashtest')
  })

  it('32자 hex 형식 토큰 → 정상 반환', () => {
    const hexToken = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
    expect(parseShareToken(`https://app.sculptone.com?share=${hexToken}`)).toBe(hexToken)
  })

  // ── null 반환 케이스 ──────────────────────────────────────────

  it('share 파라미터 없음 → null', () => {
    expect(parseShareToken('https://app.sculptone.com')).toBeNull()
  })

  it('?share= 빈 문자열 → null', () => {
    expect(parseShareToken('https://app.sculptone.com?share=')).toBeNull()
  })

  it('다른 파라미터만 있음 → null', () => {
    expect(parseShareToken('https://app.sculptone.com?foo=bar&baz=qux')).toBeNull()
  })

  it('잘못된 URL 문자열 → null (예외 삼킴)', () => {
    expect(parseShareToken('not-a-valid-url')).toBeNull()
  })

  it('빈 문자열 → null', () => {
    expect(parseShareToken('')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- parseShareToken.test
```

Expected: FAIL — `'../parseShareToken'` 모듈 없음.

- [ ] **Step 3: `parseShareToken.ts` 구현**

Create `apps/web/src/share/parseShareToken.ts`:

```typescript
/**
 * URL 문자열에서 ?share=<token> 쿼리 파라미터를 추출한다.
 *
 * 순수 함수 — window.location에 직접 접근하지 않음.
 * 빈 문자열, 없는 파라미터, 잘못된 URL → null 반환.
 *
 * 호출자: useShareLoader가 window.location.href를 전달.
 * 테스트: parseShareToken.test.ts (완전 TDD, mock 없음).
 */
export function parseShareToken(url: string): string | null {
  try {
    const parsed = new URL(url)
    const token = parsed.searchParams.get('share')
    return token && token.length > 0 ? token : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- parseShareToken.test
```

Expected: **10개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

### Task 3b: useShareLoader TDD

- [ ] **Step 5: `useShareLoader.test.ts` 작성 (실패 상태)**

Create `apps/web/src/share/test/useShareLoader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useShareStore } from '../../cloud/shareStore'

// ── Mock: parseShareToken ────────────────────────────────────────────────────
const mockParseShareToken = vi.fn<(url: string) => string | null>()
vi.mock('../parseShareToken', () => ({
  parseShareToken: mockParseShareToken,
}))

// ── Mock: fetchSharedProject ─────────────────────────────────────────────────
const mockFetchSharedProject = vi.fn<(token: string) => Promise<unknown>>()
vi.mock('../../cloud/shareRepo', () => ({
  fetchSharedProject: mockFetchSharedProject,
}))

// ── Mock: window.location.href ───────────────────────────────────────────────
// jsdom 환경에서 window.location은 read-only이므로 Object.defineProperty로 mock
Object.defineProperty(window, 'location', {
  value: { href: 'https://app.sculptone.com?share=test-token' },
  writable: true,
})

import { useShareLoader } from '../useShareLoader'
import type { Project } from '@sculptone/score-model'

const fakeProject: Project = {
  id: 'shared-proj',
  metadata: {
    title: 'Shared',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('useShareLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // shareStore 초기화
    useShareStore.setState({
      isReadOnly: false,
      shareLoadState: 'idle',
      sharedProject: null,
      shareError: null,
    }, true)
    mockFetchSharedProject.mockResolvedValue(null)
  })

  it('토큰 없음 → fetchSharedProject 미호출, shareStore 변경 없음', async () => {
    mockParseShareToken.mockReturnValue(null)

    renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(mockFetchSharedProject).not.toHaveBeenCalled()
    })
    expect(useShareStore.getState().isReadOnly).toBe(false)
    expect(useShareStore.getState().shareLoadState).toBe('idle')
  })

  it('토큰 있음 + 프로젝트 반환 → setReadOnly(true), loaded, sharedProject 세팅', async () => {
    mockParseShareToken.mockReturnValue('valid-token')
    mockFetchSharedProject.mockResolvedValue(fakeProject)

    renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(useShareStore.getState().shareLoadState).toBe('loaded')
    })
    expect(useShareStore.getState().isReadOnly).toBe(true)
    expect(useShareStore.getState().sharedProject).toEqual(fakeProject)
    expect(useShareStore.getState().shareError).toBeNull()
  })

  it('토큰 있음 + null 반환(무효 토큰) → error 상태, shareError non-null', async () => {
    mockParseShareToken.mockReturnValue('invalid-token')
    mockFetchSharedProject.mockResolvedValue(null)

    renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(useShareStore.getState().shareLoadState).toBe('error')
    })
    expect(useShareStore.getState().shareError).not.toBeNull()
    expect(useShareStore.getState().isReadOnly).toBe(false)
  })

  it('토큰 있음 + fetchSharedProject throw → error 상태, shareError에 메시지', async () => {
    mockParseShareToken.mockReturnValue('token-throws')
    mockFetchSharedProject.mockRejectedValue(new Error('Network timeout'))

    renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(useShareStore.getState().shareLoadState).toBe('error')
    })
    expect(useShareStore.getState().shareError).toContain('Network timeout')
  })

  it('이미 isReadOnly=true이면 재실행 안 함 (멱등성)', async () => {
    useShareStore.setState({ isReadOnly: true, shareLoadState: 'loaded' }, true)
    mockParseShareToken.mockReturnValue('some-token')

    renderHook(() => useShareLoader())

    // 이미 loaded 상태 → fetchSharedProject 미호출
    await waitFor(() => {
      expect(mockFetchSharedProject).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 6: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- useShareLoader.test
```

Expected: FAIL — `'../useShareLoader'` 모듈 없음.

- [ ] **Step 7: `useShareLoader.ts` 구현**

Create `apps/web/src/share/useShareLoader.ts`:

```typescript
import { useEffect } from 'react'
import { parseShareToken } from './parseShareToken'
import { fetchSharedProject } from '../cloud/shareRepo'
import { useShareStore } from '../cloud/shareStore'

/**
 * 앱 마운트 시 URL을 감지해 공유 프로젝트를 로드한다.
 * App.tsx 최상단에서 한 번만 호출한다.
 *
 * 1. parseShareToken(window.location.href) — 순수 파서
 * 2. 토큰 없음: no-op (isReadOnly=false 유지, 기존 앱 경로)
 * 3. 토큰 있음:
 *    a. setShareLoadState('loading')
 *    b. fetchSharedProject(token) — supabase null 시 null 반환
 *    c. Project 반환: setSharedProject(p), setReadOnly(true), setShareLoadState('loaded')
 *    d. null 반환: setShareLoadState('error'), setShareError('공유 링크가 유효하지 않습니다.')
 *    e. 예외: setShareLoadState('error'), setShareError(err.message)
 *
 * 멱등성: isReadOnly가 이미 true이거나 shareLoadState !== 'idle'이면 재실행 안 함.
 * React StrictMode 이중 마운트 방어.
 */
export function useShareLoader(): void {
  const { isReadOnly, shareLoadState, setReadOnly, setShareLoadState, setSharedProject, setShareError } =
    useShareStore()

  useEffect(() => {
    // 멱등성: 이미 처리됐으면 재실행하지 않음
    if (isReadOnly || shareLoadState !== 'idle') return

    const token = parseShareToken(window.location.href)
    if (!token) return

    setShareLoadState('loading')

    fetchSharedProject(token)
      .then((project) => {
        if (!project) {
          setShareLoadState('error')
          setShareError('공유 링크가 유효하지 않습니다.')
          return
        }
        setSharedProject(project)
        setReadOnly(true)
        setShareLoadState('loaded')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
        setShareLoadState('error')
        setShareError(msg)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 마운트 시 1회만 실행
}
```

- [ ] **Step 8: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- "parseShareToken|useShareLoader"
```

Expected:
- `parseShareToken.test.ts`: **10개** PASS
- `useShareLoader.test.ts`: **5개** PASS

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 4: read-only 모드 배선 + 뷰어 셸

**Files:**
- Modify `apps/web/src/App.tsx`
- Create `apps/web/src/share/ShareLoadingScreen.tsx`
- Create `apps/web/src/share/ShareErrorScreen.tsx`
- Create `apps/web/src/share/ShareViewerShell.tsx`
- Create `apps/web/src/share/test/ShareViewerShell.test.tsx`

이 태스크는 구현 복잡도가 높고 기존 컴포넌트(PianoRoll, TransportBar, useAudio)에 의존한다. 완전 TDD 대신 **스모크 테스트**로 렌더 확인만 한다.

- [ ] **Step 1: `ShareLoadingScreen.tsx` 구현**

Create `apps/web/src/share/ShareLoadingScreen.tsx`:

```tsx
import type { CSSProperties } from 'react'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 16,
  background: 'var(--bg-base)',
  color: 'var(--text-mid)',
}

export function ShareLoadingScreen() {
  return (
    <div style={containerStyle}>
      <strong style={{ fontSize: 18 }}>Sculptone</strong>
      <span style={{ fontSize: 14 }}>공유 프로젝트를 불러오는 중...</span>
    </div>
  )
}
```

- [ ] **Step 2: `ShareErrorScreen.tsx` 구현**

Create `apps/web/src/share/ShareErrorScreen.tsx`:

```tsx
import type { CSSProperties } from 'react'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 12,
  background: 'var(--bg-base)',
  color: 'var(--text-mid)',
}

interface Props {
  message: string | null
}

export function ShareErrorScreen({ message }: Props) {
  return (
    <div style={containerStyle}>
      <strong style={{ fontSize: 18 }}>Sculptone</strong>
      <span style={{ fontSize: 14, color: 'var(--record)' }}>
        {message ?? '공유 링크가 유효하지 않습니다.'}
      </span>
      <a
        href={window.location.origin}
        style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'underline' }}
      >
        앱으로 돌아가기
      </a>
    </div>
  )
}
```

- [ ] **Step 3: `ShareViewerShell.tsx` 구현**

Create `apps/web/src/share/ShareViewerShell.tsx`:

```tsx
import { useEffect, type CSSProperties } from 'react'
import { useShareStore } from '../cloud/shareStore'
import { useStore } from '../state/store'
import { PianoRoll } from '../compose/PianoRoll'
import { VelocityLane } from '../compose/VelocityLane'
import { Playhead } from '../compose/Playhead'
import { TransportBar } from '../audio/TransportBar'
import { useAudio } from '../audio/useAudio'

const region: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
}

const readOnlyOverlay: CSSProperties = {
  pointerEvents: 'none',
  userSelect: 'none',
  position: 'relative',
}

/**
 * 읽기전용 공유 뷰어 셸.
 *
 * read-only 차단:
 * - useAutosave 미마운트 → autosave 없음
 * - useCloudSync 미마운트 → 동기화 없음
 * - useRecording 미마운트 → 녹음 없음
 * - PianoRoll/VelocityLane 래퍼에 pointer-events:none → 드래그/클릭 편집 차단
 * - 편집 단축키(Undo/Redo/녹음) 미등록
 *
 * 허용:
 * - 재생/정지 (TransportBar)
 * - PianoRoll 보기 (읽기전용)
 */
export function ShareViewerShell() {
  const sharedProject = useShareStore((s) => s.sharedProject)
  const replaceProject = useStore((s) => s.replaceProject)
  const { play, stop, getSeconds } = useAudio()

  // 공유 프로젝트를 store에 1회 로드
  useEffect(() => {
    if (sharedProject) {
      replaceProject(sharedProject)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // sharedProject 참조 안정성 — 마운트 시 1회

  return (
    <div
      style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}
    >
      {/* 툴바 — 읽기전용 배지 + 프로젝트 제목 */}
      <div
        style={{
          ...region,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 14px',
        }}
      >
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
          }}
        >
          읽기전용
        </span>
        {sharedProject && (
          <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>
            {sharedProject.metadata.title}
          </span>
        )}
      </div>

      {/* 본문 — PianoRoll + VelocityLane (pointer-events:none으로 편집 차단) */}
      <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
        <div style={readOnlyOverlay}>
          <PianoRoll />
          <VelocityLane />
          <Playhead getSeconds={getSeconds} />
        </div>
      </div>

      {/* 트랜스포트 — 재생/정지만 (녹음 없음) */}
      <div style={region}>
        <TransportBar onPlay={play} onStop={stop} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `App.tsx` 수정**

Modify `apps/web/src/App.tsx`:

```tsx
import { AppShell } from './shell/AppShell'
import { useShareLoader } from './share/useShareLoader'
import { useShareStore } from './cloud/shareStore'
import { ShareViewerShell } from './share/ShareViewerShell'
import { ShareLoadingScreen } from './share/ShareLoadingScreen'
import { ShareErrorScreen } from './share/ShareErrorScreen'

export default function App() {
  useShareLoader()

  const isReadOnly = useShareStore((s) => s.isReadOnly)
  const shareLoadState = useShareStore((s) => s.shareLoadState)
  const shareError = useShareStore((s) => s.shareError)

  if (isReadOnly) {
    if (shareLoadState === 'loading') return <ShareLoadingScreen />
    if (shareLoadState === 'error')   return <ShareErrorScreen message={shareError} />
    // shareLoadState === 'loaded'
    return <ShareViewerShell />
  }

  return <AppShell />
}
```

- [ ] **Step 5: `ShareViewerShell.test.tsx` 스모크 작성**

Create `apps/web/src/share/test/ShareViewerShell.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Project } from '@sculptone/score-model'
import { useShareStore } from '../../cloud/shareStore'

// 기존 컴포넌트 렌더 비용 최소화: PianoRoll 등 heavy 컴포넌트 mock
vi.mock('../../compose/PianoRoll', () => ({
  PianoRoll: () => <div data-testid="piano-roll" />,
}))
vi.mock('../../compose/VelocityLane', () => ({
  VelocityLane: () => <div data-testid="velocity-lane" />,
}))
vi.mock('../../compose/Playhead', () => ({
  Playhead: () => null,
}))
vi.mock('../../audio/TransportBar', () => ({
  TransportBar: ({ onPlay }: { onPlay: () => void }) => (
    <button data-testid="play-btn" onClick={onPlay}>Play</button>
  ),
}))
vi.mock('../../audio/useAudio', () => ({
  useAudio: () => ({ play: vi.fn(), stop: vi.fn(), getSeconds: vi.fn() }),
}))
vi.mock('../../state/store', () => ({
  useStore: (selector: (s: { replaceProject: () => void }) => unknown) =>
    selector({ replaceProject: vi.fn() }),
}))

import { ShareViewerShell } from '../ShareViewerShell'

const fakeProject: Project = {
  id: 'p1',
  metadata: { title: 'Test Share', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('ShareViewerShell — 스모크', () => {
  beforeEach(() => {
    useShareStore.setState({ sharedProject: fakeProject, isReadOnly: true, shareLoadState: 'loaded' }, true)
  })

  it('"읽기전용" 배지가 렌더됨', () => {
    render(<ShareViewerShell />)
    expect(screen.getByText('읽기전용')).toBeInTheDocument()
  })

  it('프로젝트 제목이 표시됨', () => {
    render(<ShareViewerShell />)
    expect(screen.getByText('Test Share')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- ShareViewerShell.test
```

Expected: **2개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 5: `ShareButton.tsx` — 공유 UI 스모크

**Files:**
- Create `apps/web/src/ui/ShareButton.tsx`
- Create `apps/web/src/ui/test/ShareButton.test.tsx`
- Modify `apps/web/src/shell/AppShell.tsx` (ShareButton 삽입)

- [ ] **Step 1: `ShareButton.tsx` 구현**

Create `apps/web/src/ui/ShareButton.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import { useAuthStore } from '../cloud/authStore'
import { isCloudConfigured, supabase } from '../cloud/supabase'
import { shareProject, unshareProject } from '../cloud/shareRepo'

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

const activeBtnStyle: CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  borderColor: 'var(--accent)',
}

/**
 * Share / Unshare 버튼.
 * Supabase 설정 + 로그인 상태일 때만 렌더.
 * 현재 프로젝트의 share_token을 조회해 상태 표시.
 */
export function ShareButton() {
  const status = useAuthStore((s) => s.status)
  const projectId = useStore((s) => s.project.id)

  const [shareToken, setShareToken] = useState<string | null | 'loading'>('loading')
  const [isActing, setIsActing] = useState(false)
  const [showPopover, setShowPopover] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Supabase 미설정 또는 미로그인 → 렌더하지 않음
  if (!isCloudConfigured() || status !== 'signedIn') return null

  // 현재 프로젝트의 share_token 조회
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!supabase) return
    setShareToken('loading')
    supabase
      .from('projects')
      .select('share_token')
      .eq('id', projectId)
      .then(({ data }) => {
        const row = (data as Array<{ share_token: string | null }> | null)?.[0]
        setShareToken(row?.share_token ?? null)
      })
      .catch(() => setShareToken(null))
  }, [projectId])

  const shareUrl = shareToken && shareToken !== 'loading'
    ? `${window.location.origin}?share=${shareToken}`
    : null

  const handleShare = async () => {
    setIsActing(true)
    try {
      const token = await shareProject(projectId)
      setShareToken(token)
      const url = `${window.location.origin}?share=${token}`
      try {
        await navigator.clipboard.writeText(url)
        setCopyMsg('링크가 복사됐습니다!')
      } catch {
        setCopyMsg(null) // clipboard 미지원 시 URL 텍스트만 표시
      }
      setShowPopover(true)
    } catch (e) {
      console.error('[ShareButton] shareProject failed:', e)
    } finally {
      setIsActing(false)
    }
  }

  const handleUnshare = async () => {
    setIsActing(true)
    try {
      await unshareProject(projectId)
      setShareToken(null)
      setShowPopover(false)
      setCopyMsg(null)
    } catch (e) {
      console.error('[ShareButton] unshareProject failed:', e)
    } finally {
      setIsActing(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      {shareToken && shareToken !== 'loading' ? (
        <button
          style={activeBtnStyle}
          onClick={() => setShowPopover((v) => !v)}
          disabled={isActing}
        >
          Shared
        </button>
      ) : (
        <button
          style={btnStyle}
          onClick={handleShare}
          disabled={isActing || shareToken === 'loading'}
          aria-label="프로젝트 공유"
        >
          {isActing ? 'Sharing...' : 'Share'}
        </button>
      )}

      {showPopover && shareUrl && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            padding: '10px 12px',
            zIndex: 100,
            minWidth: 260,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-mid)' }}>
            공유 링크
          </div>
          <div
            style={{
              fontSize: 11,
              wordBreak: 'break-all',
              color: 'var(--text-base)',
              marginBottom: 8,
              padding: '4px 6px',
              background: 'var(--bg-inset)',
              borderRadius: 4,
            }}
          >
            {shareUrl}
          </div>
          {copyMsg && (
            <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>
              {copyMsg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...btnStyle, fontSize: 11 }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl)
                  setCopyMsg('링크가 복사됐습니다!')
                } catch {
                  /* clipboard 미지원 */
                }
              }}
            >
              복사
            </button>
            <button
              style={{ ...btnStyle, fontSize: 11, color: 'var(--record)' }}
              onClick={handleUnshare}
              disabled={isActing}
            >
              {isActing ? '해제 중...' : 'Unshare'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `AppShell.tsx`에 ShareButton 삽입**

`apps/web/src/shell/AppShell.tsx`의 `<FileMenu />` 뒤, `<AuthButton />` 앞에 `<ShareButton />`을 추가한다.

```tsx
// 상단 import에 추가
import { ShareButton } from '../ui/ShareButton'

// 툴바 내 FileMenu 뒤에 삽입 (기존 코드에서 <FileMenu /> 바로 다음):
<FileMenu />
<ShareButton />   // ← 추가
<MidiDeviceSelect ... />
```

- [ ] **Step 3: `ShareButton.test.tsx` 스모크 작성**

Create `apps/web/src/ui/test/ShareButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAuthStore } from '../../cloud/authStore'
import { useShareStore } from '../../cloud/shareStore'

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../../cloud/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [{ share_token: null }], error: null })),
      })),
    })),
  },
  isCloudConfigured: () => true,
}))

const mockShareProject = vi.fn<() => Promise<string>>()
const mockUnshareProject = vi.fn<() => Promise<void>>()
vi.mock('../../cloud/shareRepo', () => ({
  shareProject: mockShareProject,
  unshareProject: mockUnshareProject,
}))

// store: 현재 프로젝트 id 제공
vi.mock('../../state/store', () => ({
  useStore: (selector: (s: { project: { id: string } }) => unknown) =>
    selector({ project: { id: 'proj-1' } }),
}))

// clipboard mock
const mockClipboardWriteText = vi.fn<() => Promise<void>>()
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
})
Object.defineProperty(window, 'location', {
  value: { origin: 'https://app.sculptone.com' },
  writable: true,
})

import { ShareButton } from '../ShareButton'

describe('ShareButton — 스모크', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShareProject.mockResolvedValue('new-token-abc')
    mockUnshareProject.mockResolvedValue(undefined)
    mockClipboardWriteText.mockResolvedValue(undefined)
  })

  it('isCloudConfigured=false 또는 미로그인 → 렌더되지 않음', () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    const { container } = render(<ShareButton />)
    expect(container.firstChild).toBeNull()
  })

  it('signedIn + 미공유 → "Share" 버튼 표시', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
    }, true)

    render(<ShareButton />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
    })
  })

  it('"Share" 클릭 → shareProject 호출됨', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
    }, true)

    render(<ShareButton />)

    await waitFor(() => screen.getByRole('button', { name: /^share$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }))

    await waitFor(() => {
      expect(mockShareProject).toHaveBeenCalledWith('proj-1')
    })
  })

  it('공유 후 "링크가 복사됐습니다!" 메시지 표시', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
    }, true)

    render(<ShareButton />)

    await waitFor(() => screen.getByRole('button', { name: /^share$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }))

    await waitFor(() => {
      expect(screen.getByText('링크가 복사됐습니다!')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 4: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- ShareButton.test
```

Expected: **4개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 6: 최종 게이트

**이 태스크에서 CI 게이트 기준을 충족한다. 인프라 파일은 절대 수정하지 말 것.**

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
pnpm --filter @sculptone/web test
```

Expected:
- 기존 테스트 전체 통과 (Sub-project A·B 회귀 없음)
- 신규 테스트 (`shareRepo`, `parseShareToken`, `useShareLoader`, `ShareViewerShell`, `ShareButton`) 전체 PASS

- [ ] **Step 2: 커버리지 확인**

```bash
pnpm --filter @sculptone/web test --coverage
```

Expected:
- 함수 커버리지 **82% 이상** 유지 (기존 기준).
- 새로 추가된 순수 함수(`parseShareToken`, `shareRepo`)는 완전 커버.

- [ ] **Step 3: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. `React` named import 패턴 준수 (`import { useState } from 'react'`).

- [ ] **Step 4: ESLint 0 오류**

```bash
pnpm --filter @sculptone/web lint
```

Expected: 오류 0개.

- [ ] **Step 5: Prettier**

```bash
pnpm --filter @sculptone/web exec prettier --check "src/**/*.{ts,tsx}"
```

Expected: 포맷 위반 없음. 있으면 `prettier --write`로 수정.

- [ ] **Step 6: 최종 보안 점검**

다음을 수동으로 확인:
- `0002_share.sql`에 anon SELECT 정책이 없는지 확인 (search_path: `create policy ... for select using (share_token is not null)` 구문 없음)
- `shareRepo.ts`에서 `fetchSharedProject`가 `supabase.rpc('get_shared_project', ...)` 호출인지 확인 (직접 `.from('projects').select()` 없음)
- `shareRepo.null.test.ts`에서 `fetchSharedProject` null guard 확인

---

## 우려 및 주의사항

### 라우터 없는 앱의 뷰어 진입

**현재 앱은 라우터가 없다** (AppShell이 URL 변경에 반응하지 않는다). 뷰어 진입은 URL 쿼리 파라미터 + App.tsx 레벨 분기로만 구현된다.

**주의**: 뷰어에서 `history.pushState`로 URL을 변경해도 React 상태는 변하지 않는다. 뷰어에서 편집 앱으로 되돌아가는 방법은 `window.location.href = origin`으로 전체 리로드뿐이다 — 이것이 의도된 동작이다.

### read-only 차단 누락 위험

**`pointer-events: none` 래퍼**는 마우스 이벤트를 차단하나 **키보드 이벤트는 차단하지 않는다**. ShareViewerShell에서는 AppShell의 `useEffect` 키보드 리스너를 마운트하지 않으므로 Undo/Redo/편집 단축키가 등록되지 않는다. 그러나 PianoRoll 등이 독자적인 keydown 리스너를 등록한다면 차단되지 않을 수 있다 — 구현 시 확인 필요.

**store 편집 액션 직접 차단 미구현**: `pointer-events: none`을 우회하는 방법(개발자 도구 console 등)으로 store.setProject를 직접 호출하면 편집이 가능하다. 뷰어는 **신뢰 경계(trust boundary)** 를 클라이언트에 두지 않는다 — 서버(RLS + security-definer)가 쓰기를 막으므로 클라이언트 차단은 UX 목적이다.

### RPC 보안

`get_shared_project` 함수는 `security definer`이므로 Supabase 내부적으로 postgres 역할로 실행된다. `set search_path = public`이 없으면 search_path injection 공격에 취약할 수 있다 — 반드시 포함해야 한다.

### supabase anon 키 유출

Share 기능은 anon 키로 RPC를 호출한다. Supabase anon 키는 클라이언트에 노출되어도 괜찮도록 설계된 공개 키이며, RLS가 접근을 제한한다. anon 키 유출로 인한 위협은 `get_shared_project`에 정확한 토큰 없이 호출해도 빈 결과만 반환되므로 무해하다.
