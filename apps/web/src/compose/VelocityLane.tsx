import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import { updateNote } from '@sculptone/score-model'
import type { Note } from '@sculptone/score-model'
import { tickToX, durationToWidth } from './geometry'
import {
  VELOCITY_LANE_HEIGHT,
  velocityToHeight,
  computeVelocityFromDrag,
  computeGroupVelocityDelta,
} from './velocity'

interface DragVelState {
  noteId: string
  /** 드래그 시작 시 스냅샷된 잡은 노트의 velocity (절대 계산 기준). */
  origVelocity: number
  /**
   * 멀티 드래그 전용: grab 시점에 선택된 모든 노트의 velocity 스냅샷.
   * id → origVelocity. 매 pointermove는 이 스냅샷 + 총 delta로 절대 계산.
   * 단일 드래그 시 null.
   */
  origVelocities: Map<string, number> | null
  /** pointerdown 시점의 clientY. 총 dy 계산 기준. */
  startY: number
}

export function VelocityLane() {
  const project = useStore((s) => s.project)
  const selectedTrackId = useStore((s) => s.selectedTrackId)
  const selectedNoteIds = useStore((s) => s.selectedNoteIds)
  const setProject = useStore((s) => s.setProject)
  const endEdit = useStore((s) => s.endEdit)

  const laneRef = useRef<HTMLDivElement>(null)
  const dragVelRef = useRef<DragVelState | null>(null)

  const ppq = project.transport.ppq
  const track = project.tracks.find((t) => t.id === selectedTrackId)

  // O(1) 선택 여부 조회
  const selectedSet = new Set(selectedNoteIds)

  // ── 드래그 시작: 막대 pointerdown ─────────────────────────────

  const handleBarPointerDown = (e: RPointerEvent<HTMLDivElement>, note: Note) => {
    e.stopPropagation()

    const isMulti = selectedSet.has(note.id) && selectedNoteIds.length > 1

    if (isMulti) {
      // 멀티: 선택 노트 전체의 velocity 스냅샷
      const snapshot = new Map<string, number>()
      for (const id of selectedNoteIds) {
        const n = track?.notes.find((nn) => nn.id === id)
        if (n) snapshot.set(id, n.velocity)
      }
      dragVelRef.current = {
        noteId: note.id,
        origVelocity: note.velocity,
        origVelocities: snapshot,
        startY: e.clientY,
      }
    } else {
      // 단일: 해당 노트의 velocity만 스냅샷
      dragVelRef.current = {
        noteId: note.id,
        origVelocity: note.velocity,
        origVelocities: null,
        startY: e.clientY,
      }
    }

    // Pointer capture: 막대 밖으로 포인터가 나가도 pointermove/up이 이 요소로 전달됨.
    // jsdom에서 미지원 → try/catch 무시. 레인 컨테이너의 onPointerMove로 대체.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // jsdom에서 setPointerCapture가 미구현 — 무시
    }
  }

  // ── 드래그 진행: 레인 컨테이너 pointermove ─────────────────────
  //
  // setPointerCapture 덕분에 막대 밖으로 나가도 이 핸들러로 버블링된다.
  // jsdom에서는 컨테이너에 직접 이벤트를 발사한다.

  const handlePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragVelRef.current) return
    const { noteId, origVelocity, origVelocities, startY } = dragVelRef.current
    const dy = e.clientY - startY

    // 순수 수평 이동(dy=0)은 velocity 변화 없음 → no-op으로 처리.
    // 불필요한 setProject 호출 및 undo 스텝 생성을 방지한다.
    if (dy === 0) return

    // stale 클로저 방지: 매 move마다 스토어에서 최신 project를 읽는다.
    const currentProject = useStore.getState().project

    if (origVelocities !== null) {
      // 멀티 드래그: origVelocities 스냅샷 + 총 dy → 그룹 delta → 절대 적용
      const rawDelta = Math.round((-dy * 127) / VELOCITY_LANE_HEIGHT)
      const delta = computeGroupVelocityDelta(Array.from(origVelocities.values()), rawDelta)
      let p = currentProject
      for (const [id, origVel] of origVelocities) {
        // delta는 computeGroupVelocityDelta가 0..127 범위를 보장
        p = updateNote(p, selectedTrackId, id, { velocity: origVel + delta })
      }
      setProject(p)
    } else {
      // 단일 드래그: origVelocity 스냅샷 + 총 dy → 절대 velocity
      const newVelocity = computeVelocityFromDrag(origVelocity, dy, VELOCITY_LANE_HEIGHT)
      setProject(updateNote(currentProject, selectedTrackId, noteId, { velocity: newVelocity }))
    }
  }

  // ── 드래그 종료: 모든 종료 경로에서 endEdit() 대칭 호출 ──────────

  const handleDragEnd = () => {
    endEdit()
    dragVelRef.current = null
  }

  return (
    <div
      ref={laneRef}
      data-testid="velocity-lane"
      onPointerMove={handlePointerMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onLostPointerCapture={handleDragEnd}
      style={{
        position: 'relative',
        height: VELOCITY_LANE_HEIGHT,
        minWidth: '100%',
        backgroundColor: 'var(--bg-inset)',
        borderTop: '1px solid var(--border)',
        boxSizing: 'border-box',
      }}
    >
      {track?.notes.map((n) => {
        const barWidth = Math.max(4, durationToWidth(n.duration, ppq))
        const barHeight = velocityToHeight(n.velocity, VELOCITY_LANE_HEIGHT)
        const isSelected = selectedSet.has(n.id)
        return (
          <div
            key={n.id}
            data-testid="velocity-bar"
            onPointerDown={(e) => handleBarPointerDown(e, n)}
            style={{
              position: 'absolute',
              left: tickToX(n.start, ppq),
              bottom: 0,
              width: barWidth,
              height: barHeight,
              // 선택 노트: 강조(Copper accent-deep), 미선택: 반투명 accent
              backgroundColor: isSelected ? 'var(--accent-deep)' : 'var(--accent)',
              opacity: isSelected ? 1 : 0.65,
              cursor: 'ns-resize',
              boxSizing: 'border-box',
              borderRadius: '2px 2px 0 0',
            }}
          />
        )
      })}
    </div>
  )
}
