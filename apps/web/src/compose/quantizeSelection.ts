/**
 * 현재 선택 노트를 현재 그리드(quantizeDenom/ppq)로 퀀타이즈한다.
 *
 * - 선택 노트 없음 → no-op.
 * - endEdit() → setProject(quantizeNotes(...)) → endEdit() 패턴으로
 *   단일 undo 스텝을 생성한다.
 * - store 상태를 useStore.getState()로 직접 읽어 stale 클로저를 방지한다.
 */
import { quantizeNotes } from '@sculptone/score-model'
import { useStore } from '../state/store'
import { divisionToTicks } from './quantize'

export function quantizeSelection(): void {
  const { selectedNoteIds, selectedTrackId, project, quantizeDenom, endEdit, setProject } =
    useStore.getState()

  if (selectedNoteIds.length === 0) return

  const gridTicks = divisionToTicks(quantizeDenom, project.transport.ppq)

  endEdit()
  setProject(quantizeNotes(project, selectedTrackId, selectedNoteIds, gridTicks))
  endEdit()
}
