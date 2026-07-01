import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { useAuthStore } from '../authStore'
import type { AuthUser } from '../authStore'

// authStore의 init이 Supabase API를 호출하지 않도록 mock
// supabase=null → authStore 초기 status='disabled', init()=no-op
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
    // getInitialState()로 전체 초기 상태(액션 포함)를 복원한다.
    // replace=true: 이전 테스트에서 주입된 mock signIn/signOut 등을 제거.
    // supabase=null mock 하에서 getInitialState()는 status='disabled'를 반환한다.
    useAuthStore.setState(useAuthStore.getInitialState(), true)
  })

  // ── disabled 상태 ─────────────────────────────────────────────

  it('status=disabled → null 렌더 (DOM에 없음)', () => {
    // beforeEach에서 이미 disabled로 초기화됨 (supabase=null)
    const { container } = render(<AuthButton />)
    expect(container.firstChild).toBeNull()
  })

  // ── loading 상태 ──────────────────────────────────────────────

  it('status=loading → 로딩 표시가 렌더된다', () => {
    act(() => {
      // partial update: 액션 함수는 beforeEach에서 복원된 상태 유지
      useAuthStore.setState({ status: 'loading' })
    })
    render(<AuthButton />)
    // data-testid="auth-loading"으로 로딩 인디케이터 식별
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument()
  })

  // ── signedOut 상태 ────────────────────────────────────────────

  it('status=signedOut → Google, GitHub 로그인 버튼이 렌더된다', () => {
    act(() => {
      useAuthStore.setState({ status: 'signedOut' })
    })
    render(<AuthButton />)
    expect(screen.getByTestId('signin-google')).toBeInTheDocument()
    expect(screen.getByTestId('signin-github')).toBeInTheDocument()
  })

  it('signedOut → Google 버튼 클릭 → signIn("google") 호출', async () => {
    const mockSignIn = vi.fn().mockResolvedValue(undefined)
    act(() => {
      // partial update: mock signIn 주입, 나머지 액션은 유지
      useAuthStore.setState({
        status: 'signedOut',
        signIn: mockSignIn,
      } as Parameters<typeof useAuthStore.setState>[0])
    })
    render(<AuthButton />)
    await userEvent.click(screen.getByTestId('signin-google'))
    expect(mockSignIn).toHaveBeenCalledWith('google')
  })

  // ── signedIn 상태 ─────────────────────────────────────────────

  it('status=signedIn → 유저 이메일과 로그아웃 버튼이 렌더된다', () => {
    act(() => {
      useAuthStore.setState({ status: 'signedIn', user: mockUser })
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
      // partial update: mock signOut 주입
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
