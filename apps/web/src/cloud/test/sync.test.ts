import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Project } from '@sculptone/score-model'

// ── Mock variables — vi.hoisted로 TDZ 우회 ──────────────────────────────────
const {
  mockFetchCloudProjects,
  mockUpsertCloudProject,
  mockListProjects,
  mockLoadProject,
  mockSaveProjectRaw,
  mockConfig,
  mockReplaceProject,
  mockGetState,
} = vi.hoisted(() => ({
  mockFetchCloudProjects: vi.fn(),
  mockUpsertCloudProject: vi.fn(),
  mockListProjects: vi.fn(),
  mockLoadProject: vi.fn(),
  mockSaveProjectRaw: vi.fn(),
  mockConfig: { isConfigured: true }, // 변이 가능한 객체로 isCloudConfigured 제어
  mockReplaceProject: vi.fn(),
  mockGetState: vi.fn(),
}))

// ── Mock: projectsRepo ───────────────────────────────────────────────────────
vi.mock('../projectsRepo', () => ({
  fetchCloudProjects: mockFetchCloudProjects,
  upsertCloudProject: mockUpsertCloudProject,
}))

// ── Mock: storage ────────────────────────────────────────────────────────────
vi.mock('../../io/storage', () => ({
  listProjects: mockListProjects,
  loadProject: mockLoadProject,
  saveProjectRaw: mockSaveProjectRaw,
}))

// ── Mock: supabase (isCloudConfigured) ───────────────────────────────────────
vi.mock('../supabase', () => ({
  supabase: {},
  isCloudConfigured: () => mockConfig.isConfigured,
}))

// ── Mock: useStore (Fix E: 열린 프로젝트 스토어 갱신 검증) ──────────────────
vi.mock('../../state/store', () => ({
  useStore: {
    getState: mockGetState,
  },
}))

// ── authStore: setState로 직접 제어 ─────────────────────────────────────────
import { useAuthStore } from '../authStore'
vi.mock('../authStore', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../authStore')>()
  return mod // 실제 모듈 사용, setState로 상태 제어
})

import { syncNow, pushProject } from '../sync'

// 테스트 픽스처
const T_OLD = '2026-01-01T00:00:00.000Z'
const T_NEW = '2026-07-01T12:00:00.000Z'

const makeProject = (id: string, updatedAt: string): Project => ({
  id,
  metadata: { title: `Project ${id}`, createdAt: T_OLD, updatedAt },
  transport: { ppq: 480, tempo: 120, timeSignature: [4, 4], key: 'C' },
  tracks: [],
})

const signedInUser = { id: 'user-abc', email: 'test@test.com', avatarUrl: null }

describe('sync — syncNow()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.isConfigured = true
    mockFetchCloudProjects.mockResolvedValue([])
    mockListProjects.mockResolvedValue([])
    mockLoadProject.mockResolvedValue(undefined)
    mockSaveProjectRaw.mockResolvedValue(undefined)
    mockUpsertCloudProject.mockResolvedValue(undefined)
    // Fix E: 기본적으로 열린 프로젝트 없음(null) → replaceProject 미호출
    mockGetState.mockReturnValue({ project: null, replaceProject: mockReplaceProject })
  })

  // ── Guard: 미로그인/미설정 ───────────────────────────────────

  it('status !== signedIn → no-op (repo 미호출)', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    await syncNow()
    expect(mockFetchCloudProjects).not.toHaveBeenCalled()
    expect(mockListProjects).not.toHaveBeenCalled()
  })

  it('isCloudConfigured() = false → no-op', async () => {
    mockConfig.isConfigured = false
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    await syncNow()
    expect(mockFetchCloudProjects).not.toHaveBeenCalled()
  })

  // ── Download 경로 ─────────────────────────────────────────────

  it('클라우드에만 있는 프로젝트 → saveProjectRaw 호출 (download)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('cloud-only', T_NEW)
    mockListProjects.mockResolvedValue([])
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'cloud-only',
        owner: signedInUser.id,
        title: 'Cloud Only',
        updated_at: T_NEW,
        data: JSON.parse(JSON.stringify(cloudProject)),
      },
    ])

    await syncNow()

    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    const savedProject = mockSaveProjectRaw.mock.calls[0]![0] as Project
    expect(savedProject.id).toBe('cloud-only')
  })

  it('클라우드가 더 최신인 프로젝트 → saveProjectRaw 호출 (LWW download)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('p1', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'p1', title: 'P1', updatedAt: T_OLD }])
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'p1',
        owner: signedInUser.id,
        title: 'P1',
        updated_at: T_NEW,
        data: JSON.parse(JSON.stringify(cloudProject)),
      },
    ])

    await syncNow()

    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
  })

  // ── Upload 경로 ───────────────────────────────────────────────

  it('로컬에만 있는 프로젝트 → upsertCloudProject 호출 (upload)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const localProject = makeProject('local-only', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'local-only', title: 'Local', updatedAt: T_NEW }])
    mockLoadProject.mockResolvedValue(localProject)
    mockFetchCloudProjects.mockResolvedValue([])

    await syncNow()

    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    const [uploadedProject, ownerId] = mockUpsertCloudProject.mock.calls[0] as [Project, string]
    expect(uploadedProject.id).toBe('local-only')
    expect(ownerId).toBe(signedInUser.id)
  })

  it('로컬이 더 최신인 프로젝트 → upsertCloudProject 호출 (LWW upload)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const localProject = makeProject('p2', T_NEW)
    mockListProjects.mockResolvedValue([{ id: 'p2', title: 'P2', updatedAt: T_NEW }])
    mockLoadProject.mockResolvedValue(localProject)
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'p2',
        owner: signedInUser.id,
        title: 'P2',
        updated_at: T_OLD,
        data: {},
      },
    ])

    await syncNow()

    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    expect(mockSaveProjectRaw).not.toHaveBeenCalled()
  })

  // ── Tie ───────────────────────────────────────────────────────

  it('동일 타임스탬프(tie) → repo 미호출 (no action)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    mockListProjects.mockResolvedValue([{ id: 'p3', title: 'P3', updatedAt: T_NEW }])
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'p3',
        owner: signedInUser.id,
        title: 'P3',
        updated_at: T_NEW,
        data: {},
      },
    ])

    await syncNow()

    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
    expect(mockSaveProjectRaw).not.toHaveBeenCalled()
  })

  // ── Fix C 회귀: loadProject 실패 격리 ────────────────────────

  it('업로드 목록 3개 중 1개 loadProject throw → 나머지 2개 정상 업로드(Fix C)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const p1 = makeProject('up1', T_NEW)
    const p3 = makeProject('up3', T_NEW)
    mockListProjects.mockResolvedValue([
      { id: 'up1', title: 'P1', updatedAt: T_NEW },
      { id: 'up2', title: 'P2', updatedAt: T_NEW },
      { id: 'up3', title: 'P3', updatedAt: T_NEW },
    ])
    mockFetchCloudProjects.mockResolvedValue([])
    mockLoadProject.mockImplementation(async (id: string) => {
      if (id === 'up2') throw new Error('corrupted data')
      if (id === 'up1') return p1
      if (id === 'up3') return p3
      return undefined
    })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await syncNow()
    consoleSpy.mockRestore()
    expect(mockUpsertCloudProject).toHaveBeenCalledTimes(2)
    const uploadedIds = mockUpsertCloudProject.mock.calls.map(([p]) => (p as Project).id)
    expect(uploadedIds).toContain('up1')
    expect(uploadedIds).toContain('up3')
    expect(uploadedIds).not.toContain('up2')
  })

  // ── Fix D 회귀: fetchCloudProjects 실패 → 조기 종료 ──────────

  it('fetchCloudProjects throw → syncNow 조기 종료(업/다운로드 없음)(Fix D)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    mockFetchCloudProjects.mockRejectedValue(new Error('network error'))
    mockListProjects.mockResolvedValue([{ id: 'local-p', title: 'Local', updatedAt: T_NEW }])
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await syncNow()
    consoleSpy.mockRestore()
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
    expect(mockSaveProjectRaw).not.toHaveBeenCalled()
  })

  // ── Fix E 회귀: 다운로드 후 스토어 갱신 ─────────────────────

  it('현재 열린 프로젝트가 다운로드 대상이면 store.replaceProject 호출(Fix E)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('open-proj', T_NEW)
    // 열린 프로젝트 id = 'open-proj'
    mockGetState.mockReturnValue({
      project: { id: 'open-proj' },
      replaceProject: mockReplaceProject,
    })
    mockListProjects.mockResolvedValue([])
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'open-proj',
        owner: signedInUser.id,
        title: 'Open Project',
        updated_at: T_NEW,
        data: JSON.parse(JSON.stringify(cloudProject)),
      },
    ])
    await syncNow()
    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    expect(mockReplaceProject).toHaveBeenCalledOnce()
    const replaced = mockReplaceProject.mock.calls[0]![0] as Project
    expect(replaced.id).toBe('open-proj')
  })

  it('다른 프로젝트 다운로드 시 현재 열린 프로젝트 스토어 미변경(Fix E)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const cloudProject = makeProject('other-proj', T_NEW)
    // 열린 프로젝트 id = 'current-proj' (다운로드 대상과 다름)
    mockGetState.mockReturnValue({
      project: { id: 'current-proj' },
      replaceProject: mockReplaceProject,
    })
    mockListProjects.mockResolvedValue([])
    mockFetchCloudProjects.mockResolvedValue([
      {
        id: 'other-proj',
        owner: signedInUser.id,
        title: 'Other Project',
        updated_at: T_NEW,
        data: JSON.parse(JSON.stringify(cloudProject)),
      },
    ])
    await syncNow()
    expect(mockSaveProjectRaw).toHaveBeenCalledOnce()
    expect(mockReplaceProject).not.toHaveBeenCalled()
  })
})

describe('sync — pushProject()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.isConfigured = true
    mockUpsertCloudProject.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('미로그인 → 타이머 미설정, upsertCloudProject 미호출', async () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    const project = makeProject('p-nologin', T_NEW)
    pushProject(project)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
  })

  it('signedIn + 2000ms 경과 → upsertCloudProject 호출', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const project = makeProject('p-push', T_NEW)
    pushProject(project)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    const [calledProject, ownerId] = mockUpsertCloudProject.mock.calls[0] as [Project, string]
    expect(calledProject.id).toBe('p-push')
    expect(ownerId).toBe(signedInUser.id)
  })

  it('pushProject 연속 2회 → 디바운스로 upsertCloudProject 1회만 호출', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const p1 = makeProject('p-debounce', T_OLD)
    const p2 = makeProject('p-debounce', T_NEW)
    pushProject(p1)
    await vi.advanceTimersByTimeAsync(500) // 아직 타이머 미만료
    pushProject(p2) // 이전 타이머 취소, 새 타이머 시작
    await vi.advanceTimersByTimeAsync(2000) // 새 타이머 만료
    expect(mockUpsertCloudProject).toHaveBeenCalledOnce()
    // 마지막 호출(p2)의 프로젝트가 업로드됨
    const [calledProject] = mockUpsertCloudProject.mock.calls[0] as [Project]
    expect(calledProject.metadata.updatedAt).toBe(T_NEW)
  })

  it('pushProject 후 타이머 발화 전 로그아웃 → 콜백에서 no-op', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const project = makeProject('p-logout', T_NEW)
    pushProject(project) // 타이머 예약 (2000ms)
    await vi.advanceTimersByTimeAsync(500) // 아직 미발화
    // 로그아웃: status를 signedOut으로 변경
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    await vi.advanceTimersByTimeAsync(2000) // 타이머 발화 — 이 시점에 signedOut이므로 no-op
    expect(mockUpsertCloudProject).not.toHaveBeenCalled()
  })

  // ── Fix B 회귀: 프로젝트 전환 시 유실 방지 ──────────────────

  it('다른 프로젝트 A, B를 디바운스 중 연속 push → A, B 모두 업로드(Fix B)', async () => {
    useAuthStore.setState({ status: 'signedIn', user: signedInUser }, true)
    const pA = makeProject('proj-A', T_NEW)
    const pB = makeProject('proj-B', T_NEW)
    pushProject(pA) // A 타이머 시작
    await vi.advanceTimersByTimeAsync(500) // 아직 미발화
    pushProject(pB) // B는 별도 id → B 타이머 독립 시작, A 타이머 유지
    await vi.advanceTimersByTimeAsync(2000) // 두 타이머 모두 발화
    expect(mockUpsertCloudProject).toHaveBeenCalledTimes(2)
    const uploadedIds = mockUpsertCloudProject.mock.calls.map(([p]) => (p as Project).id)
    expect(uploadedIds).toContain('proj-A')
    expect(uploadedIds).toContain('proj-B')
  })
})
