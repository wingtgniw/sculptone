// fake-indexeddb/auto: instanceof 검사용 전역 설정
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { __resetDB } from '../../io/storage'
import { PatchLibrary } from '../PatchLibrary'
import type { Sound } from '@sculptone/score-model'

const BASE_PATCH: Sound = {
  kind: 'patch',
  engine: 'synth',
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

// Load 테스트 변별용: BASE_PATCH 와 다른 값 — 출처를 명확히 구분한다
const LOADED_PATCH: Sound = {
  kind: 'patch',
  engine: 'fm',
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
}

// 각 테스트 전에 DB 격리 + store 초기화
beforeEach(() => {
  __resetDB()
  globalThis.indexedDB = new IDBFactory()
  useStore.setState(useStore.getInitialState(), true)
  vi.clearAllMocks()
})

describe('PatchLibrary', () => {
  function getTrackId() {
    return useStore.getState().selectedTrackId
  }

  it('초기에는 "저장된 패치 없음" 메시지를 표시한다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await waitFor(() => {
      expect(screen.getByText(/저장된 패치 없음/)).toBeInTheDocument()
    })
  })

  it('Patch name 입력 후 Save 버튼 클릭 시 패치가 목록에 나타난다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await userEvent.type(screen.getByRole('textbox', { name: /patch name/i }), 'My Lead')
    await userEvent.click(screen.getByRole('button', { name: /save patch/i }))
    await waitFor(() => {
      expect(screen.getByText('My Lead')).toBeInTheDocument()
    })
  })

  it('이름이 빈 문자열일 때 Save 버튼이 disabled이다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    // 빈 이름 상태에서 버튼이 disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save patch/i })).toBeDisabled()
    })
  })

  it('Load 버튼 클릭 시 해당 sound로 트랙 sound가 갱신된다', async () => {
    // LOADED_PATCH(BASE_PATCH 와 다른 값)를 저장해 출처를 명확히 구분한다
    const { savePatch: _savePatch } = await import('../../io/patch-storage')
    await _savePatch('Test Patch', LOADED_PATCH)

    const trackId = getTrackId()
    // currentSound 는 BASE_PATCH — Load 후 LOADED_PATCH 로 바뀌어야 함
    render(<PatchLibrary trackId={trackId} currentSound={BASE_PATCH} />)
    await waitFor(() => screen.getByText('Test Patch'))
    await userEvent.click(screen.getByRole('button', { name: /load patch test patch/i }))
    await waitFor(() => {
      const track = useStore.getState().project.tracks.find((t) => t.id === trackId)
      expect(track?.sound).toEqual(LOADED_PATCH)
      expect(track?.sound).not.toEqual(BASE_PATCH)
    })
  })

  it('Delete 버튼 클릭 시 패치가 목록에서 사라진다', async () => {
    const { savePatch: _savePatch } = await import('../../io/patch-storage')
    await _savePatch('To Delete', BASE_PATCH)

    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    await waitFor(() => screen.getByText('To Delete'))
    await userEvent.click(screen.getByRole('button', { name: /delete patch to delete/i }))
    await waitFor(() => {
      expect(screen.queryByText('To Delete')).not.toBeInTheDocument()
      expect(screen.getByText(/저장된 패치 없음/)).toBeInTheDocument()
    })
  })

  it('저장 후 이름 입력 필드가 초기화된다', async () => {
    render(<PatchLibrary trackId={getTrackId()} currentSound={BASE_PATCH} />)
    const input = screen.getByRole('textbox', { name: /patch name/i })
    await userEvent.type(input, 'My Patch')
    await userEvent.click(screen.getByRole('button', { name: /save patch/i }))
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })
})
