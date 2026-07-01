# Sculptone — Cloud Auth Foundation (Sub-project A) 설계 문서

- 상태: Draft v1
- 작성일: 2026-07-01
- 범위: **백엔드 1단계 — Supabase 인증 기반 (Sub-project A)**
- 의존 스펙: `docs/superpowers/specs/2026-06-29-sculptone-creation-core-design.md`
- 태그라인: *소셜 로그인을 가산적으로 얹는다 — 미설정 시 앱은 100% 로컬.*

---

## 1. 목표

Supabase OAuth 소셜 로그인(Google + GitHub)을 Sculptone에 추가한다. 핵심 설계 원칙은 두 가지다:

1. **가산적(additive)**: 기존 local-first(IndexedDB) 구조를 건드리지 않는다. 클라우드 기능은 독립 레이어로 얹힌다.
2. **Graceful degradation**: Supabase 미설정 시 앱은 로컬 전용으로 완전 정상 동작한다. 인증 UI는 숨기고, 크래시나 기능 저하 없이.

이 서브프로젝트의 산출물:
- Supabase 클라이언트 싱글톤 (`supabase.ts`)
- 인증 상태 Zustand 스토어 (`authStore.ts`)
- 인증 UI 컴포넌트 (`AuthButton.tsx`)
- AppShell 상단바 마운트

---

## 2. 아키텍처 / 모듈 경계

```
apps/web/src/
  cloud/                          ← 신규 디렉토리 (Sub-project A)
    supabase.ts                   ← 싱글톤 클라이언트 + isCloudConfigured()
    authStore.ts                  ← Zustand 인증 스토어
    AuthButton.tsx                ← UI 컴포넌트 (4-상태 렌더)
    test/
      supabase.test.ts            ← 클라이언트 env 분기 TDD
      authStore.test.ts           ← 상태기계 TDD (supabase non-null 경로)
      authStore.disabled.test.ts  ← 상태기계 TDD (supabase null 경로)
      AuthButton.test.tsx         ← jsdom 스모크 (4-상태 렌더 + 클릭)
  shell/
    AppShell.tsx                  ← MODIFY: <AuthButton /> 마운트
```

**아키텍처 원칙**:
- `cloud/` 디렉토리는 완전히 격리된다. 기존 `state/store.ts`, `io/`, `compose/` 등을 수정하지 않는다.
- `supabase.ts`는 Vite 환경변수에 의존한다. 두 변수가 없으면 `null`을 반환하고 import 시점에 크래시를 일으키지 않는다.
- `authStore.ts`는 `supabase.ts`의 싱글톤을 읽는다. 외부에서 직접 supabase 클라이언트를 받지 않는다.
- `AuthButton.tsx`는 `authStore`를 구독하는 것 외에 별도 부작용이 없다. AppShell에서 마운트한다.

---

## 3. 컴포넌트 스펙

### 3.1 `supabase.ts` — 클라이언트 싱글톤

```
위치: apps/web/src/cloud/supabase.ts
```

**동작**:
- Vite 환경변수 `import.meta.env.VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 읽는다.
- **둘 다** truthy일 때만 `createClient(url, key)`를 호출한다.
- 하나라도 빠지면 `null`을 반환한다.
- 모듈 로드 시 크래시 없음 — `try/catch` 불필요(조건 분기로 충분).

**Export**:
- `supabase: SupabaseClient | null` — 싱글톤. 미설정 시 `null`.
- `isCloudConfigured(): boolean` — `supabase !== null`과 동치. AppShell/컴포넌트에서 feature flag로 사용.

**환경변수 소스**:
- 개발: `.env.local` (`.gitignore`에 포함 — 프로젝트 루트에 이미 있거나 추가)
- 가이드: `.env.example` (커밋, 두 변수 이름과 Supabase 대시보드 안내 포함)

### 3.2 `authStore.ts` — 인증 상태 기계

```
위치: apps/web/src/cloud/authStore.ts
```

**상태 타입**:
```
AuthStatus = 'disabled' | 'loading' | 'signedOut' | 'signedIn'
AuthUser   = { id: string; email: string | null; avatarUrl: string | null }
```

**스토어 상태**:
```
status  : AuthStatus    — 초기값: supabase ? 'loading' : 'disabled'
user    : AuthUser | null
error   : string | null — 마지막 작업 에러 메시지 (null = 없음)
```

**스토어 액션**:
```
init()           → () => void   // 세션 복원 + onAuthStateChange 구독. 반환값 = 정리 함수.
signIn(provider) → Promise<void> // provider: 'google' | 'github'
signOut()        → Promise<void>
```

**상태 전이**:

```
[disabled]  ──────────────────────────────────────────────  init()/signIn()/signOut() → no-op

[loading]   ──init()→getSession(null)──→ [signedOut]
            ──init()→getSession(user)──→ [signedIn]
            ──onAuthStateChange(null)──→ [signedOut]
            ──onAuthStateChange(user)──→ [signedIn]

[signedOut] ──signIn(provider)──→ (OAuth redirect) → (page reloads, onAuthStateChange fires)
            ──signIn error──────→ [signedOut] + error

[signedIn]  ──signOut()──→ [signedOut] + user=null
            ──signOut error──→ [signedIn] + error (로컬 세션은 이미 파기됐을 수 있음)
            ──onAuthStateChange(null)──→ [signedOut] + user=null
```

**init() 동작 세부**:
1. `supabase === null` → 즉시 no-op 정리 함수 반환.
2. `supabase.auth.getSession()` 호출 → 결과에 따라 `signedIn`/`signedOut` 설정.
3. `supabase.auth.onAuthStateChange(callback)` 구독 → callback은 `set({ status, user })` 수행.
4. 반환 함수: `subscription.unsubscribe()` 호출. useEffect return 값으로 직접 사용 가능.

**signIn() 동작 세부**:
1. `supabase === null` → return (no-op).
2. `error` 초기화, `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } })` 호출.
3. 오류 시: `status = 'signedOut'`, `error = e.message`.
4. OAuth 방식이므로 성공 시 페이지가 OAuth provider로 리다이렉트된다. 돌아왔을 때 `onAuthStateChange`가 `signedIn`으로 설정.

**signOut() 동작 세부**:
1. `supabase === null` → return (no-op).
2. `status = 'loading'` 설정.
3. `supabase.auth.signOut()` 호출.
4. 성공 시: `status = 'signedOut'`, `user = null`.
5. 오류 시: `status = 'signedIn'`(이전 상태 복구), `error = e.message`.

### 3.3 `AuthButton.tsx` — 인증 UI (4-상태 렌더)

```
위치: apps/web/src/cloud/AuthButton.tsx
```

**4-상태 렌더 스펙**:

| `status` | 렌더 |
|---|---|
| `'disabled'` | `null` (렌더 없음) |
| `'loading'` | 비활성 상태 표시 — 예: 불투명도 낮은 작은 점 3개 또는 skeleton |
| `'signedOut'` | Google / GitHub 로그인 버튼 (각 provider별) |
| `'signedIn'` | 유저 식별자(email 또는 아바타 이니셜) + 로그아웃 버튼 |

**인터랙션**:
- `signedOut` 상태: Google 버튼 클릭 → `signIn('google')`, GitHub 버튼 클릭 → `signIn('github')`.
- `signedIn` 상태: 로그아웃 버튼 클릭 → `signOut()`.

**디자인 지침**:
- 인라인 스타일 + CSS 변수 사용 (기존 Button.tsx 패턴 동일).
- 크기: 기존 툴바 버튼(`undoBtnBase`) 스케일과 조화.
- 디자인 토큰: `var(--bg-elevated)`, `var(--border)`, `var(--text-mid)`, `var(--accent)` 사용.
- `data-testid="auth-button-root"` — 테스트 선택자.

**`useEffect` 배치**:
- `AuthButton.tsx` 내 `useEffect(() => useAuthStore.getState().init(), [])` 로 구독 초기화.
- `status === 'disabled'` 조건부 early return 전에 hooks를 모두 호출해야 하므로 `useEffect`는 반환 전에 위치.

### 3.4 AppShell 마운트

`apps/web/src/shell/AppShell.tsx` 툴바 div에 `<AuthButton />` 추가.

**위치**: BPM/time-signature `span`(`marginLeft: 'auto'` 직전에) 오른쪽. 자세한 위치는 계획 참조.

---

## 4. 데이터 흐름

```
Supabase 서버
   ↕  OAuth redirect
브라우저(앱)
   │
   ├─ [앱 시작]
   │    AppShell 마운트 → AuthButton 마운트 → useEffect → init()
   │         ├─ getSession() → supabase.co API
   │         │      세션 있음: status='signedIn', user=AuthUser
   │         │      세션 없음: status='signedOut'
   │         └─ onAuthStateChange 구독 (이후 변경 감지)
   │
   ├─ [소셜 로그인]
   │    Google/GitHub 버튼 클릭 → signIn(provider)
   │         → signInWithOAuth({ redirectTo: window.location.origin })
   │         → 페이지 리다이렉트 → OAuth → 앱으로 복귀
   │         → onAuthStateChange fires → status='signedIn'
   │
   ├─ [로그아웃]
   │    로그아웃 클릭 → signOut()
   │         → supabase.auth.signOut()
   │         → status='signedOut', user=null
   │
   └─ [컴포넌트 언마운트]
        useEffect cleanup → subscription.unsubscribe()
```

---

## 5. 에러 처리

| 상황 | 처리 |
|---|---|
| `VITE_SUPABASE_URL` 또는 `VITE_SUPABASE_ANON_KEY` 미설정 | `supabase = null`, `status = 'disabled'`, 앱 정상 동작, UI 숨김 |
| `signIn` 중 OAuth 오류 | `status = 'signedOut'`, `error = 오류 메시지` |
| `signOut` 중 오류 | `status = 'signedIn'`(이전 상태), `error = 오류 메시지` |
| `getSession` 중 오류 | `status = 'signedOut'` (세션 없음으로 처리) |
| `onAuthStateChange` 중 오류 | Supabase SDK 내부 처리, 콜백 재호출 없음 |

**사용자 피드백**: `authStore.error` 필드를 `AuthButton.tsx`에서 읽어 인라인 에러 텍스트로 표시한다. 에러는 다음 성공적인 액션 시 `null`로 초기화된다.

---

## 6. 테스트 전략

**원칙**: 모든 스토어/순수 로직 완전 TDD, UI는 레퍼런스 구현 + jsdom 스모크.

### 6.1 `supabase.test.ts` — 환경변수 분기 TDD

**모킹 전략**:
- `vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ _mock: true })) }))` 최상단 (호이스팅).
- 각 테스트에서 `vi.resetModules()` + `vi.stubEnv(...)` + `await import('../supabase')` 동적 import 패턴.
- `afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })`.

**테스트 케이스 (~6개)**:
1. URL + key 둘 다 있음 → `supabase` non-null
2. URL 없음 → `supabase` null
3. key 없음 → `supabase` null
4. 둘 다 없음 → `supabase` null
5. `isCloudConfigured()` → true (non-null 시)
6. `isCloudConfigured()` → false (null 시)

### 6.2 `authStore.test.ts` — 상태기계 TDD (configured 경로)

**모킹 전략**:
- `vi.mock('../supabase', ...)` 최상단(호이스팅) → `supabase` 를 mock 클라이언트(non-null)로 설정.
- mock 클라이언트: `{ auth: { getSession, onAuthStateChange, signInWithOAuth, signOut } }` (vi.fn들).
- `beforeEach`: `vi.clearAllMocks()`, `useAuthStore.setState({ status: 'loading', user: null, error: null }, true)`.
- `onAuthStateChange` mock: `vi.fn(() => ({ data: { subscription: { unsubscribe: mockUnsubscribe } } }))`.

**테스트 케이스 (~12개)**:
1. supabase non-null 시 초기 `status = 'loading'`
2. `init()` → `getSession(null)` → `status = 'signedOut'`
3. `init()` → `getSession(session)` → `status = 'signedIn'`, `user` 설정
4. `init()` → `onAuthStateChange(null)` 콜백 → `status = 'signedOut'`
5. `init()` → `onAuthStateChange(session)` 콜백 → `status = 'signedIn'`
6. `init()` 반환 정리 함수 호출 → `mockUnsubscribe` 호출됨
7. `signIn('google')` → `signInWithOAuth` 호출 (provider='google', redirectTo=origin)
8. `signIn('github')` → `signInWithOAuth` 호출 (provider='github')
9. `signIn` 오류 → `status = 'signedOut'`, `error` 설정
10. `signOut()` 성공 → `status = 'signedOut'`, `user = null`
11. `signOut()` 오류 → `status = 'signedIn'`(복구), `error` 설정
12. 성공적인 액션 후 `error = null`로 초기화

### 6.3 `authStore.disabled.test.ts` — 미설정 경로

**모킹 전략**:
- `vi.mock('../supabase', () => ({ supabase: null, isCloudConfigured: () => false }))`.
- 별도 테스트 파일로 격리 (모듈 수준 mock 차이).

**테스트 케이스 (~3개)**:
1. supabase null 시 초기 `status = 'disabled'`
2. `init()` → 즉시 정리 함수 반환, `getSession`/`onAuthStateChange` 미호출
3. `signIn(...)` → 호출해도 `signInWithOAuth` 미호출

### 6.4 `AuthButton.test.tsx` — jsdom 스모크

**모킹 전략**:
- `vi.mock('../authStore', ...)` — useAuthStore를 제어된 mock으로 교체.
- 또는 `useAuthStore.setState({ status: ... })` 직접 설정 후 렌더.

**테스트 케이스 (~6개)**:
1. `status = 'disabled'` → null 렌더 (DOM에 없음)
2. `status = 'loading'` → 로딩 표시 렌더됨
3. `status = 'signedOut'` → Google/GitHub 버튼 렌더됨
4. `signedOut` 상태에서 Google 버튼 클릭 → `signIn('google')` 호출
5. `status = 'signedIn'` → 유저 정보 + 로그아웃 버튼 렌더됨
6. `signedIn` 상태에서 로그아웃 버튼 클릭 → `signOut()` 호출

---

## 7. 사용자 액션 의존

이 서브프로젝트는 **개발팀 외부 액션**에 의존한다:

1. **Supabase 프로젝트 생성**: [supabase.com](https://supabase.com) 대시보드에서 프로젝트 생성.
2. **OAuth provider 활성화**: Supabase 대시보드 → Authentication → Providers → Google, GitHub 활성화 + 각 provider의 Client ID/Secret 입력.
3. **환경변수 제공**: Supabase 대시보드 → Project Settings → API → `Project URL`, `anon public` key를 `.env.local`에 입력.

이 세 가지가 없으면 앱은 `status = 'disabled'` 모드(로컬 전용)로 동작한다. **코드는 Supabase mock으로 완전히 테스트 가능하다.**

---

## 8. 비목표 (이번 서브프로젝트에서 하지 않음)

- **Sub-project B**: 클라우드 프로젝트 동기화(업로드/다운로드/충돌 해결)
- **Sub-project C**: 프로젝트/패치 공유(공개 링크, 협업)
- **이메일/비밀번호 로그인** (OAuth 소셜 로그인만)
- **유저 프로파일 편집** (아바타 업로드, 표시명 변경)
- **Supabase Row Level Security(RLS)** 정책 설정 (B에서 처리)
- **Supabase Storage** 파일 저장 (B에서 처리)
- **Yjs 실시간 협업** (P3 장기 계획)
- **인프라/CI 설정 변경** (`allowedBuilds`, `.github/`, 루트 설정)
- **monoRepo 다른 패키지 변경** (`packages/score-model`, `packages/sound-engine`)

---

## 부록 — 결정 로그

- **Supabase 선택 이유**: Postgres + Auth + Storage + RLS를 하나의 관리형 서비스로 제공. 인증만 쓸 때도 추가 백엔드 없이 충분. Sub-project B/C에서 Storage + RLS로 자연 확장.
- **OAuth만 (이메일/비밀번호 제외)**: 사용자 비밀번호 관리 책임 제거. Google/GitHub는 개발자 도구 사용자층에 최적.
- **Graceful degradation 우선**: 기존 로컬 앱 사용자에게 "sign in to use" 강제 없음. 클라우드는 선택지.
- **가산적 `cloud/` 디렉토리**: 기존 `state/store.ts`에 auth 상태를 합치지 않음. auth 관심사 격리, Sub-project B/C에서 확장 용이.
- **init() → useEffect in AuthButton**: AppShell에서 `init()`을 직접 호출하는 대신 AuthButton이 자신의 생명주기를 관리. 컴포넌트 언마운트 시 자동 정리.
