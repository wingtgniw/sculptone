import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { StrictMode } from 'react'
import { useShareStore } from '../../cloud/shareStore'

// ── Mock: parseShareToken — vi.hoisted로 TDZ 우회 ───────────────────────────
const { mockParseShareToken, mockFetchSharedProject, mockIsCloudConfigured } = vi.hoisted(() => {
  const mockParseShareToken = vi.fn<() => string | null>()
  const mockFetchSharedProject = vi.fn<() => Promise<unknown>>()
  const mockIsCloudConfigured = vi.fn<() => boolean>()
  return { mockParseShareToken, mockFetchSharedProject, mockIsCloudConfigured }
})

vi.mock('../parseShareToken', () => ({
  parseShareToken: mockParseShareToken,
}))

vi.mock('../../cloud/shareRepo', () => ({
  fetchSharedProject: mockFetchSharedProject,
}))

vi.mock('../../cloud/supabase', () => ({
  supabase: null,
  isCloudConfigured: mockIsCloudConfigured,
}))

// ── Mock: window.location.href ───────────────────────────────────────────────
Object.defineProperty(window, 'location', {
  value: { href: 'https://app.sculptone.com?share=test-token' },
  writable: true,
})

import { useShareLoader } from '../useShareLoader'
import type { Project } from '@sculptone/score-model'

const fakeProject: Project = {
  id: 'shared-proj',
  metadata: {
    title: 'Shared',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('useShareLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 기본: 클라우드 설정됨
    mockIsCloudConfigured.mockReturnValue(true)
    mockFetchSharedProject.mockResolvedValue(null)
    // shareStore 초기화 (merge 모드: action 함수 유지)
    useShareStore.setState({
      isReadOnly: false,
      shareLoadState: 'idle',
      sharedProject: null,
      shareError: null,
    })
  })

  // ── Fix D — 동기 초기 상태 ──────────────────────────────────────────────

  it('Fix D: 토큰 있음 + configured → 첫 렌더부터 status=loading (동기)', async () => {
    mockParseShareToken.mockReturnValue('valid-token')
    // 이 테스트는 초기 동기값만 확인. fetch는 완료시킴(act 경고 억제).
    mockFetchSharedProject.mockResolvedValue(null)

    const { result } = renderHook(() => useShareLoader())

    // useState lazy initializer가 동기적으로 'loading' 반환 — AppShell 마운트 없음
    expect(result.current).toBe('loading')

    // 비동기 effect 완료 대기 (pending update flush)
    await act(async () => {})
  })

  // ── Fix E — 미설정 graceful degradation ─────────────────────────────────

  it('Fix E: 미설정(isCloudConfigured=false) + 토큰 → status=none, 로컬 앱', () => {
    mockIsCloudConfigured.mockReturnValue(false)
    mockParseShareToken.mockReturnValue('some-token')

    const { result } = renderHook(() => useShareLoader())

    // 미설정 → 토큰 무시 → 'none' (로컬 앱 정상 부팅)
    expect(result.current).toBe('none')
    expect(mockFetchSharedProject).not.toHaveBeenCalled()
  })

  it('Fix E: 미설정 + 토큰 → 에러 화면이 아닌 none', async () => {
    mockIsCloudConfigured.mockReturnValue(false)
    mockParseShareToken.mockReturnValue('any-token')

    const { result } = renderHook(() => useShareLoader())

    await act(async () => {}) // 비동기 effect 완료 대기
    expect(result.current).toBe('none')
  })

  // ── 토큰 없음 ────────────────────────────────────────────────────────────

  it('토큰 없음 → status=none, fetchSharedProject 미호출', async () => {
    mockParseShareToken.mockReturnValue(null)

    const { result } = renderHook(() => useShareLoader())

    await act(async () => {})
    expect(result.current).toBe('none')
    expect(mockFetchSharedProject).not.toHaveBeenCalled()
    expect(useShareStore.getState().isReadOnly).toBe(false)
  })

  // ── 로드 성공 ────────────────────────────────────────────────────────────

  it('토큰 있음 + 프로젝트 반환 → status=loaded, store에 sharedProject 세팅', async () => {
    mockParseShareToken.mockReturnValue('valid-token')
    mockFetchSharedProject.mockResolvedValue(fakeProject)

    const { result } = renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(result.current).toBe('loaded')
    })
    expect(useShareStore.getState().isReadOnly).toBe(true)
    expect(useShareStore.getState().sharedProject).toEqual(fakeProject)
    expect(useShareStore.getState().shareError).toBeNull()
  })

  // ── 에러 케이스 ──────────────────────────────────────────────────────────

  it('토큰 있음 + null 반환(무효 토큰) → status=error, shareError non-null', async () => {
    mockParseShareToken.mockReturnValue('invalid-token')
    mockFetchSharedProject.mockResolvedValue(null)

    const { result } = renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(result.current).toBe('error')
    })
    expect(useShareStore.getState().shareError).not.toBeNull()
    expect(useShareStore.getState().isReadOnly).toBe(false)
  })

  it('토큰 있음 + fetchSharedProject throw → status=error, shareError에 메시지', async () => {
    mockParseShareToken.mockReturnValue('token-throws')
    mockFetchSharedProject.mockRejectedValue(new Error('Network timeout'))

    const { result } = renderHook(() => useShareLoader())

    await waitFor(() => {
      expect(result.current).toBe('error')
    })
    expect(useShareStore.getState().shareError).toContain('Network timeout')
  })

  // ── Fix F — StrictMode 이중 마운트 방어 ─────────────────────────────────

  it('Fix F: StrictMode 이중 마운트에서 fetchSharedProject는 1회만 호출', async () => {
    mockParseShareToken.mockReturnValue('valid-token')
    mockFetchSharedProject.mockResolvedValue(fakeProject)

    const { result } = renderHook(() => useShareLoader(), {
      wrapper: StrictMode,
    })

    await waitFor(() => {
      expect(result.current).toBe('loaded')
    })
    // StrictMode가 effect를 두 번 실행해도 useRef 가드로 1회만 fetch
    expect(mockFetchSharedProject).toHaveBeenCalledOnce()
  })

  it('Fix F: rerender 후에도 fetchSharedProject 추가 호출 없음', async () => {
    mockParseShareToken.mockReturnValue('valid-token')
    mockFetchSharedProject.mockResolvedValue(fakeProject)

    const { result, rerender } = renderHook(() => useShareLoader())

    await waitFor(() => expect(result.current).toBe('loaded'))

    rerender()
    rerender()

    expect(mockFetchSharedProject).toHaveBeenCalledOnce()
  })
})
