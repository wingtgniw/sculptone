import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Supabase 쿼리 빌더 mock — vi.hoisted로 TDZ 우회 ──────────────────────────
//
// SELECT 체인:  .from().select('share_token').eq('id').eq('owner') → Promise
// UPDATE 체인:  .from().update({...}).eq('id').eq('owner').select('id') → Promise
//              (Fix A: .select('id') 로 영향 행 수 확인)
// RPC:          .rpc('get_shared_project', { p_token }) → Promise
//
const {
  // SELECT path terminal — share_token 조회 결과
  mockSelectEqChain,
  // UPDATE path terminal — update + select('id') 결과
  mockUpdateSelect,
  // UPDATE mock (호출 여부/인자 검증용)
  mockUpdateFn,
  mockFrom,
  mockRpc,
} = vi.hoisted(() => {
  // ── SELECT path: .from().select().eq('id').eq('owner') ───────────────────
  const mockSelectEqChain = vi.fn()
  const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEqChain })
  const mockSelectFn = vi.fn().mockReturnValue({ eq: mockSelectEq1 })

  // ── UPDATE path: .from().update().eq('id').eq('owner').select('id') ──────
  const mockUpdateSelect = vi.fn()
  const mockUpdateEqChain = vi.fn().mockReturnValue({ select: mockUpdateSelect })
  const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEqChain })
  const mockUpdateFn = vi.fn().mockReturnValue({ eq: mockUpdateEq1 })

  // ── from() 분기 ──────────────────────────────────────────────────────────
  const mockFrom = vi.fn(() => ({
    select: mockSelectFn,
    update: mockUpdateFn,
  }))

  const mockRpc = vi.fn()

  return {
    mockSelectEqChain,
    mockUpdateSelect,
    mockUpdateFn,
    mockFrom,
    mockRpc,
  }
})

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  isCloudConfigured: () => true,
}))

// authStore 직접 제어
import { useAuthStore } from '../authStore'

const signedInUser = { id: 'user-abc', email: 'test@test.com', avatarUrl: null }

import { shareProject, unshareProject, fetchSharedProject } from '../shareRepo'

// 테스트용 픽스처 — Fix B: get_shared_project RPC 반환 컬럼이 축소됨.
// owner/share_token/created_at 제외: id, title, data, updated_at 만 반환.
const fakeProjectRow = {
  id: 'proj-1',
  title: 'Shared Song',
  updated_at: '2026-07-01T10:00:00.000Z',
  data: {
    id: 'proj-1',
    metadata: {
      title: 'Shared Song',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    },
    transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
    tracks: [],
  },
}

describe('shareRepo — configured (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)

    // SELECT path 기본: share_token null (공유 안 됨)
    mockSelectEqChain.mockResolvedValue({ data: [{ share_token: null }], error: null })

    // UPDATE path 기본: 1행 성공
    mockUpdateSelect.mockResolvedValue({ data: [{ id: 'proj-1' }], error: null })

    mockRpc.mockResolvedValue({ data: [], error: null })
  })

  // ── shareProject ─────────────────────────────────────────────────────────

  it('shareProject: 기존 share_token 있음 → 기존 토큰 반환 (update 미호출)', async () => {
    const existingToken = 'existing-token-abc'
    mockSelectEqChain.mockResolvedValue({ data: [{ share_token: existingToken }], error: null })

    const result = await shareProject('proj-1')

    expect(result).toBe(existingToken)
    expect(mockUpdateFn).not.toHaveBeenCalled()
  })

  it('shareProject: share_token null → update + select 호출, non-empty 토큰 반환', async () => {
    mockSelectEqChain.mockResolvedValue({ data: [{ share_token: null }], error: null })
    mockUpdateSelect.mockResolvedValue({ data: [{ id: 'proj-1' }], error: null })

    const result = await shareProject('proj-1')

    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(mockUpdateFn).toHaveBeenCalledOnce()
    const updateArg = mockUpdateFn.mock.calls[0]![0] as Record<string, unknown>
    expect(typeof updateArg['share_token']).toBe('string')
    expect((updateArg['share_token'] as string).length).toBe(32) // 16바이트 hex = 32자
  })

  // Fix A — 0행 매칭 시 실패
  it('shareProject: update가 0행 반환(미소유/신규) → throw (토큰 반환 안 함)', async () => {
    mockSelectEqChain.mockResolvedValue({ data: [{ share_token: null }], error: null })
    // PostgREST: 0행 매칭 → data:[], error:null
    mockUpdateSelect.mockResolvedValue({ data: [], error: null })

    await expect(shareProject('proj-1')).rejects.toThrow()
  })

  it('shareProject: select 에러 → rethrow', async () => {
    mockSelectEqChain.mockResolvedValue({ data: null, error: { message: 'network error' } })
    await expect(shareProject('proj-1')).rejects.toThrow()
  })

  it('shareProject: update 에러 → rethrow', async () => {
    mockSelectEqChain.mockResolvedValue({ data: [{ share_token: null }], error: null })
    mockUpdateSelect.mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    await expect(shareProject('proj-1')).rejects.toThrow()
  })

  // ── unshareProject ───────────────────────────────────────────────────────

  it('unshareProject: update({ share_token: null }) + select 호출', async () => {
    mockUpdateSelect.mockResolvedValue({ data: [{ id: 'proj-1' }], error: null })

    await unshareProject('proj-1')

    expect(mockUpdateFn).toHaveBeenCalledOnce()
    const updateArg = mockUpdateFn.mock.calls[0]![0] as Record<string, unknown>
    expect(updateArg['share_token']).toBeNull()
  })

  it('unshareProject: 에러 → rethrow', async () => {
    mockUpdateSelect.mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    await expect(unshareProject('proj-1')).rejects.toThrow()
  })

  it('unshareProject: 0행 매칭 → throw (일관성)', async () => {
    mockUpdateSelect.mockResolvedValue({ data: [], error: null })
    await expect(unshareProject('proj-1')).rejects.toThrow()
  })

  // ── fetchSharedProject ───────────────────────────────────────────────────

  it('fetchSharedProject: rpc 호출 → Project 반환', async () => {
    mockRpc.mockResolvedValue({
      data: [fakeProjectRow],
      error: null,
    })

    const result = await fetchSharedProject('some-valid-token')

    expect(mockRpc).toHaveBeenCalledWith('get_shared_project', { p_token: 'some-valid-token' })
    expect(result).not.toBeNull()
    expect((result as Project).id).toBe('proj-1')
  })

  it('fetchSharedProject: 빈 결과(토큰 무효) → null 반환', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const result = await fetchSharedProject('invalid-token')

    expect(result).toBeNull()
  })
})
