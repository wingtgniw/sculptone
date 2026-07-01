import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAuthStore } from '../../cloud/authStore'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../cloud/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [{ share_token: null }], error: null })),
      })),
    })),
  },
  isCloudConfigured: () => true,
}))

// vi.hoisted로 선언해야 vi.mock 팩토리 안에서 참조 가능 (hoisting 방지)
const { mockShareProject, mockUnshareProject } = vi.hoisted(() => ({
  mockShareProject: vi.fn<() => Promise<string>>(),
  mockUnshareProject: vi.fn<() => Promise<void>>(),
}))

vi.mock('../../cloud/shareRepo', () => ({
  shareProject: mockShareProject,
  unshareProject: mockUnshareProject,
}))

// store: 현재 프로젝트 id 제공
vi.mock('../../state/store', () => ({
  useStore: (selector: (s: { project: { id: string } }) => unknown) =>
    selector({ project: { id: 'proj-1' } }),
}))

// clipboard mock
const mockClipboardWriteText = vi.fn<() => Promise<void>>()
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
})
Object.defineProperty(window, 'location', {
  value: { origin: 'https://app.sculptone.com' },
  writable: true,
})

import { ShareButton } from '../ShareButton'

describe('ShareButton — 스모크', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShareProject.mockResolvedValue('new-token-abc')
    mockUnshareProject.mockResolvedValue(undefined)
    mockClipboardWriteText.mockResolvedValue(undefined)
  })

  it('미로그인 → 렌더되지 않음', () => {
    useAuthStore.setState({ status: 'signedOut', user: null }, true)
    const { container } = render(<ShareButton />)
    expect(container.firstChild).toBeNull()
  })

  it('signedIn + 미공유 → "Share" 버튼 표시', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } },
      true,
    )
    render(<ShareButton />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
    })
  })

  it('"Share" 클릭 → shareProject 호출됨', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } },
      true,
    )
    render(<ShareButton />)
    await waitFor(() => screen.getByRole('button', { name: /^share$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }))
    await waitFor(() => {
      expect(mockShareProject).toHaveBeenCalledWith('proj-1')
    })
  })

  it('공유 후 "링크가 복사됐습니다!" 메시지 표시', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } },
      true,
    )
    render(<ShareButton />)
    await waitFor(() => screen.getByRole('button', { name: /^share$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }))
    await waitFor(() => {
      expect(screen.getByText('링크가 복사됐습니다!')).toBeInTheDocument()
    })
  })

  it('clipboard.writeText가 shareProject 결과 URL로 호출됨', async () => {
    useAuthStore.setState(
      { status: 'signedIn', user: { id: 'u1', email: 'a@b.com', avatarUrl: null } },
      true,
    )
    render(<ShareButton />)
    await waitFor(() => screen.getByRole('button', { name: /^share$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }))
    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith(
        'https://app.sculptone.com?share=new-token-abc',
      )
    })
  })
})
