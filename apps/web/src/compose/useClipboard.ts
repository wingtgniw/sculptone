import { useEffect } from 'react'
import { addNote, removeNote, createNote } from '@sculptone/score-model'
import { useStore } from '../state/store'
import { barTicks, pasteNotesParams, duplicateNotesParams } from './clipboard'
import { divisionToTicks } from './quantize'
import { secondsToTicks } from './time'

// ── 입력 필드 가드 ─────────────────────────────────────────────

function isInputLike(target: HTMLElement): boolean {
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

// ── 훅 ────────────────────────────────────────────────────────

/**
 * 전역 Ctrl/Cmd+C/X/V/D 클립보드 단축키를 등록한다.
 *
 * @param getSeconds - 현재 재생 위치(초)를 반환하는 stable ref. useAudio().getSeconds.
 *
 * 설계 노트:
 * - window keydown 리스너를 직접 등록해 AppShell의 기존 핸들러와 독립적으로 동작.
 * - 모든 store 상태는 핸들러 내부에서 useStore.getState()로 읽어 stale 클로저를 방지.
 * - 프로젝트를 변경하는 액션(X/V/D) 전에 endEdit()을 호출해 클립보드 조작이
 *   직전 드래그와 코얼레싱되지 않고 독립적인 undo 스텝이 되게 한다.
 * - Ctrl+D는 브라우저 북마크 단축키이므로 e.preventDefault() 필수.
 *   C/X/V도 입력 필드 외부에서 e.preventDefault()를 호출해 예기치 않은
 *   브라우저 동작을 방지한다.
 * - 다중 선택 지원: selectedNoteIds 기반으로 동작하며 단일 선택(selectedNoteIds=[id])도
 *   그대로 통과한다. clipboardNotes/setClipboardNotes를 사용하되 미러를 통해
 *   기존 clipboardNote 단언 테스트와 호환된다.
 */
export function useClipboard({ getSeconds }: { getSeconds: () => number }): void {
  useEffect(() => {
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

    const handler = (e: KeyboardEvent) => {
      // ── 입력 필드 가드 ──
      if (isInputLike(e.target as HTMLElement)) return

      // ── 수식어 가드: Ctrl 또는 Cmd 필수, Alt/Shift는 불가 ──
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return

      const k = e.key.toLowerCase()
      if (k !== 'c' && k !== 'x' && k !== 'v' && k !== 'd') return

      // 여기까지 왔으면 클립보드 단축키 — 브라우저 기본 동작 차단
      e.preventDefault()

      // 키 홀드 시 반복 이벤트 무시 (AppShell.tsx 패턴과 일치)
      if (e.repeat) return

      const {
        project,
        selectedTrackId,
        selectedNoteIds,
        quantizeDenom,
        clipboardNotes,
        setClipboardNotes,
        setProject,
        setSelectedNoteIds,
        clearNoteSelection,
        endEdit,
      } = useStore.getState()

      const track = project.tracks.find((t) => t.id === selectedTrackId)
      const selectedNotes = track?.notes.filter((n) => selectedNoteIds.includes(n.id)) ?? []

      const ppq = project.transport.ppq
      const tempo = project.transport.tempo
      const timeSignature = project.transport.timeSignature as [number, number]
      const grid = divisionToTicks(quantizeDenom, ppq)

      // ── 복사 (C) ──────────────────────────────────────────────
      if (k === 'c') {
        if (selectedNotes.length === 0) return
        setClipboardNotes(selectedNotes)
        return
      }

      // ── 오려내기 (X) ──────────────────────────────────────────
      if (k === 'x') {
        if (selectedNotes.length === 0) return
        setClipboardNotes(selectedNotes)
        endEdit() // 직전 드래그와 코얼레싱 방지
        let p = project
        for (const n of selectedNotes) {
          p = removeNote(p, selectedTrackId, n.id)
        }
        setProject(p)
        clearNoteSelection()
        // Fix D: trailing endEdit으로 coalesce 창을 닫아 다음 편집이 별도 undo 스텝이 되게 한다.
        endEdit()
        return
      }

      // ── 붙여넣기 (V) ──────────────────────────────────────────
      if (k === 'v') {
        if (clipboardNotes.length === 0) return
        if (!track) return // 선택 트랙 없으면 phantom note/undo 방지
        const anchorTick = secondsToTicks(getSeconds(), ppq, tempo)
        const paramsArr = pasteNotesParams(clipboardNotes, anchorTick, grid)
        const newNotes = paramsArr.map((params) => createNote(params))
        endEdit()
        let p = project
        for (const n of newNotes) {
          p = addNote(p, selectedTrackId, n)
        }
        setProject(p)
        setSelectedNoteIds(newNotes.map((n) => n.id))
        // Fix D: trailing endEdit으로 coalesce 창을 닫아 다음 편집이 별도 undo 스텝이 되게 한다.
        endEdit()
        return
      }

      // ── 복제 (D) ──────────────────────────────────────────────
      if (k === 'd') {
        if (selectedNotes.length === 0) return
        const bt = barTicks(ppq, timeSignature)
        const paramsArr = duplicateNotesParams(selectedNotes, bt)
        const newNotes = paramsArr.map((params) => createNote(params))
        endEdit()
        let p = project
        for (const n of newNotes) {
          p = addNote(p, selectedTrackId, n)
        }
        setProject(p)
        setSelectedNoteIds(newNotes.map((n) => n.id))
        // Fix D: trailing endEdit으로 coalesce 창을 닫아 다음 편집이 별도 undo 스텝이 되게 한다.
        endEdit()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [getSeconds])
  // getSeconds는 useAudio의 useCallback([], []) — stable ref, 의존 배열 포함 안전.
}
