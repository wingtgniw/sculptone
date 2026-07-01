import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock: supabase 싱글톤을 non-null mock 클라이언트로 교체 ──────────────────
// vi.mock 팩토리는 호이스팅되어 import보다 먼저 실행된다.
// 팩토리 내부에서 참조하는 변수도 호이스팅이 필요하므로 vi.hoisted()를 사용한다.

const {
  mockUnsubscribe,
  mockOnAuthStateChange,
  mockGetSession,
  mockSignInWithOAuth,
  mockSignOut,
  mockSupabase,
} = vi.hoisted(() => {
  const mockUnsubscribe = vi.fn()
  const mockOnAuthStateChange = vi.fn(
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

  const mockSupabase = {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithOAuth: mockSignInWithOAuth,
      signOut: mockSignOut,
    },
  }

  return {
    mockUnsubscribe,
    mockOnAuthStateChange,
    mockGetSession,
    mockSignInWithOAuth,
    mockSignOut,
    mockSupabase,
  }
})

vi.mock('../supabase', () => ({
  supabase: mockSupabase,
  isCloudConfigured: () => true,
}))

import { useAuthStore } from '../authStore'

// ── 테스트용 MockUser 타입 ────────────────────────────────────────────────────

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

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('authStore — configured path (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // getInitialState()로 전체 초기 상태(액션 포함)를 복원한다.
    // replace=true를 사용해 완전히 초기화한다.
    useAuthStore.setState(useAuthStore.getInitialState(), true)
    // getSession 기본값: 세션 없음
    mockGetSession.mockResolvedValue({ data: { session: null } })
    // signOut 기본값: 성공
    mockSignOut.mockResolvedValue({ error: null })
    // signInWithOAuth 기본값: 성공 (redirect)
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    // onAuthStateChange 구현 재설정 (vi.clearAllMocks() 이후 구현이 제거되므로 복원)
    mockOnAuthStateChange.mockImplementation(
      (_cb: (event: string, session: { user: MockUser } | null) => void) => ({
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      }),
    )
  })

  // ── 초기 상태 ───────────────────────────────────────────────

  it('supabase non-null → 초기 status가 loading이다', () => {
    // create() 호출 시점의 supabase가 truthy → status = 'loading'
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

  // ── Fix 2 회귀: getSession null 시 stale user 초기화 ────────────

  it('init() → getSession(null) → user = null (stale user 초기화)', async () => {
    // signedIn + stale user 상태로 시작
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'stale-id', email: 'stale@example.com', avatarUrl: null },
      error: null,
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).toBe('signedOut')
    })
    // Fix 2: signedOut 전환 시 user도 반드시 null이어야 한다
    expect(useAuthStore.getState().user).toBeNull()
    cleanup()
  })

  // ── Fix 3 회귀: getSession reject 시 loading 영구 고착 방지 ─────

  it('init() → getSession reject → status = signedOut (loading에 고착되지 않음)', async () => {
    mockGetSession.mockRejectedValue(new Error('navigator.locks failure'))
    const cleanup = useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).not.toBe('loading')
    })
    // Fix 3: reject 시 signedOut으로 회복, user = null
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().user).toBeNull()
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
    // signedIn 상태로 부분 업데이트 (액션 보존)
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
      error: null,
    })
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
    // 액션 보존을 위해 replace=true 없이 부분 업데이트
    useAuthStore.setState({ status: 'signedOut', user: null, error: null })
    await useAuthStore.getState().signIn('google')
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().error).toBe('OAuth failed')
  })

  // ── signOut ───────────────────────────────────────────────────

  it('signOut() 성공 → status = signedOut, user = null', async () => {
    // 액션 보존을 위해 replace 없이 부분 업데이트
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
      error: null,
    })
    mockSignOut.mockResolvedValue({ error: null })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('signOut() 오류 → status = signedIn(복구), error 설정', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
      error: null,
    })
    mockSignOut.mockResolvedValue({ error: new Error('Network error') })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().status).toBe('signedIn')
    expect(useAuthStore.getState().error).toBe('Network error')
  })

  // ── error 초기화 ──────────────────────────────────────────────

  it('signIn 성공 시(redirect) error = null로 초기화된다', async () => {
    // 이전 에러가 있는 상태에서 signIn 성공
    useAuthStore.setState({ status: 'signedOut', user: null, error: 'previous error' })
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    await useAuthStore.getState().signIn('google')
    expect(useAuthStore.getState().error).toBeNull()
  })

  it('signOut 성공 시 error = null로 초기화된다', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      user: { id: 'u1', email: 'a@b.com', avatarUrl: null },
      error: 'old error',
    })
    mockSignOut.mockResolvedValue({ error: null })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().error).toBeNull()
  })
})
