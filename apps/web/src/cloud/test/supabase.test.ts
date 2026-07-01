import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @supabase/supabase-js 전체 모킹 (호이스팅 — import보다 먼저 실행됨)
// supabase.ts 내 createClient 호출을 인터셉트한다.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ _isMockClient: true })),
}))

// 이 파일은 '../supabase'를 정적으로 import하지 않는다.
// 각 테스트는 vi.resetModules() 후 동적 import로 새 모듈 인스턴스를 얻는다.

describe('supabase singleton', () => {
  beforeEach(() => {
    vi.resetModules() // 각 테스트 전 모듈 캐시 초기화 → 동적 import 시 재실행
  })

  afterEach(() => {
    vi.unstubAllEnvs() // vi.stubEnv로 설정한 env 정리
  })

  // ── 클라이언트 생성 분기 ──────────────────────────────────

  it('URL과 key가 모두 설정되면 supabase client가 non-null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key-abc123')
    const { supabase } = await import('../supabase')
    expect(supabase).not.toBeNull()
  })

  it('URL이 비어 있으면 supabase client가 null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  it('key가 비어 있으면 supabase client가 null이다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  it('URL과 key 모두 없으면 supabase client가 null이다', async () => {
    // stubEnv에 빈 문자열: falsy → null 경로
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await import('../supabase')
    expect(supabase).toBeNull()
  })

  // ── isCloudConfigured 분기 ────────────────────────────────

  it('isCloudConfigured()는 client non-null 시 true를 반환한다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
    const { isCloudConfigured } = await import('../supabase')
    expect(isCloudConfigured()).toBe(true)
  })

  it('isCloudConfigured()는 client null 시 false를 반환한다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { isCloudConfigured } = await import('../supabase')
    expect(isCloudConfigured()).toBe(false)
  })

  // ── Fix 1 회귀: createClient throw 시 graceful degradation ──────

  it('createClient가 throw해도 supabase=null, isCloudConfigured=false (앱 크래시 없음)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://malformed-url.example')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
    // 먼저 mocked @supabase/supabase-js를 가져와 createClient를 throw하도록 오버라이드
    const supabaseJs = await import('@supabase/supabase-js')
    vi.mocked(supabaseJs.createClient).mockImplementationOnce(() => {
      throw new Error('Invalid supabaseUrl: Provided URL is malformed.')
    })
    // ../supabase를 동적 import — createClient throw가 앱 크래시 없이 null로 폴백되어야 함
    const { supabase, isCloudConfigured } = await import('../supabase')
    expect(supabase).toBeNull()
    expect(isCloudConfigured()).toBe(false)
  })
})
