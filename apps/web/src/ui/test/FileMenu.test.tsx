import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { FileMenu } from '../FileMenu'

// IO 모듈 모킹 (IndexedDB · 파일 시스템 없이 테스트)
vi.mock('../../io/storage', () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  saveProject: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../io/files', () => ({
  downloadBytes: vi.fn(),
  downloadText: vi.fn(),
  readFileAsArrayBuffer: vi.fn(),
}))
vi.mock('@sculptone/score-model', async (importOrig) => {
  const orig = await importOrig<typeof import('@sculptone/score-model')>()
  return {
    ...orig,
    projectToMidi: vi.fn().mockReturnValue(new Uint8Array([0])),
    midiToProject: vi.fn().mockReturnValue(orig.createEmptyProject('Imported')),
    serializeProject: vi.fn().mockReturnValue('{}'),
    projectToMusicXML: vi.fn().mockReturnValue('<?xml version="1.0"?>'), // NEW
  }
})

describe('FileMenu', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('New · Export MIDI · Export JSON · Import MIDI 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export midi/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import midi/i })).toBeInTheDocument()
  })

  it('New 클릭 시 Piano 트랙 1개로 시드된 새 프로젝트로 교체된다', async () => {
    render(<FileMenu />)
    const prevId = useStore.getState().project.id
    await userEvent.click(screen.getByRole('button', { name: /new/i }))
    const state = useStore.getState()
    expect(state.project.id).not.toBe(prevId)
    expect(state.project.tracks).toHaveLength(1)
    expect(state.project.tracks[0]!.name).toBe('Piano')
    // replaceProject: 선택이 새 첫 트랙으로 리셋된다
    expect(state.selectedTrackId).toBe(state.project.tracks[0]!.id)
    expect(state.selectedNoteId).toBeNull()
  })

  it('Import: 정상 .mid 업로드 시 확장자가 제거된 타이틀로 midiToProject가 호출되고 replaceProject로 반영된다', async () => {
    const { midiToProject } = await import('@sculptone/score-model')
    const { readFileAsArrayBuffer } = await import('../../io/files')
    ;(readFileAsArrayBuffer as ReturnType<typeof vi.fn>).mockResolvedValue(new ArrayBuffer(8))

    const { container } = render(<FileMenu />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'My Song.mid', { type: 'audio/midi' })

    await userEvent.upload(input, file)

    await waitFor(() => {
      expect(midiToProject).toHaveBeenCalledWith(expect.any(Uint8Array), 'My Song')
    })
    // mock midiToProject는 0트랙 'Imported' 프로젝트를 반환 → replaceProject가 선택을 리셋
    const state = useStore.getState()
    expect(state.project.metadata.title).toBe('Imported')
    expect(state.selectedTrackId).toBe('')
    expect(state.selectedNoteId).toBeNull()
  })

  it('Import: midiToProject가 throw하면 replaceProject 미반영 + 에러 메시지 렌더 + 예외 미전파', async () => {
    const { midiToProject } = await import('@sculptone/score-model')
    const { readFileAsArrayBuffer } = await import('../../io/files')
    ;(readFileAsArrayBuffer as ReturnType<typeof vi.fn>).mockResolvedValue(new ArrayBuffer(8))
    ;(midiToProject as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('corrupt midi')
    })

    const { container } = render(<FileMenu />)
    const prevId = useStore.getState().project.id
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([0])], 'broken.midi', { type: 'audio/midi' })

    // 예외가 전파되면 이 await가 reject되어 테스트가 실패한다
    await userEvent.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('MIDI 파일을 불러올 수 없습니다.')).toBeInTheDocument()
    })
    expect(useStore.getState().project.id).toBe(prevId)
  })

  it('Export MIDI 클릭 시 downloadBytes가 .mid 파일명으로 호출된다', async () => {
    const { downloadBytes } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export midi/i }))
    expect(downloadBytes).toHaveBeenCalledOnce()
    const [, filename, mime] = (downloadBytes as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(filename).toMatch(/\.mid$/)
    expect(mime).toContain('midi')
  })

  it('Export JSON 클릭 시 downloadText가 .json 파일명으로 호출된다', async () => {
    const { downloadText } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))
    expect(downloadText).toHaveBeenCalledOnce()
    const [, filename] = (downloadText as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(filename).toMatch(/\.json$/)
  })

  it('"Export MusicXML" 버튼이 렌더된다', () => {
    render(<FileMenu />)
    expect(screen.getByRole('button', { name: /export musicxml/i })).toBeInTheDocument()
  })

  it('Export MusicXML 클릭 시 downloadText가 .musicxml 파일명으로 호출된다', async () => {
    const { downloadText } = await import('../../io/files')
    render(<FileMenu />)
    await userEvent.click(screen.getByRole('button', { name: /export musicxml/i }))
    expect(downloadText).toHaveBeenCalledOnce()
    const [, filename, mime] = (downloadText as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(filename).toMatch(/\.musicxml$/)
    expect(mime).toBe('application/vnd.recordare.musicxml+xml')
  })

  it('Import MIDI 버튼 클릭 시 hidden file input의 click이 호출된다', async () => {
    const { container } = render(<FileMenu />)
    const fileInput = container.querySelector('input[type=file]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: /import midi/i }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
