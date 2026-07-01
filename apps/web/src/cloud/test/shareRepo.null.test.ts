import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

import { shareProject, unshareProject, fetchSharedProject } from '../shareRepo'

describe('shareRepo — disabled (supabase null)', () => {
  it('fetchSharedProject → null 반환 (no-op)', async () => {
    await expect(fetchSharedProject('any-token')).resolves.toBeNull()
  })

  it('unshareProject → undefined 반환 (no-op)', async () => {
    await expect(unshareProject('proj-1')).resolves.toBeUndefined()
  })

  it('shareProject → throw Error (소유자 전용, degradation 없음)', async () => {
    await expect(shareProject('proj-1')).rejects.toThrow()
  })
})
