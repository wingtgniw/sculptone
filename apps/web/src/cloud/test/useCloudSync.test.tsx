import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { useAuthStore } from '../authStore'
import { useCloudSync } from '../useCloudSync'

// vi.hoisted로 TDZ 우회 — vi.mock 팩토리보다 먼저 초기화
const { mockSyncNow } = vi.hoisted(() => ({
  mockSyncNow: vi.fn(),
}))

vi.mock('../sync', () => ({ syncNow: mockSyncNow }))
vi.mock('../supabase', () => ({ supabase: null, isCloudConfigured: () => false }))

describe('useCloudSync — 스모크', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncNow.mockResolvedValue(undefined)
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
  })

  it('status=loading → syncNow 미호출', () => {
    act(() => {
      useAuthStore.setState({ status: 'loading' }, true)
    })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).not.toHaveBeenCalled()
  })

  it('status=signedIn → syncNow 호출됨', () => {
    act(() => {
      useAuthStore.setState(
        { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } },
        true,
      )
    })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).toHaveBeenCalledOnce()
  })

  it('status=signedOut → syncNow 미호출', () => {
    act(() => {
      useAuthStore.setState({ status: 'signedOut', user: null }, true)
    })
    renderHook(() => useCloudSync())
    expect(mockSyncNow).not.toHaveBeenCalled()
  })
})
