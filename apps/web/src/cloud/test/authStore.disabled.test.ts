import { describe, it, expect, vi } from 'vitest'

// supabase null → disabled 모드 시뮬레이션
// 별도 파일 분리: vi.mock은 파일 단위로 격리됨
vi.mock('../supabase', () => ({
  supabase: null,
  isCloudConfigured: () => false,
}))

// vi.mock 호이스팅 후 authStore import → create()가 supabase=null로 실행
import { useAuthStore } from '../authStore'

describe('authStore — disabled path (supabase null)', () => {
  // ── 초기 상태 ───────────────────────────────────────────────

  it('supabase null → 초기 status = disabled', () => {
    expect(useAuthStore.getState().status).toBe('disabled')
  })

  // ── init() no-op ─────────────────────────────────────────────

  it('init() → 즉시 정리 함수 반환, 내부 API 미호출', () => {
    // disabled 모드에서 init()은 getSession/onAuthStateChange를 호출하지 않아야 함
    // mock supabase가 null이므로 auth.getSession 등은 존재하지 않음
    // init()이 오류 없이 빈 정리 함수를 반환하는지 확인
    expect(() => {
      const cleanup = useAuthStore.getState().init()
      cleanup() // 호출해도 오류 없음
    }).not.toThrow()
    expect(useAuthStore.getState().status).toBe('disabled') // 상태 변화 없음
  })

  // ── signIn no-op ──────────────────────────────────────────────

  it('signIn(provider) → 호출해도 status 변화 없음, 오류 없음', async () => {
    await expect(useAuthStore.getState().signIn('google')).resolves.toBeUndefined()
    expect(useAuthStore.getState().status).toBe('disabled')
  })
})
