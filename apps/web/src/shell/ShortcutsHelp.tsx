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
          <button aria-label="닫기" onClick={() => setShowShortcuts(false)} style={closeBtnStyle}>
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
