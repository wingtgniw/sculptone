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
    target.isContentEditable
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
