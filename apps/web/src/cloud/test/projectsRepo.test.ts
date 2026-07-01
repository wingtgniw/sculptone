import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Supabase 쿼리 빌더 mock — vi.hoisted로 TDZ 우회 ──────────────────────────
const { mockFrom, mockSelect, mockUpsert, mockEq, mockDeleteBuilder } = vi.hoisted(() => {
  const mockEq = vi.fn()
  const mockDeleteBuilder = vi.fn(() => ({ eq: mockEq }))
  const mockSelect = vi.fn()
  const mockUpsert = vi.fn()
  const mockFrom = vi.fn(() => ({
    select: mockSelect,
    upsert: mockUpsert,
    delete: mockDeleteBuilder,
  }))
  return { mockFrom, mockSelect, mockUpsert, mockEq, mockDeleteBuilder }
})

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom },
  isCloudConfigured: () => true,
}))

import { fetchCloudProjects, upsertCloudProject, deleteCloudProject } from '../projectsRepo'

// 테스트용 최소 Project 픽스처
const fakeProject: Project = {
  id: 'proj-uuid-1',
  metadata: {
    title: 'Test Song',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

const fakeRows = [
  {
    id: 'proj-uuid-1',
    owner: 'user-abc',
    title: 'Test Song',
    updated_at: '2026-07-01T10:00:00.000Z',
    data: {
      id: 'proj-uuid-1',
      metadata: {
        title: 'Test Song',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
      transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
      tracks: [],
    },
  },
]

describe('projectsRepo — configured (supabase non-null)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockResolvedValue({ data: [], error: null })
    mockUpsert.mockResolvedValue({ error: null })
    mockEq.mockResolvedValue({ error: null })
  })

  // ── fetchCloudProjects ───────────────────────────────────────

  it('fetchCloudProjects() → from("projects").select("id,owner,title,updated_at,data") 호출', async () => {
    mockSelect.mockResolvedValue({ data: fakeRows, error: null })
    await fetchCloudProjects()
    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockSelect).toHaveBeenCalledWith('id, owner, title, updated_at, data')
  })

  it('fetchCloudProjects() → 반환된 rows를 CloudProjectRow[]로 반환', async () => {
    mockSelect.mockResolvedValue({ data: fakeRows, error: null })
    const result = await fetchCloudProjects()
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('proj-uuid-1')
    expect(result[0]!.updated_at).toBe('2026-07-01T10:00:00.000Z')
  })

  it('fetchCloudProjects() 쿼리 에러 → throw(빈 클라우드 오인 방지), console.error 호출', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'network fail' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fetchCloudProjects()).rejects.toThrow()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  // ── upsertCloudProject ───────────────────────────────────────

  it('upsertCloudProject(project, ownerId) → from("projects").upsert() 호출, 올바른 payload', async () => {
    const ownerId = 'user-abc'
    await upsertCloudProject(fakeProject, ownerId)

    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [payload, options] = mockUpsert.mock.calls[0] as [unknown, unknown]
    const row = payload as Record<string, unknown>
    expect(row['id']).toBe(fakeProject.id)
    expect(row['owner']).toBe(ownerId)
    expect(row['title']).toBe(fakeProject.metadata.title)
    expect(row['updated_at']).toBe(fakeProject.metadata.updatedAt)
    // data는 serializeProject → JSON.parse() 결과이므로 객체여야 함
    expect(typeof row['data']).toBe('object')
    expect(row['data']).not.toBeNull()
    expect((options as Record<string, unknown>)['onConflict']).toBe('id')
  })

  it('upsertCloudProject() 에러 → rethrow', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'RLS denied' } })
    await expect(upsertCloudProject(fakeProject, 'user-abc')).rejects.toThrow()
  })

  // ── deleteCloudProject ───────────────────────────────────────

  it('deleteCloudProject(id) → from("projects").delete().eq("id", id) 호출', async () => {
    await deleteCloudProject('proj-uuid-1')
    expect(mockFrom).toHaveBeenCalledWith('projects')
    expect(mockDeleteBuilder).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('id', 'proj-uuid-1')
  })
})
