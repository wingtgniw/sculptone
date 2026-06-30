import {
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type KeyboardEvent as RKeyboardEvent,
} from 'react'
import { useStore } from '../state/store'
import { addNote, removeNote, createNote, updateNote } from '@sculptone/score-model'
import type { Note } from '@sculptone/score-model'
import {
  tickToX,
  xToTick,
  pitchToY,
  yToPitch,
  durationToWidth,
  rollHeight,
  LANE_HEIGHT,
  NOTE_HEIGHT,
  PX_PER_BEAT,
} from './geometry'
import { divisionToTicks, snap } from './quantize'
import { pxToTicks, pxToSemitones, computeMove, computeResize } from './drag'
import { notesInRect } from './selection'
import type { SelectionRect } from './selection'

/** pointerdown → pointermove 이 이 거리(px)를 초과해야 드래그로 인식한다. */
const DRAG_THRESHOLD = 3

/** 리사이즈 핸들 너비(px). 노트 우측 끝. */
const RESIZE_HANDLE_WIDTH = 6

interface DragState {
  noteId: string
  /** 드래그 시작 시 note 값의 스냅샷 (절댓값 계산 기준). */
  origNote: { start: number; pitch: number; duration: number }
  startX: number
  startY: number
  type: 'move' | 'resize'
  /** threshold 초과 여부. false이면 pointerup 시 클릭으로 처리. */
  moved: boolean
}

export function PianoRoll() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const quantizeDenom = useStore((s) => s.quantizeDenom)
  const setProject = useStore((s) => s.setProject)
  const selectNote = useStore((s) => s.selectNote)
  const toggleNoteSelection = useStore((s) => s.toggleNoteSelection)
  const setSelectedNoteIds = useStore((s) => s.setSelectedNoteIds)
  const clearNoteSelection = useStore((s) => s.clearNoteSelection)
  const endEdit = useStore((s) => s.endEdit)
  const rollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const boxSelRef = useRef<{ startX: number; startY: number } | null>(null)
  const [boxSelVisual, setBoxSelVisual] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)
  const grid = divisionToTicks(quantizeDenom, ppq)

  // ── 그리드 클릭: 노트 생성 or 박스 선택 시작 ──────────────────

  const handleGridPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // 방어: pointercancel 등으로 stale dragRef가 남아 있으면 초기화.
    if (dragRef.current) {
      dragRef.current = null
    }
    // 노트/핸들 위 pointerdown은 stopPropagation으로 여기 도달하지 않음.
    // Belt-and-suspenders: e.target !== e.currentTarget 가드도 유지.
    if (e.target !== e.currentTarget) return

    // Shift+포인터다운: 박스 선택 시작 (노트 생성 없음)
    if (e.shiftKey) {
      const rect = rollRef.current!.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      boxSelRef.current = { startX: relX, startY: relY }
      setBoxSelVisual({ x: relX, y: relY, w: 0, h: 0 })
      // Fix B: pointer capture로 그리드 밖 pointerup/lostpointercapture가 올바른 요소로 감
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {}
      return
    }

    // 기존: 노트 생성
    // Fix E: 선택 트랙이 없으면 유령 선택 방지를 위해 조기 반환
    if (!track) return
    const rect = rollRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const start = Math.max(0, snap(xToTick(x, ppq), grid))
    const pitch = yToPitch(y)
    const note = createNote({ pitch, start, duration: grid || ppq, velocity: 96 })
    setProject(addNote(project, selectedTrackId, note))
    selectNote(note.id)
  }

  // ── Delete / Backspace: 노트 삭제 (다중 선택 지원) ────────────

  const handleKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNoteIds.length === 0) return
      endEdit()
      let p = project
      for (const id of selectedNoteIds) {
        p = removeNote(p, selectedTrackId, id)
      }
      setProject(p)
      clearNoteSelection()
      // Fix D: trailing endEdit으로 coalesce 창을 닫아 다음 편집이 별도 undo 스텝이 되게 한다.
      endEdit()
    }
  }

  // ── 드래그 시작: 노트 본체 ────────────────────────────────────────

  const handleNotePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    // stopPropagation: 컨테이너의 handleGridPointerDown 이 실행되지 않도록.
    e.stopPropagation()

    // Shift+클릭: 토글 선택 (드래그 없음) — selectNote 호출 이전에 분기
    if (e.shiftKey) {
      toggleNoteSelection(note.id)
      return
    }

    // Fix #1: pointerdown 즉시 선택 — 드래그 후 Delete가 올바른 노트를 삭제하도록.
    selectNote(note.id)
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'move',
      moved: false,
    }
    // setPointerCapture: 포인터가 노트 밖으로 나가도 pointermove/up 이 노트 → 컨테이너로 버블링됨.
    // jsdom 미지원 시 try/catch로 무시; 컨테이너 onPointerMove 직접 발사로 대체 가능.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 드래그 시작: 리사이즈 핸들 ──────────────────────────────────

  const handleResizePointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    // stopPropagation: 노트 div의 handleNotePointerDown 이 실행되지 않도록.
    e.stopPropagation()
    // Fix C: Shift+pointerdown on 리사이즈 핸들 → 멀티선택 토글 (드래그 없음)
    if (e.shiftKey) {
      toggleNoteSelection(note.id)
      return
    }
    // Fix #1: 리사이즈 핸들 pointerdown에서도 즉시 선택.
    selectNote(note.id)
    dragRef.current = {
      noteId: note.id,
      origNote: { start: note.start, pitch: note.pitch, duration: note.duration },
      startX: e.clientX,
      startY: e.clientY,
      type: 'resize',
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // ── 드래그 진행: 컨테이너 pointermove ────────────────────────────
  //
  // 노트/핸들이 setPointerCapture로 포인터를 잡으면 pointermove 는 해당 요소로 디스패치되고,
  // DOM 버블링으로 컨테이너까지 올라온다. jsdom에서는 container에 직접 발사한다.

  const handleContainerPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    // 박스 선택 업데이트
    if (boxSelRef.current) {
      const rect = rollRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const sx = boxSelRef.current.startX
      const sy = boxSelRef.current.startY
      setBoxSelVisual({
        x: Math.min(sx, cx),
        y: Math.min(sy, cy),
        w: Math.abs(cx - sx),
        h: Math.abs(cy - sy),
      })
      return
    }

    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

    dragRef.current.moved = true
    const { noteId, origNote, type } = dragRef.current

    // stale 클로저 방지: 항상 스토어에서 최신 project 를 읽는다.
    const currentProject = useStore.getState().project

    if (type === 'move') {
      const patch = computeMove(origNote, pxToTicks(dx, ppq), pxToSemitones(dy, LANE_HEIGHT), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    } else {
      const patch = computeResize(origNote, pxToTicks(dx, ppq), grid)
      setProject(updateNote(currentProject, selectedTrackId, noteId, patch))
    }
  }

  // ── 드래그 종료: 컨테이너 pointerup ──────────────────────────────

  // Fix #5: pointercancel / lostpointercapture 시 stale dragRef 정리.
  const handleDragRelease = () => {
    dragRef.current = null
    boxSelRef.current = null
    setBoxSelVisual(null)
  }

  const handleContainerPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    // 박스 선택 완료
    if (boxSelRef.current) {
      const rect = rollRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const sx = boxSelRef.current.startX
      const sy = boxSelRef.current.startY
      const selRect: SelectionRect = {
        startTick: xToTick(Math.min(sx, cx), ppq),
        endTick: xToTick(Math.max(sx, cx), ppq),
        pitchLow: yToPitch(Math.max(sy, cy)),
        pitchHigh: yToPitch(Math.min(sy, cy)),
      }
      const ids = notesInRect(track?.notes ?? [], selRect)
      setSelectedNoteIds(ids)
      boxSelRef.current = null
      setBoxSelVisual(null)
      return
    }

    // Fix #3: 제스처 경계를 닫아 다음 편집이 별도 undo 스텝이 되게 한다.
    endEdit()
    if (!dragRef.current) return
    // threshold 미만(클릭) → 노트 선택 (Fix #1로 pointerdown에서 이미 선택되지만 click 경로 보존)
    if (!dragRef.current.moved) {
      selectNote(dragRef.current.noteId)
    }
    dragRef.current = null
  }

  // Fix G: O(K) includes → O(1) Set.has로 교체 (노트 수만큼 반복 방지)
  const selectedSet = new Set(selectedNoteIds)

  return (
    <div
      ref={rollRef}
      data-testid="pianoroll"
      tabIndex={0}
      onPointerDown={handleGridPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleDragRelease}
      onLostPointerCapture={handleDragRelease}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        height: rollHeight(),
        minWidth: '100%',
        outline: 'none',
        backgroundColor: 'var(--bg-inset)',
        backgroundImage:
          `repeating-linear-gradient(0deg, transparent 0 ${LANE_HEIGHT - 1}px, rgba(255,255,255,.03) ${LANE_HEIGHT - 1}px ${LANE_HEIGHT}px),` +
          `repeating-linear-gradient(90deg, transparent 0 ${PX_PER_BEAT - 1}px, rgba(255,255,255,.05) ${PX_PER_BEAT - 1}px ${PX_PER_BEAT}px)`,
      }}
    >
      {boxSelVisual && (
        <div
          data-testid="box-select-overlay"
          style={{
            position: 'absolute',
            left: boxSelVisual.x,
            top: boxSelVisual.y,
            width: boxSelVisual.w,
            height: boxSelVisual.h,
            border: '1px solid var(--accent)',
            background: 'rgba(128, 80, 30, 0.15)',
            pointerEvents: 'none',
          }}
        />
      )}
      {track?.notes.map((n) => {
        // Fix #2: 노트 폭을 변수로 뽑아 핸들 클램프에 재사용한다.
        const w = Math.max(4, durationToWidth(n.duration, ppq))
        return (
          <div
            key={n.id}
            data-testid="note"
            onPointerDown={(e) => handleNotePointerDown(e, n)}
            style={{
              position: 'absolute',
              left: tickToX(n.start, ppq),
              top: pitchToY(n.pitch),
              width: w,
              height: NOTE_HEIGHT,
              borderRadius: 4,
              cursor: 'grab',
              overflow: 'hidden',
              background: selectedSet.has(n.id) ? 'var(--accent-deep)' : 'var(--accent)',
              boxShadow: '0 1px 4px rgba(0,0,0,.5)',
            }}
          >
            {/* 리사이즈 핸들: 노트 우측 끝. 핸들이 노트 좌측 절반(이동 영역)을 침범하지 않도록 클램프. */}
            <div
              data-testid="note-resize-handle"
              onPointerDown={(e) => handleResizePointerDown(e, n)}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: Math.min(RESIZE_HANDLE_WIDTH, w / 2),
                cursor: 'ew-resize',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
