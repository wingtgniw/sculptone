# Sculptone — Cloud Share (Sub-project C) 설계 문서

- 상태: Draft v1
- 작성일: 2026-07-01
- 범위: **백엔드 3단계 — 프로젝트 공유 (Sub-project C)**
- 의존 스펙:
  - `docs/superpowers/specs/2026-07-01-sculptone-cloud-auth-foundation.md` (Sub-project A)
  - `docs/superpowers/specs/2026-07-01-sculptone-cloud-sync.md` (Sub-project B)
- 전제: Sub-project A(인증) + B(동기화) 완료.
  - `supabase.ts` (`supabase | null`, `isCloudConfigured()`)
  - `authStore.ts` (`useAuthStore`, `status`, `user`)
  - `projectsRepo.ts` (`upsertCloudProject` 등)
  - `supabase/migrations/0001_projects.sql` (projects 테이블 + RLS 소유자 정책)
- 태그라인: *소유자가 share_token 링크를 발급하면 누구나 해당 프로젝트를 읽기전용으로 열람할 수 있다.*

---

## 1. 목표

소유자가 프로젝트에 **공유 링크(share_token)** 를 발급하고, 해당 링크를 받은 누구나 **익명 읽기전용**으로 프로젝트를 열람할 수 있도록 한다. 핵심 원칙:

1. **읽기전용 공유만**: 수신자는 보고 들을 수 있으나 저장·편집·동기화는 일절 불가.
2. **보안 — Enumeration 방지**: anon 역할에 테이블 직접 SELECT 정책을 절대 추가하지 않는다. security-definer RPC 함수 `get_shared_project(p_token)`으로만 접근한다. 정확한 토큰 없이는 어떤 행도 노출되지 않는다.
3. **Graceful degradation**: Supabase 미설정 시 공유 UI를 숨기고 뷰어 진입을 무시한다. 로컬 앱 100% 정상.
4. **Local-first 보존**: 공유 뷰어는 클라우드에서만 로드하며 로컬 IndexedDB를 변경하지 않는다.

---

## 2. 비목표

이 서브프로젝트에서 구현하지 않는 것:

- **공개 목록**: 공유 프로젝트 전체 검색·탐색 UI
- **공유 만료**: 토큰 유효기간, 자동 만료
- **권한 레벨**: 댓글 허용, 트랙별 권한 등 세분화
- **실시간 협업**: Yjs/CRDT 기반 공동편집
- **비밀번호 보호**: 링크 + 비밀번호 조합 인증
- **공유 통계**: 열람 횟수 추적
- **인프라/CI 파일 변경**: `.github/`, 루트 설정, `allowedBuilds`
- **다른 패키지 변경**: `packages/score-model`, `packages/sound-engine`

---

## 3. 아키텍처 / 모듈 경계

```
apps/web/src/
  cloud/
    shareRepo.ts                   NEW: 공유 어댑터 (shareProject/unshareProject/fetchSharedProject)
    shareStore.ts                  NEW: Zustand 전역 공유 상태 { isReadOnly, shareLoadState, ... }
    test/
      shareRepo.test.ts            NEW: mock supabase TDD (~7개)
      shareRepo.null.test.ts       NEW: null-safe 경로 TDD (~3개)

  share/
    parseShareToken.ts             NEW: 순수 URL → token 파서
    useShareLoader.ts              NEW: 마운트 시 URL 감지 → 프로젝트 로드 훅
    ShareViewerShell.tsx           NEW: 읽기전용 뷰어 셸 (pianoRoll + transport)
    ShareLoadingScreen.tsx         NEW: 로딩 스크린
    ShareErrorScreen.tsx           NEW: 에러 스크린 (토큰 무효)
    test/
      parseShareToken.test.ts      NEW: 완전 TDD (~8개)
      useShareLoader.test.ts       NEW: TDD (~5개)
      ShareViewerShell.test.tsx    NEW: 스모크 (~2개)

  ui/
    ShareButton.tsx                NEW: Share/Unshare + URL 복사 UI
    test/
      ShareButton.test.tsx         NEW: 스모크 (~4개)

  App.tsx                          MOD: isReadOnly 분기 추가 (ShareViewerShell or AppShell)

supabase/migrations/
  0002_share.sql                   NEW: share_token 컬럼 + RPC 함수
```

**아키텍처 원칙**:
- `parseShareToken.ts`는 순수 함수. DOM/window 의존 없음.
- `shareRepo.ts`는 Supabase 어댑터. `supabase === null` 시 graceful no-op.
- `shareStore.ts`는 Zustand 전역 상태. 뷰어 진입 여부와 로드 상태를 보관.
- `useShareLoader.ts`는 React 훅. 마운트 시 1회 실행. window.location.href를 읽어 parseShareToken 호출.
- `App.tsx` 수정은 최소 침습: `isReadOnly` 플래그로 분기, `AppShell`은 변경 없음.
- `ShareViewerShell.tsx`는 독립 셸. useAutosave·useCloudSync·녹음·편집 훅을 마운트하지 않음.

---

## 4. DB 마이그레이션 스펙 (`supabase/migrations/0002_share.sql`)

### 4.1 share_token 컬럼 추가

```sql
alter table public.projects
  add column if not exists share_token text unique;
```

- `nullable`(기본 NULL): 공유 안 된 프로젝트
- `unique`: 동일 토큰으로 두 프로젝트 공유 불가 (충돌 시 upsert/update 실패 → 클라이언트 재시도 또는 에러)
- 기존 행은 모두 NULL → 공유 비활성 상태로 자연 마이그레이션

### 4.2 RPC 함수 `get_shared_project`

```sql
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

grant execute on function get_shared_project(text) to anon;
grant execute on function get_shared_project(text) to authenticated;
```

**security definer 선택 이유**: 함수 내부는 소유자 권한(postgres/service_role)으로 실행되므로 anon 역할의 RLS를 우회하지 않고도 정확한 토큰의 행 1개만 반환할 수 있다. 동시에 테이블 직접 SELECT는 여전히 기존 RLS가 막는다.

**enumeration 방지 설계**:
- anon 역할: `get_shared_project(p_token)` execute 권한 **만** 가짐
- 테이블 직접 SELECT 정책은 소유자 정책(auth.uid() = owner)만 존재 → anon은 어떤 행도 직접 읽을 수 없음
- `get_shared_project`는 정확한 토큰을 모르면 빈 결과 반환 → 브루트포스 외 열거 불가 (2^128 토큰 공간)

### 4.3 기존 UPDATE 정책 검토

기존 정책: `owner can update own projects`
```sql
using  (auth.uid() = owner)
with check (auth.uid() = owner)
```

소유자가 `share_token`을 변경하는 것도 이 정책으로 커버된다:
- `using (auth.uid() = owner)`: 본인 행에 대해서만 UPDATE 실행 가능
- `with check (auth.uid() = owner)`: 변경 후에도 owner = 자신 → owner 변경 불가
- `share_token` 컬럼 업데이트는 허용됨 (owner 변경이 아니므로 with check 통과)

**별도 RLS 정책 추가 불필요**: 기존 소유자 UPDATE 정책만으로 share_token SET/CLEAR 커버됨.

---

## 5. 공유 어댑터 스펙 (`apps/web/src/cloud/shareRepo.ts`)

### 5.1 타입

```typescript
// shareRepo.ts export
export interface SharedProjectRow {
  id: string
  owner: string
  title: string
  updated_at: string   // ISO 8601
  data: unknown        // jsonb
  share_token: string  // non-null: 이미 공유 중인 행만 반환됨
}
```

### 5.2 `shareProject(id: string): Promise<string>`

**동작**:
1. `supabase === null` → `throw new Error('Cloud not configured')` (소유자 전용, degradation 불필요)
2. `supabase.from('projects').select('share_token').eq('id', id)` → 기존 토큰 조회
3. 기존 `share_token` non-null → 기존 토큰 반환 (멱등성)
4. `share_token === null` → 새 토큰 생성 후 UPDATE

**토큰 생성 방식 — 클라이언트 생성**:
```typescript
function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  // 결과: 32자 hex (128비트 엔트로피, 추측 불가)
}
```

DB 기본값(`DEFAULT encode(gen_random_bytes(16), 'hex')`)이 아닌 클라이언트 생성 선택 이유:
- nullable 컬럼에 DB default는 INSERT 시에만 적용되며, NULL → non-NULL UPDATE 시에는 DB default를 강제할 방법이 없음
- 클라이언트 `crypto.getRandomValues()`는 CSPRNG로 충분히 안전
- supabase-js RPC 추가 없이 단순하게 구현 가능
- UNIQUE 제약으로 DB가 uniqueness를 보장

5. `supabase.from('projects').update({ share_token: token }).eq('id', id).eq('owner', user.id)` → 토큰 SET
6. 성공: 토큰 반환
7. 에러: console.error + rethrow

**멱등성**: 이미 공유 중이면 기존 토큰 반환. `shareProject`를 여러 번 호출해도 토큰이 바뀌지 않는다.

### 5.3 `unshareProject(id: string): Promise<void>`

**동작**:
1. `supabase === null` → no-op (graceful degradation)
2. `supabase.from('projects').update({ share_token: null }).eq('id', id).eq('owner', user.id)`
3. 에러: console.error + rethrow

**효과**: share_token을 NULL로 설정 → 기존에 발급된 링크는 `get_shared_project`가 빈 결과 반환 → 사실상 링크 무효화.

### 5.4 `fetchSharedProject(token: string): Promise<Project | null>`

**동작**:
1. `supabase === null` → `null` 반환 (graceful degradation)
2. `supabase.rpc('get_shared_project', { p_token: token })`
3. 에러 → `console.error` + `null` 반환 (에러를 외부로 전파하지 않음 — 뷰어 에러는 shareStore에서 관리)
4. 결과 없거나 빈 배열 → `null` 반환 (토큰 무효 또는 공유 해제됨)
5. 결과 있음: `deserializeProject(JSON.stringify(row.data))` → `Project` 반환

**미로그인/anon 동작**: supabase anon key를 사용하므로 `status === 'signedOut'`이어도 호출 가능. get_shared_project에 anon execute 권한이 있으므로 인증 불필요.

---

## 6. 전역 공유 상태 (`apps/web/src/cloud/shareStore.ts`)

```typescript
export type ShareLoadState = 'idle' | 'loading' | 'loaded' | 'error'

interface ShareState {
  isReadOnly: boolean          // URL에 share 토큰 있음 → true
  shareLoadState: ShareLoadState
  sharedProject: Project | null
  shareError: string | null
  setReadOnly: (v: boolean) => void
  setShareLoadState: (s: ShareLoadState) => void
  setSharedProject: (p: Project | null) => void
  setShareError: (msg: string | null) => void
}
```

**이 store를 별도로 분리하는 이유**:
- `store.ts`(AppState)는 편집 상태 전용 — readOnly를 AppState에 추가하면 기존 테스트 전체에 영향
- 공유 로드 상태(`shareLoadState`, `sharedProject`, `shareError`)는 앱 편집 상태와 무관
- `store.ts` 수정 제로: AppState 인터페이스, 기존 테스트 불변

---

## 7. URL 파서 스펙 (`apps/web/src/share/parseShareToken.ts`)

**URL 방식: `?share=<token>` 쿼리 파라미터**

해시 방식(`#/p/<token>`) 대신 쿼리 파라미터 방식 선택 이유:
- `window.location.search`로 파싱 단순
- 추후 서버 사이드 처리(OGP 메타, 리다이렉트) 가능성
- `new URL(href).searchParams.get('share')`로 표준 파싱

```typescript
/**
 * URL 문자열에서 ?share=<token> 파라미터를 추출한다.
 * 
 * 순수 함수: window.location에 직접 접근하지 않음.
 * 빈 문자열, 없는 파라미터, 잘못된 URL → null 반환.
 * 완전 TDD 대상.
 */
export function parseShareToken(url: string): string | null
```

**처리 규칙**:
- `new URL(url)`이 throw하면 → `null` (잘못된 URL)
- `searchParams.get('share')` 없으면 → `null`
- 빈 문자열이면 → `null`
- non-empty 값 → 반환 (토큰 형식 검증은 서버에서 담당)

---

## 8. 뷰어 진입 로직 (`apps/web/src/share/useShareLoader.ts`)

**마운트 시 1회 실행 흐름**:

```
앱 마운트 (App.tsx)
  → useShareLoader()
    → parseShareToken(window.location.href)
    → token 없음: no-op (isReadOnly=false, 기존 앱 경로)
    → token 있음:
        setShareLoadState('loading')
        await fetchSharedProject(token)
        → Project 반환: setSharedProject(project), setReadOnly(true), setShareLoadState('loaded')
        → null 반환: setShareLoadState('error'), setShareError('공유 링크가 유효하지 않습니다.')
        → 예외: setShareLoadState('error'), setShareError(err.message ?? '알 수 없는 오류')
```

**조기 반환 조건**: `isReadOnly`가 이미 true이거나 `shareLoadState !== 'idle'`이면 재실행하지 않는다 (React StrictMode 이중 효과 방어).

---

## 9. App.tsx 분기 (`apps/web/src/App.tsx`)

현재 `App.tsx`는 `<AppShell />`만 렌더한다. 다음과 같이 수정:

```tsx
export default function App() {
  useShareLoader()  // 마운트 시 URL 감지 + 프로젝트 로드
  
  const { isReadOnly, shareLoadState, shareError } = useShareStore()
  
  if (isReadOnly) {
    if (shareLoadState === 'loading') return <ShareLoadingScreen />
    if (shareLoadState === 'error')   return <ShareErrorScreen message={shareError} />
    // shareLoadState === 'loaded'
    return <ShareViewerShell />
  }
  
  return <AppShell />
}
```

**`AppShell`은 변경하지 않는다**: read-only 분기는 AppShell 진입 전에 처리된다.

---

## 10. 읽기전용 뷰어 셸 (`apps/web/src/share/ShareViewerShell.tsx`)

### 10.1 마운트 시 동작

1. `shareStore.sharedProject`에서 Project를 읽어 `store.replaceProject(sharedProject)`로 로드
2. 단 1회만 실행 (sharedProject 참조 안정성 유지)

### 10.2 렌더 구조

```
ShareViewerShell
├── 툴바: 프로젝트 제목 + "읽기전용 공유" 배지 + TransportBar(재생/정지만)
├── 본문: PianoRoll (읽기전용 래퍼)
│         └── div[style={{ pointerEvents: 'none', userSelect: 'none' }}]로 래핑
│             PianoRoll / VelocityLane (기존 컴포넌트 수정 없음)
│             Playhead (재생 헤드 표시)
└── (MixerPanel은 선택 포함)
```

### 10.3 read-only 차단 전략

**`pointer-events: none` 래퍼** 방식 선택 이유:
- PianoRoll, VelocityLane, LoopStrip 등 기존 컴포넌트에 `readOnly` prop 추가 불필요
- 기존 컴포넌트 테스트 불변
- 클릭/드래그 이벤트가 컴포넌트에 도달하지 않으므로 store 편집 액션이 호출되지 않음
- 스크롤 차단 우려: overflow scroll 가능하도록 `pointer-events: none`을 최외각 래퍼에만 적용하고 스크롤 컨테이너는 별도 처리 (또는 뷰어는 스크롤 없이 fit-content 표시)

**저장/동기화 차단**:
- `useAutosave()` 미마운트 → autosave 전혀 없음
- `useCloudSync()` 미마운트 → sync 전혀 없음
- `useRecording()` 미마운트 → 녹음 불가
- 키보드 단축키: `useEffect` 등록 최소화 — 재생/정지(Space)만 허용, 편집·녹음·Undo·Redo 단축키 미등록

**차단 완전성 체크리스트**:
| 경로 | 차단 방법 |
|---|---|
| autosave | `useAutosave` 미마운트 |
| cloud sync | `useCloudSync` 미마운트 |
| 노트 드래그/추가 | `pointer-events: none` 래퍼 |
| 키보드 편집 단축키 | 뷰어 셸에서 미등록 |
| Undo/Redo | 뷰어 툴바에 미포함 |
| 녹음 | `useRecording` 미마운트 |
| FileMenu | 뷰어 툴바에 미포함 |
| 속도/박자 변경 | TransportBar 내 편집 UI 미포함 |

---

## 11. 공유 UI (`apps/web/src/ui/ShareButton.tsx`)

### 11.1 위치

`AppShell.tsx` 툴바의 `<FileMenu />` 뒤, `<AuthButton />` 앞에 삽입.

### 11.2 표시 조건

- `isCloudConfigured() === true`
- `useAuthStore.status === 'signedIn'`
- 두 조건 모두 충족 시에만 렌더

### 11.3 상태 흐름

```
ShareButton(현재 project.id)
  ├── loading 상태: "Sharing..." 비활성 버튼
  ├── 공유 중(token !== null): "Shared ✓" 클릭 → 팝오버 표시
  │   팝오버: 공유 URL 텍스트 + 복사 버튼 + "Unshare" 버튼
  │   "Unshare" 클릭 → unshareProject(id) → token=null 상태로 전환
  └── 미공유(token === null): "Share" 버튼
      클릭 → shareProject(id) → token 반환 → URL 복사 → 팝오버 표시
```

**share URL 형식**: `${window.location.origin}?share=${token}`

**클립보드 복사**: `navigator.clipboard.writeText(url)` (테스트에서 vi.fn()으로 mock)

### 11.4 현재 프로젝트의 share_token 동기화

- 소유자가 AppShell에 있으므로 프로젝트 로드/스위치 시 share_token을 Supabase에서 조회해야 함
- 방식: ShareButton이 마운트될 때 또는 `project.id` 변경 시 `supabase.from('projects').select('share_token').eq('id', project.id)` 1회 조회
- local state로 `shareToken: string | null | 'loading'` 관리
- 조회 실패 → 'Share' 표시 유지 (에러 무시)

---

## 12. 에러 처리 / Graceful Degradation

| 상황 | 처리 |
|---|---|
| supabase 미설정 | `fetchSharedProject` → null / 공유 UI 숨김 / 뷰어 진입 시 shareLoadState='idle' 유지 → AppShell 렌더 |
| 토큰 무효(공유 해제 포함) | `fetchSharedProject` → null → shareStore error → ShareErrorScreen 표시 |
| RPC 네트워크 오류 | `fetchSharedProject` → null (console.error) → ShareErrorScreen |
| `shareProject` 실패 | ShareButton에서 에러 표시(로컬 state) |
| `unshareProject` 실패 | ShareButton에서 에러 표시 |
| clipboard 미지원 | `navigator.clipboard` undefined → 복사 버튼 비활성 + URL 텍스트만 표시 |

---

## 13. 데이터 흐름

```
[공유 뷰어 진입]
  브라우저: https://app.sculptone.com?share=<token>
    → App 마운트 → useShareLoader()
      → parseShareToken(window.location.href) = '<token>'
      → shareStore.setShareLoadState('loading')
      → fetchSharedProject('<token>')
        → supabase.rpc('get_shared_project', { p_token: '<token>' })
          → DB: get_shared_project 함수 실행 (security definer)
               select * from projects where share_token = '<token>'
          → Project row 반환
        → deserializeProject(row.data)
        → shareStore.setSharedProject(project), setReadOnly(true), setShareLoadState('loaded')
      → App.tsx: isReadOnly=true, shareLoadState='loaded' → <ShareViewerShell />
        → replaceProject(sharedProject) → useAudio 로드
        → PianoRoll (pointer-events: none) + TransportBar(재생/정지)

[공유 링크 발급]
  소유자가 AppShell에서 ShareButton 클릭
    → shareProject(project.id)
      → supabase select share_token (기존 토큰 조회)
      → null: generateShareToken() → crypto.getRandomValues(16 bytes) → 32자 hex
      → supabase update { share_token: token } where id AND owner=user.id
      → URL = origin + '?share=' + token
    → navigator.clipboard.writeText(URL)
    → 팝오버: URL 복사됨 + Unshare 버튼

[공유 해제]
  소유자가 Unshare 클릭
    → unshareProject(project.id)
      → supabase update { share_token: null } where id AND owner=user.id
    → 기존 링크로 접근 시 get_shared_project → 빈 결과 → ShareErrorScreen

[미설정 앱]
  isCloudConfigured() = false
    → useShareLoader: fetchSharedProject → null (supabase null guard)
    → shareLoadState remains 'idle', isReadOnly=false → AppShell 정상 렌더
    → ShareButton: 미렌더 (isCloudConfigured false)
```

---

## 14. 테스트 전략

**원칙**: 순수 함수 완전 TDD, 어댑터 mock TDD, 훅 TDD, UI/뷰어 스모크.

### 14.1 `parseShareToken.test.ts` — 완전 TDD (mock 없음)

순수 함수이므로 어떤 mock도 불필요.

**테스트 케이스 (~8개)**:
1. 유효한 토큰 파라미터 `?share=abc123` → `'abc123'` 반환
2. `share` 파라미터 없음 → `null`
3. `?share=` 빈 문자열 → `null`
4. 다른 파라미터만 있음 `?foo=bar` → `null`
5. 여러 파라미터 중 share 포함 `?foo=bar&share=tok` → `'tok'`
6. 잘못된 URL 문자열 → `null` (예외 삼킴)
7. URL에 hash가 있어도 share 파라미터 정상 추출 `?share=abc#section`
8. 빈 문자열 input → `null`

### 14.2 `shareRepo.test.ts` — mock supabase TDD

**모킹 전략**:
```typescript
// supabase 쿼리 빌더 + rpc mock
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockRpc = vi.fn()
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  update: mockUpdate,
}))
mockSelect.mockReturnValue({ eq: mockEq })    // .select().eq()
mockUpdate.mockReturnValue({ eq: mockEq })    // .update().eq().eq() 체인

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  isCloudConfigured: () => true,
}))
// authStore: useAuthStore.setState로 직접 제어
```

**테스트 케이스 (~7개)**:
1. `shareProject(id)` — 기존 토큰 있음 → 기존 토큰 반환 (update 미호출)
2. `shareProject(id)` — 토큰 없음 → update 호출, non-empty 토큰 반환
3. `shareProject(id)` — select 에러 → rethrow
4. `unshareProject(id)` → `update({ share_token: null })` + eq('id', id) 호출
5. `unshareProject(id)` — 에러 → rethrow
6. `fetchSharedProject(token)` → `rpc('get_shared_project', { p_token: token })` 호출, Project 반환
7. `fetchSharedProject(token)` — 빈 결과 → `null` 반환

**`shareRepo.null.test.ts` (~3개)**:
1. `fetchSharedProject(token)` — supabase null → `null` 반환 (no-op)
2. `unshareProject(id)` — supabase null → `undefined` 반환 (no-op)
3. `shareProject(id)` — supabase null → throw Error

### 14.3 `useShareLoader.test.ts` — TDD

**모킹 전략**:
```typescript
vi.mock('../cloud/shareRepo', () => ({ fetchSharedProject: mockFetchSharedProject }))
vi.mock('./parseShareToken', () => ({ parseShareToken: mockParseShareToken }))
// shareStore: setState로 직접 제어 + 상태 검증
```

**테스트 케이스 (~5개)**:
1. token 없음 → fetchSharedProject 미호출, shareStore 상태 변경 없음
2. token 있음, 프로젝트 반환 → setReadOnly(true), setShareLoadState('loaded'), setSharedProject(project)
3. token 있음, null 반환(무효) → setShareLoadState('error'), setShareError(non-null)
4. token 있음, 예외 throw → setShareLoadState('error'), setShareError(msg)
5. 이미 isReadOnly=true이면 재실행 안 함 (멱등성)

### 14.4 `ShareViewerShell.test.tsx` — 스모크

**테스트 케이스 (~2개)**:
1. shareStore에 sharedProject 설정 후 렌더 → "읽기전용" 배지 존재, FileMenu 없음
2. TransportBar의 재생 버튼 클릭 가능 (play 버튼 찾기)

### 14.5 `ShareButton.test.tsx` — 스모크

**모킹 전략**:
```typescript
vi.mock('../cloud/shareRepo', () => ({ shareProject: mockShare, unshareProject: mockUnshare }))
vi.mock('../cloud/supabase', () => ({ supabase: {}, isCloudConfigured: () => true }))
// clipboard: vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
// authStore: useAuthStore.setState({ status: 'signedIn', user: ... })
```

**테스트 케이스 (~4개)**:
1. isCloudConfigured=false → 렌더되지 않음
2. signedIn + 미공유 → "Share" 버튼 표시
3. "Share" 클릭 → shareProject 호출됨
4. signedIn + 공유중 → "Shared" 표시, "Unshare" 옵션 포함

---

## 15. 열린 질문

1. **뷰어에서 사운드 재생 가능 여부**: `useAudio` 훅이 ShareViewerShell에서도 동작해야 한다. Tone.js 싱글톤 인스턴스가 AppShell과 ShareViewerShell 사이에서 충돌하지 않는지 확인 필요. 앱에서 둘 중 하나만 렌더되므로 문제 없을 것으로 예상.

2. **MixerPanel 포함 여부**: ShareViewerShell에서 MixerPanel(Play 탭)을 함께 보여줄지, PianoRoll만 보여줄지. 사용성 측면에서 MixerPanel도 보여주는 것이 좋으나 범위를 넓힌다. 계획서에서는 기본적으로 PianoRoll만 포함하고 MixerPanel은 선택.

3. **share_token을 로컬에 캐시할지**: ShareButton이 프로젝트 로드 시마다 Supabase에서 share_token을 조회한다. Sub-project B의 sync가 이미 프로젝트 메타를 가져오므로, 향후 최적화로 sync 결과에 share_token을 포함할 수 있다. 이번에는 단순 단건 조회.

4. **공유 프로젝트가 동기화 업로드 대상이 되는지**: 소유자가 로그인 상태에서 share_token을 업데이트하면 Sub-project B의 `upsertCloudProject`가 share_token 컬럼을 알지 못한다. 현재 upsertCloudProject는 `id, owner, title, data, updated_at`만 upsert한다. share_token은 별도 UPDATE로 관리하므로 upsert가 share_token을 덮어쓸 수 없다 — 문제 없음(upsert가 share_token을 포함하지 않으므로).

5. **뷰어 URL 북마크 후 재접근**: 토큰이 유효하면 정상 열림. 소유자가 unshare 후 재접근 시 ShareErrorScreen 표시. 예상된 동작.

---

## 부록 — 결정 로그

- **anon SELECT 정책 추가 금지**: `share_token is not null` 조건의 anon SELECT 정책을 추가하면 `select * from projects where share_token is not null`로 모든 공유 프로젝트가 노출된다. security-definer RPC로 정확한 토큰 조회만 허용.
- **쿼리 파라미터 vs 해시**: `?share=<token>` 방식 선택. 해시는 서버 로그에 안 찍히나 SPA에서 차이 없음. 쿼리 파라미터가 `new URL(href).searchParams`로 표준 파싱 가능하여 단순.
- **클라이언트 토큰 생성**: DB default 대신 `crypto.getRandomValues()` 선택. nullable 컬럼의 NULL→non-NULL UPDATE에서 DB default를 자동 적용하는 방법이 없어 클라이언트 생성이 더 단순.
- **shareStore 분리**: AppState에 readOnly를 추가하면 기존 테스트 전체에 영향. 별도 Zustand store로 격리.
- **pointer-events:none 래퍼**: PianoRoll/VelocityLane에 readOnly prop 추가하는 대신 래퍼로 상호작용 차단. 기존 컴포넌트 불변. 침습 최소화.
- **App.tsx 분기**: AppShell을 전혀 건드리지 않고 App.tsx 레벨에서 viwer/editor 분기. AppShell의 훅(autosave, cloudSync, recording)이 뷰어에서 마운트되지 않으므로 저장/동기화 차단 완전.
