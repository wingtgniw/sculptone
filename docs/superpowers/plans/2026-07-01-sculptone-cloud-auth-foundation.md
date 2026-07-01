# Sculptone Cloud Auth Foundation (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Supabase OAuth 소셜 로그인(Google + GitHub)을 Sculptone에 가산적으로 추가한다. 기존 local-first(IndexedDB) 구조를 건드리지 않으며, Supabase 미설정 시 앱은 100% 로컬 전용으로 동작하고 인증 UI는 숨겨진다(graceful degradation). 새 `apps/web/src/cloud/` 디렉토리에 클라이언트 싱글톤·상태 스토어·UI 컴포넌트를 완전 TDD로 구현하고, AppShell 상단바에 `<AuthButton />`를 마운트한다.

**Architecture:** 가산적 `cloud/` 레이어 원칙. `supabase.ts`는 env 분기로 `SupabaseClient | null` 싱글톤을 export한다. `authStore.ts`는 Zustand로 4-상태(`disabled`·`loading`·`signedOut`·`signedIn`) 기계를 구현하며, `supabase === null` 시 init/signIn/signOut이 no-op이 된다. `AuthButton.tsx`는 4-상태에 따라 null·로딩·로그인 버튼·유저 메뉴를 렌더한다. 기존 `state/store.ts`·`io/`·`compose/`는 수정하지 않는다.

**Mock 전략 요약:**
- `supabase.ts` 테스트: `vi.mock('@supabase/supabase-js', ...)` 호이스팅 + `vi.resetModules()` + `vi.stubEnv()` + 동적 `await import(...)` 패턴.
- `authStore.ts` 테스트: `vi.mock('../supabase', ...)` 호이스팅으로 싱글톤을 mock 클라이언트로 교체. configured/disabled 경로는 파일 분리.
- `AuthButton.tsx` 테스트: `useAuthStore.setState(...)` 직접 상태 주입 + jsdom 렌더.

**Tech Stack:** React 18 + TS · Zustand 4 · @supabase/supabase-js · Vitest 2.1.9(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **전제 조건(이미 구현됨):**
> - `apps/web/src/shell/AppShell.tsx` — 상단 툴바 (48px flex div, BPM span 앞에 마운트할 공간)
> - `apps/web/src/state/store.ts` — Zustand 패턴 (create, getInitialState, setState(state, true))
> - `apps/web/src/ui/Button.tsx` — `variant` prop, 인라인 스타일 CSS 변수 패턴
> - `apps/web/vitest.config.ts` — jsdom, globals:true, setupFiles, coverage thresholds(functions:82%)
> - pnpm 11 모노레포 workspace, `@sculptone/web` 패키지명

---

## 비목표 (이 계획에서 하지 말 것)

- Sub-project B: 클라우드 프로젝트 업로드/다운로드/동기화
- Sub-project C: 프로젝트 공유 / 공개 링크
- 이메일/비밀번호 로그인 (OAuth만)
- Supabase RLS 정책 설정
- Supabase Storage 파일 저장
- 유저 프로파일 편집 (아바타 업로드 등)
- **인프라/CI 파일 변경** (`.github/`, 루트 설정, eslint/prettier 설정 파일, `allowedBuilds`)
- `packages/score-model`, `packages/sound-engine` 수정
- 기존 `state/store.ts`, `io/`, `compose/` 등 기존 코드 수정 (AppShell 제외)

---

## 설계 근거

### import.meta.env 모킹 전략 (Vitest 2.x)

`supabase.ts`는 모듈 로드 시점에 `import.meta.env.VITE_SUPABASE_URL`을 읽어 `supabase` 변수를 초기화한다. 이 모듈-수준 초기화를 테스트하려면 env 변수가 import **전에** 설정되어 있어야 한다.

**사용 패턴**: `vi.stubEnv` + `vi.resetModules()` + 동적 `await import()`

```ts
// supabase.test.ts 구조
vi.mock('@supabase/supabase-js', () => ({      // 호이스팅 — 항상 mock 사용
  createClient: vi.fn(() => ({ _mock: true })),
}))

beforeEach(() => { vi.resetModules() })        // 각 테스트 전 모듈 캐시 초기화
afterEach(() => { vi.unstubAllEnvs() })         // env stub 정리

it('URL + key 있음 → non-null', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
  const { supabase } = await import('../supabase')  // resetModules 이후 재실행
  expect(supabase).not.toBeNull()
})
```

**동작 원리**: `vi.resetModules()`는 Vitest의 모듈 레지스트리 캐시를 비운다. `vi.mock` 등록은 유지된다. 이후 `await import('../supabase')`는 supabase.ts를 새로 실행하고, 이때 `import.meta.env.VITE_*`는 `vi.stubEnv`로 설정된 값을 반환한다.

**주의**: `vi.stubEnv`로 설정한 값이 `''`(빈 문자열)이면 falsy이므로 `url && key ? createClient : null` 분기에서 null이 된다. 환경변수가 아예 없으면 `undefined`(falsy). 두 경우 모두 null 경로.

### authStore: supabase 싱글톤 참조와 모킹

`authStore.ts`는 `import { supabase } from './supabase'`로 싱글톤을 참조한다. Zustand `create` 팩토리가 모듈 로드 시 실행되므로, 이 시점의 `supabase` 값이 초기 `status`를 결정한다.

테스트에서 `vi.mock('../supabase', ...)` 호이스팅으로 authStore.ts가 import될 때 mock supabase를 받게 한다. 두 가지 시나리오를 **별도 파일**로 분리:

- **`authStore.test.ts`**: `vi.mock` → supabase non-null → 초기 `status = 'loading'`
- **`authStore.disabled.test.ts`**: `vi.mock` → supabase null → 초기 `status = 'disabled'`

Vitest에서 각 테스트 파일은 독립적인 모듈 환경에서 실행되므로, 두 파일의 `vi.mock`은 서로 영향을 주지 않는다.

### onAuthStateChange 구독/정리 패턴

```ts
// authStore.ts init() 내부:
const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  set(session?.user ? { status: 'signedIn', user: toAuthUser(session.user) }
                    : { status: 'signedOut', user: null })
})
return () => subscription.unsubscribe()
// ↑ 이 정리 함수를 useEffect에서 그대로 반환: useEffect(() => init(), [])

// 테스트에서:
const mockUnsubscribe = vi.fn()
const mockOnAuthStateChange = vi.fn((_cb: unknown) => ({
  data: { subscription: { unsubscribe: mockUnsubscribe } },
}))
// 구독 해제 검증:
const cleanup = useAuthStore.getState().init()
cleanup()
expect(mockUnsubscribe).toHaveBeenCalledOnce()
// onAuthStateChange 콜백 직접 호출 검증:
const cb = mockOnAuthStateChange.mock.calls[0]![0]
cb('SIGNED_IN', mockSession)
expect(useAuthStore.getState().status).toBe('signedIn')
```

### signInWithOAuth redirectTo

```ts
await supabase.auth.signInWithOAuth({
  provider,
  options: { redirectTo: window.location.origin },
})
```

OAuth 방식이므로 `signInWithOAuth` 호출 후 브라우저는 OAuth provider 페이지로 리다이렉트된다. 앱으로 복귀하면 `onAuthStateChange`가 자동으로 `SIGNED_IN` 이벤트를 발행한다. 따라서 `signIn()` 함수 자체는 status를 'signedIn'으로 직접 변경하지 않는다.

### graceful degradation 경로

```
supabase.ts: url && key ? createClient(...) : null
authStore.ts: status = supabase ? 'loading' : 'disabled'
             signIn/signOut/init: if (!supabase) return / return () => {}
AuthButton.tsx: if (status === 'disabled') return null
AppShell.tsx: <AuthButton /> — disabled 시 null 렌더 → DOM에 없음
```

환경변수가 없는 로컬 개발 환경에서는 위 경로가 전부 실행된다. 앱 기능 100% 정상.

### AuthButton init 배치 (hooks-before-early-return 규칙)

```tsx
export function AuthButton() {
  const status = useAuthStore((s) => s.status)
  // ... 다른 selector들
  
  useEffect(() => {                    // ← early return 전에 배치 (React hooks 규칙)
    return useAuthStore.getState().init()
  }, [])
  
  if (status === 'disabled') return null  // ← early return
  // ...
}
```

`status === 'disabled'`일 때 init()은 즉시 `() => {}` 를 반환하므로 불필요한 API 호출 없음.

---

## File Structure

```
apps/web/
  package.json                           MOD: @supabase/supabase-js dependency 추가
  .env.example                           NEW: 두 변수 이름 + 가이드 주석

  src/
    cloud/                               NEW: 신규 디렉토리
      supabase.ts                        NEW: 싱글톤 클라이언트
      authStore.ts                       NEW: Zustand 4-상태 기계
      AuthButton.tsx                     NEW: 4-상태 렌더 UI
      test/
        supabase.test.ts                 NEW: env 분기 TDD (~6개)
        authStore.test.ts                NEW: configured 경로 TDD (~12개)
        authStore.disabled.test.ts       NEW: disabled 경로 TDD (~3개)
        AuthButton.test.tsx              NEW: jsdom 스모크 (~6개)

    shell/
      AppShell.tsx                       MOD: AuthButton import + 마운트
```

변경 없는 파일:
- `apps/web/src/state/store.ts`
- `apps/web/src/io/**`, `apps/web/src/compose/**`, `apps/web/src/audio/**`
- `apps/web/vitest.config.ts`, `apps/web/vite.config.ts`
- `packages/score-model/**`, `packages/sound-engine/**`
- CI/인프라 파일 전체

---

## Task 1: 의존성 + 환경변수 설정

**Files:** Modify `apps/web/package.json`, Create `apps/web/.env.example`

- [ ] **Step 1: @supabase/supabase-js 의존성 추가**

```bash
pnpm --filter @sculptone/web add @supabase/supabase-js
```

`@supabase/supabase-js`는 네이티브 빌드(node-gyp)가 없는 순수 JS 패키지다. `allowedBuilds` 설정 불필요. 설치 후 `apps/web/package.json`의 `dependencies`에 추가됨을 확인한다.

- [ ] **Step 2: 타입체크 빌드 통과 확인**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. (supabase.ts 아직 없으나 새 패키지 타입만 로드됨)

- [ ] **Step 3: .env.example 생성**

Create `apps/web/.env.example`:

```bash
# Supabase Cloud Auth (Sub-project A)
# ─────────────────────────────────────────────────────────────────────────────
# 클라우드 기능(소셜 로그인)을 사용하려면 아래 두 변수를 .env.local에 설정하세요.
# 두 변수가 모두 없으면 앱은 로컬 전용 모드로 동작합니다(크래시·기능저하 없음).
#
# 설정 방법:
#  1. Supabase (https://supabase.com) 에서 새 프로젝트를 생성합니다.
#  2. 대시보드 → Authentication → Providers 에서 Google, GitHub를 활성화합니다.
#     각 provider의 Client ID / Secret은 Google Cloud Console, GitHub OAuth Apps에서 발급합니다.
#  3. 대시보드 → Project Settings → API 에서 아래 두 값을 복사해 .env.local에 붙여넣습니다.
#     (.env.local 은 .gitignore에 포함되어 있어 커밋되지 않습니다)
# ─────────────────────────────────────────────────────────────────────────────
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

---

## Task 2: `supabase.ts` 클라이언트 싱글톤 — 완전 TDD

**Files:** Create `apps/web/src/cloud/supabase.ts`, Create `apps/web/src/cloud/test/supabase.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/cloud/test/supabase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @supabase/supabase-js 전체 모킹 (호이스팅 — import보다 먼저 실행됨)
// supabase.ts 내 createClient 호출을 인터셉트한다.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ _isMockClient: true })),
}))

// 이 파일은 '../supabase'를 정적으로 import하지 않는다.
// 각 테스트는 vi.resetModules() 후 동적 import로 새 모듈 인스턴스를 얻는다.

describe('supabase singleton', () => {
  beforeEach(() => {
    vi.resetModules() // 각 테스트 전 모듈 캐시 초기화 → 동적 import 시 재실행
  })

  afterEach(() => {
    vi.unstubAllEnvs() // vi.stubEnv로 설정한 env 정리
  })

  // ── 클라이언트 생성 분기 ──────────────────────────────────

  it('URL과 key가 모두 설정되면 supabase client가 non-null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key-abc123')
    const { supabase } = await import('../supabase')
    expect(supabase).not.toBeNull()
  })

  it('URL이 비어 있으면 supabase client가 null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  it('key가 비어 있으면 supabase client가 null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  it('URL과 key 모두 없으면 supabase client가 null이다', async () => {
    // stubEnv에 빈 문자열: falsy → null 경로
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  // ── isCloudConfigured 분기 ────────────────────────────────

  it('isCloudConfigured()는 client non-null 시 true를 반환한다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
    const { isCloudConfigured } = await import('../supabase')
    expect(isCloudConfigured()).toBe(true)
  })

  it('isCloudConfigured()는 client null 시 false를 반환한다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { isCloudConfigured } = await import('../supabase')
    expect(isCloudConfigured()).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- supabase.test
```

Expected: FAIL — `'../supabase'` 모듈 없음.

- [ ] **Step 3: supabase.ts 구현**

Create `apps/web/src/cloud/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Vite 환경변수에서 Supabase 접속 정보를 읽는다.
 * 두 변수가 모두 truthy일 때만 createClient를 호출한다.
 * 하나라도 없으면 null — import 시점 크래시 없음.
 *
 * 로컬 개발: apps/web/.env.local 에 변수 설정
 * 설정 가이드: apps/web/.env.example 참조
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase 클라이언트 싱글톤.
 * - non-null: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY 둘 다 설정됨 → 클라우드 모드.
 * - null: 하나 이상 미설정 → 로컬 전용 모드(앱은 정상 동작, 인증 UI 숨김).
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/**
 * Supabase 클라이언트가 설정됐는지 여부.
 * true → 클라우드 기능(인증·동기화) 사용 가능.
 * false → 로컬 전용 모드.
 */
export function isCloudConfigured(): boolean {
  return supabase !== null
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- supabase.test
```

Expected: **6개** PASS.

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 3: `authStore.ts` — 4-상태 기계 완전 TDD

**Files:** Create `apps/web/src/cloud/authStore.ts`, Create `apps/web/src/cloud/test/authStore.test.ts`, Create `apps/web/src/cloud/test/authStore.disabled.test.ts`

### Task 3a: configured 경로 테스트 + 구현

- [ ] **Step 1: authStore.test.ts 작성 (실패 상태)**

Create `apps/web/src/cloud/test/authStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock: supabase 싱글톤을 non-null mock 클라이언트로 교체 ──────────────────
// vi.mock은 호이스팅되어 authStore 정적 import보다 먼저 실행됨.
// authStore.ts의 `const { supabase } = import('./supabase')`가 이 mock을 받는다.

const mockUnsubscribe = vi.fn()
const mockOnAuthStateChange = vi.fn(
  // cb 시그니처: (event: string, session: Session | null) => void
  (_cb: (event: string, session: { user: MockUser } | null) => void) => ({
    data: { subscription: { unsubscribe: mockUnsubscribe } },
  }),
)
const mockGetSession = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockSignOut = vi.fn()

interface MockUser {
  id: string
  email: string
  user_metadata: { avatar_url?: string }
}

const mockUser: MockUser = {
  id: 'user-123',
  email: 'test@example.com',
  user_metadata: { avatar_url: 'https://example.com/avatar.png' },
}

const mockSupabase = {
  auth: {
    getSession: mockGetSession,
    onAuthStateChange: mockOnAuthStateChange,
    signInWithOAuth: mockSignInWithOAuth,
    signOut: mockSignOut,
  },
}

vi.mock('../supabase', () => ({
  supabase: mockSupabase,
  isCloudConfigured: () => true,
}))

import { useAuthStore } from '../authStore'

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('authStore — configured path (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 초기 상태 복원: supabase non-null → status='loading'
    useAuthStore.setState({ status: 'loading', user: null, error: null }, true)
    // getSession 기본값: 세션 없음
    mockGetSession.mockResolvedValue({ data: { session: null } })
    // signOut 기본값: 성공
    mockSignOut.mockResolvedValue({ error: null })
    // signInWithOAuth 기본값: 성공 (redirect)
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
  })

  // ── 초기 상태 ───────────────────────────────────────────────

  it('supabase non-null → 초기 status가 loading이다', () => {
    // create() 호출 시점의 supabase가 truthy → status = 'loading'
    // 이 테스트는 모듈 수준 초기화를 검증 (beforeEach에서 명시적 setState로 보강)
    expect(useAuthStore.getState().status).toBe('loading')
  })

  // ── init(): 세션 복원 ────────────────────────────────────────

  it('init() → getSession(null) → status = signedOut', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).toBe('signedOut')
    })
    cleanup()
  })

  it('init() → getSession(session) → status = signedIn, user 설정', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: mockUser } },
    })
    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).toBe('signedIn')
    })
    const user = useAuthStore.getState().user
    expect(user).not.toBeNull()
    expect(user!.id).toBe('user-123')
    expect(user!.email).toBe('test@example.com')
    expect(user!.avatarUrl).toBe('https://example.com/avatar.png')
    cleanup()
  })

  // ── init(): onAuthStateChange 구독 ────────────────────────────

  it('init() → onAuthStateChange가 SIGNED_IN 이벤트 → status = signedIn', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const cleanup = useAuthStore.getState().init()

    // onAuthStateChange 콜백을 직접 호출해 SIGNED_IN 시뮬레이션
    await vi.waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalledOnce()
    })
    const cb = mockOnAuthStateChange.mock.calls[0]![0]
    cb('SIGNED_IN', { user: mockUser })

    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(useAuthStore.getState().user?.id).toBe('user-123')
    cleanup()
  })

  it('init() → onAuthStateChange가 SIGNED_OUT 이벤트 → status = signedOut, user = null', async () => {
    // 먼저 signedIn 상태로 설정
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null }, error: null }, true)
    mockGetSession.mockResolvedValue({ data: { session: { user: mockUser } } })

    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalledOnce()
    })
    const cb = mockOnAuthStateChange.mock.calls[0]![0]
    cb('SIGNED_OUT', null)

    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().user).toBeNull()
    cleanup()
  })

  // ── init(): 구독 정리 ────────────────────────────────────────

  it('init() 반환 정리 함수 호출 시 subscription.unsubscribe()가 호출된다', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => expect(mockOnAuthStateChange).toHaveBeenCalled())
    cleanup()
    expect(mockUnsubscribe).toHaveBeenCalledOnce()
  })

  // ── signIn ────────────────────────────────────────────────────

  it('signIn("google") → signInWithOAuth가 provider=google, redirectTo=origin으로 호출된다', async () => {
    await useAuthStore.getState().signIn('google')
    expect(mockSignInWithOAuth).toHaveBeenCalledOnce()
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  })

  it('signIn("github") → provider=github으로 호출된다', async () => {
    await useAuthStore.getState().signIn('github')
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }),
    )
  })

  it('signIn 오류 → status = signedOut, error 설정', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: new Error('OAuth failed') })
    useAuthStore.setState({ status: 'signedOut', user: null, error: null }, true)
    await useAuthStore.getState().signIn('google')
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().error).toBe('OAuth failed')
  })

  // ── signOut ───────────────────────────────────────────────────

  it('signOut() 성공 → status = signedOut, user = null', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null }, error: null },
      true,
    )
    mockSignOut.mockResolvedValue({ error: null })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('signOut() 오류 → status = signedIn(복구), error 설정', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null }, error: null },
      true,
    )
    mockSignOut.mockResolvedValue({ error: new Error('Network error') })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(useAuthStore.getState().error).toBe('Network error')
  })

  // ── error 초기화 ──────────────────────────────────────────────

  it('signIn 성공 시(redirect) error = null로 초기화된다', async () => {
    // 이전 에러가 있는 상태에서 signIn 성공
    useAuthStore.setState({ status: 'signedOut', user: null, error: 'previous error' }, true)
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    await useAuthStore.getState().signIn('google')
    expect(useAuthStore.getState().error).toBeNull()
  })

  it('signOut 성공 시 error = null로 초기화된다', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null }, error: 'old error' },
      true,
    )
    mockSignOut.mockResolvedValue({ error: null })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().error).toBeNull()
  })
})
```

- [ ] **Step 2: authStore.disabled.test.ts 작성**

Create `apps/web/src/cloud/test/authStore.disabled.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

// supabase null → disabled 모드 시뮬레이션
// 별도 파일 분리: vi.mock은 파일 단위로 격리됨
vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

// vi.mock 호이스팅 후 authStore import → create()가 supabase=null로 실행
import { useAuthStore } from '../authStore'

describe('authStore — disabled path (supabase null)', () => {
  // ── 초기 상태 ───────────────────────────────────────────────

  it('supabase null → 초기 status = disabled', () => {
    expect(useAuthStore.getState().status).toBe('disabled')
  })

  // ── init() no-op ─────────────────────────────────────────────

  it('init() → 즉시 정리 함수 반환, 내부 API 미호출', () => {
    // disabled 모드에서 init()은 getSession/onAuthStateChange를 호출하지 않아야 함
    // mock supabase가 null이므로 auth.getSession 등은 존재하지 않음
    // init()이 오류 없이 빈 정리 함수를 반환하는지 확인
    expect(() => {
      const cleanup = useAuthStore.getState().init()
      cleanup() // 호출해도 오류 없음
    }).not.toThrow()
    expect(useAuthStore.getState().status).toBe('disabled') // 상태 변화 없음
  })

  // ── signIn no-op ──────────────────────────────────────────────

  it('signIn(provider) → 호출해도 status 변화 없음, 오류 없음', async () => {
    await expect(useAuthStore.getState().signIn('google')).resolves.toBeUndefined()
    expect(useAuthStore.getState().status).toBe('disabled')
  })
})
```

- [ ] **Step 3: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- authStore
```

Expected: FAIL — `'../authStore'` 모듈 없음.

- [ ] **Step 4: authStore.ts 구현**

Create `apps/web/src/cloud/authStore.ts`:

```ts
import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AuthStatus = 'disabled' | 'loading' | 'signedOut' | 'signedIn'

export interface AuthUser {
  id: string
  email: string | null
  avatarUrl: string | null
}

/** Supabase User → AuthUser 변환 */
function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    // user_metadata.avatar_url: Google/GitHub OAuth에서 제공
    avatarUrl: (user.user_metadata?.['avatar_url'] as string | undefined) ?? null,
  }
}

interface AuthState {
  /** 인증 상태 기계. 초기값: supabase 설정 여부에 따라 'disabled'|'loading'. */
  status: AuthStatus
  /** 현재 로그인 유저. signedIn 상태에서만 non-null. */
  user: AuthUser | null
  /** 마지막 signIn/signOut 오류 메시지. null = 없음. 다음 성공 시 초기화. */
  error: string | null
  /**
   * 세션 복원 + onAuthStateChange 구독.
   * 반환값: 정리 함수 (useEffect return으로 직접 사용 가능).
   * supabase === null(disabled) 시: 즉시 no-op 정리 함수 반환.
   */
  init: () => () => void
  /**
   * 소셜 OAuth 로그인 시작.
   * signInWithOAuth는 페이지를 provider로 리다이렉트하므로,
   * 이 함수가 반환된 후 앱이 OAuth 결과를 받아 onAuthStateChange가 status를 갱신.
   * supabase === null 시: no-op.
   */
  signIn: (provider: 'google' | 'github') => Promise<void>
  /**
   * 로그아웃.
   * 성공: status='signedOut', user=null.
   * 실패: status 복구, error 설정.
   * supabase === null 시: no-op.
   */
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // supabase가 null이면 disabled(미설정), non-null이면 loading(세션 복원 대기)
  status: supabase !== null ? 'loading' : 'disabled',
  user: null,
  error: null,

  init: () => {
    if (!supabase) return () => {}

    // 1. 현재 세션 복원 (페이지 새로고침 후 로그인 상태 유지)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        set({ status: 'signedIn', user: toAuthUser(session.user) })
      } else {
        set({ status: 'signedOut' })
      }
    })

    // 2. 인증 상태 변경 실시간 구독 (OAuth 복귀, 세션 만료 등)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        set({ status: 'signedIn', user: toAuthUser(session.user) })
      } else {
        set({ status: 'signedOut', user: null })
      }
    })

    // 3. 정리 함수 반환: useEffect(() => init(), []) 으로 마운트/언마운트 대칭 처리
    return () => subscription.unsubscribe()
  },

  signIn: async (provider) => {
    if (!supabase) return
    // 이전 에러 초기화
    set({ error: null })
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // OAuth 완료 후 앱으로 복귀할 URL
          redirectTo: window.location.origin,
        },
      })
      if (error) throw error
      // 성공 시: 브라우저가 provider로 리다이렉트됨
      // status는 앱이 복귀한 후 onAuthStateChange 콜백에서 'signedIn'으로 전환
    } catch (e) {
      set({ status: 'signedOut', error: (e as Error).message })
    }
  },

  signOut: async () => {
    if (!supabase) return
    const prevStatus = get().status
    set({ status: 'loading', error: null })
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      set({ status: 'signedOut', user: null })
    } catch (e) {
      // 오류 시 이전 상태 복구
      set({ status: prevStatus, error: (e as Error).message })
    }
  },
}))
```

- [ ] **Step 5: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- authStore
```

Expected:
- `authStore.test.ts`: **12개** PASS
- `authStore.disabled.test.ts`: **3개** PASS

타입체크:
```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음.

---

## Task 4: `AuthButton.tsx` + AppShell 마운트 — 레퍼런스 구현 + jsdom 스모크

**Files:** Create `apps/web/src/cloud/AuthButton.tsx`, Create `apps/web/src/cloud/test/AuthButton.test.tsx`, Modify `apps/web/src/shell/AppShell.tsx`

- [ ] **Step 1: AuthButton.test.tsx 작성 (실패 상태)**

Create `apps/web/src/cloud/test/AuthButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { useAuthStore } from '../authStore'
import type { AuthUser } from '../authStore'

// authStore의 init이 Supabase API를 호출하지 않도록 mock
vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

import { AuthButton } from '../AuthButton'

const mockUser: AuthUser = {
  id: 'user-abc',
  email: 'user@example.com',
  avatarUrl: null,
}

describe('AuthButton — 4-상태 렌더 스모크', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 상태 초기화
    useAuthStore.setState({ status: 'disabled', user: null, error: null }, true)
  })

  // ── disabled 상태 ─────────────────────────────────────────────

  it('status=disabled → null 렌더 (DOM에 없음)', () => {
    act(() => {
      useAuthStore.setState({ status: 'disabled' }, true)
    })
    const { container } = render(<AuthButton />)
    expect(container.firstChild).toBeNull()
  })

  // ── loading 상태 ──────────────────────────────────────────────

  it('status=loading → 로딩 표시가 렌더된다', () => {
    act(() => {
      useAuthStore.setState({ status: 'loading' }, true)
    })
    render(<AuthButton />)
    // data-testid="auth-loading"으로 로딩 인디케이터 식별
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument()
  })

  // ── signedOut 상태 ────────────────────────────────────────────

  it('status=signedOut → Google, GitHub 로그인 버튼이 렌더된다', () => {
    act(() => {
      useAuthStore.setState({ status: 'signedOut' }, true)
    })
    render(<AuthButton />)
    expect(screen.getByTestId('signin-google')).toBeInTheDocument()
    expect(screen.getByTestId('signin-github')).toBeInTheDocument()
  })

  it('signedOut → Google 버튼 클릭 → signIn("google") 호출', async () => {
    const mockSignIn = vi.fn().mockResolvedValue(undefined)
    act(() => {
      useAuthStore.setState({ status: 'signedOut', signIn: mockSignIn } as Parameters<typeof useAuthStore.setState>[0])
    })
    render(<AuthButton />)
    await userEvent.click(screen.getByTestId('signin-google'))
    expect(mockSignIn).toHaveBeenCalledWith('google')
  })

  // ── signedIn 상태 ─────────────────────────────────────────────

  it('status=signedIn → 유저 이메일과 로그아웃 버튼이 렌더된다', () => {
    act(() => {
      useAuthStore.setState({ status: 'signedIn', user: mockUser }, true)
    })
    render(<AuthButton />)
    expect(screen.getByTestId('auth-user-info')).toBeInTheDocument()
    expect(screen.getByTestId('signout-btn')).toBeInTheDocument()
    // 유저 이메일이 표시됨
    expect(screen.getByText(/user@example\.com/)).toBeInTheDocument()
  })

  it('signedIn → 로그아웃 버튼 클릭 → signOut() 호출', async () => {
    const mockSignOut = vi.fn().mockResolvedValue(undefined)
    act(() => {
      useAuthStore.setState({
        status: 'signedIn',
        user: mockUser,
        signOut: mockSignOut,
      } as Parameters<typeof useAuthStore.setState>[0])
    })
    render(<AuthButton />)
    await userEvent.click(screen.getByTestId('signout-btn'))
    expect(mockSignOut).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- AuthButton.test
```

Expected: FAIL — `'../AuthButton'` 모듈 없음.

- [ ] **Step 3: AuthButton.tsx 구현 (레퍼런스 구현)**

Create `apps/web/src/cloud/AuthButton.tsx`:

```tsx
import { type CSSProperties, useEffect } from 'react'
import { useAuthStore } from './authStore'

// ── 인라인 스타일 (기존 AppShell 버튼 패턴과 동일) ─────────────────────────

const btnBase: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  lineHeight: 1.4,
}

const signInBtn: CSSProperties = {
  ...btnBase,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  border: '1px solid transparent',
}

const userInfoStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const emailStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-mid)',
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

/**
 * 인증 UI 컴포넌트 — 4-상태 렌더.
 *
 * - 'disabled': null (Supabase 미설정 → 전혀 렌더되지 않음)
 * - 'loading' : 세션 복원 중 표시
 * - 'signedOut': Google / GitHub 로그인 버튼
 * - 'signedIn' : 유저 이메일 + 로그아웃 버튼
 *
 * 마운트 시 init()으로 Supabase 세션 복원 + 구독 시작.
 * 언마운트 시 자동 정리(구독 해제).
 */
export function AuthButton() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const signIn = useAuthStore((s) => s.signIn)
  const signOut = useAuthStore((s) => s.signOut)

  // hooks는 early return 전에 배치해야 함 (React hooks 규칙)
  useEffect(() => {
    // init()은 세션 복원 + onAuthStateChange 구독을 시작하고 정리 함수를 반환
    // disabled 모드 시 init()은 즉시 no-op 정리 함수를 반환 (supabase=null)
    return useAuthStore.getState().init()
  }, [])

  // ── 4-상태 렌더 ──────────────────────────────────────────────

  if (status === 'disabled') {
    // Supabase 미설정 → 렌더 없음. 기존 앱 100% 정상 동작.
    return null
  }

  if (status === 'loading') {
    return (
      <span
        data-testid="auth-loading"
        style={{ fontSize: 11, color: 'var(--text-lo)', padding: '0 6px' }}
      >
        ···
      </span>
    )
  }

  if (status === 'signedOut') {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          data-testid="signin-google"
          onClick={() => void signIn('google')}
          style={signInBtn}
          title="Google로 로그인"
        >
          Google
        </button>
        <button
          data-testid="signin-github"
          onClick={() => void signIn('github')}
          style={btnBase}
          title="GitHub로 로그인"
        >
          GitHub
        </button>
      </div>
    )
  }

  // signedIn
  return (
    <div data-testid="auth-user-info" style={userInfoStyle}>
      <span style={emailStyle} title={user?.email ?? undefined}>
        {user?.email ?? '—'}
      </span>
      <button
        data-testid="signout-btn"
        onClick={() => void signOut()}
        style={btnBase}
        title="로그아웃"
      >
        로그아웃
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 스모크 통과 확인**

```bash
pnpm --filter @sculptone/web test -- AuthButton.test
```

Expected: **6개** PASS.

- [ ] **Step 5: AppShell 회귀 베이스라인 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell
```

Expected: 기존 테스트 모두 PASS (회귀 없음 확인).

- [ ] **Step 6: AppShell.tsx 수정**

`apps/web/src/shell/AppShell.tsx` 두 곳 수정:

**6a) import 추가** — 기존 import 블록 끝에:
```ts
import { AuthButton } from '../cloud/AuthButton'
```

**6b) 툴바 마운트** — 기존 툴바 div 내 `<MidiDeviceSelect ... />` 바로 뒤, `<button aria-label="단축키 도움말" ...>` 바로 앞에 `<AuthButton />` 삽입:

기존:
```tsx
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />

        {/* 단축키 도움말 버튼 (?) */}
        <button
```

변경:
```tsx
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />

        {/* 클라우드 인증 — Supabase 미설정 시 null 렌더 */}
        <AuthButton />

        {/* 단축키 도움말 버튼 (?) */}
        <button
```

**변경 범위 최소화**: 두 줄만 추가(import + JSX). 기존 툴바 레이아웃 불변.

- [ ] **Step 7: AppShell 회귀 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell
```

Expected: 기존 테스트 모두 PASS. (`<AuthButton />`은 테스트 환경에서 supabase=null → null 렌더이므로 기존 단언 영향 없음)

---

## Task 5: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 cloud/ 테스트 확인**

```bash
pnpm --filter @sculptone/web test -- cloud
```

Expected:
- `supabase.test.ts`: **6개** PASS
- `authStore.test.ts`: **12개** PASS
- `authStore.disabled.test.ts`: **3개** PASS
- `AuthButton.test.tsx`: **6개** PASS
- 합계: **27개** 신규 PASS

- [ ] **Step 2: 전체 @sculptone/web 테스트 (기존 회귀 확인)**

```bash
pnpm --filter @sculptone/web test
```

Expected:
- 신규 +27개 PASS
- 기존 테스트 전부 PASS — 회귀 0

**예상 회귀 분석**:

| 기존 테스트 | AuthButton/authStore 영향 | 판정 |
|---|---|---|
| `AppShell.test.tsx` | `<AuthButton />` 삽입됨. 그러나 supabase=null → null 렌더 → DOM 변화 없음 | PASS |
| `AppShell.compose.test.tsx` | 동일 — null 렌더 | PASS |
| `store.test.ts` | state/store.ts 불변 | PASS |
| `Button.test.tsx` | ui/Button.tsx 불변 | PASS |
| `PianoRoll.*.test.tsx` | compose/ 불변 | PASS |
| `useAudio.test.ts` | audio/ 불변 | PASS |
| `storage.test.ts`, `files.test.ts` | io/ 불변 | PASS |

- [ ] **Step 3: 전체 모노레포 테스트**

```bash
pnpm -r test
```

Expected:

| 패키지 | 신규 | 기존 |
|---|---|---|
| `@sculptone/score-model` | 0 | 유지 |
| `@sculptone/sound-engine` | 0 | 유지 |
| `@sculptone/web` | +27 | 전부 유지 |

- [ ] **Step 4: 커버리지 게이트 확인**

```bash
pnpm --filter @sculptone/web coverage
```

Expected: `functions` 커버리지 **≥ 82%** 유지.

신규 코드 커버리지 분석:
- `supabase.ts`: `isCloudConfigured` 함수 100% (true/false 분기 모두 테스트)
- `authStore.ts`: `init`, `signIn`, `signOut`, `toAuthUser` 모두 테스트. disabled/configured 양 경로 커버
- `AuthButton.tsx`: 4-상태 렌더 함수 100%, useEffect 포함

- [ ] **Step 5: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 에러 없음. 특히:
- `supabase: SupabaseClient | null` — null 안전 (non-null assertion `!` 미사용)
- `AuthUser` 타입 — `authStore.ts` 정의와 `AuthButton.tsx` 사용 일치
- `useAuthStore` selector: `(s) => s.signIn` — `(provider: 'google' | 'github') => Promise<void>` 타입 일치
- `useEffect` return: `() => void` — `init()`의 반환 타입과 일치
- React named import: `import { type CSSProperties, useEffect } from 'react'` — 네임스페이스 미사용

- [ ] **Step 6: lint + format**

```bash
pnpm --filter @sculptone/web exec eslint src/cloud --max-warnings 0
```

Expected: 에러 0, 경고 0.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과. 기존 테스트 회귀 0.
- `supabase.ts`:
  - `url && key` 분기로 createClient/null 결정. import 시 크래시 없음.
  - `isCloudConfigured()` → boolean 일치.
  - env var 4-분기(URL없/key없/둘다없/둘다있) 모두 테스트.
- `authStore.ts`:
  - 4-상태(`disabled/loading/signedOut/signedIn`) 전이 모두 테스트.
  - `init()` getSession + onAuthStateChange + unsubscribe 정리 검증.
  - `signIn/signOut` 성공·실패·no-op(disabled) 경로 검증.
  - `error` 초기화 검증.
- `AuthButton.tsx`:
  - 4-상태 렌더 스모크 통과.
  - disabled → null 렌더.
  - signIn('google')·signIn('github')·signOut() 클릭 핸들러 검증.
  - `useEffect(() => init(), [])` 패턴 (hooks-before-early-return 준수).
- `AppShell.tsx`: `<AuthButton />` 마운트, 기존 회귀 없음.
- `pnpm --filter @sculptone/web coverage` functions ≥ 82%.
- `tsc --noEmit` 에러 없음.
- React 타입 네임스페이스 미사용, 인라인 스타일 + CSS 변수 사용.
- 인프라/CI 파일 수정 없음.
- `.env.example` 커밋됨, `.env.local` 커밋 안 됨(`.gitignore` 확인).

---

## 사용자 필수 액션 (코드 배포 전 완료 필요)

코드 자체는 테스트/타입체크/빌드 모두 Supabase 없이 통과한다. 실제 소셜 로그인을 사용하려면:

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. Dashboard → Authentication → Providers → **Google** 활성화
   - Google Cloud Console에서 OAuth 2.0 Client ID 발급 필요
3. Dashboard → Authentication → Providers → **GitHub** 활성화
   - GitHub → Settings → Developer settings → OAuth Apps에서 발급 필요
4. Dashboard → Project Settings → API 에서 `Project URL` + `anon public` 키 복사
5. `apps/web/.env.local` 생성 (`.gitignore`에 포함됨):
   ```
   VITE_SUPABASE_URL=https://<your-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```

---

## 다음 증분

- **Sub-project B**: 클라우드 프로젝트 동기화 — 로그인 사용자의 프로젝트를 Supabase Storage/DB에 업로드·다운로드. RLS 정책 설계.
- **Sub-project C**: 프로젝트 공유 — 공개 읽기 링크, 포크.
- **오프라인 → 온라인 전환**: 앱이 offline→online 감지 시 로컬 변경사항을 클라우드에 동기화.
- **세션 만료 처리**: onAuthStateChange의 `TOKEN_REFRESHED`/`SIGNED_OUT` 이벤트 세분화.
- **아바타 이미지**: `avatarUrl` 이 있으면 `<img>` 렌더, 없으면 이메일 이니셜 fallback.

---

## 열린 질문

1. **`vi.stubEnv` vs `vi.mock('vite', ...)` 방식**: Vitest 2.x에서 `vi.stubEnv`는 `import.meta.env`를 직접 패치한다. 이 프로젝트의 기존 테스트에서 이 패턴을 쓰지 않으므로, 구현 시 동작 확인 후 문제 발생 시 `vi.mock` 방식으로 대체한다.

2. **`window.location.origin` in jsdom**: jsdom에서 `window.location.origin`은 `'http://localhost'`로 기본 설정된다. `signInWithOAuth` 테스트에서 `redirectTo: 'http://localhost'`를 검증. 실제 환경에서는 배포 URL이 들어간다.

3. **supabase-js 번들 크기**: `@supabase/supabase-js` 는 tree-shaking을 지원한다. Vite 빌드에서 `auth` 모듈만 사용하면 번들이 최적화된다. 빌드 완료 후 chunk 크기 확인 권장.

4. **OAuth redirect URL 도메인 허용**: Supabase 대시보드 → Authentication → URL Configuration 에서 `localhost:5173` (개발)과 프로덕션 도메인을 `Redirect URLs`에 추가해야 실제 OAuth가 동작한다. `.env.example`에 이 안내를 추가하는 것을 권장.

5. **AuthButton 스타일 확장**: 현재 구현은 텍스트 버튼이다. 실제 아바타 이미지(`avatarUrl`) 표시, Google/GitHub 로고 아이콘 추가 등은 디자인 피드백 후 적용한다.
