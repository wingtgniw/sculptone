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
