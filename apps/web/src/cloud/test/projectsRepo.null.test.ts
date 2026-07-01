import { describe, it, expect, vi } from 'vitest'
import type { Project } from '@sculptone/score-model'

// supabase null → disabled 모드
vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

import { fetchCloudProjects, upsertCloudProject, deleteCloudProject } from '../projectsRepo'

const fakeProject: Project = {
  id: 'p1',
  metadata: {
    title: 'T',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
}

describe('projectsRepo — disabled (supabase null)', () => {
  it('fetchCloudProjects() → [] 반환 (no-op)', async () => {
    await expect(fetchCloudProjects()).resolves.toEqual([])
  })

  it('upsertCloudProject() → undefined 반환 (no-op)', async () => {
    await expect(upsertCloudProject(fakeProject, 'user-1')).resolves.toBeUndefined()
  })

  it('deleteCloudProject() → undefined 반환 (no-op)', async () => {
    await expect(deleteCloudProject('p1')).resolves.toBeUndefined()
  })
})
