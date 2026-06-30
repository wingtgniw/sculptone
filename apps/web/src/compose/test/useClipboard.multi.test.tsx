import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useClipboard } from '../useClipboard'
import { useStore } from '../../state/store'
import { addNote, createNote } from '@sculptone/score-model'

function ClipboardWrapper({ getSeconds }: { getSeconds: () => number }) {
  useClipboard({ getSeconds })
  return null
}

describe('useClipboard multi-note', () => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modKey = isMac ? 'metaKey' : 'ctrlKey'

  let noteAId: string
  let noteBId: string

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    const s = useStore.getState()
    const nA = createNote({ pitch: 60, start: 0, duration: 480, velocity: 100 })
    const nB = createNote({ pitch: 62, start: 480, duration: 240, velocity: 80 })
    noteAId = nA.id
    noteBId = nB.id
    let p = addNote(s.project, s.selectedTrackId, nA)
    p = addNote(p, s.selectedTrackId, nB)
    s.setProject(p)
    act(() => {
      s.setSelectedNoteIds([noteAId, noteBId])
    })
  })

  it('Ctrl/Cmd+C: 두 노트 모두 clipboardNotes에 저장된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    const s = useStore.getState()
    expect(s.clipboardNotes).toHaveLength(2)
    // clipboardNote 미러: 첫 번째 노트 (start 기준 정렬 결과)
    expect(s.clipboardNote).not.toBeNull()
  })

  it('Ctrl/Cmd+X: 두 노트 모두 clipboardNotes에 저장되고 트랙에서 제거된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(s.clipboardNotes).toHaveLength(2)
    expect(track.notes).toHaveLength(0)
    expect(s.selectedNoteIds).toEqual([])
    expect(s.selectedNoteId).toBeNull()
  })

  it('Ctrl/Cmd+V: 두 클립 노트가 앵커에 상대 위치 유지하며 붙여넣어진다', () => {
    // 먼저 복사
    act(() => {
      const s = useStore.getState()
      const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
      s.setClipboardNotes(track.notes.slice())
    })
    // 기존 노트 2개, 붙여넣기 후 4개
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(track.notes).toHaveLength(4)
    // 새 노트 2개가 선택됨
    expect(s.selectedNoteIds).toHaveLength(2)
    // 붙여넣기한 노트들이 anchorTick=0에서 시작 (snap(0,120)=0)
    const newNoteIds = s.selectedNoteIds
    const newNotes = track.notes.filter((n) => newNoteIds.includes(n.id))
    expect(newNotes.some((n) => n.start === 0)).toBe(true)
    // 상대 오프셋 유지 (nA.start=0, nB.start=480 → 0, 480)
    const starts = newNotes.map((n) => n.start).sort((a, b) => a - b)
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBe(480)
  })

  it('Ctrl/Cmd+D: 두 노트가 +1마디 복제된다', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })

    const s = useStore.getState()
    const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
    expect(track.notes).toHaveLength(4)
    expect(s.selectedNoteIds).toHaveLength(2)
    // 복제된 노트들의 start
    const newNoteIds = s.selectedNoteIds
    const newNotes = track.notes.filter((n) => newNoteIds.includes(n.id))
    const starts = newNotes.map((n) => n.start).sort((a, b) => a - b)
    // A: 0+1920=1920, B: 480+1920=2400
    expect(starts[0]).toBe(1920)
    expect(starts[1]).toBe(2400)
  })

  it('selectedNoteIds가 비어있으면 Ctrl/Cmd+C는 no-op이다', () => {
    act(() => {
      useStore.getState().clearNoteSelection()
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'c', [modKey]: true })
    expect(useStore.getState().clipboardNotes).toEqual([])
  })

  // ── Fix D: 클립보드 op 후 trailing endEdit ───────────────────

  it('cut(X) 직후 _lastEditAt이 0이다 (Fix D)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'x', [modKey]: true })
    expect(useStore.getState()._lastEditAt).toBe(0)
  })

  it('paste(V) 직후 _lastEditAt이 0이다 (Fix D)', () => {
    act(() => {
      const s = useStore.getState()
      const track = s.project.tracks.find((t) => t.id === s.selectedTrackId)!
      s.setClipboardNotes(track.notes.slice())
    })
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })
    expect(useStore.getState()._lastEditAt).toBe(0)
  })

  it('duplicate(D) 직후 _lastEditAt이 0이다 (Fix D)', () => {
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'd', [modKey]: true })
    expect(useStore.getState()._lastEditAt).toBe(0)
  })

  it('clipboardNotes가 비어있으면 Ctrl/Cmd+V는 no-op이다', () => {
    // clipboardNotes 비워둠 (초기 상태)
    render(<ClipboardWrapper getSeconds={() => 0} />)
    fireEvent.keyDown(document.body, { key: 'v', [modKey]: true })
    const track = useStore
      .getState()
      .project.tracks.find((t) => t.id === useStore.getState().selectedTrackId)!
    expect(track.notes).toHaveLength(2) // 변화 없음
  })
})
