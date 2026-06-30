# Sculptone 키보드 단축키 + 도움말 오버레이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 전역 단축키(Space 재생/정지, R 녹음, M 메트로놈, ? 도움말)와 단축키 도움말 오버레이를 구현한다. 사용자가 어느 패널에 포커스가 있더라도 단일 키 조작으로 Transport를 제어하고 도움말을 열 수 있으며, 입력 필드(INPUT/TEXTAREA/SELECT/contentEditable)에서 타이핑할 때는 단축키가 발동하지 않는다. 기존 Ctrl/Cmd+Z/Y(undo/redo) 동작을 완전히 보존한다.

**Architecture:** 단축키 매칭 로직을 순수 함수(`matchShortcut`)로 분리해 완전 TDD로 검증한다. `matchShortcut(e) → 'play' | 'record' | 'metronome' | 'help' | null` 은 수식어 키·대소문자·타깃 태그를 판정하며 jsdom에서 직접 단위 테스트한다. `AppShell.tsx`의 기존 `window` keydown 핸들러를 확장해 `matchShortcut` 결과에 따라 store 액션/useAudio를 호출하고, `Space`의 기본 스크롤을 `e.preventDefault()`로 차단한다. `ShortcutsHelp.tsx`는 `showShortcuts` store 상태로 조건부 렌더하는 role="dialog" 오버레이이며 Esc·배경 클릭·닫기 버튼으로 닫힌다. store에 `showShortcuts: boolean` + `setShowShortcuts` + `toggleShortcuts` 액션을 추가한다.

**Tech Stack:** React + TS · Zustand · Vitest(jsdom) · @testing-library/react

> **커밋 규칙(이 프로젝트):** 자율 루프 운영 — 구현이 리뷰를 통과하면 컨트롤러(메인 세션)가 커밋·푸시한다. 구현 서브에이전트는 커밋하지 않는다.

> **참조:** `apps/web/src/shell/AppShell.tsx`(기존 keydown 패턴), `apps/web/src/state/store.ts`(isPlaying/isRecording/metronomeEnabled), `apps/web/src/test/AppShell.test.tsx`(기존 테스트 패턴), `docs/superpowers/plans/2026-06-29-sculptone-undo-redo.md`(전역 keydown 가드 패턴).

---

## 비목표 (이 계획에서 하지 말 것)

- 사용자 정의 키매핑/리바인딩 및 단축키 설정 영속화
- 추가 편집 단축키(복사/붙여넣기/선택 등) — 별도 증분
- 트랜스포트 외 도구 단축키(예: 마커 이동, 줌 등)
- 접근성 포커스 트랩 정밀화(기본 Esc/배경닫기만)
- 협업/백엔드
- 인프라 파일 변경(`.github/`, 루트 설정, eslint/prettier config)

---

## 설계 근거

### matchShortcut 순수 함수 분리

단축키 매칭 조건이 복잡하다(수식어 키·대소문자·4종 타깃 태그 가드). 이 로직을 순수 함수로 분리하면 jsdom에서 `new KeyboardEvent` 없이 객체 캐스팅으로 빠르게 단위 테스트할 수 있고, AppShell에서는 결과값에 따른 분기만 담당한다. 사이드 이펙트(preventDefault, store 액션)는 AppShell 핸들러가 담당한다.

### 입력 필드 가드 — 4종 확장

기존 가드는 INPUT·TEXTAREA만 차단했다. SELECT(드롭다운)와 `contentEditable="true"` 요소에서도 Space·R·M이 발동하면 타이핑이 방해된다. `matchShortcut` 내부에서 네 가지를 모두 차단하며, AppShell의 기존 undo/redo 경로도 동일 가드로 통일한다.

### 수식어 키 가드

단일 키 단축키(Space/R/M/?)에서 `e.ctrlKey || e.metaKey || e.altKey`가 true이면 null을 반환한다. 브라우저 기본 단축키(Ctrl+Space = 입력 전환, Cmd+M = 창 최소화 등) 충돌 방지. `?`는 Shift+/ 조합이므로 shiftKey=true지만, Ctrl/Cmd/Alt는 없어야 한다.

### R·M의 !shiftKey 가드

`e.key.toLowerCase() === 'r'`만 확인하면 Shift+R(대문자 R 입력)도 매칭된다. `!e.shiftKey`를 추가해 Shift+R·Shift+M은 null을 반환하도록 한다. CapsLock 켜진 상태에서 R 입력 시 key='R', shiftKey=false이므로 정상 매칭된다.

### Space preventDefault

Space 키는 페이지 스크롤의 기본 동작을 발동한다. `action === 'play'` 분기에서 AppShell이 `e.preventDefault()`를 호출해 스크롤을 방지한다. matchShortcut 내부에서는 호출하지 않는다(순수 함수 유지).

### store.showShortcuts 상태 설계

`showShortcuts: boolean`을 store에 추가한다. `setShowShortcuts(bool)`은 열기/닫기 명령에 사용하고, `toggleShortcuts()`는 ? 단축키에서 사용한다. `getInitialState()`/`setState(true)` 리셋 시 false로 초기화되어 테스트 격리가 보장된다.

### AppShell keydown 핸들러 확장 전략

기존 undo/redo 핸들러(`useEffect` + `window.addEventListener`)를 교체하지 않고 확장한다. 단계:
1. 가드를 `isInputLike`(INPUT·TEXTAREA·SELECT·contentEditable) 헬퍼로 통일
2. mod(Ctrl/Cmd) 분기로 기존 undo/redo 처리 — 변경 없음
3. `matchShortcut(e)` 호출로 단일 키 처리 (matchShortcut 내부에도 동일 가드 있으나 중복 무해)
4. 의존 배열에 `play`, `stop` 추가 (stable useCallback refs)

### useStore.getState() 패턴 (volatile 상태)

`isPlaying`, `isRecording`, `metronomeEnabled`, `showShortcuts`는 자주 변하는 값이다. 이들을 `useStore(selector)` 구독으로 컴포넌트에 받으면 Effect 의존 배열에 추가되어 keydown 핸들러가 매 상태 변화마다 재등록된다. 대신 핸들러 내부에서 `useStore.getState()`를 호출해 필요할 때만 최신값을 읽는다. 이 패턴은 기존 코드에서도 사용 중이다(`useRecording` 등).

### ShortcutsHelp 오버레이

- `role="dialog"` + `aria-modal="true"` + `aria-label="키보드 단축키"` — 접근성 기본
- 배경 클릭(backdrop): `onClick={() => setShowShortcuts(false)}` + 패널에서 `e.stopPropagation()`
- Esc 키: `useEffect`로 keydown 리스너 등록, `showShortcuts` 닫힘 시 리스너 해제
- 닫기 버튼: `aria-label="닫기"`
- 디자인 토큰: `--bg-base`(배경), `--bg-elevated`(패널), `--border`, `--r-lg`, `--shadow-2`, `--text-hi`, `--text-mid`, `--accent`(키 배지)

---

## File Structure

```
apps/web/src/
  shell/
    shortcuts.ts                  # NEW: matchShortcut 순수 함수
    ShortcutsHelp.tsx             # NEW: 도움말 오버레이 컴포넌트
    AppShell.tsx                  # MOD: keydown 확장, ShortcutsHelp 마운트, ? 버튼

  state/
    store.ts                      # MOD: showShortcuts + setShowShortcuts + toggleShortcuts

  test/
    shortcuts.test.ts             # NEW: matchShortcut 완전 TDD (16개)
    shortcuts-store.test.ts       # NEW: showShortcuts 스토어 TDD (5개)
    ShortcutsHelp.test.tsx        # NEW: 오버레이 스모크 (6개)
    AppShell.test.tsx             # MOD: Space/R/M/? 통합 스모크 추가 (+8개)
```

변경 없는 파일:
- `audio/TransportBar.tsx`, `audio/useAudio.ts`, `audio/playback.ts` — Transport 제어는 AppShell keydown이 직접 play/stop/store를 호출, TransportBar는 변경 없음
- `midi/useRecording.ts`, `compose/PianoRoll.tsx` 등 편집 컴포넌트 — shortcuts와 무관
- `.github/`, 루트 설정, eslint/prettier config — 비목표

---

## Task 1: shell/shortcuts.ts — matchShortcut 순수 함수 (완전 TDD)

**Files:** Create `apps/web/src/shell/shortcuts.ts`, `apps/web/src/test/shortcuts.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/shortcuts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { matchShortcut } from '../shell/shortcuts'

// ── 헬퍼 ─────────────────────────────────────────────────────

/**
 * matchShortcut용 가짜 KeyboardEvent 생성.
 * target은 기본적으로 BODY(포커스 없는 상태)를 시뮬레이트한다.
 */
function ev(
  key: string,
  opts: {
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    targetTag?: string
    contentEditable?: string
  } = {},
): KeyboardEvent {
  const tagName = opts.targetTag ?? 'BODY'
  return {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    target: {
      tagName,
      contentEditable: opts.contentEditable ?? 'inherit',
    },
  } as unknown as KeyboardEvent
}

// ── Space → 'play' ───────────────────────────────────────────

describe("Space → 'play'", () => {
  it('Space 키를 BODY에서 누르면 play를 반환한다', () => {
    expect(matchShortcut(ev(' '))).toBe('play')
  })

  it('Ctrl+Space는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev(' ', { ctrlKey: true }))).toBeNull()
  })

  it('Cmd+Space는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev(' ', { metaKey: true }))).toBeNull()
  })

  it('Alt+Space는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev(' ', { altKey: true }))).toBeNull()
  })
})

// ── R → 'record' ─────────────────────────────────────────────

describe("R → 'record'", () => {
  it('소문자 r은 record를 반환한다', () => {
    expect(matchShortcut(ev('r'))).toBe('record')
  })

  it('대문자 R(CapsLock, shiftKey=false)은 record를 반환한다', () => {
    // CapsLock 켜진 상태: key='R', shiftKey=false
    expect(matchShortcut(ev('R', { shiftKey: false }))).toBe('record')
  })

  it('Shift+R(shiftKey=true)은 null을 반환한다', () => {
    expect(matchShortcut(ev('R', { shiftKey: true }))).toBeNull()
  })

  it('Ctrl+r은 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev('r', { ctrlKey: true }))).toBeNull()
  })
})

// ── M → 'metronome' ──────────────────────────────────────────

describe("M → 'metronome'", () => {
  it('소문자 m은 metronome을 반환한다', () => {
    expect(matchShortcut(ev('m'))).toBe('metronome')
  })

  it('대문자 M(CapsLock, shiftKey=false)은 metronome을 반환한다', () => {
    expect(matchShortcut(ev('M', { shiftKey: false }))).toBe('metronome')
  })

  it('Shift+M(shiftKey=true)은 null을 반환한다', () => {
    expect(matchShortcut(ev('M', { shiftKey: true }))).toBeNull()
  })

  it('Cmd+m은 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev('m', { metaKey: true }))).toBeNull()
  })
})

// ── ? → 'help' ────────────────────────────────────────────────

describe("? → 'help'", () => {
  it('? 키(Shift+/, shiftKey=true)는 help를 반환한다', () => {
    // 미국 키보드: Shift+/ → key='?', shiftKey=true
    // ctrlKey/metaKey/altKey는 false이므로 수식어 가드 통과
    expect(matchShortcut(ev('?', { shiftKey: true }))).toBe('help')
  })

  it('Ctrl+?는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev('?', { shiftKey: true, ctrlKey: true }))).toBeNull()
  })
})

// ── 타깃 태그 가드 ────────────────────────────────────────────

describe('타깃 태그 가드 — Space 예시', () => {
  it('INPUT 포커스 시 Space는 null을 반환한다', () => {
    expect(matchShortcut(ev(' ', { targetTag: 'INPUT' }))).toBeNull()
  })

  it('TEXTAREA 포커스 시 Space는 null을 반환한다', () => {
    expect(matchShortcut(ev(' ', { targetTag: 'TEXTAREA' }))).toBeNull()
  })

  it('SELECT 포커스 시 Space는 null을 반환한다', () => {
    expect(matchShortcut(ev(' ', { targetTag: 'SELECT' }))).toBeNull()
  })

  it('contentEditable="true" 요소에서 Space는 null을 반환한다', () => {
    expect(matchShortcut(ev(' ', { targetTag: 'DIV', contentEditable: 'true' }))).toBeNull()
  })

  it('INPUT 포커스 시 r도 null을 반환한다', () => {
    expect(matchShortcut(ev('r', { targetTag: 'INPUT' }))).toBeNull()
  })
})

// ── 기타 ──────────────────────────────────────────────────────

describe('기타', () => {
  it('관련 없는 키(a)는 null을 반환한다', () => {
    expect(matchShortcut(ev('a'))).toBeNull()
  })

  it('Ctrl+Z는 수식어 가드로 null을 반환한다 (undo는 AppShell이 별도 처리)', () => {
    expect(matchShortcut(ev('z', { ctrlKey: true }))).toBeNull()
  })

  it('숫자 키(1)는 null을 반환한다', () => {
    expect(matchShortcut(ev('1'))).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts.test
```

Expected: FAIL — `'../shell/shortcuts'` 모듈 없음.

- [ ] **Step 3: shortcuts.ts 구현**

Create `apps/web/src/shell/shortcuts.ts`:
```ts
/**
 * 전역 단축키 매처 — 순수 함수.
 *
 * 반환값:
 *   'play'       — Space (재생/정지 토글)
 *   'record'     — R (수식어 없음, 대소문자 무관)
 *   'metronome'  — M (수식어 없음, 대소문자 무관)
 *   'help'       — ? (Shift+/)
 *   null         — 해당 없음 (수식어 키 있음 / 입력 필드 포커스 / 기타 키)
 *
 * 사이드 이펙트 없음. preventDefault는 호출부(AppShell)에서 담당한다.
 */
export type ShortcutAction = 'play' | 'record' | 'metronome' | 'help'

export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  // ── 타깃 가드: 입력 필드에서는 단축키를 발동하지 않는다 ──
  const target = e.target as HTMLElement
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.contentEditable === 'true'
  ) {
    return null
  }

  // ── 수식어 가드: Ctrl / Cmd / Alt가 눌렸으면 브라우저 단축키로 양보한다 ──
  // Shift 단독은 '?' 매칭을 위해 허용하되, 개별 키에서 추가로 검사한다.
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null
  }

  // ── 키 매칭 ────────────────────────────────────────────────
  if (e.key === ' ') return 'play'

  // R: !shiftKey 조건으로 Shift+R은 null. CapsLock 상태(key='R', shiftKey=false)는 허용.
  if (e.key.toLowerCase() === 'r' && !e.shiftKey) return 'record'

  // M: 동일 패턴
  if (e.key.toLowerCase() === 'm' && !e.shiftKey) return 'metronome'

  // ?: 미국 키보드에서 Shift+/ → key='?', shiftKey=true.
  // 위에서 ctrlKey/metaKey/altKey가 false임을 확인했으므로 shiftKey만 true인 상태.
  if (e.key === '?') return 'help'

  return null
}
```

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts.test
```

Expected: shortcuts.test.ts 16개 PASS. 기존 테스트 영향 없음.

---

## Task 2: state/store.ts — showShortcuts 추가 (완전 TDD)

**Files:** Modify `apps/web/src/state/store.ts`, Create `apps/web/src/test/shortcuts-store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/shortcuts-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../state/store'

describe('shortcuts store — showShortcuts', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('초기 showShortcuts는 false이다', () => {
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('setShowShortcuts(true) → showShortcuts=true', () => {
    useStore.getState().setShowShortcuts(true)
    expect(useStore.getState().showShortcuts).toBe(true)
  })

  it('setShowShortcuts(false) → showShortcuts=false', () => {
    useStore.getState().setShowShortcuts(true)
    useStore.getState().setShowShortcuts(false)
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('toggleShortcuts() — false에서 true로 전환된다', () => {
    expect(useStore.getState().showShortcuts).toBe(false)
    useStore.getState().toggleShortcuts()
    expect(useStore.getState().showShortcuts).toBe(true)
  })

  it('toggleShortcuts() — true에서 false로 전환된다', () => {
    useStore.getState().setShowShortcuts(true)
    useStore.getState().toggleShortcuts()
    expect(useStore.getState().showShortcuts).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts-store
```

Expected: FAIL — `showShortcuts`, `setShowShortcuts`, `toggleShortcuts`가 AppState에 없음.

- [ ] **Step 3: store.ts 수정**

`apps/web/src/state/store.ts`의 `AppState` 인터페이스에 추가 (기존 `setSoundPanelTrackId` 다음에):
```ts
  /** 단축키 도움말 오버레이 표시 여부. 기본 false. */
  showShortcuts: boolean
  setShowShortcuts: (show: boolean) => void
  toggleShortcuts: () => void
```

`create<AppState>(...)` 초기 상태 객체에 추가 (기존 `setSoundPanelTrackId` 구현 다음에):
```ts
  showShortcuts: false,
  setShowShortcuts: (show) => set({ showShortcuts: show }),
  toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
```

> **타입 노트:** `showShortcuts`는 playback/recording 상태와 완전히 독립적이다. `getInitialState()`/`setState(true)` 리셋 시 false로 초기화되므로 테스트 격리에 영향 없음.

> **기존 테스트 보존:** `AppState` 인터페이스에 선택적 필드가 아닌 필수 필드로 추가되지만, 기존 `create<AppState>(...)` 구현에 누락 없이 추가하므로 타입 오류가 발생하지 않는다. 기존 테스트는 `showShortcuts`를 단언하지 않으므로 영향 없음.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- shortcuts-store store editor-store
```

Expected:
- `shortcuts-store.test.ts` 5개 PASS
- `store.test.ts` 기존 PASS (단언 없는 필드 추가)
- `editor-store.test.ts` 기존 PASS

---

## Task 3: shell/ShortcutsHelp.tsx — 도움말 오버레이 (레퍼런스 구현 + 스모크)

**Files:** Create `apps/web/src/shell/ShortcutsHelp.tsx`, `apps/web/src/test/ShortcutsHelp.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/web/src/test/ShortcutsHelp.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsHelp } from '../shell/ShortcutsHelp'
import { useStore } from '../state/store'

describe('ShortcutsHelp', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('showShortcuts=false이면 dialog를 렌더하지 않는다', () => {
    render(<ShortcutsHelp />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('showShortcuts=true이면 role="dialog"를 렌더한다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('단축키 목록에 "재생 / 정지"가 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText(/재생 \/ 정지/)).toBeInTheDocument()
  })

  it('"Space" 키 레이블이 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText('Space')).toBeInTheDocument()
  })

  it('닫기 버튼 클릭 시 showShortcuts가 false로 변경된다', async () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('배경(backdrop) 클릭 시 showShortcuts가 false로 변경된다', async () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    // dialog 역할 요소 자체(배경 레이어)를 클릭
    fireEvent.click(screen.getByRole('dialog'))
    expect(useStore.getState().showShortcuts).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- ShortcutsHelp.test
```

Expected: FAIL — `'../shell/ShortcutsHelp'` 모듈 없음.

- [ ] **Step 3: ShortcutsHelp.tsx 레퍼런스 구현**

Create `apps/web/src/shell/ShortcutsHelp.tsx`:
```tsx
import { useEffect, type CSSProperties } from 'react'
import { useStore } from '../state/store'

// ── 단축키 목록 ────────────────────────────────────────────────

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Space', desc: '재생 / 정지' },
  { keys: 'R', desc: '녹음 Arm 토글' },
  { keys: 'M', desc: '메트로놈 토글' },
  { keys: 'Ctrl+Z / Cmd+Z', desc: '실행 취소' },
  { keys: 'Ctrl+Shift+Z / Cmd+Shift+Z', desc: '다시 실행' },
  { keys: 'Del / Backspace', desc: '노트 삭제 (Piano Roll)' },
  { keys: '?', desc: '이 도움말 열기 / 닫기' },
]

// ── 스타일 ─────────────────────────────────────────────────────

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)',
  boxShadow: 'var(--shadow-2)',
  width: 480,
  maxWidth: 'calc(100vw - 32px)',
  padding: '20px 24px 24px',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 16,
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text-hi)',
  letterSpacing: '-0.02em',
}

const closeBtnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  cursor: 'pointer',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const keysCellStyle: CSSProperties = {
  paddingBottom: 10,
  paddingRight: 16,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  width: 1, // shrink to content
}

const descCellStyle: CSSProperties = {
  paddingBottom: 10,
  color: 'var(--text-mid)',
  fontSize: 13,
  verticalAlign: 'middle',
}

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 7px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--bg-inset)',
  color: 'var(--text-hi)',
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 600,
  letterSpacing: '0.01em',
}

// ── 컴포넌트 ───────────────────────────────────────────────────

export function ShortcutsHelp() {
  const showShortcuts = useStore((s) => s.showShortcuts)
  const setShowShortcuts = useStore((s) => s.setShowShortcuts)

  // Esc 키로 닫기
  useEffect(() => {
    if (!showShortcuts) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowShortcuts(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showShortcuts, setShowShortcuts])

  if (!showShortcuts) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="키보드 단축키"
      style={backdropStyle}
      onClick={() => setShowShortcuts(false)}
    >
      {/* 패널 클릭 시 배경 닫기 이벤트 차단 */}
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>키보드 단축키</h2>
          <button
            aria-label="닫기"
            onClick={() => setShowShortcuts(false)}
            style={closeBtnStyle}
          >
            ✕
          </button>
        </div>
        <table style={tableStyle}>
          <tbody>
            {SHORTCUTS.map(({ keys, desc }) => (
              <tr key={keys}>
                <td style={keysCellStyle}>
                  <kbd style={kbdStyle}>{keys}</kbd>
                </td>
                <td style={descCellStyle}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

> **타입 노트:** `useEffect`, `type CSSProperties` 모두 `'react'`에서 named import. React 네임스페이스(`React.CSSProperties`) 사용 금지.

> **Esc 키 처리 전략:** `ShortcutsHelp` 내부 Effect에서 Esc를 처리한다. AppShell의 keydown 핸들러와 별도로 동작하며, `showShortcuts=false`이면 리스너가 등록되지 않아 오버헤드 없음. `?` 키로 닫을 때는 AppShell의 `toggleShortcuts()`가 처리한다.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- ShortcutsHelp.test
```

Expected: ShortcutsHelp.test.tsx 6개 PASS.

---

## Task 4: AppShell.tsx — keydown 확장 + ShortcutsHelp 마운트 (jsdom 통합 스모크)

**Files:** Modify `apps/web/src/shell/AppShell.tsx`, `apps/web/src/test/AppShell.test.tsx`

- [ ] **Step 1: AppShell.test.tsx에 useAudio 스파이 mock + 신규 테스트 추가**

**1a) 파일 최상단 mock 수정** — `vi.mock('../audio/useAudio', ...)` 를 spy 버전으로 교체:
```ts
// 기존:
// vi.mock('../audio/useAudio', () => ({
//   useAudio: () => ({ play: () => {}, stop: () => {}, getSeconds: () => 0 }),
// }))

// 교체 (vi.fn() spy로 — 기존 동작에 영향 없음, 기존 테스트는 play/stop 호출을 단언하지 않음):
const mockPlay = vi.fn()
const mockStop = vi.fn()
vi.mock('../audio/useAudio', () => ({
  useAudio: () => ({ play: mockPlay, stop: mockStop, getSeconds: () => 0 }),
}))
```

**1b) beforeEach에 spy 초기화 추가:**
```ts
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  mockPlay.mockClear()
  mockStop.mockClear()
})
```

**1c) 파일 끝 `describe('AppShell', ...)` 블록 안에 8개 테스트 추가:**
```tsx
  // ── Space / R / M / ? 단축키 ─────────────────────────────────

  it('Space 키: isPlaying=false → play()가 호출된다', () => {
    render(<AppShell />)
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(mockPlay).toHaveBeenCalledTimes(1)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('Space 키: isPlaying=true → stop()이 호출된다', () => {
    act(() => { useStore.getState().setPlaying(true) })
    render(<AppShell />)
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockPlay).not.toHaveBeenCalled()
  })

  it('R 키: isRecording 토글 — false → true', () => {
    render(<AppShell />)
    expect(useStore.getState().isRecording).toBe(false)
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(useStore.getState().isRecording).toBe(true)
  })

  it('R 키: isRecording 토글 — true → false', () => {
    act(() => { useStore.getState().setRecording(true) })
    render(<AppShell />)
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(useStore.getState().isRecording).toBe(false)
  })

  it('M 키: metronomeEnabled 토글 — false → true', () => {
    render(<AppShell />)
    expect(useStore.getState().metronomeEnabled).toBe(false)
    fireEvent.keyDown(document.body, { key: 'm' })
    expect(useStore.getState().metronomeEnabled).toBe(true)
  })

  it('? 키: showShortcuts 토글 — false → true', () => {
    render(<AppShell />)
    expect(useStore.getState().showShortcuts).toBe(false)
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    expect(useStore.getState().showShortcuts).toBe(true)
  })

  it('INPUT 포커스 시 Space는 play를 호출하지 않는다 (입력 필드 가드)', () => {
    render(<AppShell />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: ' ', bubbles: true })
    expect(mockPlay).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('Ctrl+Space는 play를 호출하지 않는다 (수식어 가드)', () => {
    render(<AppShell />)
    fireEvent.keyDown(document.body, { key: ' ', ctrlKey: true })
    expect(mockPlay).not.toHaveBeenCalled()
    expect(mockStop).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.test
```

Expected: 신규 8개 FAIL(Space/R/M/? 핸들러 없음). 기존 20개는 PASS.

- [ ] **Step 3: AppShell.tsx 레퍼런스 구현으로 갱신**

Replace `apps/web/src/shell/AppShell.tsx`:
```tsx
import { type CSSProperties, useEffect } from 'react'
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
import { MixerPanel } from '../play/MixerPanel'
import { useMidi } from '../midi/useMidi'
import { useRecording } from '../midi/useRecording'
import { MidiDeviceSelect } from '../midi/MidiDeviceSelect'
import { NotationView } from '../notation/NotationView'
import { SoundDesignPanel } from '../sound/SoundDesignPanel'
import { ShortcutsHelp } from './ShortcutsHelp'
import { matchShortcut } from './shortcuts'

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]
const region: CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)' }

const undoBtnBase: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  lineHeight: 1.4,
}
const undoBtnDisabled: CSSProperties = {
  ...undoBtnBase,
  opacity: 0.35,
  cursor: 'not-allowed',
}

const helpBtnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  width: 24,
  height: 24,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  lineHeight: 1,
}

export function AppShell() {
  useAutosave()

  const activeMode = useStore((s) => s.activeMode)
  const setMode = useStore((s) => s.setMode)
  const composeView = useStore((s) => s.composeView)
  const setComposeView = useStore((s) => s.setComposeView)
  const tempo = useStore((s) => s.project.transport.tempo)
  const timeSignature = useStore((s) => s.project.transport.timeSignature)
  const { play, stop, getSeconds } = useAudio()

  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.history.past.length > 0)
  const canRedo = useStore((s) => s.history.future.length > 0)

  const { handleMidiMessage } = useRecording()
  const { devices, selectedDeviceId, selectDevice, isSupported, accessError } =
    useMidi(handleMidiMessage)

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modLabel = isMac ? 'Cmd' : 'Ctrl'

  // 전역 키보드 단축키:
  //   Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y = redo (기존 보존)
  //   Space = 재생/정지, R = 녹음 토글, M = 메트로놈 토글, ? = 도움말 토글
  // 입력 필드(INPUT/TEXTAREA/SELECT/contentEditable) 포커스 시 무시.
  // Ctrl/Cmd/Alt 있는 조합은 matchShortcut이 null을 반환해 단일 키 단축키는 발동 안 함.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputLike =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.contentEditable === 'true'

      // ── Undo/Redo: Ctrl/Cmd 조합 (입력 필드에서도 무시) ──
      if (!isInputLike) {
        const mod = isMac ? e.metaKey : e.ctrlKey
        const k = e.key.toLowerCase()
        if (mod && !e.shiftKey && k === 'z') {
          e.preventDefault()
          undo()
        }
        if (mod && e.shiftKey && k === 'z') {
          e.preventDefault()
          redo()
        }
        if (!isMac && e.ctrlKey && !e.shiftKey && k === 'y') {
          e.preventDefault()
          redo()
        }
      }

      // ── 단일 키 단축키: matchShortcut이 가드와 매칭을 통합 처리 ──
      const action = matchShortcut(e)
      if (!action) return

      const {
        isPlaying,
        isRecording,
        setRecording,
        metronomeEnabled,
        setMetronomeEnabled,
        toggleShortcuts,
      } = useStore.getState()

      if (action === 'play') {
        e.preventDefault() // 페이지 스크롤 방지
        if (isPlaying) {
          stop()
        } else {
          play()
        }
      } else if (action === 'record') {
        setRecording(!isRecording)
      } else if (action === 'metronome') {
        setMetronomeEnabled(!metronomeEnabled)
      } else if (action === 'help') {
        toggleShortcuts()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, isMac, play, stop])

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr 64px', height: '100%' }}>
      {/* 툴바 */}
      <div style={{ ...region, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' }}>
        <strong style={{ letterSpacing: '-0.02em' }}>Sculptone</strong>
        <Tabs items={TABS} active={activeMode} onChange={(id) => setMode(id as Mode)} />

        {/* Undo / Redo 버튼 */}
        <button
          aria-label="실행 취소"
          disabled={!canUndo}
          onClick={undo}
          title={`Undo (${modLabel}+Z)`}
          style={canUndo ? undoBtnBase : undoBtnDisabled}
        >
          ↩
        </button>
        <button
          aria-label="다시 실행"
          disabled={!canRedo}
          onClick={redo}
          title={`Redo (${modLabel}+Shift+Z)`}
          style={canRedo ? undoBtnBase : undoBtnDisabled}
        >
          ↪
        </button>

        {activeMode === 'compose' && (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              aria-pressed={composeView === 'roll'}
              onClick={() => setComposeView('roll')}
              style={{
                font: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 'var(--r-sm) 0 0 var(--r-sm)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: composeView === 'roll' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'roll' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Roll
            </button>
            <button
              aria-pressed={composeView === 'score'}
              onClick={() => setComposeView('score')}
              style={{
                font: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: composeView === 'score' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: composeView === 'score' ? 'var(--on-accent)' : 'var(--text-mid)',
              }}
            >
              Score
            </button>
          </div>
        )}
        <FileMenu />
        <MidiDeviceSelect
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectDevice={selectDevice}
          isSupported={isSupported}
          accessError={accessError}
        />

        {/* 단축키 도움말 버튼 (?) */}
        <button
          aria-label="단축키 도움말"
          onClick={() => useStore.getState().toggleShortcuts()}
          title="키보드 단축키 (Shift+/)"
          style={helpBtnStyle}
        >
          ?
        </button>

        <span
          className="mono"
          style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontSize: 13 }}
        >
          {tempo} BPM · {timeSignature.join('/')}
        </span>
      </div>

      {/* 본문 */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', minHeight: 0 }}>
        <div style={{ ...region, overflowY: 'auto' }}>
          {activeMode === 'compose' && <TracksPanel />}
        </div>
        <div style={{ background: 'var(--bg-inset)', position: 'relative', overflow: 'auto' }}>
          {activeMode === 'compose' && composeView === 'roll' && (
            <div style={{ position: 'relative' }}>
              <PianoRoll />
              <Playhead getSeconds={getSeconds} />
            </div>
          )}
          {activeMode === 'compose' && composeView === 'score' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <NotationView />
            </div>
          )}
          {activeMode === 'play' && (
            <div style={{ overflowY: 'auto', height: '100%' }}>
              <MixerPanel />
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

      {/* 사운드 디자인 패널 (전역 오버레이 — soundPanelTrackId !== null 일 때 표시) */}
      <SoundDesignPanel />

      {/* 단축키 도움말 오버레이 */}
      <ShortcutsHelp />
    </div>
  )
}
```

> **핵심 설계 노트:**
>
> 1. `useStore.getState()` inside handler: `isPlaying`, `isRecording`, `metronomeEnabled`는 volatile state이므로 의존 배열에 넣지 않고 핸들러 내에서 읽는다. stable 함수 refs(`play`, `stop`, `undo`, `redo`)만 의존 배열에 포함.
>
> 2. 기존 undo/redo 경로 보존: `isInputLike` 가드가 INPUT·TEXTAREA·SELECT·contentEditable를 차단. `mod + k === 'z'` 분기는 변경 없음. 기존 테스트(`fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })`)는 그대로 통과.
>
> 3. `matchShortcut` 내부 가드와 `isInputLike` 중복: matchShortcut도 타깃 가드를 자체 포함하므로 이중 체크. 무해하며(null이면 early return), 두 경로(undo/redo vs 단일 키)의 가드 독립성을 유지한다.
>
> 4. `helpBtnStyle`: `onClick`에서 `useStore.getState().toggleShortcuts()`를 직접 호출. 컴포넌트 subscribe 없이 one-shot 이벤트 처리용.

- [ ] **Step 4: 통과 확인**

```bash
pnpm --filter @sculptone/web test -- AppShell.test AppShell.compose
```

Expected:
- `AppShell.test.tsx` 기존 20개 + 신규 8개 = **28개 PASS**
- `AppShell.compose.test.tsx` 기존 PASS (Roll/Score 버튼 등 기존 쿼리 충돌 없음 — `?` 버튼은 aria-label="단축키 도움말"로 구분)

---

## Task 5: 최종 게이트

**Files:** 없음 (확인만)

- [ ] **Step 1: 전체 테스트**

```bash
pnpm -r test
```

Expected 추가분:
| 파일 | 신규 테스트 수 |
|---|---|
| `shortcuts.test.ts` | 16 |
| `shortcuts-store.test.ts` | 5 |
| `ShortcutsHelp.test.tsx` | 6 |
| `AppShell.test.tsx` 추가 | 8 |
| **합계** | **35** |

> **기존 테스트 보존 체크리스트:**
> - `AppShell.test.tsx` 기존 20개: `mockPlay`/`mockStop`이 vi.fn()으로 바뀌었으나 기존 테스트는 이들을 단언하지 않음 → **PASS**
> - `AppShell.compose.test.tsx`: AppShell 수정(ShortcutsHelp 마운트, `?` 버튼 추가)은 기존 Roll/Score/PianoRoll 쿼리와 충돌 없음 → **PASS**
> - `store.test.ts` / `editor-store.test.ts`: `showShortcuts` 필드가 추가됐지만 기존 테스트는 이를 단언하지 않음 → **PASS**
> - `history-store.test.ts`: store.ts 수정(필드 추가)은 history 관련 동작에 영향 없음 → **PASS**
> - `useRecording.test.ts`, `useAudio.test.ts`, `playback.test.ts`: 수정 파일 없음 → **PASS**
> - `PianoRoll.test.tsx`, `TracksPanel.test.tsx`, `MixerPanel.test.tsx` 등 편집 패널 테스트: 수정 없음 → **PASS**
> - `shortcuts-store.test.ts` `beforeEach`: `getInitialState()`로 리셋 → `showShortcuts=false` 포함 → 테스트 간 격리 보장

- [ ] **Step 2: 타입체크**

```bash
pnpm --filter @sculptone/web exec tsc --noEmit
```

Expected: 타입 에러 없음. 특히:
- `AppState`에 `showShortcuts: boolean`, `setShowShortcuts`, `toggleShortcuts` 추가 — `create<AppState>()` 호출에서 모두 구현됨
- `ShortcutsHelp.tsx`: `type CSSProperties` named import, JSX 변환 자동 (`import React` 불필요)
- `matchShortcut`의 반환 타입 `ShortcutAction | null` — AppShell에서 `action === 'play'` 등 string literal 비교 OK
- `useStore.getState()` 내부 호출: keydown 핸들러 내부이므로 Rules of Hooks 위반 없음

- [ ] **Step 3: 프로덕션 빌드**

```bash
pnpm --filter @sculptone/web build
```

Expected: 빌드 성공. `shortcuts.ts`·`ShortcutsHelp.tsx` tree-shaking 포함.

---

## 완료 기준 (Definition of Done)

- `pnpm -r test` 전 패키지 통과(기존 테스트 전체 보존 + 신규 35개).
- `matchShortcut`: Space→'play', r/R→'record', m/M→'metronome', ?→'help', 수식어 키/입력 필드 가드 → null. 16개 단위 테스트 검증.
- `store.showShortcuts`: 초기 false, setShowShortcuts, toggleShortcuts. 5개 TDD 테스트 검증.
- `ShortcutsHelp`: showShortcuts=false이면 미렌더, true이면 role="dialog" 렌더, 닫기 버튼/배경 클릭 → showShortcuts=false. 6개 스모크 검증.
- AppShell keydown 확장: Space(isPlaying=false→play, true→stop), R(setRecording 토글), M(setMetronomeEnabled 토글), ?(toggleShortcuts). 8개 통합 스모크 검증.
- 가드: INPUT/TEXTAREA/SELECT/contentEditable 포커스 시 Space 무동작, Ctrl+Space 무동작. 테스트 검증.
- 기존 Ctrl/Cmd+Z(undo), Ctrl/Cmd+Shift+Z / Ctrl+Y(redo) 동작 보존. 기존 입력 필드 가드 테스트(input/textarea) PASS 유지.
- Space → `e.preventDefault()` 호출(스크롤 방지) — jsdom에서 직접 검증은 어렵지만 코드 리뷰로 확인.
- CSS 변수(`var(--bg-elevated)`, `var(--bg-inset)`, `var(--border)`, `var(--r-sm)`, `var(--r-lg)`, `var(--shadow-2)`, `var(--text-hi)`, `var(--text-mid)`, `var(--accent)`)만 사용.
- `type CSSProperties` 등 React 타입을 named import로 사용, `React.xxx` 네임스페이스 접근 없음.
- `tsc --noEmit` 에러 없음, 프로덕션 빌드 성공.

---

## 다음 계획 (이 계획 완료 후)

- **추가 편집 단축키 (P2 증분):** Ctrl+A(전체 선택), Ctrl+C/V(복사·붙여넣기), Arrow keys(노트 이동·크기 조절), PianoRoll 내 전용 단축키.
- **사용자 정의 키매핑 (P3, 사용자 확인 필요):** 단축키 리바인딩 UI, 영속화(localStorage). `matchShortcut` 함수가 config 테이블을 참조하도록 확장.
- **접근성 포커스 트랩 (P3):** ShortcutsHelp dialog 열릴 때 포커스를 패널 내부로 이동, Shift+Tab으로 순환. `@radix-ui/react-dialog` 또는 `focus-trap-react` 도입 고려.
- **단축키 시각 힌트 (P2):** TransportBar 재생/정지/녹음/메트로놈 버튼 tooltip에 단축키 표시 통일.

---

## 열린 질문

1. **Select 태그 가드의 실용성:** SELECT 포커스 시 Space는 옵션 선택에 사용된다. 현재 가드가 올바른 결정이다. 단, 현재 UI에 `<select>`가 많지 않으므로 실사용 영향 낮음.

2. **CapsLock 동작 일관성:** `key.toLowerCase() + !shiftKey` 패턴은 CapsLock ON에서도 단축키를 허용한다. 일부 사용자는 CapsLock 중 R을 입력하려 할 때 실수로 녹음이 토글될 수 있다. 현 구현으로 시작하고 사용자 피드백 후 조정.

3. **? 키 국제 키보드 호환성:** `key === '?'`는 US 키보드 기준. 일부 국제 키보드(한국어 자판 포함)에서 Shift+/가 ?를 생성하지 않을 수 있다. `matchShortcut` 교체 구현이나 사용자 정의 키매핑으로 해결 가능(다음 증분).

4. **재생 중 Space 토글 시 Transport 동작:** `play()`는 Transport를 처음부터 재생하고, `stop()`은 현재 위치에서 정지한다. Space로 정지 후 다시 Space → 처음부터 재생되는 DAW 표준 동작. 이를 "재생 헤드 위치에서 이어 재생"으로 바꿀지는 UX 논의 필요.

5. **`useStore.getState()` vs useCallback deps:** 현재 volatile state(isPlaying 등)를 `useStore.getState()`로 읽어 deps에서 제외했다. 이는 stale closure를 방지하는 표준 패턴이지만, ESLint `exhaustive-deps` 규칙이 경고할 수 있다. 해당 라인에 `// eslint-disable-next-line react-hooks/exhaustive-deps` 주석 추가를 검토.

6. **`?` 버튼 위치:** 현재 툴바 오른쪽 끝(BPM 텍스트 왼쪽)에 배치. 별도 위치(Undo/Redo 버튼 근처, 혹은 최우측 끝)로 조정을 원하면 JSX 순서만 변경. 기능에 영향 없음.
