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
    isContentEditable?: boolean
  } = {},
): KeyboardEvent {
  const tagName = opts.targetTag ?? 'BODY'
  const contentEditable = opts.contentEditable ?? 'inherit'
  return {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    target: {
      tagName,
      contentEditable,
      // isContentEditable은 DOM 불리언 프로퍼티 — contentEditable='true' 또는 상속으로 true가 됨
      isContentEditable: opts.isContentEditable ?? contentEditable === 'true',
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

  // Fix #2: isContentEditable 불리언 가드 — 부모 상속 케이스
  // contentEditable 속성은 'inherit'이지만 isContentEditable=true(부모 contenteditable 상속)
  it('isContentEditable=true(부모 상속 contenteditable) 요소에서 Space는 null을 반환한다', () => {
    expect(matchShortcut(ev(' ', { targetTag: 'SPAN', isContentEditable: true }))).toBeNull()
  })
})

// ── Q → 'quantize' ───────────────────────────────────────────

describe("Q → 'quantize'", () => {
  it('소문자 q는 quantize를 반환한다', () => {
    expect(matchShortcut(ev('q'))).toBe('quantize')
  })

  it('대문자 Q(CapsLock, shiftKey=false)는 quantize를 반환한다', () => {
    expect(matchShortcut(ev('Q', { shiftKey: false }))).toBe('quantize')
  })

  it('Shift+Q(shiftKey=true)는 null을 반환한다', () => {
    expect(matchShortcut(ev('Q', { shiftKey: true }))).toBeNull()
  })

  it('Ctrl+Q는 null을 반환한다 (수식어 가드)', () => {
    expect(matchShortcut(ev('q', { ctrlKey: true }))).toBeNull()
  })

  it('INPUT 포커스 시 q는 null을 반환한다 (타깃 가드)', () => {
    expect(matchShortcut(ev('q', { targetTag: 'INPUT' }))).toBeNull()
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
