import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../state/store'
import { useAutosave } from '../useAutosave'

// saveProject를 모킹해 IndexedDB 없이 테스트
vi.mock('../storage', () => ({
  saveProject: vi.fn().mockResolvedValue(undefined),
}))

import { saveProject } from '../storage'
const mockSave = saveProject as ReturnType<typeof vi.fn>

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSave.mockClear()
    useStore.setState(useStore.getInitialState(), true)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('최초 마운트에서는 (800ms가 지나도) 저장하지 않는다', async () => {
    renderHook(() => useAutosave())
    expect(mockSave).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('project 변경 시 디바운스가 리셋되어 변경 후 800ms에 한 번 호출한다', async () => {
    renderHook(() => useAutosave())
    // 400ms 후 project 변경
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    act(() => {
      useStore.getState().setProject({ ...useStore.getState().project })
    })
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    // 변경 후 800ms가 아직 안 됨 → 호출 없음
    expect(mockSave).not.toHaveBeenCalled()
    // 추가 400ms → 총 변경 후 800ms → 1회 호출
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('변경 후 saveProject에 현재 project를 인수로 전달한다', async () => {
    renderHook(() => useAutosave())
    await act(async () => {
      vi.advanceTimersByTime(800)
    }) // 최초 마운트: 저장 없음
    act(() => {
      useStore.getState().setProject({ ...useStore.getState().project })
    })
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    const calledWith = mockSave.mock.calls[0]?.[0]
    expect(calledWith?.id).toBe(useStore.getState().project.id)
  })

  it('언마운트 시 대기 중인 저장이 취소된다', async () => {
    const { unmount } = renderHook(() => useAutosave())
    // 최초 마운트 스킵 이후 변경으로 디바운스 시작
    act(() => {
      useStore.getState().setProject({ ...useStore.getState().project })
    })
    await act(async () => {
      vi.advanceTimersByTime(400)
    }) // 400ms 진행(디바운스 미완)
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(800)
    }) // 추가 800ms 진행
    expect(mockSave).not.toHaveBeenCalled()
  })
})
