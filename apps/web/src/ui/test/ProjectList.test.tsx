import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { ProjectList } from '../ProjectList'
import type { ProjectSummary } from '../../io/storage'

// vi.mock은 호이스팅되므로, 팩토리 내에서 참조할 변수는 vi.hoisted()로 정의해야 한다
const mockSummaries: ProjectSummary[] = vi.hoisted(() => [
  { id: 'id-1', title: 'Alpha', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'id-2', title: 'Beta',  updatedAt: '2026-06-02T00:00:00.000Z' },
])

vi.mock('../../io/storage', () => ({
  listProjects: vi.fn().mockResolvedValue(mockSummaries),
  loadProject:  vi.fn().mockImplementation(async (id: string) => {
    if (id === 'id-1') {
      const { createEmptyProject } = await import('@sculptone/score-model')
      const p = createEmptyProject('Alpha')
      return { ...p, id: 'id-1' }
    }
    return undefined
  }),
  deleteProject: vi.fn().mockResolvedValue(undefined),
}))

describe('ProjectList', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('마운트 후 listProjects 결과로 프로젝트 목록을 렌더한다', async () => {
    render(<ProjectList />)
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  it('프로젝트 선택(Load) 시 loadProject → setProject가 호출된다', async () => {
    render(<ProjectList />)
    await waitFor(() => screen.getByText('Alpha'))
    await userEvent.click(screen.getByRole('button', { name: /load.*alpha/i }))
    await waitFor(() => {
      expect(useStore.getState().project.id).toBe('id-1')
    })
  })

  it('Load 실패(손상 레코드 등) 시 에러 메시지를 표시하고 프로젝트는 교체되지 않는다', async () => {
    const { loadProject } = await import('../../io/storage')
    ;(loadProject as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('corrupt'))
    render(<ProjectList />)
    await waitFor(() => screen.getByText('Alpha'))
    const prevId = useStore.getState().project.id
    await userEvent.click(screen.getByRole('button', { name: /load.*alpha/i }))
    await waitFor(() => {
      expect(screen.getByText('프로젝트를 열 수 없습니다')).toBeInTheDocument()
    })
    expect(useStore.getState().project.id).toBe(prevId)
  })

  it('목록이 비어있으면 "저장된 프로젝트 없음" 메시지를 표시한다', async () => {
    const { listProjects } = await import('../../io/storage')
    ;(listProjects as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    render(<ProjectList />)
    await waitFor(() => {
      expect(screen.getByText(/저장된 프로젝트 없음/)).toBeInTheDocument()
    })
  })
})
