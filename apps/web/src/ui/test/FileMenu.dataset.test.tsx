import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '../../state/store'

// vi.hoisted: vi.mock 팩토리보다 먼저 실행됨 (호이스팅 안전)
const { mockDownloadDataset } = vi.hoisted(() => ({
  mockDownloadDataset: vi.fn<() => Promise<void>>(),
}))

// IO 모듈 모킹 (FileMenu 의존성)
vi.mock('../../io/storage', () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  saveProject: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../io/files', () => ({
  downloadBytes: vi.fn(),
  downloadText: vi.fn(),
  readFileAsArrayBuffer: vi.fn(),
}))

// bundle.ts mock — downloadDataset만 필요
vi.mock('../../dataset/bundle', () => ({
  downloadDataset: mockDownloadDataset,
}))

vi.mock('@sculptone/score-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sculptone/score-model')>()
  return {
    ...actual,
    projectToMidi: vi.fn(() => new Uint8Array()),
    projectToMusicXML: vi.fn(() => ''),
  }
})

import { FileMenu } from '../FileMenu'

describe('FileMenu — Export Training Data 스모크', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
    mockDownloadDataset.mockResolvedValue(undefined)
  })

  it('"Export Training Data" 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /export training data/i })).toBeInTheDocument()
  })

  it('버튼 클릭 → downloadDataset이 현재 프로젝트와 함께 호출된다', async () => {
    render(<FileMenu />)
    const btn = screen.getByRole('button', { name: /export training data/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockDownloadDataset).toHaveBeenCalledOnce()
      expect(mockDownloadDataset).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.any(String) }),
      )
    })
  })

  it('내보내기 중 버튼이 비활성화된다', async () => {
    // downloadDataset이 promise를 즉시 해결하지 않도록 제어
    let resolveFn!: () => void
    mockDownloadDataset.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFn = resolve
      }),
    )

    render(<FileMenu />)
    const btn = screen.getByRole('button', { name: /export training data/i })
    fireEvent.click(btn)

    // 버튼이 "Exporting..." 텍스트로 변경되고 disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled()
    })

    resolveFn()
    // 완료 후 버튼 복구
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export training data/i })).not.toBeDisabled()
    })
  })

  it('downloadDataset reject 시 에러 메시지가 렌더된다', async () => {
    mockDownloadDataset.mockRejectedValueOnce(new Error('render failed'))

    render(<FileMenu />)
    const btn = screen.getByRole('button', { name: /export training data/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByText('데이터셋 내보내기 실패')).toBeInTheDocument()
    })
    // 에러 후 버튼이 다시 활성화되어야 함
    expect(screen.getByRole('button', { name: /export training data/i })).not.toBeDisabled()
  })
})
